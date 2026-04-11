// ═══════════════════════════════════════════════
// Surfacing (Planer) tool — generates G-code for
// fly-cutting / surface planing operations
// ═══════════════════════════════════════════════

import { h } from '../../jsx';
import { lsGet, lsSet } from '../../ui';
import { log } from '../../console';
import { processGcode } from '../../gcode';
import { state } from '../../state';

const SAVE_KEY = 'fs-tool-surfacing';

interface SurfacingConfig {
  xSize: number; ySize: number;
  targetDepth: number; depthPerPass: number;
  stepoverPct: number; bitDiameter: number;
  feedRate: number; plungeRate: number;
  spindleRpm: number; spindleDelay: number;
  overrun: number;
  pattern: 'zigzagX' | 'zigzagY' | 'spiral';
  origin: 'bottom-left' | 'bottom-right' | 'top-left' | 'top-right' | 'center';
  startPos: 'current' | 'G54' | 'G55' | 'G56' | 'G57' | 'G58' | 'G59';
}

const DEFAULTS: SurfacingConfig = {
  xSize: 100, ySize: 100,
  targetDepth: 0.5, depthPerPass: 0.5,
  stepoverPct: 80, bitDiameter: 25.4,
  feedRate: 2000, plungeRate: 200,
  spindleRpm: 15000, spindleDelay: 5,
  overrun: 5,
  pattern: 'zigzagY',
  origin: 'bottom-left',
  startPos: 'current',
};

function loadCfg(): SurfacingConfig { return { ...DEFAULTS, ...lsGet(SAVE_KEY, {}) }; }
function saveCfg(c: SurfacingConfig): void { lsSet(SAVE_KEY, c); }
function numVal(id: string): number { return parseFloat((document.getElementById(id) as HTMLInputElement)?.value || '0') || 0; }
function selVal(id: string): string { return (document.getElementById(id) as HTMLSelectElement)?.value || ''; }

interface Waypoint { x: number; y: number; z: number; type: string; label: string; }

function generateWaypoints(cfg: SurfacingConfig): Waypoint[] {
  const { xSize, ySize, targetDepth, depthPerPass, stepoverPct, bitDiameter, overrun, pattern, origin } = cfg;
  const stepover = (bitDiameter * stepoverPct) / 100;
  const numDepthPasses = Math.ceil(targetDepth / depthPerPass);
  const isZigzagX = pattern === 'zigzagX';
  const isSpiral = pattern === 'spiral';

  // Origin corner offset
  let startX = 0, startY = 0;
  if (origin === 'bottom-right') startX = -xSize;
  else if (origin === 'top-left') startY = -ySize;
  else if (origin === 'top-right') { startX = -xSize; startY = -ySize; }
  else if (origin === 'center') { startX = -xSize / 2; startY = -ySize / 2; }

  // WCS offset — shift everything to the selected WCS zero
  const sp = resolveStartOffset(cfg);
  startX += sp.x;
  startY += sp.y;

  const ax = startX - overrun, ay = startY - overrun;
  const aw = xSize + overrun * 2, ah = ySize + overrun * 2;
  const wps: Waypoint[] = [{ x: ax, y: ay, z: 0, type: 'start', label: 'Start' }];

  let currentDepth = 0;
  for (let dp = 0; dp < numDepthPasses; dp++) {
    currentDepth = Math.min(currentDepth + depthPerPass, targetDepth);
    const z = -currentDepth;
    wps.push({ x: ax, y: ay, z: 0, type: 'rapid', label: `Move to start` });
    wps.push({ x: ax, y: ay, z, type: 'probe', label: `Pass ${dp + 1} Z${z.toFixed(2)}` });

    if (isSpiral) {
      let left = ax, right = ax + aw, top = ay, bottom = ay + ah;
      const step = Math.max(stepover, 0.1);
      while (right - left > 0 && bottom - top > 0) {
        wps.push({ x: right, y: top, z, type: 'probe', label: 'Spiral cut' });
        top += step; if (top >= bottom) break;
        wps.push({ x: right, y: bottom, z, type: 'probe', label: 'Spiral cut' });
        right -= step; if (left >= right) break;
        wps.push({ x: left, y: bottom, z, type: 'probe', label: 'Spiral cut' });
        bottom -= step; if (top >= bottom) break;
        wps.push({ x: left, y: top, z, type: 'probe', label: 'Spiral cut' });
        left += step; if (left >= right) break;
      }
    } else {
      const stepDim = isZigzagX ? aw : ah;
      const numPasses = Math.ceil(stepDim / stepover) + 1;
      let dir = 1;
      for (let p = 0; p < numPasses; p++) {
        if (isZigzagX) {
          const yp = ay + p * stepover;
          wps.push({ x: dir === 1 ? ax + aw : ax, y: yp, z, type: 'probe', label: `Row ${p + 1}` });
        } else {
          const xp = ax + p * stepover;
          wps.push({ x: xp, y: dir === 1 ? ay + ah : ay, z, type: 'probe', label: `Col ${p + 1}` });
        }
        dir *= -1;
      }
    }
    wps.push({ x: wps[wps.length - 1].x, y: wps[wps.length - 1].y, z: 0, type: 'retract', label: 'Retract' });
  }
  return wps;
}

