import * as util from "util";
import { ExeHeader, resolveRVA, rvaIndices, SectionHeader } from "./header";
import {
  AddressRange,
  align,
  bytes,
  error,
  fileIo,
  FileRange,
  formatAddressRange,
  formatFileRange,
  generateTable,
  hex,
  mapGetOrInit, Readable,
} from "./util";

export type ResId = string | number;

export function getResourceTable(header: ExeHeader, io: Readable) {
  const rva = resolveRVA(header, rvaIndices.resources);
  if (!rva) {
    return undefined;
  }
  const data = io.read(rva.file.offset, rva.file.size);
  return parseResourceSection(data, rva.virtual.address);
}

function resIdCompare(a: ResId, b: ResId): number {
  const aIsString = typeof a === "string";
  const bIsString = typeof b === "string";
  if (aIsString !== bIsString) {
    return aIsString ? 1 : -1;
  } else if (a < b) {
    return -1;
  } else if (a > b) {
    return 1;
  }
  return 0;
}

const resTypeNames = Object.freeze([
  null, // 0
  "RT_CURSOR", // 1
  "RT_BITMAP", // 2
  "RT_ICON", // 3
  "RT_MENU", // 4
  "RT_DIALOG", // 5
  "RT_STRING", // 6
  "RT_FONTDIR", // 7
  "RT_FONT", // 8
  "RT_ACCELERATOR", // 9
  "RT_RCDATA", // 10
  "RT_MESSAGETABLE", // 11
  "RT_GROUP_CURSOR", // 12
  null, // 13
  "RT_GROUP_ICON", // 14
  null, // 15
  "RT_VERSION", // 16
  "RT_DLGINCLUDE", // 17
  null, // 18
  "RT_PLUGPLAY", // 19
  "RT_VXD", // 20
  "RT_ANICURSOR", // 21
  "RT_ANIICON", // 22
  "RT_HTML", // 23
  "RT_MANIFEST", // 24
] as const);
export const resTypeIds = Object.freeze({
  RT_CURSOR: 1,
  RT_BITMAP: 2,
  RT_ICON: 3,
  RT_MENU: 4,
  RT_DIALOG: 5,
  RT_STRING: 6,
  RT_FONTDIR: 7,
  RT_FONT: 8,
  RT_ACCELERATOR: 9,
  RT_RCDATA: 10,
  RT_MESSAGETABLE: 11,
  RT_GROUP_CURSOR: 12,
  RT_GROUP_ICON: 14,
  RT_VERSION: 16,
  RT_DLGINCLUDE: 17,
  RT_PLUGPLAY: 19,
  RT_VXD: 20,
  RT_ANICURSOR: 21,
  RT_ANIICON: 22,
  RT_HTML: 23,
  RT_MANIFEST: 24,
} as const);

export interface ResTable {
  rootHeader?: ResTableHeader;
  types: Map<ResId, ResTableType>;
}

export interface ResTableType {
  typeHeader?: ResTableHeader;
  names: Map<ResId, ResTableName>;
}

export interface ResTableName {
  nameHeader?: ResTableHeader;
  langs: Map<ResId, ResTableData>;
}

export interface ResTableData {
  readonly offset?: number;
  readonly data: Buffer;
  readonly virtual?: AddressRange;
  readonly section?: FileRange;
}

export interface ResTableHeader {
  readonly characteristics: number;
  readonly timestamp: number;
  readonly majorVersion: number;
  readonly minorVersion: number;
}

export function* resIterate(table: ResTable) {
  for (const [type, { names }] of table.types) {
    for (const [name, { langs }] of names) {
      for (const [lang, { data }] of langs) {
        yield { type, name, lang, data };
      }
    }
  }
}

