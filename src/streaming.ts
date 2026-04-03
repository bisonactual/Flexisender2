// ═══════════════════════════════════════════════
// JOB CONTROL — character-counting pump
// ═══════════════════════════════════════════════

import { state } from './state';
import { byteLen } from './ui';
import { log } from './console';
import { cmdSend, rtSend } from './connection';
import { updateProgress } from './gcode';

export function startJob(): void {
  if (!state.connected) { log('err', 'Not connected'); return; }
  if (state.gcodeLines.length === 0) { log('err', 'No file loaded'); return; }
  if (state.running && !state.paused) return;
  if (state.paused) {
    state.paused = false;
    rtSend('~');
    log('info', 'Resumed');
    updateRunButtons();
    return;
  }
  state.running = true; state.paused = false;
  state.lineHead = 0; state.rxInFlight = 0; state.sentQueue.length = 0; state.segmentIndex = 0;
  state.esPhase = 'idle';
  updateRunButtons();
  log('info', 'Starting job: ' + state.gcodeLines.length + ' lines  (RX buffer: ' + state.RX_BUFFER_SIZE + ' bytes)');
  pumpQueue();
}

function stripComment(line: string): string {
  return line.replace(/\(.*?\)/g, '').replace(/;.*/, '').trim();
}

export function pumpQueue(): void {
  if (!state.running || state.paused) return;
  try { _pumpQueue(); } catch (e: any) { log('err', 'pumpQueue: ' + e.message); state.running = false; updateRunButtons(); }
}

function _pumpQueue(): void {
  const hwm = state.RX_BUFFER_SIZE - 1;

  while (state.lineHead < state.gcodeLines.length) {
    const raw = state.gcodeLines[state.lineHead];
    const stripped = stripComment(raw).trim().toUpperCase();

    if (!stripped) { state.lineHead++; continue; }

    const wouldCost = byteLen(stripped + '\n');

    if (state.rxInFlight + wouldCost > hwm) break;

    cmdSend(stripped);
    log('tx', stripped);
    state.lineHead++;
    updateProgress(state.lineHead, state.gcodeLines.length);
  }

  if (state.lineHead >= state.gcodeLines.length && state.sentQueue.length === 0 && state.running) {
    state.running = false;
    log('info', '✓ Job complete');
    updateRunButtons();
  }
}

export function pauseJob(): void {
  if (!state.running) return;
  state.paused = !state.paused;
  rtSend(state.paused ? '!' : '~');
  log('info', state.paused ? 'Feed hold sent' : 'Cycle resume sent');
  updateRunButtons();
}

export function stopJob(): void {
  if (!state.running && !state.paused) return;
  state.running = false; state.paused = false;
  rtSend('!');
  setTimeout(() => rtSend('\x18'), 150);
  state.rxInFlight = 0; state.sentQueue.length = 0; state.lineHead = 0;
  log('info', 'Job stopped — soft reset sent');
  updateRunButtons();
}

export function updateRunButtons(): void {
  ['btnStart'].forEach(id => { (document.getElementById(id) as HTMLButtonElement).disabled = state.running && !state.paused; });
  ['btnPause'].forEach(id => { (document.getElementById(id) as HTMLButtonElement).disabled = !state.running; });
  ['btnStop'].forEach(id => { (document.getElementById(id) as HTMLButtonElement).disabled = !state.running && !state.paused; });
}

export function sendReset(): void {
  if (!state.connected) return;
  rtSend('\x18');
  state.running = false; state.paused = false;
  state.rxInFlight = 0; state.sentQueue.length = 0; state.lineHead = 0;
  log('info', 'Soft reset');
  updateRunButtons();
}

export function unlockAlarm(): void { import('./connection').then(c => c.sendCmd('$X')); }
export function sendHome(): void { import('./connection').then(c => c.sendCmd('$H')); }
export function goToXY0(): void { import('./modules/jog').then(j => j.clearWaypoints()); import('./connection').then(c => c.sendCmd('G0 X0 Y0')); }

export function setWCS(code: string): void {
  import('./connection').then(c => {
    c.sendCmd(code);
    log('info', 'WCS set to ' + code);
  });
}
