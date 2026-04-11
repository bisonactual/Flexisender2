// ═══════════════════════════════════════════════
// Module system — drag, resize, persist, groups
// ═══════════════════════════════════════════════

import { state, MODULE_DEFS, MOD_DEFAULTS, MOD_SIZES, MODULE_GROUPS } from './state';
import { lsGet, lsSet } from './ui';
import { dockDragStart, dockDragMove, dockDragEnd, isModuleDocked, undockModule } from './dock';

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
    const groupsAllow = isModuleVisibleByGroups(m.id);
    const isVisible = !card.classList.contains('mod-hidden');
    s[m.id] = {
      enabled: groupsAllow ? isVisible : (modLoadState()[m.id]?.enabled ?? false),
      x: parseInt(card.style.left) || 0,
      y: parseInt(card.style.top) || 0,
      size: (card as HTMLElement).dataset.modSize || 'normal',
    };
  });
  try { lsSet('fs-modules', s); } catch (_) {}
}

function loadGroupStates(): Record<string, boolean> {
  return lsGet('fs-module-groups', {});
}

function saveGroupStates(s: Record<string, boolean>): void {
  lsSet('fs-module-groups', s);
}

function isModuleVisibleByGroups(moduleId: string): boolean {
  const groupStates = loadGroupStates();
  for (const group of MODULE_GROUPS) {
    if (group.modules.includes(moduleId) && groupStates[group.id] === false) return false;
  }
  return true;
}

function allCfgCards(moduleId: string): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>(`[data-module-id="${moduleId}"]`));
}

function updateCfgCards(moduleId: string, individualEnabled: boolean, groupsAllow: boolean, size?: string): void {
  allCfgCards(moduleId).forEach(cfgCard => {
    cfgCard.classList.toggle('enabled', individualEnabled);
    cfgCard.classList.toggle('group-disabled', !groupsAllow);
    if (size) {
      cfgCard.querySelectorAll('.mod-size-btn').forEach(btn => {
        btn.classList.toggle('active', btn.textContent!.toLowerCase() === size);
      });
    }
  });
}

function loadCollapseStates(): Record<string, boolean> {
  return lsGet('fs-module-groups-collapsed', {});
}

export function toggleGroupCollapse(groupId: string): void {
  const states = loadCollapseStates();
  const collapsed = states[groupId] === true;
  states[groupId] = !collapsed;
  lsSet('fs-module-groups-collapsed', states);
  const group = document.querySelector(`.mod-group:has([data-group-id="${groupId}"])`);
  if (group) group.classList.toggle('collapsed', !collapsed);
}

function updateGroupBadge(groupId: string): void {
  const badge = document.getElementById('modgrp-badge-' + groupId);
  if (!badge) return;
  const group = MODULE_GROUPS.find(g => g.id === groupId);
  if (!group) return;
  const saved = modLoadState();
  const uniqueIds = [...new Set(group.modules)];
  const total = uniqueIds.length;
  const active = uniqueIds.filter(id => {
    const s = saved[id];
    const def = MOD_DEFAULTS[id] || { enabled: false };
    return s ? s.enabled : (def as any).enabled;
  }).length;
  badge.textContent = `${active} / ${total}`;
  badge.classList.toggle('has-active', active > 0);
}

function updateAllBadges(): void {
  MODULE_GROUPS.forEach(g => updateGroupBadge(g.id));
}

export function toggleGroup(groupId: string, forceState?: boolean): void {
  const groupStates = loadGroupStates();
  const currentEnabled = groupStates[groupId] !== false;
  const enable = forceState !== undefined ? forceState : !currentEnabled;
  groupStates[groupId] = enable;
  saveGroupStates(groupStates);
  document.querySelectorAll(`[data-group-id="${groupId}"]`).forEach(el => {
    el.classList.toggle('enabled', enable);
  });
  const group = MODULE_GROUPS.find(g => g.id === groupId);
  if (!group) return;
  const saved = modLoadState();
  group.modules.forEach(moduleId => {
    const card = document.getElementById('mod-' + moduleId);
    if (!card) return;
    const s = saved[moduleId] || {};
    const def = MOD_DEFAULTS[moduleId] || { enabled: false };
    const individualEnabled = s.enabled !== undefined ? s.enabled : (def as any).enabled;
    const groupsAllow = isModuleVisibleByGroups(moduleId);
    card.classList.toggle('mod-hidden', !(individualEnabled && groupsAllow));
    updateCfgCards(moduleId, individualEnabled, groupsAllow);
  });
  updateAllBadges();
}

