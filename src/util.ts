import fs = require("fs");
import util = require("util");

export function align(value: number, alignment: number) {
  const mask = alignment - 1;
  if (alignment & mask) {
    return error("invalid alignment, must be a power of 2: %O", alignment);
  }
  return (value + mask) & ~mask;
}

export function pad(string: string, maxLength: number, fillString: string) {
  return string
    .padStart(maxLength >> 1, fillString)
    .padEnd(maxLength, fillString);
}

export function formatAddressRange(range: AddressRange) {
  return util.format(
    "%s-%s (%s)",
    hex(range.address, 8),
    hex(range.end, 8),
    bytes(range.size),
  );
}

export function formatFileRange(range: FileRange) {
  return util.format(
    "%s-%s",
    hex(range.offset, 8),
    hex(range.end, 8),
    bytes(range.size),
  );
}

export function hex(value: any, size = 0) {
  return typeof value === "number"
    ? value.toString(16).padStart(size, "0")
    : util.inspect(value);
}

const bytesSuffixes = [" bytes", "kB", "MB", "GB", "TB"];
export function bytes(value: number) {
  let index = 0;
  while (index < bytesSuffixes.length && value >= 1024) {
    index += 1;
    value /= 1024;
  }
  return (index ? value.toPrecision(3) : value) + bytesSuffixes[index];
}

export function sortedBy<T>(
  source: readonly T[],
  selectorOrKey: keyof T | ((item: T) => any),
) {
  const result = source.slice();
  const selector: (item: T) => any =
    typeof selectorOrKey === "function"
      ? selectorOrKey
      : item => item[selectorOrKey];
  result.sort((a, b) => {
    const ax = selector(a);
    const bx = selector(b);
    if (ax < bx) {
      return -1;
    }
    if (ax > bx) {
      return 1;
    }
    return 0;
  });
  return Object.freeze(result);
}

export function verifyFormat<T extends number | string>(
  name: string,
  expected: T,
  actual: T,
): void {
  if (expected !== actual) {
    return error("Invalid %s: expected %O, found: %O", name, expected, actual);
  }
}

export function error(messageFormat: string, ...args: any[]): never {
  const message = util.format(messageFormat, ...args);
  throw new Error(message);
}

export interface FileRange {
  readonly offset: number;
  readonly end: number;
  readonly size: number;
}

export function fileRange(offset: number, size: number): FileRange {
  return Object.freeze({ offset, end: offset + size, size });
}

export interface AddressRange {
  readonly address: number;
  readonly end: number;
  readonly size: number;
}

export function addressRange(address: number, size: number): AddressRange {
  return Object.freeze({ address, end: address + size, size });
}

export interface Readable {
  read(
    position: number,
    length: number,
    buffer?: Buffer,
    offset?: number,
  ): Buffer;
}

export interface Writable {
  write(
    position: number,
    buffer: Buffer,
    length?: number,
    offset?: number,
  ): void;
}

export interface IO extends Readable, Writable {
  close(): void;
}

export interface Logger {
  log(messageFormat: string, ...args: any[]): void;

  group(messageFormat: string, ...args: any[]): void;

  groupEnd(): void;
}

export const nullLogger = Object.freeze({
  log() {},
  group() {},
  groupEnd() {},
});

function fileRangeContains(outer: FileRange, inner: FileRange): boolean {
  return outer.offset <= inner.offset && inner.end <= outer.end;
}

export function addressRangeContains(
  outer: AddressRange,
  inner: AddressRange,
): boolean {
  return outer.address <= inner.address && inner.end <= outer.end;
}

function generate<T>(count: number, generator: (index: number) => T) {
  const results: T[] = [];
  for (let index = 0; index !== count; index++) {
    results.push(generator(index));
  }
  return Object.freeze(results);
}

export function generateTable<T>(
  baseOffset: number,
  stride: number,
  count: number,
  generator: (offset: number, index: number) => T,
) {
  return generate(count, index =>
    generator(baseOffset + stride * index, index),
  );
}

export function fileIo(fdOrPath: number | string): IO {
  const fd =
    typeof fdOrPath === "number"
      ? fdOrPath
      : fs.openSync(fdOrPath, fs.constants.O_RDWR);
  return {
    read(position, length, buffer = Buffer.alloc(length), offset = 0) {
      if (fs.readSync(fd, buffer, offset, length, position) !== length) {
        return error("Failed to read %d bytes at %d", length, position);
      }
      return buffer;
    },
    write(position, buffer, length = buffer.length, offset = 0) {
      if (fs.writeSync(fd, buffer, offset, length, position) !== length) {
        return error("failed to write %d bytes at %d", length, position);
      }
    },
    close() {
      fs.closeSync(fd);
    },
  };
}

export function mapGetOrInit<K, V>(map: Map<K, V>, key: K, init: () => V): V {
  let value = map.get(key);
  if (value === undefined) {
    value = init();
    map.set(key, value);
  }
  return value;
}

export function readNullTerminatedUTF16(
  buffer: Buffer,
  offset: number,
  alignment = 0,
) {
  const start = offset;
  while (buffer.readUInt16LE(offset) !== 0) {
    offset += 2;
  }
  const value = buffer.toString("utf16le", start, offset);
  offset += 2;
  if (alignment) {
    offset = align(offset, alignment);
  }
  return [value, offset] as const;
}
