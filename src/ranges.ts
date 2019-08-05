import util = require("util");
import { bytes, hex } from "./util";

/* TODO: Move to some sort of tag system.
         We have true addresses, base-relative addresses (RVAs),
         file pointer/offsets, section-relative, etc. */

export const fileKind = Symbol("file");
export type FileKind = typeof fileKind;
export const rvaKind = Symbol("rva");
export type RvaKind = typeof fileKind;

export interface Range<Kind> {
  readonly kind: Kind;
  readonly start: number;
  readonly end: number;
  readonly size: number;
}

export type FileRange = Range<typeof fileKind>;
export type AddressRange = Range<typeof rvaKind>;

export function range<Kind>(kind: Kind, start: number, size: number): Range<Kind> {
  return Object.freeze({ kind, start, end: start + size, size });
}

export function fileRange(start: number, size: number): FileRange {
  return range(fileKind, start, size);
}

export function addressRange(start: number, size: number): AddressRange {
  return range(rvaKind, start, size);
}

export function formatRange(range: Range<unknown>) {
  return util.format(
    "%s-%s",
    hex(range.start, 8),
    hex(range.end, 8),
    bytes(range.size),
  );
}

export function rangeContains<Kind>(
  outer: Range<Kind>,
  inner: Range<Kind>,
): boolean {
  return outer.start <= inner.start && inner.end <= outer.end;
}

export function rangeIncludes(range: Range<unknown>, offset: number): boolean {
  return range.start <= offset && offset < range.end;
}

// Forms a contiguous range when unioned.
// true for:
// |-a-|      |-a-|    |-a-|   |---a---| |-a-|          |-a-|
//   |-b-|  |-b-|    |---b---|   |-b-|       |-b-|  |-b-|
export function rangeTouches<Kind>(a: Range<Kind>, b: Range<Kind>): boolean {
  return b.start <= a.end && a.start <= b.end;
}

// At least one byte in common. That is, both have at least one byte, and:
// true for:                              |  false for:
// |-a-|      |-a-|    |-a-|   |---a---|  |  |-a-|          |-a-|
//   |-b-|  |-b-|    |---b---|   |-b-|    |      |-b-|  |-b-|
export function rangeOverlaps<Kind>(a: Range<Kind>, b: Range<Kind>): boolean {
  return a.size !== 0 && b.size !== 0 && b.start < a.end && a.start < b.end;
}

export function rangeSpanning<Kind>(a: Range<Kind>, b: Range<Kind>): Range<Kind> {
  const start = Math.min(a.start, b.start);
  const end = Math.max(a.end, b.end);
  return range(a.kind, start, end - start);
}

// Returns the spanning range if they touch, otherwise undefined;
export function rangeMerged<Kind>(a: Range<Kind>, b: Range<Kind>): Range<Kind> | undefined {
  return !rangeTouches(a, b) ? undefined : rangeSpanning(a, b);
}
