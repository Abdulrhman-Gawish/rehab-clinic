import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Logger } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { EnvironmentVariables } from '../../config/env.validation.js';
import { FileStorage } from './file-storage.service.js';

describe('FileStorage', () => {
  let root: string;
  let storage: FileStorage;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'file-storage-'));
    storage = new FileStorage({
      get: () => root,
    } as unknown as ConfigService<EnvironmentVariables, true>);
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('puts, lists and deletes a file; delete is idempotent', async () => {
    await storage.put('patients/p1/a.png', Buffer.from('x'));
    expect((await storage.list('patients/')).map((f) => f.key)).toEqual([
      'patients/p1/a.png',
    ]);
    await storage.delete('patients/p1/a.png');
    await storage.delete('patients/p1/a.png');
    expect(await storage.list('patients/')).toEqual([]);
    await expect(storage.get('patients/p1/a.png')).rejects.toThrow(
      'File not found',
    );
  });

  it('never overwrites an existing file and leaves it intact', async () => {
    await storage.put('expenses/e1/r.png', Buffer.from('original'));
    await expect(
      storage.put('expenses/e1/r.png', Buffer.from('other')),
    ).rejects.toMatchObject({ code: 'EEXIST' });
    const { stream } = await storage.get('expenses/e1/r.png');
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(chunk as Buffer);
    expect(Buffer.concat(chunks).toString()).toBe('original');
  });

  it('discard never throws: a failed cleanup is logged so the caller keeps its own error', async () => {
    const warn = vi
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => {});
    // A non-empty directory where the file should be: rm fails.
    await mkdir(join(root, 'patients/p1/stuck.png'), { recursive: true });
    await writeFile(join(root, 'patients/p1/stuck.png/inner'), 'x');

    await expect(storage.discard('patients/p1/stuck.png')).resolves.toBe(
      undefined,
    );
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('patients/p1/stuck.png'),
    );
    warn.mockRestore();
  });

  it('rejects keys and prefixes outside the root', async () => {
    await expect(storage.put('../x.png', Buffer.from('x'))).rejects.toThrow(
      'Unsafe storage key',
    );
    await expect(storage.list('../')).rejects.toThrow('escapes the root');
    expect(await storage.list('nothing-here/')).toEqual([]);
  });
});
