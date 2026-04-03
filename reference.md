
## FlexiSender UI Codebase Reference

### Build & Tooling

Bun-based. bun run dev → serve.ts (dev server with live reload via WebSocket). bun run build → build.ts bundles src/main.ts into a single ESM blob, inlines it into index.html, strips the dev
-reload script, writes dist/flexisender.html. Three.js loaded from CDN (r128), declared globally via declare const THREE: any.

No framework. No component system. Pure DOM manipulation. All HTML lives in index.html (2386 lines, ~144KB). CSS is embedded in <style> in the same file (~1100 lines). The TS modules produce
no HTML of their own except for dynamically generated content (settings widgets, tool table rows, bear zone forms).

### index.html Structure

- Lines 1–1098: <head>, all CSS
- Lines 1100–1173: Toolbar (two rows: connection/SD/reset/unlock, then open/start/pause/stop/home)
- Lines 1175–1694: tabpanel-run — the main operating tab. Contains:
  - Floating module cards (position, jogging, overrides, spindle, macros, console, limits, tooltable, signals, bear) — all mod-hidden by default
  - viewport-wrap with <canvas id="threeCanvas">, view buttons, progress bar, file info
- Lines 1696–1880: tabpanel-modules — module config grid (enable/disable, size buttons per module)
- Lines 1881–1905: tabpanel-settings — GrblHAL settings (group tree + content pane + search)
- Lines 1906–2018: tabpanel-camera — camera feed, crosshair config, offset measurement
- Lines 2019–2326: tabpanel-options — connection type, serial params, colour theme, viewport extents, projection, tab locks, toolbar button visibility, jog step config, bear zone colours
- Lines 2327–2378: tabpanel-tooltable — tool table with refresh button
- Line 2380: <script src="/app.js" type="module"> (dev mode entry)

### src/ Module Map (24 files)

state.ts — Single mutable state object (export const state = {...}). Every piece of runtime state lives here: connection handles, machine position, RX buffer tracking, job state, settings 
engine state, camera state, module positions, etc. Also exports all constants: POLL_*, KB_JOG_MAP, DTYPE_MAP, SIG_PIN_MAP, MOD_SIZES, MOD_DEFAULTS, MODULE_DEFS, colour defaults, tab lock 
config, toolbar button defaults.

ui.ts — Pure utility functions with zero side effects: byteLen (UTF-8 byte length), esc (HTML escape), fmtPos, fmtBytes, fmtOffset, isInputFocused, $ (getElementById shorthand).

console.ts — log(type, msg) appends a timestamped line to #consoleOut, auto-scrolls, enforces consoleMaxLines. clearConsole().

connection.ts — WebSocket and Web Serial connection layer. toggleConnect() dispatches to WS or serial based on state.connMode. Handles open/close/message events. rtSend(char) for realtime 
commands (bypass buffer). cmdSend(line) for buffered commands (tracks rxInFlight and sentQueue). sendCmd(cmd) = cmdSend + log. setPollRate(ms) manages the ? status polling interval. 
setJogging(active) switches poll rate. updateBufDisplay(), setStatus(), _updateHomeBtnHomed().

streaming.ts — Job control and character-counting pump. startJob(), pumpQueue() (the core loop — fills RX buffer up to RX_BUFFER_SIZE - 1), pauseJob(), stopJob(), sendReset(), unlockAlarm(),
sendHome(), goToXY0(), setWCS(). Also contains sendManual() (console command entry), handleConInput() (keyboard handling for console input including history, readline shortcuts), and the 
console autocomplete system (conAutoUpdate() — filters settings by name when typing $..., shows param hints for $ID=).

parser.ts — parseResponse(raw) — the central response router. Dispatches to: status report parser, settings intercept, tool table intercept, bear intercept, ok/error handling (dequeues 
sentQueue, updates rxInFlight, pumps queue), alarm handling, [OPT:] parsing (RX buffer size), [AXS:] parsing (axis detection). parseStatus(s) — extracts MPos/WPos, FS, T, Ln, Bf, Ov, Ct, 
WCS, Pn, BEAR fields from <...> reports. setMachineState(s) — updates state badge, tracks homing state transitions.

