// Detects an uploaded file's real type from its first bytes ("magic bytes"):
// the client's file name and Content-Type are not trusted.

const TYPES = {
  jpg: { mimeType: 'image/jpeg', names: ['jpg', 'jpeg'] },
  png: { mimeType: 'image/png', names: ['png'] },
  webp: { mimeType: 'image/webp', names: ['webp'] },
  pdf: { mimeType: 'application/pdf', names: ['pdf'] },
} as const;

type Extension = keyof typeof TYPES;

export interface DetectedType {
  extension: Extension;
  mimeType: string;
}

const startsWith = (buffer: Buffer, bytes: number[], offset = 0) =>
  buffer.length >= offset + bytes.length &&
  bytes.every((byte, i) => buffer[offset + i] === byte);

const ascii = (text: string) => [...text].map((c) => c.charCodeAt(0));

function detectExtension(buffer: Buffer): Extension | null {
  if (startsWith(buffer, [0xff, 0xd8, 0xff])) return 'jpg';
  if (startsWith(buffer, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return 'png';
  }
  if (
    startsWith(buffer, ascii('RIFF')) &&
    startsWith(buffer, ascii('WEBP'), 8)
  ) {
    return 'webp';
  }
  if (startsWith(buffer, ascii('%PDF-'))) return 'pdf';
  return null;
}

export function detectFileType(buffer: Buffer): DetectedType | null {
  const extension = detectExtension(buffer);
  return extension && { extension, mimeType: TYPES[extension].mimeType };
}

// The name's extension (if any) must agree with the detected content.
export function extensionMatches(
  fileName: string,
  detected: DetectedType,
): boolean {
  const dot = fileName.lastIndexOf('.');
  if (dot < 0) return true;
  const name = fileName.slice(dot + 1).toLowerCase();
  return (TYPES[detected.extension].names as readonly string[]).includes(name);
}

// Mime type of a stored file, from the extension we gave its key.
export function mimeTypeOf(extension: string): string {
  return TYPES[extension as Extension]?.mimeType ?? 'application/octet-stream';
}
