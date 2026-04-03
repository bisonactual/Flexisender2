// ═══════════════════════════════════════════════
// Dock tree — imgui-style docking for modules
// ═══════════════════════════════════════════════

import { MOD_SIZES, MODULE_DEFS } from './state';
import { lsGet } from './ui';

// ── Data structures ───────────────────────────────────────────────────────────

export type DockSplit = 'horizontal' | 'vertical';

export interface DockSplitNode {
  type: 'split';
  direction: DockSplit;
  ratio: number;           // 0..1, first child gets ratio, second gets 1-ratio
  children: [DockNode, DockNode];
}

export interface DockLeafNode {
  type: 'leaf';
  moduleIds: string[];     // tab group — one or more module ids
  activeTab: number;       // index into moduleIds
}

export interface DockCentralNode {
  type: 'central';         // the viewport — always present, can't be closed
}

export type DockNode = DockSplitNode | DockLeafNode | DockCentralNode;

// ── State ─────────────────────────────────────────────────────────────────────

let _root: DockNode = { type: 'central' };
let _container: HTMLElement | null = null;

export function dockRoot(): DockNode { return _root; }

// ── Init ──────────────────────────────────────────────────────────────────────

export function initDock(container: HTMLElement): void {
  _container = container;
  dockLoad();
  dockRender();
}

// ── Render tree to DOM ────────────────────────────────────────────────────────

export function dockRender(): void {
  if (!_container) return;

  // Detach all docked module cards back to .main before destroying dock nodes
  const main = document.querySelector('.main') as HTMLElement | null;
  _container.querySelectorAll('.module-card.mod-docked').forEach(card => {
    if (main) main.appendChild(card);
  });

  // Also rescue the canvas and stats before removing dock nodes
  const canvas = document.getElementById('threeCanvas');
  const stats = document.getElementById('vpStats');
  if (canvas) _container.appendChild(canvas);
  if (stats) _container.appendChild(stats);

  // Remove old dock layout
  _container.querySelectorAll('.dock-node').forEach(n => n.remove());

  // Build new layout
  const el = renderNode(_root);
  el.style.flex = '1';
  el.style.minWidth = '0';
  el.style.minHeight = '0';
  _container.insertBefore(el, _container.firstChild);

  // Move docked module cards into their leaf slots
  reparentModules(_root);
}

function renderNode(node: DockNode): HTMLElement {
  if (node.type === 'central') return renderCentral();
  if (node.type === 'leaf') return renderLeaf(node);
  return renderSplit(node);
}

function renderCentral(): HTMLElement {
  const div = document.createElement('div');
  div.className = 'dock-node dock-central';
  div.style.display = 'flex';
  div.style.flex = '1';
  div.style.overflow = 'hidden';
  div.style.minWidth = '0';
  div.style.minHeight = '0';
  div.style.position = 'relative';

  // Move the canvas and stats overlay into this node
  const canvas = document.getElementById('threeCanvas');
  const stats = document.getElementById('vpStats');
  if (canvas) div.appendChild(canvas);
  if (stats) div.appendChild(stats);

  return div;
}

function renderLeaf(node: DockLeafNode): HTMLElement {
  const div = document.createElement('div');
  div.className = 'dock-node dock-leaf';
  div.style.display = 'flex';
  div.style.flexDirection = 'column';
  div.style.overflow = 'hidden';
  div.style.minWidth = '0';
  div.style.minHeight = '0';

  // Tab bar if multiple modules
  if (node.moduleIds.length > 1) {
    const tabBar = document.createElement('div');
    tabBar.className = 'dock-tab-bar';
    node.moduleIds.forEach((id, i) => {
      const tab = document.createElement('button');
      tab.className = 'dock-tab' + (i === node.activeTab ? ' active' : '');
      tab.textContent = moduleLabel(id);
      tab.onclick = () => { node.activeTab = i; dockRender(); dockSave(); };
      tabBar.appendChild(tab);
    });
    div.appendChild(tabBar);
  }

  // Content area — the active module's body goes here
  const content = document.createElement('div');
  content.className = 'dock-leaf-content';
  content.style.flex = '1';
  content.style.overflow = 'hidden';
  content.style.minHeight = '0';
  content.dataset.moduleId = node.moduleIds[node.activeTab] || '';
  div.appendChild(content);

  return div;
}

