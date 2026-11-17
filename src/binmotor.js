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

// ---------------- PROP birleştir (splice/ekle) ----------------
// kaynak'taki verilen keyHash entry'lerini taban'a uygula: varsa replace, yoksa ekle.
function propBirlestir(taban, kaynak, keyHashler) {
  const T = propEntryler(taban);
  const K = propEntryler(kaynak);
  const kMap = new Map(); // keyHash -> kaynak entry
  for (const e of K.entries) kMap.set(e.keyHash >>> 0, e);
  const tHas = new Set(T.entries.map((e) => e.keyHash >>> 0));

  const replaceBytes = new Map(); // keyHash -> Buffer
  const addList = []; // {keyHash, typeHash, bytes}
  const degisen = [], eklenen = [], tipUyumsuz = [];
  const tTypeByKey = new Map(T.entries.map((e) => [e.keyHash >>> 0, e.typeHash >>> 0]));

  for (const khRaw of keyHashler) {
    const kh = khRaw >>> 0;
    const ke = kMap.get(kh);
    if (!ke) continue; // kaynakta yok → uygulanamaz
    const kbytes = kaynak.subarray(ke.start, ke.end);
    if (tHas.has(kh)) {
      if (tTypeByKey.get(kh) !== (ke.typeHash >>> 0)) { tipUyumsuz.push(kh); continue; }
      replaceBytes.set(kh, kbytes); degisen.push(kh);
    } else {
      addList.push({ keyHash: kh, typeHash: ke.typeHash >>> 0, bytes: kbytes }); eklenen.push(kh);
    }
  }

  const newCount = T.entries.length + addList.length;
  const typeArr = [];
  const entryBufs = [];
  for (const e of T.entries) {
    typeArr.push(e.typeHash >>> 0);
    const rep = replaceBytes.get(e.keyHash >>> 0);
    entryBufs.push(rep ? Buffer.from(rep) : Buffer.from(taban.subarray(e.start, e.end)));
  }
  for (const a of addList) { typeArr.push(a.typeHash >>> 0); entryBufs.push(Buffer.from(a.bytes)); }

  const chunks = [];
  const head = Buffer.alloc(8);
  head.write("PROP", 0, "latin1"); head.writeUInt32LE(T.surum, 4);
  chunks.push(head);
  if (T.surum >= 2) {
    const lc = Buffer.alloc(4); lc.writeUInt32LE(T.linked.length, 0); chunks.push(lc);
    for (const s of T.linked) {
      const sb = Buffer.from(s, "utf8");
      const lb = Buffer.alloc(2); lb.writeUInt16LE(sb.length, 0);
      chunks.push(lb, sb);
    }
  }
  const cb = Buffer.alloc(4); cb.writeUInt32LE(newCount, 0); chunks.push(cb);
  const tb = Buffer.alloc(4 * newCount);
  for (let i = 0; i < newCount; i++) tb.writeUInt32LE(typeArr[i] >>> 0, i * 4);
  chunks.push(tb);
  for (const eb of entryBufs) chunks.push(eb);

  return { bin: Buffer.concat(chunks), degisen, eklenen, tipUyumsuz };
}

// ---------------- WAD v3.4 yaz ----------------
function wadYaz(entries) {
  const count = entries.length;
  const comp = entries.map((e) => zlib.zstdCompressSync(e.data));
  const tocStart = 2 + 1 + 1 + 256 + 8 + 4; // 272
  const toc = [];
  const datas = [];
  let dataOff = tocStart + count * 32;
  for (let i = 0; i < count; i++) {
    const c = comp[i];
    const e32 = Buffer.alloc(32);
    const h = typeof entries[i].hash === "bigint" ? entries[i].hash : BigInt(entries[i].hash);
    e32.writeBigUInt64LE(w(h), 0);
    e32.writeUInt32LE(dataOff, 8);
    e32.writeUInt32LE(c.length, 12);
    e32.writeUInt32LE(entries[i].data.length, 16);
    e32[20] = 0x03; // tip=3 (zstd), subchunkCount=0
    // 21..31 = 0 (subchunk/checksum); modlu WAD'da denetlenmiyor
    toc.push(e32);
    datas.push(c);
    dataOff += c.length;
  }
  const head = Buffer.alloc(tocStart);
  head.write("RW", 0, "latin1"); head[2] = 3; head[3] = 4;
  // imza(256) + checksum(8) = sıfır
  head.writeUInt32LE(count, 268);
  return Buffer.concat([head, ...toc, ...datas]);
}

module.exports = { xxh64, yolHash, fnv1a32, wadOku, wadEntryVeri, propEntryler, propBirlestir, wadYaz };
