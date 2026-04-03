// ═══════════════════════════════════════════════
// Console logging
// ═══════════════════════════════════════════════

import { state } from './state';
import { esc } from './ui';

export function log(type: string, msg: string): void {
  const out = document.getElementById('consoleOut')!;
  const cls: Record<string, string> = { tx: 'con-tx', rx: 'con-rx', ok: 'con-ok', err: 'con-err', info: 'con-info', alarm: 'con-alarm' };
  const pre: Record<string, string> = { tx: '→', rx: '←', ok: '✓', err: '✗', info: 'ℹ', alarm: '⚠' };
  const div = document.createElement('div');
  div.className = 'con-line';
  div.innerHTML = '<span class="' + (cls[type] || 'con-rx') + '">' + (pre[type] || '·') + ' ' + esc(msg) + '</span>';
  out.appendChild(div);
  if (++state.conLines > state.consoleMaxLines) { out.removeChild(out.firstChild!); state.conLines--; }
  requestAnimationFrame(() => { out.scrollTop = out.scrollHeight; });
}

export function clearConsole(): void {
  document.getElementById('consoleOut')!.innerHTML = '';
  state.conLines = 0;
}

// ── Console input & command history ───────────────────────────────────────────

export function sendManual(): void {
  const inp = document.getElementById('conInput') as HTMLInputElement;
  const raw = inp.value.trim();
  if (!raw) return;
  state.cmdHistory.unshift(raw); state.histIdx = -1; inp.value = '';
  _hintHide();
  const cmds = raw.split(';').map(s => s.trim()).filter(Boolean);
  import('./connection').then(c => { for (const cmd of cmds) c.sendCmd(cmd); });
}

export function handleConInput(e: KeyboardEvent): void {
  const inp = document.getElementById('conInput') as HTMLInputElement;
  // Autocomplete navigation
  if (_acVisible) {
    if (e.key === 'ArrowDown') { e.preventDefault(); _acSelect((_acIdx + 1) % _acItems.length); return; }
    if (e.key === 'ArrowUp') { e.preventDefault(); _acSelect(_acIdx <= 0 ? _acItems.length - 1 : _acIdx - 1); return; }
    if (e.key === 'Tab' || (e.key === 'Enter' && _acIdx >= 0)) { e.preventDefault(); _acAccept(inp); return; }
    if (e.key === 'Escape') { _acHide(); return; }
  }
  if (e.key === 'Enter') { _acHide(); sendManual(); return; }
  if (e.key === 'ArrowUp') { e.preventDefault(); state.histIdx = Math.min(state.histIdx + 1, state.cmdHistory.length - 1); inp.value = state.cmdHistory[state.histIdx] || ''; _acHide(); }
  if (e.key === 'ArrowDown') { e.preventDefault(); state.histIdx = Math.max(state.histIdx - 1, -1); inp.value = state.histIdx >= 0 ? state.cmdHistory[state.histIdx] : ''; _acHide(); }
  // Readline
  if (e.ctrlKey && e.key === 'u') { e.preventDefault(); inp.value = inp.value.slice(inp.selectionStart!); inp.selectionStart = inp.selectionEnd = 0; }
  if (e.ctrlKey && e.key === 'k') { e.preventDefault(); inp.value = inp.value.slice(0, inp.selectionStart!); }
  if (e.ctrlKey && e.key === 'c') { e.preventDefault(); inp.value = ''; state.histIdx = -1; _acHide(); }
  if (e.ctrlKey && e.key === 'w') { e.preventDefault(); const pos = inp.selectionStart!; const before = inp.value.slice(0, pos); const trimmed = before.replace(/\s*\S+\s*$/, ''); inp.value = trimmed + inp.value.slice(pos); inp.selectionStart = inp.selectionEnd = trimmed.length; }
}

// ── Console autocomplete ──────────────────────────────────────────────────────
let _acVisible = false;
let _acIdx = -1;
let _acItems: { id: number; name: string }[] = [];

