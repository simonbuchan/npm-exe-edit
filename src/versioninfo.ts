// RT_VERSIONINFO format
// https://docs.microsoft.com/en-us/windows/win32/menurc/vs-versioninfo

import {
  resFind,
  resGet,
  ResId,
  resSet,
  ResTable,
  resTypeIds,
} from "./resources";
import {
  align,
  error,
  Logger,
  readNullTerminatedUTF16,
  verifyFormat,
} from "./util";

export type BinaryVersion = readonly [number, number?, number?, number?];

const fixedFileInfoSize = 52;
const fixedFileInfoSignature = 0xfeef04bd;

export function readVersionInfoResource(
  table: ResTable,
  name?: ResId,
  lang?: ResId,
) {
  const entry = resGet(table, resTypeIds.RT_VERSION, name, lang);
  if (!entry) {
    return undefined;
  }
  return readVersionInfoBlock(entry.data);
}

export interface UpdateVersionInfoOptions {
  readonly fileVersion?: BinaryVersion;
  readonly productVersion?: BinaryVersion;
  readonly strings?: ReadonlyMap<string, string | null>;
}

export function updateVersionInfo(
  table: ResTable,
  options: UpdateVersionInfoOptions,
  name?: ResId,
  lang?: ResId,
) {
  let block: VersionInfoBlock | undefined = readVersionInfoResource(
    table,
    name,
    lang,
  );
  if (!block) {
    block = createDefaultVersionInfoBlock();
  }

  let updated = false;
  if (options.fileVersion) {
    updated = true;
    writeBinaryVersion(block.value as Buffer, 8, options.fileVersion);
  }
  if (options.productVersion) {
    updated = true;
    writeBinaryVersion(block.value as Buffer, 16, options.productVersion);
  }
  if (options.strings) {
    for (const [key, value] of options.strings) {
      updated = true;
      if (value !== null) {
        setVersionString(block, key, value);
      } else {
        deleteVersionString(block, key);
      }
    }
  }

  if (updated) {
    const { name, lang } = resFind(table, resTypeIds.RT_VERSION) || {
      name: 1,
      lang: 0x0409,
    };
    const data = formatVersionInfo(block);
    resSet(table, resTypeIds.RT_VERSION, name, lang, data);
  }

  return updated;
}

export function getVersionString(block: VersionInfoBlock, key: string) {
  const sfiBlock = block.children.find(child => child.key === "StringFileInfo");
  if (!sfiBlock) {
    return undefined;
  }
  const stBlock = sfiBlock.children[0];
  if (!stBlock) {
    return undefined;
  }
  const stringBlock = stBlock.children.find(s => s.key === key);
  if (!stringBlock) {
    return undefined;
  }
  return stringBlock.value;
}

export function setVersionString(
  block: VersionInfoBlock,
  key: string,
  value: string,
) {
  let sfiBlock = block.children.find(child => child.key === "StringFileInfo");
  if (!sfiBlock) {
    sfiBlock = createDefaultStringFileInfo();
    block.children.unshift(sfiBlock);
  }
  let stBlock = sfiBlock.children[0];
  if (!stBlock) {
    stBlock = createDefaultStringTable();
    sfiBlock.children.push(stBlock);
  }
  let stringBlock = stBlock.children.find(s => s.key === key);
  if (!stringBlock) {
    stringBlock = { key, value, children: [] };
    stBlock.children.push(stringBlock);
  } else {
    stringBlock.value = value;
  }
}

export function deleteVersionString(block: VersionInfoBlock, key: string) {
  let sfiBlock = block.children.find(child => child.key === "StringFileInfo");
  if (!sfiBlock) {
    return false;
  }
  let stBlock = sfiBlock.children[0];
  if (!stBlock) {
    return false;
  }
  let stringBlockIndex = stBlock.children.findIndex(s => s.key === key);
  if (stringBlockIndex < 0) {
    return false;
  }
  stBlock.children.splice(stringBlockIndex, 1);
  return true;
}

export function createDefaultVersionInfoBlock(): VersionInfoBlock {
  const value = Buffer.alloc(fixedFileInfoSize);
  value.writeUInt32LE(fixedFileInfoSignature, 0);
  value.writeUInt32LE(0x10000, 4);
  value.writeUInt32LE(0x40004, 32); // OS = Windows NT
  value.writeUInt32LE(1, 36); // file type = app

  return {
    key: "VS_VERSION_INFO",
    value,
    children: [
      createDefaultStringFileInfo(),
      {
        key: "VarFileInfo",
        value: "",
        children: [
          {
            key: "Translation",
            value: Buffer.of(0x09, 0x04, 0xb0, 0x04),
            children: [],
          },
        ],
      },
    ],
  };
}

