// ═══════════════════════════════════════════════
// Center finder module UI
// ═══════════════════════════════════════════════

import { h } from '../jsx';
import { state } from '../state';
import { log } from '../console';
import { lsGet, lsSet } from '../ui';
import { runCenterFinder } from './center-finder';
import { cancelProbing, getActiveWcs } from './probe-program';
import { waypointsCenter } from './preview';

const CFG_KEY = 'fs-probing-tab-cf';

function loadCfg(): any {
  return {
    centerMode: 'inside', axes: 'XY',
    probeFeedRate: 100, latchFeedRate: 25,
    probeDistance: 10, latchDistance: 1,
    xyClr: 5, depth: 3, probeDiameter: 2,
    workpieceSizeX: 50, workpieceSizeY: 50, passes: 1,
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
  if (el) { el.textContent = msg; el.className = `prob-status prob-status-${type}`; }
}

export function mount(parent: HTMLElement): void {
  const cfg = loadCfg();
  const card = h('div', { class: 'module-card mod-hidden', id: 'mod-centerfinder', dataset: { modSize: 'normal' }, style: 'top:10px;left:302px' },
    h('div', { class: 'module-drag-handle' },
      h('span', { class: 'module-drag-dots' }, '⠿⠿'),
      h('span', { class: 'module-drag-title' }, 'Center Finder'),
      h('button', { class: 'module-drag-close', onClick: () => card.classList.add('mod-hidden') }, '✕')),
    h('div', { class: 'module-body', style: 'gap:8px;overflow-y:auto;max-height:80vh' },
      h('div', { class: 'prob-section' },
        h('div', { class: 'prob-section-label' }, 'Center Mode'),
        h('div', { style: 'display:flex;gap:6px;' },
          h('label', { class: 'prob-mode-btn' },
            h('input', { type: 'radio', name: 'modCfMode', id: 'modCfModeInside', value: 'inside', checked: cfg.centerMode === 'inside' }), 'Inside (bore)'),
          h('label', { class: 'prob-mode-btn' },
            h('input', { type: 'radio', name: 'modCfMode', id: 'modCfModeOutside', value: 'outside', checked: cfg.centerMode === 'outside' }), 'Outside (boss)'))),
      h('div', { class: 'prob-section' },
        h('div', { class: 'prob-section-label' }, 'Axes'),
        h('div', { style: 'display:flex;gap:6px;' },
          h('label', { class: 'prob-mode-btn' },
            h('input', { type: 'radio', name: 'modCfAxes', id: 'modCfAxesXY', value: 'XY', checked: cfg.axes === 'XY' }), 'XY'),
          h('label', { class: 'prob-mode-btn' },
            h('input', { type: 'radio', name: 'modCfAxes', id: 'modCfAxesX', value: 'X', checked: cfg.axes === 'X' }), 'X only'),
          h('label', { class: 'prob-mode-btn' },
            h('input', { type: 'radio', name: 'modCfAxes', id: 'modCfAxesY', value: 'Y', checked: cfg.axes === 'Y' }), 'Y only'))),
      h('div', { class: 'prob-section' },
        h('div', { class: 'prob-section-label' }, 'Workpiece Size'),
        h('div', { class: 'prob-row' }, h('span', { class: 'prob-label' }, 'X size (mm)'), h('input', { type: 'number', class: 'prob-input', id: 'modCfSizeX', value: String(cfg.workpieceSizeX), min: '1', step: '1' })),
        h('div', { class: 'prob-row' }, h('span', { class: 'prob-label' }, 'Y size (mm)'), h('input', { type: 'number', class: 'prob-input', id: 'modCfSizeY', value: String(cfg.workpieceSizeY), min: '1', step: '1' }))),
      h('div', { class: 'prob-section' },
        h('div', { class: 'prob-section-label' }, 'Probe Settings'),
        h('div', { class: 'prob-row' }, h('span', { class: 'prob-label' }, 'Probe feed (mm/min)'), h('input', { type: 'number', class: 'prob-input', id: 'modCfProbeFeed', value: String(cfg.probeFeedRate), min: '1', step: '10' })),
        h('div', { class: 'prob-row' }, h('span', { class: 'prob-label' }, 'Latch feed (mm/min)'), h('input', { type: 'number', class: 'prob-input', id: 'modCfLatchFeed', value: String(cfg.latchFeedRate), min: '1', step: '5' })),
        h('div', { class: 'prob-row' }, h('span', { class: 'prob-label' }, 'Probe distance (mm)'), h('input', { type: 'number', class: 'prob-input', id: 'modCfProbeDist', value: String(cfg.probeDistance), min: '1', step: '1' })),
        h('div', { class: 'prob-row' }, h('span', { class: 'prob-label' }, 'Latch distance (mm)'), h('input', { type: 'number', class: 'prob-input', id: 'modCfLatchDist', value: String(cfg.latchDistance), min: '0.1', step: '0.1' })),
        h('div', { class: 'prob-row' }, h('span', { class: 'prob-label' }, 'XY clearance (mm)'), h('input', { type: 'number', class: 'prob-input', id: 'modCfXYClr', value: String(cfg.xyClr), min: '0.5', step: '0.5' })),
        h('div', { class: 'prob-row' }, h('span', { class: 'prob-label' }, 'Probe depth (mm)'), h('input', { type: 'number', class: 'prob-input', id: 'modCfDepth', value: String(cfg.depth), min: '0.5', step: '0.5' })),
        h('div', { class: 'prob-row' }, h('span', { class: 'prob-label' }, 'Probe diameter (mm)'), h('input', { type: 'number', class: 'prob-input', id: 'modCfDiameter', value: String(cfg.probeDiameter), min: '0', step: '0.1' })),
        h('div', { class: 'prob-row' }, h('span', { class: 'prob-label' }, 'Passes'), h('input', { type: 'number', class: 'prob-input', id: 'modCfPasses', value: String(cfg.passes), min: '1', max: '5', step: '1' }))),
      h('div', { class: 'prob-section' },
        h('div', { class: 'prob-row' }, h('span', { class: 'prob-label' }, 'Write to WCS'),
          h('select', { class: 'prob-select', id: 'modCfWcs' },
            h('option', { value: '' }, '— use active (', (state as any).activeWcs || 'G54', ') —'),
            ...['G54','G55','G56','G57','G58','G59','G59.1','G59.2','G59.3'].map(o => h('option', { value: o }, o)))),
        h('div', { class: 'prob-row' }, h('span', { class: 'prob-label' }, 'Coordinate mode'),
          h('select', { class: 'prob-select', id: 'modCfCoordMode' },
            h('option', { value: 'G10' }, 'G10 — Persistent WCS'),
            h('option', { value: 'G92' }, 'G92 — Session offset'),
            h('option', { value: 'measure' }, 'Measure only')))),
      h('div', { class: 'prob-status prob-status-idle', id: 'modCfStatus' }, 'Ready'),
      h('div', { style: 'display:flex;gap:6px;' },
        h('button', { class: 'tb-btn', style: 'padding:8px;font-size:11px', id: 'modCfPreview' }, '◈ PREVIEW'),
        h('button', { class: 'tb-btn success', style: 'flex:1;padding:10px;font-size:13px', id: 'modCfProbe' }, '⊕ PROBE'),
        h('button', { class: 'tb-btn danger', style: 'padding:10px;font-size:13px', id: 'modCfCancel', disabled: true }, '✕'))));

  parent.appendChild(card);

  card.querySelector('#modCfPreview')?.addEventListener('click', () => {
    const centerMode = (card.querySelector('input[name="modCfMode"]:checked') as HTMLInputElement)?.value || 'inside';
    const axes = (card.querySelector('input[name="modCfAxes"]:checked') as HTMLInputElement)?.value || 'XY';
    const wps = waypointsCenter({
      centerMode, axes,
      sizeX: numVal('modCfSizeX'), sizeY: numVal('modCfSizeY'),
      xyClr: numVal('modCfXYClr'), depth: numVal('modCfDepth'),
      probeDistance: numVal('modCfProbeDist'), latchDistance: numVal('modCfLatchDist'),
      probeDiameter: numVal('modCfDiameter'),
    });
    (window as any).loadPreview3D?.(wps);
  });

  const probeBtn = card.querySelector('#modCfProbe') as HTMLButtonElement;
  const cancelBtn = card.querySelector('#modCfCancel') as HTMLButtonElement;
  probeBtn.addEventListener('click', async () => {
    if (!state.connected) { log('err', 'Not connected'); return; }
    const centerMode = (card.querySelector('input[name="modCfMode"]:checked') as HTMLInputElement)?.value || 'inside';
    const axes = (card.querySelector('input[name="modCfAxes"]:checked') as HTMLInputElement)?.value || 'XY';
    const cfg2 = {
      centerMode, axes,
      probeFeedRate: numVal('modCfProbeFeed'), latchFeedRate: numVal('modCfLatchFeed'),
      probeDistance: numVal('modCfProbeDist'), latchDistance: numVal('modCfLatchDist'),
      xyClr: numVal('modCfXYClr'), depth: numVal('modCfDepth'),
      probeDiameter: numVal('modCfDiameter'),
      workpieceSizeX: numVal('modCfSizeX'), workpieceSizeY: numVal('modCfSizeY'),
      passes: numVal('modCfPasses') || 1,
      coordMode: getCoordMode('modCfCoordMode'), wcs: getWcs('modCfWcs'),
    };
    saveCfg(cfg2);
    probeBtn.disabled = true; cancelBtn.disabled = false;
    setStatus('modCfStatus', 'Finding center…', 'running');
    const ok = await runCenterFinder(cfg2);
    probeBtn.disabled = false; cancelBtn.disabled = true;
    setStatus('modCfStatus', ok ? '✓ Center found' : '✗ Probe failed', ok ? 'ok' : 'err');
  });

  cancelBtn.addEventListener('click', () => {
    cancelProbing();
    setStatus('modCfStatus', 'Cancelled');
    probeBtn.disabled = false; cancelBtn.disabled = true;
  });
}
