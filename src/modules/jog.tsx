// ═══════════════════════════════════════════════
// Jog engine — click, hold, keyboard
// ═══════════════════════════════════════════════

import { h } from '../jsx';
import { state, KB_JOG_MAP, KEYBOARD_JOG_DIST } from '../state';
import { isInputFocused } from '../ui';
import { sendCmd, rtSend, setJogging } from '../connection';
import { goToXY0 } from '../streaming';
import { scene, toolGroup } from '../viewport';
import { on as busOn, type StatusReport } from '../bus';

declare const THREE: any;

// ── Element refs (set during mount) ───────────────────────────────────────────
let _feedSlider: HTMLInputElement;
let _feedVal: HTMLElement;
let _clickLabel: HTMLElement;
let _holdLabel: HTMLElement;
let _xyStepContainer: HTMLElement;
let _zStepContainer: HTMLElement;

// ── Jog preview in 3D ────────────────────────────────────────────────────────
let _hoverGhost: any = null;       // ghost shown on hover (next potential click)
let _previewLines: any[] = [];     // dashed line segments
let _previewAnimId: number = 0;
let _hoverTarget: any = null;      // THREE.Vector3 — hover ghost position
let _hoverColor: number = 0;

interface Waypoint { pos: any; ghost: any; color: number; }
let _waypoints: Waypoint[] = [];

// Predicted position in Three.js coords (accounts for queued click-mode jogs)
let _predicted = { x: 0, y: 0, z: 0 };
let _predictedDirty = false;

const WAYPOINT_ARRIVE_DIST = 1.0;

function makeGhost(color: number, opacity: number): any {
  const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false });
  const ghost = new THREE.Group();
  const cone = new THREE.Mesh(new THREE.CylinderGeometry(0, 1.5, 4, 8), mat);
  cone.rotation.x = Math.PI;
  cone.position.y = 2;
  ghost.add(cone);
  const body = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 6, 8), mat);
  body.position.y = 7;
  ghost.add(body);
  return ghost;
}

function removeGhost(ghost: any): void {
  if (!ghost) return;
  scene.remove(ghost);
  ghost.traverse?.((c: any) => { c.geometry?.dispose(); c.material?.dispose(); });
}

export function jogSyncPredicted(): void {
  // Always keep predicted in sync when idle
  if (!_predictedDirty) {
    _predicted.x = toolGroup.position.x;
    _predicted.y = toolGroup.position.y;
    _predicted.z = toolGroup.position.z;
  }

  // Remove waypoints the head has reached or passed
  while (_waypoints.length > 0) {
    const wp = _waypoints[0];
    const dx = toolGroup.position.x - wp.pos.x;
    const dy = toolGroup.position.y - wp.pos.y;
    const dz = toolGroup.position.z - wp.pos.z;
    if (Math.sqrt(dx * dx + dy * dy + dz * dz) < WAYPOINT_ARRIVE_DIST) {
      removeGhost(wp.ghost);
      _waypoints.shift();
    } else {
      break;
    }
  }
}

function jogCheckIdle(machineState: string): void {
  if (!_predictedDirty) return;
  const sl = machineState.toLowerCase().split(':')[0];
  if (sl === 'idle' || sl === 'alarm') {
    for (const wp of _waypoints) removeGhost(wp.ghost);
    _waypoints.length = 0;
    _predicted.x = toolGroup.position.x;
    _predicted.y = toolGroup.position.y;
    _predicted.z = toolGroup.position.z;
    _predictedDirty = false;
  }
}

function addWaypoint(pos: any, color: number): void {
  const ghost = makeGhost(color, 0.2);
  ghost.position.copy(pos);
  scene.add(ghost);
  _waypoints.push({ pos: pos.clone(), ghost, color });
}

function clearHoverPreview(): void {
  if (_previewAnimId) { cancelAnimationFrame(_previewAnimId); _previewAnimId = 0; }
  _hoverTarget = null;
  removeGhost(_hoverGhost);
  _hoverGhost = null;
  clearPreviewLines();
}

function clearPreviewLines(): void {
  for (const l of _previewLines) { scene.remove(l); l.geometry?.dispose(); l.material?.dispose(); }
  _previewLines = [];
}

