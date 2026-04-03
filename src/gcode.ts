// ═══════════════════════════════════════════════
// G-CODE PARSER & TOOLPATH BUILDER
// ═══════════════════════════════════════════════

import { state } from './state';
import { log } from './console';
import { sendCmd } from './connection';
import { buildToolpathMesh, fitView } from './viewport';

declare const THREE: any;

export function parseGcodeToToolpath(lines: string[]): { segments: any[]; cutCount: number; rapidCount: number } {
  const segments: any[] = [];
  let x = 0, y = 0, z = 0;
  let modal = { motion: 0 };
  let cutCount = 0, rapidCount = 0;

  for (const raw of lines) {
    let line = raw.replace(/;.*/, '').replace(/\(.*?\)/g, '').trim().toUpperCase();
    if (!line) continue;

    const words: Record<string, number> = {};
    const re = /([A-Z])([+-]?[\d.]+)/g;
    let m;
    while ((m = re.exec(line)) !== null) words[m[1]] = parseFloat(m[2]);

    if ('G' in words) {
      const g = words['G'];
      if (g === 0 || g === 1 || g === 2 || g === 3) modal.motion = g;
    }

    const hasMove = 'X' in words || 'Y' in words || 'Z' in words;
    if (!hasMove) continue;

    const nx = 'X' in words ? words['X'] : x;
    const ny = 'Z' in words ? words['Z'] : y;
    const nz = 'Y' in words ? -words['Y'] : z;

    const from = new THREE.Vector3(x, y, z);
    const to = new THREE.Vector3(nx, ny, nz);

    if (from.distanceTo(to) < 0.0001) { x = nx; y = ny; z = nz; continue; }

    const isRapid = (modal.motion === 0);
    segments.push({ from: from.clone(), to: to.clone(), isRapid });
    if (isRapid) rapidCount++; else cutCount++;

    x = nx; y = ny; z = nz;
  }
  return { segments, cutCount, rapidCount };
}

export function processGcode(text: string, name: string): void {
  state.gcodeLines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);
  state.lineHead = 0; state.segmentIndex = 0;
  document.getElementById('fileName')!.textContent = name;
  updateProgress(0, state.gcodeLines.length);

  const result = parseGcodeToToolpath(state.gcodeLines);
  state.toolpathSegments = result.segments;
  state.totalMoves = result.cutCount;
  state.totalRapids = result.rapidCount;

  buildToolpathMesh(state.toolpathSegments);
  fitView();

  (document.getElementById('btnStart') as HTMLButtonElement).disabled = false;
  document.getElementById('vpStats')!.innerHTML =
    `X: 0.000&nbsp;&nbsp;Y: 0.000&nbsp;&nbsp;Z: 0.000<br>CUTS: ${state.totalMoves}&nbsp;&nbsp;RAPIDS: ${state.totalRapids}`;
  log('info', 'Loaded: ' + name + ' (' + state.gcodeLines.length + ' lines, ' + state.totalMoves + ' cuts, ' + state.totalRapids + ' rapids)');

  computeProgLimits(text);
}

export function updateProgress(cur: number, total: number): void {
  const pct = total > 0 ? (cur / total * 100) : 0;
  (document.getElementById('progressFill') as HTMLElement).style.width = pct.toFixed(1) + '%';
  document.getElementById('progressText')!.textContent = cur + ' / ' + total + ' lines (' + pct.toFixed(0) + '%)';
}

// ═══════════════════════════════════════════════
// PROGRAM LIMITS
// ═══════════════════════════════════════════════

export function computeProgLimits(rawText: string): void {
  const stripped = rawText.replace(/\(.*?\)/g, ' ').replace(/;[^\n]*/g, ' ');
  const xVals: number[] = [], yVals: number[] = [], zVals: number[] = [];

  const re = /([XYZ])([+-]?\.?\d+\.?\d*)/gi;
  let m;
  while ((m = re.exec(stripped)) !== null) {
    const axis = m[1].toUpperCase();
    const val = parseFloat(m[2]);
    if (isNaN(val)) continue;
    if (axis === 'X') xVals.push(val);
    else if (axis === 'Y') yVals.push(val);
    else if (axis === 'Z') zVals.push(val);
  }

  if (!xVals.length && !yVals.length && !zVals.length) {
    state.progLimits = null;
    renderProgLimits();
    return;
  }

  state.progLimits = {
    xMin: xVals.length ? Math.min(...xVals) : 0,
    xMax: xVals.length ? Math.max(...xVals) : 0,
    yMin: yVals.length ? Math.min(...yVals) : 0,
    yMax: yVals.length ? Math.max(...yVals) : 0,
    zMin: zVals.length ? Math.min(...zVals) : 0,
    zMax: zVals.length ? Math.max(...zVals) : 0,
    hasX: xVals.length > 0,
    hasY: yVals.length > 0,
    hasZ: zVals.length > 0,
  };

  renderProgLimits();
}

export function renderProgLimits(): void {
  const emptyEl = document.getElementById('limitsEmpty');
  const contentEl = document.getElementById('limitsContent');
  const frameBtn = document.getElementById('limitsFrameBtn') as HTMLButtonElement | null;
  if (!emptyEl || !contentEl) return;

  if (!state.progLimits) {
    emptyEl.style.display = '';
    contentEl.style.display = 'none';
    if (frameBtn) frameBtn.disabled = true;
    return;
  }

  emptyEl.style.display = 'none';
  contentEl.style.display = '';
  if (frameBtn) frameBtn.disabled = !state.connected;

  const fmt = (v: number) => v.toFixed(3);
  const span = (mn: number, mx: number) => (mx - mn).toFixed(3);
  const dash = '—';
  const p = state.progLimits;

  document.getElementById('limXMin')!.textContent = p.hasX ? fmt(p.xMin) : dash;
  document.getElementById('limXMax')!.textContent = p.hasX ? fmt(p.xMax) : dash;
  document.getElementById('limXSpan')!.textContent = p.hasX ? span(p.xMin, p.xMax) : dash;
  document.getElementById('limYMin')!.textContent = p.hasY ? fmt(p.yMin) : dash;
  document.getElementById('limYMax')!.textContent = p.hasY ? fmt(p.yMax) : dash;
  document.getElementById('limYSpan')!.textContent = p.hasY ? span(p.yMin, p.yMax) : dash;
  document.getElementById('limZMin')!.textContent = p.hasZ ? fmt(p.zMin) : dash;
  document.getElementById('limZMax')!.textContent = p.hasZ ? fmt(p.zMax) : dash;
  document.getElementById('limZSpan')!.textContent = p.hasZ ? span(p.zMin, p.zMax) : dash;
}

export function frameProgram(): void {
  if (!state.connected || !state.progLimits) return;
  const safeZ = parseFloat((document.getElementById('limitsSafeZ') as HTMLInputElement).value);
  if (isNaN(safeZ)) { log('err', 'Frame: invalid Safe Z value'); return; }

  const { xMin, xMax, yMin, yMax } = state.progLimits;
  const f = (v: number) => v.toFixed(4);

  log('info', `Framing program — X[${xMin.toFixed(3)} → ${xMax.toFixed(3)}] Y[${yMin.toFixed(3)} → ${yMax.toFixed(3)}] SafeZ:${safeZ}`);

  sendCmd(`G0 Z${f(safeZ)}`);
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