export function resFind(
  table: ResTable,
  type: ResId,
  name?: ResId,
): { type: ResId, name: ResId, lang: ResId } | undefined {
  const typeEntry = table.types.get(type);
  if (!typeEntry) {
    return undefined;
  }
  if (name === undefined) {
    name = first(typeEntry.names.keys());
  }
  const nameEntry = getMapKeyOrFirst(typeEntry.names, name);
  if (!nameEntry) {
    return undefined;
  }
  const lang = first(nameEntry.langs.keys());
  if (lang === undefined) {
    return undefined;
  }
  return { type, name: name!, lang };
}

export function resGet(
  table: ResTable,
  type: ResId,
  name?: ResId,
  lang?: ResId,
) {
  const typeEntry = table.types.get(type);
  if (!typeEntry) return undefined;
  const nameEntry = getMapKeyOrFirst(typeEntry.names, name);
  if (!nameEntry) return undefined;
  return getMapKeyOrFirst(nameEntry.langs, lang);
}

function first<T>(map: Iterable<T>): T | undefined {
  const iterator = map[Symbol.iterator]();
  try {
    const iteratorResult = iterator.next();
    if (!iteratorResult.done) {
      return iteratorResult.value;
    }
    return undefined;
  } finally {
    if (iterator.return) iterator.return();
  }
}

function getMapKeyOrFirst<K, V>(
  map: ReadonlyMap<K, V>,
  key: K | undefined,
): V | undefined {
  if (key !== undefined) {
    return map.get(key);
  }
  key = first(map.keys());
  if (key !== undefined) {
    return map.get(key);
  }
  return undefined;
}

export function resAddIcon(table: ResTable, iconPath: string) {
  // https://devblogs.microsoft.com/oldnewthing/20120720-00/?p=7083
  // Note the icon file format is the same as the RT_GROUP_ICON followed
  // by the RT_ICON contents, except that it has a uint32 file offset
  // instead of a uint16 RT_ICON name.
  const iconIo = fileIo(iconPath);
  try {
    const iconDirHeaderSize = 6;
    const iconDirEntrySize = 16;
    const iconGroupEntrySize = 14;

    const iconHeader = iconIo.read(0, iconDirHeaderSize);
    const entryCount = iconHeader.readUInt16LE(4);
    if (!entryCount) {
      return error("Icon file has no icon entries: %O", iconPath);
    }

    const groupData = Buffer.alloc(
      iconDirHeaderSize + iconGroupEntrySize * entryCount,
    );
    iconHeader.copy(groupData, 0, 0, 6);
    for (let index = 0; index !== entryCount; index++) {
      const id = resNextId(table, resTypeIds.RT_ICON);
      const iconDirOffset = iconDirHeaderSize + iconDirEntrySize * index;
      const entryData = iconIo.read(iconDirOffset, iconDirEntrySize);

      const iconGroupOffset = iconDirHeaderSize + iconGroupEntrySize * index;
      entryData.copy(groupData, iconGroupOffset, 0, 12);
      groupData.writeUInt16LE(id, iconGroupOffset + 12);

      const dataSize = entryData.readUInt32LE(8);
      const dataOffset = entryData.readUInt32LE(12);
      const data = iconIo.read(dataOffset, dataSize);
      resSet(table, resTypeIds.RT_ICON, id, 0x0409, data);
    }

    resSet(
      table,
      resTypeIds.RT_GROUP_ICON,
      resNextId(table, resTypeIds.RT_GROUP_ICON),
      0x0409,
      groupData,
    );
  } finally {
    iconIo.close();
  }
}

export function resNextId(table: ResTable, type: ResId): number {
  const typeEntry = table.types.get(type);
  let maxId = 0;
  if (typeEntry) {
    for (const name of typeEntry.names.keys()) {
      if (typeof name === "number" && maxId < name) {
        maxId = name;
      }
    }
  }
  return maxId + 1;
}

export function resSet(
  table: ResTable,
  type: ResId,
  name: ResId,
  lang: ResId,
  data: Buffer,
): void {
  const typeEntry = mapGetOrInit(table.types, type, () => ({
    names: new Map(),
  }));
  const nameEntry = mapGetOrInit(typeEntry.names, name, () => ({
    langs: new Map(),
  }));
  nameEntry.langs.set(lang, { data, dataSize: data.length });
}