function jogDirColor(v: { x: number; y: number; z: number }): number {
  return v.z !== 0 ? 0x3399ff : v.x !== 0 && v.y !== 0 ? 0xffaa00 : v.x !== 0 ? 0xff3333 : 0x33ff66;
}

function jogDirToVec(dir: string): { x: number; y: number; z: number } {
  let x = 0, y = 0, z = 0;
  if (dir.includes('X+')) x = 1; if (dir.includes('X-')) x = -1;
  if (dir.includes('Y+')) y = 1; if (dir.includes('Y-')) y = -1;
  if (dir.includes('Z+')) z = 1; if (dir.includes('Z-')) z = -1;
  return { x, y, z };
}

function showJogPreview(dir: string): void {
  clearHoverPreview();
  const v = jogDirToVec(dir);
  const color = jogDirColor(v);
  _hoverColor = color;

  if (state.jogHoldMode) {
    const pos = toolGroup.position;
    const len = 30;
    const arrowDir = new THREE.Vector3(v.x, v.z, -v.y).normalize();
    const arrow = new THREE.ArrowHelper(arrowDir, pos.clone(), len, color, len * 0.3, len * 0.15);
    scene.add(arrow);
    _hoverGhost = arrow;
  } else {
    const stepX = v.x * (v.z !== 0 ? 0 : state.jogStepXY);
    const stepY = v.y * (v.z !== 0 ? 0 : state.jogStepXY);
    const stepZ = v.z * state.jogStepZ;
    const tx = _predicted.x + stepX;
    const ty = _predicted.y + stepZ;
    const tz = _predicted.z - stepY;

    _hoverTarget = new THREE.Vector3(tx, ty, tz);

    _hoverGhost = makeGhost(color, 0.35);
    _hoverGhost.position.copy(_hoverTarget);
    scene.add(_hoverGhost);

    updateAllPreviewLines();
    startPreviewAnim();
  }
}

function updateAllPreviewLines(): void {
  clearPreviewLines();

  // Build chain: head → waypoint[0] → waypoint[1] → ... → hoverTarget
  const points: any[] = [toolGroup.position.clone()];
  for (const wp of _waypoints) points.push(wp.pos.clone());
  if (_hoverTarget) points.push(_hoverTarget.clone());

  if (points.length < 2) return;

  for (let i = 0; i < points.length - 1; i++) {
    const isHoverSeg = _hoverTarget && i === points.length - 2;
    const color = isHoverSeg ? _hoverColor : (_waypoints[i - 1]?.color ?? _hoverColor);
    const opacity = isHoverSeg ? 0.6 : 0.8;
    const geo = new THREE.BufferGeometry().setFromPoints([points[i], points[i + 1]]);
    const line = new THREE.Line(geo, new THREE.LineDashedMaterial({ color, dashSize: 3, gapSize: 2, transparent: true, opacity }));
    line.computeLineDistances();
    scene.add(line);
    _previewLines.push(line);
  }
}

function startPreviewAnim(): void {
  if (_previewAnimId) return;
  const tick = () => {
    if (!_hoverTarget && _waypoints.length === 0) { _previewAnimId = 0; return; }
    updateAllPreviewLines();
    _previewAnimId = requestAnimationFrame(tick);
  };
  _previewAnimId = requestAnimationFrame(tick);
}

// ── Step sizes ────────────────────────────────────────────────────────────────

export function setStepXY(v: number): void {
  state.jogStepXY = v;
  _xyStepContainer?.querySelectorAll('.xy-step-btn').forEach(b => b.classList.toggle('active', parseFloat(b.textContent!) === v));
}

export function setStepZ(v: number): void {
  state.jogStepZ = v;
  _zStepContainer?.querySelectorAll('.z-step-btn').forEach(b => b.classList.toggle('active', parseFloat(b.textContent!) === v));
}

export function rebuildSteps(xySteps: number[], zSteps: number[]): void {
  if (_xyStepContainer) buildStepBtns(_xyStepContainer, xySteps, 'xy-step-btn', 10, setStepXY);
  if (_zStepContainer) buildStepBtns(_zStepContainer, zSteps, 'z-step-btn', 1, setStepZ);
}

