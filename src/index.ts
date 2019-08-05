import {
  printHeader,
  readHeader,
  resolveRVA,
  rvaIndices,
  writeSection,
} from "./header";
import { rangeOverlaps } from "./ranges";
import { getRelocRanges } from "./relocations";
import {
  formatResourceSection, getResourceTable,
  parseResourceSection, putResourceTable,
  resAddIcon,
  resDeleteType,
  resTypeIds,
} from "./resources";
import { error, IO, nullLogger } from "./util";
import { updateVersionInfo, UpdateVersionInfoOptions } from "./versioninfo";

export * from "./header";
export * from "./ranges";
export * from "./res-file";
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

  if (resources) {
    const table = getResourceTable(header, io);

    let updated = false;

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

    if (updated) {
      putResourceTable(header, io, table);
    }
  }

  io.write(0, header.buffer);
}