export function resDeleteType(table: ResTable, type: ResId): boolean {
  return table.types.delete(type);
}

export function resDeleteName(
  table: ResTable,
  type: ResId,
  name: ResId,
): boolean {
  const typeEntry = table.types.get(type);
  if (!typeEntry) return false;
  return typeEntry.names.delete(name);
}

export function resDeleteLang(
  table: ResTable,
  type: ResId,
  name: ResId,
  lang: ResId,
): boolean {
  const typeEntry = table.types.get(type);
  if (!typeEntry) return false;
  const nameEntry = typeEntry.names.get(name);
  if (!nameEntry) return false;
  return nameEntry.langs.delete(lang);
}

export function printResourceSectionTable(
  table: ResTable,
  section?: SectionHeader,
) {
  if (table.rootHeader) {
    console.log("Header: %O", table.rootHeader);
  }
  for (const [typeId, { typeHeader, names }] of table.types) {
    console.group(
      "Type %s:",
      (typeof typeId === "number" && resTypeNames[typeId]) ||
        util.inspect(typeId, { colors: process.stdout.isTTY }),
    );
    if (typeHeader) {
      console.log("Header: %O", typeHeader);
    }
    for (const [nameId, { nameHeader, langs }] of names) {
      console.group("Name %O:", nameId);
      if (nameHeader) {
        console.log("Header: %O", nameHeader);
      }
      for (const [
        languageId,
        { offset, data, virtual, section: sectionRange },
      ] of langs) {
        console.group("Language %O:", languageId);
        if (offset) {
          console.log("Entry offset: %O", offset);
        }
        if (virtual) {
          console.log("Virtual Address: %s", formatAddressRange(virtual));
        }
        if (sectionRange) {
          console.log("   Section Data: %s-%s", formatFileRange(sectionRange));
        }
        console.group("Data (%s):", bytes(data.length));
        for (
          let offset = 0;
          offset < Math.min(128, data.length);
          offset += 16
        ) {
          console.log(data.toString("hex", offset, offset + 16));
        }
        if (data.length > 128) {
          console.log("(%s more bytes)", data.length - 128);
        }
        console.groupEnd();
        console.groupEnd();
      }
      console.groupEnd();
    }
    console.groupEnd();
  }
}

