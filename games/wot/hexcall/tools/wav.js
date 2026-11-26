// Reads common WAV files and writes Wwise PCM .wem data.
'use strict';

function readWav(buf, file) {
  if (buf.toString('latin1', 0, 4) !== 'RIFF' || buf.toString('latin1', 8, 12) !== 'WAVE')
    throw new Error(`${file}: keine WAV-Datei (bitte als .wav exportieren)`);
  let p = 12, fmt, data;
  while (p + 8 <= buf.length) {
    const id = buf.toString('latin1', p, p + 4);
    const size = buf.readUInt32LE(p + 4);
    const body = buf.subarray(p + 8, Math.min(buf.length, p + 8 + size));
    if (id === 'fmt ') fmt = body;
    if (id === 'data') data = body;
    p += 8 + size + (size & 1);
  }
  if (!fmt || !data) throw new Error(`${file}: WAV ohne fmt/data`);
  let tag = fmt.readUInt16LE(0);
  const ch = fmt.readUInt16LE(2), rate = fmt.readUInt32LE(4), bits = fmt.readUInt16LE(14);
  if (tag === 0xfffe && fmt.length >= 26) tag = fmt.readUInt16LE(24); // extensible -> subformat
  const bps = bits / 8, frames = Math.floor(data.length / (bps * ch));
  const read = (i) => {
    const o = i * bps;
    if (tag === 3 && bits === 32) return data.readFloatLE(o);
    if (tag === 3 && bits === 64) return data.readDoubleLE(o);
    if (tag !== 1) throw new Error(`${file}: Format ${tag} wird nicht unterstützt (bitte PCM oder Float WAV)`);
    if (bits === 8) return (data[o] - 128) / 128;
    if (bits === 16) return data.readInt16LE(o) / 32768;
    if (bits === 24) return data.readIntLE(o, 3) / 8388608;
    if (bits === 32) return data.readInt32LE(o) / 2147483648;
    throw new Error(`${file}: ${bits} Bit nicht unterstützt`);
  };
  const mono = new Float32Array(frames);
  for (let f = 0; f < frames; f++) {
    let s = 0;
    for (let c = 0; c < ch; c++) s += read(f * ch + c);
    mono[f] = s / ch;
  }
  return { rate, samples: mono };
}

// High-quality resampling: windowed-sinc (Blackman) low-pass interpolation.
// Removes everything above the new Nyquist frequency, so downsampling does not alias (no 'krauseln').
function resample(samples, from, to) {
  if (from === to) return samples;
  const ratio = to / from;
  const n = Math.floor(samples.length * ratio);
  const out = new Float32Array(n);
  const cutoff = Math.min(1, ratio) * 0.94;   // relative to the source Nyquist
  const half = 24;                              // taps on each side (at the lower rate)
  const scale = Math.min(1, ratio);
  const width = Math.ceil(half / scale);
  for (let i = 0; i < n; i++) {
    const center = i / ratio;
    const k0 = Math.floor(center) - width, k1 = Math.floor(center) + width;
    let acc = 0, wsum = 0;
    for (let k = k0; k <= k1; k++) {
      if (k < 0 || k >= samples.length) continue;
      const x = (k - center) * cutoff;
      const sinc = x === 0 ? 1 : Math.sin(Math.PI * x) / (Math.PI * x);
      const t = (k - center) / (width + 1);
      const win = 0.42 + 0.5 * Math.cos(Math.PI * t) + 0.08 * Math.cos(2 * Math.PI * t);
      const w = sinc * win;
      acc += samples[k] * w; wsum += w;
    }
    out[i] = wsum ? acc / wsum : 0;
  }
  return out;
}

// Trim silence (adaptive threshold from the noise floor), normalise and add short fades.
// Same rules as the client's cleanTake(), so already-cleaned takes stay as they are.
function tidy(samples, rate, { trim = true, peak = 0.89, pre = 0.05, post = 0.12 } = {}) {
  let s = samples;
  if (trim) {
    const win = Math.max(1, Math.floor(rate * 0.01));
    const rms = [];
    for (let i = 0; i < s.length; i += win) {
      let e = 0, n = 0;
      for (let k = i; k < Math.min(i + win, s.length); k++, n++) e += s[k] * s[k];
      rms.push(Math.sqrt(e / Math.max(1, n)));
    }
    const sorted = [...rms].sort((x, y) => x - y);
    const floor = sorted[Math.floor(sorted.length * 0.1)] || 0, loud = sorted[sorted.length - 1] || 0;
    if (loud > 0.0015) {
      const thr = Math.max(floor * 4, loud * 0.06, 0.001);
      let a = rms.findIndex((v) => v > thr), b = rms.length - 1;
      while (b > a && rms[b] <= thr) b--;
      s = s.slice(Math.max(0, a * win - Math.floor(pre * rate)), Math.min(s.length, (b + 1) * win + Math.floor(post * rate)));
    } else s = s.slice();
  } else s = s.slice();
  let max = 0;
  for (const v of s) max = Math.max(max, Math.abs(v));
  if (peak && max > 0) { const g = Math.min(peak / max, 30); for (let i = 0; i < s.length; i++) s[i] *= g; }
  const fi = Math.min(s.length, Math.floor(rate * 0.008)), fo = Math.min(s.length, Math.floor(rate * 0.03));
  for (let i = 0; i < fi; i++) s[i] *= i / fi;
  for (let i = 0; i < fo; i++) s[s.length - 1 - i] *= i / fo;
  return s;
}

// Wwise PCM .wem: RIFF/WAVE with a 0x18-byte WAVE_FORMAT_EXTENSIBLE fmt chunk
// carrying a Wwise channel config (same layout as the game's own Vorbis files).
function toWem(samples, rate) {
  const pcm = Buffer.alloc(samples.length * 2);
  for (let i = 0; i < samples.length; i++) {
    const v = Math.max(-1, Math.min(1, samples[i]));
    pcm.writeInt16LE(Math.round(v * 32767), i * 2);
  }
  const fmt = Buffer.alloc(8 + 0x18);
  fmt.write('fmt ', 0, 'latin1');
  fmt.writeUInt32LE(0x18, 4);
  fmt.writeUInt16LE(0xfffe, 8);   // extensible
  fmt.writeUInt16LE(1, 10);       // channels
  fmt.writeUInt32LE(rate, 12);
  fmt.writeUInt32LE(rate * 2, 16);
  fmt.writeUInt16LE(2, 20);       // block align
  fmt.writeUInt16LE(16, 22);      // bits
  fmt.writeUInt16LE(6, 24);       // cbSize
  fmt.writeUInt16LE(0, 26);
  fmt.writeUInt32LE(0x00004101, 28); // 1 channel, standard config, front center
  const dataHdr = Buffer.alloc(8);
  dataHdr.write('data', 0, 'latin1');
  dataHdr.writeUInt32LE(pcm.length, 4);
  const riff = Buffer.alloc(12);
  riff.write('RIFF', 0, 'latin1');
  riff.writeUInt32LE(4 + fmt.length + dataHdr.length + pcm.length, 4);
  riff.write('WAVE', 8, 'latin1');
  return Buffer.concat([riff, fmt, dataHdr, pcm]);
}

module.exports = { readWav, resample, tidy, toWem };
