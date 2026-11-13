// .modpkg → .fantome çevirisi ve motorun WAD adlandırması: node test/modpkg-test.js [modpkg yolu]
// ELECTRON_RUN_AS_NODE=1 electron test/modpkg-test.js ile uygulamanın kendi Node sürümünde de çalışır.
const assert = require("node:assert");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const StreamZip = require("node-stream-zip");
const { fantomeGirdileri } = require("../src/modpkg");
const { Engine, buildStoreZip, kotuPaketler } = require("../src/engine");

const log = (...a) => console.log("[modpkg-test]", ...a);
const ornek = process.argv[2] || path.join(os.homedir(), "Desktop", "v135-old-rengar-rebirth.modpkg");

(async () => {
  const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), "modpkg-test-"));
  try {
    assert.strictEqual(typeof require("node:zlib").zstdDecompressSync, "function", "zstd yok");
    log("Node", process.version);

    if (fs.existsSync(ornek)) {
      const r = await fantomeGirdileri(ornek, path.basename(ornek));
      const icerik = r.girdiler.filter((g) => g.name.startsWith("WAD/rengar.wad.client/assets/") || g.name.startsWith("WAD/rengar.wad.client/data/"));
      assert.strictEqual(icerik.length, 181, "181 oyun dosyası beklenirdi: " + icerik.length);
      assert.ok(r.girdiler.every((g) => g.data.length > 0), "boş dosya var");
      const info = JSON.parse(r.girdiler.find((g) => g.name === "META/info.json").data.toString());
      assert.strictEqual(info.Name, "Old Rengar Rebirth");
      assert.strictEqual(info.Version, "1.3.5");
      assert.ok(info.Author.includes("BACKSTAB"));
      const f = path.join(tmp, "a.fantome");
      await fsp.writeFile(f, buildStoreZip(r.girdiler));
      const zip = new StreamZip.async({ file: f });
      assert.strictEqual(Object.keys(await zip.entries()).length, 182);
      await zip.close();
      log("modpkg OK:", icerik.length, "dosya,", info.Name, info.Version);
    } else log("örnek modpkg yok, atlandı:", ornek);

    // Bozuk paket anlamlı hata vermeli
    const kotu = path.join(tmp, "kotu.modpkg");
    await fsp.writeFile(kotu, Buffer.from("bu bir modpkg degil, rastgele yazi dolgusu dolgu"));
    await assert.rejects(fantomeGirdileri(kotu, "kotu.modpkg"), (e) => e.k === "mModpkg");
    log("bozuk paket OK");

    // Motor: "<id>_Rengar.wad" → WAD/Rengar.wad.client
    const eng = new Engine({ root: path.join(tmp, "motor"), bridgeExe: "x", managerSource: "x" });
    const lib = path.join(tmp, "lib");
    await fsp.mkdir(lib, { recursive: true });
    const wad = path.join(tmp, "0123456789abcdef_Rengar.wad");
    await fsp.writeFile(wad, Buffer.from("RW\x03\x04sahte"));
    await eng.prepareSelection(lib, [wad]);
    const sel = JSON.parse(await fsp.readFile(path.join(lib, "bocchi-selection.json"), "utf8"));
    const zip = new StreamZip.async({ file: sel.packages[0].path });
    const adlar = Object.keys(await zip.entries());
    await zip.close();
    assert.ok(adlar.includes("WAD/Rengar.wad.client"), "WAD adı yanlış: " + adlar.join(","));
    log("WAD adlandırma OK:", adlar.join(", "));
    // Manager olay kaydı: onarılamaz (skinhack) paket yakalanmalı, sağlıklılar yakalanmamalı
    const satir = JSON.stringify({ at: "x", event: "start-accepted", facts: { health: [
      { health: { health: "unrepairable", problems: [{ title: "Skinhack", rule: "bin/skinhack" }] }, id: "a", name: "sha-kotu" },
      { health: { health: "healthy", problems: [] }, id: "b", name: "sha-iyi" },
      { error: "timeout", id: "c", name: "sha-hata" } ] } });
    const k = kotuPaketler(["yarim satir", satir, '{"event":"phase"}', ""].join(String.fromCharCode(10)));
    assert.deepStrictEqual(k, [{ sha: "sha-kotu", kurallar: ["Skinhack"] }]);
    assert.deepStrictEqual(kotuPaketler(""), []);
    log("skinhack tespiti OK");
    log("TAMAM");
  } finally {
    await fsp.rm(tmp, { recursive: true, force: true });
  }
})().catch((e) => {
  console.error("[modpkg-test] HATA", e);
  process.exit(1);
});
