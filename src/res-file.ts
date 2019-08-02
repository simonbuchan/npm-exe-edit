import { ResId } from "./resources";
import { align, bytes, hex, readNullTerminatedUTF16 } from "./util";

interface ResFileEntry {
  readonly type: ResId;
  readonly name: ResId;
  readonly languageId: ResId;
  readonly memoryFlags: number;
  readonly dataVersion: number;
  readonly version: number;
  readonly characteristics: number;
  readonly dataSize: number;
}

function printResFileTable(table: readonly ResFileEntry[]) {
  for (const entry of table) {
    console.group(
      "Res type %O name %O lang %O",
      entry.type,
      entry.name,
      entry.languageId,
    );
    console.log("   Memory Flags:", hex(entry.memoryFlags, 8));
    console.log("   Data Version:", entry.dataVersion);
    console.log("        Version:", entry.version);
    console.log("Characteristics:", hex(entry.characteristics, 8));
    console.log("      Data Size:", bytes(entry.dataSize));
    console.groupEnd();
  }
}

function parseResFile(
  buffer: Buffer,
  offset = 0,
  length = buffer.length - offset,
) {
  // https://docs.microsoft.com/en-us/windows/win32/menurc/resource-file-formats
  const end = offset + length;
  const result = [];
  while (offset < end) {
    const entry = parseResFileEntry(buffer, offset);
    offset = entry.end;
    result.push(entry);
  }
  return result;
}

/**
 * @param {Buffer} buffer
 * @param {number?} offset
 */
function parseResFileEntry(buffer: Buffer, offset = 0) {
  const dataSize = buffer.readUInt32LE(offset);
  const headerSize = buffer.readUInt32LE(offset + 4);
  const [type, typeEnd] = parseResourceName(buffer, offset + 8);
  const [name, nameEnd] = parseResourceName(buffer, typeEnd);
  const dataVersion = buffer.readUInt32LE(nameEnd);
  const memoryFlags = buffer.readUInt16LE(nameEnd + 4);
  const languageId = buffer.readUInt16LE(nameEnd + 6);
  const version = buffer.readUInt32LE(nameEnd + 8);
  const characteristics = buffer.readUInt32LE(nameEnd + 12);

  const dataOffset = offset + headerSize;
  const end = dataOffset + dataSize;
  const data = buffer.slice(dataOffset, end);

  return {
    offset,
    headerSize,
    dataOffset,
    dataSize,
    end,

    type,
    name,
    dataVersion,
    memoryFlags,
    languageId,
    version,
    characteristics,
    data,
  };
}

function parseResourceName(buffer: Buffer, offset: number) {
  if (buffer.readUInt16LE(offset) === 0xffff) {
    const value = buffer.readUInt16LE(offset + 2);
    return [value, offset + 4];
  } else {
    const [value, end] = readNullTerminatedUTF16(buffer, offset);
    return [value, align(end, 4)] as const; // DWORD-align
  }
}
