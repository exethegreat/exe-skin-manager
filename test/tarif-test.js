"use strict";

// Mod Re-sync: tarifCikar / senkronDenetim / reSync — sentetik oyun klasörüyle (gerçek oyun gerekmez).
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const StreamZip = require("node-stream-zip");
const binmotor = require("../src/binmotor");
const { buildStoreZip, tarifCikar, senkronDenetim, reSync } = require("../src/engine");

// Basit PROP: her entry = [len=6][keyHash][u16 değer].
function prop(entries) {
  const head = Buffer.alloc(12 + entries.length * 4);
  head.write("PROP", 0, "latin1");
  head.writeUInt32LE(1, 4);
  head.writeUInt32LE(entries.length, 8);
  for (let i = 0; i < entries.length; i++) head.writeUInt32LE(entries[i].typeHash, 12 + i * 4);
  const blobs = entries.map((entry) => {
    const blob = Buffer.alloc(10);
    blob.writeUInt32LE(6, 0);
    blob.writeUInt32LE(entry.keyHash, 4);
    blob.writeUInt16LE(entry.value, 8);
    return blob;
  });
  return Buffer.concat([head, ...blobs]);
}

function degerler(bin) {
  const p = binmotor.propEntryler(bin);
  assert.ok(p.tam, "bin sonuna kadar ayrışmalı");
  return new Map(p.entries.map((e) => [e.keyHash, bin.readUInt16LE(e.start + 8)]));
}

const gecici = fs.mkdtempSync(path.join(os.tmpdir(), "skin-tarif-"));
const gamePath = path.join(gecici, "Game");
const wadPath = path.join(gamePath, "DATA", "FINAL", "champion.wad.client");
const internalPath = "Characters/Test/Skins/Skin01/skin.bin";
const assetPath = "Characters/Test/Skins/Skin01/Particles/test.dds";
const binHash = binmotor.yolHash(internalPath);
const assetHash = binmotor.yolHash(assetPath);

function oyunuYaz(entries) {
  fs.mkdirSync(path.dirname(wadPath), { recursive: true });
  const parcalar = [{ hash: assetHash, data: Buffer.from("asset") }];
  if (entries) parcalar.unshift({ hash: binHash, data: prop(entries) });
  fs.writeFileSync(wadPath, binmotor.wadYaz(parcalar));
  // indeks önbelleği boyut+zamana bakar; aynı boyutlu yeniden yazımda zamanı kesin değiştir
  const t = new Date(Date.now() + Math.floor(Math.random() * 1e6));
  fs.utimesSync(wadPath, t, t);
}

