// ═══════════════════════════════════════════════
// Tool length probe module UI
// ═══════════════════════════════════════════════

import { h } from '../jsx';
import { state } from '../state';
import { sendCmd } from '../connection';
import { log } from '../console';
import { lsGet, lsSet } from '../ui';
import { isProbingRunning, runToolLengthProbe, cancelProbing } from './probe-program';
import { waypointsTouchplate, waypointsToolsetter } from './preview';

const DEFAULTS = {
  mode: 'touchplate' as string,
  probeFeedRate: 100,
  latchFeedRate: 25,
  probeDistance: 50,
  latchDistance: 1,
  touchPlateHeight: 0,
  toolsetterDepth: 10,
  tloReference: null as number | null,
};

let _cfg = loadConfig();
let _statusEl: HTMLElement | null = null;
let _probeBtn: HTMLButtonElement;
let _cancelBtn: HTMLButtonElement;
let _setRefBtn: HTMLButtonElement;
let _clearRefBtn: HTMLButtonElement;
let _refDisplay: HTMLElement | null = null;
let _resultDisplay: HTMLElement | null = null;
let _modeTouch: HTMLInputElement;
let _modeToolsetter: HTMLInputElement;
let _touchPlateSection: HTMLElement | null = null;
let _toolsetterSection: HTMLElement | null = null;

function loadConfig() {
  return { ...DEFAULTS, ...lsGet('fs-tl-config', {}) };
}

function saveConfig(cfg: typeof DEFAULTS): void {
  lsSet('fs-tl-config', cfg);
}

function getNumVal(id: string): number {
  return parseFloat((document.getElementById(id) as HTMLInputElement)?.value || '0') || 0;
}

function setStatus(msg: string, type = 'idle'): void {
  if (!_statusEl) return;
  _statusEl.textContent = msg;
  _statusEl.className = 'tl-status tl-status-' + type;
}

function updateModeUI(): void {
  const isToolsetter = _cfg.mode === 'toolsetter';
  if (_touchPlateSection) _touchPlateSection.style.display = isToolsetter ? 'none' : '';
  if (_toolsetterSection) _toolsetterSection.style.display = isToolsetter ? '' : 'none';
}

function updateRefDisplay(): void {
  if (!_refDisplay) return;
  if (_cfg.tloReference !== null) {
    _refDisplay.textContent = 'Ref: ' + _cfg.tloReference.toFixed(4) + ' mm';
    _refDisplay.style.color = 'var(--green)';
    if (_clearRefBtn) _clearRefBtn.style.display = '';
  } else {
    _refDisplay.textContent = 'No reference set';
    _refDisplay.style.color = 'var(--text3)';
    if (_clearRefBtn) _clearRefBtn.style.display = 'none';
  }
}

async function doProbe(): Promise<void> {
  if (!state.connected) { log('err', 'Not connected'); return; }
  if (isProbingRunning()) return;
  _cfg.probeFeedRate = getNumVal('tlProbeFeed');
  _cfg.latchFeedRate = getNumVal('tlLatchFeed');
  _cfg.probeDistance = getNumVal('tlProbeDistance');
  _cfg.latchDistance = getNumVal('tlLatchDistance');
  _cfg.touchPlateHeight = getNumVal('tlPlateHeight');
  _cfg.toolsetterDepth = getNumVal('tlToolsetterDepth');
  saveConfig(_cfg);

  let tsX: number | undefined, tsY: number | undefined, tsZ: number | undefined;
  if (_cfg.mode === 'toolsetter') {
    const ts = (state as any).wcsOffsets['G59.3'];
    if (!ts) {
      log('err', 'Toolsetter: G59.3 not set — go to the Offsets tab and set it first');
      setStatus('G59.3 not set', 'err');
      return;
    }
    tsX = ts.x; tsY = ts.y; tsZ = ts.z;
  }

  _probeBtn.disabled = true;
  _cancelBtn.disabled = false;
  setStatus('Probing…', 'running');
  if (_resultDisplay) _resultDisplay.textContent = '';

  const result = await runToolLengthProbe({
    mode: _cfg.mode,
    probeFeedRate: _cfg.probeFeedRate,
    latchFeedRate: _cfg.latchFeedRate,
    probeDistance: _cfg.probeDistance,
    latchDistance: _cfg.latchDistance,
    touchPlateHeight: _cfg.touchPlateHeight,
    toolsetterX: tsX,
    toolsetterY: tsY,
    toolsetterZ: tsZ,
    toolsetterDepth: _cfg.toolsetterDepth,
    tloReference: _cfg.tloReference,
  });

  _probeBtn.disabled = false;
  _cancelBtn.disabled = true;
  if (!result || !result.success) { setStatus('Probe failed', 'err'); return; }

  let tlo: number;
  if (_cfg.mode === 'touchplate') {
    tlo = result.z;
    if (_cfg.tloReference !== null) {
      tlo = result.z - _cfg.tloReference - _cfg.touchPlateHeight;
    } else {
      tlo = result.z - _cfg.touchPlateHeight;
    }
  } else {
    tlo = result.z;
    if (_cfg.tloReference !== null) {
      tlo = result.z - _cfg.tloReference;
    }
  }

  sendCmd(`G43.1Z${tlo.toFixed(4)}`);
  log('info', `Tool length offset applied: G43.1 Z${tlo.toFixed(4)}`);
  if (_resultDisplay) _resultDisplay.textContent = `Z=${result.z.toFixed(4)}  TLO=${tlo.toFixed(4)} mm`;
  setStatus('✓ Complete — TLO applied', 'ok');
  setTimeout(() => {
    import('../offsets').then((o) => o.loadOffsets());
  }, 300);
}