export function createDefaultStringFileInfo(): VersionInfoBlock {
  return {
    key: "StringFileInfo",
    value: "",
    children: [createDefaultStringTable()],
  };
}

export function createDefaultStringTable(): VersionInfoBlock {
  return {
    key: "040904b0",
    value: "",
    children: [],
  };
}

export interface VersionInfoBlock {
  key: string;
  value: Buffer | string;
  children: VersionInfoBlock[];
}

export interface InputVersionInfoBlock {
  readonly key: string;
  readonly value: Buffer | string;
  readonly children: readonly InputVersionInfoBlock[];
}

interface ReadVersionInfoBlock {
  readonly offset: number;
  readonly end: number;
  readonly key: string;
  readonly value: Buffer | string;
  readonly children: VersionInfoBlock[];
}

function readVersionInfoBlock(
  buffer: Buffer,
  offset = 0,
): ReadVersionInfoBlock {
  const length = buffer.readUInt16LE(offset);
  const end = offset + length;
  const valueLength = buffer.readUInt16LE(offset + 2);
  const type = buffer.readUInt16LE(offset + 4);
  const [key, valueStart] = readNullTerminatedUTF16(buffer, offset + 6, 4);
  let value, valueEnd;
  switch (type) {
    default:
      return error("Unknown version value type: %O", type);
    case 0:
      valueEnd = valueStart + valueLength;
      value = buffer.slice(valueStart, valueEnd);
      break;
    case 1:
      valueEnd = valueStart + valueLength * 2;
      value = buffer
        .toString("utf16le", valueStart, valueEnd)
        .replace(/\0+$/, "");
      break;
  }
  let childOffset = align(valueEnd, 4);
  const children = [];
  while (childOffset < end) {
    const child = readVersionInfoBlock(buffer, childOffset);
    childOffset = align(child.end, 4);
    children.push(child);
  }
  return { offset, end, key, value, children };
}

export function printVersionInfo(logger: Logger, block: InputVersionInfoBlock) {
  if (
    Buffer.isBuffer(block.value) &&
    block.value.length >= fixedFileInfoSize &&
    block.value.readUInt32LE(0) === fixedFileInfoSignature
  ) {
    logger.group("%s: VS_FIXEDFILEINFO", block.key);
    printBinaryVersion(
      "   File Version",
      readBinaryVersion(block.value, 8),
      logger,
    );
    printBinaryVersion(
      "Product Version",
      readBinaryVersion(block.value, 16),
      logger,
    );
  } else if (block.value.length) {
    logger.group("%s: %O", block.key, block.value);
  } else {
    logger.group("%s:", block.key);
  }
  try {
    for (const child of block.children) {
      printVersionInfo(logger, child);
    }
  } finally {
    logger.groupEnd();
  }
}

function printBinaryVersion(
  name: string,
  [a, b = 0, c = 0, d = 0]: BinaryVersion,
  logger: Logger = console,
) {
  logger.log("%s: %s, %s, %s, %s", name, a, b, c, d);
}

function readBinaryVersion(data: Buffer, offset: number): BinaryVersion {
  return [
    data.readUInt16LE(offset + 2),
    data.readUInt16LE(offset),
    data.readUInt16LE(offset + 6),
    data.readUInt16LE(offset + 4),
  ] as const;
}

function writeBinaryVersion(
  data: Buffer,
  offset: number,
  [a, b = 0, c = 0, d = 0]: BinaryVersion,
) {
  data.writeUInt16LE(a, offset + 2);
  data.writeUInt16LE(b, offset);
  data.writeUInt16LE(c, offset + 6);
  data.writeUInt16LE(d, offset + 4);
}

export function formatVersionInfo(block: InputVersionInfoBlock) {
  const keySize = block.key.length * 2 + 2;
  const keyEnd = align(6 + keySize, 4);
  const type = Buffer.isBuffer(block.value) ? 0 : 1;
  const valueSize =
    type === 0 ? block.value.length : block.value.length * 2 + 2;
  let offset = align(keyEnd + valueSize, 4);
  let length = offset;

  const children = block.children.map(formatVersionInfo);
  for (const child of children) {
    length += child.length;
  }
  const result = Buffer.alloc(length);
  result.writeUInt16LE(length, 0);
  result.writeUInt16LE(type === 0 ? valueSize : valueSize >> 1, 2);
  result.writeUInt16LE(type, 4);
  result.write(block.key, 6, "utf16le");
  if (type === 0) {
    (block.value as Buffer).copy(result, keyEnd);
  } else {
    result.write(block.value as string, keyEnd, "utf16le");
  }

  for (const child of children) {
    child.copy(result, offset);
    offset += child.length;
  }

  return result;
}
