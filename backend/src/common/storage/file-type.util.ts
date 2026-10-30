import { BadRequestException } from '@nestjs/common';
import { ErrorCode, unprocessable } from '../errors/app.exception.js';

// Detects an uploaded file's real type from its first bytes ("magic bytes"):
// the client's file name and Content-Type are not trusted.

// Upload limit for every file (FileInterceptor answers 413 above it).
export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

// The parts of a multer memory-storage file we use.
export interface UploadedFileData {
  originalname: string;
  size: number;
  buffer: Buffer;
}

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

/**
 * The upload rule shared by every endpoint: a file must be present (400) and
 * be a real JPG, PNG, WEBP or PDF whose name agrees with its content (422).
 */
export function checkUpload(file: UploadedFileData | undefined): {
  file: UploadedFileData;
  type: DetectedType;
} {
  if (!file) throw new BadRequestException('A file is required (field "file")');
  const detected = detectFileType(file.buffer);
  if (!detected || !extensionMatches(file.originalname, detected)) {
    throw unprocessable(
      ErrorCode.UNSUPPORTED_FILE_TYPE,
      'Only JPG, PNG, WEBP or PDF files are accepted',
    );
  }
  return { file, type: detected };
}

// Mime type of a stored file, from the extension we gave its key.
export function mimeTypeOf(extension: string): string {
  return TYPES[extension as Extension]?.mimeType ?? 'application/octet-stream';
}