gcode.ts — G-code file loading and toolpath generation. parseGcodeToToolpath(lines) — walks G0/G1 moves, builds segment array with {from, to, isRapid} in Three.js coordinate space (Y↔Z swap)
. processGcode(text, name) — parses, stores lines, builds 3D mesh, fits view. computeProgLimits() — regex-scans raw text for X/Y/Z values, stores min/max. renderProgLimits() — updates the 
limits module display. frameProgram() — sends G0 rapids to trace the program bounding box at safe Z. loadFile(), uploadAndOpenFile() (HTTP POST to controller + local parse).

viewport.ts — Three.js scene setup and management. initViewport() — creates renderer, perspective + orthographic cameras, toolhead group (cone + cylinder + pulsing ring), grid, lighting, 
orbit/pan/zoom controls (mouse + touch). updateCamera() — positions camera from spherical coords around target. rebuildViewportGrid() — builds grid + boundary + origin axes from viewport 
extents. buildToolpathMesh(segments) — creates LineSegments for rapids (red) and cuts (cyan). updateExecutedPath(segIdx) — green overlay of executed segments. setView(preset), fitView(), 
toggleToolhead(), vpApply(), setProjection(). Orbit uses manual spherical coordinate tracking (no OrbitControls). Pan uses ray-plane intersection for world-space panning. Zoom keeps cursor 
point stable.

camera.ts — Webcam overlay for touch-off. initCameraTab() — enumerates cameras. startCamera()/stopCamera() — getUserMedia lifecycle. camLoop() → drawOverlay() — renders crosshair (cross/
circle/dot styles) on canvas overlay, handles digital zoom by drawing a cropped region of the video. measureOffset() — two-step workflow: record spindle position, jog to camera position, 
compute offset. goToCamera()/goToSpindle() — applies offset. zeroAtCrosshair() — G10 L20. Shift+drag moves crosshair position. Right-click resets to center. Settings persisted to 
localStorage.

jog.ts — Jog engine. Click mode (single $J=G91 command) and hold mode (continuous jog, cancel on release via \x85). Diagonal jog support (X+Y+ etc). 3D preview: in click mode shows ghost 
toolhead at target + dashed line; in hold mode shows directional arrow. initJogButtons() — wires all .jog-btn[data-dir] elements with click/mousedown/mouseup/touch handlers, colours buttons 
by axis. initKeyboardJog() — arrow keys / PageUp/PageDown for keyboard jogging (long-distance jog cancelled on keyup).

overrides.ts — Feed/rapid/spindle override control. applyOverride(type, target) — for feed/spindle, sends sequences of ±10/±1 realtime bytes to reach target from current. For rapid, snaps to
nearest of 100/50/25%. resetOverride(). setSpindle(mode) — M3/M4/M5. toggleCoolant(type) — M7/M8/M9 with combined state tracking.

settings.ts — Barrel file re-exporting from settings-load, settings-write, settings-render.

settings-load.ts — Three-phase settings load: $EG (groups) → $ESH + $ES (definitions) → $$ (values). settingsIntercept(raw) — state machine that intercepts responses during load phases, 
parses [SETTINGGROUP:], tab-separated $ESH lines, [SETTING:] lines, $N=V value lines, and advances phases on ok.

settings-render.ts — renderSettingsUI() — builds the group tree in the left pane (recursive, depth-indented). showGroup(gid) — renders all settings for a group. buildSettingRow(def) — 
creates a row with metadata (name, id, unit, description, range) and the appropriate widget. filterSettings(q) — cross-group text search.

settings-widgets.ts — Widget builders: buildBoolWidget (ON/OFF toggle), buildBitfieldWidget (checkboxes per bit, with exclusive mode for xbitfield), buildRadioWidget (exclusive select), 
buildAxisMaskWidget (per-axis checkboxes sized to controller axis count), buildTextWidget (input for int/float/string/password/ipv4).

