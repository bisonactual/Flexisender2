// ═══════════════════════════════════════════════
// Tool table — $TTLIST parser & rendering
// ═══════════════════════════════════════════════

import { state } from './state';
import { fmtOffset } from './ui';
import { log } from './console';
import { sendCmd } from './connection';

function parseToolTableLine(line: string): any {
  const semi = line.indexOf(';');
  const name = semi >= 0 ? line.slice(semi + 1).trim() : '';
  const body = semi >= 0 ? line.slice(0, semi) : line;
  const entry: any = { pocket: 0, tool: 0, x: null, y: null, z: null, d: null, name };
  const re = /([PTXYZD])([+-]?[\d.]+)/gi;
  let m;
  while ((m = re.exec(body)) !== null) {
    const k = m[1].toUpperCase(), v = parseFloat(m[2]);
    if (k === 'P') entry.pocket = v;
    else if (k === 'T') entry.tool = v;
    else if (k === 'X') entry.x = v;
    else if (k === 'Y') entry.y = v;
    else if (k === 'Z') entry.z = v;
    else if (k === 'D') entry.d = v;
  }
  return entry;
}

function sortedEntries(): any[] {
  return [...state.ttEntries].sort((a, b) => {
    if (a.pocket > 0 && b.pocket > 0) return a.pocket - b.pocket;
    if (a.pocket > 0) return -1;
    if (b.pocket > 0) return 1;
    return a.tool - b.tool;
  });
}

function renderRow(e: any, isMod: boolean): string {
  const inCarousel = e.pocket > 0;
  const isCurrent = e.tool === state.currentToolNumber && state.currentToolNumber !== 0;
  let rowClass = 'tt-row';
  if (isCurrent) rowClass += ' current-tool';
  else if (inCarousel) rowClass += ' in-carousel';

  const pocketCell = inCarousel
    ? `<span style="color:var(--accent);font-weight:700">P${e.pocket}</span>`
    : `<span style="color:var(--text3)">P0</span>`;

  let statusPill: string;
  if (isCurrent) statusPill = `<span class="tt-status-pill active">▶ ACTIVE</span>`;
  else if (inCarousel) statusPill = `<span class="tt-status-pill carousel">⬡ ${isMod ? e.pocket : 'POCKET ' + e.pocket}</span>`;
  else statusPill = `<span class="tt-status-pill hand">○${isMod ? '' : ' STORED'}</span>`;

  const nameCol = isMod ? `<td class="tt-td tool-name mod-tt-name-col">${e.name || '<span style="color:var(--text3)">—</span>'}</td>` : `<td class="tt-td tool-name">${e.name || '<span style="color:var(--text3)">—</span>'}</td>`;
  const offClass = isMod ? ' mod-tt-off-col' : '';
  const pktClass = isMod ? ' mod-tt-pocket-col' : '';
  const diaClass = isMod ? ' mod-tt-dia-col' : '';
  const statusClass = isMod ? ' mod-tt-status-col' : '';

  return `<tr class="${rowClass}">
    <td class="tt-td${pktClass} pocket-badge">${pocketCell}</td>
    <td class="tt-td tool-id">T${e.tool}</td>
    ${nameCol}
    <td class="tt-td${offClass}">${fmtOffset(e.x)}</td>
    <td class="tt-td${offClass}">${fmtOffset(e.y)}</td>
    <td class="tt-td">${fmtOffset(e.z)}</td>
    <td class="tt-td${diaClass}">${fmtOffset(e.d)}</td>
    <td class="tt-td${statusClass}">${statusPill}</td>
  </tr>`;
}

