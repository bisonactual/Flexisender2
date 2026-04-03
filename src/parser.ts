// ═══════════════════════════════════════════════
// Response parser & status reports
// ═══════════════════════════════════════════════

import { state } from './state';
import { log } from './console';
import { updateBufDisplay, _updateHomeBtnHomed } from './connection';
import { pumpQueue, updateRunButtons } from './streaming';
import { updateExecutedPath, toolGroup } from './viewport';
import { settingsIntercept, tryInterceptValue, onSettingWriteOk, onSettingWriteErr, tryParseSettingLine } from './settings';
import { toolTableIntercept, renderToolTable, renderModTT } from './tooltable';
import { bearCheckPlugin, bearIntercept, bearParseStatus } from './bear';
import { emit, type StatusReport } from './bus';

export function parseResponse(raw: string): void {
  if (raw.startsWith('<') && raw.endsWith('>')) { parseStatus(raw.slice(1, -1)); return; }

  // Always dequeue sentQueue on ok/error — before intercepts, so RX tracking stays in sync
  let _dequeuedSent: { line: string; bytes: number } | undefined;
  if (raw === 'ok' || raw.startsWith('error:')) {
    _dequeuedSent = state.sentQueue.shift();
    if (_dequeuedSent) {
      state.rxInFlight = Math.max(0, state.rxInFlight - _dequeuedSent.bytes);
    }
    updateBufDisplay();
  }

  if (state.esPhase !== 'idle' && settingsIntercept(raw)) return;

  if (state.ttPhase === 'loading' && toolTableIntercept(raw)) return;

  if (bearIntercept(raw)) return;

  if (raw === 'ok' || raw.startsWith('error:')) {
    if (raw.startsWith('error:')) {
      log('err', raw + (_dequeuedSent ? '  ← "' + _dequeuedSent.line + '"' : ''));
      onSettingWriteErr(raw);
      if (state.running) { state.running = false; updateRunButtons(); log('alarm', 'Stream halted on error. Fix G-code and restart.'); }
    } else {
      if (state.pendingSettingWrite) { onSettingWriteOk(); }
    }
    pumpQueue();
    return;
  }

  if (tryInterceptValue(raw)) { log('rx', raw); return; }

  if (raw.startsWith('[AXS:')) {
    const m = raw.match(/\[AXS:\d+:([A-Z]+)\]/);
    if (m) { state.controllerAxes = m[1].split(''); log('info', 'Axes: ' + state.controllerAxes.join(',')); }
    log('info', raw); return;
  }

  if (raw.startsWith('ALARM:')) {
    log('alarm', raw);
    setMachineState('ALARM');
    emit<StatusReport>('status', new Set(['state']), { machineState: 'ALARM' });
    state.running = false; updateRunButtons();
    return;
  }

  if (raw.startsWith('[OPT:')) {
    const m = raw.match(/\[OPT:[^,]*,(\d+),(\d+)/);
    if (m) {
      const reportedRx = parseInt(m[2]);
      if (reportedRx > 0) {
        state.RX_BUFFER_SIZE = reportedRx;
        log('info', 'RX buffer: ' + state.RX_BUFFER_SIZE + ' bytes  planner blocks: ' + m[1]);
      }
    }
    log('info', raw); return;
  }

  if (raw.startsWith('[SETTING:')) { tryParseSettingLine(raw); return; }

  if (raw.match(/^\$\d+=/)) { tryParseSettingLine(raw); log('rx', raw); return; }

  if (raw.startsWith('[') || raw.startsWith('Grbl') || raw.startsWith('GrblHAL') || raw.startsWith('>')) {
    bearCheckPlugin(raw);
    log('info', raw); return;
  }
  log('rx', raw);
}

function parseStatus(s: string): void {
  const parts = s.split('|');
  const report: StatusReport = { machineState: parts[0] };
  const tags = new Set<string>(['state']);

  setMachineState(parts[0]);
  let hasPn = false;
  for (let i = 1; i < parts.length; i++) {
    const colon = parts[i].indexOf(':');
    if (colon === -1) continue;
    const key = parts[i].slice(0, colon);
    const vals = parts[i].slice(colon + 1).split(',');
    if (key === 'MPos' || key === 'WPos') {
      state.machineX = parseFloat(vals[0]) || 0;
      state.machineY = parseFloat(vals[1]) || 0;
      state.machineZ = parseFloat(vals[2]) || 0;
      report.mpos = { x: state.machineX, y: state.machineY, z: state.machineZ };
      tags.add('mpos');
      toolGroup.position.set(state.machineX, state.machineZ, -state.machineY);
    }
    if (key === 'FS' || key === 'F') {
      report.fs = { feed: vals[0] || '0', spindle: vals[1] || '0' };
      tags.add('fs');
    }
    if (key === 'T') {
      const tn = parseInt(vals[0]);
      if (!isNaN(tn)) {
        report.tool = tn;
        tags.add('tool');
        if (tn !== state.currentToolNumber) {
          state.currentToolNumber = tn;
          if (state.ttEntries.length) renderToolTable();
        }
      }
    }
    if (key === 'Ln') {
      const ln = parseInt(vals[0]);
      report.ln = ln;
      tags.add('ln');
      state.segmentIndex = ln;
      updateExecutedPath(state.segmentIndex);
    }
    if (key === 'Bf') {
      report.bf = { blocks: vals[0], bytes: vals[1] };
      tags.add('bf');
    }
    if (key === 'Ov') {
      const feed = parseInt(vals[0]), rapid = parseInt(vals[1]), spin = parseInt(vals[2]);
      if (!isNaN(feed) && !isNaN(rapid) && !isNaN(spin)) {
        report.ov = { feed, rapid, spindle: spin };
        tags.add('ov');
      }
    }
    if (key === 'Ct') {
      const ct = parseInt(vals[0]);
      if (!isNaN(ct)) {
        report.tool = ct;
        tags.add('tool');
        if (ct !== state.currentToolNumber) {
          state.currentToolNumber = ct;
          if (document.getElementById('tabpanel-tooltable')!.classList.contains('active')) {
            renderToolTable();
          }
          renderModTT();
        }
      }
    }
    if (key === 'WCS') {
      const wcs = vals[0] && vals[0].toUpperCase();
      report.wcs = wcs;
      tags.add('wcs');
    }
    if (key === 'Pn') {
      hasPn = true;
      report.pins = vals[0] || '';
      tags.add('pins');
    }
    if (key === 'BEAR') {
      report.bear = vals[0] || '';
      tags.add('bear');
      bearParseStatus(report.bear);
    }
  }
  if (!hasPn) { report.pins = ''; tags.add('pins'); }

  emit('status', tags, report);

  document.getElementById('vpStats')!.innerHTML =
    `X: ${state.machineX.toFixed(3)}&nbsp;&nbsp;Y: ${state.machineY.toFixed(3)}&nbsp;&nbsp;Z: ${state.machineZ.toFixed(3)}<br>` +
    `RX: ${state.rxInFlight}/${state.RX_BUFFER_SIZE}B&nbsp;&nbsp;QUEUE: ${state.sentQueue.length}`;
}

export function setMachineState(s: string): void {
  const sl = s.toLowerCase().split(':')[0];
  if (sl === 'alarm') { state.machineHomed = false; _updateHomeBtnHomed(); }
  if (sl === 'idle' && state._prevMachineStateSl === 'home') { state.machineHomed = true; _updateHomeBtnHomed(); }
  state._prevMachineStateSl = sl;
}
