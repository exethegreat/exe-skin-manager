// "Kendi dosyalarım" akışı: .modpkg ekle, tik kaldır (silinmemeli), klasöre çıkar, klasör ekle, sil.
// electron test/kendi-test.js [modpkg yolu]   (ayrı veri klasörü kullanır)
const { app, BrowserWindow, dialog, shell } = require("electron");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const StreamZip = require("node-stream-zip");

const cikti = path.join(__dirname, "..", ".veri-test");
const veri = path.join(cikti, "kendi");
fs.rmSync(veri, { recursive: true, force: true });
app.setPath("userData", veri);
process.env.SKIN_INTRO_YOK = "1";

const ornek = process.argv.find((a) => /\.modpkg$/i.test(a)) || path.join(os.homedir(), "Desktop", "v135-old-rengar-rebirth.modpkg");
const cevaplar = [];
dialog.showOpenDialog = async () => ({ canceled: false, filePaths: cevaplar.shift() });
shell.openPath = async () => "";
require("../src/main.js");

const bekle = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log("[kendi-test]", ...a);

app.whenReady().then(async () => {
  let kod = 0;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "kendi-test-"));
  try {
    let win;
    for (let i = 0; i < 300 && !(win = BrowserWindow.getAllWindows()[0]); i++) await bekle(100);
    const js = (k) => win.webContents.executeJavaScript(k, true);
    const api = async (cagri) => {
      const r = await js(`window.api.${cagri}`);
      if (!r.ok) throw new Error(r.hata);
      return r.veri;
    };
    await bekle(1500);

    // 1) .modpkg ekle
    cevaplar.push([ornek]);
    let g = await api("skinSec()");
    assert.strictEqual(g.custom.length, 1, "modpkg eklenmedi");
    const s = g.custom[0];
    assert.strictEqual(s.name, "Old Rengar Rebirth");
    assert.strictEqual(s.selected, true);
    log("modpkg eklendi:", s.name, "|", s.author);

    // 2) tik kaldır: listede kalmalı, dosya silinmemeli
    g = await api(`isaretle(${JSON.stringify(s.id)}, false)`);
    assert.strictEqual(g.custom.length, 1, "tik kaldırınca silindi");
    assert.strictEqual(g.custom[0].selected, false);
    const kayit = JSON.parse(fs.readFileSync(path.join(veri, "durum.json"), "utf8"));
    assert.ok(fs.existsSync(kayit.custom[0].file), "dosya silindi");
    g = await api(`isaretle(${JSON.stringify(s.id)}, true)`);
    assert.strictEqual(g.custom[0].selected, true);
    log("tik kaldır/ekle: kalıcı");

    // 3) klasöre çıkar
    cevaplar.push([tmp]);
    await api(`cikar(${JSON.stringify(s.id)})`);
    const hedef = path.join(tmp, "Old Rengar Rebirth");
    const say = (d) => fs.readdirSync(d, { withFileTypes: true }).reduce((n, e) => n + (e.isDirectory() ? say(path.join(d, e.name)) : 1), 0);
    assert.strictEqual(say(hedef), 182, "çıkarılan dosya sayısı");
    assert.ok(fs.existsSync(path.join(hedef, "WAD", "rengar.wad.client", "data")), "WAD klasör düzeni yok");
    log("çıkarıldı:", say(hedef), "dosya, düzen WAD/rengar.wad.client/...");

    // 4) çıkarılan klasörü geri ekle (aynı içerik: yinelenen olabilir, hata vermemeli) ve yeni bir klasör ekle
    const yeni = path.join(tmp, "Deneme.wad.client");
    fs.mkdirSync(path.join(yeni, "assets"), { recursive: true });
    fs.writeFileSync(path.join(yeni, "assets", "a.bin"), "deneme");
    cevaplar.push([yeni]);
    g = await api("klasorSec()");
    assert.strictEqual(g.custom.length, 2, "klasör eklenmedi");
    const k = g.custom.find((x) => x.name === "Deneme.wad.client" || x.name.startsWith("Deneme"));
    assert.ok(k, "klasör adı: " + JSON.stringify(g.custom.map((x) => x.name)));
    const kk = JSON.parse(fs.readFileSync(path.join(veri, "durum.json"), "utf8")).custom.find((x) => x.id === k.id);
    const zip = new StreamZip.async({ file: kk.file });
    const adlar = Object.keys(await zip.entries());
    await zip.close();
    assert.ok(adlar.includes("WAD/Deneme.wad.client/assets/a.bin"), adlar.join(","));
    log("klasör eklendi:", adlar.join(", "));

    // 5) geçersiz klasör anlamlı hata vermeli
    const bos = path.join(tmp, "bos");
    fs.mkdirSync(bos);
    fs.writeFileSync(path.join(bos, "x.txt"), "x");
    cevaplar.push([bos]);
    const hata = await api("klasorSec()").then(() => null, (e) => String(e.message));
    assert.ok(hata, "boş klasör hata vermedi");
    log("geçersiz klasör hatası:", hata.slice(0, 120));

    // 5b) gerçek motorla uygula (oyun kapalı olmalı): dönüştürülen paket Manager tarafından kabul edilmeli
    g = await api(`isaretle(${JSON.stringify(k.id)}, false)`);
    g = await api("uygula()");
    assert.ok(g.running, "motor çalışmıyor: " + JSON.stringify(g.status));
    for (let i = 0; i < 240 && !/ready|error/.test(g.status.kind); i++) {
      await bekle(500);
      g = await api("durumAl()");
    }
    log("uygula:", g.status.kind, "|", g.status.text);
    assert.strictEqual(g.status.kind, "ready", "motor hazır olmadı: " + g.status.text);
    g = await api("durdur()");

    // 6) sil
    g = await api(`sil(${JSON.stringify(s.id)})`);
    assert.strictEqual(g.custom.length, 1);
    assert.ok(!fs.existsSync(kayit.custom[0].file), "silinen dosya duruyor");
    log("sil OK");
    log("TAMAM");
  } catch (e) {
    log("HATA", e && e.stack ? e.stack : e);
    kod = 1;
  }
  fs.rmSync(tmp, { recursive: true, force: true });
  process.exitCode = kod;
  app.quit();
});
