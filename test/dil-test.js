// 13 dilin hepsini uçtan uca dener: electron test/dil-test.js
// Ayarlar'dan dile geçer; metinleri, yönü, şampiyon adlarını, hata mesajlarını ve taşan öğeleri denetler; ekran görüntüsü alır.
const { app, BrowserWindow } = require("electron");
const fs = require("node:fs");
const path = require("node:path");
const cikti = path.join(__dirname, "..", ".veri-test");
const veri = path.join(cikti, "ui-dil"); // sabit klasör: katalog ilk çalıştırmadan sonra önbellekte kalır
app.setPath("userData", veri);
process.env.SKIN_INTRO_YOK = "1";
require("../src/main.js");
const { DILLER, TABLO, t } = require("../src/ui/diller");
const bekle = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log("[dil-test]", ...a);

app.whenReady().then(async () => {
  let kod = 0;
  const kontrol = (ad, ok, ek = "") => {
    if (!ok) {
      kod = 1;
      log("HATA ", ad, ek);
    } else if (process.env.AYRINTI) log("OK   ", ad, ek);
  };
  try {
    // Tablo bütünlüğü: her satır 13 dilde dolu, {yer} tutucuları tüm dillerde aynı
    const { SATIRLAR } = require("../src/ui/diller");
    const tutucular = (s) => (String(s).match(/\{\w+\}/g) || []).sort().join(",");
    for (const satir of SATIRLAR) {
      kontrol(`tablo ${satir[0]}: ${DILLER.length} dil`, satir.length === DILLER.length + 1 && satir.slice(1).every((x) => typeof x === "string" && x.trim()), String(satir.length - 1));
      kontrol(`tablo ${satir[0]}: tutucular`, satir.slice(2).every((x) => tutucular(x) === tutucular(satir[1])));
    }
    for (const k of ["rozetSenkron", "btnSenkronla", "rapBaslik", "rapEntry", "rapEksikAsset", "rapTipUyumsuz", "rapYokBin", "rapTamam", "sSenkronlaniyor", "sSenkronlandi", "eTarifYok"]) {
      kontrol(`yeni anahtar ${k}`, k in TABLO.tr);
    }

    let win;
    for (let i = 0; i < 600 && !(win = BrowserWindow.getAllWindows()[0]); i++) await bekle(100);
    win.show();
    win.focus();
    win.webContents.on("console-message", (_e, seviye, mesaj) => { if (seviye >= 2) log("[sayfa]", mesaj); });
    const js = (k) => win.webContents.executeJavaScript(k, true);
    const foto = async (ad) => {
      for (let i = 0; i < 6; i++) {
        await bekle(400);
        const png = (await win.webContents.capturePage()).toPNG();
        if (png.length > 1000) return fs.writeFileSync(path.join(cikti, ad), png);
      }
    };
    const bekleKi = async (kosul, sn, ad) => {
      for (let i = 0; i < sn * 4; i++) {
        if (await js(kosul)) return true;
        await bekle(250);
      }
      throw new Error("zaman aşımı: " + ad);
    };
    await bekleKi(`document.querySelectorAll("#sol .oge").length > 100`, 120, "katalog");
    await bekle(1500);

    // Varsayılan: Türkçe
    const bas = await js(`({ lang: document.documentElement.lang, dir: document.documentElement.dir, ph: document.getElementById("ara").placeholder, ana: document.getElementById("ana").textContent })`);
    kontrol("açılışta Türkçe", bas.lang === "tr" && bas.dir === "ltr" && bas.ph === t("tr", "ara") && bas.ana === t("tr", "uygula"), JSON.stringify(bas));

    // Ayarlar sayfasına gir
    await js(`[...document.querySelectorAll("#sol .oge")].find(x => x.textContent.includes(${JSON.stringify(t("tr", "ayarlar"))})).click()`);
    await bekle(400);

    for (const d of process.env.DIL ? DILLER.filter((x) => process.env.DIL.split(",").includes(x.kod)) : DILLER) {
      // dile geç (arayüzdeki seçici üzerinden)
      await js(`(() => { const s = document.getElementById("dilSec"); s.value = ${JSON.stringify(d.kod)}; s.dispatchEvent(new Event("change")); })()`);
      await bekleKi(`document.documentElement.lang === ${JSON.stringify(d.kod)}`, 20, d.kod + " dili");
      await bekleKi(`!document.querySelector(".dilNot")`, 60, d.kod + " adlarının yüklenmesi");
      await bekle(500);
      const T = (k, v) => t(d.kod, k, v);

      const o = await js(`(() => {
        const sol = [...document.querySelectorAll("#sol .oge .ad")].map(x => x.textContent);
        const h2 = [...document.querySelectorAll(".ayar h2")].map(x => x.textContent);
        const dugmeler = [...document.querySelectorAll(".ayarSatir button")].map(x => x.textContent);
        const tasan = [...document.querySelectorAll("button, .chip, label, .ayarDurum, h1, h2")].filter(e => e.offsetParent && e.scrollWidth > e.clientWidth + 2).map(e => e.textContent.slice(0, 30));
        return { lang: document.documentElement.lang, dir: document.documentElement.dir, ph: document.getElementById("ara").placeholder,
                 ana: document.getElementById("ana").textContent, tema: document.getElementById("tema").title, baslik: document.getElementById("baslik").textContent,
                 sol: sol.slice(0, 3), h2, dugmeler, sec: document.getElementById("dilSec").value, tasan, yama: document.getElementById("yama").textContent };
      })()`);
      kontrol(d.kod + ": html lang/dir", o.lang === d.kod && o.dir === (d.rtl ? "rtl" : "ltr"), `${o.lang}/${o.dir}`);
      kontrol(d.kod + ": arama kutusu metni", o.ph === T("ara"), o.ph);
      kontrol(d.kod + ": Uygula düğmesi", o.ana === T("uygula"), o.ana);
      kontrol(d.kod + ": tema düğmesi ipucu", o.tema === T("temaAcik") || o.tema === T("temaKoyu"), o.tema);
      kontrol(d.kod + ": sol menü", o.sol[0] === T("secilenler") && o.sol[1] === T("kendi") && o.sol[2] === T("ayarlar"), JSON.stringify(o.sol));
      kontrol(d.kod + ": Ayarlar başlıkları", o.baslik === T("ayarlar") && o.h2[0] === T("ayarKlasorBaslik") && o.h2[1] === T("dilBaslik") && o.h2[2] === T("gunBaslik") && o.h2[3] === T("motorBaslik"), JSON.stringify(o.h2));
      kontrol(d.kod + ": klasör düğmeleri", JSON.stringify(o.dugmeler) === JSON.stringify([T("kaydet"), T("gozat"), T("otoBul")]), JSON.stringify(o.dugmeler));
      kontrol(d.kod + ": dil seçici doğru dilde", o.sec === d.kod);
      kontrol(d.kod + ": yama etiketi", o.yama === T("yama", { v: o.yama.replace(/^\D+/, "").replace(/\D*$/, "") }) || /\d\d\.\d\d/.test(o.yama), o.yama);
      kontrol(d.kod + ": taşan düğme/etiket yok", o.tasan.length === 0, JSON.stringify(o.tasan));

      // Hata mesajı seçili dilde gelmeli
      const hata = await js(`window.api.oyunYaz("").then(r => r.hata)`);
      kontrol(d.kod + ": hata mesajı", hata === T("eYolBos"), hata);
      const hata2 = await js(`window.api.oyunYaz("C:\\\\olmayan\\\\klasor").then(r => r.hata)`);
      kontrol(d.kod + ": klasör hatası", hata2 === T("eKlasorYok"), hata2);

      // Şampiyon adları: Riot desteği olan dillerde yerel, Hintçede İngilizce
      const teemoAdi = await js(`(() => { const e = [...document.querySelectorAll("#sol .oge .ad")].map(x => x.textContent); return { var: e.length, ilkleri: e.slice(3, 6) }; })()`);
      kontrol(d.kod + ": şampiyon listesi dolu", teemoAdi.var > 150, String(teemoAdi.var));

      // Şampiyon sayfası: Teemo kartları ve renk noktaları
      await js(`document.getElementById("ara").value = "teemo"; document.getElementById("ara").dispatchEvent(new Event("input"))`);
      await bekle(200);
      const teemoSol = await js(`[...document.querySelectorAll("#sol .oge .ad")].map(x => x.textContent).slice(3)`);
      kontrol(d.kod + ": arama İngilizce adla da buluyor", teemoSol.length >= 1, JSON.stringify(teemoSol));
      if (teemoSol.length) {
        await js(`[...document.querySelectorAll("#sol .oge")].filter(x => x.querySelector("img"))[0].click()`);
        await bekle(500);
        const sk = await js(`(() => { const k = [...document.querySelectorAll("#liste .kart")]; return { sayi: k.length, ilk: k.slice(0, 3).map(x => x.querySelector(".kartAlt b").textContent), nokta: document.querySelectorAll("#liste .nokta").length, baslik: document.getElementById("baslik").textContent }; })()`);
        kontrol(d.kod + ": Teemo kartları", sk.sayi === 15 && sk.nokta > 20, JSON.stringify(sk));
        if (d.kod === "ja" || d.kod === "ar" || d.kod === "ru" || d.kod === "zh" || d.kod === "hi" || d.kod === "de") await foto(`dil-${d.kod}-teemo.png`);
        if (process.env.AYRINTI) log(d.kod, "Teemo:", JSON.stringify(sk));
        await js(`[...document.querySelectorAll("#sol .oge")].find(x => x.textContent.includes(${JSON.stringify(T("ayarlar"))})).click()`);
        await bekle(300);
      }
      await js(`document.getElementById("ara").value = ""; document.getElementById("ara").dispatchEvent(new Event("input"))`);
      await bekle(200);
      await foto(`dil-${d.kod}-ayar.png`);

      // Ham çeviri anahtarı ekranda kalmamalı
      const anahtarlar = Object.keys(TABLO.tr);
      const ham = await js(`(() => { const an = new Set(${JSON.stringify(anahtarlar)}); return [...document.querySelectorAll("body *")].filter(e => e.children.length === 0 && an.has(e.textContent.trim())).map(e => e.textContent); })()`);
      kontrol(d.kod + ": ham anahtar yok", ham.length === 0, JSON.stringify(ham));
    }

    // Dil kaydedilmemeli
    const durum = JSON.parse(fs.readFileSync(path.join(veri, "durum.json"), "utf8"));
    kontrol("dil diske kaydedilmiyor (her açılışta Türkçe)", !("dil" in durum) && !JSON.stringify(durum).includes('"hi"'));
    log("tamamlandı:", DILLER.length, "dil denendi");
  } catch (e) {
    log("HATA:", e.message);
    kod = 1;
  }
  process.exitCode = kod;
  log("bitti, kod =", kod);
  app.quit();
});