function readCfgFromUI(): SurfacingConfig {
  return {
    xSize: numVal('sfXSize'), ySize: numVal('sfYSize'),
    targetDepth: numVal('sfDepth'), depthPerPass: numVal('sfDepthPerPass'),
    stepoverPct: numVal('sfStepover'), bitDiameter: numVal('sfBitDia'),
    feedRate: numVal('sfFeed'), plungeRate: numVal('sfPlunge'),
    spindleRpm: numVal('sfRpm'), spindleDelay: numVal('sfDelay'),
    overrun: numVal('sfOverrun'),
    pattern: selVal('sfPattern') as SurfacingConfig['pattern'],
    origin: selVal('sfOrigin') as SurfacingConfig['origin'],
    startPos: selVal('sfStartPos') as SurfacingConfig['startPos'],
  };
}

/** Resolve the start position offset based on config */
function resolveStartOffset(cfg: SurfacingConfig): { x: number; y: number } {
  if (cfg.startPos === 'current') return { x: 0, y: 0 };
  const wcs = state.wcsOffsets[cfg.startPos];
  if (!wcs) return { x: 0, y: 0 };
  // WCS offset is where zero is in machine coords — we want to position relative to it
  return { x: wcs.x - state.machineX, y: wcs.y - state.machineY };
}

