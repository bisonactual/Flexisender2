// ═══════════════════════════════════════════════
// WCS Coordinate Offset Table
// ═══════════════════════════════════════════════

import { state } from './state';
import { log } from './console';
import { sendCmd, cmdSend } from './connection';
import { lsGet, lsSet } from './ui';

// ── Coordinate systems in display order ──────────────────────────────────────

export const WCS_ENTRIES = [
  { code: 'G54',   label: 'G54',   id: 1  },
  { code: 'G55',   label: 'G55',   id: 2  },
  { code: 'G56',   label: 'G56',   id: 3  },
  { code: 'G57',   label: 'G57',   id: 4  },
  { code: 'G58',   label: 'G58',   id: 5  },
  { code: 'G59',   label: 'G59',   id: 6  },
  { code: 'G59.1', label: 'G59.1', id: 7  },
  { code: 'G59.2', label: 'G59.2', id: 8  },
  { code: 'G59.3', label: 'G59.3 — Toolsetter', id: 9 },
  { code: 'G28',   label: 'G28 — Home 1', id: 0 },
  { code: 'G30',   label: 'G30 — Home 2', id: 0 },
  { code: 'TLO',   label: 'TLO — Tool Length Offset', id: 0 },
];

// ── Load / parse ──────────────────────────────────────────────────────────────

export function loadOffsets(): void {
  if (!state.connected) { log('err', 'Not connected'); return; }
  state.wcsPhase = 'loading';
  cmdSend('$#');
}

export function offsetsIntercept(raw: string): boolean {
  // Match [G54:x,y,z] [G55:...] [G28:...] [TLO:z] etc.
  const m = raw.match(/^\[([A-Z0-9.]+):([^\]]+)\]$/);
  if (!m) return false;

  const key = m[1];
  const vals = m[2].split(',').map(Number);

  const knownKeys = new Set(['G54','G55','G56','G57','G58','G59',
    'G59.1','G59.2','G59.3','G28','G28.1','G30','G30.1','G92','TLO','PRB']);

  if (!knownKeys.has(key)) return false;

  if (key === 'TLO') {
    // TLO can be single value (Z only) or X,Y,Z
    state.tloOffset = vals.length === 1 ? vals[0] : (vals[2] ?? vals[0]);
    state.tloActive = state.tloOffset !== 0;
    renderOffsetsTable();
    return true;
  }

  if (key === 'PRB') return false; // leave for parser

  // Store normalised: x, y, z (pad with 0 if fewer axes reported)
  state.wcsOffsets[key] = {
    x: vals[0] ?? 0,
    y: vals[1] ?? 0,
    z: vals[2] ?? 0,
  };

  renderOffsetsTable();
  return true;
}

export function offsetsInterceptOk(): void {
  if (state.wcsPhase === 'loading') {
    state.wcsPhase = 'idle';
    renderOffsetsTable();
  }
}

// ── Render ────────────────────────────────────────────────────────────────────

export function renderOffsetsTable(): void {
  const tbody = document.getElementById('wcsTableBody');
  const empty = document.getElementById('wcsEmpty');
  const table = document.getElementById('wcsTable') as HTMLElement;
  if (!tbody || !empty || !table) return;

  const hasData = Object.keys(state.wcsOffsets).length > 0 || state.tloOffset !== 0;

  if (!hasData) {
    table.style.display = 'none';
    empty.style.display = 'flex';
    return;
  }

  table.style.display = '';
  empty.style.display = 'none';

  tbody.innerHTML = WCS_ENTRIES.map(entry => {
    const isTlo = entry.code === 'TLO';
    const isToolsetter = entry.code === 'G59.3';
    const isHome = entry.code === 'G28' || entry.code === 'G30';

    let x: number, y: number, z: number;
    if (isTlo) {
      x = 0; y = 0; z = state.tloOffset;
    } else {
      const d = state.wcsOffsets[entry.code];
      if (!d) return '';
      x = d.x; y = d.y; z = d.z;
    }

    const fmt = (v: number) => v.toFixed(3);
    const rowClass = isToolsetter ? 'wcs-row wcs-toolsetter'
                   : isTlo        ? 'wcs-row wcs-tlo'
                   : isHome       ? 'wcs-row wcs-home'
                   : 'wcs-row';

    // Axis inputs — TLO is Z-only, G28/G30 are preset positions (read-only style)
    const axisCell = (axis: 'x'|'y'|'z', val: number) => {
      if (isTlo && axis !== 'z') return `<td class="wcs-td wcs-td-num wcs-disabled">${fmt(val)}</td>`;
      return `<td class="wcs-td wcs-td-num">
        <input type="number" class="wcs-val-input" step="0.001"
          data-code="${entry.code}" data-axis="${axis}"
          value="${fmt(val)}" />
      </td>`;
    };

    return `<tr class="${rowClass}" data-code="${entry.code}">
      <td class="wcs-td wcs-td-label">
        ${isToolsetter ? '<span class="wcs-toolsetter-badge">⊕</span>' : ''}
        ${entry.label}
      </td>
      ${axisCell('x', x)}
      ${axisCell('y', y)}
      ${axisCell('z', z)}
      <td class="wcs-td wcs-td-actions">
        ${isTlo ? `
          <button class="wcs-btn wcs-btn-clear" data-code="TLO" title="Cancel TLO (G49)">G49</button>
        ` : `
          <button class="wcs-btn wcs-btn-pos" data-code="${entry.code}" title="Set to current machine position">POS</button>
          <button class="wcs-btn wcs-btn-write" data-code="${entry.code}" title="Write values to controller">WRITE</button>
          <button class="wcs-btn wcs-btn-clear" data-code="${entry.code}" title="Zero all axes">ZERO</button>
        `}
      </td>
    </tr>`;
  }).join('');

  // Wire up events after render
  wireOffsetEvents();
}