export function mount(parent: HTMLElement): void {
  _cfg = loadConfig();
  const card = h('div', { class: 'module-card mod-hidden', id: 'mod-toollength', dataset: { modSize: 'normal' }, style: 'top:10px;left:886px' },
    h('div', { class: 'module-drag-handle' },
      h('span', { class: 'module-drag-dots' }, '⠿⠿'),
      h('span', { class: 'module-drag-title' }, 'Tool Length'),
      h('button', { class: 'module-drag-close', onClick: () => { card.classList.add('mod-hidden'); } }, '✕')),
    h('div', { class: 'module-body', style: 'gap:8px' },
      h('div', { class: 'tl-section' },
        h('div', { class: 'tl-section-label' }, 'Mode'),
        h('div', { style: 'display:flex;gap:6px;' },
          h('label', { class: 'tl-mode-btn' },
            h('input', { type: 'radio', name: 'tlMode', value: 'touchplate', checked: true,
              ref: (el: HTMLInputElement) => { _modeTouch = el; },
              onChange: () => { _cfg.mode = 'touchplate'; saveConfig(_cfg); updateModeUI(); } }),
            'Touch Plate'),
          h('label', { class: 'tl-mode-btn' },
            h('input', { type: 'radio', name: 'tlMode', value: 'toolsetter',
              ref: (el: HTMLInputElement) => { _modeToolsetter = el; },
              onChange: () => { _cfg.mode = 'toolsetter'; saveConfig(_cfg); updateModeUI(); } }),
            'Toolsetter'))),
      h('div', { class: 'tl-section' },
        h('div', { class: 'tl-section-label' }, 'Feed Rates'),
        h('div', { class: 'tl-row' },
          h('span', { class: 'tl-label' }, 'Probe (mm/min)'),
          h('input', { type: 'number', class: 'tl-input', id: 'tlProbeFeed', value: String(_cfg.probeFeedRate), min: '1', step: '10' })),
        h('div', { class: 'tl-row' },
          h('span', { class: 'tl-label' }, 'Latch (mm/min)'),
          h('input', { type: 'number', class: 'tl-input', id: 'tlLatchFeed', value: String(_cfg.latchFeedRate), min: '1', step: '5' })),
        h('div', { class: 'tl-row' },
          h('span', { class: 'tl-label' }, 'Probe distance (mm)'),
          h('input', { type: 'number', class: 'tl-input', id: 'tlProbeDistance', value: String(_cfg.probeDistance), min: '1', step: '5' })),
        h('div', { class: 'tl-row' },
          h('span', { class: 'tl-label' }, 'Latch distance (mm)'),
          h('input', { type: 'number', class: 'tl-input', id: 'tlLatchDistance', value: String(_cfg.latchDistance), min: '0.1', step: '0.1' }))),
      h('div', { class: 'tl-section', id: 'tlTouchPlateSection', ref: (el: HTMLElement) => { _touchPlateSection = el; } },
        h('div', { class: 'tl-section-label' }, 'Touch Plate'),
        h('div', { class: 'tl-row' },
          h('span', { class: 'tl-label' }, 'Plate height (mm)'),
          h('input', { type: 'number', class: 'tl-input', id: 'tlPlateHeight', value: String(_cfg.touchPlateHeight), min: '0', step: '0.1' }))),
      h('div', { class: 'tl-section', id: 'tlToolsetterSection', style: 'display:none', ref: (el: HTMLElement) => { _toolsetterSection = el; } },
        h('div', { class: 'tl-section-label' }, 'Toolsetter'),
        h('div', { class: 'tl-row' },
          h('span', { class: 'tl-label' }, 'Approach depth (mm)'),
          h('input', { type: 'number', class: 'tl-input', id: 'tlToolsetterDepth', value: String(_cfg.toolsetterDepth), min: '1', step: '1' })),
        h('div', { style: 'font-family:var(--mono);font-size:10px;color:var(--text3);margin-top:2px;' }, 'XY+Z position from G59.3 in Offsets tab')),
      h('div', { class: 'tl-section' },
        h('div', { class: 'tl-section-label' }, 'Reference Tool'),
        h('div', { class: 'tl-ref-display', ref: (el: HTMLElement) => { _refDisplay = el; } }, 'No reference set'),
        h('div', { style: 'display:flex;gap:5px;margin-top:5px;' },
          h('button', { class: 'tb-btn', style: 'flex:1;font-size:10px;padding:5px',
            ref: (el: HTMLButtonElement) => { _setRefBtn = el; },
            onClick: async () => {
              if (!state.connected) { log('err', 'Not connected'); return; }
              if (isProbingRunning()) return;
              _probeBtn.disabled = true;
              _cancelBtn.disabled = false;
              setStatus('Measuring reference…', 'running');
              const r = await runToolLengthProbe({
                mode: _cfg.mode,
                probeFeedRate: _cfg.probeFeedRate, latchFeedRate: _cfg.latchFeedRate,
                probeDistance: _cfg.probeDistance, latchDistance: _cfg.latchDistance,
                touchPlateHeight: _cfg.touchPlateHeight,
                toolsetterX: (state as any).wcsOffsets['G59.3']?.x,
                toolsetterY: (state as any).wcsOffsets['G59.3']?.y,
                toolsetterZ: (state as any).wcsOffsets['G59.3']?.z,
                toolsetterDepth: _cfg.toolsetterDepth,
              });
              _probeBtn.disabled = false;
              _cancelBtn.disabled = true;
              if (r && r.success) {
                _cfg.tloReference = r.z;
                saveConfig(_cfg);
                updateRefDisplay();
                sendCmd('G49');
                setStatus('✓ Reference set — probe subsequent tools with PROBE', 'ok');
                log('info', `TLO reference set: Z=${r.z.toFixed(4)}`);
              } else {
                setStatus('Reference probe failed', 'err');
              }
            } }, 'SET REF'),
          h('button', { class: 'tb-btn danger', style: 'font-size:10px;padding:5px;display:none',
            ref: (el: HTMLButtonElement) => { _clearRefBtn = el; },
            onClick: () => {
              _cfg.tloReference = null;
              saveConfig(_cfg);
              updateRefDisplay();
              sendCmd('G49');
              setStatus('Reference cleared', 'idle');
            } }, 'CLEAR'))),
      h('div', { class: 'tl-status tl-status-idle', ref: (el: HTMLElement) => { _statusEl = el; } }, 'Ready'),
      h('div', { class: 'tl-result', ref: (el: HTMLElement) => { _resultDisplay = el; } }),
      h('div', { style: 'display:flex;gap:6px;' },
        h('button', { class: 'tb-btn', style: 'padding:10px;font-size:11px', id: 'tlPreviewBtn' }, '◈ PREVIEW'),
        h('button', { class: 'tb-btn success', style: 'flex:1;padding:10px;font-size:13px',
          ref: (el: HTMLButtonElement) => { _probeBtn = el; },
          onClick: () => doProbe() }, '⊕ PROBE'),
        h('button', { class: 'tb-btn danger', style: 'padding:10px;font-size:13px', disabled: true,
          ref: (el: HTMLButtonElement) => { _cancelBtn = el; },
          onClick: () => { cancelProbing(); setStatus('Cancelled', 'idle'); } }, '✕'))));

  parent.appendChild(card);
  if (_cfg.mode === 'toolsetter' && _modeToolsetter) {
    _modeToolsetter.checked = true;
    updateModeUI();
  }
  updateRefDisplay();

  document.getElementById('tlPreviewBtn')?.addEventListener('click', () => {
    const mode = _cfg.mode;
    if (mode === 'toolsetter') {
      const ts = (state as any).wcsOffsets['G59.3'] || { x: 50, y: 50, z: -20 };
      (window as any).loadPreview3D?.(waypointsToolsetter({
        probeDistance: _cfg.probeDistance, latchDistance: _cfg.latchDistance,
        toolsetterDepth: _cfg.toolsetterDepth,
        tsOffX: ts.x - (state as any).machineX,
        tsOffY: ts.y - (state as any).machineY,
        tsOffZ: ts.z - (state as any).machineZ,
      }));
    } else {
      (window as any).loadPreview3D?.(waypointsTouchplate({
        probeDistance: _cfg.probeDistance, latchDistance: _cfg.latchDistance,
        touchPlateHeight: _cfg.touchPlateHeight,
      }));
    }
  });
}
