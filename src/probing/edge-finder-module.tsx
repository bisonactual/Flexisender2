// ═══════════════════════════════════════════════
// Edge finder module UI
// ═══════════════════════════════════════════════

import { h } from '../jsx';
import { state } from '../state';
import { log } from '../console';
import { lsGet, lsSet } from '../ui';
import { runEdgeFinder } from './edge-finder';
import { cancelProbing, getActiveWcs } from './probe-program';
import { waypointsTouchplate, waypointsEdgeCorner, waypointsEdgeSingle } from './preview';

const CFG_KEY = 'fs-probing-tab-ef';

const edgeButtons = [
  { id: 'D', label: 'D ↘', title: 'Corner D (top-left)' },
  { id: 'CD', label: '↓ CD', title: 'Edge CD (top, Y+)' },
  { id: 'C', label: 'C ↙', title: 'Corner C (top-right)' },
  { id: 'AD', label: '→ AD', title: 'Edge AD (left, X-)' },
  { id: 'Z', label: '↓ Z', title: 'Z surface' },
  { id: 'CB', label: 'CB ←', title: 'Edge CB (right, X+)' },
  { id: 'A', label: 'A ↗', title: 'Corner A (bottom-left)' },
  { id: 'AB', label: '↑ AB', title: 'Edge AB (bottom, Y-)' },
  { id: 'B', label: 'B ↖', title: 'Corner B (bottom-right)' },
];

function loadCfg(): any {
  return {
    mode: 'external',
    probeFeedRate: 100, latchFeedRate: 25,
    probeDistance: 10, latchDistance: 1,
    xyClr: 5, depth: 3, offset: 5,
    probeDiameter: 2, probeZ: false,
    touchPlateHeight: 0, workpieceHeight: 0,
    ...lsGet(CFG_KEY, {}),
  };
}

function saveCfg(cfg: any): void { lsSet(CFG_KEY, cfg); }

function numVal(id: string): number {
  return parseFloat((document.getElementById(id) as HTMLInputElement)?.value || '0') || 0;
}

function getWcs(id: string): string {
  return (document.getElementById(id) as HTMLSelectElement)?.value || getActiveWcs();
}

function getCoordMode(id: string): string {
  return (document.getElementById(id) as HTMLSelectElement)?.value || 'G10';
}

function setStatus(id: string, msg: string, type = 'idle'): void {
  const el = document.getElementById(id);
  if (el) {
    el.textContent = msg;
    el.className = `prob-status prob-status-${type}`;
  }
}

