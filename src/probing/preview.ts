// ═══════════════════════════════════════════════
// 2D canvas preview of probe waypoints
// ═══════════════════════════════════════════════

export interface Waypoint {
  x: number;
  y: number;
  z: number;
  type: string;
  label: string;
}

const TYPE_COLOR: Record<string, string> = {
  start: '#64748b',
  rapid: '#3b82f6',
  probe: '#f97316',
  retract: '#6366f1',
  contact: '#22c55e',
  result: '#f43f5e',
};

const _ps = {
  waypoints: [] as Waypoint[],
  currentStep: 0,
  animTimer: null as ReturnType<typeof setInterval> | null,
  playing: false,
};

export function waypointsTouchplate(cfg: { probeDistance: number; latchDistance: number; touchPlateHeight?: number }): Waypoint[] {
  const { probeDistance, latchDistance } = cfg;
  return [
    { x: 0, y: 0, z: 0, type: 'start', label: 'Start' },
    { x: 0, y: 0, z: -probeDistance, type: 'probe', label: 'Fast probe' },
    { x: 0, y: 0, z: -(probeDistance - latchDistance), type: 'contact', label: 'Contact' },
    { x: 0, y: 0, z: -(probeDistance - latchDistance) + latchDistance, type: 'retract', label: 'Retract' },
    { x: 0, y: 0, z: -(probeDistance - latchDistance) + latchDistance - latchDistance * 2, type: 'probe', label: 'Slow probe' },
    { x: 0, y: 0, z: -(probeDistance - latchDistance), type: 'contact', label: 'Final contact' },
    { x: 0, y: 0, z: 0, type: 'retract', label: 'Return' },
  ];
}

export function waypointsToolsetter(cfg: { toolsetterDepth: number; latchDistance: number; tsOffX: number; tsOffY: number; tsOffZ: number; probeDistance?: number }): Waypoint[] {
  const { toolsetterDepth, latchDistance, tsOffX, tsOffY, tsOffZ } = cfg;
  const approachZ = tsOffZ + toolsetterDepth;
  return [
    { x: 0, y: 0, z: 0, type: 'start', label: 'Start' },
    { x: 0, y: 0, z: 20, type: 'rapid', label: 'Z home' },
    { x: tsOffX, y: tsOffY, z: 20, type: 'rapid', label: 'Move to toolsetter XY' },
    { x: tsOffX, y: tsOffY, z: approachZ, type: 'rapid', label: 'Approach Z' },
    { x: tsOffX, y: tsOffY, z: tsOffZ, type: 'probe', label: 'Fast probe' },
    { x: tsOffX, y: tsOffY, z: tsOffZ, type: 'contact', label: 'Contact' },
    { x: tsOffX, y: tsOffY, z: tsOffZ + latchDistance, type: 'retract', label: 'Retract' },
    { x: tsOffX, y: tsOffY, z: tsOffZ - latchDistance, type: 'probe', label: 'Slow probe' },
    { x: tsOffX, y: tsOffY, z: tsOffZ, type: 'contact', label: 'Final contact' },
    { x: tsOffX, y: tsOffY, z: 20, type: 'retract', label: 'Return Z' },
    { x: 0, y: 0, z: 20, type: 'rapid', label: 'Return XY' },
    { x: 0, y: 0, z: 0, type: 'rapid', label: 'Return Z' },
  ];
}

