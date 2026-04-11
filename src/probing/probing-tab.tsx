// ═══════════════════════════════════════════════
// Main probing tab with sub-tabs
// ═══════════════════════════════════════════════

import { h } from '../jsx';
import { state } from '../state';
import { sendCmd } from '../connection';
import { log } from '../console';
import { lsGet, lsSet } from '../ui';
import { getActiveWcs, cancelProbing, runToolLengthProbe, isProbingRunning } from './probe-program';
import { runEdgeFinder } from './edge-finder';
import { runCenterFinder } from './center-finder';
import { runRotation, applyRotationToGcode } from './rotation';
import {
  waypointsTouchplate, waypointsToolsetter, waypointsEdgeSingle,
  waypointsEdgeCorner, waypointsCenter, waypointsRotation,
  stepPreview, playPreview, renderPreview,
} from './preview';

const SAVE_KEY = 'fs-probing-tab';

function loadCfg(sub: string, defaults: any): any {
  return { ...defaults, ...lsGet(`${SAVE_KEY}-${sub}`, {}) };
}

function saveCfg(sub: string, cfg: any): void {
  lsSet(`${SAVE_KEY}-${sub}`, cfg);
}

function WcsSelector({ id }: { id: string }): any {
  const options = ['G54','G55','G56','G57','G58','G59','G59.1','G59.2','G59.3'];
  return h('div', { class: 'prob-row' },
    h('span', { class: 'prob-label' }, 'Write to WCS'),
    h('select', { class: 'prob-select', id },
      h('option', { value: '' }, '— use active (', (state as any).activeWcs || 'G54', ') —'),
      ...options.map(o => h('option', { value: o }, o, o === 'G59.3' ? ' (Toolsetter)' : ''))));
}

function CoordModeSelector({ id }: { id: string }): any {
  return h('div', { class: 'prob-row' },
    h('span', { class: 'prob-label' }, 'Coordinate mode'),
    h('select', { class: 'prob-select', id },
      h('option', { value: 'G10' }, 'G10 — Persistent WCS'),
      h('option', { value: 'G92' }, 'G92 — Session offset'),
      h('option', { value: 'measure' }, 'Measure only')));
}

function getWcs(selectId: string): string {
  const el = document.getElementById(selectId) as HTMLSelectElement | null;
  return el?.value || getActiveWcs();
}

function getCoordMode(selectId: string): string {
  const el = document.getElementById(selectId) as HTMLSelectElement | null;
  return el?.value || 'G10';
}

function numVal(id: string): number {
  return parseFloat((document.getElementById(id) as HTMLInputElement)?.value || '0') || 0;
}

function setStatus(id: string, msg: string, type = 'idle'): void {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = msg;
  el.className = `prob-status prob-status-${type}`;
}

function initSubTabs(container: HTMLElement): void {
  container.querySelectorAll('.prob-subtab-btn').forEach((btn: any) => {
    btn.addEventListener('click', () => {
      const tab = btn.dataset.subtab;
      container.querySelectorAll('.prob-subtab-btn').forEach((b: any) => b.classList.remove('active'));
      container.querySelectorAll('.prob-subtab-panel').forEach((p: any) => p.style.display = 'none');
      btn.classList.add('active');
      const panel = container.querySelector(`#probpanel-${tab}`) as HTMLElement | null;
      if (panel) panel.style.display = 'flex';
    });
  });
}

