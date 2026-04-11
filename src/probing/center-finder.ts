// ═══════════════════════════════════════════════
// Center finder probe logic
// ═══════════════════════════════════════════════

import { state } from '../state';
import { log } from '../console';
import { probeAxis, rapidToMPos, applyXYResult, isProbingRunning } from './probe-program';

function startPos() {
  return { x: (state as any).machineX, y: (state as any).machineY, z: (state as any).machineZ };
}

export async function runCenterFinder(cfg: any): Promise<boolean> {
  if (!state.connected) { log('err', 'Not connected'); return false; }
  if (isProbingRunning()) { log('err', 'Probe already running'); return false; }
  const sp = startPos();
  let centerX = sp.x;
  let centerY = sp.y;
  for (let pass = 0; pass < cfg.passes; pass++) {
    if (pass > 0) log('info', `Center finder: pass ${pass + 1}/${cfg.passes}`);
    const result = await probeCenter(cfg, { x: centerX, y: centerY, z: sp.z });
    if (!result) return false;
    centerX = result.x;
    centerY = result.y;
    if (pass < cfg.passes - 1) {
      await rapidToMPos(centerX, centerY, null);
    }
  }
  await rapidToMPos(centerX, centerY, null);
  const opts = { mode: cfg.coordMode, wcs: cfg.wcs };
  applyXYResult(centerX, centerY, cfg.axes === 'X' ? 'X' : cfg.axes === 'Y' ? 'Y' : 'XY', opts);
  log('info', `✓ Center found: X=${centerX.toFixed(4)} Y=${centerY.toFixed(4)}`);
  return true;
}

async function probeCenter(cfg: any, sp: { x: number; y: number; z: number }): Promise<{ x: number; y: number } | null> {
  const clr = cfg.xyClr + cfg.probeDiameter / 2;
  const radius = cfg.probeDiameter / 2;
  let x1: number | null = null, x2: number | null = null;
  let y1: number | null = null, y2: number | null = null;

  if (cfg.centerMode === 'inside') {
    await rapidToMPos(null, null, sp.z - cfg.depth);
  }

  if (cfg.axes !== 'Y') {
    const halfX = cfg.workpieceSizeX / 2;
    if (cfg.centerMode === 'inside') {
      const rapid = halfX - clr;
      if (rapid > 1) await rapidToMPos(sp.x - rapid, null, null);
      const r1 = await probeAxis('X', 1, cfg.probeFeedRate, cfg.latchFeedRate, halfX + clr, cfg.latchDistance);
      if (!r1) { await rapidToMPos(null, null, sp.z); log('err', '✗ Center X- probe failed'); return null; }
      x1 = r1.x + radius;
      await rapidToMPos(sp.x + rapid, null, null);
      const r2 = await probeAxis('X', -1, cfg.probeFeedRate, cfg.latchFeedRate, halfX + clr, cfg.latchDistance);
      if (!r2) { await rapidToMPos(null, null, sp.z); log('err', '✗ Center X+ probe failed'); return null; }
      x2 = r2.x - radius;
    } else {
      await rapidToMPos(sp.x - halfX - clr, null, null);
      const r1 = await probeAxis('X', 1, cfg.probeFeedRate, cfg.latchFeedRate, halfX + clr + 5, cfg.latchDistance);
      if (!r1) { await rapidToMPos(null, null, sp.z); log('err', '✗ Center X- probe failed'); return null; }
      x1 = r1.x - radius;
      await rapidToMPos(null, null, sp.z);
      await rapidToMPos(sp.x + halfX + clr, null, null);
      await rapidToMPos(null, null, sp.z - cfg.depth);
      const r2 = await probeAxis('X', -1, cfg.probeFeedRate, cfg.latchFeedRate, halfX + clr + 5, cfg.latchDistance);
      if (!r2) { await rapidToMPos(null, null, sp.z); log('err', '✗ Center X+ probe failed'); return null; }
      x2 = r2.x + radius;
    }
    await rapidToMPos(sp.x, null, null);
  }

  if (cfg.axes !== 'X') {
    const halfY = cfg.workpieceSizeY / 2;
    if (cfg.centerMode === 'inside') {
      const rapid = halfY - clr;
      if (rapid > 1) await rapidToMPos(null, sp.y - rapid, null);
      const r1 = await probeAxis('Y', 1, cfg.probeFeedRate, cfg.latchFeedRate, halfY + clr, cfg.latchDistance);
      if (!r1) { await rapidToMPos(null, null, sp.z); log('err', '✗ Center Y- probe failed'); return null; }
      y1 = r1.y + radius;
      await rapidToMPos(null, sp.y + rapid, null);
      const r2 = await probeAxis('Y', -1, cfg.probeFeedRate, cfg.latchFeedRate, halfY + clr, cfg.latchDistance);
      if (!r2) { await rapidToMPos(null, null, sp.z); log('err', '✗ Center Y+ probe failed'); return null; }
      y2 = r2.y - radius;
    } else {
      await rapidToMPos(null, sp.y - halfY - clr, null);
      const r1 = await probeAxis('Y', 1, cfg.probeFeedRate, cfg.latchFeedRate, halfY + clr + 5, cfg.latchDistance);
      if (!r1) { await rapidToMPos(null, null, sp.z); log('err', '✗ Center Y- probe failed'); return null; }
      y1 = r1.y - radius;
      await rapidToMPos(null, null, sp.z);
      await rapidToMPos(null, sp.y + halfY + clr, null);
      await rapidToMPos(null, null, sp.z - cfg.depth);
      const r2 = await probeAxis('Y', -1, cfg.probeFeedRate, cfg.latchFeedRate, halfY + clr + 5, cfg.latchDistance);
      if (!r2) { await rapidToMPos(null, null, sp.z); log('err', '✗ Center Y+ probe failed'); return null; }
      y2 = r2.y + radius;
    }
    await rapidToMPos(null, sp.y, null);
  }

  await rapidToMPos(null, null, sp.z);
  const cx = (x1 !== null && x2 !== null) ? (x1 + x2) / 2 : sp.x;
  const cy = (y1 !== null && y2 !== null) ? (y1 + y2) / 2 : sp.y;
  const xDist = (x1 !== null && x2 !== null) ? Math.abs(x2 - x1) : null;
  const yDist = (y1 !== null && y2 !== null) ? Math.abs(y2 - y1) : null;
  if (xDist !== null || yDist !== null) {
    log('info', `Center size:${xDist !== null ? ' X=' + xDist.toFixed(3) : ''}${yDist !== null ? ' Y=' + yDist.toFixed(3) : ''} mm`);
  }
  return { x: cx, y: cy };
}
