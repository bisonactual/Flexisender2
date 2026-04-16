// ═══════════════════════════════════════════════
// Exclusion Zones — tab, module, 3D visualization
// ═══════════════════════════════════════════════

import { state } from './state';
import { log } from './console';
import { sendCmd } from './connection';
import { scene } from './viewport';
import { optGetBearColor, optGetBearScale } from './options';
import { lsGet, lsSet } from './ui';

declare const THREE: any;

export interface EzZone {
  slot: number;
  xmin: number; ymin: number; zmin: number;
  xmax: number; ymax: number; zmax: number;
  flags: number;
}

// ── State ─────────────────────────────────────────────────────────────────────

let _atciDetected = false;
let _ezPluginDetected = false;
let _ezGlobalEnabled = false;
let _insideZone = false;       // firmware says planned pos is in zone
let _ezLoading = false;
let _ezLoadLines: string[] = [];
let _ezZones: EzZone[] = [];
let _tabInited = false;
let _zoneMeshes: any[] = [];
let _zoneSprites: any[] = [];
let _showLabels = true;

export function ezPluginDetected(): boolean { return _ezPluginDetected; }
export function ezZones(): EzZone[] { return _ezZones; }
export function ezGlobalEnabled(): boolean { return _ezGlobalEnabled; }
export function atciDetected(): boolean { return _atciDetected; }

/** Reset plugin-detection flags on disconnect so stale state doesn't persist. */
export function ezResetPluginState(): void {
  _atciDetected = false;
  _ezPluginDetected = false;
  _ezGlobalEnabled = false;
  _ezZones = [];
  _insideZone = false;
  // Clear stale ATCI travel limits so they don't persist across connections
  delete state.settingsValues[130];
  delete state.settingsValues[131];
  delete state.settingsValues[132];
}

// ── Flags ─────────────────────────────────────────────────────────────────────

const FLAG_GCODE = 1, FLAG_JOG = 2, FLAG_TOOLCHG = 4, FLAG_ENABLED = 8;
function flagEnabled(f: number): boolean { return !!(f & FLAG_ENABLED); }
function flagAllowGcode(f: number): boolean { return !!(f & FLAG_GCODE); }
function flagAllowJog(f: number): boolean { return !!(f & FLAG_JOG); }
function flagAllowToolchg(f: number): boolean { return !!(f & FLAG_TOOLCHG); }

function blockedLabel(f: number): string {
  if (!flagEnabled(f)) return '<span style="color:var(--text3)">off</span>';
  const b: string[] = [];
  if (!flagAllowGcode(f))   b.push('<span style="color:var(--red)">GC</span>');
  if (!flagAllowJog(f))     b.push('<span style="color:var(--red)">JOG</span>');
  if (!flagAllowToolchg(f)) b.push('<span style="color:var(--red)">TC</span>');
  return b.length ? b.join(' ') : '<span style="color:var(--green)">ok</span>';
}

// ── DRO-based zone proximity check ───────────────────────────────────────────

function droInsideAnyZone(): boolean {
  const x = state.machineX, y = state.machineY, z = state.machineZ;
  for (const zone of _ezZones) {
    if (!flagEnabled(zone.flags)) continue;
    if (x >= zone.xmin && x <= zone.xmax &&
        y >= zone.ymin && y <= zone.ymax &&
        z >= zone.zmin && z <= zone.zmax) return true;
  }
  return false;
}

/** True if the machine is inside any zone that actually blocks something */
function isInsideBlockingZone(): boolean {
  const x = state.machineX, y = state.machineY, z = state.machineZ;
  for (const zone of _ezZones) {
    if (!flagEnabled(zone.flags)) continue;
    const blocksAnything = !flagAllowGcode(zone.flags) || !flagAllowJog(zone.flags) || !flagAllowToolchg(zone.flags);
    if (!blocksAnything) continue;
    if (x >= zone.xmin && x <= zone.xmax &&
        y >= zone.ymin && y <= zone.ymax &&
        z >= zone.zmin && z <= zone.zmax) return true;
  }
  return false;
}

