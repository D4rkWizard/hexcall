// Decoder for BigWorld packed XML (WoT .xml files inside .pkg archives).
// Usage: node unpackxml.js <packed.xml> [out.xml]
const fs = require('fs');

function decode(buf) {
  if (buf.readUInt32LE(0) !== 0x62a14e45) return buf.toString('utf8');
  let p = 5;
  const dict = [];
  for (;;) {
    const e = buf.indexOf(0, p);
    const s = buf.toString('latin1', p, e);
    p = e + 1;
    if (!s) break;
    dict.push(s);
  }
  const readDesc = (o) => {
    const v = buf.readUInt32LE(o);
    return { end: v & 0x0fffffff, type: v >>> 28 };
  };
  function readData(type, start, end) {
    const b = buf.subarray(start, end);
    const len = end - start;
    switch (type) {
      case 1: return b.toString('utf8');
      case 2:
        if (len === 0) return '0';
        if (len === 1) return String(b.readInt8(0));
        if (len === 2) return String(b.readInt16LE(0));
        if (len === 4) return String(b.readInt32LE(0));
        if (len === 8) return String(b.readBigInt64LE(0));
        return '';
      case 3: {
        const f = [];
        for (let i = 0; i + 4 <= len; i += 4) f.push(+b.readFloatLE(i).toFixed(6));
        return f.join(' ');
      }
      case 4: return len && b[0] ? 'true' : 'false';
      case 5: return b.toString('base64');
      default: return '';
    }
  }
  // Returns {children:[{name,node}], text}
  function readElement(off) {
    const count = buf.readUInt16LE(off);
    const self = readDesc(off + 2);
    const kids = [];
    let o = off + 6;
    for (let i = 0; i < count; i++) {
      kids.push({ name: dict[buf.readUInt16LE(o)], ...readDesc(o + 2) });
      o += 6;
    }
    const dataStart = o;
    const node = { text: readData(self.type, dataStart, dataStart + self.end), children: [] };
    let prev = self.end;
    for (const k of kids) {
      const s = dataStart + prev, e = dataStart + k.end;
      const child = k.type === 0 ? readElement(s) : { text: readData(k.type, s, e), children: [] };
      node.children.push({ name: k.name, node: child });
      prev = k.end;
    }
    return node;
  }
  const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  function toXml(name, node, ind) {
    const pad = '  '.repeat(ind);
    if (!node.children.length) return `${pad}<${name}>${esc(node.text.trim())}</${name}>\n`;
    let s = `${pad}<${name}>` + (node.text.trim() ? esc(node.text.trim()) : '') + '\n';
    for (const c of node.children) s += toXml(c.name, c.node, ind + 1);
    return s + `${pad}</${name}>\n`;
  }
  return toXml('root', readElement(p), 0);
}

module.exports = decode;
if (require.main === module) {
  const out = decode(fs.readFileSync(process.argv[2]));
  if (process.argv[3]) fs.writeFileSync(process.argv[3], out); else process.stdout.write(out);
}
