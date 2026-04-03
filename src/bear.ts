// ═══════════════════════════════════════════════
// MR BEAR DO NOT TOUCH — zone management
// ═══════════════════════════════════════════════

import { state } from './state';
import { log } from './console';
import { sendCmd } from './connection';
import { scene } from './viewport';
import { optGetBearColor, optGetBearScale } from './options';

declare const THREE: any;

// ── Data ──────────────────────────────────────────────────────────────────────

export interface BearZone {
  slot: number;
  xmin: number; ymin: number; zmin: number;
  xmax: number; ymax: number; zmax: number;
  flags: number;
}

let _zones: BearZone[] = [];
let _pluginDetected = false;
let _globalEnabled = false;
let _insideZone = false;
let _loading = false;
let _loadLines: string[] = [];
let _zoneMeshes: any[] = [];
let _zoneSprites: any[] = [];

export function bearZones(): BearZone[] { return _zones; }
export function bearDetected(): boolean { return _pluginDetected; }

// ── Flag helpers ──────────────────────────────────────────────────────────────

const FLAG_GCODE   = 1;
const FLAG_JOG     = 2;
const FLAG_TOOLCHG = 4;
const FLAG_ENABLED = 8;

function flagEnabled(f: number): boolean { return !!(f & FLAG_ENABLED); }
function flagAllowGcode(f: number): boolean { return !!(f & FLAG_GCODE); }
function flagAllowJog(f: number): boolean { return !!(f & FLAG_JOG); }
function flagAllowToolchg(f: number): boolean { return !!(f & FLAG_TOOLCHG); }

// Emoji for what's BANNED
function bannedIcons(f: number): string {
  if (!flagEnabled(f)) return '💤';
  const icons: string[] = [];
  if (!flagAllowGcode(f))   icons.push('🚫');  // no gcode
  if (!flagAllowJog(f))     icons.push('🕹️');   // no jog
  if (!flagAllowToolchg(f)) icons.push('🔧');  // no tool change
  return icons.length ? icons.join('') : '✅';
}

function flagsDesc(f: number): string {
  if (!flagEnabled(f)) return 'disabled';
  const blocked: string[] = [];
  if (!flagAllowGcode(f))   blocked.push('G-code');
  if (!flagAllowJog(f))     blocked.push('Jog');
  if (!flagAllowToolchg(f)) blocked.push('Tool change');
  return blocked.length ? 'blocks ' + blocked.join(', ') : 'allows all';
}

// ── Plugin detection ──────────────────────────────────────────────────────────

export function bearCheckPlugin(line: string): void {
  if (line.includes('[PLUGIN:MR BEAR DO NOT TOUCH')) {
    _pluginDetected = true;
    log('info', '🐻 MR BEAR DO NOT TOUCH detected');
    const cfg = document.getElementById('modcfg-bear');
    if (cfg) cfg.style.display = '';
    renderBearModule();
    setTimeout(() => bearRefresh(), 300);
  }
}

// ── Status report parsing ─────────────────────────────────────────────────────

export function bearParseStatus(field: string): void {
  // field is e.g. "EZ" or "E" or ""
  _globalEnabled = field.includes('E');
  _insideZone = field.includes('Z');
  const badge = document.getElementById('bearStatusBadge');
  if (badge) {
    badge.textContent = _globalEnabled
      ? (_insideZone ? '🐻 IN ZONE' : '🐻 ACTIVE')
      : '🐻 OFF';
    badge.className = 'bear-status-badge' +
      (_insideZone ? ' in-zone' : _globalEnabled ? ' active' : '');
  }
}

// ── Zone list fetch ───────────────────────────────────────────────────────────

export function bearRefresh(): void {
  if (!state.connected) { log('err', 'Not connected'); return; }
  _loading = true;
  _loadLines = [];
  sendCmd('$ZONE');
}

