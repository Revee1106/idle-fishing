/**
 * Fault-injecting wrapper around any FilePort for T04/T05 persistence recovery tests.
 * Supports:
 * - PRE_WRITE_ERROR: fail before mutating target slot
 * - PARTIAL_WRITE: write truncated bytes then throw
 * - POST_WRITE_THROW: write complete valid bytes then throw (uncertain write -> rescan must claim)
 * - READ_ERROR: throw IO error on read of a specific path
 */
import type { FilePort, StorageProbeResult } from './PlatformTypes';
import { FilePortIoError } from './WeChatFilePort';

export type WriteFaultMode = 'NONE' | 'PRE_WRITE_ERROR' | 'PARTIAL_WRITE' | 'POST_WRITE_THROW';

export class FaultInjectingFilePort implements FilePort {
  readonly kind = 'FAULT_WRAPPER' as const;
  private readonly inner: FilePort;
  private nextWriteFault: WriteFaultMode = 'NONE';
  private writeInterceptor: ((path: string, text: string) => Promise<void>) | null = null;
  private readonly failingReadPaths = new Set<string>();
  readonly trace: string[] = [];

  constructor(inner: FilePort) {
    this.inner = inner;
  }

  get storageKey(): string | undefined {
    return this.inner.storageKey;
  }

  probeStorage(): StorageProbeResult | Promise<StorageProbeResult> {
    if (typeof this.inner.probeStorage === 'function') {
      return this.inner.probeStorage();
    }
    return { available: true, reason: null };
  }

  setWriteInterceptor(fn: ((path: string, text: string) => Promise<void>) | null): void {
    this.writeInterceptor = fn;
  }

  armNextWriteFault(mode: WriteFaultMode): void {
    this.nextWriteFault = mode;
  }

  setReadFault(path: string, enabled: boolean): void {
    if (enabled) this.failingReadPaths.add(path);
    else this.failingReadPaths.delete(path);
  }

  async read(path: string): Promise<string | null> {
    if (this.failingReadPaths.has(path)) {
      this.trace.push(`READ_FAULT:${path}`);
      throw new FilePortIoError('INJECTED_READ_IO', path, 'Simulated read IO failure');
    }
    return this.inner.read(path);
  }

  async write(path: string, text: string): Promise<void> {
    if (this.writeInterceptor) {
      await this.writeInterceptor(path, text);
    }
    const mode = this.nextWriteFault;
    this.nextWriteFault = 'NONE';
    if (mode === 'PRE_WRITE_ERROR') {
      this.trace.push(`PRE_WRITE_ERROR:${path}`);
      throw new FilePortIoError('INJECTED_PRE_WRITE', path, 'Simulated failure before write');
    }
    if (mode === 'PARTIAL_WRITE') {
      this.trace.push(`PARTIAL_WRITE:${path}`);
      const cut = Math.max(1, Math.floor(text.length / 3));
      await this.inner.write(path, text.slice(0, cut));
      throw new FilePortIoError('INJECTED_PARTIAL_WRITE', path, 'Simulated truncated write crash');
    }
    if (mode === 'POST_WRITE_THROW') {
      this.trace.push(`POST_WRITE_THROW:${path}`);
      await this.inner.write(path, text);
      throw new FilePortIoError('INJECTED_POST_WRITE', path, 'Simulated uncertain write after disk commit');
    }
    this.trace.push(`WRITE_OK:${path}`);
    return this.inner.write(path, text);
  }

  async remove(path: string): Promise<void> {
    return this.inner.remove(path);
  }

  async list(dir?: string): Promise<string[]> {
    return this.inner.list(dir);
  }
}
