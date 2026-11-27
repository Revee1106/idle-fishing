/**
 * SPIKE-ONLY canonical JSON for save payloads.
 * Rules (BE-000 experiment):
 * - object keys sorted by UTF-16 code unit (`a < b`), arrays keep order
 * - no undefined / NaN / Infinity / -0 / raw bigint (must be Nat strings) / -0
 * - forbidden keys: __proto__, prototype, constructor
 * - numbers must be finite; integers beyond 2^53 must use Nat strings
 */

const FORBIDDEN_KEYS = new Set(['__proto__', 'prototype', 'constructor']);
const MAX_DEPTH = 128;

export class CanonicalJsonError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CanonicalJsonError';
  }
}

export function isNat(value: unknown): value is string {
  return typeof value === 'string' && /^(0|[1-9][0-9]*)$/.test(value);
}

export function natFromBigInt(value: bigint): string {
  if (value < 0n) throw new CanonicalJsonError('Nat cannot be negative');
  return value.toString(10);
}

export function natToBigInt(value: string): bigint {
  if (!isNat(value)) throw new CanonicalJsonError(`Invalid Nat: ${JSON.stringify(value)}`);
  return BigInt(value);
}

export function canonicalStringify(value: unknown): string {
  const seen = new Set<object>();
  return write(value, 0, seen);
}

function write(value: unknown, depth: number, seen: Set<object>): string {
  if (depth > MAX_DEPTH) throw new CanonicalJsonError('Canonical JSON nesting too deep');
  if (value === null) return 'null';
  switch (typeof value) {
    case 'string':
      return JSON.stringify(value);
    case 'boolean':
      return value ? 'true' : 'false';
    case 'number':
      if (!Number.isFinite(value)) throw new CanonicalJsonError('Non-finite number');
      if (Object.is(value, -0)) throw new CanonicalJsonError('Negative zero is not allowed');
      if (!Number.isSafeInteger(value) && Number.isInteger(value)) {
        throw new CanonicalJsonError(`Unsafe integer must be a Nat string: ${value}`);
      }
      return JSON.stringify(value);
    case 'bigint':
      throw new CanonicalJsonError('Raw bigint must be encoded as a Nat string');
    case 'undefined':
      throw new CanonicalJsonError('undefined is not allowed');
    case 'function':
    case 'symbol':
      throw new CanonicalJsonError(`${typeof value} is not allowed`);
    default:
      break;
  }
  if (typeof value === 'object') {
    if (seen.has(value)) throw new CanonicalJsonError('Circular reference');
    seen.add(value);
    let out: string;
    if (Array.isArray(value)) {
      const parts: string[] = [];
      for (const item of value) parts.push(write(item, depth + 1, seen));
      out = `[${parts.join(',')}]`;
    } else {
      const record = value as Record<string, unknown>;
      const keys = Object.keys(record);
      for (const key of keys) {
        if (FORBIDDEN_KEYS.has(key)) throw new CanonicalJsonError(`Forbidden key: ${key}`);
      }
      keys.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
      const parts: string[] = [];
      for (const key of keys) {
        parts.push(`${JSON.stringify(key)}:${write(record[key], depth + 1, seen)}`);
      }
      out = `{${parts.join(',')}}`;
    }
    seen.delete(value);
    return out;
  }
  throw new CanonicalJsonError('Unsupported value');
}

/** UTF-8 encoder without TextEncoder (must run on Cocos/WeChat with no DOM). */
export function utf8Bytes(text: string): Uint8Array {
  const bytes: number[] = [];
  for (let i = 0; i < text.length; i++) {
    let code = text.charCodeAt(i);
    if (code < 0x80) {
      bytes.push(code);
    } else if (code < 0x800) {
      bytes.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
    } else if (code >= 0xd800 && code <= 0xdbff) {
      const next = i + 1 < text.length ? text.charCodeAt(i + 1) : 0;
      if (next < 0xdc00 || next > 0xdfff) throw new CanonicalJsonError('Lone high surrogate');
      const cp = 0x10000 + ((code - 0xd800) << 10) + (next - 0xdc00);
      i++;
      bytes.push(
        0xf0 | (cp >> 18),
        0x80 | ((cp >> 12) & 0x3f),
        0x80 | ((cp >> 6) & 0x3f),
        0x80 | (cp & 0x3f)
      );
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      throw new CanonicalJsonError('Lone low surrogate');
    } else {
      bytes.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
    }
  }
  return Uint8Array.from(bytes);
}

export function deepClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}