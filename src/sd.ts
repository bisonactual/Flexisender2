// ═══════════════════════════════════════════════
// SD card — file browser & run
// ═══════════════════════════════════════════════

import { state, SD_EXTS } from './state';
import { esc, fmtBytes } from './ui';
import { log } from './console';
import { sendCmd } from './connection';

function getHttpBase(): string {
  const wsUrl = (document.getElementById('wsUrl') as HTMLInputElement).value.trim();
  return wsUrl.replace(/^ws(s?):\/\//, 'http$1://').replace(/\/+$/, '');
}

export function toggleSdPanel(): void {
  const panel = document.getElementById('sdPanel')!;
  const btn = document.getElementById('sdCardBtn')!;
  if (panel.classList.contains('visible')) {
    closeSdPanel();
  } else {
    const wrap = document.getElementById('sdBtnWrap')!;
    const rect = wrap.getBoundingClientRect();
    panel.style.top = (rect.bottom + 6) + 'px';
    panel.style.left = rect.left + 'px';
    panel.classList.add('visible');
    btn.classList.add('open');
  }
}

export function closeSdPanel(): void {
  document.getElementById('sdPanel')!.classList.remove('visible');
  document.getElementById('sdCardBtn')!.classList.remove('open');
}

export function initSdClickOutside(): void {
  document.addEventListener('click', e => {
    const panel = document.getElementById('sdPanel')!;
    if (!panel.classList.contains('visible')) return;
    if (panel.contains(e.target as Node)) return;
    if (document.getElementById('sdBtnWrap')!.contains(e.target as Node)) return;
    closeSdPanel();
  });
  document.addEventListener('change', e => {
    if ((e.target as HTMLElement)?.id === 'sdFileSelect') sdOnSelectChange();
  });
}

export async function sdRefreshFiles(): Promise<void> {
  const refreshBtn = document.getElementById('sdRefreshBtn')!;
  const select = document.getElementById('sdFileSelect') as HTMLSelectElement;
  const runBtn = document.getElementById('sdRunBtn') as HTMLButtonElement;
  const info = document.getElementById('sdFileInfo')!;

  refreshBtn.classList.add('loading');
  refreshBtn.textContent = '⟳ LOADING…';
  select.innerHTML = '<option disabled>Fetching file list…</option>';
  runBtn.disabled = true;
  info.textContent = '';

  const base = getHttpBase();
  let files: any[] | null = null;
  for (const path of ['/sdfiles', '/sdcard', '/sd']) {
    try {
      const resp = await fetch(base + path, { signal: AbortSignal.timeout(8000) });
      if (!resp.ok) continue;
      const json = await resp.json();
      if (Array.isArray(json.files)) { files = json.files; break; }
      if (Array.isArray(json)) { files = json; break; }
    } catch (_) {}
  }

  refreshBtn.classList.remove('loading');
  refreshBtn.textContent = '⟳ REFRESH';

  if (!files) {
    select.innerHTML = '<option disabled>⚠ Could not fetch file list — check connection</option>';
    log('err', 'SD card: could not reach controller HTTP server at ' + base);
    return;
  }

  const ncFiles = files.filter(f => {
    const name = (f.name || f.filename || '').toLowerCase();
    return SD_EXTS.has(name.slice(name.lastIndexOf('.')));
  });

  if (!ncFiles.length) {
    select.innerHTML = '<option disabled>No NC files found on SD card</option>';
    log('info', 'SD card: ' + files.length + ' file(s) found, none with NC extension');
    return;
  }

  select.innerHTML = ncFiles.map(f => {
    const name = f.name || f.filename || '';
    const size = f.size != null ? ' (' + fmtBytes(f.size) + ')' : '';
    return `<option value="${esc(name)}">${esc(name)}${esc(size)}</option>`;
  }).join('');

  select.selectedIndex = 0;
  sdOnSelectChange();
  log('info', `SD card: ${ncFiles.length} NC file(s) listed`);
}

function sdOnSelectChange(): void {
  const select = document.getElementById('sdFileSelect') as HTMLSelectElement;
  const runBtn = document.getElementById('sdRunBtn') as HTMLButtonElement;
  const info = document.getElementById('sdFileInfo')!;
  const val = select.value;
  runBtn.disabled = !val;
  info.textContent = val ? val : '';
}

export function sdRunSelected(): void {
  const select = document.getElementById('sdFileSelect') as HTMLSelectElement;
  const file = select.value;
  if (!file) return;
  if (!state.connected) { log('err', 'Not connected — cannot run SD file'); return; }
  const cmd = '$F=/' + file.replace(/^\/+/, '');
  sendCmd(cmd);
  log('info', `Running SD file: ${file}`);
  closeSdPanel();
}