function buildToolLengthTab(): HTMLElement {
  const tlCfg = loadCfg('tl', {
    mode: 'touchplate', probeFeedRate: 100, latchFeedRate: 25,
    probeDistance: 50, latchDistance: 1, touchPlateHeight: 0,
    toolsetterDepth: 10, tloReference: null,
  });
  return h('div', { class: 'prob-subtab-panel', id: 'probpanel-toollength', style: 'display:flex;flex-direction:column;gap:8px;padding:12px;overflow-y:auto;' },
    h('div', { class: 'prob-section' },
      h('div', { class: 'prob-section-label' }, 'Mode'),
      h('div', { style: 'display:flex;gap:6px;' },
        h('label', { class: 'prob-mode-btn' }, h('input', { type: 'radio', name: 'probTlMode', id: 'probTlModeTouch', value: 'touchplate', checked: tlCfg.mode === 'touchplate' }), 'Touch Plate'),
        h('label', { class: 'prob-mode-btn' }, h('input', { type: 'radio', name: 'probTlMode', id: 'probTlModeToolsetter', value: 'toolsetter', checked: tlCfg.mode === 'toolsetter' }), 'Toolsetter (G59.3)'))),
    h('div', { class: 'prob-section' },
      h('div', { class: 'prob-section-label' }, 'Probe Settings'),
      h('div', { class: 'prob-row' }, h('span', { class: 'prob-label' }, 'Probe feed (mm/min)'), h('input', { type: 'number', class: 'prob-input', id: 'probTlProbeFeed', value: String(tlCfg.probeFeedRate), min: '1', step: '10' })),
      h('div', { class: 'prob-row' }, h('span', { class: 'prob-label' }, 'Latch feed (mm/min)'), h('input', { type: 'number', class: 'prob-input', id: 'probTlLatchFeed', value: String(tlCfg.latchFeedRate), min: '1', step: '5' })),
      h('div', { class: 'prob-row' }, h('span', { class: 'prob-label' }, 'Probe distance (mm)'), h('input', { type: 'number', class: 'prob-input', id: 'probTlProbeDist', value: String(tlCfg.probeDistance), min: '1', step: '5' })),
      h('div', { class: 'prob-row' }, h('span', { class: 'prob-label' }, 'Latch distance (mm)'), h('input', { type: 'number', class: 'prob-input', id: 'probTlLatchDist', value: String(tlCfg.latchDistance), min: '0.1', step: '0.1' }))),
    h('div', { class: 'prob-section', id: 'probTlTouchSection', style: tlCfg.mode === 'toolsetter' ? 'display:none' : '' },
      h('div', { class: 'prob-section-label' }, 'Touch Plate'),
      h('div', { class: 'prob-row' }, h('span', { class: 'prob-label' }, 'Plate height (mm)'), h('input', { type: 'number', class: 'prob-input', id: 'probTlPlateHeight', value: String(tlCfg.touchPlateHeight), min: '0', step: '0.1' }))),
    h('div', { class: 'prob-section', id: 'probTlToolsetterSection', style: tlCfg.mode !== 'toolsetter' ? 'display:none' : '' },
      h('div', { class: 'prob-section-label' }, 'Toolsetter'),
      h('div', { class: 'prob-row' }, h('span', { class: 'prob-label' }, 'Approach depth (mm)'), h('input', { type: 'number', class: 'prob-input', id: 'probTlTsDepth', value: String(tlCfg.toolsetterDepth), min: '1', step: '1' })),
      h('div', { style: 'font-family:var(--mono);font-size:10px;color:var(--text3);' }, 'Position from G59.3 in Offsets tab')),
    h('div', { class: 'prob-section' },
      h('div', { class: 'prob-section-label' }, 'Reference Tool'),
      h('div', { class: 'prob-ref-display', id: 'probTlRefDisplay' }, tlCfg.tloReference !== null ? `Ref: ${tlCfg.tloReference.toFixed(4)} mm` : 'No reference set'),
      h('div', { style: 'display:flex;gap:5px;margin-top:5px;' },
        h('button', { class: 'tb-btn', style: 'flex:1;font-size:10px;padding:5px', id: 'probTlSetRef' }, 'SET REF TOOL'),
        h('button', { class: 'tb-btn danger', id: 'probTlClearRef', style: `font-size:10px;padding:5px;display:${tlCfg.tloReference === null ? 'none' : 'inline-block'}` }, 'CLEAR'))),
    h('div', { class: 'prob-status prob-status-idle', id: 'probTlStatus' }, 'Ready'),
    h('div', { class: 'prob-result', id: 'probTlResult' }),
    h('div', { style: 'display:flex;gap:6px;' },
      h('button', { class: 'tb-btn', style: 'flex:1;padding:8px;font-size:11px', id: 'probTlPreview' }, '◈ PREVIEW'),
      h('button', { class: 'tb-btn success', style: 'flex:1;padding:10px;font-size:13px', id: 'probTlProbe' }, '⊕ PROBE'),
      h('button', { class: 'tb-btn danger', style: 'padding:10px;font-size:13px', id: 'probTlCancel', disabled: true }, '✕'))) as HTMLElement;
}

