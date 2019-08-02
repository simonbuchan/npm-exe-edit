import {
  addressRange,
  AddressRange,
  addressRangeContains,
  align,
  bytes,
  error,
  fileRange,
  FileRange,
  formatAddressRange,
  formatFileRange,
  generateTable,
  hex,
  Logger,
  Readable,
  sortedBy,
} from "./util";

// Reference:
// https://docs.microsoft.com/en-us/windows/desktop/debug/pe-format

export const Subsystems = Object.freeze({
  gui: 2,
  console: 3,
});
const peOffsetOffset = 0x3c;
const validPESignature = "PE\0\0";
const peSignatureSize = 4;
const coffHeaderSize = 20;
const pe32Magic = 0x10b;
const pe32PlusMagic = 0x20b;
export type OptionalMagic = typeof pe32Magic | typeof pe32PlusMagic;
export const rvaSize = 8;
export const rvaIndices = Object.freeze({
  exports: 0,
  imports: 1,
  resources: 2,
  exceptions: 3,
  certificate: 4,
  relocations: 5,
  debug: 6,
  tls: 9,
  loadConfig: 10,
  boundImport: 11,
  importAddresses: 12,
  delayImport: 13,
  clrRuntime: 14,
} as const);
const rvaNames = Object.freeze([
  "Exports",
  "Imports",
  "Resources",
  "Exceptions",
  "Certificate",
  "Relocations",
  "Debug",
  null,
  null,
  "TLS",
  "Load Config",
  "Bound Import",
  "Import Addresses",
  "Delay Import",
  "CLR Runtime",
  null,
] as const);
export const sectionHeaderSize = 40;
const sectionCharacteristics = Object.freeze({
  code: 0x20,
  initializedData: 0x40,
  uninitializedData: 0x80,
  discardable: 0x2000000,
  sharableMemory: 0x10000000,
  executableMemory: 0x20000000,
  readableMemory: 0x40000000,
  writableMemory: 0x80000000,
} as const);

export interface SectionHeader {
  readonly index: number;
  readonly offset: number;
  readonly name: string;
  readonly characteristics: number;
  readonly file: FileRange;
  readonly virtual: AddressRange;
  readonly adjustment: number;
}

export interface RVA {
  readonly index: number;
  readonly virtual: AddressRange;
}

export interface ExeHeader {
  readonly buffer: Buffer;
  readonly coffRange: FileRange;
  readonly optionalRange: FileRange;
  readonly coff: Buffer;
  readonly optionalMagic: OptionalMagic;
  readonly optional: Buffer;
  readonly rvaBuffer: Buffer;
  readonly sectionBuffer: Buffer;
  readonly rvaTable: readonly RVA[];
  readonly sectionTable: readonly SectionHeader[];
  readonly fileAlignment: number;
  readonly sectionAlignment: number;
}

export function printHeader(header: ExeHeader, logger: Logger = console) {
  const { optionalMagic, optional } = header;
  switch (optionalMagic) {
    case pe32Magic:
      logger.log("Format: PE32");
      break;
    case pe32PlusMagic:
      logger.log("Format: PE32+");
      break;
  }

  const sizeOfCode = optional.readUInt32LE(4);
  const sizeOfInitializedData = optional.readUInt32LE(8);
  const sizeOfUninitializedData = optional.readUInt32LE(12);
  const entryPoint = optional.readUInt32LE(16);
  const baseOfCode = optional.readUInt32LE(20);
  const sectionAlignment = optional.readUInt32LE(32);
  const fileAlignment = optional.readUInt32LE(36);
  const sizeOfImage = optional.readUInt32LE(56);
  const sizeOfHeaders = optional.readUInt32LE(60);
  logger.group("Header Attributes:");
  logger.log(
    "              Size of Code: %s (%s)",
    hex(sizeOfCode, 8),
    bytes(sizeOfCode),
  );
  logger.log(
    "  Size of Initialized Data: %s (%s)",
    hex(sizeOfInitializedData, 8),
    bytes(sizeOfInitializedData),
  );
  logger.log(
    "Size of Uninitialized Data: %s (%s)",
    hex(sizeOfUninitializedData, 8),
    bytes(sizeOfUninitializedData),
  );
  logger.log("               Entry Point: %s", hex(entryPoint, 8));
  logger.log("              Base Of Code: %s", hex(baseOfCode, 8));
  logger.log(
    "         Section Alignment: 0x%s (%s)",
    hex(sectionAlignment),
    bytes(sectionAlignment),
  );
  logger.log(
    "            File Alignment: 0x%s (%s)",
    hex(fileAlignment),
    bytes(fileAlignment),
  );
  logger.log(
    "             Size of Image: %s (%s)",
    hex(sizeOfImage, 8),
    bytes(sizeOfImage),
  );
  logger.log(
    "           Size of Headers: %s (%s)",
    hex(sizeOfHeaders, 8),
    bytes(sizeOfHeaders),
  );
  logger.groupEnd();

  for (const { index, virtual } of sortedBy(
    header.rvaTable,
    rva => rva.virtual.address,
  )) {
    logger.log(
      "RVA %O: Virtual Address: %s",
      rvaNames[index] || index + 1,
      formatAddressRange(virtual),
    );
  }

  for (const {
    index,
    name,
    virtual,
    file,
    characteristics,
  } of header.sectionTable) {
    logger.group("Section %O: %O", index + 1, name);
    logger.log("Virtual Address: %s", formatAddressRange(virtual));
    logger.log("    File Offset: %s", formatFileRange(file));
    logger.group("Characteristics: 0x%s", hex(characteristics, 8));
    if (characteristics & sectionCharacteristics.code) {
      logger.log("Code");
    }
    if (characteristics & sectionCharacteristics.initializedData) {
      logger.log("Initialized Data");
    }
    if (characteristics & sectionCharacteristics.uninitializedData) {
      logger.log("Uninitialized Data");
    }
    if (characteristics & sectionCharacteristics.discardable) {
      logger.log("Discardable");
    }
    if (characteristics & sectionCharacteristics.sharableMemory) {
      logger.log("Memory: Shared");
    }
    if (characteristics & sectionCharacteristics.executableMemory) {
      logger.log("Memory: Execute");
    }
    if (characteristics & sectionCharacteristics.readableMemory) {
      logger.log("Memory: Read");
    }
    if (characteristics & sectionCharacteristics.writableMemory) {
      logger.log("Memory: Write");
    }
    logger.groupEnd();
    logger.groupEnd();
  }
}

