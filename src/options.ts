// ═══════════════════════════════════════════════
// Options — connection, colours, tab locks, toolbar
// ═══════════════════════════════════════════════

import { state, OPT_COLOR_DEFAULTS, OPT_COLOR_CSS_VARS, OPT_LOCKABLE_TABS, TB_BTN_DEFAULTS } from './state';
import { lsGet, lsSet } from './ui';
import { log } from './console';
import { rebuildSteps } from './modules/jog';

// ── Connection mode ───────────────────────────────────────────────────────────
export function optSetConnMode(mode: 'websocket' | 'serial'): void {
  if (state.connected) { log('err', 'Disconnect before changing connection type'); return; }
  state.connMode = mode;
  document.body.classList.toggle('conn-serial', mode === 'serial');
  document.body.classList.toggle('conn-websocket', mode === 'websocket');
  document.getElementById('connBtnWs')!.classList.toggle('active', mode === 'websocket');
  document.getElementById('connBtnSerial')!.classList.toggle('active', mode === 'serial');
  document.getElementById('optWsSection')!.style.display = mode === 'websocket' ? '' : 'none';
  document.getElementById('optSerialSection')!.style.display = mode === 'serial' ? '' : 'none';
  document.body.classList.toggle('serial-unsupported', mode === 'serial' && !(navigator as any).serial);
  optSaveConnSettings();
}

export function optSaveConnSettings(): void {
  lsSet('fs-opt-conn', {
    mode: state.connMode,
    wsUrl: (document.getElementById('wsUrl') as HTMLInputElement).value,
    baud: (document.getElementById('optBaudRate') as HTMLSelectElement).value,
    dataBits: (document.getElementById('optDataBits') as HTMLSelectElement).value,
    stopBits: (document.getElementById('optStopBits') as HTMLSelectElement).value,
    parity: (document.getElementById('optParity') as HTMLSelectElement).value,
  });
}

export function optLoadConnSettings(): void {
  try {
    const s = lsGet('fs-opt-conn', {} as any);
    if (s.wsUrl) (document.getElementById('wsUrl') as HTMLInputElement).value = s.wsUrl;
    if (s.baud) (document.getElementById('optBaudRate') as HTMLSelectElement).value = s.baud;
    if (s.dataBits) (document.getElementById('optDataBits') as HTMLSelectElement).value = s.dataBits;
    if (s.stopBits) (document.getElementById('optStopBits') as HTMLSelectElement).value = s.stopBits;
    if (s.parity) (document.getElementById('optParity') as HTMLSelectElement).value = s.parity;
    optSetConnMode(s.mode || 'websocket');
  } catch (_) {
    optSetConnMode('websocket');
  }
}

// ── Colours ───────────────────────────────────────────────────────────────────
function capKey(key: string): string { return key.charAt(0).toUpperCase() + key.slice(1); }

export function optApplyColor(key: string, hex: string): void {
  document.documentElement.style.setProperty(OPT_COLOR_CSS_VARS[key], hex);
  const swatch = document.getElementById('optSwatch' + capKey(key));
  if (swatch) (swatch as HTMLElement).style.background = hex;
  const hexInput = document.getElementById('optHex' + capKey(key)) as HTMLInputElement | null;
  if (hexInput && hexInput !== document.activeElement) hexInput.value = hex;
  optSaveColors();
}