function renderSplit(node: DockSplitNode): HTMLElement {
  const div = document.createElement('div');
  div.className = 'dock-node dock-split';
  div.style.display = 'flex';
  div.style.flexDirection = node.direction === 'horizontal' ? 'row' : 'column';
  div.style.overflow = 'hidden';
  div.style.minWidth = '0';
  div.style.minHeight = '0';

  const first = renderNode(node.children[0]);
  first.style.flex = `${node.ratio} 0 0%`;

  const handle = document.createElement('div');
  handle.className = 'dock-resize-handle ' + (node.direction === 'horizontal' ? 'dock-resize-h' : 'dock-resize-v');
  handle.addEventListener('mousedown', e => startResize(e, node, div));

  const second = renderNode(node.children[1]);
  second.style.flex = `${1 - node.ratio} 0 0%`;

  div.appendChild(first);
  div.appendChild(handle);
  div.appendChild(second);

  return div;
}

function reparentModules(node: DockNode): void {
  if (node.type === 'leaf') {
    const activeId = node.moduleIds[node.activeTab];
    const slot = _container!.querySelector(`.dock-leaf-content[data-module-id="${activeId}"]`) as HTMLElement | null;
    if (!slot) return;
    const card = document.getElementById('mod-' + activeId) as HTMLElement | null;
    if (card) {
      // Convert from floating to docked style
      card.classList.remove('mod-hidden');
      card.classList.add('mod-docked');
      card.style.position = 'relative';
      card.style.top = '';
      card.style.left = '';
      card.style.width = '100%';
      card.style.height = '100%';
      slot.appendChild(card);
    }
    // Hide non-active tabs
    node.moduleIds.forEach((id, i) => {
      if (i === node.activeTab) return;
      const c = document.getElementById('mod-' + id);
      if (c) { c.classList.add('mod-hidden'); c.classList.add('mod-docked'); }
    });
  } else if (node.type === 'split') {
    reparentModules(node.children[0]);
    reparentModules(node.children[1]);
  }
}

// ── Resize handles ────────────────────────────────────────────────────────────

function startResize(e: MouseEvent, node: DockSplitNode, container: HTMLElement): void {
  e.preventDefault();
  const isH = node.direction === 'horizontal';
  const startPos = isH ? e.clientX : e.clientY;
  const rect = container.getBoundingClientRect();
  const totalSize = isH ? rect.width : rect.height;
  const startRatio = node.ratio;

  const onMove = (ev: MouseEvent) => {
    const delta = (isH ? ev.clientX : ev.clientY) - startPos;
    node.ratio = Math.max(0.1, Math.min(0.9, startRatio + delta / totalSize));
    // Update flex directly without full re-render
    const children = container.querySelectorAll(':scope > .dock-node');
    if (children[0]) (children[0] as HTMLElement).style.flex = `${node.ratio} 0 0%`;
    if (children[1]) (children[1] as HTMLElement).style.flex = `${1 - node.ratio} 0 0%`;
  };

  const onUp = () => {
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', onUp);
    dockSave();
  };

  document.addEventListener('mousemove', onMove);
  document.addEventListener('mouseup', onUp);
}

// ── Dock / undock API ─────────────────────────────────────────────────────────

export function dockModule(moduleId: string, side: 'left' | 'right' | 'top' | 'bottom' | 'center', targetNode?: DockNode): void {
  // Remove from tree if already docked
  undockModuleFromTree(moduleId);
  _root = collapseTree(_root);

  const newLeaf: DockLeafNode = { type: 'leaf', moduleIds: [moduleId], activeTab: 0 };

  if (side === 'center' && targetNode && targetNode.type === 'leaf') {
    // Tab into existing leaf
    targetNode.moduleIds.push(moduleId);
    targetNode.activeTab = targetNode.moduleIds.length - 1;
  } else if (targetNode && targetNode !== _root) {
    // Split a specific node — replace it in the tree with a split containing it + new leaf
    const dirMap: Record<string, DockSplit> = { left: 'horizontal', right: 'horizontal', top: 'vertical', bottom: 'vertical' };
    const direction = dirMap[side] || 'horizontal';
    const first = (side === 'right' || side === 'bottom') ? targetNode : newLeaf;
    const second = (side === 'right' || side === 'bottom') ? newLeaf : targetNode;
    const ratio = (side === 'left' || side === 'top') ? 0.3 : 0.7;
    const newSplit: DockSplitNode = { type: 'split', direction, ratio, children: [first, second] };
    _root = replaceNode(_root, targetNode, newSplit);
  } else {
    // Split the root
    const dirMap: Record<string, DockSplit> = { left: 'horizontal', right: 'horizontal', top: 'vertical', bottom: 'vertical' };
    const direction = dirMap[side] || 'horizontal';
    const oldRoot = _root;
    const first = (side === 'right' || side === 'bottom') ? oldRoot : newLeaf;
    const second = (side === 'right' || side === 'bottom') ? newLeaf : oldRoot;
    const ratio = (side === 'left' || side === 'top') ? 0.25 : 0.75;
    _root = { type: 'split', direction, ratio, children: [first, second] };
  }

  dockRender();
  dockSave();
}

