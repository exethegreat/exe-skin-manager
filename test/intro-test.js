// Introyu dener: electron test/intro-test.js  (video/ses oynuyor mu, ardından ana pencere açılıyor mu)
const { app, BrowserWindow } = require("electron");
const fs = require("node:fs");
const path = require("node:path");
const cikti = path.join(__dirname, "..", ".veri-test");
app.setPath("userData", path.join(cikti, "ui"));
const t0 = Date.now();
require("../src/main.js");
const bekle = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log("[intro-test]", ((Date.now() - t0) / 1000).toFixed(1) + "s", ...a);
app.whenReady().then(async () => {
  let kod = 0;
  try {
    await bekle(1800);
    const intro = BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().endsWith("intro.html"));
    if (!intro) throw new Error("intro penceresi yok");
    const d = await intro.webContents.executeJavaScript(
      `(() => { const v = document.querySelector("video"), a = document.querySelector("audio"); return { video: v.currentTime, videoDurdu: v.paused, videoHata: v.error && v.error.message, ses: a.currentTime, sesDurdu: a.paused, boyut: v.videoWidth + "x" + v.videoHeight }; })()`
    );
    log(JSON.stringify(d), "pencere:", intro.getSize().join("x"));
    fs.writeFileSync(path.join(cikti, "intro.png"), (await intro.webContents.capturePage()).toPNG());
    if (!(d.video > 0.5) || !(d.ses > 0.5)) kod = 1;
    const ana = () => BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().endsWith("index.html"));
    log("intro sırasında ana pencere görünür mü:", !!ana() && ana().isVisible());
    await bekle(2600);
    log("intro kapandı mı:", intro.isDestroyed(), "| ana pencere görünür:", !!ana() && ana().isVisible(), "| başlık:", ana() && ana().getTitle());
    if (!intro.isDestroyed() || !ana() || !ana().isVisible()) kod = 1;
    fs.writeFileSync(path.join(cikti, "5-ana.png"), (await ana().webContents.capturePage()).toPNG());
  } catch (e) {
    log("HATA:", e.message);
    kod = 1;
  }
  process.exitCode = kod;
  log("bitti, kod =", kod);
  app.quit();
});