function buildEdgeFinderTab(): HTMLElement {
  const cfg = loadCfg('ef', {
    mode: 'external', probeFeedRate: 100, latchFeedRate: 25,
    probeDistance: 10, latchDistance: 1, xyClr: 5, depth: 3, offset: 5,
    probeDiameter: 2, probeZ: false, touchPlateHeight: 0, workpieceHeight: 0,
  });
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
  return h('div', { class: 'prob-subtab-panel', id: 'probpanel-edgefinder', style: 'display:none;flex-direction:column;gap:8px;padding:12px;overflow-y:auto;' },
    h('div', { class: 'prob-section' },
      h('div', { class: 'prob-section-label' }, 'Mode'),
      h('div', { style: 'display:flex;gap:6px;' },
        h('label', { class: 'prob-mode-btn' }, h('input', { type: 'radio', name: 'probEfMode', id: 'probEfModeExt', value: 'external', checked: cfg.mode === 'external' }), 'External'),
        h('label', { class: 'prob-mode-btn' }, h('input', { type: 'radio', name: 'probEfMode', id: 'probEfModeInt', value: 'internal', checked: cfg.mode === 'internal' }), 'Internal'))),
    h('div', { class: 'prob-section' },
      h('div', { class: 'prob-section-label' }, 'Select Edge / Corner'),
      h('div', { class: 'prob-edge-grid' },
        ...edgeButtons.map(e => h('button', { class: 'prob-edge-btn', id: `probEfEdge-${e.id}`, 'data-edge': e.id, title: e.title }, e.label))),
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
      h('div', { class: 'prob-row' }, h('span', { class: 'prob-label' }, 'Probe feed (mm/min)'), h('input', { type: 'number', class: 'prob-input', id: 'probEfProbeFeed', value: String(cfg.probeFeedRate), min: '1', step: '10' })),
      h('div', { class: 'prob-row' }, h('span', { class: 'prob-label' }, 'Latch feed (mm/min)'), h('input', { type: 'number', class: 'prob-input', id: 'probEfLatchFeed', value: String(cfg.latchFeedRate), min: '1', step: '5' })),
      h('div', { class: 'prob-row' }, h('span', { class: 'prob-label' }, 'Probe distance (mm)'), h('input', { type: 'number', class: 'prob-input', id: 'probEfProbeDist', value: String(cfg.probeDistance), min: '1', step: '1' })),
      h('div', { class: 'prob-row' }, h('span', { class: 'prob-label' }, 'Latch distance (mm)'), h('input', { type: 'number', class: 'prob-input', id: 'probEfLatchDist', value: String(cfg.latchDistance), min: '0.1', step: '0.1' })),
      h('div', { class: 'prob-row' }, h('span', { class: 'prob-label' }, 'XY clearance (mm)'), h('input', { type: 'number', class: 'prob-input', id: 'probEfXYClr', value: String(cfg.xyClr), min: '0.5', step: '0.5' })),
      h('div', { class: 'prob-row' }, h('span', { class: 'prob-label' }, 'Probe depth (mm)'), h('input', { type: 'number', class: 'prob-input', id: 'probEfDepth', value: String(cfg.depth), min: '0.5', step: '0.5' })),
      h('div', { class: 'prob-row' }, h('span', { class: 'prob-label' }, 'Corner offset (mm)'), h('input', { type: 'number', class: 'prob-input', id: 'probEfOffset', value: String(cfg.offset), min: '1', step: '1' })),
      h('div', { class: 'prob-row' }, h('span', { class: 'prob-label' }, 'Probe diameter (mm)'), h('input', { type: 'number', class: 'prob-input', id: 'probEfDiameter', value: String(cfg.probeDiameter), min: '0', step: '0.1' })),
      h('div', { class: 'prob-row' }, h('span', { class: 'prob-label' }, 'Also probe Z'),
        h('label', { class: 'prob-toggle' }, h('input', { type: 'checkbox', id: 'probEfProbeZ', checked: cfg.probeZ }), ' Yes'))),
    h('div', { class: 'prob-section', id: 'probEfZSection', style: cfg.probeZ ? '' : 'display:none' },
      h('div', { class: 'prob-section-label' }, 'Z Probe'),
      h('div', { class: 'prob-row' }, h('span', { class: 'prob-label' }, 'Touch plate height (mm)'), h('input', { type: 'number', class: 'prob-input', id: 'probEfPlateHeight', value: String(cfg.touchPlateHeight), min: '0', step: '0.1' })),
      h('div', { class: 'prob-row' }, h('span', { class: 'prob-label' }, 'Workpiece height (mm)'), h('input', { type: 'number', class: 'prob-input', id: 'probEfWpHeight', value: String(cfg.workpieceHeight), min: '0', step: '0.1' }))),
    h('div', { class: 'prob-section' },
      h(WcsSelector, { id: 'probEfWcs' }),
      h(CoordModeSelector, { id: 'probEfCoordMode' })),
    h('div', { class: 'prob-status prob-status-idle', id: 'probEfStatus' }, 'Select an edge or corner, then click PROBE'),
    h('div', { style: 'display:flex;gap:6px;' },
      h('button', { class: 'tb-btn', style: 'flex:1;padding:8px;font-size:11px', id: 'probEfPreview' }, '◈ PREVIEW'),
      h('button', { class: 'tb-btn success', style: 'flex:1;padding:10px;font-size:13px', id: 'probEfProbe' }, '⊕ PROBE'),
      h('button', { class: 'tb-btn danger', style: 'padding:10px;font-size:13px', id: 'probEfCancel', disabled: true }, '✕'))) as HTMLElement;
}

