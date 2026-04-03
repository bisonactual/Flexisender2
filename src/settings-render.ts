// ═══════════════════════════════════════════════
// Settings engine — UI rendering
// ═══════════════════════════════════════════════

import { state } from './state';
import { writeSetting } from './settings-write';
import { buildBoolWidget, buildBitfieldWidget, buildRadioWidget, buildAxisMaskWidget, buildTextWidget } from './settings-widgets';

export function renderSettingsUI(): void {
  const grpEl = document.getElementById('settingsGroups')!;
  grpEl.innerHTML = '';

  function addItems(parentId: number, depth: number) {
    Object.values(state.settingsGroups)
      .filter(g => g.parentId === parentId && g.id !== 0)
      .sort((a, b) => a.name.localeCompare(b.name))
      .forEach(g => {
        const hasSettings = Object.values(state.settingsDefs).some((d: any) => d.groupId === g.id);
        if (!hasSettings) { addItems(g.id, depth + 1); return; }
        const d = document.createElement('div');
        d.className = 'sg-item';
        d.style.paddingLeft = (14 + depth * 10) + 'px';
        d.textContent = g.name;
        d.dataset.gid = String(g.id);
        d.onclick = () => showGroup(g.id);
        grpEl.appendChild(d);
        addItems(g.id, depth + 1);
      });
  }
  addItems(0, 0);

  const ungrouped = Object.values(state.settingsDefs).filter((d: any) => d.groupId === 0);
  if (ungrouped.length) {
    const d = document.createElement('div');
    d.className = 'sg-item';
    d.style.paddingLeft = '14px';
    d.textContent = 'Other';
    d.dataset.gid = '0';
    d.onclick = () => showGroup(0);
    grpEl.appendChild(d);
  }

  const count = Object.keys(state.settingsDefs).length;
  const withDesc = Object.values(state.settingsDefs).filter((d: any) => d.description).length;
  document.getElementById('settingsStatus')!.textContent =
    count + ' settings  \u00b7  ' + withDesc + ' with descriptions  \u00b7  ready';
  (document.getElementById('btnWriteAll') as HTMLButtonElement).disabled = false;

  const first = grpEl.querySelector('.sg-item') as HTMLElement | null;
  if (first) { first.classList.add('active'); state.activeGroupId = parseInt(first.dataset.gid!); showGroup(state.activeGroupId); }
}

export function showGroup(gid: number): void {
  state.activeGroupId = gid;
  document.querySelectorAll('.sg-item').forEach(el => el.classList.toggle('active', parseInt((el as HTMLElement).dataset.gid!) === gid));
  renderGroupContent(gid, null);
}

export function renderGroupContent(gid: number | null, filter: string | null): void {
  const content = document.getElementById('settingsContent')!;
  content.innerHTML = '';

  let defs = Object.values(state.settingsDefs)
    .filter((d: any) => gid == null ? true : d.groupId === gid)
    .sort((a: any, b: any) => a.id - b.id);

  if (filter) {
    const q = filter.toLowerCase();
    defs = defs.filter((d: any) =>
      d.name.toLowerCase().includes(q) ||
      String(d.id).includes(q) ||
      (d.description || '').toLowerCase().includes(q)
    );
  }

  if (!defs.length) {
    content.innerHTML = '<div class="settings-placeholder"><div class="settings-placeholder-icon">\u25cb</div><div>No settings</div></div>';
    return;
  }

  const grpName = gid != null ? (state.settingsGroups[gid]?.name || (gid === 0 ? 'Other' : 'Group ' + gid)) : 'Search Results';
  const hdr = document.createElement('div');
  hdr.className = 'settings-group-header';
  hdr.textContent = grpName;
  content.appendChild(hdr);

  defs.forEach((def: any) => content.appendChild(buildSettingRow(def)));
}

function buildSettingRow(def: any): HTMLElement {
  const val = state.settingsValues[def.id] !== undefined ? String(state.settingsValues[def.id]) : '';
  const dirty = state.settingsDirty[def.id] !== undefined;

  const row = document.createElement('div');
  row.className = 'setting-row' + (dirty ? ' dirty' : '');
  row.id = 'srow-' + def.id;

  const meta = document.createElement('div');
  meta.className = 'setting-meta';

  const nameEl = document.createElement('div'); nameEl.className = 'setting-name'; nameEl.textContent = def.name; meta.appendChild(nameEl);

  const idEl = document.createElement('div'); idEl.className = 'setting-id';
  idEl.textContent = '$' + def.id + (def.unit ? '  \u00b7  ' + def.unit : '') + (def.reboot ? '  \u00b7  \u27f3 reboot' : '');
  meta.appendChild(idEl);

  if (def.description) {
    const descEl = document.createElement('div'); descEl.className = 'setting-desc'; descEl.textContent = def.description.replace(/\\n/g, '\n'); meta.appendChild(descEl);
  }

  if (def.minV || def.maxV) {
    const rangeEl = document.createElement('div'); rangeEl.className = 'setting-unit';
    rangeEl.textContent = 'Range: ' + (def.minV || '\u2014') + ' \u2026 ' + (def.maxV || '\u221e'); meta.appendChild(rangeEl);
  }

  const ctrl = document.createElement('div'); ctrl.className = 'setting-control';

  let widget: HTMLElement;
  if (def.dtype === 0) widget = buildBoolWidget(def, val);
  else if (def.dtype === 1) widget = buildBitfieldWidget(def, val, false);
  else if (def.dtype === 2) widget = buildBitfieldWidget(def, val, true);
  else if (def.dtype === 3) widget = buildRadioWidget(def, val);
  else if (def.dtype === 4) widget = buildAxisMaskWidget(def, val);
  else widget = buildTextWidget(def, val, def.dtype === 8 ? 'password' : 'text');

  const writeBtn = document.createElement('button');
  writeBtn.className = 'setting-write'; writeBtn.id = 'wbtn-' + def.id;
  writeBtn.textContent = 'WRITE $' + def.id; writeBtn.onclick = () => writeSetting(def.id);

  ctrl.appendChild(widget); ctrl.appendChild(writeBtn);
  row.appendChild(meta); row.appendChild(ctrl);
  return row;
}

export function filterSettings(q: string): void {
  if (!q.trim()) { showGroup(state.activeGroupId!); return; }
  document.querySelectorAll('.sg-item').forEach(el => el.classList.remove('active'));
  renderGroupContent(null, q.trim());
}
