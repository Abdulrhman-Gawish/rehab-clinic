// Detects an uploaded file's real type from its first bytes ("magic bytes"):
// the client's file name and Content-Type are not trusted.

export interface DetectedType {
  extension: 'jpg' | 'png' | 'webp' | 'pdf';
  mimeType: string;
}

const startsWith = (buffer: Buffer, bytes: number[], offset = 0) =>
  buffer.length >= offset + bytes.length &&
  bytes.every((byte, i) => buffer[offset + i] === byte);

const ascii = (text: string) => [...text].map((c) => c.charCodeAt(0));

export function detectFileType(buffer: Buffer): DetectedType | null {
  if (startsWith(buffer, [0xff, 0xd8, 0xff])) {
    return { extension: 'jpg', mimeType: 'image/jpeg' };
  }
  if (startsWith(buffer, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return { extension: 'png', mimeType: 'image/png' };
  }
  if (
    startsWith(buffer, ascii('RIFF')) &&
    startsWith(buffer, ascii('WEBP'), 8)
  ) {
    return { extension: 'webp', mimeType: 'image/webp' };
  }
  if (startsWith(buffer, ascii('%PDF-'))) {
    return { extension: 'pdf', mimeType: 'application/pdf' };
  }
  return null;
}

const EXTENSIONS: Record<DetectedType['extension'], string[]> = {
  jpg: ['jpg', 'jpeg'],
  png: ['png'],
  webp: ['webp'],
  pdf: ['pdf'],
};

// The name's extension (if any) must agree with the detected content.
export function extensionMatches(
  fileName: string,
  detected: DetectedType,
): boolean {
  const dot = fileName.lastIndexOf('.');
  if (dot < 0) return true;
  return EXTENSIONS[detected.extension].includes(
    fileName.slice(dot + 1).toLowerCase(),
  );
}

export const MIME_BY_EXTENSION: Record<string, string> = {
  jpg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  pdf: 'application/pdf',
};