function buildCenterFinderTab(): HTMLElement {
  const cfg = loadCfg('cf', {
    centerMode: 'inside', axes: 'XY', probeFeedRate: 100, latchFeedRate: 25,
    probeDistance: 10, latchDistance: 1, xyClr: 5, depth: 3, probeDiameter: 2,
    workpieceSizeX: 50, workpieceSizeY: 50, passes: 1,
  });
  return h('div', { class: 'prob-subtab-panel', id: 'probpanel-centerfinder', style: 'display:none;flex-direction:column;gap:8px;padding:12px;overflow-y:auto;' },
    h('div', { class: 'prob-section' },
      h('div', { class: 'prob-section-label' }, 'Center Mode'),
      h('div', { style: 'display:flex;gap:6px;' },
        h('label', { class: 'prob-mode-btn' }, h('input', { type: 'radio', name: 'probCfMode', id: 'probCfModeInside', value: 'inside', checked: cfg.centerMode === 'inside' }), 'Inside (bore)'),
        h('label', { class: 'prob-mode-btn' }, h('input', { type: 'radio', name: 'probCfMode', id: 'probCfModeOutside', value: 'outside', checked: cfg.centerMode === 'outside' }), 'Outside (boss)'))),
    h('div', { class: 'prob-section' },
      h('div', { class: 'prob-section-label' }, 'Axes'),
      h('div', { style: 'display:flex;gap:6px;' },
        h('label', { class: 'prob-mode-btn' }, h('input', { type: 'radio', name: 'probCfAxes', id: 'probCfAxesXY', value: 'XY', checked: cfg.axes === 'XY' }), 'XY'),
        h('label', { class: 'prob-mode-btn' }, h('input', { type: 'radio', name: 'probCfAxes', id: 'probCfAxesX', value: 'X', checked: cfg.axes === 'X' }), 'X only'),
        h('label', { class: 'prob-mode-btn' }, h('input', { type: 'radio', name: 'probCfAxes', id: 'probCfAxesY', value: 'Y', checked: cfg.axes === 'Y' }), 'Y only'))),
    h('div', { class: 'prob-section' },
      h('div', { class: 'prob-section-label' }, 'Workpiece Size'),
      h('div', { class: 'prob-row' }, h('span', { class: 'prob-label' }, 'X size (mm)'), h('input', { type: 'number', class: 'prob-input', id: 'probCfSizeX', value: String(cfg.workpieceSizeX), min: '1', step: '1' })),
      h('div', { class: 'prob-row' }, h('span', { class: 'prob-label' }, 'Y size (mm)'), h('input', { type: 'number', class: 'prob-input', id: 'probCfSizeY', value: String(cfg.workpieceSizeY), min: '1', step: '1' }))),
    h('div', { class: 'prob-section' },
      h('div', { class: 'prob-section-label' }, 'Probe Settings'),
      h('div', { class: 'prob-row' }, h('span', { class: 'prob-label' }, 'Probe feed (mm/min)'), h('input', { type: 'number', class: 'prob-input', id: 'probCfProbeFeed', value: String(cfg.probeFeedRate), min: '1', step: '10' })),
      h('div', { class: 'prob-row' }, h('span', { class: 'prob-label' }, 'Latch feed (mm/min)'), h('input', { type: 'number', class: 'prob-input', id: 'probCfLatchFeed', value: String(cfg.latchFeedRate), min: '1', step: '5' })),
      h('div', { class: 'prob-row' }, h('span', { class: 'prob-label' }, 'Probe distance (mm)'), h('input', { type: 'number', class: 'prob-input', id: 'probCfProbeDist', value: String(cfg.probeDistance), min: '1', step: '1' })),
      h('div', { class: 'prob-row' }, h('span', { class: 'prob-label' }, 'Latch distance (mm)'), h('input', { type: 'number', class: 'prob-input', id: 'probCfLatchDist', value: String(cfg.latchDistance), min: '0.1', step: '0.1' })),
      h('div', { class: 'prob-row' }, h('span', { class: 'prob-label' }, 'XY clearance (mm)'), h('input', { type: 'number', class: 'prob-input', id: 'probCfXYClr', value: String(cfg.xyClr), min: '0.5', step: '0.5' })),
      h('div', { class: 'prob-row' }, h('span', { class: 'prob-label' }, 'Probe depth (mm)'), h('input', { type: 'number', class: 'prob-input', id: 'probCfDepth', value: String(cfg.depth), min: '0.5', step: '0.5' })),
      h('div', { class: 'prob-row' }, h('span', { class: 'prob-label' }, 'Probe diameter (mm)'), h('input', { type: 'number', class: 'prob-input', id: 'probCfDiameter', value: String(cfg.probeDiameter), min: '0', step: '0.1' })),
      h('div', { class: 'prob-row' }, h('span', { class: 'prob-label' }, 'Passes'), h('input', { type: 'number', class: 'prob-input', id: 'probCfPasses', value: String(cfg.passes), min: '1', max: '5', step: '1' }))),
    h('div', { class: 'prob-section' },
      h(WcsSelector, { id: 'probCfWcs' }),
      h(CoordModeSelector, { id: 'probCfCoordMode' })),
    h('div', { class: 'prob-status prob-status-idle', id: 'probCfStatus' }, 'Ready'),
    h('div', { style: 'display:flex;gap:6px;' },
      h('button', { class: 'tb-btn', style: 'flex:1;padding:8px;font-size:11px', id: 'probCfPreview' }, '◈ PREVIEW'),
      h('button', { class: 'tb-btn success', style: 'flex:1;padding:10px;font-size:13px', id: 'probCfProbe' }, '⊕ PROBE'),
      h('button', { class: 'tb-btn danger', style: 'padding:10px;font-size:13px', id: 'probCfCancel', disabled: true }, '✕'))) as HTMLElement;
}

