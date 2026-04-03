// ═══════════════════════════════════════════════
// Main entry point — wires modules, exposes globals
// ═══════════════════════════════════════════════

import { state } from './state';
import { lsGet, lsSet, $ } from './ui';
import { log, clearConsole, sendManual, handleConInput, conAutoUpdate } from './console';
import { toggleConnect, sendCmd } from './connection';
import { initViewport, setView, fitView, toggleToolhead, vpApply, setProjection } from './viewport';
import { loadFile, uploadAndOpenFile, frameProgram } from './gcode';
import { startJob, pauseJob, stopJob, updateRunButtons, sendReset, unlockAlarm, sendHome, goToXY0, setWCS } from './streaming';
import { mount as mountJog, initKeyboardJog } from './modules/jog';
import { mount as mountPosition } from './modules/position';
import { mount as mountOverrides } from './modules/overrides';
import { mount as mountSpindle } from './modules/spindle';
import { mount as mountMacros } from './modules/macros';
import { mount as mountSignals } from './modules/signals';
import { loadSettings, filterSettings, writeAllDirty } from './settings';
import { loadToolTable } from './tooltable';
import { toggleSdPanel, closeSdPanel, sdRefreshFiles, sdRunSelected, initSdClickOutside } from './sd';
import { initCameraTab, selectCamera, startCamera, stopCamera, measureOffset, goToCamera, goToSpindle, zeroAtCrosshair, camMouseDown, camMouseMove, camMouseUp, setCrosshairStyle, setCrosshairColor, loadCamSettings, saveCamSettings, drawOverlay, initCameraListeners } from './camera';
import { kbdPress, kbdBackspace, kbdClear, kbdSend, toggleTouchKeyboard } from './keyboard';
import { toggleModule, setModSize, setConsoleLines, modInitPositions, toggleModLock, modDragStart, modTouchStart, initModDragListeners } from './modules';
import { initDock, dockModule, undockModule } from './dock';
import { optSetConnMode, optSaveConnSettings, optLoadConnSettings, optLoadColors, optLoadTabLocks, optBuildTabLockList, initToolbarOptions, saveTbOpt, optApplyColor, optHexChange, optResetColor, optResetAllColors, optSaveJogSteps, optLoadJogSteps, optApplyJogSteps, optSaveBearColors, optLoadBearColors } from './options';
import { bearRefresh, bearCheckPlugin, bearIntercept, bearParseStatus, bearShowAddForm, bearEditZone, bearSaveZone, bearDeleteZone, bearCancelEdit } from './bear';

// ── Tab switching ─────────────────────────────────────────────────────────────
export function switchTab(tab: string): void {
  if (tab !== 'options' && state._lockedTabs.has(tab)) return;
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
  document.getElementById('tab-' + tab)!.classList.add('active');
  document.getElementById('tabpanel-' + tab)!.classList.add('active');
  if (tab === 'settings' && !state.settingsLoaded && state.connected) loadSettings();
  if (tab === 'camera' && !state._camTabInited) { state._camTabInited = true; initCameraTab(); }
  if (tab === 'tooltable') loadToolTable();
}

// ── Expose to window for HTML onclick handlers ────────────────────────────────
const w = window as any;

// Connection
// (wired in initChunk1Events)

// Job
// (wired in initChunk1Events)

// File
// (wired in initChunk1Events)

// Viewport
// (wired in initChunk1Events)
w.vpApply = vpApply;
w.setProjection = setProjection;

// Jog
// (wired in initChunk2Events)

// Overrides
// (wired in initChunk2Events)

// Remaining window globals — only for dynamically generated HTML onclick handlers
w.sendCmd = sendCmd;  // used by settings-widgets.ts generated HTML
w.bearShowAddForm = bearShowAddForm;
w.bearEditZone = bearEditZone;
w.bearSaveZone = bearSaveZone;
w.bearDeleteZone = bearDeleteZone;
w.bearCancelEdit = bearCancelEdit;

// ── Shared event helper ───────────────────────────────────────────────────────
function on(id: string, evt: string, fn: (e: any) => void): void {
  const el = document.getElementById(id);
  if (el) el.addEventListener(evt, fn);
}

