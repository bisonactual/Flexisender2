// ═══════════════════════════════════════════════
// THREE.JS 3D VIEWPORT
// ═══════════════════════════════════════════════

import { state, VP_STORAGE_KEY } from './state';
import { lsGet, lsSet } from './ui';
import { bearUpdateSpriteScales } from './bear';

declare const THREE: any;

// Scene objects
export let renderer: any;
export let scene: any;
export let camera: any;
let perspCamera: any;
let orthoCamera: any;
export let gridHelper: any = null;
export let _vpBoundary: any = null;
export let _vpOriginAxes: any[] = [];
export let toolGroup: any;
export let toolMesh: any;
export let ringMat: any;
export let rapidLines: any = null;
export let cutLines: any = null;
export let executedLine: any = null;

// Orbit state
let isOrbiting = false;
let isPanning = false;
let lastMouse = { x: 0, y: 0 };
export let spherical = { theta: -0.8, phi: 0.7, radius: 180 };
export let target: any;

let _lastTouches: Touch[] | null = null;
let _canvas: HTMLCanvasElement;

export function initViewport(): void {
  _canvas = document.getElementById('threeCanvas') as HTMLCanvasElement;
  renderer = new THREE.WebGLRenderer({ canvas: _canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.setClearColor(0x0f0f17, 1);

  scene = new THREE.Scene();

  perspCamera = new THREE.PerspectiveCamera(45, 1, 0.01, 10000);
  orthoCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.01, 10000);

  vpLoadExtents();

  camera = state.vpOrtho ? orthoCamera : perspCamera;
  camera.position.set(80, 60, 100);
  camera.lookAt(0, 0, 0);

  scene.add(new THREE.AmbientLight(0x223355, 2.5));
  const dlight = new THREE.DirectionalLight(0xffffff, 0.5);
  dlight.position.set(1, 2, 1);
  scene.add(dlight);

  target = new THREE.Vector3(0, 0, 0);

  // Toolhead marker
  const toolGeo = new THREE.CylinderGeometry(0, 1.5, 4, 8);
  const toolMat = new THREE.MeshPhongMaterial({ color: 0xff8c42, emissive: 0x2a1000 });
  toolMesh = new THREE.Mesh(toolGeo, toolMat);
  toolMesh.rotation.x = Math.PI;
  toolMesh.position.y = 2;
  toolGroup = new THREE.Group();
  toolGroup.add(toolMesh);

  const bodyGeo = new THREE.CylinderGeometry(1, 1, 6, 8);
  const bodyMat = new THREE.MeshPhongMaterial({ color: 0x778899 });
  const bodyMesh = new THREE.Mesh(bodyGeo, bodyMat);
  bodyMesh.position.y = 7;
  toolGroup.add(bodyMesh);
  toolGroup.position.set(0, 0, 0);
  scene.add(toolGroup);

  const ringGeo = new THREE.RingGeometry(1.5, 2.5, 16);
  ringMat = new THREE.MeshBasicMaterial({ color: 0xffd740, side: THREE.DoubleSide, transparent: true, opacity: 0.4 });
  const ringMesh = new THREE.Mesh(ringGeo, ringMat);
  ringMesh.rotation.x = -Math.PI / 2;
  toolGroup.add(ringMesh);

  updateCamera();
  rebuildViewportGrid();
  setupOrbitControls(_canvas);
  setupTouchControls(_canvas);

  function resizeRenderer() {
    const wrap = _canvas.parentElement!;
    const w = wrap.clientWidth, h = wrap.clientHeight;
    renderer.setSize(w, h);
    perspCamera.aspect = w / h;
    perspCamera.updateProjectionMatrix();
    syncOrthoFrustum();
  }
  new ResizeObserver(resizeRenderer).observe(_canvas.parentElement!);
  resizeRenderer();

  animate();
}

function animate(): void {
  requestAnimationFrame(animate);
  const t = Date.now() * 0.002;
  if (ringMat) ringMat.opacity = 0.2 + 0.2 * Math.sin(t);
  bearUpdateSpriteScales(spherical.radius);
  renderer.render(scene, camera);
}

export function updateCamera(): void {
  const sp = Math.sin(spherical.phi), cp = Math.cos(spherical.phi);
  const st = Math.sin(spherical.theta), ct = Math.cos(spherical.theta);
  const x = target.x + spherical.radius * sp * st;
  const y = target.y + spherical.radius * cp;
  const z = target.z + spherical.radius * sp * ct;
  if (state.vpOrtho) {
    orthoCamera.position.set(x, y, z);
    orthoCamera.up.set(0, 1, 0);
    orthoCamera.lookAt(target);
    syncOrthoFrustum();
  } else {
    perspCamera.position.set(x, y, z);
    perspCamera.lookAt(target);
  }
}

function syncOrthoFrustum(): void {
  const size = renderer.getSize(new THREE.Vector2());
  const aspect = (size.x || 1) / (size.y || 1);
  const halfH = spherical.radius * 0.5;
  const halfW = halfH * aspect;
  orthoCamera.left = -halfW;
  orthoCamera.right = halfW;
  orthoCamera.top = halfH;
  orthoCamera.bottom = -halfH;
  orthoCamera.updateProjectionMatrix();
}

export function setProjection(ortho: boolean): void {
  state.vpOrtho = ortho;
  camera = ortho ? orthoCamera : perspCamera;
  updateCamera();
  vpSaveExtents();
}

// ── Unproject screen point to world ray, intersect with target-plane ──────────
function screenToWorld(clientX: number, clientY: number): any {
  const rect = _canvas.getBoundingClientRect();
  const ndcX = ((clientX - rect.left) / rect.width) * 2 - 1;
  const ndcY = -((clientY - rect.top) / rect.height) * 2 + 1;

  const viewDir = new THREE.Vector3();
  camera.getWorldDirection(viewDir);

  let origin: any, dir: any;
  if (state.vpOrtho) {
    // Ortho: unproject near plane to get ray origin; direction is camera forward
    origin = new THREE.Vector3(ndcX, ndcY, -1).unproject(camera);
    dir = viewDir.clone();
  } else {
    // Perspective: ray from camera position through unprojected point
    const far = new THREE.Vector3(ndcX, ndcY, 0.5).unproject(camera);
    origin = camera.position.clone();
    dir = far.sub(origin).normalize();
  }

  // Intersect with the plane through `target` perpendicular to the camera view direction
  const denom = dir.dot(viewDir);
  if (Math.abs(denom) < 1e-8) return target.clone();
  const t = target.clone().sub(origin).dot(viewDir) / denom;
  return origin.add(dir.multiplyScalar(t));
}

function setupOrbitControls(canvas: HTMLCanvasElement): void {
  canvas.addEventListener('mousedown', e => {
    if (e.button === 0) isOrbiting = true;
    if (e.button === 2) isPanning = true;
    lastMouse = { x: e.clientX, y: e.clientY };
  });
  canvas.addEventListener('contextmenu', e => e.preventDefault());
  window.addEventListener('mouseup', () => { isOrbiting = false; isPanning = false; });
  window.addEventListener('mousemove', e => {
    if (!isOrbiting && !isPanning) return;
    const dx = e.clientX - lastMouse.x;
    const dy = e.clientY - lastMouse.y;
    lastMouse = { x: e.clientX, y: e.clientY };
    if (isOrbiting) {
      spherical.theta -= dx * 0.007;
      spherical.phi = Math.max(0.05, Math.min(Math.PI - 0.05, spherical.phi - dy * 0.007));
      updateCamera();
    }
    if (isPanning) {
      // Pan: compute world point under cursor before and after, shift target by the delta
      const before = screenToWorld(e.clientX - dx, e.clientY - dy);
      const after = screenToWorld(e.clientX, e.clientY);
      target.add(before.sub(after));
      updateCamera();
    }
  });
  canvas.addEventListener('wheel', e => {
    e.preventDefault();
    // World point under cursor before zoom
    const worldBefore = screenToWorld(e.clientX, e.clientY);

    const factor = 1 + e.deltaY * 0.001;
    spherical.radius = Math.max(1, Math.min(2000, spherical.radius * factor));
    updateCamera();

    // World point under cursor after zoom
    const worldAfter = screenToWorld(e.clientX, e.clientY);

    // Shift target so the point stays under the cursor
    target.add(worldBefore.clone().sub(worldAfter));
    updateCamera();
  }, { passive: false });
}

function setupTouchControls(canvas: HTMLCanvasElement): void {
  function touchMidpoint(t0: Touch, t1: Touch) {
    return { x: (t0.clientX + t1.clientX) / 2, y: (t0.clientY + t1.clientY) / 2 };
  }
  function touchDist(t0: Touch, t1: Touch) {
    const dx = t0.clientX - t1.clientX, dy = t0.clientY - t1.clientY;
    return Math.sqrt(dx * dx + dy * dy);
  }

  canvas.addEventListener('touchstart', e => {
    e.preventDefault();
    _lastTouches = Array.from(e.touches);
  }, { passive: false });

  canvas.addEventListener('touchmove', e => {
    e.preventDefault();
    const touches = Array.from(e.touches);
    if (!_lastTouches || _lastTouches.length === 0) { _lastTouches = touches; return; }

    if (touches.length === 1 && _lastTouches.length === 1) {
      const dx = touches[0].clientX - _lastTouches[0].clientX;
      const dy = touches[0].clientY - _lastTouches[0].clientY;
      spherical.theta -= dx * 0.007;
      spherical.phi = Math.max(0.05, Math.min(Math.PI - 0.05, spherical.phi - dy * 0.007));
      updateCamera();
    } else if (touches.length === 2 && _lastTouches.length === 2) {
      // Pan: keep midpoint world position stable
      const midNow = touchMidpoint(touches[0], touches[1]);
      const midPrev = touchMidpoint(_lastTouches[0], _lastTouches[1]);
      const before = screenToWorld(midPrev.x, midPrev.y);
      const after = screenToWorld(midNow.x, midNow.y);
      target.add(before.sub(after));

      // Pinch zoom: keep midpoint stable
      const distNow = touchDist(touches[0], touches[1]);
      const distPrev = touchDist(_lastTouches[0], _lastTouches[1]);
      if (distPrev > 0) {
        const worldBefore = screenToWorld(midNow.x, midNow.y);
        spherical.radius = Math.max(1, Math.min(2000, spherical.radius * (distPrev / distNow)));
        updateCamera();
        const worldAfter = screenToWorld(midNow.x, midNow.y);
        target.add(worldBefore.clone().sub(worldAfter));
      }
      updateCamera();
    }
    _lastTouches = touches;
  }, { passive: false });

  canvas.addEventListener('touchend', e => {
    _lastTouches = Array.from(e.touches);
  }, { passive: false });
}

// ── Viewport extents ──────────────────────────────────────────────────────────
export function vpLoadExtents(): void {
  const d = lsGet<any>(VP_STORAGE_KEY, null);
  if (d) {
    state.vpXMin = d.xMin ?? -300; state.vpXMax = d.xMax ?? 0;
    state.vpYMin = d.yMin ?? -300; state.vpYMax = d.yMax ?? 0;
    if (d.ortho !== undefined) state.vpOrtho = !!d.ortho;
  }
}

export function vpSaveExtents(): void {
  lsSet(VP_STORAGE_KEY, { xMin: state.vpXMin, xMax: state.vpXMax, yMin: state.vpYMin, yMax: state.vpYMax, ortho: state.vpOrtho });
}

export function rebuildViewportGrid(): void {
  if (gridHelper) { scene.remove(gridHelper); gridHelper.geometry.dispose(); gridHelper.material.dispose(); gridHelper = null; }
  if (_vpBoundary) { scene.remove(_vpBoundary); _vpBoundary.geometry.dispose(); _vpBoundary.material.dispose(); _vpBoundary = null; }
  _vpOriginAxes.forEach(l => { scene.remove(l); l.geometry.dispose(); l.material.dispose(); });
  _vpOriginAxes = [];

  const threeXMin = state.vpXMin, threeXMax = state.vpXMax;
  const threeZMin = -state.vpYMax, threeZMax = -state.vpYMin;
  const sizeX = Math.abs(threeXMax - threeXMin) || 200;
  const sizeZ = Math.abs(threeZMax - threeZMin) || 200;
  const cx = (threeXMin + threeXMax) / 2;
  const cz = (threeZMin + threeZMax) / 2;

  const gridSize = Math.max(sizeX, sizeZ);
  const divisions = Math.min(40, Math.max(10, Math.round(gridSize / 20)));
  gridHelper = new THREE.GridHelper(gridSize, divisions, 0x2a2720, 0x1a1814);
  gridHelper.position.set(cx, 0, cz);
  scene.add(gridHelper);

  const pts = [
    new THREE.Vector3(threeXMin, 0.1, threeZMin),
    new THREE.Vector3(threeXMax, 0.1, threeZMin),
    new THREE.Vector3(threeXMax, 0.1, threeZMax),
    new THREE.Vector3(threeXMin, 0.1, threeZMax),
    new THREE.Vector3(threeXMin, 0.1, threeZMin),
  ];
  const bdGeo = new THREE.BufferGeometry().setFromPoints(pts);
  _vpBoundary = new THREE.Line(bdGeo, new THREE.LineBasicMaterial({ color: 0x443e2e }));
  scene.add(_vpBoundary);

  const axLen = Math.min(sizeX, sizeZ) * 0.05;
  const makeVpAxis = (v: any, color: number) => {
    const g = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0.2, 0), v.clone().multiplyScalar(axLen).add(new THREE.Vector3(0, 0.2, 0))]);
    const l = new THREE.Line(g, new THREE.LineBasicMaterial({ color }));
    scene.add(l);
    _vpOriginAxes.push(l);
  };
  makeVpAxis(new THREE.Vector3(1, 0, 0), 0xff3333);
  makeVpAxis(new THREE.Vector3(-1, 0, 0), 0x992222);
  makeVpAxis(new THREE.Vector3(0, 0, -1), 0x33ff66);
  makeVpAxis(new THREE.Vector3(0, 0, 1), 0x226633);
  makeVpAxis(new THREE.Vector3(0, 1, 0), 0x3399ff);

  target.set(cx, 0, cz);
  spherical.radius = Math.max(sizeX, sizeZ) * 1.4;
  updateCamera();
}

