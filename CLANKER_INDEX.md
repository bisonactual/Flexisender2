# CLANKER_INDEX

What lives where.

## src/state.ts
All mutable shared state in a single `state` object. Constants: poll rates, pin maps, module definitions, size presets, colour defaults, toolbar defaults, dtype map.

## src/ui.ts
Pure helpers: `byteLen`, `esc`, `fmtPos`, `fmtBytes`, `fmtOffset`, `isInputFocused`, `$` (getElementById shorthand).

## src/console.ts
`log(type, msg)` — appends timestamped lines to the console output div. `clearConsole()`.

## src/connection.ts
WebSocket and Web Serial connect/disconnect. `rtSend` (real-time bypass), `cmdSend` (byte-tracked), `sendCmd` (UI-facing). Poll rate management. Status dot/text updates. Home button homed state.

## src/viewport.ts
Three.js scene setup, orbit/pan/zoom (mouse + touch), grid rebuild from viewport extents, toolpath mesh building, executed path overlay, view presets (ISO/TOP/FRONT/SIDE/FIT), toolhead marker.

## src/gcode.ts
G-code parser (`parseGcodeToToolpath`), file loading (`loadFile`, `uploadAndOpenFile`), `processGcode` (parses + builds mesh + computes limits), program limits computation and rendering, frame program.

## src/streaming.ts
Character-counting job pump. `startJob`, `pauseJob`, `stopJob`, `pumpQueue`. Run button state. `sendReset`, `unlockAlarm`, `sendHome`, `goToXY0`, `setWCS`. Console manual send + command history.

## src/parser.ts
`parseResponse` — routes incoming lines to the right handler. Status report parser (MPos/WPos, FS, Ov, Bf, Ln, Ct, WCS, Pn). Machine state badge. Signal pin updates.

## src/jog.ts
Click-to-step and hold-to-jog modes. XY/Z step size selectors. Diagonal jog support. Keyboard continuous jog (arrow keys, PageUp/Down). Button highlight feedback.

## src/overrides.ts
Feed/rapid/spindle override sliders. Sends real-time increment bytes (0x90–0x9D). Spindle CW/CCW/OFF. Flood/mist coolant toggles.

## src/settings-load.ts
Settings load sequence: `$EG` → `$ESH`+`$ES` → `$$`. Phase state machine. `settingsIntercept` — intercepts lines during load.

## src/settings-widgets.ts
Widget builders for each GrblHAL setting datatype: bool toggle, bitfield checkboxes, exclusive bitfield, radio buttons, axis mask, text/number/password/ipv4 inputs.

## src/settings-write.ts
Dirty tracking (`markDirty`), individual and batch write (`writeSetting`, `writeAllDirty`), write ok/err handlers, `tryInterceptValue`, `tryParseSettingLine`.

## src/settings-render.ts
Renders the settings UI: group sidebar, setting rows with meta + widget + write button, search/filter.

## src/settings.ts
Barrel re-export of all settings-* modules.

## src/tooltable.ts
`$TTLIST` parser (LinuxCNC format). Renders both the full-tab table and the module-card table. Pocket/carousel/active tool status. `toolTableIntercept` for response accumulation.

## src/sd.ts
SD card file browser dropdown. Fetches file list via HTTP (`/sdfiles`, `/sdcard`, `/sd`). Run-from-SD command.

## src/camera.ts
Camera engine: getUserMedia, crosshair overlay (cross/circle/dot styles), zoom, drag-to-move crosshair, offset measurement workflow, go-to-camera/spindle, zero-at-crosshair. Settings persistence.

## src/keyboard.ts
Touch keyboard overlay: QWERTY + numpad, buffer management, send to console input.

## src/modules.ts
Floating module card system: drag (mouse + touch), size presets, enable/disable, position persistence to localStorage, module lock toggle, console line limit.

## src/options.ts
Options page: connection mode (WS/Serial + baud config), colour theme (CSS var overrides), tab access locks, toolbar button visibility toggles. All persisted to localStorage.

## src/main.ts
Entry point. Imports all modules, exposes functions on `window` for HTML onclick handlers, runs init sequence on load.
