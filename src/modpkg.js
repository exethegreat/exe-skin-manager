// .modpkg (LeagueToolkit paket biçimi, sürüm 1) okuyucu: paketi WAD adlarını koruyarak
// .fantome içeriğine (WAD/<wad>/<yol> dosyaları + META/info.json) çevirir.
const fsp = require("node:fs/promises");
const zlib = require("node:zlib");
const { Hata } = require("./hata");

const NONE = 0xffffffff;
const MAX_BYTES = 1024 * 1024 * 1024;

// Yalnızca _meta_/info.msgpack için gereken küçük MessagePack çözücü.
function msgpack(buf) {
  let o = 0;
  const oku = () => {
    const t = buf[o++];
    if (t <= 0x7f) return t;
    if (t >= 0xe0) return t - 256;
    if (t >= 0xa0 && t <= 0xbf) return str(t & 0x1f);
    if (t >= 0x90 && t <= 0x9f) return dizi(t & 0x0f);
    if (t >= 0x80 && t <= 0x8f) return harita(t & 0x0f);
    switch (t) {
      case 0xc0: return null;
      case 0xc2: return false;
      case 0xc3: return true;
      case 0xcc: return buf[o++];
      case 0xcd: { const v = buf.readUInt16BE(o); o += 2; return v; }
      case 0xce: { const v = buf.readUInt32BE(o); o += 4; return v; }
      case 0xcf: { const v = Number(buf.readBigUInt64BE(o)); o += 8; return v; }
      case 0xd0: return buf.readInt8(o++);
      case 0xd1: { const v = buf.readInt16BE(o); o += 2; return v; }
      case 0xd2: { const v = buf.readInt32BE(o); o += 4; return v; }
      case 0xd3: { const v = Number(buf.readBigInt64BE(o)); o += 8; return v; }
      case 0xca: { const v = buf.readFloatBE(o); o += 4; return v; }
      case 0xcb: { const v = buf.readDoubleBE(o); o += 8; return v; }
      case 0xd9: return str(buf[o++]);
      case 0xda: { const n = buf.readUInt16BE(o); o += 2; return str(n); }
      case 0xdb: { const n = buf.readUInt32BE(o); o += 4; return str(n); }
      case 0xdc: { const n = buf.readUInt16BE(o); o += 2; return dizi(n); }
      case 0xdd: { const n = buf.readUInt32BE(o); o += 4; return dizi(n); }
      case 0xde: { const n = buf.readUInt16BE(o); o += 2; return harita(n); }
      case 0xdf: { const n = buf.readUInt32BE(o); o += 4; return harita(n); }
      case 0xc4: { const n = buf[o++]; o += n; return null; }
      case 0xc5: { const n = buf.readUInt16BE(o); o += 2 + n; return null; }
      default: throw new Error("msgpack");
    }
  };
  const str = (n) => { const s = buf.toString("utf8", o, o + n); o += n; return s; };
  const dizi = (n) => Array.from({ length: n }, oku);
  const harita = (n) => { const m = {}; for (let i = 0; i < n; i++) { const k = oku(); m[k] = oku(); } return m; };
  return oku();
}

