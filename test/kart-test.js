// Resimli skin kartlarını dener: electron test/kart-test.js  (.veri-test/6-kartlar.png üretir)
const { app, BrowserWindow } = require("electron");
const fs = require("node:fs");
const path = require("node:path");
const cikti = path.join(__dirname, "..", ".veri-test");
app.setPath("userData", path.join(cikti, "ui"));
process.env.SKIN_INTRO_YOK = "1";
require("../src/main.js");
const bekle = (ms) => new Promise((r) => setTimeout(r, ms));
app.whenReady().then(async () => {
  let kod = 0;
  try {
    let win;
    for (let i = 0; i < 300 && !(win = BrowserWindow.getAllWindows()[0]); i++) await bekle(100);
    const js = (k) => win.webContents.executeJavaScript(k, true);
    for (let i = 0; i < 120 && (await js(`document.querySelectorAll("#sol .oge").length`)) < 50; i++) await bekle(250);
    await js(`[...document.querySelectorAll("#sol .oge")].find(x => x.textContent.includes("Teemo")).click()`);
    await bekle(4000);
    const d = await js(`(() => { const i = [...document.querySelectorAll("#liste .kart img")]; return { kart: i.length, yuklenen: i.filter(x => x.complete && x.naturalWidth > 0).length, yama: document.getElementById("yama").textContent }; })()`);
    console.log("[kart-test]", JSON.stringify(d));
    if (!d.kart || d.yuklenen < 3) kod = 1;
    fs.writeFileSync(path.join(cikti, "6-kartlar.png"), (await win.webContents.capturePage()).toPNG());
  } catch (e) {
    console.log("[kart-test] HATA:", e.message);
    kod = 1;
  }
  process.exitCode = kod;
  app.quit();
});