export function waypointsEdgeSingle(cfg: { edge: string; mode: string; xyClr: number; depth: number; probeDistance: number; latchDistance: number; probeDiameter: number }): Waypoint[] {
  const { edge, mode, xyClr, depth, probeDistance, latchDistance, probeDiameter } = cfg;
  const isX = edge === 'AD' || edge === 'CB';
  const external = mode === 'external';
  const clr = xyClr + probeDiameter / 2;
  const dir = (edge === 'AD' || edge === 'AB') ? (external ? 1 : -1) : (external ? -1 : 1);
  const ax = isX ? -dir * clr : 0;
  const ay = !isX ? -dir * clr : 0;
  const px = isX ? dir * probeDistance : 0;
  const py = !isX ? dir * probeDistance : 0;
  const rx = isX ? -dir * latchDistance : 0;
  const ry = !isX ? -dir * latchDistance : 0;
  const contactX = isX ? ax + px : 0;
  const contactY = !isX ? ay + py : 0;
  return [
    { x: 0, y: 0, z: 0, type: 'start', label: 'Start' },
    { x: ax, y: ay, z: 0, type: 'rapid', label: 'Move to clearance' },
    { x: ax, y: ay, z: -depth, type: 'rapid', label: 'Plunge to depth' },
    { x: ax + px, y: ay + py, z: -depth, type: 'probe', label: 'Fast probe' },
    { x: contactX, y: contactY, z: -depth, type: 'contact', label: 'Contact' },
    { x: contactX + rx, y: contactY + ry, z: -depth, type: 'retract', label: 'Retract' },
    { x: contactX, y: contactY, z: -depth, type: 'probe', label: 'Slow probe' },
    { x: contactX, y: contactY, z: -depth, type: 'contact', label: 'Final contact' },
    { x: contactX, y: contactY, z: 0, type: 'retract', label: 'Lift' },
    { x: 0, y: 0, z: 0, type: 'rapid', label: 'Return' },
  ];
}

export function waypointsEdgeCorner(cfg: { edge: string; mode: string; xyClr: number; depth: number; offset: number; probeDistance: number; latchDistance: number; probeDiameter: number }): Waypoint[] {
  const { edge, mode, xyClr, depth, offset, probeDistance, latchDistance, probeDiameter } = cfg;
  const external = mode === 'external';
  const signs: Record<string, { x: number; y: number }> = {
    A: { x: 1, y: 1 },
    B: { x: -1, y: 1 },
    C: { x: -1, y: -1 },
    D: { x: 1, y: -1 },
  };
  const s = external ? signs[edge] : { x: -signs[edge].x, y: -signs[edge].y };
  const clr = xyClr + probeDiameter / 2;
  const xContact = s.x * probeDistance;
  const yContact = s.y * probeDistance;
  return [
    { x: 0, y: s.y * offset, z: 0, type: 'start', label: 'Start' },
    { x: -s.x * clr, y: s.y * offset, z: 0, type: 'rapid', label: 'X clearance' },
    { x: -s.x * clr, y: s.y * offset, z: -depth, type: 'rapid', label: 'Plunge' },
    { x: xContact, y: s.y * offset, z: -depth, type: 'probe', label: 'Probe X' },
    { x: xContact, y: s.y * offset, z: -depth, type: 'contact', label: 'X contact' },
    { x: xContact - s.x * latchDistance, y: s.y * offset, z: -depth, type: 'retract', label: 'Retract X' },
    { x: xContact, y: s.y * offset, z: -depth, type: 'probe', label: 'Slow X' },
    { x: xContact, y: s.y * offset, z: 0, type: 'retract', label: 'Lift' },
    { x: s.x * offset, y: 0, z: 0, type: 'rapid', label: 'Move to Y' },
    { x: s.x * offset, y: -s.y * clr, z: 0, type: 'rapid', label: 'Y clearance' },
    { x: s.x * offset, y: -s.y * clr, z: -depth, type: 'rapid', label: 'Plunge' },
    { x: s.x * offset, y: yContact, z: -depth, type: 'probe', label: 'Probe Y' },
    { x: s.x * offset, y: yContact, z: -depth, type: 'contact', label: 'Y contact' },
    { x: s.x * offset, y: yContact - s.y * latchDistance, z: -depth, type: 'retract', label: 'Retract Y' },
    { x: s.x * offset, y: yContact, z: -depth, type: 'probe', label: 'Slow Y' },
    { x: s.x * offset, y: yContact, z: 0, type: 'retract', label: 'Lift' },
    { x: xContact, y: yContact, z: 0, type: 'result', label: 'Found corner' },
  ];
}