function buildStepBtns(container: HTMLElement, steps: number[], cls: string, defaultStep: number, setter: (v: number) => void): void {
  container.innerHTML = '';
  for (const v of steps) {
    const btn = <button class={'step-btn ' + cls + (v === defaultStep ? ' active' : '')} onClick={() => setter(v)}>{v}</button>;
    container.appendChild(btn);
  }
}

// ── Jog commands ──────────────────────────────────────────────────────────────

function jogFeedValue(): string { return _feedSlider?.value || '1000'; }

export function startJog(dir: string): void {
  if (!state.connected) return;
  const f = jogFeedValue();
  const step = state.jogStepXY;
  const v = jogDirToVec(dir);
  const color = jogDirColor(v);

  // Sync predicted to actual if stale
  if (!_predictedDirty) {
    _predicted.x = toolGroup.position.x;
    _predicted.y = toolGroup.position.y;
    _predicted.z = toolGroup.position.z;
  }

  // Convert current hover ghost into a committed waypoint
  if (_hoverGhost && _hoverTarget && !state.jogHoldMode) {
    _hoverGhost.traverse?.((c: any) => {
      if (c.material) { c.material.opacity = 0.2; c.material.needsUpdate = true; }
    });
    _waypoints.push({ pos: _hoverTarget.clone(), ghost: _hoverGhost, color: _hoverColor });
    _hoverGhost = null;
    _hoverTarget = null;
  }

  const diagMatch = dir.match(/^(X[+-])(Y[+-])$/);
  if (diagMatch) {
    const xSign = diagMatch[1][1] === '+' ? '' : '-';
    const ySign = diagMatch[2][1] === '+' ? '' : '-';
    if (!state.jogHoldMode) {
      _predicted.x += (xSign === '-' ? -step : step);
      _predicted.z += (ySign === '-' ? step : -step);
      _predictedDirty = true;
      if (!_hoverTarget) {
        addWaypoint(new THREE.Vector3(_predicted.x, _predicted.y, _predicted.z), color);
        startPreviewAnim();
      }
    }
    setJogging(true);
    sendCmd('$J=G91 X' + xSign + step + ' Y' + ySign + step + ' F' + f);
    return;
  }

  const axis = dir[0], sign = dir[1] === '+' ? '' : '-';
  const axisStep = axis === 'Z' ? state.jogStepZ : state.jogStepXY;
  if (!state.jogHoldMode) {
    const delta = sign === '-' ? -axisStep : axisStep;
    if (axis === 'X') _predicted.x += delta;
    else if (axis === 'Y') _predicted.z -= delta;
    else if (axis === 'Z') _predicted.y += delta;
    _predictedDirty = true;
    if (!_hoverTarget) {
      addWaypoint(new THREE.Vector3(_predicted.x, _predicted.y, _predicted.z), color);
      startPreviewAnim();
    }
  }
  setJogging(true);
  sendCmd('$J=G91 ' + axis + sign + axisStep + ' F' + f);
}

export function clearWaypoints(): void {
  for (const wp of _waypoints) removeGhost(wp.ghost);
  _waypoints.length = 0;
  clearHoverPreview();
  _predictedDirty = false;
}

export function stopJog(): void {
  rtSend('\x85');
  setJogging(false);
  // Flush pending jog commands from sentQueue — \x85 cancels them all
  for (let i = state.sentQueue.length - 1; i >= 0; i--) {
    if (state.sentQueue[i].line.startsWith('$J=')) {
      state.rxInFlight = Math.max(0, state.rxInFlight - state.sentQueue[i].bytes);
      state.sentQueue.splice(i, 1);
    }
  }
  clearWaypoints();
}

// ── Hold mode ─────────────────────────────────────────────────────────────────

export function setJogHoldMode(on: boolean): void {
  state.jogHoldMode = on;
  if (_clickLabel) _clickLabel.style.color = on ? 'var(--text3)' : 'var(--accent)';
  if (_holdLabel) _holdLabel.style.color = on ? 'var(--accent)' : 'var(--text3)';
  if (!on && state._jogHoldActive) { state._jogHoldActive = false; stopJog(); }
}

