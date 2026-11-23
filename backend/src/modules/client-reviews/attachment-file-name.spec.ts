import {
  cleanAttachmentName,
  contentDisposition,
} from './attachment-file-name.js';
import { REVIEW_FILE_NAME_MAX } from './client-reviews.constants.js';

describe('cleanAttachmentName', () => {
  it('keeps a normal name, Arabic included', () => {
    expect(cleanAttachmentName('رسالة المريض.png', 'png')).toBe(
      'رسالة المريض.png',
    );
  });

  it('keeps only the last path segment', () => {
    expect(cleanAttachmentName('C:\\Users\\x\\scan.pdf', 'pdf')).toBe(
      'scan.pdf',
    );
    expect(cleanAttachmentName('../../etc/passwd.png', 'png')).toBe(
      'passwd.png',
    );
  });

  it('drops control and bidi characters, collapses whitespace', () => {
    expect(cleanAttachmentName('photo\u202Egnp.pdf', 'pdf')).toBe(
      'photognp.pdf',
    );
    expect(cleanAttachmentName('  a\n\tb   c.jpg ', 'jpg')).toBe('a b c.jpg');
  });

  it('falls back to attachment.<extension> when nothing is left', () => {
    expect(cleanAttachmentName('', 'png')).toBe('attachment.png');
    expect(cleanAttachmentName('\u202E\u0000', 'pdf')).toBe('attachment.pdf');
    expect(cleanAttachmentName('dir/..', 'jpg')).toBe('attachment.jpg');
  });

  it('shortens long names and keeps the extension', () => {
    const long = `${'ع'.repeat(300)}.webp`;
    const cleaned = cleanAttachmentName(long, 'webp');
    expect([...cleaned]).toHaveLength(REVIEW_FILE_NAME_MAX);
    expect(cleaned.endsWith('.webp')).toBe(true);
  });

  it('never splits a surrogate pair', () => {
    const cleaned = cleanAttachmentName('😀'.repeat(250), 'png');
    expect([...cleaned]).toHaveLength(REVIEW_FILE_NAME_MAX);
    expect(cleaned).toBe('😀'.repeat(REVIEW_FILE_NAME_MAX));
  });
});

describe('contentDisposition', () => {
  it('percent-encodes the real name next to an ASCII fallback', () => {
    expect(contentDisposition('a1.pdf', 'تقرير (1)\'s".pdf')).toBe(
      `inline; filename="a1.pdf"; filename*=UTF-8''${encodeURIComponent('تقرير')}%20%281%29%27s%22.pdf`,
    );
  });

  it('cannot inject header lines', () => {
    expect(contentDisposition('a.png', 'x\r\nSet-Cookie: y')).not.toMatch(
      /[\r\n]/,
    );
  });
});
