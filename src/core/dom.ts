// DOM helpers that work with both @xmldom/xmldom and the browser DOM.

export const nameOf = (el: Element) => el.localName || el.nodeName;
export const attr = (el: Element, name: string): string | null => (el.hasAttribute?.(name) ? el.getAttribute(name) : null);
export const children = (el: Node) => Array.from(el.childNodes || []).filter((n): n is Element => n.nodeType === 1);
export const parentElement = (el: Element): Element | null => {
  const p = el.parentNode;
  return p && p.nodeType === 1 ? (p as Element) : null;
};
const XLINK = 'http://www.w3.org/1999/xlink';
export const hrefOf = (el: Element) => attr(el, 'href') ?? el.getAttributeNS?.(XLINK, 'href') ?? attr(el, 'xlink:href');