export function waypointsCenter(cfg: { centerMode: string; axes: string; sizeX: number; sizeY: number; xyClr: number; depth: number; probeDistance: number; latchDistance: number; probeDiameter: number }): Waypoint[] {
  const { centerMode, axes, sizeX, sizeY, xyClr, depth, probeDistance, latchDistance, probeDiameter } = cfg;
  const clr = xyClr + probeDiameter / 2;
  const halfX = sizeX / 2;
  const halfY = sizeY / 2;
  const r = probeDiameter / 2;
  const wps: Waypoint[] = [
    { x: 0, y: 0, z: 0, type: 'start', label: 'Start' },
    { x: 0, y: 0, z: -depth, type: 'rapid', label: 'Plunge' },
  ];
  if (axes !== 'Y') {
    const inside = centerMode === 'inside';
    const x1 = inside ? -(halfX - clr) : -(halfX + clr);
    const c1 = inside ? -(halfX - probeDistance) : -halfX + r;
    const x2 = inside ? (halfX - clr) : (halfX + clr);
    const c2 = inside ? (halfX - probeDistance) : halfX - r;
    wps.push(
      { x: x1, y: 0, z: -depth, type: 'rapid', label: 'X- approach' },
      { x: c1, y: 0, z: -depth, type: 'probe', label: 'Probe X-' },
      { x: c1, y: 0, z: -depth, type: 'contact', label: 'X- contact' },
      { x: c1 + latchDistance, y: 0, z: -depth, type: 'retract', label: 'Retract' },
      { x: c1, y: 0, z: -depth, type: 'probe', label: 'Slow X-' },
      { x: x2, y: 0, z: -depth, type: 'rapid', label: 'X+ approach' },
      { x: c2, y: 0, z: -depth, type: 'probe', label: 'Probe X+' },
      { x: c2, y: 0, z: -depth, type: 'contact', label: 'X+ contact' },
      { x: c2 - latchDistance, y: 0, z: -depth, type: 'retract', label: 'Retract' },
      { x: c2, y: 0, z: -depth, type: 'probe', label: 'Slow X+' },
      { x: (c1 + c2) / 2, y: 0, z: -depth, type: 'rapid', label: 'Move to X center' },
    );
  }
  if (axes !== 'X') {
    const inside = centerMode === 'inside';
    const y1 = inside ? -(halfY - clr) : -(halfY + clr);
    const c1 = inside ? -(halfY - probeDistance) : -halfY + r;
    const y2 = inside ? (halfY - clr) : (halfY + clr);
    const c2 = inside ? (halfY - probeDistance) : halfY - r;
    wps.push(
      { x: 0, y: y1, z: -depth, type: 'rapid', label: 'Y- approach' },
      { x: 0, y: c1, z: -depth, type: 'probe', label: 'Probe Y-' },
      { x: 0, y: c1, z: -depth, type: 'contact', label: 'Y- contact' },
      { x: 0, y: c1 + latchDistance, z: -depth, type: 'retract', label: 'Retract' },
      { x: 0, y: c1, z: -depth, type: 'probe', label: 'Slow Y-' },
      { x: 0, y: y2, z: -depth, type: 'rapid', label: 'Y+ approach' },
      { x: 0, y: c2, z: -depth, type: 'probe', label: 'Probe Y+' },
      { x: 0, y: c2, z: -depth, type: 'contact', label: 'Y+ contact' },
      { x: 0, y: c2 - latchDistance, z: -depth, type: 'retract', label: 'Retract' },
      { x: 0, y: c2, z: -depth, type: 'probe', label: 'Slow Y+' },
      { x: 0, y: (c1 + c2) / 2, z: -depth, type: 'rapid', label: 'Move to Y center' },
    );
  }
  wps.push(
    { x: 0, y: 0, z: -depth, type: 'rapid', label: 'At center' },
    { x: 0, y: 0, z: 0, type: 'retract', label: 'Lift' },
    { x: 0, y: 0, z: 0, type: 'result', label: 'Center found' },
  );
  return wps;
}

