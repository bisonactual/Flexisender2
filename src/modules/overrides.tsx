// ═══════════════════════════════════════════════
// Overrides module — feed, rapid, spindle override sliders
// ═══════════════════════════════════════════════

import { h } from '../jsx';
import { state } from '../state';
import { rtSend } from '../connection';
import { on as busOn, type StatusReport } from '../bus';

// ── Element refs ──────────────────────────────────────────────────────────────
let _feedSlider: HTMLInputElement;
let _feedVal: HTMLElement;
let _rapidSlider: HTMLInputElement;
let _rapidVal: HTMLElement;
let _spinSlider: HTMLInputElement;
let _spinVal: HTMLElement;

// ── Override display ──────────────────────────────────────────────────────────
function updateDisplay(type: string, value: number): void {
  (state.ovrCurrent as any)[type] = value;
  const slider = type === 'feed' ? _feedSlider : type === 'rapid' ? _rapidSlider : _spinSlider;
  const valEl = type === 'feed' ? _feedVal : type === 'rapid' ? _rapidVal : _spinVal;
  if (slider) slider.value = String(value);
  if (valEl) valEl.textContent = value + '%';
}

// ── Reset ─────────────────────────────────────────────────────────────────────
function resetOverride(type: string): void {
  if (!state.connected) return;
  const resetByte: Record<string, string> = { feed: '\x90', rapid: '\x95', spindle: '\x99' };
  if (!resetByte[type]) return;
  rtSend(resetByte[type]);
  updateDisplay(type, 100);
}

// ── Apply ─────────────────────────────────────────────────────────────────────
function applyOverride(type: string, target: number): void {
  const valEl = type === 'feed' ? _feedVal : type === 'rapid' ? _rapidVal : _spinVal;
  if (valEl) valEl.textContent = target + '%';

  if (!state.connected) return;

  if (type === 'rapid') {
    const steps = [100, 50, 25];
    const closest = steps.reduce((a, b) => Math.abs(b - target) < Math.abs(a - target) ? b : a);
    const byteMap: Record<number, string> = { 100: '\x95', 50: '\x96', 25: '\x97' };
    rtSend(byteMap[closest]);
    if (_rapidSlider) _rapidSlider.value = String(closest);
    if (valEl) valEl.textContent = closest + '%';
    state.ovrCurrent.rapid = closest;
    return;
  }

  const incBig: Record<string, string> = { feed: '\x91', spindle: '\x9A' };
  const decBig: Record<string, string> = { feed: '\x92', spindle: '\x9B' };
  const incSmall: Record<string, string> = { feed: '\x93', spindle: '\x9C' };
  const decSmall: Record<string, string> = { feed: '\x94', spindle: '\x9D' };

  let current = (state.ovrCurrent as any)[type] as number;
  let delta = target - current;
  let cmds = 0;
  const MAX = 20;

  while (delta >= 10 && cmds < MAX) { rtSend(incBig[type]); delta -= 10; current += 10; cmds++; }
  while (delta <= -10 && cmds < MAX) { rtSend(decBig[type]); delta += 10; current -= 10; cmds++; }
  while (delta >= 1 && cmds < MAX) { rtSend(incSmall[type]); delta -= 1; current += 1; cmds++; }
  while (delta <= -1 && cmds < MAX) { rtSend(decSmall[type]); delta += 1; current -= 1; cmds++; }

  (state.ovrCurrent as any)[type] = current;
}

// ── Slider row helper ─────────────────────────────────────────────────────────
function OvrRow({ label, type, min, max, refSlider, refVal }: {
  label: string; type: string; min: string; max: string;
  refSlider: (el: HTMLInputElement) => void; refVal: (el: HTMLElement) => void;
}): HTMLElement {
  return (
    <div class="ovr-row">
      <button class="ovr-label ovr-reset-btn" title="Reset to 100%" onClick={() => resetOverride(type)}>{label}</button>
      <input type="range" class="ovr-slider" min={min} max={max} value="100"
        ref={refSlider}
        onInput={(e: Event) => applyOverride(type, parseInt((e.target as HTMLInputElement).value))} />
      <span class="ovr-val" ref={refVal}>100%</span>
    </div>
  ) as HTMLElement;
}

// ── Mount ─────────────────────────────────────────────────────────────────────
export function mount(parent: HTMLElement): void {
  const card = (
    <div class="module-card mod-hidden" id="mod-overrides" dataset={{ modSize: 'normal' }} style="top:10px;left:594px">
      <div class="module-drag-handle">
        <span class="module-drag-dots">⠿⠿</span>
        <span class="module-drag-title">Overrides</span>
        <button class="module-drag-close" onClick={() => { card.classList.add('mod-hidden'); }}>✕</button>
      </div>
      <div class="module-body">
        <div class="override-section">
          <OvrRow label="FEED" type="feed" min="1" max="999"
            refSlider={(el: HTMLInputElement) => { _feedSlider = el; }} refVal={(el: HTMLElement) => { _feedVal = el; }} />
          <OvrRow label="RAPID" type="rapid" min="25" max="100"
            refSlider={(el: HTMLInputElement) => { _rapidSlider = el; }} refVal={(el: HTMLElement) => { _rapidVal = el; }} />
          <OvrRow label="SPIN" type="spindle" min="10" max="200"
            refSlider={(el: HTMLInputElement) => { _spinSlider = el; }} refVal={(el: HTMLElement) => { _spinVal = el; }} />
        </div>
      </div>
    </div>
  ) as HTMLElement;

  parent.appendChild(card);

  busOn<StatusReport>('status', ['ov'], (r) => {
    if (!r.ov) return;
    updateDisplay('feed', r.ov.feed);
    updateDisplay('rapid', r.ov.rapid);
    updateDisplay('spindle', r.ov.spindle);
  });
}
