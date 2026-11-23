import { REVIEW_FILE_NAME_MAX } from './client-reviews.constants.js';

// Control characters, and the bidi marks and overrides that can disguise an
// extension (with U+202E, "photo<U+202E>gnp.pdf" shows as "photofdp.png").
function isUnsafe(char: string): boolean {
  const code = char.codePointAt(0) ?? 0;
  return (
    code < 0x20 ||
    code === 0x7f ||
    code === 0x200e ||
    code === 0x200f ||
    (code >= 0x202a && code <= 0x202e) ||
    (code >= 0x2066 && code <= 0x2069)
  );
}

/**
 * The name an uploaded file is shown under. Only for display: files are
 * stored under a generated key. Keeps the last path segment, drops control
 * and bidi characters, collapses whitespace and shortens long names (the
 * extension kept). Nothing left: `attachment.<extension>`.
 */
export function cleanAttachmentName(name: string, extension: string): string {
  const base = name.split(/[\\/]/).pop() ?? '';
  // Whitespace (tabs and newlines too) becomes one space before the other
  // control characters are dropped, so words never run together.
  const cleaned = Array.from(base.replace(/\s+/g, ' '))
    .filter((char) => !isUnsafe(char))
    .join('')
    .replace(/ {2,}/g, ' ')
    .trim();
  if (!cleaned || cleaned === '.' || cleaned === '..') {
    return `attachment.${extension}`;
  }
  // Code points, so a cut never splits a surrogate pair.
  const chars = [...cleaned];
  if (chars.length <= REVIEW_FILE_NAME_MAX) return cleaned;
  const dot = cleaned.lastIndexOf('.');
  const suffix =
    dot > 0 && cleaned.length - dot <= 10 ? Array.from(cleaned.slice(dot)) : [];
  return (
    chars.slice(0, REVIEW_FILE_NAME_MAX - suffix.length).join('') +
    suffix.join('')
  );
}

// Content-Disposition for streaming: an ASCII fallback name plus the real
// name percent-encoded (RFC 6266 / 8187), so no header injection is possible.
export function contentDisposition(fallback: string, fileName: string): string {
  const encoded = encodeURIComponent(fileName).replace(
    /['()*!]/g,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `inline; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}