function _jogBtnUp(e: Event): void {
  if (!state.jogHoldMode || !state._jogHoldActive) return;
  e.preventDefault();
  state._jogHoldActive = false;
  stopJog();
}

// ── Wire a single jog direction button ────────────────────────────────────────

function wireJogBtn(btn: HTMLElement, dir: string): void {
  const v = jogDirToVec(dir);
  if (v.z !== 0) { btn.style.color = '#5588ff'; btn.style.background = 'rgba(55,88,255,0.15)'; }
  else if (v.x !== 0 && v.y === 0) { btn.style.color = '#ff5555'; }
  else if (v.y !== 0 && v.x === 0) { btn.style.color = '#55ff77'; }
  else if (v.x !== 0 && v.y !== 0) { btn.style.color = '#ffaa44'; }

  btn.addEventListener('mouseenter', () => showJogPreview(dir));
  btn.addEventListener('mouseleave', () => clearHoverPreview());

  btn.addEventListener('click', () => { if (!state.jogHoldMode) startJog(dir); });

  btn.addEventListener('mousedown', e => { if (!state.jogHoldMode || state._jogHoldActive) return; e.preventDefault(); state._jogHoldActive = true; startJog(dir); });
  btn.addEventListener('mouseup', e => _jogBtnUp(e));
  btn.addEventListener('mouseleave', e => _jogBtnUp(e));

  btn.addEventListener('touchstart', e => { if (!state.jogHoldMode || state._jogHoldActive) return; e.preventDefault(); state._jogHoldActive = true; startJog(dir); }, { passive: false });
  btn.addEventListener('touchend', e => { if (state.jogHoldMode) { e.preventDefault(); _jogBtnUp(e); } }, { passive: false });
  btn.addEventListener('touchcancel', e => { if (state.jogHoldMode) { e.preventDefault(); _jogBtnUp(e); } }, { passive: false });
}

// ── Jog button JSX helper ─────────────────────────────────────────────────────

function JogBtn({ dir, class: cls, style, children }: { dir: string; class?: string; style?: string; children?: any }): HTMLElement {
  const btn = <button class={'jog-btn ' + (cls || '')} style={style || ''} dataset={{ dir }}>{children}</button> as HTMLElement;
  wireJogBtn(btn, dir);
  return btn;
}

// ── Mount ─────────────────────────────────────────────────────────────────────

