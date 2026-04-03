// ═══════════════════════════════════════════════
// Event bus — tag-filtered pub/sub
// ═══════════════════════════════════════════════

type Listener<T> = (data: T) => void;

interface Sub<T> {
  tags: Set<string> | null;  // null = no filter, always called
  fn: Listener<T>;
}

const _subs = new Map<string, Sub<any>[]>();

export function on<T>(event: string, tags: string[] | null, fn: Listener<T>): () => void {
  const sub: Sub<T> = { tags: tags ? new Set(tags) : null, fn };
  let list = _subs.get(event);
  if (!list) { list = []; _subs.set(event, list); }
  list.push(sub);
  return () => { const l = _subs.get(event); if (l) _subs.set(event, l.filter(s => s !== sub)); };
}

export function emit<T>(event: string, tags: Set<string>, data: T): void {
  const list = _subs.get(event);
  if (!list) return;
  for (const sub of list) {
    if (sub.tags === null) { sub.fn(data); continue; }
    for (const t of sub.tags) {
      if (tags.has(t)) { sub.fn(data); break; }
    }
  }
}

// ── Status report type ────────────────────────────────────────────────────────

export interface StatusReport {
  machineState: string;
  mpos?: { x: number; y: number; z: number };
  fs?: { feed: string; spindle: string };
  ov?: { feed: number; rapid: number; spindle: number };
  bf?: { blocks: string; bytes: string };
  ln?: number;
  tool?: number;
  wcs?: string;
  pins?: string;     // raw pin string, empty string = no pins active
  bear?: string;
}

// Tags: 'mpos', 'fs', 'ov', 'bf', 'ln', 'tool', 'wcs', 'pins', 'bear', 'state'
