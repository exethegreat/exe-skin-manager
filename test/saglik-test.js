"use strict";

// Mod sağlık rozeti: Manager'ın denetim kararlarından yeşil/sarı/kırmızı sınıf (node test/saglik-test.js)
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { saglikSinifi, modSagliklari } = require("../src/engine");

const temiz = { health: "healthy", counts: { fatals: 0, errors: 0, warnings: 0, infos: 0 }, rules: [] };

// Sınıflandırma
assert.strictEqual(saglikSinifi(null, 0), null, "denetlenmemiş mod: rozet yok");
assert.strictEqual(saglikSinifi(temiz, 0), "guncel");
assert.strictEqual(saglikSinifi(temiz, 126), "fix", "Manager onardıysa FIX");
assert.strictEqual(saglikSinifi({ health: "unrepairable", counts: { fatals: 0, errors: 0, warnings: 2 }, rules: [{ rule: "bin/object-link" }] }, 0), "fix", "yalnız uyarı: FIX");
assert.strictEqual(saglikSinifi({ health: "unrepairable", counts: { fatals: 6, errors: 0, warnings: 2 }, rules: [{ rule: "bin/property-type" }] }, 118), "bozuk", "ölümcül hata: tamir edilemez");
assert.strictEqual(saglikSinifi({ health: "unrepairable", counts: { fatals: 0, errors: 1, warnings: 0 }, rules: [{ rule: "bin/skinhack" }] }, 0), "bozuk", "skinhack: tamir edilemez");

// Dosyalardan eşleme: kaynak hash → (seçim/sync/library) → Manager mod id → karar
const lib = fs.mkdtempSync(path.join(os.tmpdir(), "skin-saglik-"));
try {
  const h = (c) => c.repeat(64);
  fs.writeFileSync(path.join(lib, "bocchi-sync.json"), JSON.stringify({ mods: {
    [h("a")]: { id: "m-a" },
    [h("d")]: { id: "m-b" } // b'nin hazırlanmış (info.json düzeltilmiş) kopyası
  } }));
  fs.writeFileSync(path.join(lib, "bocchi-selection.json"), JSON.stringify({ packages: [{ sourceId: h("b"), sha256: h("d") }] }));
  fs.writeFileSync(path.join(lib, "library.json"), JSON.stringify({ mods: [{ id: "m-c", sourceSha256: h("c") }] }));
  fs.writeFileSync(path.join(lib, "mod-health-verdicts.json"), JSON.stringify({ verdicts: {
    "m-a": { ...temiz, checkedAt: "2026-11-16T20:07:36Z" }, // eski onarım olayı (18:41) bu denetimden önce: sayılmaz
    "m-b": { ...temiz, checkedAt: "2026-11-17T09:00:00.100Z" },
    "m-c": { health: "unrepairable", counts: { fatals: 3, errors: 0, warnings: 0 }, rules: [{ rule: "bin/property-type" }] }
  } }));
  fs.writeFileSync(path.join(lib, "bocchi-bridge-events.jsonl"), [
    JSON.stringify({ at: "2026-11-16T18:41:31Z", event: "mod-repaired", facts: { modId: "m-a", repaired: 126 } }),
    JSON.stringify({ at: "2026-11-16T10:00:00Z", event: "mod-repaired", facts: { modId: "m-b", repaired: 5 } }),
    "bozuk satır",
    JSON.stringify({ at: "2026-11-17T09:00:00.300Z", event: "mod-repaired", facts: { modId: "m-b", repaired: 7 } })
  ].join("\n") + "\n");

  modSagliklari(lib, [
    { anahtar: "A", hash: "a".repeat(16) },
    { anahtar: "B", hash: "b".repeat(16) },
    { anahtar: "C", hash: "c".repeat(16) },
    { anahtar: "E", hash: "e".repeat(16) }
  ]).then((m) => {
    assert.deepStrictEqual(m.get("A"), { durum: "guncel", onarim: 0, modId: "m-a" });
    assert.deepStrictEqual(m.get("B"), { durum: "fix", onarim: 7, modId: "m-b" }, "son onarım sayısı");
    assert.deepStrictEqual(m.get("C"), { durum: "bozuk", onarim: 0, modId: "m-c" });
    assert.strictEqual(m.get("E"), undefined, "eşlenemeyen mod");
    return modSagliklari(path.join(lib, "yok"), [{ anahtar: "A", hash: "a".repeat(16) }]);
  }).then((m) => {
    assert.strictEqual(m.size, 0, "kütüphane yoksa boş, çökme yok");
    console.log("saglik-test: TÜM testler GEÇTİ");
  }).catch((e) => {
    console.error(e);
    process.exitCode = 1;
  }).finally(() => fs.rmSync(lib, { recursive: true, force: true }));
} catch (e) {
  fs.rmSync(lib, { recursive: true, force: true });
  throw e;
}