// ── Event wiring (chunk 3: settings, camera, options) ─────────────────────────
function initChunk3Events(): void {

  // Settings tab
  on('btnLoadSettings', 'click', () => loadSettings());
  on('btnWriteAll', 'click', () => writeAllDirty());
  on('settingsSearch', 'input', () => filterSettings((document.getElementById('settingsSearch') as HTMLInputElement).value));

  // Camera tab
  on('camSelect', 'change', () => selectCamera((document.getElementById('camSelect') as HTMLSelectElement).value));
  on('camStartBtn', 'click', () => startCamera());
  on('camStopBtn', 'click', () => stopCamera());
  on('camZoom', 'input', () => { const v = parseFloat((document.getElementById('camZoom') as HTMLInputElement).value); state.camZoomVal = v; document.getElementById('camZoomDisp')!.textContent = v.toFixed(1) + 'x'; drawOverlay(); });
  on('camCrossSize', 'input', () => { state.camCrossSizeVal = parseInt((document.getElementById('camCrossSize') as HTMLInputElement).value); drawOverlay(); });
  document.querySelectorAll<HTMLElement>('.ccs-btn[data-style]').forEach(btn => {
    btn.addEventListener('click', () => setCrosshairStyle(btn.dataset.style!));
  });
  document.querySelectorAll<HTMLElement>('.ccs-btn[data-color]').forEach(btn => {
    btn.addEventListener('click', () => setCrosshairColor(btn.dataset.color!));
  });
  on('camOffX', 'change', () => { state.camOffsetX = parseFloat((document.getElementById('camOffX') as HTMLInputElement).value) || 0; });
  on('camOffY', 'change', () => { state.camOffsetY = parseFloat((document.getElementById('camOffY') as HTMLInputElement).value) || 0; });
  on('camMeasureBtn', 'click', () => measureOffset());
  on('camGoCameraBtn', 'click', () => goToCamera());
  on('camGoSpindleBtn', 'click', () => goToSpindle());
  on('camZeroHereBtn', 'click', () => zeroAtCrosshair());
  const camDrag = document.getElementById('camDragLayer');
  if (camDrag) {
    camDrag.addEventListener('mousedown', e => camMouseDown(e));
    camDrag.addEventListener('mousemove', e => camMouseMove(e));
    camDrag.addEventListener('mouseup', e => camMouseUp(e));
    camDrag.addEventListener('contextmenu', e => e.preventDefault());
  }

  // Options — connection
  on('connBtnWs', 'click', () => optSetConnMode('websocket'));
  on('connBtnSerial', 'click', () => optSetConnMode('serial'));
  ['optBaudRate', 'optDataBits', 'optStopBits', 'optParity'].forEach(id => on(id, 'change', () => optSaveConnSettings()));
  on('optAutoLoadSettings', 'change', () => { lsSet('fs-opt-autoload-settings', (document.getElementById('optAutoLoadSettings') as HTMLInputElement).checked); });

  // Options — viewport extents
  ['vpXMin', 'vpXMax', 'vpYMin', 'vpYMax'].forEach(id => on(id, 'input', () => vpApply()));

  // Options — projection
  on('projBtnPersp', 'click', () => { setProjection(false); document.getElementById('projBtnPersp')!.classList.add('selected'); document.getElementById('projBtnOrtho')!.classList.remove('selected'); });
  on('projBtnOrtho', 'click', () => { setProjection(true); document.getElementById('projBtnOrtho')!.classList.add('selected'); document.getElementById('projBtnPersp')!.classList.remove('selected'); });

  // Options — colour theme
  const colorKeys = ['text', 'text2', 'bg', 'surface', 'accent'];
  const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
  colorKeys.forEach(k => {
    on('optColor' + cap(k), 'input', () => optApplyColor(k, (document.getElementById('optColor' + cap(k)) as HTMLInputElement).value));
    on('optHex' + cap(k), 'input', () => optHexChange(k, (document.getElementById('optHex' + cap(k)) as HTMLInputElement).value));
    // Swatch click → open picker
    const swatch = document.getElementById('optSwatch' + cap(k));
    if (swatch) swatch.addEventListener('click', () => (document.getElementById('optColor' + cap(k)) as HTMLInputElement).click());
    // Reset button — find by sibling
    const row = swatch?.closest('.opt-color-row');
    const resetBtn = row?.querySelector('.opt-reset-btn');
    if (resetBtn) resetBtn.addEventListener('click', () => optResetColor(k));
  });
  on('btnResetAllColors', 'click', () => optResetAllColors());

  // Options — toolbar visibility
  document.querySelectorAll<HTMLLabelElement>('.tb-opt-toggle').forEach(label => {
    const cb = label.querySelector('input[type=checkbox]') as HTMLInputElement;
    if (cb) cb.addEventListener('change', () => saveTbOpt(cb));
  });

  // Options — bear colours
  ['optBearColorAll', 'optBearColorGcode', 'optBearColorJog', 'optBearColorTool', 'optBearColorSafe'].forEach(id => {
    on(id, 'input', () => optSaveBearColors());
    // Swatch click
    const picker = document.getElementById(id);
    const swatch = picker?.nextElementSibling as HTMLElement | null;
    if (swatch) swatch.addEventListener('click', () => (document.getElementById(id) as HTMLInputElement).click());
  });
  on('optBearScale', 'input', () => { optSaveBearColors(); document.getElementById('optBearScaleVal')!.textContent = parseFloat((document.getElementById('optBearScale') as HTMLInputElement).value).toFixed(3); });

  // Options — jog steps
  on('optJogStepsXY', 'input', () => optSaveJogSteps());
  on('optJogStepsZ', 'input', () => optSaveJogSteps());
  on('btnApplyJogSteps', 'click', () => optApplyJogSteps());
}

