import { createReadStream } from 'node:fs';
import { mkdir, stat, writeFile } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import type { Readable } from 'node:stream';
import { Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { EnvironmentVariables } from '../../config/env.validation.js';

/**
 * Private file storage. Files are only ever served through authorized
 * endpoints, never publicly. Bind another implementation (e.g. S3) to
 * STORAGE_SERVICE to change the backend.
 */
export const STORAGE_SERVICE = Symbol('STORAGE_SERVICE');

export interface StoredFile {
  stream: Readable;
  size: number;
}

export interface StorageService {
  put(key: string, data: Buffer): Promise<void>;
  get(key: string): Promise<StoredFile>;
}

// Keys are generated server-side; this also blocks path traversal.
const SAFE_KEY = /^[a-z0-9][a-z0-9/_.-]*$/i;

@Injectable()
export class LocalDiskStorageService implements StorageService {
  private readonly root: string;

  constructor(config: ConfigService<EnvironmentVariables, true>) {
    this.root = resolve(config.get('STORAGE_LOCAL_PATH', { infer: true }));
  }

  async put(key: string, data: Buffer): Promise<void> {
    const path = this.pathFor(key);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, data, { flag: 'wx' });
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
