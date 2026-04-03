// ═══════════════════════════════════════════════
// Real-time overrides
// ═══════════════════════════════════════════════

import { state } from './state';
import { rtSend } from './connection';

export function updateOvrDisplay(type: string, value: number): void {
  (state.ovrCurrent as any)[type] = value;
  const sliderMap: Record<string, string> = { feed: 'ovrFeedSlider', rapid: 'ovrRapidSlider', spindle: 'ovrSpinSlider' };
  const valMap: Record<string, string> = { feed: 'ovrFeedVal', rapid: 'ovrRapidVal', spindle: 'ovrSpinVal' };
  const slider = document.getElementById(sliderMap[type]) as HTMLInputElement | null;
  const valEl = document.getElementById(valMap[type]);
  if (slider) slider.value = String(value);
  if (valEl) valEl.textContent = value + '%';
}

export function resetOverride(type: string): void {
  if (!state.connected) return;
  const resetByte: Record<string, string> = { feed: '\x90', rapid: '\x95', spindle: '\x99' };
  if (!resetByte[type]) return;
  rtSend(resetByte[type]);
  updateOvrDisplay(type, 100);
}

export function applyOverride(type: string, target: number): void {
  const valMap: Record<string, string> = { feed: 'ovrFeedVal', rapid: 'ovrRapidVal', spindle: 'ovrSpinVal' };
  const valEl = document.getElementById(valMap[type]);
  if (valEl) valEl.textContent = target + '%';

  if (!state.connected) return;

  if (type === 'rapid') {
    const steps = [100, 50, 25];
    const closest = steps.reduce((a, b) => Math.abs(b - target) < Math.abs(a - target) ? b : a);
    const byteMap: Record<number, string> = { 100: '\x95', 50: '\x96', 25: '\x97' };
    rtSend(byteMap[closest]);
    const slider = document.getElementById('ovrRapidSlider') as HTMLInputElement | null;
    if (slider) slider.value = String(closest);
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

export function setSpindle(mode: string): void {
  const rpm = parseInt((document.getElementById('spindleRPM') as HTMLInputElement).value) || 0;
  import('./connection').then(c => {
    if (mode === 'CW') c.sendCmd('M3 S' + rpm);
    if (mode === 'CCW') c.sendCmd('M4 S' + rpm);
    if (mode === 'OFF') c.sendCmd('M5');
  });
  document.getElementById('btnSpinCW')!.classList.remove('active', 'active-off');
  document.getElementById('btnSpinCCW')!.classList.remove('active', 'active-off');
  document.getElementById('btnSpinOFF')!.classList.remove('active', 'active-off');
  if (mode === 'CW') document.getElementById('btnSpinCW')!.classList.add('active');
  if (mode === 'CCW') document.getElementById('btnSpinCCW')!.classList.add('active');
  if (mode === 'OFF') document.getElementById('btnSpinOFF')!.classList.add('active-off');
}

export function toggleCoolant(type: string): void {
  if (type === 'flood') {
    state.floodOn = !state.floodOn;
    document.getElementById('btnFlood')!.classList.toggle('active', state.floodOn);
  } else {
    state.mistOn = !state.mistOn;
    document.getElementById('btnMist')!.classList.toggle('active', state.mistOn);
  }
  import('./connection').then(c => {
    if (state.floodOn && state.mistOn) c.sendCmd('M7\nM8');
    else if (state.floodOn) c.sendCmd('M8');
    else if (state.mistOn) c.sendCmd('M7');
    else c.sendCmd('M9');
  });
}
