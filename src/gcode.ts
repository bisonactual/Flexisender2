// ═══════════════════════════════════════════════
// G-CODE PARSER & TOOLPATH BUILDER
// ═══════════════════════════════════════════════

import { state } from './state';
import { log } from './console';
import { sendCmd } from './connection';
import { buildToolpathMesh, fitView } from './viewport';
import { WCS_ENTRIES } from './offsets';

declare const THREE: any;

const WCS_CODES: Record<string, string> = {
  '54': 'G54', '55': 'G55', '56': 'G56', '57': 'G57', '58': 'G58', '59': 'G59',
  '59.1': 'G59.1', '59.2': 'G59.2', '59.3': 'G59.3',
};

export function parseGcodeToToolpath(lines: string[]): { segments: any[]; cutCount: number; rapidCount: number } {
  const segments: any[] = [];
  let x = 0, y = 0, z = 0;
  let modal = { motion: 0 };
  let cutCount = 0, rapidCount = 0;

  // WCS tracking — map G-code work coords to machine coords
  let activeWcs = state.activeWcs || 'G54';

  function wcsOffset(): { x: number; y: number; z: number } {
    const off = state.wcsOffsets[activeWcs];
    return off || { x: 0, y: 0, z: 0 };
  }

  for (const raw of lines) {
    let line = raw.replace(/;.*/, '').replace(/\(.*?\)/g, '').trim().toUpperCase();
    if (!line) continue;

    const words: Record<string, number> = {};
    const gWords: number[] = [];
    const re = /([A-Z])([+-]?[\d.]+)/g;
    let m;
    while ((m = re.exec(line)) !== null) {
      const code = m[1].toUpperCase();
      const val = parseFloat(m[2]);
      if (code === 'G') gWords.push(val);
      else words[code] = val;
    }

    for (const g of gWords) {
      if (g === 0 || g === 1 || g === 2 || g === 3) modal.motion = g;
      const wcs = WCS_CODES[String(g)];
      if (wcs) activeWcs = wcs;
    }

    const hasMove = 'X' in words || 'Y' in words || 'Z' in words;
    if (!hasMove) continue;

    // Work coordinates from G-code
    const off = wcsOffset();
    // Convert work coords to machine coords, then to THREE.js coords
    // Machine = Work + WCS offset
    // THREE: x = machineX, y = machineZ, z = -machineY
    const mx = ('X' in words ? words['X'] + off.x : (x));
    const my = ('Z' in words ? words['Z'] + off.z : (y));
    const mz = ('Y' in words ? -(words['Y'] + off.y) : (z));

    const from = new THREE.Vector3(x, y, z);
    const to = new THREE.Vector3(mx, my, mz);

    if (from.distanceTo(to) < 0.0001) { x = mx; y = my; z = mz; continue; }

    const isRapid = (modal.motion === 0);
    segments.push({ from: from.clone(), to: to.clone(), isRapid });
    if (isRapid) rapidCount++; else cutCount++;

    x = mx; y = my; z = mz;
  }
  return { segments, cutCount, rapidCount };
}

export function processGcode(text: string, name: string): void {
  state.gcodeLines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);
  state.lineHead = 0; state.segmentIndex = 0;
  document.getElementById('fileName')!.textContent = name;
  updateProgress(0, state.gcodeLines.length);

  refreshLoadedProgramPreview();
  log('info', 'Loaded: ' + name + ' (' + state.gcodeLines.length + ' lines, ' + state.totalMoves + ' cuts, ' + state.totalRapids + ' rapids)');
}