export function allocResourceSection(table: ResTable) {
  let directoryHeaderSize = 16; // root table header size
  let stringAreaSize = 0;
  let dataHeaderAreaSize = 0;
  let dataAreaSize = 0;
  for (const [typeId, { names }] of table.types) {
    stringAreaSize += idStringSize(typeId);
    directoryHeaderSize += 8 + 16; // table entry + subdir table header size
    for (const [nameId, { langs }] of names) {
      stringAreaSize += idStringSize(nameId);
      directoryHeaderSize += 8 + 16; // table entry + subdir table header size
      for (const [langId, { data }] of langs) {
        stringAreaSize += idStringSize(langId);
        directoryHeaderSize += 8;
        dataHeaderAreaSize += 16;
        dataAreaSize += align(data.length, 8);
      }
    }
  }

  directoryHeaderSize = align(directoryHeaderSize, 16);
  stringAreaSize = align(stringAreaSize, 16);
  dataHeaderAreaSize = align(dataHeaderAreaSize, 16);

  const size =
    directoryHeaderSize + stringAreaSize + dataHeaderAreaSize + dataAreaSize;

  // console.log("allocated size: %s", hex(size));

  const buffer = Buffer.alloc(size);
  const stringAreaStart = directoryHeaderSize;
  const dataHeaderAreaStart = stringAreaStart + stringAreaSize;
  const dataAreaStart = dataHeaderAreaStart + dataHeaderAreaSize;
  // slice up buffer to prevent them stepping on each other.
  const directoryArea = buffer.slice(0, stringAreaStart);
  let directoryAreaOffset = 0;
  const stringArea = buffer.slice(stringAreaStart, dataHeaderAreaStart);
  let stringAreaOffset = 0;
  const dataHeaderArea = buffer.slice(dataHeaderAreaStart, dataAreaStart);
  let dataHeaderAreaOffset = 0;
  const dataArea = buffer.slice(dataAreaStart);
  let dataAreaOffset = 0;

  const relativeAddressOffsets: number[] = [];

  writeTableHeader(
    table.rootHeader,
    table.types,
    ({ typeHeader, names }, typeId) => {
      return writeTableHeader(
        typeHeader,
        names,
        ({ nameHeader, langs }, nameId) => {
          return writeTableHeader(nameHeader, langs, ({ data }, langId) => {
            const result = dataHeaderAreaStart + dataHeaderAreaOffset;
            relativeAddressOffsets.push(result); // To be patched to a Virtual Address later.
            dataHeaderArea.writeUInt32LE(
              dataAreaStart + dataAreaOffset,
              dataHeaderAreaOffset,
            );
            dataHeaderArea.writeUInt32LE(data.length, dataHeaderAreaOffset + 4);
            dataHeaderAreaOffset += 16;

            if (
              data.copy(dataArea, dataAreaOffset, 0, data.length) !==
              data.length
            ) {
              return error("Insufficient area for resource data");
            }
            dataAreaOffset += align(data.length, 8);

            return result;
          });
        },
      );
    },
  );

  return [buffer, relativeAddressOffsets] as const;

  function idStringSize(id: ResId) {
    // 2-byte length + 2-bytes per UTF-16 char + 2-byte UTF-16 null
    return typeof id === "string" ? 4 + id.length * 2 : 0;
  }

  function writeTableHeader<T>(
    header: ResTableHeader | undefined,
    map: Map<ResId, T>,
    writeEntry: (entry: T, id: ResId) => number,
  ) {
    const result = setHighBit32(directoryAreaOffset);

    if (header) {
      directoryArea.writeUInt32LE(header.characteristics, directoryAreaOffset);
      directoryArea.writeUInt32LE(header.timestamp, directoryAreaOffset + 4);
      directoryArea.writeUInt16LE(header.majorVersion, directoryAreaOffset + 8);
      directoryArea.writeUInt16LE(
        header.minorVersion,
        directoryAreaOffset + 10,
      );
    }

    const keys = Array.from(map.keys()).sort(resIdCompare);
    const nameKeys = keys.filter(
      (key): key is string => typeof key === "string",
    );
    const idKeys = keys.filter((key): key is number => typeof key !== "string");
    directoryArea.writeUInt16LE(nameKeys.length, directoryAreaOffset + 12);
    directoryArea.writeUInt16LE(idKeys.length, directoryAreaOffset + 14);
    directoryAreaOffset += 16;

    let directoryEntryOffset = directoryAreaOffset;

    // move to start of next table
    directoryAreaOffset += keys.length * 8;

    for (const name of nameKeys) {
      directoryArea.writeUInt32LE(
        setHighBit32(stringAreaStart + stringAreaOffset),
        directoryEntryOffset,
      );
      stringArea.writeUInt32LE(name.length, stringAreaOffset);
      if (
        stringArea.write(name, stringAreaOffset + 2, "utf16le") !==
        name.length * 2
      ) {
        return error("Failed to write resource string");
      }
      stringAreaOffset += 4 + name.length * 2;
      directoryArea.writeUInt32LE(
        writeEntry(map.get(name)!, name),
        directoryEntryOffset + 4,
      );
      directoryEntryOffset += 8;
    }

    for (const id of idKeys) {
      directoryArea.writeUInt32LE(id, directoryEntryOffset);
      directoryArea.writeUInt32LE(
        writeEntry(map.get(id)!, id),
        directoryEntryOffset + 4,
      );
      directoryEntryOffset += 8;
    }

    return result;
  }
}

