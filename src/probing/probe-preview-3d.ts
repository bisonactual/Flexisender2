// ═══════════════════════════════════════════════
// 3D preview in viewport
// ═══════════════════════════════════════════════

import { state } from '../state';
import { scene, cutLines, rapidLines, executedLine } from '../viewport';
import type { Waypoint } from './preview';

declare const THREE: any;

let _waypoints: Waypoint[] = [];
let _step = 0;
let _playing = false;
let _playTimer: ReturnType<typeof setInterval> | null = null;
let _autoTimer: ReturnType<typeof setTimeout> | null = null;
let _pathGroup: any = null;
let _probeGhost: any = null;

const STEP_INTERVAL = 400;

const SEG_COLOR: Record<string, number> = {
  rapid: 0x3B82F6,    // blue
  probe: 0xF97316,    // orange
  retract: 0x6366F1,  // indigo
  contact: 0x22C55E,  // green
  start: 0x94A3B8,    // slate
};

function toThree(mx: number, my: number, mz: number): any {
  return new THREE.Vector3(mx, mz, -my);
}

function buildPathLines(wps: Waypoint[], upTo: number): void {
  if (_pathGroup) {
    scene.remove(_pathGroup);
    _pathGroup.traverse((c: any) => { c.geometry?.dispose(); c.material?.dispose(); });
  }
  _pathGroup = new THREE.Group();
  const ox = (state as any).machineX;
  const oy = (state as any).machineY;
  const oz = (state as any).machineZ;

  for (let i = 1; i < wps.length; i++) {
    const a = wps[i - 1], b = wps[i];
    const pa = toThree(ox + a.x, oy + a.y, oz + a.z);
    const pb = toThree(ox + b.x, oy + b.y, oz + b.z);
    const geo = new THREE.BufferGeometry().setFromPoints([pa, pb]);
    const isPast = i <= upTo;
    const color = SEG_COLOR[b.type] ?? 0x888888;
    const mat = new THREE.LineDashedMaterial({
      color,
      dashSize: b.type === 'probe' ? 0 : 3,
      gapSize: b.type === 'probe' ? 0 : 2,
      transparent: true,
      opacity: isPast ? 0.85 : 0.2,
    });
    const line = new THREE.Line(geo, mat);
    line.computeLineDistances();
    _pathGroup.add(line);
  }

  for (let i = 0; i <= upTo && i < wps.length; i++) {
    const wp = wps[i];
    if (wp.type !== 'contact') continue;
    const pos = toThree(ox + wp.x, oy + wp.y, oz + wp.z);
    const geo = new THREE.SphereGeometry(1.2, 8, 8);
    const mat = new THREE.MeshBasicMaterial({ color: 0x22C55E, transparent: true, opacity: 0.9 });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.copy(pos);
    _pathGroup.add(mesh);
  }

  scene.add(_pathGroup);
}

function updateGhost(wp: Waypoint): void {
  if (!_probeGhost) {
    const mat = new THREE.MeshBasicMaterial({ color: 0xF97316, transparent: true, opacity: 0.5, depthWrite: false });
    _probeGhost = new THREE.Group();
    const cone = new THREE.Mesh(new THREE.CylinderGeometry(0, 1.5, 4, 8), mat);
    cone.rotation.x = Math.PI;
    cone.position.y = 2;
    _probeGhost.add(cone);
    const body = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 6, 8), mat);
    body.position.y = 7;
    _probeGhost.add(body);
    scene.add(_probeGhost);
  }
  const ox = (state as any).machineX, oy = (state as any).machineY, oz = (state as any).machineZ;
  _probeGhost.position.copy(toThree(ox + wp.x, oy + wp.y, oz + wp.z));
}

function dimToolpath(dim: boolean): void {
  [cutLines, rapidLines, executedLine].forEach((obj: any) => {
    if (!obj) return;
    if (dim) {
      obj.material.opacity = 0.12;
      obj.material.transparent = true;
    } else {
      if (obj === cutLines) { obj.material.opacity = 0.85; obj.material.transparent = true; }
      if (obj === rapidLines) { obj.material.opacity = 0.5; obj.material.transparent = true; }
      if (obj === executedLine) { obj.material.opacity = 1; obj.material.transparent = false; }
    }
    obj.material.needsUpdate = true;
  });
}