export function readHeader(io: Readable): ExeHeader {
  const buffer = io.read(0, 0x1000);

  const dosSignature = buffer.toString("ascii", 0, 2);
  if (dosSignature !== "MZ") {
    return error("Invalid executable, invalid DOS signature: %O", dosSignature);
  }

  const peOffset = buffer.readUInt32LE(peOffsetOffset);
  if (peOffset > 0x1000) {
    return error("implausible PE offset: %O", peOffset);
  }

  const peSignature = buffer.toString(
    "ascii",
    peOffset,
    peOffset + peSignatureSize,
  );
  if (peSignature !== validPESignature) {
    return error("Invalid executable, invalid PE signature: %O", peSignature);
  }

  const coffRange = fileRange(peOffset + peSignatureSize, coffHeaderSize);
  const coff = buffer.slice(coffRange.offset, coffRange.end);

  const sectionCount = coff.readUInt16LE(2);
  const optionalSize = coff.readUInt16LE(16);

  const optionalRange = fileRange(coffRange.end, optionalSize);
  const optional = buffer.slice(optionalRange.offset, optionalRange.end);

  const optionalMagic = optional.readUInt16LE(0);

  switch (optionalMagic) {
    default:
      return error(
        "invalid or unknown optional header magic: 0x%s",
        hex(optionalMagic),
      );
    case pe32Magic:
    case pe32PlusMagic:
      break;
  }

  const sectionAlignment = optional.readUInt32LE(32);
  const fileAlignment = optional.readUInt32LE(36);
  const sizeOfHeaders = optional.readUInt32LE(60);
  const rvaBuffer = optional.slice(optionalMagic === pe32Magic ? 96 : 112);
  const sectionRange = fileRange(
    optionalRange.end,
    sectionCount * sectionHeaderSize,
  );
  const sectionBuffer = buffer.slice(sectionRange.offset, sectionRange.end);

  const expectedSizeOfHeaders = align(sectionRange.end, fileAlignment);
  if (sizeOfHeaders !== expectedSizeOfHeaders) {
    return error(
      "Expected SizeOfHeaders to be 0x%s, but was 0x%s",
      hex(expectedSizeOfHeaders),
      hex(sizeOfHeaders),
    );
  }
  const rvaCount = optional.readUInt32LE(
    optionalMagic === pe32Magic ? 92 : 108,
  );
  if (sizeOfHeaders > buffer.length) {
    return error(
      "header size larger than expected maximum: 0x%s",
      hex(sizeOfHeaders),
    );
  }

  const rvaTable = generateTable(
    0,
    rvaSize,
    rvaCount,
    (offset, index): RVA => {
      const address = rvaBuffer.readUInt32LE(offset);
      const size = rvaBuffer.readUInt32LE(offset + 4);
      return { index, virtual: addressRange(address, size) };
    },
  ).filter(rva => rva.virtual.address !== 0 || rva.virtual.size !== 0);

  const sectionTable = generateTable(
    optionalRange.end,
    sectionHeaderSize,
    sectionCount,
    (offset, index): SectionHeader => {
      const name = buffer
        .toString("ascii", offset, offset + 8)
        .replace(/\0+$/, "");
      const virtual = addressRange(
        buffer.readUInt32LE(offset + 12),
        buffer.readUInt32LE(offset + 8),
      );
      const file = fileRange(
        buffer.readUInt32LE(offset + 20),
        buffer.readUInt32LE(offset + 16),
      );
      const characteristics = buffer.readUInt32LE(offset + 36);
      const adjustment = virtual.address - file.offset;

      return {
        index,
        offset,
        name,
        virtual,
        file,
        characteristics,
        adjustment,
      };
    },
  );

  return {
    buffer: buffer.slice(0, sizeOfHeaders),
    coffRange,
    optionalRange,

    coff,
    optional,
    optionalMagic,

    rvaBuffer,
    rvaTable,
    sectionBuffer,
    sectionTable,

    fileAlignment,
    sectionAlignment,
  };
}

export interface ResolveRVAResult {
  readonly section: SectionHeader;
  readonly virtual: AddressRange;
  readonly file: FileRange;
}

export function resolveRVA(
  header: ExeHeader,
  index: number,
): ResolveRVAResult | undefined {
  const rva = header.rvaTable.find(rva => rva.index === index);
  if (!rva) {
    return undefined;
  }
  const { virtual } = rva;
  const section = header.sectionTable.find(section =>
    addressRangeContains(section.virtual, virtual),
  );
  if (!section) {
    return error("section containing RVA %O not found", rva);
  }
  const file = fileRange(virtual.address - section.adjustment, virtual.size);
  return { section, virtual, file };
}