// ── View presets ──────────────────────────────────────────────────────────────
export function setView(v: string): void {
  document.querySelectorAll('.view-btn').forEach(b => b.classList.remove('active'));
  // The caller is an onclick so event.target won't work from module scope — handled in main
  if (v === 'iso') { spherical.theta = -0.8; spherical.phi = 0.7; }
  else if (v === 'top') { spherical.theta = 0; spherical.phi = 0.01; }
  else if (v === 'front') { spherical.theta = 0; spherical.phi = Math.PI / 2; }
  else if (v === 'side') { spherical.theta = Math.PI / 2; spherical.phi = Math.PI / 2; }
  updateCamera();
}

export function fitView(): void {
  if (state.toolpathSegments.length === 0) return;
  const box = new THREE.Box3();
  state.toolpathSegments.forEach((s: any) => { box.expandByPoint(s.from); box.expandByPoint(s.to); });
  const center = new THREE.Vector3(); box.getCenter(center);
  const size = new THREE.Vector3(); box.getSize(size);
  target.copy(center);
  spherical.radius = Math.max(size.length() * 1.5, 10);
  updateCamera();
}

export function toggleToolhead(): void {
  state.showToolhead = !state.showToolhead;
  toolGroup.visible = state.showToolhead;
  document.getElementById('btnToolhead')!.textContent = state.showToolhead ? 'TOOL ●' : 'TOOL ○';
}