export function parseResourceSection(
  buffer: Buffer,
  baseAddress: number,
  offset = 0,
) {
  // https://docs.microsoft.com/en-us/windows/win32/debug/pe-format#the-rsrc-section

  const rootHeader = parseResourceSectionTableHeader(buffer, offset);
  return {
    rootHeader,
    types: new Map(
      rootHeader.entries.map(typeEntry => {
        if (!typeEntry.isDirectory) {
          return error(
            "resource type entry is not a directory, at 0x%s",
            hex(typeEntry.offset),
          );
        }
        const typeHeader = parseResourceSectionTableHeader(
          buffer,
          typeEntry.dataOffset,
        );
        return [
          typeEntry.id,
          {
            typeHeader,
            names: new Map(
              typeHeader.entries.map(nameEntry => {
                if (!nameEntry.isDirectory) {
                  return error(
                    "resource name entry is not a directory, at 0x%s",
                    hex(nameEntry.offset),
                  );
                }
                const nameHeader = parseResourceSectionTableHeader(
                  buffer,
                  nameEntry.dataOffset,
                );
                return [
                  nameEntry.id,
                  {
                    nameHeader,
                    langs: new Map(
                      nameHeader.entries.map(langEntry => {
                        if (langEntry.isDirectory) {
                          return error(
                            "resource lang entry is a directory, at 0x%s",
                            hex(nameEntry.offset),
                          );
                        }
                        const dataEntry = parseResourceSectionTableDataEntry(
                          buffer,
                          langEntry.dataOffset,
                          baseAddress,
                        );
                        return [langEntry.id, dataEntry];
                      }),
                    ),
                  },
                ];
              }),
            ),
          },
        ];
      }),
    ),
  };
}

function parseResourceSectionTableHeader(buffer: Buffer, offset = 0) {
  const characteristics = buffer.readUInt32LE(offset);
  const timestamp = buffer.readUInt32LE(offset + 4);
  const majorVersion = buffer.readUInt16LE(offset + 8);
  const minorVersion = buffer.readUInt16LE(offset + 10);
  const nameEntryCount = buffer.readUInt16LE(offset + 12);
  const idEntryCount = buffer.readUInt16LE(offset + 14);

  const entries = generateTable(
    offset + 16,
    8,
    nameEntryCount + idEntryCount,
    (offset, index) => {
      const [isName, idOrNameOffset] = splitHighBit32(
        buffer.readUInt32LE(offset),
      );
      const [isDirectory, dataOffset] = splitHighBit32(
        buffer.readUInt32LE(offset + 4),
      );
      let id;
      if (isName) {
        const nameLength = buffer.readUInt16LE(idOrNameOffset);
        const nameDataOffset = idOrNameOffset + 2;
        id = buffer.toString(
          "utf16le",
          nameDataOffset,
          nameDataOffset + nameLength * 2,
        );
      } else {
        id = idOrNameOffset;
      }
      return { index, offset, id, isDirectory, dataOffset };
    },
  );

  return {
    offset,
    characteristics,
    timestamp,
    majorVersion,
    minorVersion,
    entries,
  };
}

function splitHighBit32(value: number) {
  const flag = (value & 0x80000000) !== 0;
  const masked = value & 0x7fffffff;
  return [flag, masked] as const;
}

/**
 * @param {number} value
 * @return {number}
 */
function setHighBit32(value: number) {
  // Need this dumb right-shift otherwise JS converts to a negative value.
  return (0x80000000 | value) >>> 0;
}

function parseResourceSectionTableDataEntry(
  buffer: Buffer,
  offset: number,
  baseAddress: number,
) {
  const dataAddress = buffer.readUInt32LE(offset);
  const dataSize = buffer.readUInt32LE(offset + 4);
  const dataEnd = dataAddress + dataSize;
  const codepage = buffer.readUInt32LE(offset + 8);
  return {
    offset,
    dataAddress,
    dataSize,
    dataEnd,
    codepage,
    data: buffer.slice(dataAddress - baseAddress, dataEnd - baseAddress),
  };
}