export function mount(parent: HTMLElement): void {
  const card = (
    <div class="module-card mod-hidden" id="mod-jogging" dataset={{ modSize: 'normal' }} style="top:10px;left:302px">
      <div class="module-drag-handle">
        <span class="module-drag-dots">⠿⠿</span>
        <span class="module-drag-title">Jogging</span>
        <div class="jog-mode-toggle">
          <span class="jog-mode-label" style="color:var(--accent)" ref={(el: HTMLElement) => { _clickLabel = el; }}>CLICK</span>
          <label class="jog-mode-switch-wrap" title="Toggle: Click (step) vs Hold (stop on release)">
            <input type="checkbox" onChange={(e: Event) => setJogHoldMode((e.target as HTMLInputElement).checked)} />
            <span class="jog-mode-slider"></span>
          </label>
          <span class="jog-mode-label" ref={(el: HTMLElement) => { _holdLabel = el; }}>HOLD</span>
        </div>
        <button class="module-drag-close" onClick={() => { card.classList.add('mod-hidden'); }}>✕</button>
      </div>
      <div class="module-body">
        <div class="jog-section" style="border:none;padding:4px 0;background:transparent">
          <div class="jog-row">
            <div class="jog-grid">
              <JogBtn dir="X-Y+" class="diag">↖</JogBtn>
              <JogBtn dir="Y+">↑</JogBtn>
              <JogBtn dir="X+Y+" class="diag">↗</JogBtn>
              <JogBtn dir="X-">←</JogBtn>
              <button class="jog-btn danger" style="font-size:11px;font-family:var(--cond);letter-spacing:1px" onClick={() => stopJog()}>■ STOP</button>
              <JogBtn dir="X+">→</JogBtn>
              <JogBtn dir="X-Y-" class="diag">↙</JogBtn>
              <JogBtn dir="Y-">↓</JogBtn>
              <JogBtn dir="X+Y-" class="diag">↘</JogBtn>
            </div>
            <div class="jog-z-col">
              <JogBtn dir="Z+" class="z-up" style="width:48px;height:48px">Z↑</JogBtn>
              <JogBtn dir="Z-" class="z-down" style="width:48px;height:48px">Z↓</JogBtn>
              <button class="jog-btn" style="width:48px;height:48px;font-size:10px;font-family:var(--cond);letter-spacing:0.5px" onClick={() => goToXY0()}>XY0</button>
            </div>
          </div>
        </div>
        <div class="feed-row" style="margin-top:2px">
          <span class="feed-label">JOG F</span>
          <input type="range" class="feed-slider" min="100" max="3000" value="1000"
            ref={(el: HTMLInputElement) => { _feedSlider = el; }}
            onInput={() => { _feedVal.textContent = _feedSlider.value; }} />
          <span class="feed-val" ref={(el: HTMLElement) => { _feedVal = el; }}>1000</span>
        </div>
        <div class="jog-step-axis-row">
          <span class="jog-step-axis-label">XY</span>
          <div class="jog-step-axis-btns" ref={(el: HTMLElement) => { _xyStepContainer = el; }}>
            {[0.01, 0.1, 1, 10, 50].map(v =>
              <button class={'step-btn xy-step-btn' + (v === 10 ? ' active' : '')} onClick={() => setStepXY(v)}>{v}</button>
            )}
          </div>
        </div>
        <div class="jog-step-axis-row">
          <span class="jog-step-axis-label">Z</span>
          <div class="jog-step-axis-btns" ref={(el: HTMLElement) => { _zStepContainer = el; }}>
            {[0.01, 0.1, 1, 5, 10].map(v =>
              <button class={'step-btn z-step-btn' + (v === 1 ? ' active' : '')} onClick={() => setStepZ(v)}>{v}</button>
            )}
          </div>
        </div>
      </div>
    </div>
  ) as HTMLElement;

  parent.appendChild(card);

  busOn('status', ['mpos'], () => jogSyncPredicted());
  busOn<StatusReport>('status', ['state'], (r) => jogCheckIdle(r.machineState));
}

// ── Keyboard jog ──────────────────────────────────────────────────────────────

export function initKeyboardJog(): void {
  document.addEventListener('keydown', e => {
    if (!state.connected || state.running) return;
    if (isInputFocused()) return;
    const dir = KB_JOG_MAP[e.key];
    if (!dir) return;
    e.preventDefault();
    if (state.kbJogActive && state.kbJogKey === e.key) return;
    if (state.kbJogActive) cancelKbJog();

    state.kbJogActive = true;
    state.kbJogKey = e.key;
    setJogging(true);

    const f = jogFeedValue();
    const axis = dir[0], sign = dir[1] === '+' ? '' : '-';
    highlightJogBtn(dir, true);
    sendCmd('$J=G91 ' + axis + sign + KEYBOARD_JOG_DIST + ' F' + f);
  });

  document.addEventListener('keyup', e => {
    if (!state.kbJogActive) return;
    const dir = KB_JOG_MAP[e.key];
    if (!dir || e.key !== state.kbJogKey) return;
    e.preventDefault();
    cancelKbJog();
  });
}

function cancelKbJog(): void {
  if (!state.kbJogActive) return;
  highlightJogBtn(KB_JOG_MAP[state.kbJogKey!], false);
  state.kbJogActive = false;
  state.kbJogKey = null;
  stopJog();
}

function highlightJogBtn(dir: string, on: boolean): void {
  const textMap: Record<string, string> = { 'X-': '←', 'X+': '→', 'Y-': '↓', 'Y+': '↑', 'Z-': 'Z↓', 'Z+': 'Z↑' };
  const txt = textMap[dir];
  if (!txt) return;
  document.querySelectorAll<HTMLElement>('.jog-btn').forEach(btn => {
    if (btn.textContent!.trim() === txt) {
      btn.style.background = on ? 'var(--accent2)' : '';
      btn.style.color = on ? '#000' : '';
    }
  });
}
