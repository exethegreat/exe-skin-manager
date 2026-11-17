// binmotor Task 1 testleri: WAD/PROP okuma + hash.
// Hash testleri her zaman çalışır; WAD/PROP testleri GAME env'i varsa çalışır.
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const b = require("../src/binmotor");

// --- hash testleri (her zaman) ---
assert.strictEqual(
  b.yolHash("assets/shared/particles/buff-stone-red.dds").toString(16),
  "b7715e078b2db66d",
  "yolHash (xxh64) bilinen değeri vermeli"
);
assert.strictEqual(
  b.fnv1a32("shared/particles/srx_buf_red") >>> 0,
  0x66eeffa6,
  "fnv1a32 bilinen değeri vermeli"
);
// küçük harfe duyarsızlık (büyük/küçük aynı hash)
assert.strictEqual(
  b.fnv1a32("Shared/Particles/SRX_Buf_Red") >>> 0,
  0x66eeffa6,
  "fnv1a32 küçük harfe çevirmeli"
);
console.log("hash testleri GEÇTİ");

// --- WAD/PROP testleri (GAME env ile) ---
const GAME = process.env.GAME;
if (GAME) {
  const buf = fs.readFileSync(path.join(GAME, "Game/DATA/FINAL/Global.wad.client"));
  const wad = b.wadOku(buf);
  assert.strictEqual(wad.surum[0], 3, "WAD v3 olmalı");
  assert.ok(wad.entries.length > 1000, "Global.wad binlerce entry içermeli");

  const target = 0x5a791d818ae738a6n; // shared spells/particles bin
  const e = wad.entries.find((x) => x.hash === target);
  assert.ok(e, "shared bin (5a791d818ae738a6) bulunmalı");

  const bin = b.wadEntryVeri(buf, e);
  assert.strictEqual(bin.subarray(0, 4).toString("latin1"), "PROP", "çözülmüş veri PROP olmalı");

  const prop = b.propEntryler(bin);
  assert.strictEqual(prop.tam, true, "PROP ayrıştırma dosya sonuyla birebir bitmeli");
  const k = b.fnv1a32("Shared/Particles/SRX_Buf_Red") >>> 0;
  assert.ok(
    prop.entries.some((en) => (en.keyHash >>> 0) === k),
    "SRX_Buf_Red entry bulunmalı"
  );
  console.log("WAD/PROP testleri GEÇTİ (GAME ayarlı)");
} else {
  console.log("WAD/PROP testleri ATLANDI (GAME env yok)");
}
console.log("binmotor Task 1: TÜM testler GEÇTİ");
