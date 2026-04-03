// ═══════════════════════════════════════════════
// Position module — DRO, state badge, WCS, feed/spindle/buf/line
// ═══════════════════════════════════════════════

import { h } from '../jsx';
import { fmtPos } from '../ui';
import { sendCmd } from '../connection';
import { setWCS } from '../streaming';
import { on as busOn, type StatusReport } from '../bus';

// ── Element refs ──────────────────────────────────────────────────────────────
let _droX: HTMLElement;
let _droY: HTMLElement;
let _droZ: HTMLElement;
let _droMX: HTMLElement;
let _droMY: HTMLElement;
let _droMZ: HTMLElement;
let _feedVal: HTMLElement;
let _spindleVal: HTMLElement;
let _bufVal: HTMLElement;
let _lineVal: HTMLElement;
let _stateBadge: HTMLElement;
let _stateText: HTMLElement;
let _wcsSelect: HTMLSelectElement;

// ── Axis card helper ──────────────────────────────────────────────────────────
function AxisCard({ axis, refWpos, refMpos }: { axis: string; refWpos: (el: HTMLElement) => void; refMpos: (el: HTMLElement) => void }): HTMLElement {
  return (
    <div class="dro-axis-card" id={'axCard-' + axis}>
      <div class="dro-axis-label">{axis}</div>
      <div class="dro-axis-values">
        <div class="dro-axis-wpos" ref={refWpos}>0.000</div>
        <div class="dro-axis-mpos" ref={refMpos}>M: 0.000</div>
      </div>
      <div class="dro-axis-unit">MM</div>
      <button class="dro-zero-btn" onClick={() => sendCmd('G10 L20 P1 ' + axis + '0')}>ZERO</button>
    </div>
  ) as HTMLElement;
}

// ── Mount ─────────────────────────────────────────────────────────────────────
export function mount(parent: HTMLElement): void {
  const card = (
    <div class="module-card mod-hidden" id="mod-position" dataset={{ modSize: 'normal' }} style="top:10px;left:10px">
      <div class="module-drag-handle">
        <span class="module-drag-dots">⠿⠿</span>
        <span class="module-drag-title">Machine Position</span>
        <button class="module-drag-close" onClick={() => { card.classList.add('mod-hidden'); }}>✕</button>
      </div>
      <div class="module-body">
        <div class="status-wcs-row" style="padding:2px 0 0">
          <div class="state-badge idle" id="stateBadge" ref={(el: HTMLElement) => { _stateBadge = el; }}>
            <span id="stateText" ref={(el: HTMLElement) => { _stateText = el; }}>IDLE</span>
          </div>
          <div class="wcs-select-wrap">
            <span class="wcs-label">WCS</span>
            <select class="wcs-select" id="wcsSelect" ref={(el: HTMLSelectElement) => { _wcsSelect = el; }}
              onChange={() => setWCS(_wcsSelect.value)}>
              <option value="G54">G54</option>
              <option value="G55">G55</option>
              <option value="G56">G56</option>
              <option value="G57">G57</option>
              <option value="G58">G58</option>
              <option value="G59">G59</option>
            </select>
          </div>
        </div>
        <div class="dro-grid">
          <AxisCard axis="X" refWpos={(el: HTMLElement) => { _droX = el; }} refMpos={(el: HTMLElement) => { _droMX = el; }} />
          <AxisCard axis="Y" refWpos={(el: HTMLElement) => { _droY = el; }} refMpos={(el: HTMLElement) => { _droMY = el; }} />
          <AxisCard axis="Z" refWpos={(el: HTMLElement) => { _droZ = el; }} refMpos={(el: HTMLElement) => { _droMZ = el; }} />
        </div>
        <div class="dro-sub">
          <div class="dro-mini"><div class="dro-mini-label">FEED</div><div class="dro-mini-value" ref={(el: HTMLElement) => { _feedVal = el; }}>0 mm/m</div></div>
          <div class="dro-mini"><div class="dro-mini-label">SPINDLE</div><div class="dro-mini-value" ref={(el: HTMLElement) => { _spindleVal = el; }}>0 RPM</div></div>
          <div class="dro-mini"><div class="dro-mini-label">BUF</div><div class="dro-mini-value" id="bufVal" ref={(el: HTMLElement) => { _bufVal = el; }}>15/15</div></div>
          <div class="dro-mini"><div class="dro-mini-label">LINE</div><div class="dro-mini-value" ref={(el: HTMLElement) => { _lineVal = el; }}>—</div></div>
        </div>
      </div>
    </div>
  ) as HTMLElement;

  parent.appendChild(card);

  // ── Bus subscriptions ─────────────────────────────────────────────────────
  busOn<StatusReport>('status', ['mpos'], (r) => {
    if (!r.mpos) return;
    _droX.textContent = fmtPos(String(r.mpos.x));
    _droY.textContent = fmtPos(String(r.mpos.y));
    _droZ.textContent = fmtPos(String(r.mpos.z));
    _droMX.textContent = 'M: ' + fmtPos(String(r.mpos.x));
    _droMY.textContent = 'M: ' + fmtPos(String(r.mpos.y));
    _droMZ.textContent = 'M: ' + fmtPos(String(r.mpos.z));
  });

  busOn<StatusReport>('status', ['fs'], (r) => {
    if (!r.fs) return;
    _feedVal.textContent = r.fs.feed + ' mm/m';
    _spindleVal.textContent = r.fs.spindle + ' RPM';
  });

  busOn<StatusReport>('status', ['bf'], (r) => {
    if (!r.bf) return;
    _bufVal.textContent = r.bf.blocks + ' blk / ' + r.bf.bytes + ' B';
  });

  busOn<StatusReport>('status', ['ln'], (r) => {
    if (r.ln === undefined) return;
    _lineVal.textContent = String(r.ln);
  });

  busOn<StatusReport>('status', ['state'], (r) => {
    _stateBadge.className = 'state-badge';
    const sl = r.machineState.toLowerCase().split(':')[0];
    if (['idle', 'run', 'hold', 'alarm', 'jog', 'home', 'door', 'check', 'sleep'].includes(sl)) {
      _stateBadge.classList.add(sl);
    }
    _stateText.textContent = r.machineState.toUpperCase();
  });

  busOn<StatusReport>('status', ['wcs'], (r) => {
    if (!r.wcs) return;
    if (['G54', 'G55', 'G56', 'G57', 'G58', 'G59'].includes(r.wcs)) {
      _wcsSelect.value = r.wcs;
    }
  });
}
