// ═══════════════════════════════════════════════
// Settings engine — widget builders
// ═══════════════════════════════════════════════

import { state } from './state';
import { markDirty, writeSetting } from './settings-write';

export function buildBoolWidget(def: any, val: string): HTMLElement {
  const cur = val === '1';
  const wrap = document.createElement('div'); wrap.className = 'bool-toggle'; wrap.id = 'widget-' + def.id;
  const onBtn = document.createElement('button'); onBtn.className = 'bool-btn on' + (cur ? ' selected' : ''); onBtn.textContent = 'ON';
  const offBtn = document.createElement('button'); offBtn.className = 'bool-btn off' + (!cur ? ' selected' : ''); offBtn.textContent = 'OFF';
  onBtn.onclick = () => { onBtn.classList.add('selected'); offBtn.classList.remove('selected'); markDirty(def.id, '1'); };
  offBtn.onclick = () => { offBtn.classList.add('selected'); onBtn.classList.remove('selected'); markDirty(def.id, '0'); };
  wrap.appendChild(onBtn); wrap.appendChild(offBtn); return wrap;
}

export function buildBitfieldWidget(def: any, val: string, exclusive: boolean): HTMLElement {
  const cur = parseInt(val) || 0;
  const wrap = document.createElement('div'); wrap.className = 'bitmask-grid'; wrap.id = 'widget-' + def.id;
  def.formatLabels.forEach((label: string, bit: number) => {
    if (label === 'N/A') return;
    const item = document.createElement('div'); item.className = 'bitmask-item';
    const cb = document.createElement('div');
    cb.className = 'bitmask-cb' + (((cur >> bit) & 1) ? ' checked' : '') + (exclusive && bit !== 0 && !(cur & 1) ? ' disabled' : '');
    cb.dataset.bit = String(bit);
    const lbl = document.createElement('span'); lbl.className = 'bitmask-label'; lbl.textContent = label;
    cb.onclick = () => {
      if (cb.classList.contains('disabled')) return;
      cb.classList.toggle('checked');
      let v = 0; wrap.querySelectorAll('.bitmask-cb').forEach((c: Element) => { if (c.classList.contains('checked')) v |= (1 << parseInt((c as HTMLElement).dataset.bit!)); });
      if (exclusive) {
        const bit0 = !!(v & 1);
        wrap.querySelectorAll('.bitmask-cb').forEach((c: Element) => {
          const b = parseInt((c as HTMLElement).dataset.bit!);
          if (b !== 0) { if (!bit0) { c.classList.remove('checked'); c.classList.add('disabled'); v &= ~(1 << b); } else c.classList.remove('disabled'); }
        });
      }
      markDirty(def.id, String(v));
    };
    item.appendChild(cb); item.appendChild(lbl); wrap.appendChild(item);
  });
  return wrap;
}

export function buildRadioWidget(def: any, val: string): HTMLElement {
  const cur = parseInt(val) || 0;
  const wrap = document.createElement('div'); wrap.className = 'bitmask-grid'; wrap.id = 'widget-' + def.id;
  def.formatLabels.forEach((label: string, idx: number) => {
    if (label === 'N/A') return;
    const item = document.createElement('div'); item.className = 'bitmask-item';
    const rb = document.createElement('div'); rb.className = 'bitmask-cb radio-cb' + (cur === idx ? ' checked' : ''); rb.dataset.val = String(idx);
    const lbl = document.createElement('span'); lbl.className = 'bitmask-label'; lbl.textContent = label;
    rb.onclick = () => { wrap.querySelectorAll('.bitmask-cb').forEach(c => c.classList.remove('checked')); rb.classList.add('checked'); markDirty(def.id, String(idx)); };
    item.appendChild(rb); item.appendChild(lbl); wrap.appendChild(item);
  });
  return wrap;
}

export function buildAxisMaskWidget(def: any, val: string): HTMLElement {
  const cur = parseInt(val) || 0;
  const wrap = document.createElement('div'); wrap.className = 'bitmask-grid'; wrap.id = 'widget-' + def.id;
  const axes = def.formatLabels.length > 0 ? def.formatLabels : state.controllerAxes.map((a: string) => a + ' axis');
  axes.forEach((label: string, bit: number) => {
    if (label === 'N/A') return;
    const item = document.createElement('div'); item.className = 'bitmask-item';
    const cb = document.createElement('div'); cb.className = 'bitmask-cb' + (((cur >> bit) & 1) ? ' checked' : ''); cb.dataset.bit = String(bit);
    const lbl = document.createElement('span'); lbl.className = 'bitmask-label'; lbl.textContent = label;
    cb.onclick = () => {
      cb.classList.toggle('checked');
      let v = 0; wrap.querySelectorAll('.bitmask-cb').forEach((c: Element) => { if (c.classList.contains('checked')) v |= (1 << parseInt((c as HTMLElement).dataset.bit!)); });
      markDirty(def.id, String(v));
    };
    item.appendChild(cb); item.appendChild(lbl); wrap.appendChild(item);
  });
  return wrap;
}

export function buildTextWidget(def: any, val: string, type: string): HTMLElement {
  const inp = document.createElement('input'); inp.type = type; inp.className = 'setting-input'; inp.value = val; inp.id = 'widget-' + def.id;
  if (def.dtype === 9) inp.placeholder = '0.0.0.0';
  else if (def.dtype === 6) inp.placeholder = 'decimal';
  else if (def.dtype === 5) inp.placeholder = 'integer';
  inp.addEventListener('input', () => { inp.classList.toggle('changed', inp.value !== String(state.settingsValues[def.id] || '')); markDirty(def.id, inp.value); });
  inp.addEventListener('keydown', e => { if (e.key === 'Enter') writeSetting(def.id); });
  return inp;
}
