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
  pkg.resDeleteType(table, pkg.resTypeIds.RT_GROUP_ICON);
  pkg.resDeleteType(table, pkg.resTypeIds.RT_ICON);
  const [data, offsets] = pkg.formatResourceSection(table);
  const buffer = Buffer.alloc(rva.file.size);
  if (data.copy(buffer) !== data.length) {
    pkg.error("Resized too large");
  }
  pkg.writeSection(io, header, rva.section, buffer, offsets);
} finally {
  io.close();
}
