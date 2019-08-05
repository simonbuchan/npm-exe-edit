import { ExeHeader, resolveRVA, rvaIndices } from "./header";
import {
  AddressRange,
  addressRange,
  rangeSpanning,
  rangeTouches,
} from "./ranges";
import { align, Readable, sortedBy } from "./util";

export function getRelocRanges(header: ExeHeader, io: Readable) {
  const ranges: AddressRange[] = [];
  const pages = sortedBy(
    Array.from(getRelocPages(header, io)),
    page => page.range.start,
  );

  for (const page of pages) {
    for (let i = 0; i !== ranges.length; i++) {
      if (rangeTouches(page.range, ranges[i])) {
        ranges[i] = rangeSpanning(page.range, ranges[i]);
        break;
      }
    }
  }
  return ranges;
}

export function* getRelocPages(header: ExeHeader, io: Readable) {
  const rva = resolveRVA(header, rvaIndices.relocations);
  if (!rva) {
    return;
  }
  yield* parseRelocPages(io.read(rva.file.start, rva.file.size));
}

export function* parseRelocPages(buffer: Buffer) {
  for (let offset = 0; offset < buffer.length; ) {
    const pageRva = buffer.readUInt32LE(offset);
    const blockSize = buffer.readUInt32LE(offset + 4);
    const block = buffer.slice(offset, offset + blockSize);
    offset += align(blockSize, 4);

    yield {
      range: addressRange(pageRva, 1 << 12),
      block,
    };
  }
}

export function* parseRelocBlock(baseAddress: number, block: Buffer) {
  for (let blockOffset = 0; blockOffset < block.length; blockOffset += 2) {
    const typeAndOffset = block.readUInt16LE(blockOffset);
    const type = typeAndOffset >>> 12;
    if (type) {
      const offset = typeAndOffset & 0xfff;
      yield { type, address: baseAddress + offset };
    }
  }
}
