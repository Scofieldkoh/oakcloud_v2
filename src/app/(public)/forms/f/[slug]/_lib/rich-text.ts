/** Rich text helpers: HTML detection, plain text, search highlighting and guidance sanitising. */

import DOMPurify from 'dompurify';

export function hasHtmlMarkup(value: string): boolean {
  return /<\/?[a-z][\s\S]*>/i.test(value);
}

export function decodeHtmlEntities(value: string): string {
  if (typeof document === 'undefined') {
    return value
      .replace(/&nbsp;/gi, ' ')
      .replace(/&lt;/gi, '<')
      .replace(/&gt;/gi, '>')
      .replace(/&amp;/gi, '&')
      .replace(/&quot;/gi, '"')
      .replace(/&#39;/gi, "'");
  }

  const textarea = document.createElement('textarea');
  textarea.innerHTML = value;
  return textarea.value;
}

export function richTextToPlainText(value: string): string {
  const decoded = decodeHtmlEntities(value || '');
  return decoded
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function highlightRichTextHtml(value: string, searchTerm: string): string {
  const sanitized = DOMPurify.sanitize(value || '');
  const trimmedTerm = searchTerm.trim();
  if (!trimmedTerm) return sanitized;

  if (typeof document === 'undefined') return sanitized;

  const template = document.createElement('template');
  template.innerHTML = sanitized;
  const matcher = new RegExp(escapeRegExp(trimmedTerm), 'gi');
  const walker = document.createTreeWalker(template.content, NodeFilter.SHOW_TEXT);
  const textNodes: Text[] = [];

  while (walker.nextNode()) {
    if (walker.currentNode.textContent?.match(matcher)) {
      textNodes.push(walker.currentNode as Text);
    }
  }

  for (const textNode of textNodes) {
    const text = textNode.textContent || '';
    const fragment = document.createDocumentFragment();
    let lastIndex = 0;
    text.replace(matcher, (match, offset: number) => {
      if (offset > lastIndex) {
        fragment.appendChild(document.createTextNode(text.slice(lastIndex, offset)));
      }
      const mark = document.createElement('mark');
      mark.className = 'rounded bg-status-warning/25 px-0.5 text-inherit';
      mark.textContent = match;
      fragment.appendChild(mark);
      lastIndex = offset + match.length;
      return match;
    });
    if (lastIndex < text.length) {
      fragment.appendChild(document.createTextNode(text.slice(lastIndex)));
    }
    textNode.parentNode?.replaceChild(fragment, textNode);
  }

  const container = document.createElement('div');
  container.appendChild(template.content.cloneNode(true));
  return container.innerHTML;
}

/** Rich-text guidance (links, emphasis) in field hints; links open in a new tab. */
export function sanitizeGuidanceHtml(value: string): string {
  const html = DOMPurify.sanitize(value, { ADD_ATTR: ['target'] });
  return html.replace(/<a (?![^>]*target=)/g, '<a target="_blank" rel="noopener noreferrer" ');
}
