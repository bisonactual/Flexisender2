// ═══════════════════════════════════════════════
// Shared mutable state — single source of truth
// ═══════════════════════════════════════════════

export const state = {
  // Connection
  ws: null as WebSocket | null,
  serialPort: null as any,
  serialWriter: null as any,
  serialReader: null as any,
  serialAbort: null as AbortController | null,
  connMode: 'websocket' as 'websocket' | 'serial',
  connected: false,

  // Jog
  jogStepXY: 10,
  jogStepZ: 1,
  statusInterval: null as ReturnType<typeof setInterval> | null,
  _isJogging: false,
  jogHoldMode: false,
  _jogHoldActive: false,

  // Command history
  cmdHistory: [] as string[],
  histIdx: -1,

  // Machine position
  machineX: 0,
  machineY: 0,
  machineZ: 0,

  // RX buffer tracking
  RX_BUFFER_SIZE: 128,
  rxInFlight: 0,
  sentQueue: [] as { line: string; bytes: number }[],

  // Job
  gcodeLines: [] as string[],
  lineHead: 0,
  running: false,
  paused: false,
  segmentIndex: 0,

  // Receive buffer
  _rxBuf: '',

  // Settings engine
  settingsGroups: {} as Record<number, { id: number; parentId: number; name: string }>,
  settingsDefs: {} as Record<number, any>,
  settingsValues: {} as Record<number, string>,
  settingsDirty: {} as Record<number, string>,
  activeGroupId: null as number | null,
  settingsLoaded: false,
  esPhase: 'idle' as string,
  esPendingOks: 0,
  pendingSettingWrite: null as { id: number; btn: HTMLElement | null } | null,
  controllerAxes: ['X', 'Y', 'Z'] as string[],

  // Toolpath
  toolpathSegments: [] as any[],
  totalMoves: 0,
  totalRapids: 0,

  // Tool table
  ttEntries: [] as any[],
  currentToolNumber: 0,
  ttPhase: 'idle' as string,
  _ttLines: [] as string[],

  // Program limits
  progLimits: null as any,

  // Console
  conLines: 0,
  consoleMaxLines: 50,

  // Homing
  machineHomed: false,
  _prevMachineStateSl: '',

  // Overrides
  ovrCurrent: { feed: 100, rapid: 100, spindle: 100 },

  // Camera
  camStream: null as MediaStream | null,
  camActive: false,
  camZoomVal: 1.0,
  camCrossSizeVal: 80,
  camCrossStyle: 'cross',
  camCrossColor: '#00d4ff',
  camOffsetX: 0,
  camOffsetY: 0,
  camCrossX: 0.5,
  camCrossY: 0.5,
  camDragging: false,
  camShiftDrag: false,
  camDragStartCross: { x: 0.5, y: 0.5 },
  camDragStartMouse: { x: 0, y: 0 },
  camMeasuring: false,
  camMeasureStartPos: null as { x: number; y: number } | null,
  _camTabInited: false,

  // Keyboard jog
  kbJogActive: false,
  kbJogKey: null as string | null,

  // Touch keyboard
  kbdBuffer: '',

  // Module lock
  modLocked: false,
  _modDrag: null as any,

  // Tab locks
  _lockedTabs: new Set<string>(),

  // Viewport extents
  vpXMin: -300,
  vpXMax: 0,
  vpYMin: -300,
  vpYMax: 0,
  vpOrtho: false,

  // Coolant
  floodOn: false,
  mistOn: false,

  // Spindle/coolant UI active state
  showToolhead: true,
};

export const POLL_JOG = 50;
export const POLL_NORM = 100;
export const KEYBOARD_JOG_DIST = 100000;
export const VP_STORAGE_KEY = 'fs-viewport-extents';
export const SD_EXTS = new Set(['.nc', '.gcode', '.g', '.ngc', '.tap', '.gc']);