export function bearIntercept(line: string): boolean {
  if (!_pluginDetected) return false;
  if (!_loading && !line.startsWith('[BEAR:')) return false;

  if (line.startsWith('[BEAR:')) {
    _loading = true;
    _loadLines = [];
    // Parse header: [BEAR:enabled,3 zones] or [BEAR:disabled,0 zones]
    const m = line.match(/\[BEAR:(enabled|disabled),(\d+)/);
    if (m) {
      _globalEnabled = m[1] === 'enabled';
    }
    _loadLines.push(line);
    return true;
  }

  if (line.startsWith('[ZONE:') && _loading) {
    _loadLines.push(line);
    return true;
  }

  if (line === 'ok' && _loading) {
    _loading = false;
    parseZoneList(_loadLines);
    renderBearModule();
    rebuildZoneMeshes();
    return false; // let parser handle ok normally (rxInFlight, sentQueue)
  }

  return false;
}

function parseZoneList(lines: string[]): void {
  _zones = [];
  for (const line of lines) {
    // [ZONE:0|-100.00,-100.00,-50.00,0.00,0.00,0.00|8]
    const m = line.match(/\[ZONE:(\d+)\|([^|]+)\|(\d+)\]/);
    if (!m) continue;
    const slot = parseInt(m[1]);
    const coords = m[2].split(',').map(Number);
    const flags = parseInt(m[3]);
    if (coords.length >= 6) {
      _zones.push({
        slot, flags,
        xmin: coords[0], ymin: coords[1], zmin: coords[2],
        xmax: coords[3], ymax: coords[4], zmax: coords[5],
      });
    }
  }
}

// ── Module UI ─────────────────────────────────────────────────────────────────

function ensureFormExists(body: HTMLElement): void {
  if (document.getElementById('bearEditForm')) return;

  // Table container
  const tableDiv = document.createElement('div');
  tableDiv.id = 'bearTableWrap';
  body.appendChild(tableDiv);

  // Add zone button
  const addDiv = document.createElement('div');
  addDiv.style.cssText = 'padding:6px 8px;border-top:1px solid var(--border);';
  addDiv.innerHTML = '<button class="tb-btn success" style="width:100%;font-size:11px;padding:8px" onclick="bearShowAddForm()">+ ADD ZONE</button>';
  body.appendChild(addDiv);

  // Edit form — created once, never destroyed
  const form = document.createElement('div');
  form.id = 'bearEditForm';
  form.style.cssText = 'display:none;padding:8px;border-top:1px solid var(--border);background:var(--surface2);';
  form.innerHTML =
    '<div style="font-family:var(--cond);font-size:10px;letter-spacing:1.5px;color:var(--text3);text-transform:uppercase;margin-bottom:6px" id="bearFormTitle">NEW ZONE</div>' +
    '<div style="display:grid;grid-template-columns:auto 1fr;gap:4px 8px;align-items:center;font-family:var(--mono);font-size:11px;">' +
    '<span style="color:var(--text3)">Slot</span><input id="bearSlot" type="number" min="0" max="15" value="0" class="limits-safe-input" style="width:100%">' +
    '</div>' +
    '<div style="display:flex;flex-direction:column;gap:4px;margin-top:6px;font-family:var(--mono);font-size:11px;">' +
    '<div style="display:flex;align-items:center;gap:6px"><span style="color:var(--text3);width:14px;font-weight:700">X</span><input id="bearXMin" type="number" step="0.01" value="0" class="limits-safe-input" style="flex:1" placeholder="min"><span style="color:var(--text3)">—</span><input id="bearXMax" type="number" step="0.01" value="0" class="limits-safe-input" style="flex:1" placeholder="max"></div>' +
    '<div style="display:flex;align-items:center;gap:6px"><span style="color:var(--text3);width:14px;font-weight:700">Y</span><input id="bearYMin" type="number" step="0.01" value="0" class="limits-safe-input" style="flex:1" placeholder="min"><span style="color:var(--text3)">—</span><input id="bearYMax" type="number" step="0.01" value="0" class="limits-safe-input" style="flex:1" placeholder="max"></div>' +
    '<div style="display:flex;align-items:center;gap:6px"><span style="color:var(--text3);width:14px;font-weight:700">Z</span><input id="bearZMin" type="number" step="0.01" value="0" class="limits-safe-input" style="flex:1" placeholder="min"><span style="color:var(--text3)">—</span><input id="bearZMax" type="number" step="0.01" value="0" class="limits-safe-input" style="flex:1" placeholder="max"></div>' +
    '</div>' +
    '<div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:8px;">' +
    '<label style="display:flex;align-items:center;gap:4px;font-family:var(--cond);font-size:10px;color:var(--text2);cursor:pointer"><input type="checkbox" id="bearFlagEn" checked> Enabled</label>' +
    '<label style="display:flex;align-items:center;gap:4px;font-family:var(--cond);font-size:10px;color:var(--text2);cursor:pointer"><input type="checkbox" id="bearFlagGcode"> Allow G-code</label>' +
    '<label style="display:flex;align-items:center;gap:4px;font-family:var(--cond);font-size:10px;color:var(--text2);cursor:pointer"><input type="checkbox" id="bearFlagJog"> Allow Jog</label>' +
    '<label style="display:flex;align-items:center;gap:4px;font-family:var(--cond);font-size:10px;color:var(--text2);cursor:pointer"><input type="checkbox" id="bearFlagTool"> Allow Tool Chg</label>' +
    '</div>' +
    '<div style="display:flex;gap:6px;margin-top:8px;">' +
    '<button class="tb-btn primary" style="flex:1" onclick="bearSaveZone()">SAVE</button>' +
    '<button class="tb-btn" style="flex:1" onclick="bearCancelEdit()">CANCEL</button>' +
    '</div>';
  body.appendChild(form);
}

export function renderBearModule(): void {
  const body = document.getElementById('bearModBody');
  if (!body) return;

  ensureFormExists(body);

  const tableWrap = document.getElementById('bearTableWrap');
  if (!tableWrap) return;

  if (_zones.length === 0) {
    tableWrap.innerHTML = '<div style="text-align:center;padding:14px;color:var(--text3);font-family:var(--cond);font-size:11px;letter-spacing:1px;text-transform:uppercase">No zones — click ↻ to load</div>';
    return;
  }

  let html = '<table style="width:100%;border-collapse:collapse;">';
  html += '<tr style="background:var(--surface2);">';
  html += '<th class="tt-th">#</th><th class="tt-th">MIN</th><th class="tt-th">MAX</th><th class="tt-th">BAN</th><th class="tt-th"></th>';
  html += '</tr>';

  for (const z of _zones) {
    const en = flagEnabled(z.flags);
    const rowBg = en ? '' : 'opacity:0.4;';
    html += `<tr style="${rowBg}border-bottom:1px solid var(--border);">`;
    html += `<td class="tt-td" style="font-weight:700;color:var(--text)">${z.slot}</td>`;
    html += `<td class="tt-td" style="font-size:10px">${z.xmin}, ${z.ymin}, ${z.zmin}</td>`;
    html += `<td class="tt-td" style="font-size:10px">${z.xmax}, ${z.ymax}, ${z.zmax}</td>`;
    html += `<td class="tt-td" style="font-size:16px">${bannedIcons(z.flags)}</td>`;
    html += `<td class="tt-td" style="white-space:nowrap">`;
    html += `<button class="dro-axis-btn" onclick="bearEditZone(${z.slot})">✏️</button> `;
    html += `<button class="dro-axis-btn" onclick="bearDeleteZone(${z.slot})" style="color:var(--red)">🗑</button>`;
    html += `</td></tr>`;
  }
  html += '</table>';

  tableWrap.innerHTML = html;
}

function populateBearForm(zone?: BearZone): void {
  const form = document.getElementById('bearEditForm');
  if (!form) return;
  form.style.display = '';

  if (zone) {
    (document.getElementById('bearFormTitle') as HTMLElement).textContent = 'EDIT ZONE ' + zone.slot;
    (document.getElementById('bearSlot') as HTMLInputElement).value = String(zone.slot);
    (document.getElementById('bearXMin') as HTMLInputElement).value = String(zone.xmin);
    (document.getElementById('bearYMin') as HTMLInputElement).value = String(zone.ymin);
    (document.getElementById('bearZMin') as HTMLInputElement).value = String(zone.zmin);
    (document.getElementById('bearXMax') as HTMLInputElement).value = String(zone.xmax);
    (document.getElementById('bearYMax') as HTMLInputElement).value = String(zone.ymax);
    (document.getElementById('bearZMax') as HTMLInputElement).value = String(zone.zmax);
    (document.getElementById('bearFlagEn') as HTMLInputElement).checked = flagEnabled(zone.flags);
    (document.getElementById('bearFlagGcode') as HTMLInputElement).checked = flagAllowGcode(zone.flags);
    (document.getElementById('bearFlagJog') as HTMLInputElement).checked = flagAllowJog(zone.flags);
    (document.getElementById('bearFlagTool') as HTMLInputElement).checked = flagAllowToolchg(zone.flags);
  } else {
    const used = new Set(_zones.map(z => z.slot));
    let slot = 0;
    while (used.has(slot) && slot < 16) slot++;
    (document.getElementById('bearFormTitle') as HTMLElement).textContent = 'NEW ZONE';
    (document.getElementById('bearSlot') as HTMLInputElement).value = String(slot);
    (document.getElementById('bearXMin') as HTMLInputElement).value = '0';
    (document.getElementById('bearYMin') as HTMLInputElement).value = '0';
    (document.getElementById('bearZMin') as HTMLInputElement).value = '0';
    (document.getElementById('bearXMax') as HTMLInputElement).value = '0';
    (document.getElementById('bearYMax') as HTMLInputElement).value = '0';
    (document.getElementById('bearZMax') as HTMLInputElement).value = '0';
    (document.getElementById('bearFlagEn') as HTMLInputElement).checked = true;
    (document.getElementById('bearFlagGcode') as HTMLInputElement).checked = false;
    (document.getElementById('bearFlagJog') as HTMLInputElement).checked = false;
    (document.getElementById('bearFlagTool') as HTMLInputElement).checked = false;
  }
}

export function bearShowAddForm(): void { populateBearForm(); }

export function bearEditZone(slot: number): void {
  const z = _zones.find(z => z.slot === slot);
  if (z) populateBearForm(z);
}

export function bearSaveZone(): void {
  const slot = parseInt((document.getElementById('bearSlot') as HTMLInputElement).value);
  const xmin = parseFloat((document.getElementById('bearXMin') as HTMLInputElement).value);
  const ymin = parseFloat((document.getElementById('bearYMin') as HTMLInputElement).value);
  const zmin = parseFloat((document.getElementById('bearZMin') as HTMLInputElement).value);
  const xmax = parseFloat((document.getElementById('bearXMax') as HTMLInputElement).value);
  const ymax = parseFloat((document.getElementById('bearYMax') as HTMLInputElement).value);
  const zmax = parseFloat((document.getElementById('bearZMax') as HTMLInputElement).value);
  let flags = 0;
  if ((document.getElementById('bearFlagEn') as HTMLInputElement).checked) flags |= FLAG_ENABLED;
  if ((document.getElementById('bearFlagGcode') as HTMLInputElement).checked) flags |= FLAG_GCODE;
  if ((document.getElementById('bearFlagJog') as HTMLInputElement).checked) flags |= FLAG_JOG;
  if ((document.getElementById('bearFlagTool') as HTMLInputElement).checked) flags |= FLAG_TOOLCHG;
  if (isNaN(slot) || slot < 0 || slot > 15) { log('err', 'Slot must be 0-15'); return; }
  sendCmd(`$ZONE=${slot},${xmin},${ymin},${zmin},${xmax},${ymax},${zmax},${flags}`);
  // Refresh after a short delay to let the controller process
  setTimeout(() => bearRefresh(), 200);
}

export function bearDeleteZone(slot: number): void {
  sendCmd('$ZONE-' + slot);
  setTimeout(() => bearRefresh(), 200);
}

export function bearCancelEdit(): void {
  const form = document.getElementById('bearEditForm');
  if (form) form.style.display = 'none';
}

// ── 3D zone visualization ─────────────────────────────────────────────────────

function rebuildZoneMeshes(): void {
  // Remove old
  for (const m of _zoneMeshes) {
    scene.remove(m);
    if (m.geometry) m.geometry.dispose();
    if (m.material) m.material.dispose();
  }
  _zoneMeshes = [];
  _zoneSprites = [];

  for (const z of _zones) {
    if (!flagEnabled(z.flags)) continue;

    // Box edges in Three.js coords (Y=up=Z_machine, Z_three=-Y_machine)
    const sx = z.xmax - z.xmin;
    const sy = z.zmax - z.zmin;  // machine Z → three Y
    const sz = z.ymax - z.ymin;  // machine Y → three Z (negated)
    const cx = z.xmin + sx / 2;
    const cy = z.zmin + sy / 2;
    const cz = -(z.ymin + sz / 2);

    const zoneColor = new THREE.Color(optGetBearColor(z.flags));

    // Wireframe box
    const geo = new THREE.BoxGeometry(sx, sy, sz);
    const edges = new THREE.EdgesGeometry(geo);
    const line = new THREE.LineSegments(edges, new THREE.LineBasicMaterial({
      color: zoneColor, transparent: true, opacity: 0.7,
    }));
    line.position.set(cx, cy, cz);
    scene.add(line);
    _zoneMeshes.push(line);

    // Translucent fill
    const fillMat = new THREE.MeshBasicMaterial({
      color: zoneColor, transparent: true, opacity: 0.08, side: THREE.DoubleSide,
    });
    const fill = new THREE.Mesh(geo.clone(), fillMat);
    fill.position.set(cx, cy, cz);
    scene.add(fill);
    _zoneMeshes.push(fill);

    // Sprite label with banned icons
    const icons: { emoji: string; blocked: boolean }[] = [];
    if (flagEnabled(z.flags)) {
      icons.push({ emoji: '🤖', blocked: !flagAllowGcode(z.flags) });
      icons.push({ emoji: '🕹', blocked: !flagAllowJog(z.flags) });
      icons.push({ emoji: '🔧', blocked: !flagAllowToolchg(z.flags) });
    } else {
      icons.push({ emoji: '💤', blocked: false });
    }
    const iconSize = 50;
    const pad = 6;
    const totalW = icons.length * (iconSize + pad) - pad;
    const canvasW = Math.max(256, totalW + 20);
    const canvasH = 64;
    const canvas = document.createElement('canvas');
    canvas.width = canvasW; canvas.height = canvasH;
    const ctx = canvas.getContext('2d')!;
    ctx.font = `${iconSize - 4}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const startX = (canvasW - totalW) / 2 + iconSize / 2;
    for (let i = 0; i < icons.length; i++) {
      const ix = startX + i * (iconSize + pad);
      const iy = canvasH / 2;
      ctx.fillText(icons[i].emoji, ix, iy);
      if (icons[i].blocked) {
        ctx.strokeStyle = '#ff2222';
        ctx.lineWidth = 5;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(ix - iconSize * 0.35, iy - iconSize * 0.35);
        ctx.lineTo(ix + iconSize * 0.35, iy + iconSize * 0.35);
        ctx.stroke();
      }
    }
    const tex = new THREE.CanvasTexture(canvas);
    const spriteMat = new THREE.SpriteMaterial({ map: tex, transparent: true });
    const sprite = new THREE.Sprite(spriteMat);
    sprite.position.set(cx, z.zmax + 3, cz);
    scene.add(sprite);
    _zoneMeshes.push(sprite);
    _zoneSprites.push(sprite);
  }
}

export function bearClearViz(): void {
  for (const m of _zoneMeshes) {
    scene.remove(m);
    if (m.geometry) m.geometry.dispose();
    if (m.material) m.material.dispose();
  }
  _zoneMeshes = [];
  _zoneSprites = [];
}

export function bearUpdateSpriteScales(radius: number): void {
  const s = radius * optGetBearScale() * (window.devicePixelRatio || 1);
  for (const sp of _zoneSprites) {
    sp.scale.set(s, s * 0.25, 1);
  }
}
