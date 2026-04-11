// ═══════════════════════════════════════════════
// Edge finder probe logic
// ═══════════════════════════════════════════════

import { state } from '../state';
import { log } from '../console';
import { probeAxis, rapidToMPos, applyXYResult, applyZResult } from './probe-program';
import { isProbingRunning } from './probe-program';

function startPos() {
  return { x: (state as any).machineX, y: (state as any).machineY, z: (state as any).machineZ };
}

export async function runEdgeFinder(cfg: any): Promise<boolean> {
  if (!state.connected) { log('err', 'Not connected'); return false; }
  if (isProbingRunning()) { log('err', 'Probe already running'); return false; }
  const sp = startPos();
  const clr = cfg.xyClr + cfg.probeDiameter / 2;
  let ok = false;
  if (cfg.edge === 'Z') {
    ok = await probeZEdge(cfg, sp);
  } else if (cfg.edge.length === 2) {
    ok = await probeSingleEdge(cfg, sp, clr);
  } else {
    ok = await probeCorner(cfg, sp, clr);
  }
  return ok;
}

async function probeZEdge(cfg: any, sp: { x: number; y: number; z: number }): Promise<boolean> {
  log('info', 'Edge finder: probing Z surface…');
  const result = await probeAxis('Z', -1, cfg.probeFeedRate, cfg.latchFeedRate, cfg.probeDistance, cfg.latchDistance);
  if (!result) { log('err', '✗ Z probe failed'); return false; }
  await rapidToMPos(null, null, sp.z);
  const opts = { mode: cfg.coordMode, wcs: cfg.wcs };
  applyZResult(result.z, cfg.touchPlateHeight, cfg.workpieceHeight, opts);
  log('info', `✓ Z edge: ${result.z.toFixed(4)}`);
  return true;
}

async function probeSingleEdge(cfg: any, sp: { x: number; y: number; z: number }, clr: number): Promise<boolean> {
  const edge = cfg.edge;
  const isX = edge === 'AD' || edge === 'CB';
  const axis = isX ? 'X' : 'Y';
  const dir = (edge === 'AD' || edge === 'AB') ? (cfg.mode === 'external' ? 1 : -1) : (cfg.mode === 'external' ? -1 : 1);
  log('info', `Edge finder: probing ${edge} (${axis} ${dir > 0 ? '+' : '-'})…`);
  const approachX = isX ? sp.x - dir * clr : null;
  const approachY = !isX ? sp.y - dir * clr : null;
  await rapidToMPos(null, null, sp.z - cfg.depth);
  if (approachX !== null) await rapidToMPos(approachX, null, null);
  if (approachY !== null) await rapidToMPos(null, approachY, null);
  const result = await probeAxis(axis, dir, cfg.probeFeedRate, cfg.latchFeedRate, cfg.probeDistance, cfg.latchDistance);
  if (!result) {
    await rapidToMPos(null, null, sp.z);
    log('err', `✗ ${edge} probe failed`);
    return false;
  }
  await rapidToMPos(null, null, sp.z);
  await rapidToMPos(sp.x, sp.y, null);
  const radius = cfg.probeDiameter / 2;
  const ex = isX ? result.x - dir * radius : result.x;
  const ey = !isX ? result.y - dir * radius : result.y;
  const opts = { mode: cfg.coordMode, wcs: cfg.wcs };
  applyXYResult(ex, ey, axis, opts);
  log('info', `✓ Edge ${edge}: X=${ex.toFixed(4)} Y=${ey.toFixed(4)}`);
  return true;
}

async function probeCorner(cfg: any, sp: { x: number; y: number; z: number }, clr: number): Promise<boolean> {
  const edge = cfg.edge;
  const signs: Record<string, { x: number; y: number }> = {
    A: { x: 1, y: 1 },
    B: { x: -1, y: 1 },
    C: { x: -1, y: -1 },
    D: { x: 1, y: -1 },
  };
  const s = cfg.mode === 'external' ? signs[edge] : { x: -signs[edge].x, y: -signs[edge].y };
  log('info', `Edge finder: probing corner ${edge}…`);
  await rapidToMPos(null, sp.y + cfg.offset * s.y, null);
  await rapidToMPos(sp.x - s.x * clr, null, null);
  await rapidToMPos(null, null, sp.z - cfg.depth);
  const rx = await probeAxis('X', s.x, cfg.probeFeedRate, cfg.latchFeedRate, cfg.probeDistance, cfg.latchDistance);
  if (!rx) {
    await rapidToMPos(null, null, sp.z);
    log('err', `✗ Corner ${edge} X probe failed`);
    return false;
  }
  await rapidToMPos(null, null, sp.z);
  await rapidToMPos(sp.x, sp.y, null);
  await rapidToMPos(sp.x + cfg.offset * s.x, null, null);
  await rapidToMPos(null, sp.y - s.y * clr, null);
  await rapidToMPos(null, null, sp.z - cfg.depth);
  const ry = await probeAxis('Y', s.y, cfg.probeFeedRate, cfg.latchFeedRate, cfg.probeDistance, cfg.latchDistance);
  if (!ry) {
    await rapidToMPos(null, null, sp.z);
    log('err', `✗ Corner ${edge} Y probe failed`);
    return false;
  }
  await rapidToMPos(null, null, sp.z);
  const radius = cfg.probeDiameter / 2;
  const ex = rx.x - s.x * radius;
  const ey = ry.y - s.y * radius;
  let ez: number | null = null;
  if (cfg.probeZ) {
    await rapidToMPos(ex + s.x * radius, ey + s.y * radius, null);
    const rz = await probeAxis('Z', -1, cfg.probeFeedRate, cfg.latchFeedRate, cfg.probeDistance, cfg.latchDistance);
    if (rz) ez = rz.z;
    await rapidToMPos(null, null, sp.z);
  }
  await rapidToMPos(ex, ey, null);
  const opts = { mode: cfg.coordMode, wcs: cfg.wcs };
  applyXYResult(ex, ey, 'XY', opts);
  if (ez !== null) applyZResult(ez, cfg.touchPlateHeight, cfg.workpieceHeight, opts);
  log('info', `✓ Corner ${edge}: X=${ex.toFixed(4)} Y=${ey.toFixed(4)}${ez !== null ? ' Z=' + ez.toFixed(4) : ''}`);
  return true;
}