export function refreshLoadedProgramPreview(): void {
  if (!state.gcodeLines.length) {
    state.toolpathSegments = [];
    state.totalMoves = 0;
    state.totalRapids = 0;
    state.progLimits = null;
    renderProgLimits();
    return;
  }

  const result = parseGcodeToToolpath(state.gcodeLines);
  state.toolpathSegments = result.segments;
  state.totalMoves = result.cutCount;
  state.totalRapids = result.rapidCount;

  buildToolpathMesh(state.toolpathSegments);
  fitView();

  (document.getElementById('btnStart') as HTMLButtonElement).disabled = false;
  document.getElementById('vpStats')!.innerHTML =
    `X: 0.000&nbsp;&nbsp;Y: 0.000&nbsp;&nbsp;Z: 0.000<br>CUTS: ${state.totalMoves}&nbsp;&nbsp;RAPIDS: ${state.totalRapids}`;

  computeProgLimits(state.gcodeLines.join('\n'));
}

export function updateProgress(cur: number, total: number): void {
  const pct = total > 0 ? (cur / total * 100) : 0;
  (document.getElementById('progressFill') as HTMLElement).style.width = pct.toFixed(1) + '%';
  document.getElementById('progressText')!.textContent = cur + ' / ' + total + ' lines (' + pct.toFixed(0) + '%)';
}

// ═══════════════════════════════════════════════
// PROGRAM LIMITS
// ═══════════════════════════════════════════════

function makeAxisAcc() {
  return { xMin: 0, xMax: 0, yMin: 0, yMax: 0, zMin: 0, zMax: 0, hasX: false, hasY: false, hasZ: false };
}

function updateAxisAcc(acc: any, axis: string, val: number): void {
  if (axis === 'X') {
    if (!acc.hasX) { acc.xMin = acc.xMax = val; acc.hasX = true; }
    else { if (val < acc.xMin) acc.xMin = val; if (val > acc.xMax) acc.xMax = val; }
  } else if (axis === 'Y') {
    if (!acc.hasY) { acc.yMin = acc.yMax = val; acc.hasY = true; }
    else { if (val < acc.yMin) acc.yMin = val; if (val > acc.yMax) acc.yMax = val; }
  } else if (axis === 'Z') {
    if (!acc.hasZ) { acc.zMin = acc.zMax = val; acc.hasZ = true; }
    else { if (val < acc.zMin) acc.zMin = val; if (val > acc.zMax) acc.zMax = val; }
  }
}

function finalizeAxisAcc(acc: any): any {
  return {
    xMin: acc.hasX ? acc.xMin : 0,
    xMax: acc.hasX ? acc.xMax : 0,
    yMin: acc.hasY ? acc.yMin : 0,
    yMax: acc.hasY ? acc.yMax : 0,
    zMin: acc.hasZ ? acc.zMin : 0,
    zMax: acc.hasZ ? acc.zMax : 0,
    hasX: acc.hasX,
    hasY: acc.hasY,
    hasZ: acc.hasZ,
  };
}

function collectOverallLimitsFromToolpath(): any | null {
  if (!state.toolpathSegments.length) return null;
  const acc = makeAxisAcc();
  for (const seg of state.toolpathSegments) {
    for (const pt of [seg.from, seg.to]) {
      updateAxisAcc(acc, 'X', pt.x);
      updateAxisAcc(acc, 'Y', -pt.z);
      updateAxisAcc(acc, 'Z', pt.y);
    }
  }
  return finalizeAxisAcc(acc);
}

