// Just enough CSS for SVG files: <style> rules, @font-face, and selectors for matching elements.
//
// Selectors: type, *, #id, .class, [attr], [attr=value], [attr~=value], [attr^=value], [attr$=value], [attr*=value],
// :not(<compound>), :first-child, :last-child, descendant (space) and child (>) combinators, comma lists.

interface AttrTest { name: string; op: string; value: string }
interface Compound {
  tag: string | null;
  id: string | null;
  classes: string[];
  attrs: AttrTest[];
  not: Compound[];
  pseudo: string[];
}
/** Compounds right-to-left; combinators[i] joins compounds[i] to compounds[i + 1] (' ' or '>'). */
export interface Complex { compounds: Compound[]; combinators: string[]; specificity: number }

export interface Rule { selectors: Complex[]; decls: Record<string, string>; order: number }
export interface FontFace { family: string; weight: number; style: string; src: string }
export interface Stylesheet { rules: Rule[]; fontFaces: FontFace[] }

const nameOf = (el: Element) => el.localName || el.nodeName;
const parentElement = (el: Element): Element | null => {
  const p = el.parentNode;
  return p && p.nodeType === 1 ? (p as Element) : null;
};
const elementChildren = (el: Node) => Array.from(el.childNodes || []).filter((n): n is Element => n.nodeType === 1);

function parseCompound(src: string): { compound: Compound; rest: string } {
  const c: Compound = { tag: null, id: null, classes: [], attrs: [], not: [], pseudo: [] };
  let s = src;
  const ident = /^-?[_a-zA-Z -￿][-_a-zA-Z0-9 -￿]*/;
  let m: RegExpExecArray | null;
  if ((m = /^(\*|[-_a-zA-Z][-_a-zA-Z0-9]*)/.exec(s))) {
    if (m[1] !== '*') c.tag = m[1].replace(/^.*\|/, '');
    s = s.slice(m[0].length);
  }
  while (s.length) {
    if (s[0] === '#' && (m = ident.exec(s.slice(1)))) { c.id = m[0]; s = s.slice(1 + m[0].length); }
    else if (s[0] === '.' && (m = ident.exec(s.slice(1)))) { c.classes.push(m[0]); s = s.slice(1 + m[0].length); }
    else if (s[0] === '[' && (m = /^\[\s*([-_a-zA-Z:]+)\s*(?:([~^$*|]?=)\s*(?:"([^"]*)"|'([^']*)'|([^\]\s]+)))?\s*\]/.exec(s))) {
      c.attrs.push({ name: m[1], op: m[2] || '', value: m[3] ?? m[4] ?? m[5] ?? '' });
      s = s.slice(m[0].length);
    } else if ((m = /^:not\(([^)]*)\)/.exec(s))) {
      for (const part of m[1].split(',')) c.not.push(parseCompound(part.trim()).compound);
      s = s.slice(m[0].length);
    } else if ((m = /^::?([-a-z]+)/.exec(s))) { c.pseudo.push(m[1]); s = s.slice(m[0].length); }
    else break;
  }
  return { compound: c, rest: s };
}

function specificityOf(compounds: Compound[]): number {
  let a = 0, b = 0, c = 0;
  const add = (x: Compound) => {
    if (x.id) a++;
    b += x.classes.length + x.attrs.length + x.pseudo.length;
    if (x.tag) c++;
    x.not.forEach(add);
  };
  compounds.forEach(add);
  return a * 10000 + b * 100 + c;
}

/** Parses a selector list. Returns null for selectors that use unsupported syntax. */
export function parseSelector(src: string): Complex[] | null {
  const out: Complex[] = [];
  for (const part of src.split(',')) {
    let s = part.trim();
    if (!s) return null;
    const compounds: Compound[] = [], combinators: string[] = [];
    while (s.length) {
      const { compound, rest } = parseCompound(s);
      if (rest === s) return null;
      compounds.push(compound);
      const m = /^\s*([>+~])?\s*/.exec(rest)!;
      s = rest.slice(m[0].length);
      if (s.length) {
        if (m[1] === '+' || m[1] === '~') return null;
        combinators.push(m[1] ? '>' : ' ');
      }
    }
    compounds.reverse();
    combinators.reverse();
    out.push({ compounds, combinators, specificity: specificityOf(compounds) });
  }
  return out;
}

function matchesCompound(el: Element, c: Compound): boolean {
  if (c.tag && nameOf(el) !== c.tag) return false;
  if (c.id && el.getAttribute('id') !== c.id) return false;
  if (c.classes.length) {
    const cls = (el.getAttribute('class') || '').split(/\s+/);
    if (!c.classes.every((k) => cls.includes(k))) return false;
  }
  for (const t of c.attrs) {
    if (!el.hasAttribute(t.name)) return false;
    const v = el.getAttribute(t.name) || '';
    if (t.op === '=' && v !== t.value) return false;
    if (t.op === '~=' && !v.split(/\s+/).includes(t.value)) return false;
    if (t.op === '^=' && !v.startsWith(t.value)) return false;
    if (t.op === '$=' && !v.endsWith(t.value)) return false;
    if (t.op === '*=' && !v.includes(t.value)) return false;
    if (t.op === '|=' && v !== t.value && !v.startsWith(t.value + '-')) return false;
  }
  for (const n of c.not) if (matchesCompound(el, n)) return false;
  for (const p of c.pseudo) {
    const siblings = parentElement(el) ? elementChildren(parentElement(el)!) : [el];
    if (p === 'first-child' && siblings[0] !== el) return false;
    else if (p === 'last-child' && siblings[siblings.length - 1] !== el) return false;
    else if (p !== 'first-child' && p !== 'last-child') return false; // :hover etc. never match in print
  }
  return true;
}

function matchesFrom(el: Element, sel: Complex, i: number): boolean {
  if (!matchesCompound(el, sel.compounds[i])) return false;
  if (i === sel.compounds.length - 1) return true;
  let p = parentElement(el);
  if (sel.combinators[i] === '>') return !!p && matchesFrom(p, sel, i + 1);
  for (; p; p = parentElement(p)) if (matchesFrom(p, sel, i + 1)) return true;
  return false;
}

export function matches(el: Element, selectors: Complex[]): boolean {
  return selectors.some((s) => matchesFrom(el, s, 0));
}

/** Parses "a: b; c: d" declarations (as in a style attribute). */
export function parseDeclarations(src: string): Record<string, string> {
  const out: Record<string, string> = {};
  // split on ; outside of parentheses and quotes (data: URIs contain ;)
  let depth = 0, quote = '', start = 0;
  const parts: string[] = [];
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quote) { if (ch === quote) quote = ''; }
    else if (ch === '"' || ch === "'") quote = ch;
    else if (ch === '(') depth++;
    else if (ch === ')') depth--;
    else if (ch === ';' && depth === 0) { parts.push(src.slice(start, i)); start = i + 1; }
  }
  parts.push(src.slice(start));
  for (const decl of parts) {
    const k = decl.indexOf(':');
    if (k < 0) continue;
    const name = decl.slice(0, k).trim().toLowerCase();
    const value = decl.slice(k + 1).replace(/!important\s*$/, '').trim();
    if (name && value) out[name] = value;
  }
  return out;
}

