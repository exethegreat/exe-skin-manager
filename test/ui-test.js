// Arayüzü baştan sona dener ve ekran görüntüsü alır: electron test/ui-test.js
// Ayrı bir veri klasörü kullanır; gerçek ayarlara dokunmaz.
const { app, BrowserWindow } = require("electron");
const fs = require("node:fs");
const path = require("node:path");

const cikti = path.join(__dirname, "..", ".veri-test");
const veri = path.join(cikti, "ui");
app.setPath("userData", veri);
if (!process.env.INTRO_TEST) process.env.SKIN_INTRO_YOK = "1";
require("../src/main.js");

const bekle = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log("[ui-test]", ...a);

app.whenReady().then(async () => {
  let win;
  for (let i = 0; i < 300 && !(win = BrowserWindow.getAllWindows()[0]); i++) await bekle(100);
  const js = (kod) => win.webContents.executeJavaScript(kod, true);
  const cek = async (ad) => {
    fs.writeFileSync(path.join(cikti, ad), (await win.webContents.capturePage()).toPNG());
    log("görüntü:", ad);
  };
  const durum = () => js(`document.getElementById("durum").className + " | " + document.getElementById("durumMetin").textContent`);
  const tikla = (secici, metin) =>
    js(`(() => { const e = [...document.querySelectorAll(${JSON.stringify(secici)})].find(x => x.textContent.includes(${JSON.stringify(metin)})); if (!e) return false; e.click(); return true; })()`);
  const bekleKi = async (kod, sn, ad) => {
    for (let i = 0; i < sn * 4; i++) {
      if (await js(kod)) return true;
      await bekle(250);
    }
    throw new Error("zaman aşımı: " + ad);
  };
  const hazirBekle = () => bekleKi(`/ready|error/.test(document.getElementById("durum").className)`, 120, "hazır");
  let kod = 0;
  try {
    await bekleKi(`document.querySelectorAll("#sol .oge").length > 50`, 30, "katalog");
    log("şampiyon sayısı:", (await js(`document.querySelectorAll("#sol .oge").length`)) - 2);
    await bekle(1500);
    await cek("1-acilis.png");

    if (!(await tikla("#sol .oge", "Teemo"))) throw new Error("Teemo yok");
    await bekle(300);
    log("Teemo skin adları:", await js(`[...document.querySelectorAll("#liste .satir b")].slice(0, 6).map(x => x.textContent).join(" | ")`));
    log("Teemo skin sayısı:", await js(`document.querySelectorAll("#liste .satir").length`));
    await js(`document.querySelectorAll("#liste .satir")[4].click()`);
    await bekleKi(`document.querySelectorAll("#liste .satir")[4].textContent.includes("indirildi")`, 60, "indirme");
    const dosya = path.join(veri, "indirilen", "Teemo");
    const ilk = fs.statSync(path.join(dosya, fs.readdirSync(dosya)[0])).mtimeMs;

    await tikla("#sol .oge", "Ahri");
    await bekle(300);
    await tikla("#liste .satir", "K/DA Ahri");
    await bekleKi(`document.querySelectorAll("#liste .etiket.inik").length > 0`, 60, "indirme 2");
    await cek("2-secim.png");

    await js(`document.getElementById("ana").click()`);
    await hazirBekle();
    log("uygula sonrası:", await durum());
    if (!(await durum()).includes("ready")) kod = 1;
    await cek("3-hazir.png");

    // Çalışırken seçimi değiştir: aynı skin'i kaldırıp yeniden seç (tekrar inmemeli), sonra Güncelle
    await tikla("#sol .oge", "Teemo");
    await bekle(300);
    await js(`document.querySelectorAll("#liste .satir")[4].click()`);
    await bekle(400);
    await js(`document.querySelectorAll("#liste .satir")[4].click()`);
    await bekle(800);
    const son = fs.statSync(path.join(dosya, fs.readdirSync(dosya)[0])).mtimeMs;
    log("tekrar indirildi mi:", ilk !== son);
    if (ilk !== son) kod = 1;
    log("Güncelle görünüyor mu:", await js(`!document.getElementById("ana").hidden && document.getElementById("ana").textContent`));
    await js(`document.getElementById("ana").click()`);
    await bekle(1000);
    await hazirBekle();
    log("güncelle sonrası:", await durum());
    if (!(await durum()).includes("ready")) kod = 1;

    await js(`document.getElementById("durdur").click()`);
    await bekleKi(`/idle|error/.test(document.getElementById("durum").className)`, 60, "durdur");
    log("durdur sonrası:", await durum());
    await tikla("#sol .oge", "Seçilenler");
    await bekle(300);
    await cek("4-secilenler.png");
  } catch (e) {
    log("HATA:", e.message, "| durum:", await durum().catch(() => "?"));
    await cek("hata.png").catch(() => {});
    kod = 1;
  }
  process.exitCode = kod;
  log("bitti, kod =", kod);
  app.quit();
});
