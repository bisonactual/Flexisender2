// ═══════════════════════════════════════════════
// Settings engine — dirty tracking & write
// ═══════════════════════════════════════════════

import { state } from './state';
import { log } from './console';
import { cmdSend } from './connection';

export function markDirty(id: number, val: string): void {
  state.settingsDirty[id] = val;
  const row = document.getElementById('srow-' + id);
  if (row) row.classList.add('dirty');
  (document.getElementById('btnWriteAll') as HTMLButtonElement).disabled = false;
}

export function writeSetting(id: number): void {
  if (!state.connected) { log('err', 'Not connected'); return; }
  const val = state.settingsDirty[id] !== undefined ? state.settingsDirty[id] : state.settingsValues[id];
  if (val === undefined) return;
  const btn = document.getElementById('wbtn-' + id);
  if (btn) { btn.className = 'setting-write pending'; btn.textContent = 'WRITING\u2026'; }
  state.pendingSettingWrite = { id, btn };
  cmdSend('$' + id + '=' + val);
  log('tx', '$' + id + '=' + val);
}

export function onSettingWriteOk(): void {
  if (!state.pendingSettingWrite) return;
  const { id, btn } = state.pendingSettingWrite;
  if (state.settingsDirty[id] !== undefined) { state.settingsValues[id] = state.settingsDirty[id]; delete state.settingsDirty[id]; }
  const row = document.getElementById('srow-' + id); if (row) row.classList.remove('dirty');
  if (btn) { btn.className = 'setting-write ok'; btn.textContent = 'SAVED \u2713'; setTimeout(() => { if (btn) { btn.className = 'setting-write'; btn.textContent = 'WRITE $' + id; } }, 2000); }
  state.pendingSettingWrite = null;
}

export function onSettingWriteErr(raw: string): void {
  if (!state.pendingSettingWrite) return;
  const { id, btn } = state.pendingSettingWrite;
  if (btn) { btn.className = 'setting-write err'; btn.textContent = 'ERR: ' + raw.replace('error:', ''); setTimeout(() => { if (btn) { btn.className = 'setting-write'; btn.textContent = 'WRITE $' + id; } }, 3000); }
  state.pendingSettingWrite = null;
}

export function writeAllDirty(): void {
  Object.keys(state.settingsDirty).forEach(id => writeSetting(parseInt(id)));
}

export function tryInterceptValue(raw: string): boolean {
  if (raw.match(/^\$\d+=/) && state.esPhase !== 'values') {
    const eq = raw.indexOf('=');
    state.settingsValues[parseInt(raw.slice(1, eq))] = raw.slice(eq + 1);
    return true;
  }
  return false;
}

export function tryParseSettingLine(raw: string): void {
  // [SETTING:...] or $N=value lines arriving outside load phase
  if (raw.startsWith('[SETTING:')) {
    const p = raw.slice(9, -1).split('|');
    if (p.length >= 2) {
      const id = parseInt(p[0]), groupId = parseInt(p[1]);
      if (state.settingsDefs[id]) {
        state.settingsDefs[id].groupId = groupId;
      }
    }
  } else if (raw.match(/^\$\d+=/)) {
    const eq = raw.indexOf('=');
    state.settingsValues[parseInt(raw.slice(1, eq))] = raw.slice(eq + 1);
  }
}