function collectPerWcsLimits(rawText: string): { order: string[]; perWcs: Record<string, any> } {
  const perWcsAcc: Record<string, any> = {};
  const order: string[] = [];
  let activeWcs = state.activeWcs || 'G54';

  const ensureWcs = (code: string) => {
    if (!perWcsAcc[code]) {
      perWcsAcc[code] = makeAxisAcc();
      order.push(code);
    }
    return perWcsAcc[code];
  };

  for (const raw of rawText.split('\n')) {
    const line = raw.replace(/;.*/, '').replace(/\(.*?\)/g, '').trim().toUpperCase();
    if (!line) continue;

    const gWords: number[] = [];
    const re = /([A-Z])([+-]?[\d.]+)/g;
    let m;
    while ((m = re.exec(line)) !== null) {
      const code = m[1].toUpperCase();
      const val = parseFloat(m[2]);
      if (code === 'G') gWords.push(val);
    }

    for (const g of gWords) {
      const wcs = WCS_CODES[String(g)];
      if (wcs) activeWcs = wcs;
    }

    const axisRe = /([XYZ])([+-]?\.?\d+\.?\d*)/gi;
    let sawAxis = false;
    while ((m = axisRe.exec(line)) !== null) {
      const axis = m[1].toUpperCase();
      const val = parseFloat(m[2]);
      if (isNaN(val)) continue;
      updateAxisAcc(ensureWcs(activeWcs), axis, val);
      sawAxis = true;
    }

    if (gWords.some(g => !!WCS_CODES[String(g)]) && !sawAxis) ensureWcs(activeWcs);
  }

  const perWcs: Record<string, any> = {};
  for (const code of order) perWcs[code] = finalizeAxisAcc(perWcsAcc[code]);
  return { order, perWcs };
}

function getLimitsTabs(): { id: string; label: string; stats: any; frameable: boolean }[] {
  if (!state.progLimits) return [];
  const tabs = [{ id: 'overall', label: 'Overall', stats: state.progLimits.overall, frameable: false }];
  for (const code of state.progLimits.order || []) {
    const stats = state.progLimits.perWcs?.[code];
    if (stats) tabs.push({ id: code, label: code, stats, frameable: true });
  }
  return tabs;
}

function getSelectedLimitsTab(): { id: string; label: string; stats: any; frameable: boolean } | null {
  const tabs = getLimitsTabs();
  if (!tabs.length) return null;
  const ids = tabs.map(t => t.id);
  if (!ids.includes(state.progLimitsTab)) {
    if ((state.progLimits.order || []).includes(state.activeWcs)) state.progLimitsTab = state.activeWcs;
    else state.progLimitsTab = tabs[0].id;
  }
  return tabs.find(t => t.id === state.progLimitsTab) || tabs[0];
}

export function computeProgLimits(rawText: string): void {
  const { order, perWcs } = collectPerWcsLimits(rawText);
  const overall = collectOverallLimitsFromToolpath();

  if (!overall && !order.length) {
    state.progLimits = null;
    renderProgLimits();
    return;
  }

  state.progLimits = {
    overall: overall || (order[0] ? perWcs[order[0]] : null),
    perWcs,
    order,
  };

  renderProgLimits();
}