export function waypointsRotation(cfg: { edge: string; xyClr: number; depth: number; offset: number; probeDistance: number; latchDistance: number; probeDiameter: number }): Waypoint[] {
  const { edge, xyClr, depth, offset, probeDistance, latchDistance, probeDiameter } = cfg;
  const clr = xyClr + probeDiameter / 2;
  const probeX = edge === 'AB' || edge === 'CD';
  const dir = (edge === 'AB' || edge === 'AD') ? 1 : -1;
  const ax1 = probeX ? -dir * clr : 0;
  const ay1 = !probeX ? -dir * clr : 0;
  const px = probeX ? dir * probeDistance : 0;
  const py = !probeX ? dir * probeDistance : 0;
  const c1x = ax1 + px;
  const c1y = ay1 + py;
  const ax2 = probeX ? -dir * clr : offset;
  const ay2 = !probeX ? -dir * clr : offset;
  const c2x = ax2 + px;
  const c2y = ay2 + py;
  return [
    { x: 0, y: 0, z: 0, type: 'start', label: 'Start' },
    { x: ax1, y: ay1, z: 0, type: 'rapid', label: 'P1 approach' },
    { x: ax1, y: ay1, z: -depth, type: 'rapid', label: 'Plunge' },
    { x: c1x, y: c1y, z: -depth, type: 'probe', label: 'Probe P1' },
    { x: c1x, y: c1y, z: -depth, type: 'contact', label: 'P1 contact' },
    { x: c1x - px * latchDistance / probeDistance, y: c1y - py * latchDistance / probeDistance, z: -depth, type: 'retract', label: 'Retract' },
    { x: c1x, y: c1y, z: -depth, type: 'probe', label: 'Slow P1' },
    { x: c1x, y: c1y, z: 0, type: 'retract', label: 'Lift' },
    { x: ax2, y: ay2, z: 0, type: 'rapid', label: 'P2 approach' },
    { x: ax2, y: ay2, z: -depth, type: 'rapid', label: 'Plunge' },
    { x: c2x, y: c2y, z: -depth, type: 'probe', label: 'Probe P2' },
    { x: c2x, y: c2y, z: -depth, type: 'contact', label: 'P2 contact' },
    { x: c2x - px * latchDistance / probeDistance, y: c2y - py * latchDistance / probeDistance, z: -depth, type: 'retract', label: 'Retract' },
    { x: c2x, y: c2y, z: -depth, type: 'probe', label: 'Slow P2' },
    { x: c2x, y: c2y, z: 0, type: 'retract', label: 'Lift' },
    { x: 0, y: 0, z: 0, type: 'rapid', label: 'Return' },
    { x: c1x, y: c1y, z: -depth, type: 'result', label: `P1: X${c1x.toFixed(2)} Y${c1y.toFixed(2)}` },
    { x: c2x, y: c2y, z: -depth, type: 'result', label: `P2: X${c2x.toFixed(2)} Y${c2y.toFixed(2)}` },
  ];
}

export function stepPreview(delta: number): void {
  _ps.currentStep = Math.max(0, Math.min(_ps.waypoints.length - 1, _ps.currentStep + delta));
  renderPreview();
  updatePreviewDRO();
  updatePreviewControls();
}

export function playPreview(): void {
  if (_ps.playing) { stopPreviewAnim(); return; }
  if (_ps.currentStep >= _ps.waypoints.length - 1) _ps.currentStep = 0;
  _ps.playing = true;
  updatePreviewControls();
  _ps.animTimer = setInterval(() => {
    if (_ps.currentStep >= _ps.waypoints.length - 1) { stopPreviewAnim(); return; }
    _ps.currentStep++;
    renderPreview();
    updatePreviewDRO();
    updatePreviewControls();
  }, 300);
}

function stopPreviewAnim(): void {
  if (_ps.animTimer) { clearInterval(_ps.animTimer); _ps.animTimer = null; }
  _ps.playing = false;
  updatePreviewControls();
}

function updatePreviewControls(): void {
  const playBtn = document.getElementById('previewPlayBtn') as HTMLButtonElement | null;
  const stepFwd = document.getElementById('previewStepFwd') as HTMLButtonElement | null;
  const stepBck = document.getElementById('previewStepBck') as HTMLButtonElement | null;
  const counter = document.getElementById('previewCounter');
  if (playBtn) playBtn.textContent = _ps.playing ? '⏸' : '▶';
  if (stepFwd) stepFwd.disabled = _ps.currentStep >= _ps.waypoints.length - 1;
  if (stepBck) stepBck.disabled = _ps.currentStep <= 0;
  if (counter) counter.textContent = _ps.waypoints.length > 0 ? `${_ps.currentStep + 1} / ${_ps.waypoints.length}` : '—';
}

function updatePreviewDRO(): void {
  const wp = _ps.waypoints[_ps.currentStep];
  if (!wp) return;
  const dx = document.getElementById('previewDroX');
  const dy = document.getElementById('previewDroY');
  const dz = document.getElementById('previewDroZ');
  const dl = document.getElementById('previewDroLabel');
  if (dx) dx.textContent = wp.x.toFixed(3);
  if (dy) dy.textContent = wp.y.toFixed(3);
  if (dz) dz.textContent = wp.z.toFixed(3);
  if (dl) dl.textContent = wp.label || '';
}