export function mount(parent: HTMLElement): void {
  const cfg = loadCfg();
  const card = h('div', { class: 'module-card mod-hidden', id: 'mod-edgefinder', dataset: { modSize: 'normal' }, style: 'top:10px;left:302px' },
    h('div', { class: 'module-drag-handle' },
      h('span', { class: 'module-drag-dots' }, '⠿⠿'),
      h('span', { class: 'module-drag-title' }, 'Edge Finder'),
      h('button', { class: 'module-drag-close', onClick: () => card.classList.add('mod-hidden') }, '✕')),
    h('div', { class: 'module-body', style: 'gap:8px;overflow-y:auto;max-height:80vh' },
      h('div', { class: 'prob-section' },
        h('div', { class: 'prob-section-label' }, 'Mode'),
        h('div', { style: 'display:flex;gap:6px;' },
          h('label', { class: 'prob-mode-btn' },
            h('input', { type: 'radio', name: 'modEfMode', id: 'modEfModeExt', value: 'external', checked: cfg.mode === 'external' }), 'External'),
          h('label', { class: 'prob-mode-btn' },
            h('input', { type: 'radio', name: 'modEfMode', id: 'modEfModeInt', value: 'internal', checked: cfg.mode === 'internal' }), 'Internal'))),
      h('div', { class: 'prob-section' },
        h('div', { class: 'prob-section-label' }, 'Select Edge / Corner'),
        h('div', { class: 'prob-edge-grid' },
          ...edgeButtons.map(e =>
            h('button', { class: 'prob-edge-btn', id: `modEfEdge-${e.id}`, 'data-edge': e.id, title: e.title }, e.label))),
        h('div', { class: 'ef-diagram' },
          h('div', { class: 'ef-diag-top-row' },
            h('div', { class: 'ef-diag-corner-label' }, 'D'),
            h('div', { class: 'ef-diag-edge-label ef-diag-top' }, 'CD \u00A0Y+'),
            h('div', { class: 'ef-diag-corner-label' }, 'C')),
          h('div', { class: 'ef-diag-mid-row' },
            h('div', { class: 'ef-diag-edge-label ef-diag-left' }, 'AD', h('br', null), 'X−'),
            h('div', { class: 'ef-diag-box' }, h('span', { class: 'ef-diag-z-label' }, 'Z')),
            h('div', { class: 'ef-diag-edge-label ef-diag-right' }, 'CB', h('br', null), 'X+')),
          h('div', { class: 'ef-diag-bot-row' },
            h('div', { class: 'ef-diag-corner-label' }, 'A'),
            h('div', { class: 'ef-diag-edge-label ef-diag-bot' }, 'AB \u00A0Y−'),
            h('div', { class: 'ef-diag-corner-label' }, 'B')))),
      h('div', { class: 'prob-section' },
        h('div', { class: 'prob-section-label' }, 'Probe Settings'),
        h('div', { class: 'prob-row' }, h('span', { class: 'prob-label' }, 'Probe feed (mm/min)'), h('input', { type: 'number', class: 'prob-input', id: 'modEfProbeFeed', value: String(cfg.probeFeedRate), min: '1', step: '10' })),
        h('div', { class: 'prob-row' }, h('span', { class: 'prob-label' }, 'Latch feed (mm/min)'), h('input', { type: 'number', class: 'prob-input', id: 'modEfLatchFeed', value: String(cfg.latchFeedRate), min: '1', step: '5' })),
        h('div', { class: 'prob-row' }, h('span', { class: 'prob-label' }, 'Probe distance (mm)'), h('input', { type: 'number', class: 'prob-input', id: 'modEfProbeDist', value: String(cfg.probeDistance), min: '1', step: '1' })),
        h('div', { class: 'prob-row' }, h('span', { class: 'prob-label' }, 'Latch distance (mm)'), h('input', { type: 'number', class: 'prob-input', id: 'modEfLatchDist', value: String(cfg.latchDistance), min: '0.1', step: '0.1' })),
        h('div', { class: 'prob-row' }, h('span', { class: 'prob-label' }, 'XY clearance (mm)'), h('input', { type: 'number', class: 'prob-input', id: 'modEfXYClr', value: String(cfg.xyClr), min: '0.5', step: '0.5' })),
        h('div', { class: 'prob-row' }, h('span', { class: 'prob-label' }, 'Probe depth (mm)'), h('input', { type: 'number', class: 'prob-input', id: 'modEfDepth', value: String(cfg.depth), min: '0.5', step: '0.5' })),
        h('div', { class: 'prob-row' }, h('span', { class: 'prob-label' }, 'Corner offset (mm)'), h('input', { type: 'number', class: 'prob-input', id: 'modEfOffset', value: String(cfg.offset), min: '1', step: '1' })),
        h('div', { class: 'prob-row' }, h('span', { class: 'prob-label' }, 'Probe diameter (mm)'), h('input', { type: 'number', class: 'prob-input', id: 'modEfDiameter', value: String(cfg.probeDiameter), min: '0', step: '0.1' })),
        h('div', { class: 'prob-row' }, h('span', { class: 'prob-label' }, 'Also probe Z'),
          h('label', { class: 'prob-toggle' }, h('input', { type: 'checkbox', id: 'modEfProbeZ', checked: cfg.probeZ }), ' Yes'))),
      h('div', { class: 'prob-section', id: 'modEfZSection', style: cfg.probeZ ? '' : 'display:none' },
        h('div', { class: 'prob-section-label' }, 'Z Probe'),
        h('div', { class: 'prob-row' }, h('span', { class: 'prob-label' }, 'Touch plate height (mm)'), h('input', { type: 'number', class: 'prob-input', id: 'modEfPlateHeight', value: String(cfg.touchPlateHeight), min: '0', step: '0.1' })),
        h('div', { class: 'prob-row' }, h('span', { class: 'prob-label' }, 'Workpiece height (mm)'), h('input', { type: 'number', class: 'prob-input', id: 'modEfWpHeight', value: String(cfg.workpieceHeight), min: '0', step: '0.1' }))),
      h('div', { class: 'prob-section' },
        h('div', { class: 'prob-row' }, h('span', { class: 'prob-label' }, 'Write to WCS'),
          h('select', { class: 'prob-select', id: 'modEfWcs' },
            h('option', { value: '' }, '— use active (', (state as any).activeWcs || 'G54', ') —'),
            ...['G54','G55','G56','G57','G58','G59','G59.1','G59.2','G59.3'].map(o => h('option', { value: o }, o)))),
        h('div', { class: 'prob-row' }, h('span', { class: 'prob-label' }, 'Coordinate mode'),
          h('select', { class: 'prob-select', id: 'modEfCoordMode' },
            h('option', { value: 'G10' }, 'G10 — Persistent WCS'),
            h('option', { value: 'G92' }, 'G92 — Session offset'),
            h('option', { value: 'measure' }, 'Measure only')))),
      h('div', { class: 'prob-status prob-status-idle', id: 'modEfStatus' }, 'Select an edge or corner, then click PROBE'),
      h('div', { style: 'display:flex;gap:6px;' },
        h('button', { class: 'tb-btn', style: 'padding:8px;font-size:11px', id: 'modEfPreview' }, '◈ PREVIEW'),
        h('button', { class: 'tb-btn success', style: 'flex:1;padding:10px;font-size:13px', id: 'modEfProbe' }, '⊕ PROBE'),
        h('button', { class: 'tb-btn danger', style: 'padding:10px;font-size:13px', id: 'modEfCancel', disabled: true }, '✕'))));

  parent.appendChild(card);

  let selectedEdge: string | null = null;
  card.querySelectorAll('.prob-edge-btn').forEach((btn: any) => {
    btn.addEventListener('click', () => {
      card.querySelectorAll('.prob-edge-btn').forEach((b: any) => b.classList.remove('active'));
      btn.classList.add('active');
      selectedEdge = btn.dataset.edge;
      setStatus('modEfStatus', `Edge: ${selectedEdge} selected`);
    });
  });

  card.querySelector('#modEfProbeZ')?.addEventListener('change', function(this: HTMLInputElement) {
    const sec = document.getElementById('modEfZSection');
    if (sec) sec.style.display = this.checked ? '' : 'none';
  });

  card.querySelector('#modEfPreview')?.addEventListener('click', () => {
    if (!selectedEdge) { setStatus('modEfStatus', 'Select an edge or corner first', 'err'); return; }
    const mode = (card.querySelector('input[name="modEfMode"]:checked') as HTMLInputElement)?.value || 'external';
    const cfg2 = {
      edge: selectedEdge, mode,
      xyClr: numVal('modEfXYClr'), depth: numVal('modEfDepth'), offset: numVal('modEfOffset'),
      probeDistance: numVal('modEfProbeDist'), latchDistance: numVal('modEfLatchDist'), probeDiameter: numVal('modEfDiameter'),
    };
    const wps = selectedEdge === 'Z' ? waypointsTouchplate({ probeDistance: cfg2.probeDistance, latchDistance: cfg2.latchDistance, touchPlateHeight: 0 })
      : selectedEdge.length === 1 ? waypointsEdgeCorner(cfg2) : waypointsEdgeSingle(cfg2);
    (window as any).loadPreview3D?.(wps);
  });

  const probeBtn = card.querySelector('#modEfProbe') as HTMLButtonElement;
  const cancelBtn = card.querySelector('#modEfCancel') as HTMLButtonElement;
  probeBtn.addEventListener('click', async () => {
    if (!state.connected) { log('err', 'Not connected'); return; }
    if (!selectedEdge) { setStatus('modEfStatus', 'Select an edge or corner first', 'err'); return; }
    const mode = (card.querySelector('input[name="modEfMode"]:checked') as HTMLInputElement)?.value || 'external';
    const cfg2 = {
      mode, edge: selectedEdge,
      probeFeedRate: numVal('modEfProbeFeed'), latchFeedRate: numVal('modEfLatchFeed'),
      probeDistance: numVal('modEfProbeDist'), latchDistance: numVal('modEfLatchDist'),
      xyClr: numVal('modEfXYClr'), depth: numVal('modEfDepth'), offset: numVal('modEfOffset'),
      probeDiameter: numVal('modEfDiameter'),
      probeZ: (card.querySelector('#modEfProbeZ') as HTMLInputElement)?.checked ?? false,
      touchPlateHeight: numVal('modEfPlateHeight'), workpieceHeight: numVal('modEfWpHeight'),
      coordMode: getCoordMode('modEfCoordMode'), wcs: getWcs('modEfWcs'),
    };
    saveCfg(cfg2);
    probeBtn.disabled = true; cancelBtn.disabled = false;
    setStatus('modEfStatus', `Probing ${selectedEdge}…`, 'running');
    const ok = await runEdgeFinder(cfg2);
    probeBtn.disabled = false; cancelBtn.disabled = true;
    setStatus('modEfStatus', ok ? `✓ ${selectedEdge} complete` : '✗ Probe failed', ok ? 'ok' : 'err');
  });

  cancelBtn.addEventListener('click', () => {
    cancelProbing();
    setStatus('modEfStatus', 'Cancelled');
    probeBtn.disabled = false; cancelBtn.disabled = true;
  });
}