const WEIGHTS: Record<string, number> = { normal: 400, bold: 700, lighter: 300, bolder: 700 };
export const parseWeight = (v: string | undefined): number => (v ? WEIGHTS[v.trim()] ?? (parseInt(v) || 400) : 400);

/** Splits a stylesheet into rules and @font-face blocks; other at-rules are skipped. */
export function parseStylesheet(text: string, warn: (code: string, msg: string) => void = () => {}): Stylesheet {
  const src = text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/<!\[CDATA\[|\]\]>/g, '');
  const rules: Rule[] = [], fontFaces: FontFace[] = [];
  let i = 0, order = 0;
  const readBlock = (from: number): [string, number] => {
    // from points at "{"; returns the content and the index after the matching "}"
    let depth = 0, quote = '';
    for (let j = from; j < src.length; j++) {
      const ch = src[j];
      if (quote) { if (ch === quote) quote = ''; continue; }
      if (ch === '"' || ch === "'") quote = ch;
      else if (ch === '{') depth++;
      else if (ch === '}' && --depth === 0) return [src.slice(from + 1, j), j + 1];
    }
    return [src.slice(from + 1), src.length];
  };
  while (i < src.length) {
    const open = src.indexOf('{', i);
    const semi = src.indexOf(';', i);
    if (src.slice(i).trimStart().startsWith('@') && semi >= 0 && (open < 0 || semi < open)) { i = semi + 1; continue; } // @import, @charset
    if (open < 0) break;
    const prelude = src.slice(i, open).trim();
    const [body, next] = readBlock(open);
    i = next;
    if (prelude.startsWith('@font-face')) {
      const d = parseDeclarations(body);
      if (d['font-family'] && d.src) {
        fontFaces.push({ family: d['font-family'].replace(/["']/g, '').trim(), weight: parseWeight(d['font-weight']), style: d['font-style'] || 'normal', src: d.src });
      }
    } else if (prelude.startsWith('@')) {
      warn('css-at-rule', `CSS ${prelude.split(/\s/)[0]} block ignored`);
    } else {
      const selectors = parseSelector(prelude);
      if (!selectors) { warn('css-selector', `Unsupported CSS selector "${prelude}" ignored`); continue; }
      rules.push({ selectors, decls: parseDeclarations(body), order: order++ });
    }
  }
  return { rules, fontFaces };
}
