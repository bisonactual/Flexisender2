// ═══════════════════════════════════════════════
// Connection layer — WebSocket & USB/Serial
// ═══════════════════════════════════════════════

import { state, POLL_NORM } from './state';
import { byteLen, lsGet } from './ui';
import { log } from './console';
import { parseResponse } from './parser';
import { updateRunButtons } from './streaming';
import { renderProgLimits } from './gcode';

// ── Poll rate ─────────────────────────────────────────────────────────────────
export function setPollRate(ms: number): void {
  if (state.statusInterval) clearInterval(state.statusInterval);
  state.statusInterval = setInterval(() => { if (state.connected) rtSend('?'); }, ms);
}

export function setJogging(active: boolean): void {
  if (state._isJogging === active) return;
  state._isJogging = active;
  if (state.connected) setPollRate(active ? 50 : POLL_NORM);
}

// ── Top-level connect/disconnect ──────────────────────────────────────────────
export function toggleConnect(): void {
  state.connected ? disconnect() : connect();
}

function connect(): void {
  if (state.connMode === 'serial') connectSerial();
  else connectWs();
}

function disconnect(): void {
  if (state.connMode === 'serial') disconnectSerial();
  else disconnectWs();
}

// ── WebSocket ─────────────────────────────────────────────────────────────────
function connectWs(): void {
  const url = (document.getElementById('wsUrl') as HTMLInputElement).value.trim();
  if (!url) return;
  setStatus('connecting');
  log('info', 'Connecting to ' + url + '…');
  try {
    state.ws = new WebSocket(url);
    state.ws.onopen = onOpen;
    state.ws.onmessage = onMessage;
    state.ws.onclose = onClose;
    state.ws.onerror = () => { log('err', 'WebSocket error — check URL and that the controller is reachable'); };
  } catch (e: any) { log('err', 'Connection failed: ' + e.message); setStatus('disconnected'); }
}

function disconnectWs(): void { if (state.ws) state.ws.close(); }

function feedBuffer(chunk: string): void {
  state._rxBuf += chunk;
  let nl;
  while ((nl = state._rxBuf.indexOf('\n')) !== -1) {
    const line = state._rxBuf.slice(0, nl).replace(/\r$/, '').trim();
    state._rxBuf = state._rxBuf.slice(nl + 1);
    if (line) parseResponse(line);
  }
}

function onMessage(evt: MessageEvent): void {
  feedBuffer(evt.data);
}

// ── USB / Serial ──────────────────────────────────────────────────────────────
async function connectSerial(): Promise<void> {
  if (!(navigator as any).serial) {
    log('err', 'Web Serial API not supported — use Chrome or Edge');
    return;
  }
  try {
    setStatus('connecting');
    log('info', 'Opening port picker…');
    state.serialPort = await (navigator as any).serial.requestPort();
    const baud = parseInt((document.getElementById('optBaudRate') as HTMLSelectElement).value) || 115200;
    const dataBits = parseInt((document.getElementById('optDataBits') as HTMLSelectElement).value) || 8;
    const stopBits = parseInt((document.getElementById('optStopBits') as HTMLSelectElement).value) || 1;
    const parity = (document.getElementById('optParity') as HTMLSelectElement).value || 'none';
    await state.serialPort.open({ baudRate: baud, dataBits, stopBits, parity });

    const info = state.serialPort.getInfo();
    const label = info.usbVendorId
      ? `USB ${info.usbVendorId.toString(16).toUpperCase()}:${(info.usbProductId || 0).toString(16).toUpperCase()} @ ${baud}`
      : `Serial @ ${baud}`;
    document.getElementById('serialPortLabel')!.textContent = label;

    state.serialAbort = new AbortController();
    state.serialWriter = state.serialPort.writable.getWriter();
    state.serialReader = state.serialPort.readable.getReader();

    serialReadLoop();
    onOpen();
    log('info', `Serial connected — ${baud} baud`);
  } catch (e: any) {
    if (e.name !== 'NotFoundError') log('err', 'Serial error: ' + e.message);
    setStatus('disconnected');
    state.serialPort = null; state.serialWriter = null; state.serialReader = null;
  }
}

