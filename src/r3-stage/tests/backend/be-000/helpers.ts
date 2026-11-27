import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { SpikeFilePort } from '../../../packages/game-core/src/spike/index.ts';

export type WriteBehavior =
  | { kind: 'OK' }
  | { kind: 'THROW_BEFORE' }
  | { kind: 'PARTIAL_THEN_THROW' }
  | { kind: 'WRITE_THEN_THROW' }
  | { kind: 'SILENT_TRUNCATE' };

export class MemoryFilePort implements SpikeFilePort {
  readonly files = new Map<string, string>();
  readonly readErrors = new Map<string, string>();
  writeBehavior: ((path: string, text: string) => WriteBehavior) | null = null;
  writeCount = 0;

  async read(path: string): Promise<string | null> {
    const injected = this.readErrors.get(path);
    if (injected !== undefined) {
      throw new Error(`injected read failure: ${injected}`);
    }
    return this.files.has(path) ? (this.files.get(path) as string) : null;
  }

  async write(path: string, text: string): Promise<void> {
    this.writeCount += 1;
    const behavior = this.writeBehavior?.(path, text) ?? { kind: 'OK' };
    switch (behavior.kind) {
      case 'THROW_BEFORE':
        throw new Error('injected write failure before any bytes');
      case 'PARTIAL_THEN_THROW':
        this.files.set(path, text.slice(0, Math.max(1, Math.floor(text.length / 2))));
        throw new Error('injected write failure after partial bytes');
      case 'WRITE_THEN_THROW':
        this.files.set(path, text);
        throw new Error('injected write failure after full write');
      case 'SILENT_TRUNCATE':
        this.files.set(path, text.slice(0, Math.max(1, Math.floor(text.length / 2))));
        return;
      case 'OK':
        this.files.set(path, text);
        return;
    }
  }

  async remove(path: string): Promise<void> {
    this.files.delete(path);
  }

  async list(prefix: string): Promise<string[]> {
    return [...this.files.keys()].filter((path) => path.startsWith(prefix)).sort();
  }
}

export class NodeTempFilePort implements SpikeFilePort {
  readonly dir: string;

  constructor(dir: string) {
    this.dir = dir;
  }

  private full(path: string): string {
    return join(this.dir, path);
  }

  async read(path: string): Promise<string | null> {
    try {
      return await readFile(this.full(path), 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return null;
      }
      throw error;
    }
  }

  async write(path: string, text: string): Promise<void> {
    await writeFile(this.full(path), text, 'utf8');
  }

  async remove(path: string): Promise<void> {
    await rm(this.full(path), { force: true });
  }

  async list(prefix: string): Promise<string[]> {
    const names = await readdir(this.dir);
    return names.filter((name) => name.startsWith(prefix)).sort();
  }
}

export async function createTempPort(): Promise<{ port: NodeTempFilePort; cleanup: () => Promise<void> }> {
  const dir = await mkdtemp(join(tmpdir(), 'idle-fishing-be000-'));
  return {
    port: new NodeTempFilePort(dir),
    cleanup: () => rm(dir, { recursive: true, force: true }),
  };
}