export function conAutoUpdate(): void {
  const inp = document.getElementById('conInput') as HTMLInputElement;
  const val = inp.value;

  // Find the last command segment (after last ;)
  const lastSemi = val.lastIndexOf(';');
  const segment = val.slice(lastSemi + 1).trimStart();

  // Param hint: show setting name when $ID= is typed
  _updateParamHint(segment, inp);

  if (!segment.startsWith('$') || segment.includes('=') || !state.settingsLoaded) { _acHide(); return; }

  const query = segment.slice(1).toLowerCase().replace(/\s+/g, '_');
  if (query.length === 0) { _acHide(); return; }

  // Filter settings by name
  _acItems = [];
  for (const [idStr, def] of Object.entries(state.settingsDefs)) {
    const name = (def.name || '').toLowerCase().replace(/\s+/g, '_');
    if (name.includes(query)) {
      _acItems.push({ id: parseInt(idStr), name: def.name });
    }
    if (_acItems.length >= 12) break;
  }

  if (_acItems.length === 0) { _acHide(); return; }

  const container = document.getElementById('conAutocomplete');
  if (!container) return;
  container.innerHTML = '';
  _acItems.forEach((item, i) => {
    const div = document.createElement('div');
    div.className = 'con-ac-item';
    div.innerHTML = `<span>${item.name.replace(/\s+/g, '_')}</span><span class="con-ac-id">$${item.id}</span>`;
    div.onmousedown = (e) => { e.preventDefault(); _acIdx = i; _acAccept(inp); };
    container.appendChild(div);
  });
  _acIdx = 0;
  _acSelect(0);
  container.classList.add('visible');
  _acVisible = true;
}

function _acSelect(idx: number): void {
  _acIdx = idx;
  const container = document.getElementById('conAutocomplete');
  if (!container) return;
  container.querySelectorAll('.con-ac-item').forEach((el, i) => {
    el.classList.toggle('selected', i === idx);
    if (i === idx) el.scrollIntoView({ block: 'nearest' });
  });
}

function _acAccept(inp: HTMLInputElement): void {
  if (_acIdx < 0 || _acIdx >= _acItems.length) return;
  const item = _acItems[_acIdx];
  const val = inp.value;
  const lastSemi = val.lastIndexOf(';');
  const prefix = lastSemi >= 0 ? val.slice(0, lastSemi + 1) + ' ' : '';
  inp.value = prefix + '$' + item.id + '=';
  _acHide();
  inp.focus();
}

function _ensureHintEl(): HTMLElement {
  let hint = document.getElementById('conParamHint');
  if (!hint) {
    hint = document.createElement('div');
    hint.id = 'conParamHint';
    hint.className = 'con-param-hint';
    document.body.appendChild(hint);
  }
  return hint;
}

function _updateParamHint(segment: string, inp: HTMLInputElement): void {
  const hint = _ensureHintEl();
  const m = segment.match(/^\$(\d+)=/);
  if (!m || !state.settingsLoaded) { hint.classList.remove('visible'); return; }
  const id = parseInt(m[1]);
  const def = state.settingsDefs[id];
  if (def) {
    const curVal = state.settingsValues[id];
    hint.textContent = def.name + (curVal !== undefined ? ` (current: ${curVal})` : '');
    hint.style.color = '';
  } else {
    hint.textContent = '⚠ Unknown setting $' + id;
    hint.style.color = 'var(--yellow)';
  }
  // Position next to the module card
  const card = inp.closest('.module-card') || inp.closest('.right-console-wrap') || inp;
  const rect = card.getBoundingClientRect();
  const midX = rect.left + rect.width / 2;
  hint.style.top = (rect.bottom - 30) + 'px';
  if (midX > window.innerWidth / 2) {
    hint.style.left = '';
    hint.style.right = (window.innerWidth - rect.left + 8) + 'px';
  } else {
    hint.style.right = '';
    hint.style.left = (rect.right + 8) + 'px';
  }
  hint.classList.add('visible');
}

function _acHide(): void {
  _acVisible = false;
  _acIdx = -1;
  const container = document.getElementById('conAutocomplete');
  if (container) { container.classList.remove('visible'); container.innerHTML = ''; }
}

function _hintHide(): void {
  const hint = document.getElementById('conParamHint');
  if (hint) hint.classList.remove('visible');
}