export function renderProgLimits(): void {
  const emptyEl = document.getElementById('limitsEmpty');
  const contentEl = document.getElementById('limitsContent');
  const tabsEl = document.getElementById('limitsTabs');
  const frameBtn = document.getElementById('limitsFrameBtn') as HTMLButtonElement | null;
  if (!emptyEl || !contentEl) return;

  if (!state.progLimits || !state.progLimits.overall) {
    emptyEl.style.display = '';
    contentEl.style.display = 'none';
    if (tabsEl) tabsEl.innerHTML = '';
    if (frameBtn) {
      frameBtn.disabled = true;
      frameBtn.textContent = '⬛ FRAME PROGRAM';
      frameBtn.title = '';
    }
    return;
  }

  emptyEl.style.display = 'none';
  contentEl.style.display = '';

  const tabs = getLimitsTabs();
  const selected = getSelectedLimitsTab();
  if (!selected) return;

  if (tabsEl) {
    tabsEl.style.display = tabs.length > 1 ? '' : 'none';
    tabsEl.innerHTML = '';
    for (const tab of tabs) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'limits-tab' + (tab.id === selected.id ? ' active' : '');
      btn.textContent = tab.label;
      btn.addEventListener('click', () => {
        state.progLimitsTab = tab.id;
        renderProgLimits();
      });
      tabsEl.appendChild(btn);
    }
  }

  if (frameBtn) {
    frameBtn.disabled = !state.connected || !selected.frameable;
    frameBtn.textContent = selected.frameable ? `⬛ FRAME ${selected.id}` : '⬛ FRAME PROGRAM';
    frameBtn.title = selected.frameable ? `Frame limits for ${selected.id}` : 'Select a WCS tab to frame that program section';
  }

  const fmt = (v: number) => v.toFixed(3);
  const span = (mn: number, mx: number) => (mx - mn).toFixed(3);
  const dash = '—';
  const p = selected.stats;

  document.getElementById('limXMin')!.textContent = p.hasX ? fmt(p.xMin) : dash;
  document.getElementById('limXMax')!.textContent = p.hasX ? fmt(p.xMax) : dash;
  document.getElementById('limXSpan')!.textContent = p.hasX ? span(p.xMin, p.xMax) : dash;
  document.getElementById('limYMin')!.textContent = p.hasY ? fmt(p.yMin) : dash;
  document.getElementById('limYMax')!.textContent = p.hasY ? fmt(p.yMax) : dash;
  document.getElementById('limYSpan')!.textContent = p.hasY ? span(p.yMin, p.yMax) : dash;
  document.getElementById('limZMin')!.textContent = p.hasZ ? fmt(p.zMin) : dash;
  document.getElementById('limZMax')!.textContent = p.hasZ ? fmt(p.zMax) : dash;
  document.getElementById('limZSpan')!.textContent = p.hasZ ? span(p.zMin, p.zMax) : dash;

  const sel = document.getElementById('limitsSafeZRef') as HTMLSelectElement | null;
  if (sel) {
    const prev = sel.value;
    sel.innerHTML = '<option value="absolute">ABS</option>';
    for (const entry of WCS_ENTRIES) {
      if (entry.code === 'G28' || entry.code === 'G30' || entry.code === 'TLO') continue;
      const opt = document.createElement('option');
      opt.value = entry.code;
      opt.textContent = entry.code;
      sel.appendChild(opt);
    }
    if (prev && sel.querySelector(`option[value="${prev}"]`)) sel.value = prev;
  }
}

// Hard limit: no absolute machine coordinate may exceed -1.
// Returns list of violating axis names, or empty if all clear.
function checkAbsoluteBounds(coords: { axis: string; absVal: number }[]): string[] {
  const BAD_LIMIT = -1;
  const violations: string[] = [];
  for (const c of coords) {
    if (c.absVal > BAD_LIMIT) violations.push(`${c.axis} (${c.absVal.toFixed(3)})`);
  }
  return violations;
}

export function frameProgram(): void {
  const selected = getSelectedLimitsTab();
  if (!state.connected || !selected || !selected.frameable) return;
  const safeZ = parseFloat((document.getElementById('limitsSafeZ') as HTMLInputElement).value);
  if (isNaN(safeZ)) { log('err', 'Frame: invalid Safe Z value'); return; }

  const ref = (document.getElementById('limitsSafeZRef') as HTMLSelectElement)?.value || 'absolute';
  const off = state.wcsOffsets[selected.id] || { x: 0, y: 0, z: 0 };
  const { xMin, xMax, yMin, yMax } = selected.stats;

  // Compute absolute machine coords for all frame corners
  const absXMin = xMin + off.x;
  const absXMax = xMax + off.x;
  const absYMin = yMin + off.y;
  const absYMax = yMax + off.y;

  // Compute absolute Z for safe height
  let absSafeZ: number;
  if (ref === 'absolute') {
    absSafeZ = safeZ;
  } else {
    const refOff = state.wcsOffsets[ref] || { x: 0, y: 0, z: 0 };
    absSafeZ = safeZ + refOff.z;
  }

  // Check every coordinate that will be commanded against the -1 limit
  const violations = checkAbsoluteBounds([
    { axis: 'X', absVal: absXMax },
    { axis: 'Y', absVal: absYMax },
    { axis: 'Z', absVal: absSafeZ },
  ]);

  if (violations.length) {
    log('err', `Frame BLOCKED — would exceed -1 in absolute machine space: ${violations.join(', ')}. Adjust WCS or program.`);
    return;
  }

  // Build Z command
  let zCmd: string;
  if (ref === 'absolute') {
    zCmd = `G53 G0 Z${safeZ.toFixed(4)}`;
  } else {
    const refOff = state.wcsOffsets[ref] || { x: 0, y: 0, z: 0 };
    const curOff = off;
    const absZ = safeZ + refOff.z;
    const workZ = absZ - curOff.z;
    zCmd = `G0 Z${workZ.toFixed(4)}`;
  }

  const f = (v: number) => v.toFixed(4);

  log('info', `Framing ${selected.id} — X[${xMin.toFixed(3)} → ${xMax.toFixed(3)}] Y[${yMin.toFixed(3)} → ${yMax.toFixed(3)}] SafeZ:${safeZ} (${ref})`);

  sendCmd(zCmd);
  sendCmd(`G0 X${f(xMin)} Y${f(yMin)}`);
  sendCmd(`G0 X${f(xMax)} Y${f(yMin)}`);
  sendCmd(`G0 X${f(xMax)} Y${f(yMax)}`);
  sendCmd(`G0 X${f(xMin)} Y${f(yMax)}`);
  sendCmd(`G0 X${f(xMin)} Y${f(yMin)}`);
}

