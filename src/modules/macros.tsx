// ═══════════════════════════════════════════════
// Macros module — quick command buttons
// ═══════════════════════════════════════════════

import { h } from '../jsx';
import { sendCmd } from '../connection';
import { sendHome } from '../streaming';

const MACROS = [
  { cmd: '$H',       label: 'HOME ALL' },
  { cmd: '$H Z',     label: 'HOME Z' },
  { cmd: 'G0 X0 Y0', label: 'GOTO XY0' },
  { cmd: 'G0 Z5',    label: 'PARK Z' },
  { cmd: '$I',       label: 'GRBL INFO' },
  { cmd: '$$',       label: 'SETTINGS' },
  { cmd: '$#',       label: 'WCS TABLE' },
  { cmd: '?',        label: 'QUERY' },
];

export function mount(parent: HTMLElement): void {
  const card = (
    <div class="module-card mod-hidden" id="mod-macros" dataset={{ modSize: 'normal' }} style="top:310px;left:594px">
      <div class="module-drag-handle">
        <span class="module-drag-dots">⠿⠿</span>
        <span class="module-drag-title">Macros</span>
        <button class="module-drag-close" onClick={() => { card.classList.add('mod-hidden'); }}>✕</button>
      </div>
      <div class="module-body">
        <div class="macro-grid">
          {MACROS.map(m =>
            <button class="macro-btn" onClick={() => m.cmd === '$H' ? sendHome() : sendCmd(m.cmd)}>{m.label}</button>
          )}
        </div>
      </div>
    </div>
  ) as HTMLElement;

  parent.appendChild(card);
}
