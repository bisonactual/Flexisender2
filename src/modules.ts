// ═══════════════════════════════════════════════
// Module system — drag, resize, persist
// ═══════════════════════════════════════════════

import { state, MODULE_DEFS, MOD_DEFAULTS, MOD_SIZES } from './state';
import { lsGet, lsSet } from './ui';
import { dockDragStart, dockDragMove, dockDragEnd, dockDragCancel, isModuleDocked, undockModule } from './dock';

let _initDone = false;

export function modLoadState(): Record<string, any> {
  return lsGet('fs-modules', {});
}

export function modSaveState(): void {
  if (!_initDone) return;
  const s: Record<string, any> = { _consoleLines: state.consoleMaxLines };
  MODULE_DEFS.forEach(m => {
    const card = document.getElementById('mod-' + m.id);
    if (!card) return;
    s[m.id] = {
      enabled: !card.classList.contains('mod-hidden'),
      x: parseInt(card.style.left) || 0,
      y: parseInt(card.style.top) || 0,
      size: (card as HTMLElement).dataset.modSize || 'normal',
    };
  });
  try { lsSet('fs-modules', s); } catch (_) {}
}

export function toggleModule(id: string, forceState?: boolean): void {
  const card = document.getElementById('mod-' + id);
  const cfgCard = document.getElementById('modcfg-' + id);
  if (!card) return;
  const isHidden = card.classList.contains('mod-hidden');
  const enable = forceState !== undefined ? forceState : isHidden;
  card.classList.toggle('mod-hidden', !enable);
  if (cfgCard) cfgCard.classList.toggle('enabled', enable);
  modSaveState();
}

export function setModSize(id: string, size: string, evt?: Event): void {
  if (evt) evt.stopPropagation();
  const card = document.getElementById('mod-' + id);
  const cfgCard = document.getElementById('modcfg-' + id);
  if (!card) return;
  const w = MOD_SIZES[size] || MOD_SIZES.normal;
  card.style.width = w + 'px';
  (card as HTMLElement).dataset.modSize = size;
  if (cfgCard) {
    cfgCard.querySelectorAll('.mod-size-btn').forEach(btn => {
      btn.classList.toggle('active', btn.textContent!.toLowerCase() === size);
    });
  }
  modSaveState();
}

export function setConsoleLines(n: number, evt?: Event): void {
  if (evt) evt.stopPropagation();
  state.consoleMaxLines = n;
  const out = document.getElementById('consoleOut');
  if (out) {
    while (out.children.length > state.consoleMaxLines) out.removeChild(out.firstChild!);
    state.conLines = out.children.length;
  }
  document.querySelectorAll('.mod-lines-btn').forEach(btn => {
    btn.classList.toggle('active', parseInt(btn.textContent!) === n);
  });
  modSaveState();
}

export function modInitPositions(): void {
  const saved = modLoadState();
  if (saved._consoleLines) setConsoleLines(saved._consoleLines);

  MODULE_DEFS.forEach(m => {
    const card = document.getElementById('mod-' + m.id) as HTMLElement | null;
    const cfgCard = document.getElementById('modcfg-' + m.id);
    if (!card) return;
    const def = MOD_DEFAULTS[m.id] || { x: 10, y: 10, enabled: false, size: 'normal' };
    const s = saved[m.id] || {};
    const x = s.x !== undefined ? s.x : def.x;
    const y = s.y !== undefined ? s.y : def.y;
    const enabled = s.enabled !== undefined ? s.enabled : def.enabled;
    const size = s.size || def.size;
    card.style.left = x + 'px';
    card.style.top = y + 'px';
    card.style.width = (MOD_SIZES[size] || MOD_SIZES.normal) + 'px';
    card.dataset.modSize = size;
    card.classList.toggle('mod-hidden', !enabled);
    if (cfgCard) {
      cfgCard.classList.toggle('enabled', enabled);
      cfgCard.querySelectorAll('.mod-size-btn').forEach(btn => {
        btn.classList.toggle('active', btn.textContent!.toLowerCase() === size);
      });
    }
  });
  _initDone = true;
}