function buildRotationTab(): HTMLElement {
  const cfg = loadCfg('rot', {
    edge: 'AB', probeFeedRate: 100, latchFeedRate: 25,
    probeDistance: 10, latchDistance: 1, xyClr: 5, depth: 3, offset: 50, probeDiameter: 2,
  });
  return h('div', { class: 'prob-subtab-panel', id: 'probpanel-rotation', style: 'display:none;flex-direction:column;gap:8px;padding:12px;overflow-y:auto;' },
    h('div', { class: 'prob-section' },
      h('div', { class: 'prob-section-label' }, 'Edge to Probe Along'),
      h('div', { style: 'display:flex;gap:6px;flex-wrap:wrap;' },
        ...['AB','AD','CB','CD'].map(e =>
          h('label', { class: 'prob-mode-btn', style: 'flex:0 0 auto' },
            h('input', { type: 'radio', name: 'probRotEdge', value: e, checked: cfg.edge === e }), e))),
      h('div', { style: 'font-family:var(--cond);font-size:10px;color:var(--text3);margin-top:4px;' }, 'AB=bottom edge · AD=left edge · CB=right edge · CD=top edge')),
    h('div', { class: 'prob-section' },
      h('div', { class: 'prob-section-label' }, 'Probe Settings'),
      h('div', { class: 'prob-row' }, h('span', { class: 'prob-label' }, 'Probe feed (mm/min)'), h('input', { type: 'number', class: 'prob-input', id: 'probRotProbeFeed', value: String(cfg.probeFeedRate), min: '1', step: '10' })),
      h('div', { class: 'prob-row' }, h('span', { class: 'prob-label' }, 'Latch feed (mm/min)'), h('input', { type: 'number', class: 'prob-input', id: 'probRotLatchFeed', value: String(cfg.latchFeedRate), min: '1', step: '5' })),
      h('div', { class: 'prob-row' }, h('span', { class: 'prob-label' }, 'Probe distance (mm)'), h('input', { type: 'number', class: 'prob-input', id: 'probRotProbeDist', value: String(cfg.probeDistance), min: '1', step: '1' })),
      h('div', { class: 'prob-row' }, h('span', { class: 'prob-label' }, 'Latch distance (mm)'), h('input', { type: 'number', class: 'prob-input', id: 'probRotLatchDist', value: String(cfg.latchDistance), min: '0.1', step: '0.1' })),
      h('div', { class: 'prob-row' }, h('span', { class: 'prob-label' }, 'XY clearance (mm)'), h('input', { type: 'number', class: 'prob-input', id: 'probRotXYClr', value: String(cfg.xyClr), min: '0.5', step: '0.5' })),
      h('div', { class: 'prob-row' }, h('span', { class: 'prob-label' }, 'Probe depth (mm)'), h('input', { type: 'number', class: 'prob-input', id: 'probRotDepth', value: String(cfg.depth), min: '0.5', step: '0.5' })),
      h('div', { class: 'prob-row' }, h('span', { class: 'prob-label' }, 'Point spacing (mm)'), h('input', { type: 'number', class: 'prob-input', id: 'probRotOffset', value: String(cfg.offset), min: '5', step: '5' })),
      h('div', { class: 'prob-row' }, h('span', { class: 'prob-label' }, 'Probe diameter (mm)'), h('input', { type: 'number', class: 'prob-input', id: 'probRotDiameter', value: String(cfg.probeDiameter), min: '0', step: '0.1' }))),
    h('div', { class: 'prob-status prob-status-idle', id: 'probRotStatus' }, 'Ready'),
    h('div', { class: 'prob-result', id: 'probRotResult' }),
    h('div', { style: 'display:flex;gap:6px;' },
      h('button', { class: 'tb-btn', style: 'flex:1;padding:8px;font-size:11px', id: 'probRotPreview' }, '◈ PREVIEW'),
      h('button', { class: 'tb-btn success', style: 'flex:1;padding:10px;font-size:13px', id: 'probRotProbe' }, '⊕ PROBE'),
      h('button', { class: 'tb-btn', style: 'flex:1;padding:10px;font-size:13px', id: 'probRotApply', disabled: true }, '↻ APPLY ROTATION'),
      h('button', { class: 'tb-btn danger', style: 'padding:10px;font-size:13px', id: 'probRotCancel', disabled: true }, '✕'))) as HTMLElement;
}