// ── File loading ──────────────────────────────────────────────────────────────
export function loadFile(input: HTMLInputElement): void {
  const file = input.files?.[0]; if (!file) return;
  const reader = new FileReader();
  reader.onload = e => processGcode(e.target!.result as string, file.name);
  reader.readAsText(file);
}

export function uploadAndOpenFile(input: HTMLInputElement): void {
  const file = input.files?.[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = e => processGcode(e.target!.result as string, file.name);
  reader.readAsText(file);

  const wsUrl = (document.getElementById('wsUrl') as HTMLInputElement).value.trim();
  const httpUrl = wsUrl.replace(/^ws(s?):\/\//, 'http$1://').replace(/\/+$/, '');
  const uploadUrl = httpUrl + '/upload';

  const btn = document.querySelector('.upload-open-btn') as HTMLElement;
  btn.classList.add('uploading');
  btn.textContent = '⏳ UPLOADING…';

  log('info', `Uploading "${file.name}" (${(file.size / 1024).toFixed(1)} KB) to ${uploadUrl}`);

  const xhr = new XMLHttpRequest();

  xhr.upload.addEventListener('progress', e => {
    if (e.lengthComputable) {
      const pct = Math.round(e.loaded / e.total * 100);
      btn.textContent = `⏳ ${pct}%…`;
    }
  });

  xhr.addEventListener('load', () => {
    btn.classList.remove('uploading');
    btn.textContent = '📤 UPLOAD & OPEN';
    if (xhr.status >= 200 && xhr.status < 300) {
      log('info', `✓ Upload complete: "${file.name}" saved to SD card`);
    } else {
      log('err', `Upload failed: HTTP ${xhr.status} ${xhr.statusText} — check controller is reachable and SD card is mounted`);
    }
    input.value = '';
  });

  xhr.addEventListener('error', () => {
    btn.classList.remove('uploading');
    btn.textContent = '📤 UPLOAD & OPEN';
    log('err', `Upload failed: could not reach ${uploadUrl} — is the controller connected and does it have a web server?`);
    input.value = '';
  });

  xhr.addEventListener('timeout', () => {
    btn.classList.remove('uploading');
    btn.textContent = '📤 UPLOAD & OPEN';
    log('err', `Upload timed out — controller did not respond in time`);
    input.value = '';
  });

  xhr.timeout = 30000;
  xhr.open('POST', uploadUrl);
  xhr.send(new FormData().constructor === FormData ? (() => { const fd = new FormData(); fd.append('file', file, file.name); return fd; })() : null);
}