// ── Event wiring ──────────────────────────────────────────────────────────────

function wireOffsetEvents(): void {
  const tbody = document.getElementById('wcsTableBody');
  if (!tbody) return;

  // Write button — write all three axes for this coordinate system
  tbody.querySelectorAll<HTMLElement>('.wcs-btn-write').forEach(btn => {
    btn.addEventListener('click', () => {
      const code = btn.dataset.code!;
      writeOffset(code);
    });
  });

  // Zero button — zero all axes
  tbody.querySelectorAll<HTMLElement>('.wcs-btn-clear').forEach(btn => {
    btn.addEventListener('click', () => {
      const code = btn.dataset.code!;
      if (code === 'TLO') {
        sendCmd('G49');
        state.tloOffset = 0;
        state.tloActive = false;
        renderOffsetsTable();
      } else {
        zeroOffset(code);
      }
    });
  });

  // POS button — set to current machine position
  tbody.querySelectorAll<HTMLElement>('.wcs-btn-pos').forEach(btn => {
    btn.addEventListener('click', () => {
      const code = btn.dataset.code!;
      setToCurrentPos(code);
    });
  });

  // Input change — mark row dirty
  tbody.querySelectorAll<HTMLInputElement>('.wcs-val-input').forEach(inp => {
    inp.addEventListener('change', () => {
      const row = inp.closest('tr');
      if (row) row.classList.add('wcs-dirty');
    });
    // Enter key = write
    inp.addEventListener('keydown', (e: KeyboardEvent) => {
      if (e.key === 'Enter') writeOffset(inp.dataset.code!);
    });
  });
}

// ── Write helpers ─────────────────────────────────────────────────────────────

function getInputVals(code: string): { x: number; y: number; z: number } | null {
  const tbody = document.getElementById('wcsTableBody');
  if (!tbody) return null;
  const xInp = tbody.querySelector<HTMLInputElement>(`input[data-code="${code}"][data-axis="x"]`);
  const yInp = tbody.querySelector<HTMLInputElement>(`input[data-code="${code}"][data-axis="y"]`);
  const zInp = tbody.querySelector<HTMLInputElement>(`input[data-code="${code}"][data-axis="z"]`);
  return {
    x: parseFloat(xInp?.value || '0') || 0,
    y: parseFloat(yInp?.value || '0') || 0,
    z: parseFloat(zInp?.value || '0') || 0,
  };
}

function writeOffset(code: string): void {
  if (!state.connected) { log('err', 'Not connected'); return; }
  const vals = getInputVals(code);
  if (!vals) return;

  let cmd: string;
  if (code === 'G28' || code === 'G30') {
    // G28.1 / G30.1 stores current machine position — move there first then store
    // For manual edit we use G28.1/G30.1 after moving to the entered position
    cmd = `G90G0X${vals.x.toFixed(4)}Y${vals.y.toFixed(4)}Z${vals.z.toFixed(4)}`;
    sendCmd(cmd);
    sendCmd(code + '.1');
  } else {
    // G10 L2 P<n> — persistent WCS offset
    const entry = WCS_ENTRIES.find(e => e.code === code);
    if (!entry) return;
    const p = entry.id;
    cmd = `G10L2P${p}X${vals.x.toFixed(4)}Y${vals.y.toFixed(4)}Z${vals.z.toFixed(4)}`;
    sendCmd(cmd);
  }

  // Update local state and re-render
  state.wcsOffsets[code] = { x: vals.x, y: vals.y, z: vals.z };
  const row = document.querySelector<HTMLElement>(`tr[data-code="${code}"]`);
  if (row) row.classList.remove('wcs-dirty');
  log('info', `Offset written: ${code} X${vals.x.toFixed(3)} Y${vals.y.toFixed(3)} Z${vals.z.toFixed(3)}`);

  // Refresh from controller after a short delay to confirm
  setTimeout(() => loadOffsets(), 300);
}

function zeroOffset(code: string): void {
  if (!state.connected) { log('err', 'Not connected'); return; }
  const entry = WCS_ENTRIES.find(e => e.code === code);
  if (!entry) return;

  if (code === 'G28' || code === 'G30') {
    sendCmd(`G0X0Y0Z0`);
    sendCmd(code + '.1');
  } else {
    sendCmd(`G10L2P${entry.id}X0Y0Z0`);
  }
  state.wcsOffsets[code] = { x: 0, y: 0, z: 0 };
  renderOffsetsTable();
  log('info', `Offset zeroed: ${code}`);
  setTimeout(() => loadOffsets(), 300);
}

function setToCurrentPos(code: string): void {
  if (!state.connected) { log('err', 'Not connected'); return; }
  const entry = WCS_ENTRIES.find(e => e.code === code);
  if (!entry) return;

  const x = state.machineX, y = state.machineY, z = state.machineZ;

  if (code === 'G28' || code === 'G30') {
    sendCmd(code + '.1');
  } else {
    sendCmd(`G10L2P${entry.id}X${x.toFixed(4)}Y${y.toFixed(4)}Z${z.toFixed(4)}`);
  }

  state.wcsOffsets[code] = { x, y, z };
  renderOffsetsTable();
  log('info', `Offset set to machine pos: ${code} X${x.toFixed(3)} Y${y.toFixed(3)} Z${z.toFixed(3)}`);
  setTimeout(() => loadOffsets(), 300);
}
