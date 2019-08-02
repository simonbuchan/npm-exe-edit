import {
  printHeader,
  readHeader,
  resolveRVA,
  rvaIndices,
  rvaSize,
  sectionHeaderSize,
} from "./header";
import {
  allocResourceSection,
  parseResourceSection,
  resAddIcon,
  resDeleteType,
  resTypeIds,
} from "./resources";
import { align, error, IO, nullLogger } from "./util";
import { updateVersionInfo, UpdateVersionInfoOptions } from "./versioninfo";

export * from "./header";
export * from "./resources";
export * from "./versioninfo";
export * from "./util";

export interface PatchExeOptions {
  readonly verbose?: boolean;
  readonly subsystem?: number;
  readonly resources?: PatchExeOptionsResources;
}

export interface PatchExeOptionsResources {
  readonly icon?: null | string;
  readonly version?: UpdateVersionInfoOptions;
}

export function patchExe(
  io: IO,
  { verbose, subsystem, resources }: PatchExeOptions,
) {
  const logger = verbose ? console : nullLogger;
  const header = readHeader(io);

  if (verbose) {
    printHeader(header, logger);
  }

  header.optional.writeUInt32LE(0, 64); // clear checksum just in case

  if (subsystem) {
    header.optional.writeUInt16LE(subsystem, 68);
  }

  const relocs = [];
  const relocPair = resolveRVA(header, rvaIndices.relocations);
  if (relocPair) {
    const { file } = relocPair;
    const buffer = io.read(file.offset, file.size);
    for (let offset = 0; offset < buffer.length; ) {
      const pageRva = buffer.readUInt32LE(offset);
      const blockSize = buffer.readUInt32LE(offset + 4);
      const block = buffer.slice(offset, offset + blockSize);
      offset += align(blockSize, 4);
      for (let blockOffset = 0; blockOffset < blockSize; blockOffset += 2) {
        const typeAndOffset = block.readUInt16LE(blockOffset);
        const type = typeAndOffset >>> 12;
        if (type) {
          const offset = typeAndOffset & 0xfff;
          relocs.push({ type, address: pageRva + offset });
        }
      }
    }
  }

  if (resources) {
    const existing = resolveRVA(header, rvaIndices.resources);
    if (!existing) {
      return error("Resource section allocation not implemented");
    }
    const { section, virtual, file } = existing;
    const table = parseResourceSection(
      io.read(file.offset, file.size),
      virtual.address,
    );

    let updated = false;

    // logger.log(pad(" original ", 80, "="));
    // printResourceSectionTable(table, section);

    if (resources.icon !== undefined) {
      updated = true;
      // Remove all existing icons, assuming only one.
      // Remember a single icon is an RT_GROUP_ICON resource referencing a set of RT_ICON
      // resources, one for each image (for different sizes and color-depths)
      resDeleteType(table, resTypeIds.RT_GROUP_ICON);
      resDeleteType(table, resTypeIds.RT_ICON);

      if (resources.icon !== null) {
        resAddIcon(table, resources.icon);
      }
    }

    if (resources.version && updateVersionInfo(table, resources.version)) {
      updated = true;
    }

    // logger.log(pad(" modified ", 80, "="));
    // printResourceSectionTable(table);

    if (!table.types.size) {
      return error("Removing resource section not implemented");
    } else if (updated) {
      const [buffer, relativeAddressOffsets] = allocResourceSection(table);

      if (buffer.length > virtual.size) {
        return error(
          "Resource section size increase not implemented: larger than RVA size",
        );
      }
      if (buffer.length > file.size) {
        return error(
          "Resource section size increase not implemented: larger than section file size",
        );
      }

      for (const offset of relativeAddressOffsets) {
        buffer.writeUInt32LE(
          buffer.readUInt32LE(offset) + virtual.address,
          offset,
        );
      }

      const virtualSize = buffer.length;
      const fileSize = align(buffer.length, header.fileAlignment);

      header.rvaBuffer.writeUInt32LE(
        virtualSize,
        rvaIndices.resources * rvaSize + 4,
      );

      const sectionOffset = section.index * sectionHeaderSize;
      header.sectionBuffer.writeUInt32LE(virtualSize, sectionOffset + 8);
      header.sectionBuffer.writeUInt32LE(fileSize, sectionOffset + 16);

      // logger.log(pad(" final ", 80, "="));
      // printResourceSectionTable(parseResourceSection(buffer, section.virtualAddress), section);

      io.write(section.file.offset, buffer);

      // section.virtual = addressRange(virtual.address, virtualSize);
      // section.file = fileRange(file.offset, fileSize);

      // This computation is a bit bizarre, but seems to give the same value
      // as microsoft puts.
      // let newSizeOfInitializedData = 0;
      // for (const { virtual, characteristics } of header.sectionTable) {
      //   if (characteristics & sectionCharacteristics.initializedData) {
      //     newSizeOfInitializedData += align(virtual.size, header.fileAlignment);
      //   }
      // }
      // header.optional.writeUInt32LE(newSizeOfInitializedData, 8);
    }
  }

  io.write(0, header.buffer);
}

export { mapGetOrInit } from "./util";
