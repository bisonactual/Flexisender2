// ═══════════════════════════════════════════════
// Camera engine
// ═══════════════════════════════════════════════

import { state } from './state';
import { lsGet, lsSet } from './ui';
import { log } from './console';
import { sendCmd } from './connection';

export async function initCameraTab(): Promise<void> {
  try {
    const tmp = await navigator.mediaDevices.getUserMedia({ video: true });
    tmp.getTracks().forEach(t => t.stop());
  } catch (_) {}
  await populateCameraList();
}

async function populateCameraList(): Promise<void> {
  const sel = document.getElementById('camSelect') as HTMLSelectElement;
  const devices = await navigator.mediaDevices.enumerateDevices();
  const cams = devices.filter(d => d.kind === 'videoinput');
  sel.innerHTML = '<option value="">— select camera —</option>';
  cams.forEach((d, i) => {
    const opt = document.createElement('option');
    opt.value = d.deviceId;
    opt.textContent = d.label || 'Camera ' + (i + 1);
    sel.appendChild(opt);
  });
  if (cams.length === 1) sel.value = cams[0].deviceId;
}

export function selectCamera(_deviceId: string): void {
  if (state.camActive) stopCamera();
}

export async function startCamera(): Promise<void> {
  const deviceId = (document.getElementById('camSelect') as HTMLSelectElement).value;
  const constraints: any = { video: deviceId ? { deviceId: { exact: deviceId }, width: { ideal: 1920 }, height: { ideal: 1080 } } : { width: { ideal: 1920 }, height: { ideal: 1080 } } };
  try {
    state.camStream = await navigator.mediaDevices.getUserMedia(constraints);
    const video = document.getElementById('camVideo') as HTMLVideoElement;
    video.srcObject = state.camStream;
    await new Promise(res => video.onloadedmetadata = res);
    video.play();

    document.getElementById('camOffMsg')!.style.display = 'none';
    document.getElementById('camWrap')!.style.display = 'inline-block';
    (document.getElementById('camStartBtn') as HTMLButtonElement).disabled = true;
    (document.getElementById('camStopBtn') as HTMLButtonElement).disabled = false;
    (document.getElementById('camGoCameraBtn') as HTMLButtonElement).disabled = false;
    (document.getElementById('camGoSpindleBtn') as HTMLButtonElement).disabled = false;
    (document.getElementById('camZeroHereBtn') as HTMLButtonElement).disabled = false;
    state.camActive = true;

    resizeCamCanvas();
    new ResizeObserver(resizeCamCanvas).observe(video);
    requestAnimationFrame(camLoop);
  } catch (e: any) {
    log('err', 'Camera error: ' + e.message);
  }
}

export function stopCamera(): void {
  if (state.camStream) { state.camStream.getTracks().forEach(t => t.stop()); state.camStream = null; }
  state.camActive = false;
  document.getElementById('camWrap')!.style.display = 'none';
  document.getElementById('camOffMsg')!.style.display = '';
  (document.getElementById('camStartBtn') as HTMLButtonElement).disabled = false;
  (document.getElementById('camStopBtn') as HTMLButtonElement).disabled = true;
  (document.getElementById('camGoCameraBtn') as HTMLButtonElement).disabled = true;
  (document.getElementById('camGoSpindleBtn') as HTMLButtonElement).disabled = true;
  (document.getElementById('camZeroHereBtn') as HTMLButtonElement).disabled = true;
}

function resizeCamCanvas(): void {
  const video = document.getElementById('camVideo') as HTMLVideoElement;
  const canvas = document.getElementById('camCanvas') as HTMLCanvasElement;
  canvas.width = video.offsetWidth;
  canvas.height = video.offsetHeight;
}

function camLoop(): void {
  if (!state.camActive) return;
  drawOverlay();
  requestAnimationFrame(camLoop);
}