// ---------------- Kalıcı onarım (FIX tıklaması) ----------------
// Overlay'deki (Manager'ın onardığı) hâl moda yazılır; başka modla ortak hash'lere dokunulmaz.
const { kaliciOnar, buildStoreZip } = require("../src/engine");
const binmotor = require("../src/binmotor");
const ok = fs.mkdtempSync(path.join(os.tmpdir(), "skin-onar-"));
(async () => {
  try {
    const H = (n) => BigInt(n);
    const modWad = binmotor.wadYaz([
      { hash: H(1), data: Buffer.from("eski-1") }, // Manager onardı → değişmeli
      { hash: H(2), data: Buffer.from("ayni-2") }, // overlay ile aynı
      { hash: H(3), data: Buffer.from("eski-3") } // başka modla ortak → dokunulmamalı
    ]);
    const modFile = path.join(ok, "mod.fantome");
    fs.writeFileSync(modFile, buildStoreZip([
      { name: "META/info.json", data: Buffer.from('{"Name":"M"}') },
      { name: "WAD/Map11.wad.client", data: modWad }
    ]));
    const ovDir = path.join(ok, "overlay", "DATA", "FINAL", "Maps", "Shipping");
    fs.mkdirSync(ovDir, { recursive: true });
    fs.writeFileSync(path.join(ovDir, "Map11.wad.client"), binmotor.wadYaz([
      { hash: H(1), data: Buffer.from("onarilmis-1") },
      { hash: H(2), data: Buffer.from("ayni-2") },
      { hash: H(3), data: Buffer.from("karisik-3") },
      { hash: H(9), data: Buffer.from("oyun-9") }
    ]));
    const baska = path.join(ok, "baska.fantome");
    fs.writeFileSync(baska, buildStoreZip([{ name: "WAD/Map11.wad.client", data: binmotor.wadYaz([{ hash: H(3), data: Buffer.from("x") }]) }]));
    const cikti = path.join(ok, "cikti.fantome");
    const r = await kaliciOnar(modFile, path.join(ok, "overlay"), [baska], cikti);
    assert.deepStrictEqual(r, { degisen: 1, ortak: 1 });
    const zip = new (require("node-stream-zip").async)({ file: cikti });
    const w = await zip.entryData("WAD/Map11.wad.client");
    assert.strictEqual(JSON.parse(await zip.entryData("META/info.json")).Name, "M");
    await zip.close();
    const veri = (h) => binmotor.wadEntryVeri(w, binmotor.wadOku(w).entries.find((e) => e.hash === h)).toString();
    assert.strictEqual(veri(H(1)), "onarilmis-1");
    assert.strictEqual(veri(H(2)), "ayni-2");
    assert.strictEqual(veri(H(3)), "eski-3");
    assert.strictEqual(binmotor.wadOku(w).entries.length, 3, "oyunun diğer entry'leri moda eklenmez");
    // overlay'de modun WAD'ı yoksa: değişiklik yok, çökme yok
    assert.deepStrictEqual(await kaliciOnar(modFile, path.join(ok, "yok"), [], cikti), { degisen: 0, ortak: 0 });
    console.log("kalıcı onarım: TÜM testler GEÇTİ");
  } catch (e) {
    console.error(e);
    process.exitCode = 1;
  } finally {
    fs.rmSync(ok, { recursive: true, force: true });
  }
})();

// ---------------- Mod sürümü (aynı adlı modları ayırt etmek için) ----------------
const { readSkinInfo } = require("../src/engine");
const sk = fs.mkdtempSync(path.join(os.tmpdir(), "skin-surum-"));
(async () => {
  try {
    const f = path.join(sk, "a.fantome");
    fs.writeFileSync(f, buildStoreZip([{ name: "META/info.json", data: Buffer.from('{"Name":"Old Tiamat","Author":"Yazar","Version":" 1.6.9 "}') }]));
    assert.deepStrictEqual(await readSkinInfo(f), { name: "Old Tiamat", author: "Yazar", version: "1.6.9" });
    const g = path.join(sk, "b.fantome");
    fs.writeFileSync(g, buildStoreZip([{ name: "META/info.json", data: Buffer.from('{"Name":"X","Version":5}') }]));
    assert.strictEqual((await readSkinInfo(g)).version, "", "metin olmayan sürüm yok sayılır");
    assert.strictEqual((await readSkinInfo(path.join(sk, "c.wad.client"))).version, "", "wad dosyasında sürüm yok");
    console.log("mod sürümü: TÜM testler GEÇTİ");
  } catch (e) {
    console.error(e);
    process.exitCode = 1;
  } finally {
    fs.rmSync(sk, { recursive: true, force: true });
  }
})();
