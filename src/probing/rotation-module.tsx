// ═══════════════════════════════════════════════
// Rotation module UI
// ═══════════════════════════════════════════════

import { h } from '../jsx';
import { state } from '../state';
import { log } from '../console';
import { lsGet, lsSet } from '../ui';
import { runRotation, applyRotationToGcode } from './rotation';
import { cancelProbing } from './probe-program';
import { waypointsRotation } from './preview';

const CFG_KEY = 'fs-probing-tab-rot';

function loadCfg(): any {
  return {
    edge: 'AB',
    probeFeedRate: 100, latchFeedRate: 25,
    probeDistance: 10, latchDistance: 1,
    xyClr: 5, depth: 3, offset: 50, probeDiameter: 2,
    ...lsGet(CFG_KEY, {}),
  };
}

function saveCfg(cfg: any): void { lsSet(CFG_KEY, cfg); }

function numVal(id: string): number {
  return parseFloat((document.getElementById(id) as HTMLInputElement)?.value || '0') || 0;
}

function setStatus(id: string, msg: string, type = 'idle'): void {
  const el = document.getElementById(id);
  if (el) { el.textContent = msg; el.className = `prob-status prob-status-${type}`; }
}

export function mount(parent: HTMLElement): void {
  const cfg = loadCfg();
  let lastAngle: number | null = null;
  const card = h('div', { class: 'module-card mod-hidden', id: 'mod-rotation', dataset: { modSize: 'normal' }, style: 'top:10px;left:302px' },
    h('div', { class: 'module-drag-handle' },
      h('span', { class: 'module-drag-dots' }, '⠿⠿'),
      h('span', { class: 'module-drag-title' }, 'Rotation'),
      h('button', { class: 'module-drag-close', onClick: () => card.classList.add('mod-hidden') }, '✕')),
    h('div', { class: 'module-body', style: 'gap:8px;overflow-y:auto;max-height:80vh' },
      h('div', { class: 'prob-section' },
        h('div', { class: 'prob-section-label' }, 'Edge to Probe Along'),
        h('div', { style: 'display:flex;gap:6px;flex-wrap:wrap;' },
          ...['AB', 'AD', 'CB', 'CD'].map(e =>
            h('label', { class: 'prob-mode-btn', style: 'flex:0 0 auto' },
              h('input', { type: 'radio', name: 'modRotEdge', value: e, checked: cfg.edge === e }), e))),
        h('div', { style: 'font-family:var(--cond);font-size:10px;color:var(--text3);margin-top:4px;' }, 'AB=bottom · AD=left · CB=right · CD=top')),
      h('div', { class: 'prob-section' },
        h('div', { class: 'prob-section-label' }, 'Probe Settings'),
        h('div', { class: 'prob-row' }, h('span', { class: 'prob-label' }, 'Probe feed (mm/min)'), h('input', { type: 'number', class: 'prob-input', id: 'modRotProbeFeed', value: String(cfg.probeFeedRate), min: '1', step: '10' })),
        h('div', { class: 'prob-row' }, h('span', { class: 'prob-label' }, 'Latch feed (mm/min)'), h('input', { type: 'number', class: 'prob-input', id: 'modRotLatchFeed', value: String(cfg.latchFeedRate), min: '1', step: '5' })),
        h('div', { class: 'prob-row' }, h('span', { class: 'prob-label' }, 'Probe distance (mm)'), h('input', { type: 'number', class: 'prob-input', id: 'modRotProbeDist', value: String(cfg.probeDistance), min: '1', step: '1' })),
        h('div', { class: 'prob-row' }, h('span', { class: 'prob-label' }, 'Latch distance (mm)'), h('input', { type: 'number', class: 'prob-input', id: 'modRotLatchDist', value: String(cfg.latchDistance), min: '0.1', step: '0.1' })),
        h('div', { class: 'prob-row' }, h('span', { class: 'prob-label' }, 'XY clearance (mm)'), h('input', { type: 'number', class: 'prob-input', id: 'modRotXYClr', value: String(cfg.xyClr), min: '0.5', step: '0.5' })),
        h('div', { class: 'prob-row' }, h('span', { class: 'prob-label' }, 'Probe depth (mm)'), h('input', { type: 'number', class: 'prob-input', id: 'modRotDepth', value: String(cfg.depth), min: '0.5', step: '0.5' })),
        h('div', { class: 'prob-row' }, h('span', { class: 'prob-label' }, 'Point spacing (mm)'), h('input', { type: 'number', class: 'prob-input', id: 'modRotOffset', value: String(cfg.offset), min: '5', step: '5' })),
        h('div', { class: 'prob-row' }, h('span', { class: 'prob-label' }, 'Probe diameter (mm)'), h('input', { type: 'number', class: 'prob-input', id: 'modRotDiameter', value: String(cfg.probeDiameter), min: '0', step: '0.1' }))),
      h('div', { class: 'prob-status prob-status-idle', id: 'modRotStatus' }, 'Ready'),
      h('div', { class: 'prob-result', id: 'modRotResult' }),
      h('div', { style: 'display:flex;gap:6px;' },
        h('button', { class: 'tb-btn', style: 'padding:8px;font-size:11px', id: 'modRotPreview' }, '◈ PREVIEW'),
        h('button', { class: 'tb-btn success', style: 'flex:1;padding:10px;font-size:13px', id: 'modRotProbe' }, '⊕ PROBE'),
        h('button', { class: 'tb-btn', style: 'flex:1;padding:10px;font-size:11px', id: 'modRotApply', disabled: true }, '↻ APPLY'),
        h('button', { class: 'tb-btn danger', style: 'padding:10px;font-size:13px', id: 'modRotCancel', disabled: true }, '✕'))));

  parent.appendChild(card);

  const probeBtn = card.querySelector('#modRotProbe') as HTMLButtonElement;
  const applyBtn = card.querySelector('#modRotApply') as HTMLButtonElement;
  const cancelBtn = card.querySelector('#modRotCancel') as HTMLButtonElement;
  const resultEl = card.querySelector('#modRotResult') as HTMLElement;

  card.querySelector('#modRotPreview')?.addEventListener('click', () => {
    const edge = (card.querySelector('input[name="modRotEdge"]:checked') as HTMLInputElement)?.value || 'AB';
    const wps = waypointsRotation({
      edge, xyClr: numVal('modRotXYClr'), depth: numVal('modRotDepth'),
      offset: numVal('modRotOffset'), probeDistance: numVal('modRotProbeDist'),
      latchDistance: numVal('modRotLatchDist'), probeDiameter: numVal('modRotDiameter'),
    });
    (window as any).loadPreview3D?.(wps);
  });

  probeBtn.addEventListener('click', async () => {
    if (!state.connected) { log('err', 'Not connected'); return; }
    const edge = (card.querySelector('input[name="modRotEdge"]:checked') as HTMLInputElement)?.value || 'AB';
    const cfg2 = {
      edge,
      probeFeedRate: numVal('modRotProbeFeed'), latchFeedRate: numVal('modRotLatchFeed'),
      probeDistance: numVal('modRotProbeDist'), latchDistance: numVal('modRotLatchDist'),
      xyClr: numVal('modRotXYClr'), depth: numVal('modRotDepth'),
      offset: numVal('modRotOffset'), probeDiameter: numVal('modRotDiameter'),
    };
    saveCfg(cfg2);
    probeBtn.disabled = true; cancelBtn.disabled = false; applyBtn.disabled = true;
    lastAngle = null;
    setStatus('modRotStatus', 'Probing…', 'running');
    const result = await runRotation(cfg2);
    probeBtn.disabled = false; cancelBtn.disabled = true;
    if (result) {
      lastAngle = result.angleDeg;
      resultEl.textContent = `Angle: ${result.angleDeg.toFixed(3)}°`;
      applyBtn.disabled = !(state as any).gcodeLines?.length;
      setStatus('modRotStatus', `✓ Measured: ${result.angleDeg.toFixed(3)}°`, 'ok');
    } else {
      setStatus('modRotStatus', '✗ Probe failed', 'err');
    }
  });

  applyBtn.addEventListener('click', () => {
    if (lastAngle === null) return;
    applyRotationToGcode(lastAngle);
    setStatus('modRotStatus', `✓ G-code rotated by ${lastAngle.toFixed(3)}°`, 'ok');
  });

  cancelBtn.addEventListener('click', () => {
    cancelProbing();
    setStatus('modRotStatus', 'Cancelled');
    probeBtn.disabled = false; cancelBtn.disabled = true;
  });
}