// ── Plugin detection ──────────────────────────────────────────────────────────

export function ezCheckPlugin(line: string): void {
  if (line.includes('[PLUGIN:Exclusion Zones')) {
    _ezPluginDetected = true;
    log('info', '🔒 Exclusion Zones plugin detected');
    const notice = document.getElementById('ezPluginNotice');
    if (notice) notice.style.display = 'none';
    setTimeout(() => ezRefresh(), 300);
  }
  if (line.includes('[PLUGIN:ATCi') || line.includes('[PLUGIN:ATCI') || line.includes('[PLUGIN:Sienci ATCi')) {
    _atciDetected = true;
    log('info', '🔧 ATCi plugin detected');
    const notice = document.getElementById('ezPluginNotice');
    if (notice) notice.style.display = 'none';
    setTimeout(() => {
      sendCmd('$130'); sendCmd('$131'); sendCmd('$132');
      // Re-render after responses arrive so the ATCI row appears with fresh values
      setTimeout(() => { renderEzTab(); renderEzModule(); }, 600);
    }, 500);
  }
}

// ── Intercept ─────────────────────────────────────────────────────────────────

export function ezIntercept(line: string): boolean {
  if (!_ezPluginDetected) return false;
  if (!_ezLoading && !line.startsWith('[EZ:')) return false;
  if (line.startsWith('[EZ:')) {
    _ezLoading = true; _ezLoadLines = [];
    const m = line.match(/\[EZ:(enabled|disabled),(\d+)/);
    if (m) _ezGlobalEnabled = m[1] === 'enabled';
    _ezLoadLines.push(line); return true;
  }
  if (line.startsWith('[ZONE:') && _ezLoading) { _ezLoadLines.push(line); return true; }
  if (line === 'ok' && _ezLoading) {
    _ezLoading = false;
    parseEzZoneList(_ezLoadLines);
    renderEzTab(); renderEzModule(); rebuildZoneMeshes();
    return false;
  }
  return false;
}

function parseEzZoneList(lines: string[]): void {
  _ezZones = [];
  for (const line of lines) {
    const m = line.match(/\[ZONE:(\d+)\|([^|]+)\|(\d+)\]/);
    if (!m) continue;
    const slot = parseInt(m[1]), coords = m[2].split(',').map(Number), flags = parseInt(m[3]);
    if (coords.length >= 6) _ezZones.push({ slot, flags, xmin: coords[0], ymin: coords[1], zmin: coords[2], xmax: coords[3], ymax: coords[4], zmax: coords[5] });
  }
}

// ── Status parsing ────────────────────────────────────────────────────────────

export function ezParseStatus(field: string): void {
  _ezGlobalEnabled = field.includes('E');
  _insideZone = field.includes('Z');
  let text: string, cls: string;
  if (!_ezGlobalEnabled) {
    text = '🔒 OFF'; cls = 'ez-status-badge';
  } else if (_insideZone) {
    if (isInsideBlockingZone()) {
      text = '🔒 IN ZONE'; cls = 'ez-status-badge in-zone';
    } else {
      text = '🔒 APPROACHING'; cls = 'ez-status-badge in-zone';
    }
  } else {
    text = '🔒 ACTIVE'; cls = 'ez-status-badge active';
  }
  for (const id of ['ezTabStatusBadge', 'ezModStatusBadge']) {
    const el = document.getElementById(id);
    if (el) { el.textContent = text; el.className = cls; }
  }
  const btn = document.getElementById('ezTabToggleBtn');
  if (btn) btn.textContent = _ezGlobalEnabled ? 'DISABLE' : 'ENABLE';
}

// ── Refresh / Toggle ──────────────────────────────────────────────────────────

export function ezRefresh(): void {
  if (!state.connected) { log('err', 'Not connected'); return; }
  if (_ezPluginDetected) { _ezLoading = true; _ezLoadLines = []; sendCmd('$ZONE'); }
  if (_atciDetected) {
    sendCmd('$130'); sendCmd('$131'); sendCmd('$132');
    // Re-render after ATCI setting responses arrive so coordinates update
    setTimeout(() => { renderEzTab(); renderEzModule(); rebuildZoneMeshes(); }, 600);
  }
  renderEzTab(); renderEzModule();
}

export function ezToggle(): void {
  if (!state.connected || !_ezPluginDetected) return;
  sendCmd(_ezGlobalEnabled ? '$EXCLUSION=0' : '$EXCLUSION=1');
  setTimeout(() => ezRefresh(), 200);
}

// ── Show labels toggle ────────────────────────────────────────────────────────

function toggleShowLabels(): void {
  _showLabels = !_showLabels;
  lsSet('fs-ez-show-labels', _showLabels);
  rebuildZoneMeshes();
  // Update toggle button states
  for (const id of ['ezTabLabelToggle', 'ezModLabelToggle']) {
    const el = document.getElementById(id);
    if (el) el.textContent = _showLabels ? 'LABELS ON' : 'LABELS OFF';
  }
}

// ── ATCI ──────────────────────────────────────────────────────────────────────

function getAtciLimits(): { xMax: number; yMax: number; zMax: number } | null {
  if (!_atciDetected) return null;
  const x = parseFloat(state.settingsValues[130]), y = parseFloat(state.settingsValues[131]), z = parseFloat(state.settingsValues[132]);
  if (isNaN(x) && isNaN(y) && isNaN(z)) return null;
  return { xMax: x || 0, yMax: y || 0, zMax: z || 0 };
}

// ── Tab rendering ─────────────────────────────────────────────────────────────

export function renderEzTab(): void {
  const content = document.getElementById('ezTabContent');
  if (!content) return;
  const zones = _ezZones, atci = getAtciLimits();
  if (zones.length === 0 && !atci) {
    content.innerHTML = `<div style="text-align:center;padding:20px;color:var(--text3);font-family:var(--cond);font-size:11px;letter-spacing:1px;text-transform:uppercase">Plugin: ${_ezPluginDetected ? 'EZ' : '—'}${_atciDetected ? ' + ATCi' : ''}<br>No zones — click ↻ REFRESH</div>`;
    return;
  }
  let h = '<table style="width:100%;border-collapse:collapse;font-family:var(--mono);font-size:11px;">';
  h += '<tr style="background:var(--surface2);"><th class="tt-th">#</th><th class="tt-th">X MIN</th><th class="tt-th">Y MIN</th><th class="tt-th">Z MIN</th><th class="tt-th">X MAX</th><th class="tt-th">Y MAX</th><th class="tt-th">Z MAX</th><th class="tt-th">BLOCKS</th><th class="tt-th"></th></tr>';
  if (atci) {
    h += '<tr style="border-bottom:1px solid var(--border);background:rgba(255,140,66,0.06);">';
    h += `<td class="tt-td" style="font-weight:700;color:var(--accent)">ATCI</td>`;
    h += `<td class="tt-td">-${atci.xMax}</td><td class="tt-td">-${atci.yMax}</td><td class="tt-td">-${atci.zMax}</td>`;
    h += `<td class="tt-td">0</td><td class="tt-td">0</td><td class="tt-td">0</td>`;
    h += '<td class="tt-td" style="font-family:var(--cond);font-size:9px;color:var(--text3)">TRAVEL ($130-$132)</td><td class="tt-td"></td></tr>';
  }
  for (const z of zones) {
    const en = flagEnabled(z.flags), sty = en ? '' : 'opacity:0.4;', col = optGetBearColor(z.flags);
    h += `<tr style="${sty}border-bottom:1px solid var(--border);">`;
    h += `<td class="tt-td" style="font-weight:700;color:${col}">${z.slot}</td>`;
    h += `<td class="tt-td">${z.xmin}</td><td class="tt-td">${z.ymin}</td><td class="tt-td">${z.zmin}</td>`;
    h += `<td class="tt-td">${z.xmax}</td><td class="tt-td">${z.ymax}</td><td class="tt-td">${z.zmax}</td>`;
    h += `<td class="tt-td" style="font-family:var(--cond);font-size:9px">${blockedLabel(z.flags)}</td>`;
    h += `<td class="tt-td" style="white-space:nowrap"><button class="dro-axis-btn" data-ez-edit="${z.slot}">✏️</button> <button class="dro-axis-btn" data-ez-delete="${z.slot}" style="color:var(--red)">🗑</button></td></tr>`;
  }
  h += '</table>';
  content.innerHTML = h;
  content.querySelectorAll<HTMLElement>('[data-ez-edit]').forEach(b => b.addEventListener('click', () => ezTabEditZone(parseInt(b.dataset.ezEdit!))));
  content.querySelectorAll<HTMLElement>('[data-ez-delete]').forEach(b => b.addEventListener('click', () => ezDeleteZone(parseInt(b.dataset.ezDelete!))));
}

// ── Module rendering (compact) ────────────────────────────────────────────────

function ensureModFormExists(body: HTMLElement): void {
  if (document.getElementById('ezModEditForm')) return;
  const tw = document.createElement('div'); tw.id = 'ezModTableWrap'; body.appendChild(tw);
  const ad = document.createElement('div'); ad.style.cssText = 'padding:4px 6px;border-top:1px solid var(--border);';
  ad.innerHTML = '<button class="tb-btn success" style="width:100%;font-size:10px;padding:5px" id="ezModAddBtn">+ ADD ZONE</button>';
  body.appendChild(ad);
  const f = document.createElement('div'); f.id = 'ezModEditForm';
  f.style.cssText = 'display:none;padding:6px;border-top:1px solid var(--border);background:var(--surface2);';
  f.innerHTML =
    '<div style="font-family:var(--cond);font-size:9px;letter-spacing:1.5px;color:var(--text3);text-transform:uppercase;margin-bottom:4px" id="ezModFormTitle">NEW ZONE</div>' +
    '<div id="ezModSlotRow" style="display:none"><input id="ezModSlot" type="hidden" value="0"></div>' +
    '<div style="display:flex;flex-direction:column;gap:2px;margin-top:4px;font-family:var(--mono);font-size:10px;">' +
    '<div style="display:flex;align-items:center;gap:4px"><span style="color:var(--text3);width:12px;font-weight:700">X</span><input id="ezModXMin" type="number" step="0.01" value="0" class="limits-safe-input" style="flex:1" placeholder="min"><span style="color:var(--text3)">—</span><input id="ezModXMax" type="number" step="0.01" value="0" class="limits-safe-input" style="flex:1" placeholder="max"></div>' +
    '<div style="display:flex;align-items:center;gap:4px"><span style="color:var(--text3);width:12px;font-weight:700">Y</span><input id="ezModYMin" type="number" step="0.01" value="0" class="limits-safe-input" style="flex:1" placeholder="min"><span style="color:var(--text3)">—</span><input id="ezModYMax" type="number" step="0.01" value="0" class="limits-safe-input" style="flex:1" placeholder="max"></div>' +
    '<div style="display:flex;align-items:center;gap:4px"><span style="color:var(--text3);width:12px;font-weight:700">Z</span><input id="ezModZMin" type="number" step="0.01" value="0" class="limits-safe-input" style="flex:1" placeholder="min"><span style="color:var(--text3)">—</span><input id="ezModZMax" type="number" step="0.01" value="0" class="limits-safe-input" style="flex:1" placeholder="max"></div></div>' +
    '<div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:4px;">' +
    '<label style="display:flex;align-items:center;gap:3px;font-family:var(--cond);font-size:9px;color:var(--text2);cursor:pointer"><input type="checkbox" id="ezModFlagEn" checked> Enabled</label>' +
    '<label style="display:flex;align-items:center;gap:3px;font-family:var(--cond);font-size:9px;color:var(--text2);cursor:pointer"><input type="checkbox" id="ezModFlagGcode"> G-code</label>' +
    '<label style="display:flex;align-items:center;gap:3px;font-family:var(--cond);font-size:9px;color:var(--text2);cursor:pointer"><input type="checkbox" id="ezModFlagJog"> Jog</label>' +
    '<label style="display:flex;align-items:center;gap:3px;font-family:var(--cond);font-size:9px;color:var(--text2);cursor:pointer"><input type="checkbox" id="ezModFlagTool"> Tool Chg</label></div>' +
    '<div style="display:flex;gap:4px;margin-top:4px;">' +
    '<button class="tb-btn primary" style="flex:1;font-size:10px;padding:4px" id="ezModSaveBtn">SAVE</button>' +
    '<button class="tb-btn" style="flex:1;font-size:10px;padding:4px" id="ezModCancelBtn">CANCEL</button></div>';
  body.appendChild(f);
  document.getElementById('ezModAddBtn')!.addEventListener('click', () => ezModShowAddForm());
  document.getElementById('ezModSaveBtn')!.addEventListener('click', () => ezModSaveZone());
  document.getElementById('ezModCancelBtn')!.addEventListener('click', () => ezModCancelEdit());
}

export function renderEzModule(): void {
  const body = document.getElementById('ezModBody');
  if (!body) return;
  const mb = document.getElementById('ezModStatusBadge');
  if (mb) { mb.textContent = _ezPluginDetected ? (_ezGlobalEnabled ? '🔒 ACTIVE' : '🔒 OFF') : '🔒 —'; mb.className = 'ez-status-badge' + (_ezGlobalEnabled ? ' active' : ''); }
  ensureModFormExists(body);
  const tw = document.getElementById('ezModTableWrap');
  if (!tw) return;
  if (_ezZones.length === 0) { tw.innerHTML = '<div style="text-align:center;padding:8px;color:var(--text3);font-family:var(--cond);font-size:10px;letter-spacing:1px;text-transform:uppercase">No zones — ↻</div>'; return; }
  let h = '<table style="width:100%;border-collapse:collapse;font-family:var(--mono);font-size:10px;">';
  h += '<tr style="background:var(--surface2);"><th class="tt-th" style="padding:2px 4px">#</th><th class="tt-th" style="padding:2px 4px">MIN</th><th class="tt-th" style="padding:2px 4px">MAX</th><th class="tt-th" style="padding:2px 4px">BLOCKS</th><th class="tt-th" style="padding:2px 4px"></th></tr>';
  for (const z of _ezZones) {
    const en = flagEnabled(z.flags), sty = en ? '' : 'opacity:0.4;';
    h += `<tr style="${sty}border-bottom:1px solid var(--border);">`;
    h += `<td class="tt-td" style="padding:2px 4px;font-weight:700">${z.slot === 0 ? '<span style="color:var(--accent)">ATCI</span>' : z.slot}</td>`;
    h += `<td class="tt-td" style="padding:2px 4px;font-size:9px">${z.xmin},${z.ymin},${z.zmin}</td>`;
    h += `<td class="tt-td" style="padding:2px 4px;font-size:9px">${z.xmax},${z.ymax},${z.zmax}</td>`;
    h += `<td class="tt-td" style="padding:2px 4px;font-size:9px">${blockedLabel(z.flags)}</td>`;
    h += `<td class="tt-td" style="padding:2px 4px;white-space:nowrap"><button class="dro-axis-btn" style="font-size:10px;padding:1px 4px" data-ezmod-edit="${z.slot}">✏️</button> <button class="dro-axis-btn" style="font-size:10px;padding:1px 4px" data-ezmod-delete="${z.slot}">🗑</button></td></tr>`;
  }
  h += '</table>';
  tw.innerHTML = h;
  tw.querySelectorAll<HTMLElement>('[data-ezmod-edit]').forEach(b => b.addEventListener('click', () => ezModEditZone(parseInt(b.dataset.ezmodEdit!))));
  tw.querySelectorAll<HTMLElement>('[data-ezmod-delete]').forEach(b => b.addEventListener('click', () => ezDeleteZone(parseInt(b.dataset.ezmodDelete!))));
}

// ── Module form helpers ───────────────────────────────────────────────────────

function populateModForm(zone?: EzZone): void {
  const form = document.getElementById('ezModEditForm'); if (!form) return; form.style.display = '';
  const slotRow = document.getElementById('ezModSlotRow');
  if (zone) {
    (document.getElementById('ezModFormTitle') as HTMLElement).textContent = 'EDIT ZONE ' + zone.slot;
    (document.getElementById('ezModSlot') as HTMLInputElement).value = String(zone.slot);
    if (slotRow) slotRow.style.display = 'none';
    (document.getElementById('ezModXMin') as HTMLInputElement).value = String(zone.xmin);
    (document.getElementById('ezModYMin') as HTMLInputElement).value = String(zone.ymin);
    (document.getElementById('ezModZMin') as HTMLInputElement).value = String(zone.zmin);
    (document.getElementById('ezModXMax') as HTMLInputElement).value = String(zone.xmax);
    (document.getElementById('ezModYMax') as HTMLInputElement).value = String(zone.ymax);
    (document.getElementById('ezModZMax') as HTMLInputElement).value = String(zone.zmax);
    (document.getElementById('ezModFlagEn') as HTMLInputElement).checked = flagEnabled(zone.flags);
    (document.getElementById('ezModFlagGcode') as HTMLInputElement).checked = flagAllowGcode(zone.flags);
    (document.getElementById('ezModFlagJog') as HTMLInputElement).checked = flagAllowJog(zone.flags);
    (document.getElementById('ezModFlagTool') as HTMLInputElement).checked = flagAllowToolchg(zone.flags);
  } else {
    const used = new Set(_ezZones.map(z => z.slot)); let slot = 1; while (used.has(slot) && slot < 16) slot++;
    (document.getElementById('ezModFormTitle') as HTMLElement).textContent = 'NEW ZONE';
    (document.getElementById('ezModSlot') as HTMLInputElement).value = String(slot);
    if (slotRow) slotRow.style.display = 'none';
    for (const id of ['ezModXMin','ezModYMin','ezModZMin','ezModXMax','ezModYMax','ezModZMax']) (document.getElementById(id) as HTMLInputElement).value = '0';
    (document.getElementById('ezModFlagEn') as HTMLInputElement).checked = true;
    (document.getElementById('ezModFlagGcode') as HTMLInputElement).checked = false;
    (document.getElementById('ezModFlagJog') as HTMLInputElement).checked = false;
    (document.getElementById('ezModFlagTool') as HTMLInputElement).checked = false;
  }
}
function ezModShowAddForm(): void { populateModForm(); }
function ezModEditZone(slot: number): void { const z = _ezZones.find(z => z.slot === slot); if (z) populateModForm(z); }
function ezModSaveZone(): void {
  const g = (id: string) => (document.getElementById(id) as HTMLInputElement);
  const slot = parseInt(g('ezModSlot').value), xmin = parseFloat(g('ezModXMin').value), ymin = parseFloat(g('ezModYMin').value), zmin = parseFloat(g('ezModZMin').value);
  const xmax = parseFloat(g('ezModXMax').value), ymax = parseFloat(g('ezModYMax').value), zmax = parseFloat(g('ezModZMax').value);
  let flags = 0;
  if (g('ezModFlagEn').checked) flags |= FLAG_ENABLED; if (g('ezModFlagGcode').checked) flags |= FLAG_GCODE;
  if (g('ezModFlagJog').checked) flags |= FLAG_JOG; if (g('ezModFlagTool').checked) flags |= FLAG_TOOLCHG;
  if (isNaN(slot) || slot < 0 || slot > 15) { log('err', 'Slot must be 0-15'); return; }
  sendCmd(`$ZONE=${slot},${xmin},${ymin},${zmin},${xmax},${ymax},${zmax},${flags}`);
  setTimeout(() => ezRefresh(), 200);
}
function ezModCancelEdit(): void { const f = document.getElementById('ezModEditForm'); if (f) f.style.display = 'none'; }

// ── Tab form helpers ──────────────────────────────────────────────────────────

function ezTabEditZone(slot: number): void { const z = _ezZones.find(z => z.slot === slot); if (z) populateTabForm(z); }
function ezDeleteZone(slot: number): void { sendCmd('$ZONE-' + slot); setTimeout(() => ezRefresh(), 200); }

function populateTabForm(zone?: EzZone): void {
  const form = document.getElementById('ezTabEditForm'); if (!form) return; form.style.display = '';
  const slotRow = document.getElementById('ezTabSlotRow');
  if (zone) {
    (document.getElementById('ezTabFormTitle') as HTMLElement).textContent = 'EDIT ZONE ' + zone.slot;
    (document.getElementById('ezTabSlot') as HTMLInputElement).value = String(zone.slot);
    if (slotRow) slotRow.style.display = 'none';
    (document.getElementById('ezTabXMin') as HTMLInputElement).value = String(zone.xmin);
    (document.getElementById('ezTabYMin') as HTMLInputElement).value = String(zone.ymin);
    (document.getElementById('ezTabZMin') as HTMLInputElement).value = String(zone.zmin);
    (document.getElementById('ezTabXMax') as HTMLInputElement).value = String(zone.xmax);
    (document.getElementById('ezTabYMax') as HTMLInputElement).value = String(zone.ymax);
    (document.getElementById('ezTabZMax') as HTMLInputElement).value = String(zone.zmax);
    (document.getElementById('ezTabFlagEn') as HTMLInputElement).checked = flagEnabled(zone.flags);
    (document.getElementById('ezTabFlagGcode') as HTMLInputElement).checked = flagAllowGcode(zone.flags);
    (document.getElementById('ezTabFlagJog') as HTMLInputElement).checked = flagAllowJog(zone.flags);
    (document.getElementById('ezTabFlagTool') as HTMLInputElement).checked = flagAllowToolchg(zone.flags);
  } else {
    const used = new Set(_ezZones.map(z => z.slot)); let slot = 1; while (used.has(slot) && slot < 16) slot++;
    (document.getElementById('ezTabFormTitle') as HTMLElement).textContent = 'NEW ZONE';
    (document.getElementById('ezTabSlot') as HTMLInputElement).value = String(slot);
    if (slotRow) slotRow.style.display = 'none';
    for (const id of ['ezTabXMin','ezTabYMin','ezTabZMin','ezTabXMax','ezTabYMax','ezTabZMax']) (document.getElementById(id) as HTMLInputElement).value = '0';
    (document.getElementById('ezTabFlagEn') as HTMLInputElement).checked = true;
    (document.getElementById('ezTabFlagGcode') as HTMLInputElement).checked = false;
    (document.getElementById('ezTabFlagJog') as HTMLInputElement).checked = false;
    (document.getElementById('ezTabFlagTool') as HTMLInputElement).checked = false;
  }
}
export function ezShowAddForm(): void { populateTabForm(); }
export function ezSaveZone(): void {
  const g = (id: string) => (document.getElementById(id) as HTMLInputElement);
  const slot = parseInt(g('ezTabSlot').value), xmin = parseFloat(g('ezTabXMin').value), ymin = parseFloat(g('ezTabYMin').value), zmin = parseFloat(g('ezTabZMin').value);
  const xmax = parseFloat(g('ezTabXMax').value), ymax = parseFloat(g('ezTabYMax').value), zmax = parseFloat(g('ezTabZMax').value);
  let flags = 0;
  if (g('ezTabFlagEn').checked) flags |= FLAG_ENABLED; if (g('ezTabFlagGcode').checked) flags |= FLAG_GCODE;
  if (g('ezTabFlagJog').checked) flags |= FLAG_JOG; if (g('ezTabFlagTool').checked) flags |= FLAG_TOOLCHG;
  if (isNaN(slot) || slot < 0 || slot > 15) { log('err', 'Slot must be 0-15'); return; }
  sendCmd(`$ZONE=${slot},${xmin},${ymin},${zmin},${xmax},${ymax},${zmax},${flags}`);
  setTimeout(() => ezRefresh(), 200);
}
export function ezCancelEdit(): void { const f = document.getElementById('ezTabEditForm'); if (f) f.style.display = 'none'; }

// ── 3D zone visualization ─────────────────────────────────────────────────────

export function rebuildZoneMeshes(): void {
  for (const m of _zoneMeshes) { scene.remove(m); if (m.geometry) m.geometry.dispose(); if (m.material) m.material.dispose(); }
  _zoneMeshes = []; _zoneSprites = [];

  for (const z of _ezZones) {
    if (!flagEnabled(z.flags)) continue;
    const sx = z.xmax - z.xmin, sy = z.zmax - z.zmin, sz = z.ymax - z.ymin;
    const cx = z.xmin + sx / 2, cy = z.zmin + sy / 2, cz = -(z.ymin + sz / 2);
    const zoneColor = new THREE.Color(optGetBearColor(z.flags));

    // Wireframe
    const geo = new THREE.BoxGeometry(sx, sy, sz);
    const edges = new THREE.EdgesGeometry(geo);
    const line = new THREE.LineSegments(edges, new THREE.LineBasicMaterial({ color: zoneColor, transparent: true, opacity: 0.7 }));
    line.position.set(cx, cy, cz); scene.add(line); _zoneMeshes.push(line);

    // Fill
    const fill = new THREE.Mesh(geo.clone(), new THREE.MeshBasicMaterial({ color: zoneColor, transparent: true, opacity: 0.08, side: THREE.DoubleSide }));
    fill.position.set(cx, cy, cz); scene.add(fill); _zoneMeshes.push(fill);

    // Sprite label (only if labels enabled)
    if (_showLabels) {
      const blocked: string[] = [];
      if (!flagAllowGcode(z.flags)) blocked.push('GCODE');
      if (!flagAllowJog(z.flags)) blocked.push('JOG');
      if (!flagAllowToolchg(z.flags)) blocked.push('TOOLCHANGE');
      const label = blocked.length ? blocked.join('  ') : 'ALL OK';
      const canvas = document.createElement('canvas'); canvas.width = 512; canvas.height = 128;
      const ctx = canvas.getContext('2d')!;
      ctx.fillStyle = '#000'; ctx.globalAlpha = 0.5; ctx.fillRect(0, 0, 512, 128); ctx.globalAlpha = 1;
      ctx.font = 'bold 36px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillStyle = blocked.length ? '#ff4444' : '#44ff88';
      ctx.fillText(label, 256, 64);
      const tex = new THREE.CanvasTexture(canvas);
      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true }));
      sprite.position.set(cx, z.zmax + 3, cz); scene.add(sprite); _zoneMeshes.push(sprite); _zoneSprites.push(sprite);
    }
  }
}

