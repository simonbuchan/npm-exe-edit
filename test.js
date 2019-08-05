const fs = require("fs");

const pkg = require("./out/index.js");

const args = process.argv.slice(2);
const src = args.shift() || process.argv[0];
const dest = args.shift() || "patched.exe";
fs.copyFileSync(src, dest);
const io = pkg.fileIo(dest);
try {
  const header = pkg.readHeader(io);
  const rva = pkg.resolveRVA(header, pkg.rvaIndices.resources);
  const table = pkg.parseResourceSection(io.read(rva.file.start, rva.file.size), rva.virtual.start);
  const orig = pkg.resGet(table, pkg.resTypeIds.RT_VERSION);
  const newData = pkg.formatVersionInfo(pkg.parseVersionInfoBlock(orig.data));

  console.log("=== ORIG ===");
  printHex(orig.data);
  console.log("=== NEW ===");
  printHex(newData);
} finally {
  io.close();
}

function printHex(buffer) {
  for (let offset = 0; offset < buffer.length; offset += 16) {
    console.log(buffer.toString("hex", offset, offset + 16));
  }
}