settings-write.ts — markDirty(id, val) — tracks pending changes, highlights row. writeSetting(id) — sends $ID=val, shows pending state on button. onSettingWriteOk()/onSettingWriteErr() — 
updates UI on response. writeAllDirty(). tryInterceptValue() — catches $N=V lines outside load phase. tryParseSettingLine() — catches stray [SETTING:] lines.

tooltable.ts — loadToolTable() sends $TTLIST. toolTableIntercept(raw) collects lines until ok, parses P/T/X/Y/Z/D fields + name after ;. renderToolTable() — builds HTML table with pocket 
badges, status pills (active/carousel/hand), offset columns. renderModTT() — same but for the floating module card (compact column classes).

sd.ts — SD card file browser. sdRefreshFiles() — tries /sdfiles, /sdcard, /sd HTTP endpoints, parses JSON file list, filters by NC extensions. sdRunSelected() — sends $F=/filename. Panel 
positioning relative to toolbar button.

modules.ts — Floating module card system. modInitPositions() — restores from localStorage. toggleModule(), setModSize(), setConsoleLines(). Drag system: modDragStart()/modTouchStart() + 
document-level mousemove/mouseup/touchmove/touchend listeners. Integrates with dock system — if a module is docked, undocks it before starting drag. modSaveState() persists to localStorage. 
toggleModLock() — prevents dragging.

dock.ts — ImGui-style docking tree. Data model: DockNode = DockSplitNode | DockLeafNode | DockCentralNode. The central node is always the viewport canvas. Leaf nodes hold one or more module 
IDs (tab groups). Split nodes have horizontal/vertical direction + ratio. dockRender() — recursively builds DOM from tree, reparents module cards into leaf slots. Resize handles with live 
ratio adjustment. dockModule(id, side, targetNode) — inserts a module by splitting a node or tabbing into a leaf. undockModule(id) — removes from tree, restores floating style. Drag-to-dock:
dockDragStart/Move/End with hit-test zones (edge = split, center = tab). dockSave() is a no-op (stub). dockLoad() reads from localStorage but save never writes.

options.ts — Options tab logic. Connection mode switching (WS vs serial), serial params. Colour theme (5 CSS custom properties with picker + hex input + swatch + reset). Tab locks (prevent 
switching to locked tabs). Toolbar button visibility toggles. Jog step size customization (comma-separated, dynamically rebuilds step buttons). Bear zone colour config + scale slider. All 
persisted to localStorage under separate keys.

