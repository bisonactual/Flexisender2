// ═══════════════════════════════════════════════
// JSX factory — h() and Fragment
// ═══════════════════════════════════════════════

export function h(
  tag: string | Function,
  props: Record<string, any> | null,
  ...children: any[]
): HTMLElement | DocumentFragment {
  if (typeof tag === 'function') return tag({ ...props, children });

  const el = document.createElement(tag);

  if (props) {
    for (const [k, v] of Object.entries(props)) {
      if (k === 'class') el.className = v;
      else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
      else if (k === 'dataset' && typeof v === 'object') Object.assign(el.dataset, v);
      else if (k === 'ref' && typeof v === 'function') v(el);
      else el.setAttribute(k, String(v));
    }
  }

  for (const child of children.flat(Infinity)) {
    if (child == null || child === false) continue;
    el.append(typeof child === 'object' ? child : document.createTextNode(String(child)));
  }

  return el;
}

export function Fragment({ children }: { children?: any[] }): DocumentFragment {
  const frag = document.createDocumentFragment();
  for (const child of (children || []).flat(Infinity)) {
    if (child == null || child === false) continue;
    frag.append(typeof child === 'object' ? child : document.createTextNode(String(child)));
  }
  return frag;
}

declare global {
  namespace JSX {
    type Element = HTMLElement | DocumentFragment;
    interface IntrinsicElements {
      [tag: string]: any;
    }
  }
}
