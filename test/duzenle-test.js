"use strict";

// Mod düzenleme: içerik okuma + yeniden paketleme + kimlik taşıma kuralı (node test/duzenle-test.js)
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const StreamZip = require("node-stream-zip");
const { buildStoreZip } = require("../src/engine");
const { modIcerigi, yenidenPaketle, kimlikTasima } = require("../src/modduzenle");

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "skin-duzenle-"));
const B = (s) => Buffer.from(s);
const adlar = (g) => g.map((x) => x.name).sort();
const bul = (g, ad) => g.find((x) => x.name === ad);
const bos = { wadSil: [], wadEkle: [], bilinmeyenSil: false, resim: null };

(async () => {
  try {
    const info = { Name: "A", Author: "x", Version: "1", Description: "", Layers: [1] };
    const mod = path.join(tmp, "mod.fantome");
    fs.writeFileSync(
      mod,
      buildStoreZip([
        { name: "META/info.json", data: B(JSON.stringify(info)) },
        { name: "META/image.png", data: B("PNG1") },
        { name: "WAD/Udyr.wad.client/data/a.bin", data: B("bin") },
        { name: "WAD/Udyr.wad.client/data/a.py", data: B("dokum") },
        { name: "WAD/Ahri.wad.client", data: B("ahri") },
        { name: "README.txt", data: B("oku") }
      ])
    );

    // İçerik
    const ic = await modIcerigi(mod);
    assert.deepStrictEqual(ic.wadlar, [{ ad: "Ahri.wad.client", dosya: 1 }, { ad: "Udyr.wad.client", dosya: 2 }]);
    assert.strictEqual(ic.bilinmeyen, 2, "README.txt + a.py");
    assert.strictEqual(ic.resimVar, true);
    assert.strictEqual(ic.info.Name, "A");

    // Yalnız bilgi değişimi: WAD'lar bayt bayt aynı, bilinmeyen anahtarlar korunur, boş Home yazılmaz
    const bilgi = { Name: "B", Author: "x", Version: "1".repeat(30), Home: "", Heart: "h", Description: "d" };
    let r = await yenidenPaketle(mod, { ...bos, bilgi });
    assert.strictEqual(r.wadDegisti, false);
    const yeniInfo = JSON.parse(bul(r.girdiler, "META/info.json").data);
    assert.strictEqual(yeniInfo.Name, "B");
    assert.deepStrictEqual(yeniInfo.Layers, [1], "Layers korunur");
    assert.ok(!("Home" in yeniInfo), "boş Home yazılmaz");
    assert.strictEqual(yeniInfo.Heart, "h");
    assert.strictEqual(yeniInfo.Version.length, 24, "sürüm 24'e kırpılır");
    assert.strictEqual(bul(r.girdiler, "WAD/Ahri.wad.client").data.toString(), "ahri");
    assert.ok(bul(r.girdiler, "README.txt"), "bilinmeyenSil kapalıyken kalır");

    // WAD sil
    r = await yenidenPaketle(mod, { ...bos, bilgi, wadSil: ["Ahri.wad.client"] });
    assert.strictEqual(r.wadDegisti, true);
    assert.ok(!r.girdiler.some((g) => g.name.startsWith("WAD/Ahri")));

    // WAD ekle: .wad → .wad.client; aynı adlı dosya klasör hâlinin yerine geçer
    const x = path.join(tmp, "X.wad");
    fs.writeFileSync(x, "x");
    const u = path.join(tmp, "Udyr.wad.client");
    fs.writeFileSync(u, "yeni-udyr");
    r = await yenidenPaketle(mod, { ...bos, bilgi, wadEkle: [{ yol: x }, { yol: u }] });
    assert.strictEqual(bul(r.girdiler, "WAD/X.wad.client").data.toString(), "x");
    assert.ok(!r.girdiler.some((g) => g.name.startsWith("WAD/Udyr.wad.client/")), "eski klasör girdileri gider");
    assert.strictEqual(bul(r.girdiler, "WAD/Udyr.wad.client").data.toString(), "yeni-udyr");

    // Klasör WAD ekle (dosya hâlindeki Ahri'nin yerine)
    const kd = path.join(tmp, "k", "Ahri.wad.client", "data");
    fs.mkdirSync(kd, { recursive: true });
    fs.writeFileSync(path.join(kd, "b.bin"), "b");
    r = await yenidenPaketle(mod, { ...bos, bilgi, wadEkle: [{ yol: path.join(tmp, "k", "Ahri.wad.client") }] });
    assert.ok(!bul(r.girdiler, "WAD/Ahri.wad.client"), "dosya hâli gider");
    assert.strictEqual(bul(r.girdiler, "WAD/Ahri.wad.client/data/b.bin").data.toString(), "b");

    // Bilinmeyenleri sil
    r = await yenidenPaketle(mod, { ...bos, bilgi, bilinmeyenSil: true });
    assert.ok(!bul(r.girdiler, "README.txt"));
    assert.ok(!bul(r.girdiler, "WAD/Udyr.wad.client/data/a.py"));
    assert.ok(bul(r.girdiler, "WAD/Udyr.wad.client/data/a.bin"));
    assert.strictEqual(r.wadDegisti, true);

    // Resim
    r = await yenidenPaketle(mod, { ...bos, bilgi, resim: "sil" });
    assert.ok(!bul(r.girdiler, "META/image.png"));
    const png = path.join(tmp, "r.png");
    fs.writeFileSync(png, "PNG2");
    r = await yenidenPaketle(mod, { ...bos, bilgi, resim: png });
    assert.strictEqual(bul(r.girdiler, "META/image.png").data.toString(), "PNG2");
    assert.strictEqual(r.wadDegisti, false);

    // Tek .wad.client dosyası olarak eklenmiş mod
    const tek = path.join(tmp, "Tek.wad.client");
    fs.writeFileSync(tek, "tek");
    const ic2 = await modIcerigi(tek);
    assert.deepStrictEqual(ic2.wadlar, [{ ad: "Tek.wad.client", dosya: 1 }]);
    r = await yenidenPaketle(tek, { ...bos, bilgi: { Name: "Tek", Author: "", Version: "1.0.0", Description: "" } });
    assert.deepStrictEqual(adlar(r.girdiler), ["META/info.json", "WAD/Tek.wad.client"]);

    // Üretilen zip okunabilir
    const z = path.join(tmp, "yeni.fantome");
    fs.writeFileSync(z, buildStoreZip(r.girdiler));
    const zip = new StreamZip.async({ file: z });
    assert.strictEqual(Object.keys(await zip.entries()).length, 2);
    await zip.close();

    // Kimlik taşıma kuralı
    assert.deepStrictEqual(kimlikTasima({ wadDegisti: false, synced: "x" }), { tarifTasi: true, senkronTasi: true, tarifYeniden: false });
    assert.deepStrictEqual(kimlikTasima({ wadDegisti: false, synced: "" }), { tarifTasi: true, senkronTasi: false, tarifYeniden: false });
    assert.deepStrictEqual(kimlikTasima({ wadDegisti: true, synced: "x" }), { tarifTasi: false, senkronTasi: false, tarifYeniden: true });

    console.log("tamam");
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