bear.ts — MR BEAR DO NOT TOUCH plugin integration. Zone management for a GrblHAL plugin that defines exclusion zones. bearCheckPlugin(line) — detects [PLUGIN:MR BEAR DO NOT TOUCH in startup 
messages. bearRefresh() sends $ZONE. bearIntercept(line) — collects [BEAR:] header + [ZONE:slot|coords|flags] lines. renderBearModule() — builds zone table with edit/delete buttons, inline 
add/edit form. rebuildZoneMeshes() — 3D visualization: wireframe boxes + translucent fill + emoji sprite labels showing what's banned per zone. bearUpdateSpriteScales(radius) — keeps sprites
readable at any zoom.

keyboard.ts — Touch keyboard overlay for tablet use. kbdPress/Backspace/Clear/Send manipulate state.kbdBuffer, display in #kbdInputDisplay, send via sendManual(). toggleTouchKeyboard() shows
/hides overlay.

main.ts — Entry point. Imports everything. switchTab(tab) — tab switching with lazy init (settings load on first visit, camera init on first visit, tool table refresh on visit). Exposes 
select functions to window for dynamically generated onclick handlers (bear form buttons, sendCmd). Event wiring split into three chunks: initChunk1Events (toolbar, tabs, viewport header, SD
), initChunk2Events (modules, jog, overrides, spindle, macros, console, limits, tool table, bear, touch keyboard), initChunk3Events (settings, camera, options). Bottom of file: init calls + 
window.onload for localStorage restoration.

### Data Flow

WebSocket/Serial → connection.ts (onMessage) → parser.ts (parseResponse)
  ├─ Status report → parseStatus → updates DRO, viewport toolhead, overrides, signals, bear
  ├─ ok/error → dequeue sentQueue, update rxInFlight → pumpQueue (streaming.ts)
  ├─ Settings intercept → settings-load.ts state machine
  ├─ Tool table intercept → tooltable.ts collector
  ├─ Bear intercept → bear.ts zone parser
  └─ Everything else → console log

User action → main.ts event handler → module function → connection.ts (cmdSend/rtSend)


### Persistence

All via localStorage, separate keys:
- fs-modules — module positions/sizes/enabled
- fs-viewport-extents — grid bounds + ortho flag
- fs-dock-tree — dock layout (load works, save is stubbed)
- fs-opt-conn — connection mode + WS URL + serial params
- fs-opt-colors — theme colours
- fs-opt-tablocks — locked tab IDs
- fs-tb-btn-opts — toolbar button visibility
- fs-opt-jogsteps — custom jog step sizes
- fs-opt-bearcolors — bear zone colours + scale
- fs-mod-locked — module lock state
- flexisender_cam — camera offset + crosshair config
- fs-opt-autoload-settings — auto-load settings on connect

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━


## Assessment of Responsibility Split

Given this was ported from a single HTML file, the split is reasonable. The modules are mostly coherent and the dependency graph is mostly acyclic. That said:

What works well:
- state.ts as single source of truth is clean — no hidden state scattered across modules
- ui.ts is properly pure utilities with no imports from other modules
- The settings subsystem (settings-load, settings-render, settings-widgets, settings-write) is well-decomposed by concern
- parser.ts as a central router is the right pattern for a line-oriented protocol
- connection.ts cleanly separates transport (WS vs serial) from protocol

Where it gets muddy:

1. streaming.ts is doing too much. It's the job pump (correct), but it also owns sendManual(), handleConInput(), the entire console autocomplete system, sendReset(), unlockAlarm(), 
sendHome(), goToXY0(), setWCS(). The autocomplete alone is ~80 lines that have nothing to do with streaming. The simple command senders (unlockAlarm, sendHome, etc.) are one-liners that 
could live anywhere but conceptually belong closer to connection or a "commands" module.

2. gcode.ts mixes parsing (pure) with file I/O (loadFile, uploadAndOpenFile with XHR), program limits computation, program limits rendering, and the frame-program command sequence. The 
upload logic especially is a different concern entirely.

3. parser.ts has direct DOM manipulation (document.getElementById('droX'), etc.) mixed into the status report parser. The parsing is pure data extraction but it's interleaved with UI 
updates. A future refactor could have parseStatus return a structured object and let a separate function apply it to the DOM.

4. main.ts event wiring is comprehensive but brittle — it's a 300-line manual binding of every UI element by ID. Any HTML ID change requires a corresponding change here. The chunked split (
initChunk1/2/3Events) helps readability but the chunks are somewhat arbitrary.

5. dock.ts save is a no-op — dockSave() has an empty try/catch body. dockLoad() reads from localStorage. So dock state loads but never persists. This looks like an incomplete feature.

6. bear.ts generates HTML via string concatenation with inline onclick="bearShowAddForm()" handlers, which is why those functions need to be on window. The rest of the codebase uses 
addEventListener wired in main.ts. Two patterns for the same thing.

7. options.ts is a grab-bag — connection mode, colours, tab locks, toolbar visibility, jog steps, and bear colours are all unrelated concerns sharing a file because they share a tab panel. 
If any of these grow, they'd benefit from their own files.

8. The window as any globals in main.ts for dynamically generated onclick handlers (bear form, sendCmd) is a code smell from the single-file origin. The bear module and settings widgets that
generate HTML with inline handlers are the only consumers.

Not a problem yet but worth noting: There's no type for the settings definition object — it's any throughout. Same for toolpath segments, tool table entries, and the drag state. The 
declare const THREE: any means zero type safety on the 3D code.