export const KB_JOG_MAP: Record<string, string> = {
  'ArrowLeft': 'X-', 'ArrowRight': 'X+',
  'ArrowDown': 'Y-', 'ArrowUp': 'Y+',
  'PageDown': 'Z-', 'PageUp': 'Z+',
};

export const DTYPE_MAP: Record<string, number> = {
  'bool': 0, 'boolean': 0,
  'bitfield': 1,
  'xbitfield': 2,
  'radiobuttons': 3, 'radio': 3,
  'axismask': 4,
  'integer': 5, 'int': 5,
  'float': 6, 'decimal': 6,
  'string': 7, 'text': 7,
  'password': 8,
  'ipv4': 9,
};

export const SIG_PIN_MAP: Record<string, string> = {
  'X': 'sig-xlim',
  'Y': 'sig-ylim',
  'Z': 'sig-zlim',
  'A': 'sig-alim',
  'B': 'sig-blim',
  'P': 'sig-probe',
  'T': 'sig-toolsetter',
  'D': 'sig-door',
  'R': 'sig-estop',
};

export const MOD_SIZES: Record<string, number> = {
  normal: 282,
  large: 360,
  xl: 460,
  xxl: 580,
};

export const MOD_DEFAULTS: Record<string, { x: number; y: number; enabled: boolean; size: string }> = {
  position:  { x: 10,  y: 10,  enabled: false, size: 'normal' },
  jogging:   { x: 10,  y: 380, enabled: false, size: 'normal' },
  overrides: { x: 302, y: 10,  enabled: false, size: 'normal' },
  spindle:   { x: 302, y: 185, enabled: false, size: 'normal' },
  macros:    { x: 302, y: 390, enabled: false, size: 'normal' },
  console:   { x: 594, y: 10,  enabled: false, size: 'normal' },
  tooltable: { x: 10,  y: 10,  enabled: false, size: 'xl' },
  limits:    { x: 302, y: 10,  enabled: false, size: 'normal' },
  signals:   { x: 594, y: 10,  enabled: false, size: 'normal' },
  bear:      { x: 594, y: 10,  enabled: false, size: 'normal' },
};

export const MODULE_DEFS = [
  { id: 'position',  icon: '📍', name: 'Machine Position' },
  { id: 'jogging',   icon: '🕹', name: 'Jogging' },
  { id: 'overrides', icon: '⚡', name: 'Overrides' },
  { id: 'spindle',   icon: '🔄', name: 'Spindle/Coolant' },
  { id: 'macros',    icon: '🔧', name: 'Macros' },
  { id: 'console',   icon: '💻', name: 'Console' },
  { id: 'tooltable', icon: '🔩', name: 'Tool Table' },
  { id: 'limits',    icon: '📐', name: 'Program Limits' },
  { id: 'signals',   icon: '🔴', name: 'Signals' },
  { id: 'bear',      icon: '🐻', name: 'MR BEAR' },
];

export const OPT_COLOR_DEFAULTS: Record<string, string> = {
  text: '#f1f5f9',
  text2: '#94a3b8',
  bg: '#0f0e0c',
  surface: '#1a1814',
  accent: '#ff8c42',
};

export const OPT_COLOR_CSS_VARS: Record<string, string> = {
  text: '--text',
  text2: '--text2',
  bg: '--bg',
  surface: '--surface',
  accent: '--accent',
};

export const OPT_LOCKABLE_TABS = [
  { id: 'settings', label: 'SETTINGS: GRBL' },
  { id: 'tooltable', label: 'TOOL TABLE' },
];

export const TB_BTN_DEFAULTS: Record<string, boolean> = {
  'tbBtn-reset': true,
  'tbBtn-unlock': true,
  'sdBtnWrap': true,
  'tbBtn-uploadOpen': true,
  'tbBtn-open': true,
  'btnStart': true,
  'btnPause': true,
  'btnStop': true,
  'tbBtn-home': true,
};
