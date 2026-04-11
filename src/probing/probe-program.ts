// ═══════════════════════════════════════════════
// Core probing engine — WCS mapping, probe/idle
// waiting, tool length sequences
// ═══════════════════════════════════════════════

import { state } from '../state';
import { log } from '../console';
import { sendCmd } from '../connection';

export const WCS_P: Record<string, number> = {
  G54: 1,
  G55: 2,
  G56: 3,
  G57: 4,
  G58: 5,
  G59: 6,
  'G59.1': 7,
  'G59.2': 8,
  'G59.3': 9,
};

let _running = false;
let _cancelled = false;
let _probeResult: ProbeResult | null = null;
let _probeResolve: ((r: ProbeResult | null) => void) | null = null;
let _idleResolve: (() => void) | null = null;
let _idleTimeout: ReturnType<typeof setTimeout> | null = null;

interface ProbeResult {
  x: number;
  y: number;
  z: number;
  success: boolean;
}

export function getActiveWcs(): string {
  return (state as any).activeWcs || 'G54';
}

export function applyXYResult(x: number, y: number, axes: string, opts: { mode?: string; wcs?: string; xOffset?: number; yOffset?: number }): void {
  const wcs = opts.wcs || getActiveWcs();
  const xOff = opts.xOffset ?? 0;
  const yOff = opts.yOffset ?? 0;
  const fx = (x + xOff).toFixed(4);
  const fy = (y + yOff).toFixed(4);
  if (opts.mode === 'G92') {
    const parts = axes === 'XY' ? `X${fx}Y${fy}` : axes === 'X' ? `X${fx}` : `Y${fy}`;
    sendCmd(`G92${parts}`);
  } else if (opts.mode === 'G10') {
    const p = WCS_P[wcs] ?? 1;
    const parts = axes === 'XY' ? `X${fx}Y${fy}` : axes === 'X' ? `X${fx}` : `Y${fy}`;
    sendCmd(`G10L2P${p}${parts}`);
  }
  log('info', `Probed ${axes}: X=${fx} Y=${fy} → ${wcs} (${opts.mode})`);
}

export function applyZResult(z: number, plateHeight: number, wcsHeight: number, opts: { mode?: string; wcs?: string }): void {
  const wcs = opts.wcs || getActiveWcs();
  const fz = (z - plateHeight - wcsHeight).toFixed(4);
  if (opts.mode === 'G92') {
    sendCmd(`G92Z${fz}`);
  } else if (opts.mode === 'G10') {
    const p = WCS_P[wcs] ?? 1;
    sendCmd(`G10L2P${p}Z${fz}`);
  }
  log('info', `Probed Z: raw=${z.toFixed(4)} plate=${plateHeight} → Z${fz} → ${wcs} (${opts.mode})`);
}

export function isProbingRunning(): boolean {
  return _running;
}

export function probingIntercept(raw: string): boolean {
  const m = raw.match(/^\[PRB:([^,]+),([^,]+),([^:]+):(\d)\]$/);
  if (!m) return false;
  const result: ProbeResult = {
    x: parseFloat(m[1]),
    y: parseFloat(m[2]),
    z: parseFloat(m[3]),
    success: m[4] === '1',
  };
  _probeResult = result;
  if (_probeResolve) {
    _probeResolve(result);
    _probeResolve = null;
  }
  return false;
}

export function probingIdleNotify(machineState: string): void {
  const sl = machineState.toLowerCase().split(':')[0];
  if ((sl === 'idle' || sl === 'alarm') && _idleResolve) {
    if (_idleTimeout) clearTimeout(_idleTimeout);
    _idleResolve();
    _idleResolve = null;
  }
}

function waitIdle(timeoutMs = 30000): Promise<boolean> {
  return new Promise((resolve) => {
    if (!_running || _cancelled) { resolve(false); return; }
    _idleResolve = () => resolve(true);
    _idleTimeout = setTimeout(() => {
      _idleResolve = null;
      resolve(false);
    }, timeoutMs);
  });
}

function waitProbe(timeoutMs = 15000): Promise<ProbeResult | null> {
  return new Promise((resolve) => {
    if (!_running || _cancelled) { resolve(null); return; }
    _probeResult = null;
    _probeResolve = resolve;
    setTimeout(() => {
      if (_probeResolve) {
        _probeResolve = null;
        resolve(null);
      }
    }, timeoutMs);
  });
}

async function sendAndWait(cmd: string, timeoutMs = 30000): Promise<boolean> {
  if (_cancelled) return false;
  sendCmd(cmd);
  return waitIdle(timeoutMs);
}

export function cancelProbing(): void {
  _cancelled = true;
  _running = false;
  if (_idleResolve) { _idleResolve(); _idleResolve = null; }
  if (_probeResolve) { _probeResolve(null); _probeResolve = null; }
  if (_idleTimeout) { clearTimeout(_idleTimeout); _idleTimeout = null; }
}

export async function runToolLengthProbe(seq: any): Promise<ProbeResult | null> {
  if (!state.connected) { log('err', 'Not connected'); return null; }
  if (_running) { log('err', 'Probing already in progress'); return null; }
  (window as any).clearPreview3D?.();
  _running = true;
  _cancelled = false;
  _probeResult = null;
  try {
    if (seq.mode === 'toolsetter') {
      return await runToolsetterSequence(seq);
    } else {
      return await runTouchplateSequence(seq);
    }
  } finally {
    _running = false;
  }
}