function generateGcode(cfg: SurfacingConfig): string {
  const { xSize, ySize, targetDepth, depthPerPass, stepoverPct, bitDiameter,
          feedRate, plungeRate, spindleRpm, spindleDelay, overrun, pattern, origin } = cfg;

  const stepover = (bitDiameter * stepoverPct) / 100;
  const numDepthPasses = Math.ceil(targetDepth / depthPerPass);
  const isZigzagX = pattern === 'zigzagX';
  const isSpiral = pattern === 'spiral';

  // Origin offset
  let startX = 0, startY = 0;
  if (origin === 'bottom-right') startX = -xSize;
  else if (origin === 'top-left') startY = -ySize;
  else if (origin === 'top-right') { startX = -xSize; startY = -ySize; }
  else if (origin === 'center') { startX = -xSize / 2; startY = -ySize / 2; }

  const ax = startX - overrun;
  const ay = startY - overrun;
  const aw = xSize + overrun * 2;
  const ah = ySize + overrun * 2;

  const g: string[] = [];
  g.push('(Surfacing Operation)');
  g.push(`(Area: ${xSize} x ${ySize} mm, Depth: ${targetDepth} mm in ${numDepthPasses} passes)`);
  g.push(`(Bit: ${bitDiameter} mm, Stepover: ${stepoverPct}%, Overrun: ${overrun} mm)`);
  g.push(`(Feed: ${feedRate} mm/min, Plunge: ${plungeRate} mm/min, RPM: ${spindleRpm})`);
  g.push('');
  g.push('G21 ; Metric');
  g.push('G90 ; Absolute');
  g.push('G94 ; Feed/min');
  if (cfg.startPos !== 'current') {
    g.push(`${cfg.startPos} ; Select WCS`);
  }
  g.push('');
  g.push('G53 G0 Z0');
  g.push(`G0 X${ax.toFixed(3)} Y${ay.toFixed(3)}`);
  if (spindleRpm > 0) g.push(`M3 S${spindleRpm}`);
  if (spindleDelay > 0) g.push(`G4 P${spindleDelay}`);
  g.push('G0 Z5.000');
  g.push('');

  let currentDepth = 0;
  for (let dp = 0; dp < numDepthPasses; dp++) {
    currentDepth = Math.min(currentDepth + depthPerPass, targetDepth);
    const z = -currentDepth;
    g.push(`(Pass ${dp + 1}/${numDepthPasses} Z${z.toFixed(3)})`);
    g.push(`G0 X${ax.toFixed(3)} Y${ay.toFixed(3)}`);
    g.push(`G1 Z${z.toFixed(3)} F${plungeRate}`);

    if (isSpiral) {
      let left = ax, right = ax + aw, top = ay, bottom = ay + ah;
      const step = Math.max(stepover, 0.1);
      while (right - left > 0 && bottom - top > 0) {
        g.push(`G1 X${right.toFixed(3)} Y${top.toFixed(3)} F${feedRate}`);
        top += step; if (top >= bottom) break;
        g.push(`G1 X${right.toFixed(3)} Y${bottom.toFixed(3)} F${feedRate}`);
        right -= step; if (left >= right) break;
        g.push(`G1 X${left.toFixed(3)} Y${bottom.toFixed(3)} F${feedRate}`);
        bottom -= step; if (top >= bottom) break;
        g.push(`G1 X${left.toFixed(3)} Y${top.toFixed(3)} F${feedRate}`);
        left += step; if (left >= right) break;
        g.push(`G1 X${left.toFixed(3)} Y${top.toFixed(3)} F${feedRate}`);
      }
    } else {
      const stepDim = isZigzagX ? aw : ah;
      const numPasses = Math.ceil(stepDim / stepover) + 1;
      let dir = 1;
      for (let p = 0; p < numPasses; p++) {
        if (isZigzagX) {
          const yp = ay + p * stepover;
          if (p > 0) g.push(`G1 Y${yp.toFixed(3)} F${feedRate}`);
          g.push(`G1 X${(dir === 1 ? ax + aw : ax).toFixed(3)} F${feedRate}`);
        } else {
          const xp = ax + p * stepover;
          if (p > 0) g.push(`G1 X${xp.toFixed(3)} F${feedRate}`);
          g.push(`G1 Y${(dir === 1 ? ay + ah : ay).toFixed(3)} F${feedRate}`);
        }
        dir *= -1;
      }
    }
    g.push('G0 Z5.000');
    g.push('');
  }

  g.push('G53 G0 Z0');
  if (spindleRpm > 0) g.push('M5');
  g.push('M30');
  return g.join('\n');
}