// ── Event wiring (chunk 2: modules) ───────────────────────────────────────────
function initChunk2Events(): void {

  // Module drag handles + close buttons (delegated)
  document.querySelectorAll<HTMLElement>('.module-drag-handle').forEach(handle => {
    const card = handle.closest('.module-card') as HTMLElement;
    if (!card) return;
    const modId = card.id;
    handle.addEventListener('mousedown', e => modDragStart(e, modId));
    handle.addEventListener('touchstart', e => modTouchStart(e, modId));
  });
  document.querySelectorAll<HTMLElement>('.module-drag-close').forEach(btn => {
    const card = btn.closest('.module-card') as HTMLElement;
    if (!card) return;
    const moduleId = card.id.replace('mod-', '');
    btn.addEventListener('click', () => toggleModule(moduleId, false));
  });

  // Module config toggles + size buttons
  document.querySelectorAll<HTMLElement>('.mod-toggle-card').forEach(cfgCard => {
    const moduleId = cfgCard.id.replace('modcfg-', '');
    const sw = cfgCard.querySelector('.mod-switch');
    if (sw) sw.addEventListener('click', () => toggleModule(moduleId));
    cfgCard.querySelectorAll<HTMLElement>('.mod-size-btn').forEach(btn => {
      btn.addEventListener('click', e => setModSize(moduleId, btn.textContent!.toLowerCase(), e));
    });
  });
  // Console lines buttons
  document.querySelectorAll<HTMLElement>('.mod-lines-btn').forEach(btn => {
    btn.addEventListener('click', e => setConsoleLines(parseInt(btn.textContent!), e));
  });

  // Console
  on('btnConClear', 'click', () => clearConsole());
  on('btnKeyboard', 'click', () => toggleTouchKeyboard());
  on('conInput', 'keydown', e => handleConInput(e));
  on('conInput', 'input', () => conAutoUpdate());
  on('btnConSend', 'click', () => sendManual());

  // Limits
  on('limitsFrameBtn', 'click', () => frameProgram());

  // Tool table
  on('modTTRefresh', 'click', () => loadToolTable());
  on('btnTTRefresh', 'click', () => loadToolTable());

  // Bear
  const bearRefreshBtns = document.querySelectorAll<HTMLElement>('.module-drag-handle .tb-btn');
  // Bear refresh is the ↻ button in the bear module header — find it by parent
  const bearMod = document.getElementById('mod-bear');
  if (bearMod) {
    const refreshBtn = bearMod.querySelector('.module-drag-handle .tb-btn');
    if (refreshBtn) refreshBtn.addEventListener('click', () => bearRefresh());
  }

  // Touch keyboard (delegated)
  const kbd = document.getElementById('touchKbdOverlay');
  if (kbd) {
    kbd.addEventListener('click', e => {
      const key = (e.target as HTMLElement).closest<HTMLElement>('[data-key]');
      if (key) { kbdPress(e, key.dataset.key!); return; }
      const action = (e.target as HTMLElement).closest<HTMLElement>('[data-kbd]');
      if (!action) return;
      const a = action.dataset.kbd!;
      if (a === 'backspace') kbdBackspace(e);
      else if (a === 'send') kbdSend(e);
      else if (a === 'clear') kbdClear(e);
      else if (a === 'close') toggleTouchKeyboard();
    });
    kbd.addEventListener('touchstart', e => {
      const key = (e.target as HTMLElement).closest<HTMLElement>('[data-key]');
      if (key) { e.preventDefault(); kbdPress(e, key.dataset.key!); return; }
      const action = (e.target as HTMLElement).closest<HTMLElement>('[data-kbd]');
      if (!action) return;
      e.preventDefault();
      const a = action.dataset.kbd!;
      if (a === 'backspace') kbdBackspace(e);
      else if (a === 'send') kbdSend(e);
      else if (a === 'clear') kbdClear(e);
      else if (a === 'close') toggleTouchKeyboard();
    }, { passive: false });
  }
}

