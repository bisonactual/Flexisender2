// ═══════════════════════════════════════════════
// Settings engine — load sequence & intercept
// ═══════════════════════════════════════════════

import { state, DTYPE_MAP } from './state';
import { log } from './console';
import { cmdSend } from './connection';
import { renderSettingsUI } from './settings-render';

export function loadSettings(): void {
  if (!state.connected) { log('info', 'Connect first'); return; }
  state.settingsGroups = {};
  state.settingsDefs = {};
  state.settingsValues = {};
  state.settingsDirty = {};
  state.activeGroupId = null;
  state.settingsLoaded = false;
  document.getElementById('settingsStatus')!.textContent = 'Reading groups\u2026';
  document.getElementById('settingsGroups')!.innerHTML =
    '<div class="settings-placeholder" style="height:200px"><div class="settings-placeholder-icon">\u21bb</div><div>Loading\u2026</div></div>';
  document.getElementById('settingsContent')!.innerHTML = '';
  state.esPhase = 'groups';
  state.esPendingOks = 1;
  cmdSend('$EG');
}

export function settingsIntercept(raw: string): boolean {
  if (state.esPhase === 'idle') return false;

  // Group definition
  if (raw.startsWith('[SETTINGGROUP:')) {
    const p = raw.slice(14, -1).split('|');
    if (p.length >= 3) {
      const id = parseInt(p[0]), parentId = parseInt(p[1]), name = p[2];
      state.settingsGroups[id] = { id, parentId, name };
    }
    return true;
  }

  // $ESH tab-separated setting line
  if (state.esPhase === 'defs' && raw.match(/^\d+\t/)) {
    const p = raw.split('\t');
    if (p.length >= 4) {
      const id = parseInt(p[0]);
      const name = p[1] || ('$' + id);
      const unit = p[2] || '';
      const dtypeStr = (p[3] || 'string').toLowerCase();
      const fmt = p[4] || '';
      const description = p[5] || '';
      const minV = p[6] || '';
      const maxV = p[7] || '';
      const dtype = DTYPE_MAP[dtypeStr] !== undefined ? DTYPE_MAP[dtypeStr] : 7;
      const formatLabels = (dtype >= 1 && dtype <= 3 && fmt) ? fmt.split(',') : [];
      state.settingsDefs[id] = { id, groupId: 0, name, unit, dtype, dtypeStr, fmt, formatLabels, description, minV, maxV, reboot: false, nullOk: false };
    }
    return true;
  }

  // $ES pipe-separated setting line (for group_id)
  if (state.esPhase === 'defs' && raw.startsWith('[SETTING:')) {
    const p = raw.slice(9, -1).split('|');
    if (p.length >= 2) {
      const id = parseInt(p[0]), groupId = parseInt(p[1]);
      const reboot = p[8] === '1', nullOk = p[9] === '1';
      if (state.settingsDefs[id]) {
        state.settingsDefs[id].groupId = groupId;
        state.settingsDefs[id].reboot = reboot;
        state.settingsDefs[id].nullOk = nullOk;
      } else {
        const name = p[2] || ('$' + id), unit = p[3] || '';
        const dtype = parseInt(p[4]) || 7;
        const fmt = p[5] || '', minV = p[6] || '', maxV = p[7] || '';
        const formatLabels = (dtype >= 1 && dtype <= 3 && fmt) ? fmt.split(',') : [];
        state.settingsDefs[id] = { id, groupId, name, unit, dtype, dtypeStr: '', fmt, formatLabels, description: '', minV, maxV, reboot, nullOk };
      }
    }
    return true;
  }

  // Current value from $$
  if (state.esPhase === 'values' && raw.match(/^\$\d+=/)) {
    const eq = raw.indexOf('=');
    state.settingsValues[parseInt(raw.slice(1, eq))] = raw.slice(eq + 1);
    return true;
  }

  // ok — advance phases
  if (raw === 'ok') {
    if (state.running) return false;
    state.esPendingOks--;
    if (state.esPendingOks > 0) return true;

    if (state.esPhase === 'groups') {
      state.esPhase = 'defs';
      state.esPendingOks = 2;
      document.getElementById('settingsStatus')!.textContent = 'Reading setting definitions\u2026';
      cmdSend('$ESH');
      cmdSend('$ES');
      return true;
    }
    if (state.esPhase === 'defs') {
      state.esPhase = 'values';
      state.esPendingOks = 1;
      document.getElementById('settingsStatus')!.textContent = 'Reading current values\u2026';
      cmdSend('$$');
      return true;
    }
    if (state.esPhase === 'values') {
      state.esPhase = 'done';
      state.settingsLoaded = true;
      renderSettingsUI();
      return true;
    }
  }

  return false;
}