async function serialReadLoop(): Promise<void> {
  try {
    while (true) {
      const { value, done } = await state.serialReader.read();
      if (done) break;
      feedBuffer(new TextDecoder().decode(value));
    }
  } catch (e: any) {
    if (e.name !== 'AbortError') log('err', 'Serial read error: ' + e.message);
  } finally {
    if (state.connected) onClose();
  }
}

async function disconnectSerial(): Promise<void> {
  try {
    if (state.serialReader) { await state.serialReader.cancel(); state.serialReader.releaseLock(); state.serialReader = null; }
    if (state.serialWriter) { state.serialWriter.releaseLock(); state.serialWriter = null; }
    if (state.serialPort) { await state.serialPort.close(); state.serialPort = null; }
  } catch (_) { /* ignore close errors */ }
  document.getElementById('serialPortLabel')!.textContent = 'No port selected';
  onClose();
}

// ── Shared open / close handlers ─────────────────────────────────────────────
function onOpen(): void {
  state.connected = true;
  state.rxInFlight = 0;
  state.sentQueue.length = 0;
  state._rxBuf = '';
  setStatus('connected');
  log('info', state.connMode === 'serial' ? 'Serial connected' : 'WebSocket connected');
  document.getElementById('connectBtn')!.textContent = 'DISCONNECT';
  setPollRate(POLL_NORM);
  rtSend('\x18');
  setTimeout(() => { state.sentQueue.length = 0; state.rxInFlight = 0; cmdSend('$I+'); }, 600);
  setTimeout(() => {
    try { if (lsGet('fs-opt-autoload-settings', false)) import('./settings').then(s => s.loadSettings()); } catch (_) {}
  }, 1500);
  const fb = document.getElementById('limitsFrameBtn') as HTMLButtonElement | null;
  if (fb && state.progLimits) fb.disabled = false;
}

function onClose(): void {
  state.connected = false;
  setStatus('disconnected');
  log('info', 'Disconnected');
  document.getElementById('connectBtn')!.textContent = 'CONNECT';
  if (state.statusInterval) clearInterval(state.statusInterval);
  state.running = false; state.paused = false;
  state.rxInFlight = 0; state.sentQueue.length = 0;
  updateRunButtons();
  const fb = document.getElementById('limitsFrameBtn') as HTMLButtonElement | null;
  if (fb) fb.disabled = true;
  state.machineHomed = false; state._prevMachineStateSl = ''; _updateHomeBtnHomed();
}

// ── Send helpers ──────────────────────────────────────────────────────────────

export function rtSend(char: string): void {
  if (state.connMode === 'serial') {
    if (state.serialWriter) state.serialWriter.write(new TextEncoder().encode(char)).catch(() => {});
  } else {
    if (state.ws && state.ws.readyState === WebSocket.OPEN) state.ws.send(char);
  }
}

export function cmdSend(line: string): void {
  const frame = line + '\n';
  const bytes = byteLen(frame);
  if (state.connMode === 'serial') {
    if (!state.serialWriter) return;
    state.serialWriter.write(new TextEncoder().encode(frame)).catch(() => {});
  } else {
    if (!state.ws || state.ws.readyState !== WebSocket.OPEN) return;
    state.ws.send(frame);
  }
  state.rxInFlight += bytes;
  state.sentQueue.push({ line, bytes });
}

export function sendCmd(cmd: string): void {
  if (!state.connected) { log('err', 'Not connected'); return; }
  cmdSend(cmd);
  log('tx', cmd);
}

// ── Status display ────────────────────────────────────────────────────────────
export function setStatus(s: string): void {
  document.getElementById('statusDot')!.className = 'status-dot ' + s;
  document.getElementById('statusText')!.textContent = s.toUpperCase();
}

export function updateBufDisplay(): void {
  document.getElementById('bufVal')!.textContent = 'RX: ' + state.rxInFlight + '/' + state.RX_BUFFER_SIZE + 'B';
}

export function _updateHomeBtnHomed(): void {
  const btn = document.getElementById('tbBtn-home');
  if (!btn) return;
  btn.classList.toggle('homed', state.machineHomed);
  btn.classList.toggle('not-homed', !state.machineHomed);
}
