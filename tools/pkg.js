// Read files out of WoT .pkg archives (plain zip files) without loading the whole archive.
'use strict';
const fs = require('fs');
const zlib = require('zlib');

function readAt(fd, pos, len) {
  const b = Buffer.alloc(len);
  fs.readSync(fd, b, 0, len, pos);
  return b;
}

// Yields {name, read()} for every entry. Accepts a file path or a Buffer.
function* zipEntries(src) {
  const isBuf = Buffer.isBuffer(src);
  const fd = isBuf ? null : fs.openSync(src, 'r');
  try {
    const size = isBuf ? src.length : fs.fstatSync(fd).size;
    const at = (pos, len) => (isBuf ? src.subarray(pos, pos + len) : readAt(fd, pos, len));
    const tailLen = Math.min(size, 65557);
    const tail = at(size - tailLen, tailLen);
    let e = tail.length - 22;
    while (e > 0 && tail.readUInt32LE(e) !== 0x06054b50) e--;
    const n = tail.readUInt16LE(e + 10);
    const cdSize = tail.readUInt32LE(e + 12);
    const cd = at(tail.readUInt32LE(e + 16), cdSize);
    let p = 0;
    for (let i = 0; i < n; i++) {
      const method = cd.readUInt16LE(p + 10);
      const csize = cd.readUInt32LE(p + 20);
      const nlen = cd.readUInt16LE(p + 28), xlen = cd.readUInt16LE(p + 30), clen = cd.readUInt16LE(p + 32);
      const lho = cd.readUInt32LE(p + 42);
      const name = cd.toString('utf8', p + 46, p + 46 + nlen);
      p += 46 + nlen + xlen + clen;
      yield {
        name,
        read() {
          const lh = at(lho, 30);
          const raw = at(lho + 30 + lh.readUInt16LE(26) + lh.readUInt16LE(28), csize);
          return method === 8 ? zlib.inflateRawSync(raw) : Buffer.from(raw);
        },
      };
    }
  } finally {
    if (fd !== null) fs.closeSync(fd);
  }
}

// Returns Map(name -> Buffer) for entries whose name passes `filter`.
function extract(pkgFiles, filter) {
  const out = new Map();
  for (const f of pkgFiles) for (const e of zipEntries(f)) if (filter(e.name)) out.set(e.name, e.read());
  return out;
}

module.exports = { zipEntries, extract };