function renderTTInto(tableId: string, emptyId: string, tbodyId: string, countId: string, isMod: boolean): void {
  const table = document.getElementById(tableId) as HTMLElement;
  const empty = document.getElementById(emptyId) as HTMLElement;
  const count = document.getElementById(countId) as HTMLElement | null;
  const tbody = document.getElementById(tbodyId) as HTMLElement;
  if (!table || !empty || !tbody) return;

  if (!state.ttEntries.length) {
    table.style.display = 'none';
    empty.style.display = 'flex';
    if (count) count.textContent = '';
    return;
  }

  tbody.innerHTML = sortedEntries().map(e => renderRow(e, isMod)).join('');
  table.style.display = '';
  empty.style.display = 'none';
  const carouselCount = state.ttEntries.filter(e => e.pocket > 0).length;
  if (count) count.textContent = isMod
    ? `${state.ttEntries.length}T · ${carouselCount}P`
    : `${state.ttEntries.length} tool${state.ttEntries.length !== 1 ? 's' : ''} · ${carouselCount} in carousel`;
}

export function renderToolTable(): void {
  renderTTInto('ttTable', 'ttEmpty', 'ttTableBody', 'ttToolCount', false);
  renderModTT();
}

export function renderModTT(): void {
  const modCard = document.getElementById('mod-tooltable');
  if (!modCard || modCard.classList.contains('mod-hidden')) return;
  renderTTInto('modTTTable', 'modTTEmpty', 'modTTBody', 'modTTCount', true);
}

function ttSetStatus(msg: string | null): void {
  const el = document.getElementById('ttStatus');
  const mel = document.getElementById('modTTStatus');
  if (el) { if (msg) { el.textContent = msg; el.style.display = ''; } else { el.style.display = 'none'; } }
  if (mel) { if (msg) { mel.textContent = msg; mel.style.display = ''; } else { mel.style.display = 'none'; } }
}

export function loadToolTable(): void {
  const tabBtn = document.getElementById('btnTTRefresh') as HTMLButtonElement | null;
  const modBtn = document.getElementById('modTTRefresh') as HTMLButtonElement | null;

  if (!state.connected) {
    ttSetStatus('');
    (document.getElementById('ttTable') as HTMLElement).style.display = 'none';
    const empty = document.getElementById('ttEmpty') as HTMLElement;
    empty.style.display = 'flex';
    empty.querySelector('div:last-child')!.textContent = 'Connect to a controller and click Refresh.';
    document.getElementById('ttToolCount')!.textContent = '';
    renderModTT();
    return;
  }
  ttSetStatus('Loading tool table…');
  state.ttEntries = [];
  state._ttLines = [];
  state.ttPhase = 'loading';
  if (tabBtn) tabBtn.disabled = true;
  if (modBtn) modBtn.disabled = true;
  sendCmd('$TTLIST');
}

export function toolTableIntercept(raw: string): boolean {
  if (raw === 'ok' || raw === 'OK') {
    state.ttPhase = 'idle';
    state.ttEntries = state._ttLines.map(parseToolTableLine).filter(e => e.tool > 0);
    state._ttLines = [];
    renderToolTable();
    ttSetStatus('');
    const tabBtn = document.getElementById('btnTTRefresh') as HTMLButtonElement | null;
    const modBtn = document.getElementById('modTTRefresh') as HTMLButtonElement | null;
    if (tabBtn) tabBtn.disabled = false;
    if (modBtn) modBtn.disabled = false;
    log('info', 'Tool table: ' + state.ttEntries.length + ' entr' + (state.ttEntries.length === 1 ? 'y' : 'ies'));
    return true;
  }
  if (raw.startsWith('error:')) {
    state.ttPhase = 'idle';
    state._ttLines = [];
    ttSetStatus('⚠ ' + raw);
    const tabBtn = document.getElementById('btnTTRefresh') as HTMLButtonElement | null;
    const modBtn = document.getElementById('modTTRefresh') as HTMLButtonElement | null;
    if (tabBtn) tabBtn.disabled = false;
    if (modBtn) modBtn.disabled = false;
    log('err', '$TTLIST: ' + raw);
    return true;
  }
  if (raw.length > 0) {
    state._ttLines.push(raw);
    return true;
  }
  return false;
}