export async function probeAxis(
  axis: string, direction: number,
  probeFeedRate: number, latchFeedRate: number,
  probeDistance: number, latchDistance: number
): Promise<ProbeResult | null> {
  if (_cancelled) return null;
  const sign = direction < 0 ? '-' : '';
  const dist = probeDistance.toFixed(4);
  const latch = latchDistance.toFixed(4);
  const latch2 = (latchDistance * 2).toFixed(4);
  sendCmd(`G38.3G91F${probeFeedRate}${axis}${sign}${dist}`);
  const fast = await waitProbe();
  if (!fast || !fast.success) return null;
  const retractSign = direction < 0 ? '' : '-';
  if (!await sendAndWait(`G91G0${axis}${retractSign}${latch}`)) return null;
  sendCmd(`G38.3G91F${latchFeedRate}${axis}${sign}${latch2}`);
  const slow = await waitProbe();
  if (!slow || !slow.success) return null;
  if (!await sendAndWait(`G91G0${axis}${retractSign}${latch}`)) return null;
  return slow;
}

export async function rapidToMPos(x: number | null, y: number | null, z: number | null): Promise<boolean> {
  if (_cancelled) return false;
  let cmd = 'G53G0';
  if (x !== null) cmd += `X${x.toFixed(4)}`;
  if (y !== null) cmd += `Y${y.toFixed(4)}`;
  if (z !== null) cmd += `Z${z.toFixed(4)}`;
  return sendAndWait(cmd);
}

async function runTouchplateSequence(seq: any): Promise<ProbeResult | null> {
  log('info', '⊕ Touch plate probe starting…');
  const fastCmd = `G38.3G91F${seq.probeFeedRate}Z-${seq.probeDistance.toFixed(4)}`;
  sendCmd(fastCmd);
  const fastResult = await waitProbe();
  if (!fastResult || !fastResult.success) {
    log('err', '✗ Probe: no contact on fast probe — check probe wiring and position');
    await sendAndWait(`G91G0Z${seq.latchDistance.toFixed(4)}`);
    return null;
  }
  if (!await sendAndWait(`G91G0Z${seq.latchDistance.toFixed(4)}`)) {
    log('err', '✗ Probe: failed to retract after fast probe');
    return null;
  }
  const slowCmd = `G38.3G91F${seq.latchFeedRate}Z-${(seq.latchDistance * 2).toFixed(4)}`;
  sendCmd(slowCmd);
  const slowResult = await waitProbe();
  if (!slowResult || !slowResult.success) {
    log('err', '✗ Probe: no contact on slow probe');
    await sendAndWait(`G91G0Z${seq.latchDistance.toFixed(4)}`);
    return null;
  }
  await sendAndWait(`G90G53G0Z${(state as any).machineZ.toFixed(4)}`);
  log('info', `✓ Touch plate probe: Z=${slowResult.z.toFixed(4)}`);
  return slowResult;
}

async function runToolsetterSequence(seq: any): Promise<ProbeResult | null> {
  if (seq.toolsetterX === undefined || seq.toolsetterY === undefined || seq.toolsetterZ === undefined) {
    log('err', '✗ Toolsetter: G59.3 position not set — configure it in the Offsets tab');
    return null;
  }
  const startX = (state as any).machineX;
  const startY = (state as any).machineY;
  const startZ = (state as any).machineZ;
  const depth = seq.toolsetterDepth ?? 10;
  log('info', '⊕ Toolsetter probe starting…');
  if (!await sendAndWait(`G53G0Z0`)) { log('err', '✗ Toolsetter: could not rapid to Z home'); return null; }
  if (!await sendAndWait(`G53G0X${seq.toolsetterX.toFixed(4)}Y${seq.toolsetterY.toFixed(4)}`)) {
    log('err', '✗ Toolsetter: could not rapid to toolsetter XY'); return null;
  }
  const approachZ = seq.toolsetterZ + depth;
  if (!await sendAndWait(`G53G0Z${approachZ.toFixed(4)}`)) {
    log('err', '✗ Toolsetter: could not approach toolsetter Z'); return null;
  }
  const fastCmd = `G38.3G91F${seq.probeFeedRate}Z-${(depth + 5).toFixed(4)}`;
  sendCmd(fastCmd);
  const fastResult = await waitProbe();
  if (!fastResult || !fastResult.success) {
    log('err', '✗ Toolsetter: no contact on fast probe');
    await sendAndWait(`G53G0Z0`);
    await sendAndWait(`G53G0X${startX.toFixed(4)}Y${startY.toFixed(4)}`);
    return null;
  }
  if (!await sendAndWait(`G91G0Z${seq.latchDistance.toFixed(4)}`)) {
    log('err', '✗ Toolsetter: failed to retract'); return null;
  }
  const slowCmd = `G38.3G91F${seq.latchFeedRate}Z-${(seq.latchDistance * 2).toFixed(4)}`;
  sendCmd(slowCmd);
  const slowResult = await waitProbe();
  if (!slowResult || !slowResult.success) {
    log('err', '✗ Toolsetter: no contact on slow probe');
    await sendAndWait(`G53G0Z0`);
    await sendAndWait(`G53G0X${startX.toFixed(4)}Y${startY.toFixed(4)}`);
    return null;
  }
  await sendAndWait(`G53G0Z0`);
  await sendAndWait(`G53G0X${startX.toFixed(4)}Y${startY.toFixed(4)}`);
  await sendAndWait(`G53G0Z${startZ.toFixed(4)}`);
  log('info', `✓ Toolsetter probe: Z=${slowResult.z.toFixed(4)}`);
  return slowResult;
}