export function toggleModule(id: string, forceState?: boolean): void {
  const card = document.getElementById('mod-' + id);
  if (!card) return;
  const groupsAllow = isModuleVisibleByGroups(id);
  const saved = modLoadState();
  const currentIndividual = saved[id]?.enabled ?? !card.classList.contains('mod-hidden');
  const enable = forceState !== undefined ? forceState : !currentIndividual;
  card.classList.toggle('mod-hidden', !(enable && groupsAllow));
  updateCfgCards(id, enable, groupsAllow);
  modSaveState();
  updateAllBadges();
}

export function setModSize(id: string, size: string, evt?: Event): void {
  if (evt) evt.stopPropagation();
  const card = document.getElementById('mod-' + id);
  if (!card) return;
  const w = MOD_SIZES[size] || MOD_SIZES.normal;
  card.style.width = w + 'px';
  (card as HTMLElement).dataset.modSize = size;
  allCfgCards(id).forEach(cfgCard => {
    cfgCard.querySelectorAll('.mod-size-btn').forEach(btn => {
      btn.classList.toggle('active', btn.textContent!.toLowerCase() === size);
    });
  });
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

  const groupStates = loadGroupStates();
  MODULE_GROUPS.forEach(group => {
    const enabled = groupStates[group.id] !== false;
    document.querySelectorAll(`[data-group-id="${group.id}"]`).forEach(el => {
      el.classList.toggle('enabled', enabled);
    });
  });

  MODULE_DEFS.forEach(m => {
    const card = document.getElementById('mod-' + m.id) as HTMLElement | null;
    if (!card) return;
    const def = MOD_DEFAULTS[m.id] || { x: 10, y: 10, enabled: false, size: 'normal' };
    const s = saved[m.id] || {};
    const x = s.x !== undefined ? s.x : def.x;
    const y = s.y !== undefined ? s.y : def.y;
    const individualEnabled = s.enabled !== undefined ? s.enabled : (def as any).enabled;
    const groupsAllow = isModuleVisibleByGroups(m.id);
    const size = s.size || (def as any).size;
    card.style.left = x + 'px';
    card.style.top = y + 'px';
    card.style.width = (MOD_SIZES[size] || MOD_SIZES.normal) + 'px';
    card.dataset.modSize = size;
    card.classList.toggle('mod-hidden', !(individualEnabled && groupsAllow));
    updateCfgCards(m.id, individualEnabled, groupsAllow, size);
  });

  const collapseStates = loadCollapseStates();
  MODULE_GROUPS.forEach(group => {
    const collapsed = collapseStates[group.id] === true;
    const groupEl = document.querySelector(`.mod-group:has([data-group-id="${group.id}"])`);
    if (groupEl) groupEl.classList.toggle('collapsed', collapsed);
  });

  updateAllBadges();
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

  const moduleId = modId.replace('mod-', '');
  if (isModuleDocked(moduleId)) {
    undockModule(moduleId);
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
  e.preventDefault();
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
    e.preventDefault();
    const t = e.touches[0];
    const dx = t.clientX - state._modDrag.startX;
    const dy = t.clientY - state._modDrag.startY;
    state._modDrag.card.style.left = Math.max(0, state._modDrag.origLeft + dx) + 'px';
    state._modDrag.card.style.top = Math.max(0, state._modDrag.origTop + dy) + 'px';
    dockDragMove(t.clientX, t.clientY);
  }, { passive: false });

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
