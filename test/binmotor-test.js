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

// --- WAD round-trip (her zaman, oyun gerektirmez) ---
{
  const data = Buffer.from("merhaba-binmotor-123", "utf8");
  const hash = b.yolHash("data/test/ornek.bin");
  const wadBuf = b.wadYaz([{ hash, data }]);
  const w2 = b.wadOku(wadBuf);
  assert.strictEqual(w2.surum[0], 3, "üretilen WAD v3 olmalı");
  assert.strictEqual(w2.entries.length, 1, "1 entry olmalı");
  assert.strictEqual(w2.entries[0].hash, hash, "hash korunmalı");
  assert.ok(b.wadEntryVeri(wadBuf, w2.entries[0]).equals(data), "veri round-trip eşit olmalı");
  console.log("WAD round-trip GEÇTİ");
}

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

  // propBirlestir — replace (kendiyle splice): entry sayısı değişmez, tam true
  const r1 = b.propBirlestir(bin, bin, [k]);
  const p1 = b.propEntryler(r1.bin);
  assert.strictEqual(p1.tam, true, "splice sonucu PROP tam olmalı");
  assert.strictEqual(p1.entries.length, prop.entries.length, "replace entry sayısını değiştirmemeli");
  assert.ok(r1.degisen.includes(k), "degisen SRX_Buf_Red içermeli");

  // propBirlestir — ekle: items bin'inden shared'da olmayan bir entry
  const itemsE = wad.entries.find((x) => x.hash === 0x1d720f4f42640c18n);
  assert.ok(itemsE, "items bin bulunmalı");
  const itemsBin = b.wadEntryVeri(buf, itemsE);
  const addK = b.fnv1a32("Items/3077") >>> 0;
  assert.ok(b.propEntryler(itemsBin).entries.some((e) => (e.keyHash >>> 0) === addK), "items bin Items/3077 içermeli");
  assert.ok(!prop.entries.some((e) => (e.keyHash >>> 0) === addK), "shared bin Items/3077 İÇERMEMELİ");
  const r2 = b.propBirlestir(bin, itemsBin, [addK]);
  const p2 = b.propEntryler(r2.bin);
  assert.strictEqual(p2.tam, true, "ekleme sonucu PROP tam olmalı");
  assert.strictEqual(p2.entries.length, prop.entries.length + 1, "ekleme entry sayısını +1 yapmalı");
  assert.ok(r2.eklenen.includes(addK), "eklenen Items/3077 içermeli");
  assert.ok(p2.entries.some((e) => (e.keyHash >>> 0) === addK), "eklenen entry sonuçta olmalı");

  console.log("propBirlestir (splice/ekle) GEÇTİ");
  console.log("WAD/PROP testleri GEÇTİ (GAME ayarlı)");
} else {
  console.log("WAD/PROP testleri ATLANDI (GAME env yok)");
}
console.log("binmotor Task 1: TÜM testler GEÇTİ");