export function ezClearViz(): void {
  for (const m of _zoneMeshes) { scene.remove(m); if (m.geometry) m.geometry.dispose(); if (m.material) m.material.dispose(); }
  _zoneMeshes = []; _zoneSprites = [];
}

export function ezUpdateSpriteScales(_radius: number): void {
  // Fixed world-space size — sprites naturally grow when camera zooms in
  for (const sp of _zoneSprites) sp.scale.set(30, 7.5, 1);
}

// ── Init ──────────────────────────────────────────────────────────────────────

export function initExclusionZonesTab(): void {
  if (_tabInited) return; _tabInited = true;
  _showLabels = lsGet('fs-ez-show-labels', true);

  const on = (id: string, fn: () => void) => { const el = document.getElementById(id); if (el) el.addEventListener('click', fn); };
  on('ezTabRefreshBtn', () => ezRefresh());
  on('ezTabToggleBtn', () => ezToggle());
  on('ezTabAddBtn', () => ezShowAddForm());
  on('ezTabSaveBtn', () => ezSaveZone());
  on('ezTabCancelBtn', () => ezCancelEdit());
  on('ezModRefreshBtn', () => ezRefresh());
  on('ezTabLabelToggle', () => toggleShowLabels());
  on('ezModLabelToggle', () => toggleShowLabels());

  // Set initial label toggle text
  for (const id of ['ezTabLabelToggle', 'ezModLabelToggle']) {
    const el = document.getElementById(id);
    if (el) el.textContent = _showLabels ? 'LABELS ON' : 'LABELS OFF';
  }
}