function wireTlEvents(container: HTMLElement): void {
  const statusId = 'probTlStatus';
  container.querySelector('#probTlModeTouch')?.addEventListener('change', () => {
    document.getElementById('probTlTouchSection')!.style.display = '';
    document.getElementById('probTlToolsetterSection')!.style.display = 'none';
  });
  container.querySelector('#probTlModeToolsetter')?.addEventListener('change', () => {
    document.getElementById('probTlTouchSection')!.style.display = 'none';
    document.getElementById('probTlToolsetterSection')!.style.display = '';
  });

  let tloRef: number | null = loadCfg('tl', { tloReference: null }).tloReference;
  const updateRefDisplay = () => {
    const el = document.getElementById('probTlRefDisplay');
    const clearBtn = document.getElementById('probTlClearRef');
    if (el) el.textContent = tloRef !== null ? `Ref: ${tloRef.toFixed(4)} mm` : 'No reference set';
    if (clearBtn) clearBtn.style.display = tloRef !== null ? '' : 'none';
  };

  container.querySelector('#probTlClearRef')?.addEventListener('click', () => {
    tloRef = null;
    saveCfg('tl', { ...loadCfg('tl', {}), tloReference: null });
    updateRefDisplay();
    sendCmd('G49');
    setStatus(statusId, 'Reference cleared', 'idle');
  });

  const probeBtn = container.querySelector('#probTlProbe') as HTMLButtonElement;
  const cancelBtn = container.querySelector('#probTlCancel') as HTMLButtonElement;

  const runProbe = async (asReference: boolean) => {
    if (!state.connected) { log('err', 'Not connected'); return; }
    const mode = (document.querySelector('input[name="probTlMode"]:checked') as HTMLInputElement)?.value || 'touchplate';
    const ts = (state as any).wcsOffsets['G59.3'];
    if (mode === 'toolsetter' && !ts) {
      setStatus(statusId, 'G59.3 not set — configure in Offsets tab', 'err');
      return;
    }
    const cfg = {
      mode,
      probeFeedRate: numVal('probTlProbeFeed'), latchFeedRate: numVal('probTlLatchFeed'),
      probeDistance: numVal('probTlProbeDist'), latchDistance: numVal('probTlLatchDist'),
      touchPlateHeight: numVal('probTlPlateHeight'), toolsetterDepth: numVal('probTlTsDepth'),
      tloReference: tloRef,
    };
    saveCfg('tl', { ...cfg, tloReference: tloRef });
    probeBtn.disabled = true; cancelBtn.disabled = false;
    setStatus(statusId, asReference ? 'Measuring reference…' : 'Probing…', 'running');
    const result = await runToolLengthProbe({
      mode: cfg.mode,
      probeFeedRate: cfg.probeFeedRate, latchFeedRate: cfg.latchFeedRate,
      probeDistance: cfg.probeDistance, latchDistance: cfg.latchDistance,
      touchPlateHeight: cfg.touchPlateHeight,
      toolsetterX: ts?.x, toolsetterY: ts?.y, toolsetterZ: ts?.z,
      toolsetterDepth: cfg.toolsetterDepth,
    });
    probeBtn.disabled = false; cancelBtn.disabled = true;
    if (!result || !result.success) { setStatus(statusId, 'Probe failed', 'err'); return; }
    if (asReference) {
      tloRef = result.z;
      saveCfg('tl', { ...cfg, tloReference: tloRef });
      updateRefDisplay();
      sendCmd('G49');
      setStatus(statusId, '✓ Reference set', 'ok');
    } else {
      let tlo = result.z;
      if (tloRef !== null) tlo -= tloRef + cfg.touchPlateHeight;
      else if (mode === 'touchplate') tlo -= cfg.touchPlateHeight;
      sendCmd(`G43.1Z${tlo.toFixed(4)}`);
      const resEl = document.getElementById('probTlResult');
      if (resEl) resEl.textContent = `Z=${result.z.toFixed(4)}  TLO=${tlo.toFixed(4)} mm`;
      setStatus(statusId, '✓ Complete — TLO applied', 'ok');
      setTimeout(() => import('../offsets').then(o => o.loadOffsets()), 300);
    }
  };

  container.querySelector('#probTlSetRef')?.addEventListener('click', () => runProbe(true));
  probeBtn.addEventListener('click', () => runProbe(false));
  cancelBtn.addEventListener('click', () => { cancelProbing(); setStatus(statusId, 'Cancelled', 'idle'); });
}

function wireEfEvents(container: HTMLElement): void {
  let selectedEdge: string | null = null;
  const statusId = 'probEfStatus';
  container.querySelectorAll('.prob-edge-btn').forEach((btn: any) => {
    btn.addEventListener('click', () => {
      container.querySelectorAll('.prob-edge-btn').forEach((b: any) => b.classList.remove('active'));
      btn.classList.add('active');
      selectedEdge = btn.dataset.edge;
      setStatus(statusId, `Edge: ${selectedEdge} selected`, 'idle');
    });
  });
  container.querySelector('#probEfProbeZ')?.addEventListener('change', function(this: HTMLInputElement) {
    const sec = document.getElementById('probEfZSection');
    if (sec) sec.style.display = this.checked ? '' : 'none';
  });
  const probeBtn = container.querySelector('#probEfProbe') as HTMLButtonElement;
  const cancelBtn = container.querySelector('#probEfCancel') as HTMLButtonElement;
  probeBtn.addEventListener('click', async () => {
    if (!state.connected) { log('err', 'Not connected'); return; }
    if (!selectedEdge) { setStatus(statusId, 'Select an edge or corner first', 'err'); return; }
    const mode = (document.querySelector('input[name="probEfMode"]:checked') as HTMLInputElement)?.value || 'external';
    const cfg = {
      mode, edge: selectedEdge,
      probeFeedRate: numVal('probEfProbeFeed'), latchFeedRate: numVal('probEfLatchFeed'),
      probeDistance: numVal('probEfProbeDist'), latchDistance: numVal('probEfLatchDist'),
      xyClr: numVal('probEfXYClr'), depth: numVal('probEfDepth'), offset: numVal('probEfOffset'),
      probeDiameter: numVal('probEfDiameter'),
      probeZ: (document.getElementById('probEfProbeZ') as HTMLInputElement)?.checked ?? false,
      touchPlateHeight: numVal('probEfPlateHeight'), workpieceHeight: numVal('probEfWpHeight'),
      coordMode: getCoordMode('probEfCoordMode'), wcs: getWcs('probEfWcs'),
    };
    saveCfg('ef', cfg);
    probeBtn.disabled = true; cancelBtn.disabled = false;
    setStatus(statusId, `Probing ${selectedEdge}…`, 'running');
    const ok = await runEdgeFinder(cfg);
    probeBtn.disabled = false; cancelBtn.disabled = true;
    setStatus(statusId, ok ? `✓ ${selectedEdge} complete` : '✗ Probe failed', ok ? 'ok' : 'err');
  });
  cancelBtn.addEventListener('click', () => { cancelProbing(); setStatus(statusId, 'Cancelled', 'idle'); });
}

