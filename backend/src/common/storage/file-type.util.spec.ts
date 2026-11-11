import {
  checkUpload,
  detectFileType,
  extensionMatches,
  IMAGE_TYPES,
} from './file-type.util.js';

const bytes = (...values: number[]) => Buffer.from(values);
const text = (value: string) => Buffer.from(value, 'ascii');

describe('detectFileType', () => {
  it.each([
    ['jpg', bytes(0xff, 0xd8, 0xff, 0xe0, 0, 0)],
    ['png', bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0)],
    [
      'webp',
      Buffer.concat([text('RIFF'), bytes(1, 2, 3, 4), text('WEBPVP8 ')]),
    ],
    ['pdf', text('%PDF-1.7\n')],
  ])('recognizes %s', (extension, buffer) => {
    expect(detectFileType(buffer)?.extension).toBe(extension);
  });

  it.each([
    ['plain text', text('hello world')],
    ['Windows executable', text('MZ\x90\x00')],
    [
      'RIFF that is not WEBP',
      Buffer.concat([text('RIFF'), bytes(0, 0, 0, 0), text('WAVE')]),
    ],
    ['empty', Buffer.alloc(0)],
    ['truncated png', bytes(0x89, 0x50, 0x4e)],
  ])('rejects %s', (_label, buffer) => {
    expect(detectFileType(buffer)).toBeNull();
  });

  it('checks the declared extension against the content', () => {
    const pdf = detectFileType(text('%PDF-1.4'))!;
    expect(extensionMatches('receipt.pdf', pdf)).toBe(true);
    expect(extensionMatches('receipt.PDF', pdf)).toBe(true);
    expect(extensionMatches('receipt.png', pdf)).toBe(false);
    const jpg = detectFileType(bytes(0xff, 0xd8, 0xff))!;
    expect(extensionMatches('photo.jpeg', jpg)).toBe(true);
    expect(extensionMatches('photo', jpg)).toBe(true);
  });
});

describe('checkUpload', () => {
  const upload = (originalname: string, buffer: Buffer) => ({
    originalname,
    size: buffer.length,
    buffer,
  });
  const pdf = upload('labs.pdf', text('%PDF-1.4'));
  const png = upload(
    'cover.png',
    bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a),
  );

  it('accepts every supported type by default', () => {
    expect(checkUpload(pdf).type.extension).toBe('pdf');
  });

  it('limits the types when asked (images only)', () => {
    expect(checkUpload(png, IMAGE_TYPES).type.mimeType).toBe('image/png');
    expect(() => checkUpload(pdf, IMAGE_TYPES)).toThrow(
      'Only JPG, PNG or WEBP files are accepted',
    );
  });
});
