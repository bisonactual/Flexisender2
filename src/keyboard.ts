// ═══════════════════════════════════════════════
// Touch keyboard
// ═══════════════════════════════════════════════

import { state } from './state';
import { sendManual } from './console';

function updateKbdDisplay(): void {
  document.getElementById('kbdInputDisplay')!.textContent = '› ' + state.kbdBuffer;
}

export function kbdPress(evt: Event, char: string): void {
  if (evt) evt.preventDefault();
  state.kbdBuffer += char;
  updateKbdDisplay();
  if (evt && (evt as any).currentTarget) {
    (evt as any).currentTarget.classList.add('pressed');
    setTimeout(() => (evt as any).currentTarget.classList.remove('pressed'), 100);
  }
}

export function kbdBackspace(evt: Event): void {
  if (evt) evt.preventDefault();
  state.kbdBuffer = state.kbdBuffer.slice(0, -1);
  updateKbdDisplay();
}

export function kbdClear(evt: Event): void {
  if (evt) evt.preventDefault();
  state.kbdBuffer = '';
  updateKbdDisplay();
}

export function kbdSend(evt: Event): void {
  if (evt) evt.preventDefault();
  const cmd = state.kbdBuffer.trim();
  if (!cmd) return;
  (document.getElementById('conInput') as HTMLInputElement).value = cmd;
  sendManual();
  state.kbdBuffer = '';
  updateKbdDisplay();
}

export function toggleTouchKeyboard(evt?: Event): void {
  if (evt) evt.preventDefault();
  const overlay = document.getElementById('touchKbdOverlay')!;
  const isVisible = overlay.classList.toggle('visible');
  document.getElementById('btnKeyboard')!.classList.toggle('active', isVisible);
  if (isVisible) updateKbdDisplay();
}