function wireCfEvents(container: HTMLElement): void {
  const statusId = 'probCfStatus';
  const probeBtn = container.querySelector('#probCfProbe') as HTMLButtonElement;
  const cancelBtn = container.querySelector('#probCfCancel') as HTMLButtonElement;
  probeBtn.addEventListener('click', async () => {
    if (!state.connected) { log('err', 'Not connected'); return; }
    const centerMode = (document.querySelector('input[name="probCfMode"]:checked') as HTMLInputElement)?.value || 'inside';
    const axes = (document.querySelector('input[name="probCfAxes"]:checked') as HTMLInputElement)?.value || 'XY';
    const cfg = {
      centerMode, axes,
      probeFeedRate: numVal('probCfProbeFeed'), latchFeedRate: numVal('probCfLatchFeed'),
      probeDistance: numVal('probCfProbeDist'), latchDistance: numVal('probCfLatchDist'),
      xyClr: numVal('probCfXYClr'), depth: numVal('probCfDepth'),
      probeDiameter: numVal('probCfDiameter'),
      workpieceSizeX: numVal('probCfSizeX'), workpieceSizeY: numVal('probCfSizeY'),
      passes: numVal('probCfPasses') || 1,
      coordMode: getCoordMode('probCfCoordMode'), wcs: getWcs('probCfWcs'),
    };
    saveCfg('cf', cfg);
    probeBtn.disabled = true; cancelBtn.disabled = false;
    setStatus(statusId, 'Finding center…', 'running');
    const ok = await runCenterFinder(cfg);
    probeBtn.disabled = false; cancelBtn.disabled = true;
    setStatus(statusId, ok ? '✓ Center found' : '✗ Probe failed', ok ? 'ok' : 'err');
  });
  cancelBtn.addEventListener('click', () => { cancelProbing(); setStatus(statusId, 'Cancelled', 'idle'); });
}

function wireRotEvents(container: HTMLElement): void {
  const statusId = 'probRotStatus';
  const probeBtn = container.querySelector('#probRotProbe') as HTMLButtonElement;
  const applyBtn = container.querySelector('#probRotApply') as HTMLButtonElement;
  const cancelBtn = container.querySelector('#probRotCancel') as HTMLButtonElement;
  let lastAngle: number | null = null;

  probeBtn.addEventListener('click', async () => {
    if (!state.connected) { log('err', 'Not connected'); return; }
    const edge = (document.querySelector('input[name="probRotEdge"]:checked') as HTMLInputElement)?.value || 'AB';
    const cfg = {
      edge,
      probeFeedRate: numVal('probRotProbeFeed'), latchFeedRate: numVal('probRotLatchFeed'),
      probeDistance: numVal('probRotProbeDist'), latchDistance: numVal('probRotLatchDist'),
      xyClr: numVal('probRotXYClr'), depth: numVal('probRotDepth'),
      offset: numVal('probRotOffset'), probeDiameter: numVal('probRotDiameter'),
    };
    saveCfg('rot', cfg);
    probeBtn.disabled = true; cancelBtn.disabled = false; applyBtn.disabled = true;
    lastAngle = null;
    setStatus(statusId, 'Probing…', 'running');
    const result = await runRotation(cfg);
    probeBtn.disabled = false; cancelBtn.disabled = true;
    if (result) {
      lastAngle = result.angleDeg;
      const resEl = document.getElementById('probRotResult');
      if (resEl) resEl.textContent = `Angle: ${result.angleDeg.toFixed(3)}°`;
      applyBtn.disabled = !(state as any).gcodeLines?.length;
      setStatus(statusId, `✓ Measured: ${result.angleDeg.toFixed(3)}°`, 'ok');
    } else {
      setStatus(statusId, '✗ Probe failed', 'err');
    }
  });

  applyBtn.addEventListener('click', () => {
    if (lastAngle === null) return;
    applyRotationToGcode(lastAngle);
    setStatus(statusId, `✓ G-code rotated by ${lastAngle.toFixed(3)}°`, 'ok');
  });

  cancelBtn.addEventListener('click', () => { cancelProbing(); setStatus(statusId, 'Cancelled', 'idle'); });
}