// ── Toolpath mesh ─────────────────────────────────────────────────────────────
export function buildToolpathMesh(segments: any[]): void {
  if (rapidLines) { scene.remove(rapidLines); rapidLines.geometry.dispose(); }
  if (cutLines) { scene.remove(cutLines); cutLines.geometry.dispose(); }
  if (executedLine) { scene.remove(executedLine); executedLine.geometry.dispose(); }

  const rapidPts: any[] = [], cutPts: any[] = [];
  segments.forEach(s => {
    if (s.isRapid) { rapidPts.push(s.from, s.to); }
    else { cutPts.push(s.from, s.to); }
  });

  if (rapidPts.length > 0) {
    const g = new THREE.BufferGeometry().setFromPoints(rapidPts);
    rapidLines = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: 0xff4444, transparent: true, opacity: 0.5 }));
    scene.add(rapidLines);
  }
  if (cutPts.length > 0) {
    const g = new THREE.BufferGeometry().setFromPoints(cutPts);
    cutLines = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: 0x00d4ff, transparent: true, opacity: 0.85 }));
    scene.add(cutLines);
  }
}

export function updateExecutedPath(segIdx: number): void {
  if (executedLine) { scene.remove(executedLine); executedLine.geometry.dispose(); executedLine = null; }
  if (segIdx <= 0 || state.toolpathSegments.length === 0) return;

  const pts: any[] = [];
  const count = Math.min(segIdx, state.toolpathSegments.length);
  for (let i = 0; i < count; i++) {
    pts.push(state.toolpathSegments[i].from, state.toolpathSegments[i].to);
  }
  if (pts.length < 2) return;
  const g = new THREE.BufferGeometry().setFromPoints(pts);
  executedLine = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: 0x00ff88, linewidth: 2 }));
  scene.add(executedLine);
}

export function vpApply(): void {
  const xMin = parseFloat((document.getElementById('vpXMin') as HTMLInputElement).value);
  const xMax = parseFloat((document.getElementById('vpXMax') as HTMLInputElement).value);
  const yMin = parseFloat((document.getElementById('vpYMin') as HTMLInputElement).value);
  const yMax = parseFloat((document.getElementById('vpYMax') as HTMLInputElement).value);
  if (isNaN(xMin) || isNaN(xMax) || isNaN(yMin) || isNaN(yMax)) return;
  if (xMin >= xMax || yMin >= yMax) return;
  state.vpXMin = xMin; state.vpXMax = xMax; state.vpYMin = yMin; state.vpYMax = yMax;
  vpSaveExtents();
  rebuildViewportGrid();
}