export function loadPreview3D(wps: Waypoint[]): void {
  clearPreview3D();
  if (!wps.length) return;
  _waypoints = wps;
  _step = 0;
  dimToolpath(true);
  buildPathLines(_waypoints, _step);
  updateGhost(_waypoints[0]);
  showOverlay(true);
  updateOverlayDRO();
  updateOverlayControls();
  playPreview3D();
}

export function clearPreview3D(): void {
  stopPlay();
  if (_autoTimer) { clearTimeout(_autoTimer); _autoTimer = null; }
  if (_pathGroup) {
    scene.remove(_pathGroup);
    _pathGroup.traverse((c: any) => { c.geometry?.dispose(); c.material?.dispose(); });
    _pathGroup = null;
  }
  if (_probeGhost) {
    scene.remove(_probeGhost);
    _probeGhost.traverse((c: any) => { c.geometry?.dispose(); c.material?.dispose(); });
    _probeGhost = null;
  }
  dimToolpath(false);
  _waypoints = [];
  _step = 0;
  showOverlay(false);
}

export function stepPreview3D(dir: number): void {
  if (!_waypoints.length) return;
  _step = Math.max(0, Math.min(_waypoints.length - 1, _step + dir));
  buildPathLines(_waypoints, _step);
  updateGhost(_waypoints[_step]);
  updateOverlayDRO();
  updateOverlayControls();
}

export function playPreview3D(): void {
  if (!_waypoints.length) return;
  if (_playing) { stopPlay(); return; }
  if (_step >= _waypoints.length - 1) _step = 0;
  _playing = true;
  updateOverlayControls();
  _playTimer = setInterval(() => {
    _step++;
    buildPathLines(_waypoints, _step);
    updateGhost(_waypoints[_step]);
    updateOverlayDRO();
    if (_step >= _waypoints.length - 1) {
      stopPlay();
    } else {
      updateOverlayControls();
    }
  }, STEP_INTERVAL);
}

function stopPlay(): void {
  if (_playTimer) { clearInterval(_playTimer); _playTimer = null; }
  _playing = false;
  updateOverlayControls();
}

function showOverlay(visible: boolean): void {
  const overlay = document.getElementById('probePreviewOverlay');
  if (overlay) overlay.style.display = visible ? 'flex' : 'none';
}

function updateOverlayDRO(): void {
  const wp = _waypoints[_step];
  if (!wp) return;
  const ox = (state as any).machineX, oy = (state as any).machineY, oz = (state as any).machineZ;
  const el = (id: string) => document.getElementById(id);
  const droX = el('ppDroX'), droY = el('ppDroY'), droZ = el('ppDroZ'), droL = el('ppDroLabel');
  if (droX) droX.textContent = (ox + wp.x).toFixed(3);
  if (droY) droY.textContent = (oy + wp.y).toFixed(3);
  if (droZ) droZ.textContent = (oz + wp.z).toFixed(3);
  if (droL) droL.textContent = wp.label || typeLabel(wp.type);
}

function updateOverlayControls(): void {
  const bck = document.getElementById('ppStepBck') as HTMLButtonElement | null;
  const fwd = document.getElementById('ppStepFwd') as HTMLButtonElement | null;
  const play = document.getElementById('ppPlay');
  const ctr = document.getElementById('ppCounter');
  if (bck) bck.disabled = _step <= 0;
  if (fwd) fwd.disabled = _step >= _waypoints.length - 1;
  if (play) play.textContent = _playing ? '⏸' : '▶';
  if (ctr) ctr.textContent = _waypoints.length ? `${_step + 1} / ${_waypoints.length}` : '—';
}

function typeLabel(type: string): string {
  switch (type) {
    case 'start': return 'Start position';
    case 'rapid': return 'Rapid move';
    case 'probe': return 'Probing…';
    case 'retract': return 'Retract';
    case 'contact': return '⊕ Contact';
    default: return '';
  }
}