function buildPreviewPanel(): HTMLElement {
  return h('div', { class: 'prob-preview-panel', id: 'probPreviewPanel' },
    h('div', { class: 'prob-preview-canvases' },
      h('canvas', { id: 'previewXY', class: 'prob-preview-canvas', width: '220', height: '160' }),
      h('canvas', { id: 'previewXZ', class: 'prob-preview-canvas', width: '220', height: '160' })),
    h('div', { class: 'prob-preview-controls' },
      h('div', { class: 'prob-preview-dro' },
        h('div', { class: 'prob-dro-cell' }, h('span', { class: 'prob-dro-axis' }, 'X'), h('span', { class: 'prob-dro-val', id: 'previewDroX' }, '—')),
        h('div', { class: 'prob-dro-cell' }, h('span', { class: 'prob-dro-axis' }, 'Y'), h('span', { class: 'prob-dro-val', id: 'previewDroY' }, '—')),
        h('div', { class: 'prob-dro-cell' }, h('span', { class: 'prob-dro-axis' }, 'Z'), h('span', { class: 'prob-dro-val', id: 'previewDroZ' }, '—'))),
      h('div', { class: 'prob-preview-label', id: 'previewDroLabel' }, 'Load a preview'),
      h('div', { class: 'prob-preview-btns' },
        h('button', { class: 'prob-prev-btn', id: 'previewStepBck', onClick: () => stepPreview(-1), disabled: true }, '◀'),
        h('button', { class: 'prob-prev-btn', id: 'previewPlayBtn', onClick: () => playPreview() }, '▶'),
        h('button', { class: 'prob-prev-btn', id: 'previewStepFwd', onClick: () => stepPreview(1), disabled: true }, '▶|'),
        h('span', { class: 'prob-prev-counter', id: 'previewCounter' }, '—')))) as HTMLElement;
}

export function initProbingTab(): void {
  const container = document.getElementById('tabpanel-probing');
  if (!container) return;
  const tlPanel = buildToolLengthTab();
  const efPanel = buildEdgeFinderTab();
  const cfPanel = buildCenterFinderTab();
  const rotPanel = buildRotationTab();
  const previewPanel = buildPreviewPanel();
  const panelWrap = container.querySelector('.prob-panels');
  if (panelWrap) {
    panelWrap.appendChild(tlPanel);
    panelWrap.appendChild(efPanel);
    panelWrap.appendChild(cfPanel);
    panelWrap.appendChild(rotPanel);
  }
  container.appendChild(previewPanel);
  initSubTabs(container);
  wireTlEvents(container);
  wireEfEvents(container);
  wireCfEvents(container);
  wireRotEvents(container);
  wirePreviewBtns(container);
}

function wirePreviewBtns(container: HTMLElement): void {
  const load = (wps: any[]) => (window as any).loadPreview3D?.(wps);

  container.querySelector('#probTlPreview')?.addEventListener('click', () => {
    const mode = (document.querySelector('input[name="probTlMode"]:checked') as HTMLInputElement)?.value || 'touchplate';
    if (mode === 'toolsetter') {
      const ts = (state as any).wcsOffsets['G59.3'] || { x: 50, y: 50, z: -20 };
      load(waypointsToolsetter({
        probeDistance: numVal('probTlProbeDist'), latchDistance: numVal('probTlLatchDist'),
        toolsetterDepth: numVal('probTlTsDepth'),
        tsOffX: ts.x - (state as any).machineX, tsOffY: ts.y - (state as any).machineY,
        tsOffZ: ts.z - (state as any).machineZ,
      }));
    } else {
      load(waypointsTouchplate({
        probeDistance: numVal('probTlProbeDist'), latchDistance: numVal('probTlLatchDist'),
        touchPlateHeight: numVal('probTlPlateHeight'),
      }));
    }
  });

  container.querySelector('#probEfPreview')?.addEventListener('click', () => {
    const edge = (container.querySelector('.prob-edge-btn.active') as HTMLElement)?.dataset.edge || 'AB';
    const mode = (document.querySelector('input[name="probEfMode"]:checked') as HTMLInputElement)?.value || 'external';
    const cfg = {
      edge, mode,
      xyClr: numVal('probEfXYClr'), depth: numVal('probEfDepth'), offset: numVal('probEfOffset'),
      probeDistance: numVal('probEfProbeDist'), latchDistance: numVal('probEfLatchDist'),
      probeDiameter: numVal('probEfDiameter'),
    };
    if (edge === 'Z') {
      load(waypointsTouchplate({ probeDistance: cfg.probeDistance, latchDistance: cfg.latchDistance, touchPlateHeight: 0 }));
    } else if (edge.length === 1) {
      load(waypointsEdgeCorner(cfg));
    } else {
      load(waypointsEdgeSingle(cfg));
    }
  });

  container.querySelector('#probCfPreview')?.addEventListener('click', () => {
    const centerMode = (document.querySelector('input[name="probCfMode"]:checked') as HTMLInputElement)?.value || 'inside';
    const axes = (document.querySelector('input[name="probCfAxes"]:checked') as HTMLInputElement)?.value || 'XY';
    load(waypointsCenter({
      centerMode, axes,
      sizeX: numVal('probCfSizeX'), sizeY: numVal('probCfSizeY'),
      xyClr: numVal('probCfXYClr'), depth: numVal('probCfDepth'),
      probeDistance: numVal('probCfProbeDist'), latchDistance: numVal('probCfLatchDist'),
      probeDiameter: numVal('probCfDiameter'),
    }));
  });

  container.querySelector('#probRotPreview')?.addEventListener('click', () => {
    const edge = (document.querySelector('input[name="probRotEdge"]:checked') as HTMLInputElement)?.value || 'AB';
    load(waypointsRotation({
      edge,
      xyClr: numVal('probRotXYClr'), depth: numVal('probRotDepth'),
      offset: numVal('probRotOffset'), probeDistance: numVal('probRotProbeDist'),
      latchDistance: numVal('probRotLatchDist'), probeDiameter: numVal('probRotDiameter'),
    }));
  });
}
