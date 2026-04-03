// ═══════════════════════════════════════════════
// Spindle / Coolant module
// ═══════════════════════════════════════════════

import { h } from '../jsx';
import { state } from '../state';
import { sendCmd } from '../connection';

let _btnCW: HTMLElement;
let _btnCCW: HTMLElement;
let _btnOFF: HTMLElement;
let _btnFlood: HTMLElement;
let _btnMist: HTMLElement;
let _rpmInput: HTMLInputElement;

function setSpindle(mode: string): void {
  const rpm = parseInt(_rpmInput.value) || 0;
  if (mode === 'CW') sendCmd('M3 S' + rpm);
  else if (mode === 'CCW') sendCmd('M4 S' + rpm);
  else if (mode === 'OFF') sendCmd('M5');

  _btnCW.classList.remove('active', 'active-off');
  _btnCCW.classList.remove('active', 'active-off');
  _btnOFF.classList.remove('active', 'active-off');
  if (mode === 'CW') _btnCW.classList.add('active');
  if (mode === 'CCW') _btnCCW.classList.add('active');
  if (mode === 'OFF') _btnOFF.classList.add('active-off');
}

function toggleCoolant(type: string): void {
  if (type === 'flood') {
    state.floodOn = !state.floodOn;
    _btnFlood.classList.toggle('active', state.floodOn);
  } else {
    state.mistOn = !state.mistOn;
    _btnMist.classList.toggle('active', state.mistOn);
  }
  if (state.floodOn && state.mistOn) sendCmd('M7\nM8');
  else if (state.floodOn) sendCmd('M8');
  else if (state.mistOn) sendCmd('M7');
  else sendCmd('M9');
}

export function mount(parent: HTMLElement): void {
  const card = (
    <div class="module-card mod-hidden" id="mod-spindle" dataset={{ modSize: 'normal' }} style="top:160px;left:594px">
      <div class="module-drag-handle">
        <span class="module-drag-dots">⠿⠿</span>
        <span class="module-drag-title">Spindle / Coolant</span>
        <button class="module-drag-close" onClick={() => { card.classList.add('mod-hidden'); }}>✕</button>
      </div>
      <div class="module-body">
        <div style="display:flex;align-items:center;gap:8px;padding:0 2px 2px">
          <span style="font-family:var(--cond);font-size:10px;letter-spacing:1px;color:var(--text3);text-transform:uppercase;flex-shrink:0">RPM</span>
          <input type="number" min="0" max="30000" step="100" value="10000"
            ref={(el: HTMLInputElement) => { _rpmInput = el; }}
            style="flex:1;background:var(--surface3);border:1px solid var(--border2);color:var(--text);font-family:var(--mono);font-size:13px;padding:6px 10px;outline:none;border-radius:var(--radius-sm);transition:border-color 0.15s;" />
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:5px;padding:0 2px">
          <button class="spin-dir-btn" ref={(el: HTMLElement) => { _btnCW = el; }} onClick={() => setSpindle('CW')}>CW</button>
          <button class="spin-dir-btn" ref={(el: HTMLElement) => { _btnCCW = el; }} onClick={() => setSpindle('CCW')}>CCW</button>
          <button class="spin-dir-btn" ref={(el: HTMLElement) => { _btnOFF = el; }} onClick={() => setSpindle('OFF')}>OFF</button>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:5px;padding:0 2px">
          <button class="coolant-btn" ref={(el: HTMLElement) => { _btnFlood = el; }} onClick={() => toggleCoolant('flood')}>FLOOD</button>
          <button class="coolant-btn" ref={(el: HTMLElement) => { _btnMist = el; }} onClick={() => toggleCoolant('mist')}>MIST</button>
        </div>
      </div>
    </div>
  ) as HTMLElement;

  parent.appendChild(card);
}
