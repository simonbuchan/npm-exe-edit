import fs = require("fs");
import { Subsystems } from "./header";
import { BinaryVersion, patchExe } from "./index";
import { error, fileIo } from "./util";

const options = process.argv.slice(2);

const verbose = getFlag("verbose");
let subsystem;
if (getFlag("console")) {
  subsystem = Subsystems.console;
} else if (getFlag("gui")) {
  subsystem = Subsystems.gui;
}

const icon = getFlag("no-icon") ? null : getOption("icon");

const fileVersion = getOption("file-version");
const productVersion = getOption("product-version");
const versionStrings = new Map<string, string | null>();
while (true) {
  const setVersion = getOptionValues("set-version", 2);
  if (!setVersion) {
    break;
  }
  const [key, value] = setVersion;
  versionStrings.set(key, value);
}
while (true) {
  const deleteVersion = getOption("delete-version");
  if (!deleteVersion) {
    break;
  }
  versionStrings.set(deleteVersion, null);
}

const unknownOptions = options.filter(option => option.startsWith("-"));
if (unknownOptions.length) {
  error("unknown options: %O", unknownOptions);
}
if (options.length !== 2) {
  error("requires input and output paths.");
}
const inputPath = options.shift()!;
const outputPath = options.shift()!;
fs.copyFileSync(inputPath, outputPath);

const io = fileIo(outputPath);
try {
  const version =
    !fileVersion && !productVersion && !versionStrings
      ? undefined
      : {
          fileVersion: parseBinaryVersion(fileVersion),
          productVersion: parseBinaryVersion(productVersion),
          strings: versionStrings,
        };

  const resources = !icon && !version ? undefined : { icon, version };

  patchExe(io, {
    verbose,
    subsystem,
    resources,
  });
} finally {
  io.close();
}

function parseBinaryVersion(
  str: string | undefined,
): BinaryVersion | undefined {
  if (!str) {
    return undefined;
  }
  const match = str.match(/^(\d+)(?:\.(\d+)(?:\.(\d+)(?:\.(\d+))))$/);
  if (!match) {
    return error(
      "Invalid binary version string: %O (should be 1-4 numbers separated by '.')",
      str,
    );
  }
  return (match.slice(1) as unknown) as BinaryVersion;
}

function getFlag(name: string) {
  const index = options.indexOf(`--${name}`);
  if (index < 0) {
    return false;
  }
  options.splice(index, 1);
  return true;
}

function getOption(name: string) {
  const index = options.indexOf(`--${name}`);
  if (index < 0) {
    return undefined;
  }
  const value = options[index + 1];
  options.splice(index, 2);
  return value;
}

function getOptionValues(name: string, count: number) {
  const index = options.indexOf(`--${name}`);
  if (index < 0) {
    return undefined;
  }
  const values = options.slice(index + 1, index + 1 + count);
  options.splice(index, 1 + count);
  return values;
}