async function main() {
  // --- 1) Ekleme anı: oyun yama A ---
  oyunuYaz([
    { keyHash: 0x10000001, typeHash: 0x20000001, value: 1 },
    { keyHash: 0x10000002, typeHash: 0x20000002, value: 2 }
  ]);
  const modFile = path.join(gecici, "test.fantome");
  fs.writeFileSync(modFile, buildStoreZip([
    { name: "META/info.json", data: Buffer.from('{"Name":"Test"}') },
    { name: `WAD/champion.wad.client/${internalPath}`, data: prop([
      { keyHash: 0x10000001, typeHash: 0x20000001, value: 9 }, // yazar değiştirdi
      { keyHash: 0x10000002, typeHash: 0x20000002, value: 2 }, // oyundakiyle aynı
      { keyHash: 0x10000003, typeHash: 0x20000003, value: 3 } // yazar ekledi
    ]) },
    { name: `WAD/champion.wad.client/${assetPath}`, data: Buffer.from("mod asset") }
  ]));

  const tarif = await tarifCikar(modFile, gamePath);
  assert.strictEqual(tarif.yama, null);
  assert.strictEqual(tarif.binler.length, 1);
  const [bin] = tarif.binler;
  assert.strictEqual(bin.oyunWad, path.join("DATA", "FINAL", "champion.wad.client"));
  assert.strictEqual(bin.hash, binHash.toString(16));
  assert.deepStrictEqual(bin.sahip, [
    { keyHash: 0x10000001, typeHash: 0x20000001 },
    { keyHash: 0x10000003, typeHash: 0x20000003 }
  ]);
  assert.deepStrictEqual(bin.referans, []);
  assert.ok(bin.gonderilen.includes(assetHash.toString(16)));
  assert.match(bin.oyunOzet, /^[0-9a-f]{40}$/);
  assert.strictEqual((await tarifCikar(modFile, gamePath, { yama: "26.22" })).yama, "26.22");

  // Aynı yamada senkron gerekmez
  let d = await senkronDenetim(tarif, gamePath);
  assert.deepStrictEqual(d, { gerek: false, eksikBin: [], eksikAsset: [] });

  // --- 2) Yeni yama B: Riot entry 2'yi değiştirdi, entry 4'ü ekledi ---
  oyunuYaz([
    { keyHash: 0x10000001, typeHash: 0x20000001, value: 1 },
    { keyHash: 0x10000002, typeHash: 0x20000002, value: 22 },
    { keyHash: 0x10000004, typeHash: 0x20000004, value: 4 }
  ]);
  d = await senkronDenetim(tarif, gamePath);
  assert.strictEqual(d.gerek, true, "oyun bin'i değişince senkron gerekir");
  assert.deepStrictEqual(d.eksikBin, []);

  const cikti = path.join(gecici, "test.synced.fantome");
  const modOnce = fs.readFileSync(modFile);
  const { rapor } = await reSync(modFile, tarif, gamePath, cikti);
  assert.ok(fs.readFileSync(modFile).equals(modOnce), "orijinal mod dosyası değişmemeli");
  assert.strictEqual(rapor.senkronEntry, 2);
  assert.deepStrictEqual(rapor.yokBin, []);
  assert.deepStrictEqual(rapor.tipUyumsuz, []);
  assert.deepStrictEqual(rapor.eksikAsset, []);

  // Çıktı: META korunur, bin = güncel oyun bin'i + yazarın entry'leri
  const zip = new StreamZip.async({ file: cikti });
  try {
    const adlar = Object.keys(await zip.entries());
    assert.ok(adlar.includes("META/info.json"));
    assert.strictEqual(JSON.parse(await zip.entryData("META/info.json")).Name, "Test");
    const wad = await zip.entryData("WAD/champion.wad.client");
    const w = binmotor.wadOku(wad);
    const be = w.entries.find((e) => e.hash === binHash);
    const ae = w.entries.find((e) => e.hash === assetHash);
    assert.ok(be && ae);
    assert.strictEqual(binmotor.wadEntryVeri(wad, ae).toString(), "mod asset");
    const v = degerler(binmotor.wadEntryVeri(wad, be));
    assert.strictEqual(v.get(0x10000001), 9, "yazarın değişikliği");
    assert.strictEqual(v.get(0x10000002), 22, "Riot'un yeni değeri");
    assert.strictEqual(v.get(0x10000003), 3, "yazarın eklediği");
    assert.strictEqual(v.get(0x10000004), 4, "Riot'un eklediği");
  } finally {
    await zip.close();
  }

  // --- 3) Riot entry 3'ü farklı tiple tanımladı → tipUyumsuz, kalan entry yine senkron ---
  oyunuYaz([
    { keyHash: 0x10000001, typeHash: 0x20000001, value: 1 },
    { keyHash: 0x10000003, typeHash: 0x2000ffff, value: 7 }
  ]);
  const r3 = (await reSync(modFile, tarif, gamePath, cikti)).rapor;
  assert.deepStrictEqual(r3.tipUyumsuz, ["10000003"]);
  assert.strictEqual(r3.senkronEntry, 1);

  // --- 4) Bin oyundan kaldırıldı → yokBin/eksikBin, çökme yok ---
  oyunuYaz(null);
  d = await senkronDenetim(tarif, gamePath);
  assert.strictEqual(d.gerek, true);
  assert.deepStrictEqual(d.eksikBin, [binHash.toString(16)]);
  const r4 = (await reSync(modFile, tarif, gamePath, cikti)).rapor;
  assert.deepStrictEqual(r4.yokBin, [binHash.toString(16)]);
  assert.strictEqual(r4.senkronEntry, 0);
  assert.ok(fs.existsSync(cikti));

  console.log("tarif-test: TÜM testler GEÇTİ");
}

main().finally(() => fs.rmSync(gecici, { recursive: true, force: true })).catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