export function toggleModLock(): void {
  state.modLocked = !state.modLocked;
  document.body.classList.toggle('mod-locked', state.modLocked);
  document.getElementById('modLockIcon')!.textContent = state.modLocked ? '🔒' : '🔓';
  document.getElementById('modLockLabel')!.textContent = state.modLocked ? 'LOCKED' : 'UNLOCKED';
  try { lsSet('fs-mod-locked', state.modLocked); } catch (_) {}
}

// ── Drag — mouse ──────────────────────────────────────────────────────────────
export function modDragStart(e: MouseEvent, modId: string): void {
  if (state.modLocked) return;
  if (e.button !== 0) return;
  if ((e.target as HTMLElement).closest('button, input, select, label')) return;
  const card = document.getElementById(modId)!;

  // If docked, undock first
  const moduleId = modId.replace('mod-', '');
  if (isModuleDocked(moduleId)) {
    undockModule(moduleId);
    // Position card at cursor
    card.style.left = (e.clientX - 140) + 'px';
    card.style.top = (e.clientY - 15) + 'px';
  }

  state._modDrag = {
    card,
    moduleId,
    startX: e.clientX, startY: e.clientY,
    origLeft: parseInt(card.style.left) || 0,
    origTop: parseInt(card.style.top) || 0,
  };
  card.style.zIndex = '200';
  dockDragStart(moduleId);
  e.preventDefault();
}

export function modTouchStart(e: TouchEvent, modId: string): void {
  if (state.modLocked) return;
  if (e.touches.length !== 1) return;
  if ((e.target as HTMLElement).closest('button, input, select, label')) return;
  const t = e.touches[0];
  const card = document.getElementById(modId)!;

  const moduleId = modId.replace('mod-', '');
  if (isModuleDocked(moduleId)) {
    undockModule(moduleId);
    card.style.left = (t.clientX - 140) + 'px';
    card.style.top = (t.clientY - 15) + 'px';
  }

  state._modDrag = {
    card,
    moduleId,
    startX: t.clientX, startY: t.clientY,
    origLeft: parseInt(card.style.left) || 0,
    origTop: parseInt(card.style.top) || 0,
  };
  card.style.zIndex = '200';
  dockDragStart(moduleId);
}

export function initModDragListeners(): void {
  document.addEventListener('mousemove', e => {
    if (!state._modDrag) return;
    const dx = e.clientX - state._modDrag.startX;
    const dy = e.clientY - state._modDrag.startY;
    state._modDrag.card.style.left = Math.max(0, state._modDrag.origLeft + dx) + 'px';
    state._modDrag.card.style.top = Math.max(0, state._modDrag.origTop + dy) + 'px';
    dockDragMove(e.clientX, e.clientY);
  });

  document.addEventListener('mouseup', e => {
    if (!state._modDrag) return;
    const docked = dockDragEnd(e.clientX, e.clientY);
    if (!docked) {
      state._modDrag.card.style.zIndex = '110';
    }
    state._modDrag = null;
    modSaveState();
  });

  document.addEventListener('touchmove', e => {
    if (!state._modDrag) return;
    const t = e.touches[0];
    const dx = t.clientX - state._modDrag.startX;
    const dy = t.clientY - state._modDrag.startY;
    state._modDrag.card.style.left = Math.max(0, state._modDrag.origLeft + dx) + 'px';
    state._modDrag.card.style.top = Math.max(0, state._modDrag.origTop + dy) + 'px';
    dockDragMove(t.clientX, t.clientY);
  }, { passive: true });

  document.addEventListener('touchend', e => {
    if (!state._modDrag) return;
    const t = e.changedTouches[0];
    const docked = dockDragEnd(t.clientX, t.clientY);
    if (!docked) {
      state._modDrag.card.style.zIndex = '110';
    }
    state._modDrag = null;
    modSaveState();
  });

  // Bring module to front on click
  document.addEventListener('mousedown', e => {
    const card = (e.target as HTMLElement).closest('.module-card') as HTMLElement | null;
    if (!card) return;
    document.querySelectorAll<HTMLElement>('.module-card').forEach(c => c.style.zIndex = '110');
    card.style.zIndex = '150';
  }, true);
}
