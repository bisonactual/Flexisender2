// ═══════════════════════════════════════════════
// Signals module — input pin indicators
// ═══════════════════════════════════════════════

import { h } from '../jsx';
import { on as busOn, type StatusReport } from '../bus';

const SIGNALS = [
  { ch: 'X', id: 'xlim',      label: 'X Limit' },
  { ch: 'Y', id: 'ylim',      label: 'Y Limit' },
  { ch: 'Z', id: 'zlim',      label: 'Z Limit' },
  { ch: 'A', id: 'alim',      label: 'A Limit' },
  { ch: 'B', id: 'blim',      label: 'B Limit' },
  { ch: 'P', id: 'probe',     label: 'Probe' },
  { ch: 'T', id: 'toolsetter',label: 'Toolsetter' },
  { ch: 'D', id: 'door',      label: 'Door' },
  { ch: 'R', id: 'estop',     label: 'E-Stop' },
];

let _items: Map<string, HTMLElement>;

export function mount(parent: HTMLElement): void {
  _items = new Map();

  const grid = <div class="sig-grid"></div> as HTMLElement;
  for (const sig of SIGNALS) {
    const item = (
      <div class="sig-item" dataset={{ sig: sig.id }}>
        <div class="sig-dot"></div>
        <div class="sig-label">{sig.label}</div>
      </div>
    ) as HTMLElement;
    _items.set(sig.ch, item);
    grid.appendChild(item);
  }

  const card = (
    <div class="module-card mod-hidden" id="mod-signals" dataset={{ modSize: 'normal' }} style="top:10px;left:594px">
      <div class="module-drag-handle">
        <span class="module-drag-dots">⠿⠿</span>
        <span class="module-drag-title">Signals</span>
        <button class="module-drag-close" onClick={() => { card.classList.add('mod-hidden'); }}>✕</button>
      </div>
      <div class="module-body" style="padding:4px">
        {grid}
      </div>
    </div>
  ) as HTMLElement;

  parent.appendChild(card);

  busOn<StatusReport>('status', ['pins'], (r) => {
    if (r.pins === undefined) return;
    if (card.classList.contains('mod-hidden')) return;
    const active = new Set(r.pins.toUpperCase().split(''));
    for (const [ch, el] of _items) {
      el.classList.toggle('active', active.has(ch));
    }
  });
}
