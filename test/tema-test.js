// Fiddlesticks görselleri + tema düğmesini dener: electron test/tema-test.js
const { app, BrowserWindow } = require("electron");
const fs = require("node:fs");
const path = require("node:path");
const cikti = path.join(__dirname, "..", ".veri-test");
app.setPath("userData", path.join(cikti, "ui"));
process.env.SKIN_INTRO_YOK = "1";
require("../src/main.js");
const bekle = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log("[tema-test]", ...a);
app.whenReady().then(async () => {
  let kod = 0;
  try {
    let win;
    for (let i = 0; i < 300 && !(win = BrowserWindow.getAllWindows()[0]); i++) await bekle(100);
    const js = (k) => win.webContents.executeJavaScript(k, true);
    const foto = async (ad) => {
      win.show();
      win.focus();
      for (let i = 0; i < 8; i++) {
        await bekle(500);
        const png = (await win.webContents.capturePage()).toPNG();
        if (png.length > 1000) return fs.writeFileSync(path.join(cikti, ad), png);
      }
      log("görüntü alınamadı:", ad);
    };
    for (let i = 0; i < 120 && (await js(`document.querySelectorAll("#sol .oge").length`)) < 50; i++) await bekle(250);

    log("önceki kayıtlı tema:", await js(`localStorage.getItem("tema")`));
    await js(`localStorage.removeItem("tema"); document.documentElement.removeAttribute("data-theme");`);

    // Fiddlesticks: sol listede simge + kart görselleri
    await js(`[...document.querySelectorAll("#sol .oge")].find(x => x.textContent.includes("Fiddlesticks")).click()`);
    await bekle(1500);
    await js(`document.getElementById("liste").scrollTop = 99999`);
    await bekle(3500);
    const f = await js(`(() => {
      const sol = [...document.querySelectorAll("#sol .oge")].find(x => x.textContent.includes("Fiddlesticks")).querySelector("img");
      const k = [...document.querySelectorAll("#liste .kart img")];
      return { solSimge: !!sol && sol.complete && sol.naturalWidth > 0, kart: k.length, yuklenen: k.filter(x => x.complete && x.naturalWidth > 0).length,
               ilkAd: document.querySelector("#liste .kartAlt b").textContent };
    })()`);
    log("Fiddlesticks:", JSON.stringify(f));
    if (!f.solSimge || !f.kart || f.yuklenen !== f.kart) kod = 1;
    await foto("7-fiddle.png");

    // Tema: karanlık -> aydınlık -> hatırla
    const tema = () => js(`document.documentElement.dataset.theme || "dark"`);
    log("başlangıç teması:", await tema());
    await js(`document.getElementById("tema").click()`);
    await bekle(300);
    const acik = await tema();
    const renk = await js(`getComputedStyle(document.body).backgroundColor`);
    const saklanan = await js(`localStorage.getItem("tema")`);
    log("tıklayınca:", acik, "| zemin:", renk, "| kayıt:", saklanan);
    if (acik !== "light" || saklanan !== "light") kod = 1;
    await foto("8-aydinlik.png");
    await js(`document.getElementById("tema").click()`);
    await bekle(200);
    log("tekrar tıklayınca:", await tema());
    if ((await tema()) !== "dark") kod = 1;
    await js(`document.getElementById("tema").click()`); // aydınlık bırak: yeniden yükleme testi
    await win.webContents.reload();
    await bekle(2500);
    log("yeniden yükleme sonrası tema:", await tema());
    if ((await tema()) !== "light") kod = 1;
    await js(`document.getElementById("tema").click()`); // karanlığa geri al (test verisi)
  } catch (e) {
    log("HATA:", e.message);
    kod = 1;
  }
  process.exitCode = kod;
  log("bitti, kod =", kod);
  app.quit();
});
