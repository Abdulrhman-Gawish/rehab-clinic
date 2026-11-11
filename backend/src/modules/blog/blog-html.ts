import sanitizeHtml from 'sanitize-html';

// What the staff editor (Quill, "snow" toolbar) produces: headings, bold,
// italic, underline, strike, lists, alignment / direction / indent classes
// and links. Everything else (scripts, styles, event handlers, images,
// iframes, other attributes) is removed on every write.
const QUILL_CLASSES = [
  /^ql-align-(left|center|right|justify)$/,
  'ql-direction-rtl',
  /^ql-indent-[1-8]$/,
];

const SAFE_HREF = /^(https?:|mailto:)/i;

const OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: [
    'p',
    'br',
    'h1',
    'h2',
    'h3',
    'strong',
    'b',
    'em',
    'i',
    'u',
    's',
    'ol',
    'ul',
    'li',
    'a',
  ],
  allowedAttributes: { a: ['href', 'rel', 'target'] },
  allowedClasses: {
    p: QUILL_CLASSES,
    h1: QUILL_CLASSES,
    h2: QUILL_CLASSES,
    h3: QUILL_CLASSES,
    li: QUILL_CLASSES,
  },
  allowedSchemes: ['http', 'https', 'mailto'],
  allowedSchemesByTag: {},
  allowProtocolRelative: false,
  // Links always open in a new tab without access to this page. Relative
  // and other hrefs are dropped (the text stays).
  transformTags: {
    a: (tagName, attribs) => {
      const href = attribs.href?.trim();
      return {
        tagName,
        attribs: {
          ...(href && SAFE_HREF.test(href) && { href }),
          rel: 'noopener noreferrer',
          target: '_blank',
        },
      };
    },
  },
};

const TEXT_ONLY: sanitizeHtml.IOptions = {
  allowedTags: [],
  allowedAttributes: {},
};

/**
 * The post's HTML reduced to the allowlist above. Returns '' when nothing
 * readable is left (only tags, line breaks or spaces), so "required" checks
 * reject an empty editor (`<p><br></p>`).
 */
export function sanitizeBlogHtml(html: string): string {
  const clean = sanitizeHtml(html, OPTIONS).trim();
  const text = sanitizeHtml(clean, TEXT_ONLY).replaceAll('&nbsp;', ' ');
  return text.trim() === '' ? '' : clean;
}
