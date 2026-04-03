// Settings barrel — re-exports so other modules can import from './settings'
export { loadSettings, settingsIntercept } from './settings-load';
export { markDirty, writeSetting, writeAllDirty, onSettingWriteOk, onSettingWriteErr, tryInterceptValue, tryParseSettingLine } from './settings-write';
export { renderSettingsUI, showGroup, filterSettings } from './settings-render';
