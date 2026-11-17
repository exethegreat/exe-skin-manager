"use strict";
// binmotor: saf-Node WAD v3 + PROP motoru (oku + hash). Dış bağımlılık yok.
// Bin İÇERİĞİ çözülmeden, entry-çerçevesi üzerinden çalışır (format-kararlı).
const zlib = require("node:zlib");

// ---------------- XXH64 (seed=0) — WAD yol hash'i ----------------
const M64 = (1n << 64n) - 1n;
const P1 = 0x9e3779b185ebca87n, P2 = 0xc2b2ae3d27d4eb4fn, P3 = 0x165667b19e3779f9n;
const P4 = 0x85ebca77c2b2ae63n, P5 = 0x27d4eb2f165667c5n;
const w = (x) => BigInt.asUintN(64, x);
const rol = (x, r) => w((x << r) | (x >> (64n - r)));
const round = (acc, k) => w(rol(w(acc + w(k * P2)), 31n) * P1);

function xxh64(buf) {
  const n = buf.length;
  let i = 0, h;
  if (n >= 32) {
    let v1 = w(P1 + P2), v2 = P2, v3 = 0n, v4 = w(-P1);
    for (; i + 32 <= n; i += 32) {
      v1 = round(v1, buf.readBigUInt64LE(i));
      v2 = round(v2, buf.readBigUInt64LE(i + 8));
      v3 = round(v3, buf.readBigUInt64LE(i + 16));
      v4 = round(v4, buf.readBigUInt64LE(i + 24));
    }
    h = w(rol(v1, 1n) + rol(v2, 7n) + rol(v3, 12n) + rol(v4, 18n));
    for (const v of [v1, v2, v3, v4]) h = w(w(h ^ round(0n, v)) * P1 + P4);
  } else {
    h = P5;
  }
  h = w(h + BigInt(n));
  for (; i + 8 <= n; i += 8) {
    h = w(rol(w(h ^ round(0n, buf.readBigUInt64LE(i))), 27n) * P1 + P4);
  }
  if (i + 4 <= n) {
    h = w(rol(w(h ^ w(BigInt(buf.readUInt32LE(i)) * P1)), 23n) * P2 + P3);
    i += 4;
  }
  for (; i < n; i++) {
    h = w(rol(w(h ^ w(BigInt(buf[i]) * P5)), 11n) * P1);
  }
  h ^= h >> 33n; h = w(h * P2);
  h ^= h >> 29n; h = w(h * P3);
  h ^= h >> 32n;
  return w(h);
}

function yolHash(p) {
  return xxh64(Buffer.from(String(p).toLowerCase(), "utf8"));
}

// ---------------- FNV1a-32 (küçük harf) — PROP entry anahtar hash'i ----------------
function fnv1a32(s) {
  const buf = Buffer.from(String(s).toLowerCase(), "utf8");
  let h = 0x811c9dc5 | 0;
  for (let i = 0; i < buf.length; i++) {
    h ^= buf[i];
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

// ---------------- WAD v3 okuma ----------------
function wadOku(buf) {
  if (buf.toString("latin1", 0, 2) !== "RW") throw new Error("WAD değil (magic 'RW' yok)");
  const major = buf[2], minor = buf[3];
  if (major !== 3) throw new Error("desteklenmeyen WAD sürümü: " + major + "." + minor);
  let off = 2 + 1 + 1 + 256 + 8; // magic+sürüm+imza+checksum
  const count = buf.readUInt32LE(off); off += 4;
  const entries = new Array(count);
  for (let i = 0; i < count; i++) {
    const b = off + i * 32;
    entries[i] = {
      hash: buf.readBigUInt64LE(b),
      offset: buf.readUInt32LE(b + 8),
      compSize: buf.readUInt32LE(b + 12),
      uncSize: buf.readUInt32LE(b + 16),
      tip: buf[b + 20] & 0x0f,
    };
  }
  return { surum: [major, minor], entries };
}

function wadEntryVeri(buf, e) {
  const blob = buf.subarray(e.offset, e.offset + e.compSize);
  switch (e.tip) {
    case 0: return Buffer.from(blob);
    case 1: return zlib.gunzipSync(blob);
    case 3: return zlib.zstdDecompressSync(blob);
    case 4: throw new Error("desteklenmeyen WAD entry tipi: 4 (subchunked)");
    default: throw new Error("bilinmeyen WAD entry tipi: " + e.tip);
  }
}

// ---------------- PROP entry-çerçevesi ----------------
function propEntryler(bin) {
  if (bin.toString("latin1", 0, 4) !== "PROP") throw new Error("PROP değil");
  let off = 4;
  const surum = bin.readUInt32LE(off); off += 4;
  const linked = [];
  if (surum >= 2) {
    const lc = bin.readUInt32LE(off); off += 4;
    for (let i = 0; i < lc; i++) {
      const ln = bin.readUInt16LE(off); off += 2;
      linked.push(bin.toString("utf8", off, off + ln)); off += ln;
    }
  }
  const count = bin.readUInt32LE(off); off += 4;
  const typeHashes = new Uint32Array(count);
  for (let i = 0; i < count; i++) { typeHashes[i] = bin.readUInt32LE(off); off += 4; }
  const entries = new Array(count);
  for (let i = 0; i < count; i++) {
    const estart = off;
    const elen = bin.readUInt32LE(off);
    const keyHash = bin.readUInt32LE(off + 4);
    const eend = off + 4 + elen;
    entries[i] = { keyHash, typeHash: typeHashes[i], start: estart, end: eend };
    off = eend;
  }
  return { surum, linked, typeHashes, entries, tam: off === bin.length };
}

module.exports = { xxh64, yolHash, fnv1a32, wadOku, wadEntryVeri, propEntryler };