function replaceNode(tree: DockNode, target: DockNode, replacement: DockNode): DockNode {
  if (tree === target) return replacement;
  if (tree.type === 'split') {
    tree.children[0] = replaceNode(tree.children[0], target, replacement);
    tree.children[1] = replaceNode(tree.children[1], target, replacement);
  }
  return tree;
}

export function undockModule(moduleId: string): void {
  undockModuleFromTree(moduleId);
  _root = collapseTree(_root);

  // Restore floating style and reparent back to .main
  const card = document.getElementById('mod-' + moduleId) as HTMLElement | null;
  if (card) {
    card.classList.remove('mod-docked');
    card.style.position = 'absolute';
    const size = card.dataset.modSize || 'normal';
    card.style.width = (MOD_SIZES[size] || MOD_SIZES.normal) + 'px';
    card.style.height = '';
    const main = document.querySelector('.main') as HTMLElement | null;
    if (main) main.appendChild(card);
  }

  dockRender();
  dockSave();
}

function undockModuleFromTree(moduleId: string): void {
  _root = removeFromNode(_root, moduleId);
}

function removeFromNode(node: DockNode, moduleId: string): DockNode {
  if (node.type === 'leaf') {
    node.moduleIds = node.moduleIds.filter(id => id !== moduleId);
    if (node.activeTab >= node.moduleIds.length) node.activeTab = Math.max(0, node.moduleIds.length - 1);
    return node;
  }
  if (node.type === 'split') {
    node.children[0] = removeFromNode(node.children[0], moduleId);
    node.children[1] = removeFromNode(node.children[1], moduleId);
    return node;
  }
  return node;
}

