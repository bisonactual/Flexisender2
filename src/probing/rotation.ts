// ═══════════════════════════════════════════════
// Rotation measurement probe logic
// ═══════════════════════════════════════════════

import { state } from '../state';
import { log } from '../console';
import { probeAxis, rapidToMPos, isProbingRunning } from './probe-program';

function startPos() {
  return { x: (state as any).machineX, y: (state as any).machineY, z: (state as any).machineZ };
}

export async function runRotation(cfg: any): Promise<{ angleDeg: number; p1: { x: number; y: number }; p2: { x: number; y: number } } | null> {
  if (!state.connected) { log('err', 'Not connected'); return null; }
  if (isProbingRunning()) { log('err', 'Probe already running'); return null; }
  const sp = startPos();
  const clr = cfg.xyClr + cfg.probeDiameter / 2;
  const probeX = cfg.edge === 'AB' || cfg.edge === 'CD';
  const probeAx = probeX ? 'X' : 'Y';
  const dirMap: Record<string, number> = { AB: 1, CD: -1, AD: 1, CB: -1 };
  const dir = dirMap[cfg.edge];

  log('info', `Rotation: probing two points along ${probeAx} edge (${cfg.edge})…`);

  const approachX1 = probeX ? sp.x - dir * clr : null;
  const approachY1 = !probeX ? sp.y - dir * clr : null;
  await rapidToMPos(approachX1, approachY1, null);
  await rapidToMPos(null, null, sp.z - cfg.depth);
  const r1 = await probeAxis(probeAx, dir, cfg.probeFeedRate, cfg.latchFeedRate, cfg.probeDistance, cfg.latchDistance);
  if (!r1) { await rapidToMPos(null, null, sp.z); log('err', '✗ Rotation: point 1 probe failed'); return null; }
  await rapidToMPos(null, null, sp.z);

  const approachX2 = probeX ? sp.x - dir * clr : sp.x + cfg.offset;
  const approachY2 = !probeX ? sp.y - dir * clr : sp.y + cfg.offset;
  await rapidToMPos(approachX2, approachY2, null);
  await rapidToMPos(null, null, sp.z - cfg.depth);
  const r2 = await probeAxis(probeAx, dir, cfg.probeFeedRate, cfg.latchFeedRate, cfg.probeDistance, cfg.latchDistance);
  if (!r2) { await rapidToMPos(null, null, sp.z); log('err', '✗ Rotation: point 2 probe failed'); return null; }
  await rapidToMPos(null, null, sp.z);
  await rapidToMPos(sp.x, sp.y, null);

  const p1 = { x: r1.x, y: r1.y };
  const p2 = { x: r2.x, y: r2.y };
  let angleRad: number;
  if (probeX) {
    const dy = p2.y - p1.y;
    const dx = p2.x - p1.x;
    angleRad = dy !== 0 ? Math.atan(dx / dy) : 0;
  } else {
    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;
    angleRad = dx !== 0 ? Math.atan(dy / dx) : 0;
    if (cfg.edge === 'CB' || cfg.edge === 'AD') angleRad = -1 / (angleRad || 1e-10);
  }
  const angleDeg = angleRad * 180 / Math.PI;
  log('info', `✓ Rotation measured: ${angleDeg.toFixed(3)}°`);
  log('info', `  P1: X=${p1.x.toFixed(4)} Y=${p1.y.toFixed(4)}`);
  log('info', `  P2: X=${p2.x.toFixed(4)} Y=${p2.y.toFixed(4)}`);
  return { angleDeg, p1, p2 };
}

export function applyRotationToGcode(angleDeg: number): void {
  if (!(state as any).gcodeLines || (state as any).gcodeLines.length === 0) {
    log('err', 'No G-code loaded to rotate');
    return;
  }
  const angleRad = angleDeg * Math.PI / 180;
  const cos = Math.cos(angleRad);
  const sin = Math.sin(angleRad);
  const rotated: string[] = [];
  let curX = 0, curY = 0;
  for (const line of (state as any).gcodeLines) {
    const xm = line.match(/X([+-]?[\d.]+)/i);
    const ym = line.match(/Y([+-]?[\d.]+)/i);
    if (!xm && !ym) { rotated.push(line); continue; }
    const ox = xm ? parseFloat(xm[1]) : curX;
    const oy = ym ? parseFloat(ym[1]) : curY;
    const rx = ox * cos - oy * sin;
    const ry = ox * sin + oy * cos;
    let newLine = line;
    if (xm) newLine = newLine.replace(xm[0], 'X' + rx.toFixed(4));
    if (ym) newLine = newLine.replace(ym[0], 'Y' + ry.toFixed(4));
    curX = ox;
    curY = oy;
    rotated.push(newLine);
  }
  (state as any).gcodeLines = rotated;
  log('info', `G-code rotated by ${angleDeg.toFixed(3)}° (${(state as any).gcodeLines.length} lines)`);
}