function oku(buf, ad) {
  const hata = () => new Hata("mModpkg", { ad });
  try {
    if (buf.length < 28 || buf.toString("latin1", 0, 8) !== "_modpkg_" || buf.readUInt32LE(8) !== 1) throw hata();
    let o = 12;
    const imza = buf.readUInt32LE(o);
    const adet = buf.readUInt32LE(o + 4);
    o += 8 + imza;
    const u32 = () => { const v = buf.readUInt32LE(o); o += 4; return v; };
    const cstr = () => {
      const e = buf.indexOf(0, o);
      if (e < 0) throw hata();
      const s = buf.toString("utf8", o, e);
      o = e + 1;
      return s;
    };
    const layers = [];
    for (let n = u32(), i = 0; i < n; i++) {
      const l = u32();
      layers.push(buf.toString("utf8", o, o + l));
      o += l + 4;
    }
    const paths = [];
    for (let n = u32(), i = 0; i < n; i++) paths.push(cstr());
    const wads = [];
    for (let n = u32(), i = 0; i < n; i++) wads.push(cstr());
    o = (o + 7) & ~7;
    if (o + adet * 61 > buf.length) throw hata();
    const chunks = [];
    for (let i = 0; i < adet; i++) {
      const r = o + i * 61;
      chunks.push({
        off: Number(buf.readBigUInt64LE(r + 8)),
        sikistirma: buf[r + 16],
        csize: Number(buf.readBigUInt64LE(r + 17)),
        usize: Number(buf.readBigUInt64LE(r + 25)),
        yol: paths[buf.readUInt32LE(r + 49)],
        layer: buf.readUInt32LE(r + 53),
        wad: buf.readUInt32LE(r + 57)
      });
    }
    return { layers, wads, chunks };
  } catch (e) {
    throw e instanceof Hata ? e : hata();
  }
}

function veri(buf, c, ad) {
  if (c.off + c.csize > buf.length) throw new Hata("mModpkg", { ad });
  const ham = buf.subarray(c.off, c.off + c.csize);
  if (c.sikistirma === 0) return Buffer.from(ham);
  if (c.sikistirma !== 1) throw new Hata("mModpkg", { ad });
  if (typeof zlib.zstdDecompressSync !== "function") throw new Hata("mZstd");
  const d = zlib.zstdDecompressSync(ham);
  if (d.length !== c.usize) throw new Hata("mModpkg", { ad });
  return d;
}

const guvenliYol = (p) => {
  const y = String(p || "").replace(/\\/g, "/");
  return !!y && !y.startsWith("/") && !/^[A-Za-z]:/.test(y) && !y.split("/").some((s) => s === ".." || s === "");
};

/** Paketi okur; {girdiler: [{name, data}] (fantome içeriği), ad, yazar} döndürür. */
async function fantomeGirdileri(dosya, ad) {
  const buf = await fsp.readFile(dosya);
  const p = oku(buf, ad);
  const girdiler = [];
  let toplam = 0;
  let bilgi = {};
  for (const c of p.chunks) {
    if (c.yol === "_meta_/info.msgpack") {
      try {
        bilgi = msgpack(veri(buf, c, ad)) || {};
      } catch {}
      continue;
    }
    if (c.yol.startsWith("_meta_/") || c.wad === NONE || c.layer === NONE) continue;
    if (!guvenliYol(c.yol) || !p.wads[c.wad] || !guvenliYol(p.wads[c.wad]) || !p.layers[c.layer]) throw new Hata("mModpkg", { ad });
    toplam += c.usize;
    if (toplam > MAX_BYTES) throw new Hata("mBuyuk");
    const katman = p.layers[c.layer];
    const kok = katman.toLowerCase() === "base" ? "WAD" : `WAD_${katman}`;
    girdiler.push({ name: `${kok}/${p.wads[c.wad]}/${c.yol.replace(/\\/g, "/")}`, data: veri(buf, c, ad) });
  }
  if (!girdiler.length) throw new Hata("mModpkgBos", { ad });
  const yazarlar = Array.isArray(bilgi.authors) ? bilgi.authors.map((a) => (a && a.name) || "").filter(Boolean) : [];
  const info = {
    Name: String(bilgi.display_name || bilgi.name || ad),
    Author: yazarlar.join(", ") || "Unknown",
    Description: String(bilgi.description || ""),
    Version: String(bilgi.version || "1.0.0")
  };
  girdiler.push({ name: "META/info.json", data: Buffer.from(JSON.stringify(info)) });
  return { girdiler, ad: info.Name, yazar: yazarlar.join(", ") };
}

module.exports = { fantomeGirdileri, oku, msgpack };
