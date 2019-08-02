const fs = require("fs");

const pkg = require("./out/index.js");

const io = pkg.fileIo(fs.openSync(process.argv[2] || process.argv[0]));
try {
  const header = pkg.readHeader(io);
  const table = pkg.getResourceTable(header, io);
  const versionInfo = pkg.readVersionInfoResource(table);
  pkg.printVersionInfo(console, versionInfo);
} finally {
  io.close();
}