export function mount(parent: HTMLElement): void {
  const cfg = loadCfg();
  const card = (
    <div class="module-card mod-hidden" id="mod-surfacing" dataset={{ modSize: 'normal' }} style="top:10px;left:10px">
      <div class="module-drag-handle">
        <span class="module-drag-dots">⠿⠿</span>
        <span class="module-drag-title">Surfacing</span>
        <button class="module-drag-close" onClick={() => card.classList.add('mod-hidden')}>✕</button>
      </div>
      <div class="module-body" style="gap:8px">
        <div class="tl-section">
          <div class="tl-section-label">Dimensions (mm)</div>
          <div class="tl-row"><span class="tl-label">X size</span><input type="number" class="tl-input" id="sfXSize" value={String(cfg.xSize)} min="1" step="10" /></div>
          <div class="tl-row"><span class="tl-label">Y size</span><input type="number" class="tl-input" id="sfYSize" value={String(cfg.ySize)} min="1" step="10" /></div>
          <div class="tl-row"><span class="tl-label">Target depth</span><input type="number" class="tl-input" id="sfDepth" value={String(cfg.targetDepth)} min="0.1" step="0.1" /></div>
          <div class="tl-row"><span class="tl-label">Depth/pass</span><input type="number" class="tl-input" id="sfDepthPerPass" value={String(cfg.depthPerPass)} min="0.1" step="0.1" /></div>
          <div class="tl-row"><span class="tl-label">Overrun</span><input type="number" class="tl-input" id="sfOverrun" value={String(cfg.overrun)} min="0" step="1" /></div>
        </div>
        <div class="tl-section">
          <div class="tl-section-label">Tool & Feed</div>
          <div class="tl-row"><span class="tl-label">Bit diameter</span><input type="number" class="tl-input" id="sfBitDia" value={String(cfg.bitDiameter)} min="0.1" step="0.1" /></div>
          <div class="tl-row"><span class="tl-label">Stepover %</span><input type="number" class="tl-input" id="sfStepover" value={String(cfg.stepoverPct)} min="10" max="100" step="5" /></div>
          <div class="tl-row"><span class="tl-label">Feed rate</span><input type="number" class="tl-input" id="sfFeed" value={String(cfg.feedRate)} min="1" step="100" /></div>
          <div class="tl-row"><span class="tl-label">Plunge rate</span><input type="number" class="tl-input" id="sfPlunge" value={String(cfg.plungeRate)} min="1" step="50" /></div>
          <div class="tl-row"><span class="tl-label">Spindle RPM</span><input type="number" class="tl-input" id="sfRpm" value={String(cfg.spindleRpm)} min="0" step="1000" /></div>
          <div class="tl-row"><span class="tl-label">Spindle delay (s)</span><input type="number" class="tl-input" id="sfDelay" value={String(cfg.spindleDelay)} min="0" max="30" step="1" /></div>
        </div>
        <div class="tl-section">
          <div class="tl-section-label">Pattern</div>
          <div class="tl-row">
            <span class="tl-label">Start position</span>
            <select class="tl-input" id="sfStartPos" style="text-align:center">
              <option value="current" selected={cfg.startPos === 'current'}>Current position</option>
              <option value="G54" selected={cfg.startPos === 'G54'}>G54</option>
              <option value="G55" selected={cfg.startPos === 'G55'}>G55</option>
              <option value="G56" selected={cfg.startPos === 'G56'}>G56</option>
              <option value="G57" selected={cfg.startPos === 'G57'}>G57</option>
              <option value="G58" selected={cfg.startPos === 'G58'}>G58</option>
              <option value="G59" selected={cfg.startPos === 'G59'}>G59</option>
            </select>
          </div>
          <div class="tl-row">
            <span class="tl-label">Direction</span>
            <select class="tl-input" id="sfPattern" style="text-align:center">
              <option value="zigzagY" selected={cfg.pattern === 'zigzagY'}>Vertical</option>
              <option value="zigzagX" selected={cfg.pattern === 'zigzagX'}>Horizontal</option>
              <option value="spiral" selected={cfg.pattern === 'spiral'}>Spiral</option>
            </select>
          </div>
          <div class="tl-row">
            <span class="tl-label">Origin</span>
            <select class="tl-input" id="sfOrigin" style="text-align:center">
              <option value="bottom-left" selected={cfg.origin === 'bottom-left'}>Bottom-Left</option>
              <option value="bottom-right" selected={cfg.origin === 'bottom-right'}>Bottom-Right</option>
              <option value="top-left" selected={cfg.origin === 'top-left'}>Top-Left</option>
              <option value="top-right" selected={cfg.origin === 'top-right'}>Top-Right</option>
              <option value="center" selected={cfg.origin === 'center'}>Center</option>
            </select>
          </div>
        </div>
        <button class="tb-btn" style="flex:1;padding:8px;font-size:11px" id="sfPreview">◈ PREVIEW</button>
        <button class="tb-btn success" style="flex:1;padding:10px;font-size:13px" id="sfGenerate">✦ GENERATE</button>
      </div>
    </div>
  ) as HTMLElement;

  parent.appendChild(card);

  document.getElementById('sfPreview')!.addEventListener('click', () => {
    const c = readCfgFromUI();
    saveCfg(c);
    const wps = generateWaypoints(c);
    (window as any).loadPreview3D?.(wps);
  });

  document.getElementById('sfGenerate')!.addEventListener('click', () => {
    const c = readCfgFromUI();
    saveCfg(c);
    const gcode = generateGcode(c);
    processGcode(gcode, 'Surfacing.nc');
    log('info', `Surfacing G-code generated — ${gcode.split('\n').length} lines`);
  });
}