export function renderPreview(): void {
  const xyCanvas = document.getElementById('previewXY') as HTMLCanvasElement | null;
  const xzCanvas = document.getElementById('previewXZ') as HTMLCanvasElement | null;
  if (!xyCanvas || !xzCanvas || _ps.waypoints.length === 0) return;
  drawView(xyCanvas, 'XY');
  drawView(xzCanvas, 'XZ');
}

function drawView(canvas: HTMLCanvasElement, view: 'XY' | 'XZ'): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const W = canvas.width;
  const H = canvas.height;
  const wps = _ps.waypoints;
  const cur = _ps.currentStep;
  const xs = wps.map((w) => w.x);
  const ys = wps.map((w) => view === 'XY' ? w.y : w.z);
  let minX = Math.min(...xs), maxX = Math.max(...xs);
  let minY = Math.min(...ys), maxY = Math.max(...ys);
  const padX = Math.max((maxX - minX) * 0.2, 5);
  const padY = Math.max((maxY - minY) * 0.2, 5);
  minX -= padX; maxX += padX;
  minY -= padY; maxY += padY;
  const scaleX = W / (maxX - minX || 1);
  const scaleY = H / (maxY - minY || 1);
  const scale = Math.min(scaleX, scaleY) * 0.85;
  const offX = W / 2 - (maxX + minX) / 2 * scale;
  const offY = H / 2 + (maxY + minY) / 2 * scale;
  const tx = (x: number) => x * scale + offX;
  const ty = (y: number) => -y * scale + offY;

  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = '#0f0e0c';
  ctx.fillRect(0, 0, W, H);

  // Grid axes
  ctx.strokeStyle = 'rgba(255,255,255,0.05)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(tx(0), 0); ctx.lineTo(tx(0), H);
  ctx.moveTo(0, ty(0)); ctx.lineTo(W, ty(0));
  ctx.stroke();

  ctx.fillStyle = 'rgba(255,255,255,0.25)';
  ctx.font = '10px monospace';
  ctx.fillText(view, 6, 14);

  // Past segments
  for (let i = 1; i <= Math.min(cur, wps.length - 1); i++) {
    const a = wps[i - 1], b = wps[i];
    const ay2 = view === 'XY' ? a.y : a.z;
    const by = view === 'XY' ? b.y : b.z;
    ctx.beginPath();
    ctx.moveTo(tx(a.x), ty(ay2));
    ctx.lineTo(tx(b.x), ty(by));
    ctx.strokeStyle = TYPE_COLOR[b.type] || '#888';
    ctx.lineWidth = b.type === 'probe' ? 2 : 1.5;
    ctx.setLineDash((b.type === 'rapid' || b.type === 'retract') ? [4, 3] : []);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // Future segments
  for (let i = Math.max(1, cur + 1); i < wps.length; i++) {
    const a = wps[i - 1], b = wps[i];
    const ay2 = view === 'XY' ? a.y : a.z;
    const by = view === 'XY' ? b.y : b.z;
    ctx.beginPath();
    ctx.moveTo(tx(a.x), ty(ay2));
    ctx.lineTo(tx(b.x), ty(by));
    ctx.strokeStyle = 'rgba(255,255,255,0.08)';
    ctx.lineWidth = 1;
    ctx.setLineDash([2, 4]);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // Contact/result dots
  for (let i = 0; i <= Math.min(cur, wps.length - 1); i++) {
    const wp = wps[i];
    if (wp.type !== 'contact' && wp.type !== 'result') continue;
    const wy = view === 'XY' ? wp.y : wp.z;
    ctx.beginPath();
    ctx.arc(tx(wp.x), ty(wy), 3.5, 0, Math.PI * 2);
    ctx.fillStyle = TYPE_COLOR[wp.type];
    ctx.fill();
  }

  // Current position crosshair
  if (wps[cur]) {
    const wp = wps[cur];
    const cy = view === 'XY' ? wp.y : wp.z;
    const px = tx(wp.x);
    const py = ty(cy);
    const sz = 6;
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.moveTo(px - sz, py); ctx.lineTo(px + sz, py);
    ctx.moveTo(px, py - sz); ctx.lineTo(px, py + sz);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(px, py, 3, 0, Math.PI * 2);
    ctx.strokeStyle = '#ffffff';
    ctx.stroke();
  }
}