export function drawOverlay(): void {
  const video = document.getElementById('camVideo') as HTMLVideoElement;
  const canvas = document.getElementById('camCanvas') as HTMLCanvasElement;
  if (!canvas.width || !canvas.height) return;
  const ctx = canvas.getContext('2d')!;
  const w = canvas.width, h = canvas.height;
  ctx.clearRect(0, 0, w, h);

  if (state.camZoomVal > 1) {
    const vw = video.videoWidth || w;
    const vh = video.videoHeight || h;
    const zw = vw / state.camZoomVal, zh = vh / state.camZoomVal;
    const zx = (state.camCrossX * vw) - zw / 2;
    const zy = (state.camCrossY * vh) - zh / 2;
    ctx.save();
    ctx.drawImage(video, Math.max(0, zx), Math.max(0, zy), zw, zh, 0, 0, w, h);
    ctx.restore();
  }

  const cx = state.camCrossX * w;
  const cy = state.camCrossY * h;
  const sz = state.camCrossSizeVal;

  ctx.save();
  ctx.strokeStyle = state.camCrossColor;
  ctx.lineWidth = 1.5;
  ctx.shadowColor = 'rgba(0,0,0,0.8)';
  ctx.shadowBlur = 3;

  if (state.camCrossStyle === 'cross' || state.camCrossStyle === 'both') {
    const gap = 8;
    ctx.beginPath(); ctx.moveTo(cx - sz, cy); ctx.lineTo(cx - gap, cy); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(cx + gap, cy); ctx.lineTo(cx + sz, cy); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(cx, cy - sz); ctx.lineTo(cx, cy - gap); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(cx, cy + gap); ctx.lineTo(cx, cy + sz); ctx.stroke();
  }
  if (state.camCrossStyle === 'circle' || state.camCrossStyle === 'both') {
    ctx.beginPath(); ctx.arc(cx, cy, sz * 0.5, 0, Math.PI * 2); ctx.stroke();
  }
  if (state.camCrossStyle === 'dot') {
    ctx.fillStyle = state.camCrossColor;
    ctx.beginPath(); ctx.arc(cx, cy, 4, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.moveTo(cx - 12, cy); ctx.lineTo(cx + 12, cy); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(cx, cy - 12); ctx.lineTo(cx, cy + 12); ctx.stroke();
  }
  ctx.restore();
  updateCamPositionDisplay();
}

function updateCamPositionDisplay(): void {
  const sx = state.machineX, sy = state.machineY;
  const cx = sx + state.camOffsetX, cy = sy + state.camOffsetY;
  document.getElementById('camSpindlePos')!.textContent = 'X:' + sx.toFixed(3) + ' Y:' + sy.toFixed(3);
  document.getElementById('camCameraPos')!.textContent = 'X:' + cx.toFixed(3) + ' Y:' + cy.toFixed(3);
}

export function camMouseDown(e: MouseEvent): void {
  const rect = (document.getElementById('camCanvas') as HTMLCanvasElement).getBoundingClientRect();
  if (e.shiftKey) {
    state.camShiftDrag = true;
    state.camDragStartCross = { x: state.camCrossX, y: state.camCrossY };
    state.camDragStartMouse = { x: (e.clientX - rect.left) / rect.width, y: (e.clientY - rect.top) / rect.height };
  }
  state.camDragging = true;
}

export function camMouseMove(e: MouseEvent): void {
  if (!state.camDragging || !state.camShiftDrag) return;
  const rect = (document.getElementById('camCanvas') as HTMLCanvasElement).getBoundingClientRect();
  const mx = (e.clientX - rect.left) / rect.width;
  const my = (e.clientY - rect.top) / rect.height;
  state.camCrossX = Math.max(0.05, Math.min(0.95, state.camDragStartCross.x + (mx - state.camDragStartMouse.x)));
  state.camCrossY = Math.max(0.05, Math.min(0.95, state.camDragStartCross.y + (my - state.camDragStartMouse.y)));
  drawOverlay();
}

export function camMouseUp(_e: MouseEvent): void {
  state.camDragging = false; state.camShiftDrag = false;
}

export function setCrosshairStyle(style: string): void {
  state.camCrossStyle = style;
  document.querySelectorAll('[data-style]').forEach(b => b.classList.toggle('active', (b as HTMLElement).dataset.style === style));
  drawOverlay();
}

export function setCrosshairColor(color: string): void {
  state.camCrossColor = color;
  document.querySelectorAll('[data-color]').forEach(b => {
    b.classList.toggle('active', (b as HTMLElement).dataset.color === color);
    (b as HTMLElement).style.background = (b as HTMLElement).dataset.color === color ? color + '22' : '';
  });
  drawOverlay();
}

export function measureOffset(): void {
  if (!state.connected) { log('err', 'Not connected'); return; }
  if (!state.camMeasuring) {
    state.camMeasureStartPos = { x: state.machineX, y: state.machineY };
    state.camMeasuring = true;
    log('info', 'Camera offset: spindle position recorded at X:' + state.machineX.toFixed(3) + ' Y:' + state.machineY.toFixed(3));
    log('info', 'Now jog so the camera crosshair is over the same point, then click MEASURE OFFSET again.');
    const btn = document.querySelector('[onclick="measureOffset()"]') as HTMLElement;
    btn.textContent = '✓ CONFIRM OFFSET';
    btn.classList.add('primary');
  } else {
    state.camOffsetX = +(state.machineX - state.camMeasureStartPos!.x).toFixed(4);
    state.camOffsetY = +(state.machineY - state.camMeasureStartPos!.y).toFixed(4);
    (document.getElementById('camOffX') as HTMLInputElement).value = String(state.camOffsetX);
    (document.getElementById('camOffY') as HTMLInputElement).value = String(state.camOffsetY);
    state.camMeasuring = false;
    const btn = document.querySelector('[onclick="measureOffset()"]') as HTMLElement;
    btn.textContent = '📏 MEASURE OFFSET';
    btn.classList.remove('primary');
    log('info', 'Camera offset set: X:' + state.camOffsetX + ' Y:' + state.camOffsetY + ' mm');
    saveCamSettings();
  }
}

export function goToCamera(): void {
  if (!state.connected) { log('err', 'Not connected'); return; }
  const tx = state.machineX + state.camOffsetX;
  const ty = state.machineY + state.camOffsetY;
  sendCmd('G0 X' + tx.toFixed(4) + ' Y' + ty.toFixed(4));
  log('info', 'Moving spindle to camera position');
}

export function goToSpindle(): void {
  if (!state.connected) { log('err', 'Not connected'); return; }
  const tx = state.machineX - state.camOffsetX;
  const ty = state.machineY - state.camOffsetY;
  sendCmd('G0 X' + tx.toFixed(4) + ' Y' + ty.toFixed(4));
  log('info', 'Moving spindle back from camera position');
}

export function zeroAtCrosshair(): void {
  if (!state.connected) { log('err', 'Not connected'); return; }
  sendCmd('G10 L20 P1 X' + state.camOffsetX.toFixed(4) + ' Y' + state.camOffsetY.toFixed(4));
  log('info', 'WCS zeroed at camera position');
}

export function saveCamSettings(): void {
  lsSet('flexisender_cam', {
    offsetX: state.camOffsetX, offsetY: state.camOffsetY,
    crossStyle: state.camCrossStyle, crossColor: state.camCrossColor,
    crossSize: state.camCrossSizeVal, zoom: state.camZoomVal
  });
}

export function loadCamSettings(): void {
  const s = lsGet<any>('flexisender_cam', {});
  if (s.offsetX !== undefined) { state.camOffsetX = s.offsetX; (document.getElementById('camOffX') as HTMLInputElement).value = s.offsetX; }
  if (s.offsetY !== undefined) { state.camOffsetY = s.offsetY; (document.getElementById('camOffY') as HTMLInputElement).value = s.offsetY; }
  if (s.crossStyle) setCrosshairStyle(s.crossStyle);
  if (s.crossColor) setCrosshairColor(s.crossColor);
  if (s.crossSize) { state.camCrossSizeVal = s.crossSize; (document.getElementById('camCrossSize') as HTMLInputElement).value = String(s.crossSize); }
  if (s.zoom) { state.camZoomVal = s.zoom; (document.getElementById('camZoom') as HTMLInputElement).value = String(s.zoom); document.getElementById('camZoomDisp')!.textContent = s.zoom.toFixed(1) + 'x'; }
}

export function initCameraListeners(): void {
  document.getElementById('camCrossSize')!.addEventListener('input', function (this: HTMLInputElement) {
    document.getElementById('camCrossSizeDisp')!.textContent = this.value;
    saveCamSettings();
  });
  document.getElementById('camZoom')!.addEventListener('change', saveCamSettings);

  // Right-click restores crosshair to center
  document.addEventListener('contextmenu', e => {
    if ((e.target as HTMLElement).id === 'camDragLayer') {
      e.preventDefault();
      state.camCrossX = 0.5; state.camCrossY = 0.5;
      drawOverlay();
    }
  });
}