export function optHexChange(key: string, val: string): void {
  if (!/^#[0-9a-fA-F]{6}$/.test(val)) return;
  const picker = document.getElementById('optColor' + capKey(key)) as HTMLInputElement | null;
  if (picker) picker.value = val;
  optApplyColor(key, val);
}

export function optResetColor(key: string): void {
  const def = OPT_COLOR_DEFAULTS[key];
  const ck = capKey(key);
  const picker = document.getElementById('optColor' + ck) as HTMLInputElement | null;
  const hexInp = document.getElementById('optHex' + ck) as HTMLInputElement | null;
  if (picker) picker.value = def;
  if (hexInp) hexInp.value = def;
  optApplyColor(key, def);
}

export function optResetAllColors(): void {
  Object.keys(OPT_COLOR_DEFAULTS).forEach(k => optResetColor(k));
}

function optSaveColors(): void {
  const saved: Record<string, string> = {};
  Object.keys(OPT_COLOR_DEFAULTS).forEach(k => {
    saved[k] = getComputedStyle(document.documentElement).getPropertyValue(OPT_COLOR_CSS_VARS[k]).trim();
  });
  lsSet('fs-opt-colors', saved);
}

export function optLoadColors(): void {
  const saved = lsGet<Record<string, string>>('fs-opt-colors', {});
  Object.keys(OPT_COLOR_DEFAULTS).forEach(k => {
    const hex = saved[k] || OPT_COLOR_DEFAULTS[k];
    const ck = capKey(k);
    const picker = document.getElementById('optColor' + ck) as HTMLInputElement | null;
    const hexInp = document.getElementById('optHex' + ck) as HTMLInputElement | null;
    const swatch = document.getElementById('optSwatch' + ck) as HTMLElement | null;
    if (picker) picker.value = hex;
    if (hexInp) hexInp.value = hex;
    if (swatch) swatch.style.background = hex;
    document.documentElement.style.setProperty(OPT_COLOR_CSS_VARS[k], hex);
  });
}

// ── Tab locks ─────────────────────────────────────────────────────────────────
export function optBuildTabLockList(): void {
  const container = document.getElementById('optTabLockList');
  if (!container) return;
  container.innerHTML = '';
  OPT_LOCKABLE_TABS.forEach(t => {
    const row = document.createElement('div'); row.className = 'opt-tab-lock-item'; row.id = 'optlockrow-' + t.id;
    const name = document.createElement('span'); name.className = 'opt-tab-lock-name'; name.textContent = t.label;
    const status = document.createElement('span'); status.className = 'opt-tab-lock-status'; status.id = 'optlockstatus-' + t.id;
    status.textContent = state._lockedTabs.has(t.id) ? '🔒 LOCKED' : '🔓 UNLOCKED';
    const btn = document.createElement('button');
    btn.className = 'opt-tab-lock-btn' + (state._lockedTabs.has(t.id) ? ' locked' : '');
    btn.id = 'optlockbtn-' + t.id;
    btn.textContent = state._lockedTabs.has(t.id) ? 'Unlock' : 'Lock';
    btn.onclick = () => optToggleTabLock(t.id);
    row.appendChild(name); row.appendChild(status); row.appendChild(btn);
    container.appendChild(row);
  });
}

export function optToggleTabLock(tabId: string): void {
  if (state._lockedTabs.has(tabId)) {
    state._lockedTabs.delete(tabId);
  } else {
    const activeTab = document.querySelector('.tab-btn.active');
    if (activeTab && activeTab.id === 'tab-' + tabId) {
      // switchTab imported dynamically to avoid circular dep
      import('./main').then(m => m.switchTab('options'));
    }
    state._lockedTabs.add(tabId);
  }
  optApplyTabLocks();
  optSaveTabLocks();
  optBuildTabLockList();
}

export function optApplyTabLocks(): void {
  OPT_LOCKABLE_TABS.forEach(t => {
    const btn = document.getElementById('tab-' + t.id);
    if (!btn) return;
    btn.classList.toggle('tab-locked', state._lockedTabs.has(t.id));
  });
}

function optSaveTabLocks(): void {
  lsSet('fs-opt-tablocks', [...state._lockedTabs]);
}

export function optLoadTabLocks(): void {
  state._lockedTabs = new Set(lsGet<string[]>('fs-opt-tablocks', []));
  optApplyTabLocks();
}

// ── Toolbar button visibility ─────────────────────────────────────────────────
export function initToolbarOptions(): void {
  const stored = lsGet<Record<string, boolean>>('fs-tb-btn-opts', {});
  document.querySelectorAll<HTMLLabelElement>('.tb-opt-toggle').forEach(label => {
    const btnId = label.dataset.btn!;
    const cb = label.querySelector('input[type=checkbox]') as HTMLInputElement;
    const visible = (btnId in stored) ? stored[btnId] : (TB_BTN_DEFAULTS[btnId] !== false);
    cb.checked = visible;
    const el = document.getElementById(btnId);
    if (el) el.classList.toggle('tb-item-hidden', !visible);
  });
  _updateRow1MachineSep();
  _updateRow2Visibility();
}

export function saveTbOpt(cb: HTMLInputElement): void {
  const btnId = cb.closest('.tb-opt-toggle')!.getAttribute('data-btn')!;
  const el = document.getElementById(btnId);
  if (el) el.classList.toggle('tb-item-hidden', !cb.checked);
  const stored = lsGet<Record<string, boolean>>('fs-tb-btn-opts', {});
  stored[btnId] = cb.checked;
  lsSet('fs-tb-btn-opts', stored);
  _updateRow1MachineSep();
  _updateRow2Visibility();
}

function _updateRow1MachineSep(): void {
  const anyVisible = ['tbBtn-reset', 'tbBtn-unlock'].some(id => {
    const el = document.getElementById(id);
    return el && !el.classList.contains('tb-item-hidden');
  });
  const sep = document.getElementById('tbSep-row1-machine');
  if (sep) sep.classList.toggle('tb-item-hidden', !anyVisible);
}

function _updateRow2Visibility(): void {
  const runBtns = ['tbBtn-open', 'btnStart', 'btnPause', 'btnStop'];
  const anyRunVis = runBtns.some(id => { const el = document.getElementById(id); return el && !el.classList.contains('tb-item-hidden'); });
  const homeEl = document.getElementById('tbBtn-home');
  const homeVis = homeEl && !homeEl.classList.contains('tb-item-hidden');
  const row2 = document.getElementById('toolbar-row2');
  if (row2) row2.style.display = (anyRunVis || homeVis) ? '' : 'none';
  const openHidden = !document.getElementById('tbBtn-open') || document.getElementById('tbBtn-open')!.classList.contains('tb-item-hidden');
  const runSep = document.getElementById('tbSep-row2-run');
  if (runSep) runSep.classList.toggle('tb-item-hidden', openHidden);
  const homeSep = document.getElementById('tbSep-row2-home');
  if (homeSep) homeSep.classList.toggle('tb-item-hidden', !homeVis);
}

// ── Jog step sizes ────────────────────────────────────────────────────────────
export function optSaveJogSteps(): void {
  lsSet('fs-opt-jogsteps', {
    xy: (document.getElementById('optJogStepsXY') as HTMLInputElement).value,
    z: (document.getElementById('optJogStepsZ') as HTMLInputElement).value,
  });
}

export function optLoadJogSteps(): void {
  const s = lsGet<any>('fs-opt-jogsteps', {});
  if (s.xy) (document.getElementById('optJogStepsXY') as HTMLInputElement).value = s.xy;
  if (s.z) (document.getElementById('optJogStepsZ') as HTMLInputElement).value = s.z;
}

function parseSteps(raw: string): number[] {
  return raw.split(',').map(s => parseFloat(s.trim())).filter(n => !isNaN(n) && n > 0);
}

export function optApplyJogSteps(): void {
  const xySteps = parseSteps((document.getElementById('optJogStepsXY') as HTMLInputElement).value);
  const zSteps = parseSteps((document.getElementById('optJogStepsZ') as HTMLInputElement).value);
  if (xySteps.length === 0 || zSteps.length === 0) return;
  rebuildSteps(xySteps, zSteps);
  optSaveJogSteps();
}

// ── Bear zone colours ─────────────────────────────────────────────────────────
const BEAR_COLOR_IDS = ['optBearColorAll', 'optBearColorGcode', 'optBearColorJog', 'optBearColorTool', 'optBearColorSafe'];

export function optSaveBearColors(): void {
  const c: Record<string, string> = {};
  BEAR_COLOR_IDS.forEach(id => { c[id] = (document.getElementById(id) as HTMLInputElement).value; });
  c['optBearScale'] = (document.getElementById('optBearScale') as HTMLInputElement).value;
  lsSet('fs-opt-bearcolors', c);
}

export function optLoadBearColors(): void {
  const c = lsGet<Record<string, string>>('fs-opt-bearcolors', {});
  BEAR_COLOR_IDS.forEach(id => {
    if (c[id]) {
      const inp = document.getElementById(id) as HTMLInputElement;
      if (inp) { inp.value = c[id]; const swatch = inp.nextElementSibling as HTMLElement; if (swatch) swatch.style.background = c[id]; }
    }
  });
  if (c['optBearScale']) {
    const sl = document.getElementById('optBearScale') as HTMLInputElement;
    const disp = document.getElementById('optBearScaleVal');
    if (sl) sl.value = c['optBearScale'];
    if (disp) disp.textContent = parseFloat(c['optBearScale']).toFixed(3);
  }
}

export function optGetBearScale(): number {
  const el = document.getElementById('optBearScale') as HTMLInputElement | null;
  return el ? parseFloat(el.value) || 0.0875 : 0.0875;
}

export function optGetBearColor(flags: number): string {
  const en = !!(flags & 8);
  if (!en) return '#444444';
  const blocksGcode = !(flags & 1), blocksJog = !(flags & 2), blocksTool = !(flags & 4);
  if (!blocksGcode && !blocksJog && !blocksTool) return (document.getElementById('optBearColorSafe') as HTMLInputElement)?.value || '#22cc66';
  if (blocksGcode && blocksJog && blocksTool) return (document.getElementById('optBearColorAll') as HTMLInputElement)?.value || '#ff2222';
  if (blocksGcode) return (document.getElementById('optBearColorGcode') as HTMLInputElement)?.value || '#ff6600';
  if (blocksJog) return (document.getElementById('optBearColorJog') as HTMLInputElement)?.value || '#ffcc00';
  if (blocksTool) return (document.getElementById('optBearColorTool') as HTMLInputElement)?.value || '#cc44ff';
  return (document.getElementById('optBearColorAll') as HTMLInputElement)?.value || '#ff2222';
}