// ── Event wiring (chunk 1: toolbar, tabs, viewport header, SD) ────────────────
function initChunk1Events(): void {

  // Toolbar row 1
  on('connectBtn', 'click', () => toggleConnect());
  on('sdCardBtn', 'click', () => toggleSdPanel());
  on('tbBtn-uploadOpen', 'click', () => $('uploadFileInput').click());
  on('uploadFileInput', 'change', (e) => uploadAndOpenFile(e.target as HTMLInputElement));
  on('tbBtn-reset', 'click', () => sendReset());
  on('tbBtn-unlock', 'click', () => unlockAlarm());

  // Toolbar row 2
  on('tbBtn-open', 'click', () => $('fileInput').click());
  on('fileInput', 'change', (e) => loadFile(e.target as HTMLInputElement));
  on('btnStart', 'click', () => startJob());
  on('btnPause', 'click', () => pauseJob());
  on('btnStop', 'click', () => stopJob());
  on('tbBtn-home', 'click', () => sendHome());

  // SD panel
  on('sdRefreshBtn', 'click', () => sdRefreshFiles());
  on('sdCloseBtn', 'click', () => closeSdPanel());
  on('sdRunBtn', 'click', () => sdRunSelected());

  // Tab bar
  document.querySelectorAll<HTMLElement>('.tab-btn[data-tab]').forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab!));
  });
  on('modLockBtn', 'click', () => toggleModLock());

  // Viewport header
  document.querySelectorAll<HTMLElement>('.view-btn[data-view]').forEach(btn => {
    btn.addEventListener('click', () => setView(btn.dataset.view!));
  });
  on('btnFitView', 'click', () => fitView());
  on('btnToolhead', 'click', () => toggleToolhead());
  on('vpCopyBtn', 'click', () => copyDebugStats());
}

// ── Debug stats clipboard ─────────────────────────────────────────────────────
function copyDebugStats(): void {
  const snap = {
    ts: new Date().toISOString(),
    connected: state.connected,
    connMode: state.connMode,
    machineState: state._prevMachineStateSl,
    homed: state.machineHomed,
    pos: { x: state.machineX, y: state.machineY, z: state.machineZ },
    rx: { inFlight: state.rxInFlight, bufSize: state.RX_BUFFER_SIZE },
    sentQueue: { length: state.sentQueue.length, cmds: state.sentQueue.map(s => s.line) },
    job: { running: state.running, paused: state.paused, lineHead: state.lineHead, totalLines: state.gcodeLines.length },
    jog: { isJogging: state._isJogging, holdMode: state.jogHoldMode, stepXY: state.jogStepXY, stepZ: state.jogStepZ },
    overrides: state.ovrCurrent,
    axes: state.controllerAxes,
  };
  navigator.clipboard.writeText(JSON.stringify(snap, null, 2)).then(() => {
    const btn = document.getElementById('vpCopyBtn');
    if (btn) { btn.classList.add('copied'); btn.textContent = '✓'; setTimeout(() => { btn.classList.remove('copied'); btn.textContent = '📋'; }, 1500); }
  });
}

// ── Init ──────────────────────────────────────────────────────────────────────
initChunk1Events();
initChunk2Events();
initChunk3Events();
initViewport();
const mainEl = document.querySelector('.main') as HTMLElement;
mountPosition(mainEl);
mountOverrides(mainEl);
mountSpindle(mainEl);
mountMacros(mainEl);
mountJog(mainEl);
mountSignals(mainEl);
initKeyboardJog();
initModDragListeners();
initSdClickOutside();
initCameraListeners();
loadCamSettings();

log('info', 'FlexiSender ready — IOSender-compatible character-counting stream.');
log('info', 'Open a G-code file to preview the toolpath, then connect and run.');
updateRunButtons();

window.addEventListener('load', () => {
  modInitPositions();
  const mainEl = document.querySelector('.viewport-wrap') as HTMLElement;
  if (mainEl) initDock(mainEl);
  try { if (lsGet('fs-mod-locked', false)) toggleModLock(); } catch (_) {}
  const fields: Record<string, number> = { vpXMin: state.vpXMin, vpXMax: state.vpXMax, vpYMin: state.vpYMin, vpYMax: state.vpYMax };
  for (const [id, val] of Object.entries(fields)) {
    const el = document.getElementById(id) as HTMLInputElement | null;
    if (el) el.value = String(val);
  }
  optLoadConnSettings();
  optLoadColors();
  // Save WS URL on change
  const wsInput = document.getElementById('wsUrl') as HTMLInputElement | null;
  if (wsInput) wsInput.addEventListener('change', () => optSaveConnSettings());
  optLoadTabLocks();
  optBuildTabLockList();
  initToolbarOptions();
  optLoadJogSteps();
  optApplyJogSteps();
  optLoadBearColors();
  // Restore auto-load settings toggle
  try { const al = document.getElementById('optAutoLoadSettings') as HTMLInputElement; if (al) al.checked = lsGet('fs-opt-autoload-settings', false); } catch (_) {}
  // Sync projection toggle
  const projPersp = document.getElementById('projBtnPersp');
  const projOrtho = document.getElementById('projBtnOrtho');
  if (projPersp && projOrtho) {
    projPersp.classList.toggle('selected', !state.vpOrtho);
    projOrtho.classList.toggle('selected', state.vpOrtho);
  }
});
