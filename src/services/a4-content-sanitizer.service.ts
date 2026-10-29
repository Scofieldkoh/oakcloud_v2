import DOMPurify from 'dompurify';
import { JSDOM } from 'jsdom';
import {
  A4_EDITOR_DECORATION_ATTRIBUTES,
  getA4SanitizerPolicy,
  type TrustedRichOrigin,
} from '@/lib/a4-content-policy';

export interface SanitizeA4HtmlOptions {
  projection?: boolean;
}

/**
 * W3 server adapter for the frozen C06 allow-list. The trust decision is made
 * before this function (by the F resolver/canonical origin capability); this
 * adapter only normalizes allowed HTML. It never accepts a client trust flag.
 */
export function sanitizeCanonicalA4Html(
  content: string,
  options: SanitizeA4HtmlOptions = {},
): string {
  const window = new JSDOM('').window;
  const purify = DOMPurify(window);
  const policy = getA4SanitizerPolicy();
  const allowedAttributes = options.projection
    ? [...policy.allowedAttributes, ...A4_EDITOR_DECORATION_ATTRIBUTES]
    : policy.allowedAttributes;
  return purify.sanitize(content, {
    ALLOWED_TAGS: policy.allowedTags,
    ALLOWED_ATTR: allowedAttributes,
    ALLOW_DATA_ATTR: false,
    ALLOW_ARIA_ATTR: false,
    FORBID_TAGS: policy.rejectedTags,
  });
}

export function sanitizeTrustedA4RichContent(
  html: string,
  _origin: TrustedRichOrigin,
): string {
  return sanitizeCanonicalA4Html(html);
}