function collapseTree(node: DockNode): DockNode {
  if (node.type !== 'split') return node;
  node.children[0] = collapseTree(node.children[0]);
  node.children[1] = collapseTree(node.children[1]);

  // If a child is an empty leaf, promote the other child
  if (node.children[0].type === 'leaf' && node.children[0].moduleIds.length === 0) return node.children[1];
  if (node.children[1].type === 'leaf' && node.children[1].moduleIds.length === 0) return node.children[0];
  return node;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function moduleLabel(id: string): string {
  return MODULE_DEFS.find(m => m.id === id)?.name || id;
}

export function isModuleDocked(moduleId: string): boolean {
  return findInTree(_root, moduleId);
}

function findInTree(node: DockNode, moduleId: string): boolean {
  if (node.type === 'leaf') return node.moduleIds.includes(moduleId);
  if (node.type === 'split') return findInTree(node.children[0], moduleId) || findInTree(node.children[1], moduleId);
  return false;
}

// ── Drag-to-dock overlay ──────────────────────────────────────────────────────

let _dockPreview: HTMLElement | null = null;
let _dragModuleId: string | null = null;
let _dragActive = false;

export function dockDragStart(moduleId: string): void {
  _dragModuleId = moduleId;
  _dragActive = true;
  if (!_dockPreview) {
    _dockPreview = document.createElement('div');
    _dockPreview.className = 'dock-preview';
    document.body.appendChild(_dockPreview);
  }
  _dockPreview.style.display = 'none';
}

export function dockDragMove(clientX: number, clientY: number): void {
  if (!_dragActive || !_container || !_dockPreview) return;

  const hit = hitTestDockZone(clientX, clientY);
  if (hit) {
    _dockPreview.style.display = 'block';
    _dockPreview.style.left = hit.rect.left + 'px';
    _dockPreview.style.top = hit.rect.top + 'px';
    _dockPreview.style.width = hit.rect.width + 'px';
    _dockPreview.style.height = hit.rect.height + 'px';
  } else {
    _dockPreview.style.display = 'none';
  }
}

export function dockDragEnd(clientX: number, clientY: number): boolean {
  if (!_dragActive || !_dragModuleId) { dockDragCancel(); return false; }

  const hit = hitTestDockZone(clientX, clientY);
  const moduleId = _dragModuleId;
  dockDragCancel();

  if (hit && moduleId) {
    dockModule(moduleId, hit.side, hit.targetNode);
    return true;
  }
  return false;
}

export function dockDragCancel(): void {
  _dragActive = false;
  _dragModuleId = null;
  if (_dockPreview) _dockPreview.style.display = 'none';
}

interface DockHit {
  side: 'left' | 'right' | 'top' | 'bottom' | 'center';
  targetNode?: DockNode;
  rect: { left: number; top: number; width: number; height: number };
}

function hitTestDockZone(clientX: number, clientY: number): DockHit | null {
  if (!_container) return null;
  const cr = _container.getBoundingClientRect();
  const inContainer = clientX >= cr.left && clientX <= cr.right && clientY >= cr.top && clientY <= cr.bottom;
  if (!inContainer) return null;

  // Test against existing dock leaves — side splits + center for tabs
  const leaves = _container.querySelectorAll('.dock-leaf');
  for (const leaf of leaves) {
    const lr = leaf.getBoundingClientRect();
    if (clientX < lr.left || clientX > lr.right || clientY < lr.top || clientY > lr.bottom) continue;

    const contentEl = leaf.querySelector('.dock-leaf-content') as HTMLElement | null;
    const leafModId = contentEl?.dataset.moduleId;
    const leafNode = leafModId ? findLeafNode(_root, leafModId) : null;
    if (!leafNode) continue;

    const fracX = (clientX - lr.left) / lr.width;
    const fracY = (clientY - lr.top) / lr.height;

    // Edge zones → split the leaf
    if (fracX < 0.2) return { side: 'left', targetNode: leafNode, rect: { left: lr.left, top: lr.top, width: lr.width * 0.5, height: lr.height } };
    if (fracX > 0.8) return { side: 'right', targetNode: leafNode, rect: { left: lr.left + lr.width * 0.5, top: lr.top, width: lr.width * 0.5, height: lr.height } };
    if (fracY < 0.2) return { side: 'top', targetNode: leafNode, rect: { left: lr.left, top: lr.top, width: lr.width, height: lr.height * 0.5 } };
    if (fracY > 0.8) return { side: 'bottom', targetNode: leafNode, rect: { left: lr.left, top: lr.top + lr.height * 0.5, width: lr.width, height: lr.height * 0.5 } };
    // Center zone → tab into
    return { side: 'center', targetNode: leafNode, rect: { left: lr.left, top: lr.top, width: lr.width, height: lr.height } };
  }

  // Test against the central node — side docks only
  const central = _container.querySelector('.dock-central') as HTMLElement | null;
  if (central) {
    const vr = central.getBoundingClientRect();
    const inCentral = clientX >= vr.left && clientX <= vr.right && clientY >= vr.top && clientY <= vr.bottom;
    if (inCentral) {
      const fracX = (clientX - vr.left) / vr.width;
      if (fracX < 0.15) return { side: 'left', rect: { left: vr.left, top: vr.top, width: vr.width * 0.25, height: vr.height } };
      if (fracX > 0.85) return { side: 'right', rect: { left: vr.left + vr.width * 0.75, top: vr.top, width: vr.width * 0.25, height: vr.height } };
    }
  }

  // Root edge zones — left/right only
  const edgeSize = 60;
  if (clientX - cr.left < edgeSize) return { side: 'left', rect: { left: cr.left, top: cr.top, width: cr.width * 0.25, height: cr.height } };
  if (cr.right - clientX < edgeSize) return { side: 'right', rect: { left: cr.left + cr.width * 0.75, top: cr.top, width: cr.width * 0.25, height: cr.height } };

  return null;
}

function findLeafNode(node: DockNode, moduleId: string): DockLeafNode | null {
  if (node.type === 'leaf' && node.moduleIds.includes(moduleId)) return node;
  if (node.type === 'split') {
    return findLeafNode(node.children[0], moduleId) || findLeafNode(node.children[1], moduleId);
  }
  return null;
}

// ── Persistence ───────────────────────────────────────────────────────────────

function dockSave(): void {
  try {
  } catch (_) {}
}

function dockLoad(): void {
  const d = lsGet<any>('fs-dock-tree', null);
  if (d?.root) _root = d.root;
}
