import { createReadStream } from 'node:fs';
import { mkdir, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, relative, resolve, sep } from 'node:path';
import type { Readable } from 'node:stream';
import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { EnvironmentVariables } from '../../config/env.validation.js';

export interface StoredFile {
  stream: Readable;
  size: number;
}

export interface StoredKey {
  key: string;
  modifiedAt: Date;
}

// Keys are generated server-side; this also blocks path traversal.
const SAFE_KEY = /^[a-z0-9][a-z0-9/_.-]*$/i;

/**
 * Private files on local disk under STORAGE_LOCAL_PATH (expense receipts,
 * patient attachments). Files are only ever streamed through authorized
 * endpoints, never served statically.
 *
 * A file is written before the transaction that records it commits. Callers
 * use a fresh random key per upload and `discard` it when the transaction
 * fails, so a rollback leaves no file behind. A crash between the two
 * steps can still leave one: see `npm run storage:orphans`.
 */
@Injectable()
export class FileStorage {
  private readonly logger = new Logger(FileStorage.name);
  private readonly root: string;

  constructor(config: ConfigService<EnvironmentVariables, true>) {
    this.root = resolve(config.get('STORAGE_LOCAL_PATH', { infer: true }));
  }

  // Never overwrites ('wx'). A failed write removes what it left behind.
  async put(key: string, data: Buffer): Promise<void> {
    const path = this.pathFor(key);
    await mkdir(dirname(path), { recursive: true });
    try {
      await writeFile(path, data, { flag: 'wx' });
    } catch (error) {
      // EEXIST: the file belongs to someone else; leave it alone.
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
        await rm(path, { force: true }).catch(() => undefined);
      }
      throw error;
    }
  }

  // Idempotent: a missing file is not an error.
  async delete(key: string): Promise<void> {
    await rm(this.pathFor(key), { force: true });
  }

  /**
   * Removes the file of an upload whose transaction failed. Never throws, so
   * the caller rethrows the original error; a failed cleanup is logged and
   * leaves an orphan for the sweep.
   */
  async discard(key: string): Promise<void> {
    try {
      await this.delete(key);
    } catch (error) {
      this.logger.warn(
        `Could not remove ${key} after a failed upload: ${String(error)}`,
      );
    }
  }

  async get(key: string): Promise<StoredFile> {
    const path = this.pathFor(key);
    try {
      const { size } = await stat(path);
      return { stream: createReadStream(path), size };
    } catch {
      throw new NotFoundException('File not found');
    }
  }

  // Every stored file under `prefix` (e.g. 'patients/'), for the orphan sweep.
  async list(prefix: string): Promise<StoredKey[]> {
    const dir = resolve(this.root, prefix);
    if (!dir.startsWith(this.root + sep)) {
      throw new Error(`Storage prefix escapes the root: ${prefix}`);
    }
    let entries;
    try {
      entries = await readdir(dir, { recursive: true, withFileTypes: true });
    } catch {
      return []; // nothing stored yet
    }
    const keys: StoredKey[] = [];
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      const path = resolve(entry.parentPath, entry.name);
      const { mtime } = await stat(path);
      keys.push({
        key: relative(this.root, path).split(sep).join('/'),
        modifiedAt: mtime,
      });
    }
    return keys;
  }

  private pathFor(key: string): string {
    if (!SAFE_KEY.test(key) || key.includes('..')) {
      throw new Error(`Unsafe storage key: ${key}`);
    }
    const path = resolve(this.root, key);
    if (!path.startsWith(this.root + sep)) {
      throw new Error(`Storage key escapes the root: ${key}`);
    }
    return path;
  }
}
