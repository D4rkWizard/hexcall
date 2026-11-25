// Minimal Wwise .bnk reader/writer for WoT voiceover banks.
// Only touches what is needed to swap the audio of sounds: DIDX/DATA chunks
// and the source fields of Sound objects in HIRC. Everything else is copied byte-for-byte.
'use strict';

function fnv1(name) {
  let h = 0x811c9dc5;
  for (const c of Buffer.from(name.toLowerCase(), 'utf8')) {
    h = Math.imul(h, 0x01000193) >>> 0;
    h = (h ^ c) >>> 0;
  }
  return h >>> 0;
}

const T = { SOUND: 2, ACTION: 3, EVENT: 4, RANSEQ: 5, SWITCH: 6, ACTORMIXER: 7, LAYER: 9 };

function parse(buf) {
  const chunks = [];
  let p = 0;
  while (p < buf.length) {
    const tag = buf.toString('latin1', p, p + 4);
    const size = buf.readUInt32LE(p + 4);
    chunks.push({ tag, data: buf.subarray(p + 8, p + 8 + size) });
    p += 8 + size;
  }
  const get = (t) => chunks.find((c) => c.tag === t);

  // Media
  const media = new Map();
  const didx = get('DIDX'), data = get('DATA');
  if (didx) {
    for (let o = 0; o < didx.data.length; o += 12) {
      const id = didx.data.readUInt32LE(o), off = didx.data.readUInt32LE(o + 4), len = didx.data.readUInt32LE(o + 8);
      media.set(id, data.data.subarray(off, off + len));
    }
  }

  // HIRC objects
  const objs = [];
  const byId = new Map();
  const hirc = get('HIRC');
  if (hirc) {
    const n = hirc.data.readUInt32LE(0);
    let o = 4;
    for (let i = 0; i < n; i++) {
      const type = hirc.data[o];
      const size = hirc.data.readUInt32LE(o + 1);
      const body = Buffer.from(hirc.data.subarray(o + 5, o + 5 + size)); // copy: we may edit
      const obj = { type, id: body.readUInt32LE(0), body };
      objs.push(obj);
      byId.set(obj.id, obj);
      o += 5 + size;
    }
  }
  return { chunks, media, objs, byId };
}

// Sound object source info (AkBankSourceData) starts right after the 4-byte id.
function soundSource(obj) {
  const b = obj.body;
  return {
    plugin: b.readUInt32LE(4),
    streamType: b[8],
    sourceId: b.readUInt32LE(9),
    memSize: b.readUInt32LE(13),
    bits: b[17],
  };
}

function build(bank, newMedia /* Map id->Buffer */) {
  const out = [];
  const mediaIds = [...newMedia.keys()];
  // DIDX/DATA: entries aligned to 16 bytes like Wwise does
  const didx = Buffer.alloc(mediaIds.length * 12);
  const parts = [];
  let off = 0;
  mediaIds.forEach((id, i) => {
    const m = newMedia.get(id);
    const pad = (16 - (off % 16)) % 16;
    if (pad) { parts.push(Buffer.alloc(pad)); off += pad; }
    didx.writeUInt32LE(id, i * 12);
    didx.writeUInt32LE(off, i * 12 + 4);
    didx.writeUInt32LE(m.length, i * 12 + 8);
    parts.push(m);
    off += m.length;
  });
  const data = Buffer.concat(parts);

  const hircParts = [Buffer.alloc(4)];
  hircParts[0].writeUInt32LE(bank.objs.length);
  for (const o of bank.objs) {
    const h = Buffer.alloc(5);
    h[0] = o.type;
    h.writeUInt32LE(o.body.length, 1);
    hircParts.push(h, o.body);
  }
  const hirc = Buffer.concat(hircParts);

  for (const c of bank.chunks) {
    let d = c.data;
    if (c.tag === 'DIDX') d = didx;
    else if (c.tag === 'DATA') d = data;
    else if (c.tag === 'HIRC') d = hirc;
    const h = Buffer.alloc(8);
    h.write(c.tag, 0, 'latin1');
    h.writeUInt32LE(d.length, 4);
    out.push(h, d);
  }
  return Buffer.concat(out);
}

module.exports = { fnv1, parse, build, soundSource, T };
