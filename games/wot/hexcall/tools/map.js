// Resolves which Sound objects each named event can play.
'use strict';
const { fnv1, T } = require('./bnk');

const CONTAINERS = new Set([T.RANSEQ, T.SWITCH, T.ACTORMIXER, T.LAYER]);

function buildTree(bank) {
  const children = new Map();
  for (const o of bank.objs) {
    if (o.type !== T.SOUND && !CONTAINERS.has(o.type)) continue;
    // NodeBaseParams: [fx override u8][numFx u8][fx entries][2 bytes][bus u32][parent u32]
    // It starts after the id (containers) or after the 14-byte source block (sounds).
    const base = o.type === T.SOUND ? 18 : 4;
    const numFx = o.body[base + 1];
    const off = base + 2 + (numFx ? 1 + numFx * 7 : 0) + 2 + 4;
    const v = o.body.readUInt32LE(off);
    const t = bank.byId.get(v);
    if (t && t !== o && CONTAINERS.has(t.type)) {
      if (!children.has(v)) children.set(v, []);
      children.get(v).push(o);
      o.parent = v;
    }
  }
  return children;
}

function soundsUnder(bank, children, id, acc = new Set()) {
  const o = bank.byId.get(id);
  if (!o) return acc;
  if (o.type === T.SOUND) { acc.add(o); return acc; }
  for (const c of children.get(id) || []) soundsUnder(bank, children, c.id, acc);
  return acc;
}

function eventSounds(bank, names) {
  const children = buildTree(bank);
  const result = new Map();
  for (const name of names) {
    const ev = bank.byId.get(fnv1(name));
    if (!ev || ev.type !== T.EVENT) continue;
    const n = ev.body[4];
    const sounds = new Set();
    for (let i = 0; i < n; i++) {
      const act = bank.byId.get(ev.body.readUInt32LE(5 + i * 4));
      if (!act || act.type !== T.ACTION) continue;
      const actionType = act.body.readUInt16LE(4);
      if ((actionType & 0xff00) !== 0x0400) continue; // only Play actions
      soundsUnder(bank, children, act.body.readUInt32LE(6), sounds);
    }
    result.set(name, [...sounds]);
  }
  return result;
}

module.exports = { eventSounds, buildTree };
