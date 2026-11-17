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
    "m-a": temiz,
    "m-b": { ...temiz },
    "m-c": { health: "unrepairable", counts: { fatals: 3, errors: 0, warnings: 0 }, rules: [{ rule: "bin/property-type" }] }
  } }));
  fs.writeFileSync(path.join(lib, "bocchi-bridge-events.jsonl"), [
    JSON.stringify({ event: "mod-repaired", facts: { modId: "m-b", repaired: 5 } }),
    "bozuk satır",
    JSON.stringify({ event: "mod-repaired", facts: { modId: "m-b", repaired: 7 } })
  ].join("\n") + "\n");

  modSagliklari(lib, [
    { anahtar: "A", hash: "a".repeat(16) },
    { anahtar: "B", hash: "b".repeat(16) },
    { anahtar: "C", hash: "c".repeat(16) },
    { anahtar: "E", hash: "e".repeat(16) }
  ]).then((m) => {
    assert.deepStrictEqual(m.get("A"), { durum: "guncel", onarim: 0 });
    assert.deepStrictEqual(m.get("B"), { durum: "fix", onarim: 7 }, "son onarım sayısı");
    assert.deepStrictEqual(m.get("C"), { durum: "bozuk", onarim: 0 });
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
