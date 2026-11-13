// Ayarlar sekmesini dener: electron test/ayar-test.js
const { app, BrowserWindow } = require("electron");
const fs = require("node:fs");
const path = require("node:path");
const cikti = path.join(__dirname, "..", ".veri-test");
app.setPath("userData", path.join(cikti, "ui-ayar"));
process.env.SKIN_INTRO_YOK = "1";
require("../src/main.js");
const bekle = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log("[ayar-test]", ...a);
app.whenReady().then(async () => {
  let kod = 0;
  const kontrol = (ad, ok) => {
    log(ok ? "OK   " : "HATA ", ad);
    if (!ok) kod = 1;
  };
  try {
    let win;
    for (let i = 0; i < 300 && !(win = BrowserWindow.getAllWindows()[0]); i++) await bekle(100);
    const js = (k) => win.webContents.executeJavaScript(k, true);
    const foto = async (ad) => {
      win.show();
      for (let i = 0; i < 8; i++) {
        await bekle(500);
        const png = (await win.webContents.capturePage()).toPNG();
        if (png.length > 1000) return fs.writeFileSync(path.join(cikti, ad), png);
      }
    };
    for (let i = 0; i < 120 && (await js(`document.querySelectorAll("#sol .oge").length`)) < 5; i++) await bekle(250);
    const tikla = (metin) => js(`[...document.querySelectorAll("#sol .oge")].find(x => x.textContent.includes(${JSON.stringify(metin)})).click()`);
    const durum = () => js(`document.querySelector(".ayarDurum") && document.querySelector(".ayarDurum").textContent`);
    const hata = () => js(`document.getElementById("durumMetin").textContent`);
    const kutu = () => js(`document.querySelector(".ayar input").value`);
    const yaz = async (metin, dugme) => {
      await js(`(() => { const i = document.querySelector(".ayar input"); i.value = ${JSON.stringify(metin)}; i.dispatchEvent(new Event("input")); })()`);
      await js(`[...document.querySelectorAll(".ayarSatir button")].find(b => b.textContent.includes(${JSON.stringify(dugme)})).click()`);
      await bekle(700);
    };

    kontrol("başlık", win.getTitle() === "EXE Skin Manager");
    await tikla("Ayarlar");
    await bekle(300);
    kontrol("Ayarlar sayfası açıldı", (await js(`document.getElementById("baslik").textContent`)) === "Ayarlar");
    log("başlangıç durumu:", await durum());
    await foto("9-ayarlar.png");

    await yaz("C:\\olmayan\\klasor", "Kaydet");
    kontrol("geçersiz yol reddedildi", /bulunamadı/.test(await hata()));
    kontrol("kutuda yazılan korundu", (await kutu()) === "C:\\olmayan\\klasor");

    await yaz("", "Kaydet");
    kontrol("boş yol reddedildi", /boş/.test(await hata()));

    await yaz('"C:\\Riot Games\\League of Legends"', "Kaydet");
    kontrol("tırnaklı üst klasör Game'e çevrildi", (await kutu()).endsWith("League of Legends\\Game") && /Geçerli/.test(await durum()));

    await yaz("C:\\Riot Games\\League of Legends\\Game\\League of Legends.exe", "Kaydet");
    kontrol("exe yolu klasöre çevrildi", (await kutu()).endsWith("League of Legends\\Game"));

    await yaz("", "Otomatik bul");
    kontrol("otomatik bul çalıştı", /Geçerli/.test(await durum()) && (await kutu()).includes("League of Legends"));

    const kayit = JSON.parse(fs.readFileSync(path.join(cikti, "ui-ayar", "durum.json"), "utf8"));
    kontrol("ayar diske yazıldı", /League of Legends\\Game$/.test(kayit.gamePath));
    await foto("10-ayarlar-gecerli.png");
  } catch (e) {
    log("HATA:", e.message);
    kod = 1;
  }
  process.exitCode = kod;
  log("bitti, kod =", kod);
  app.quit();
});
