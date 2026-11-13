// Motoru arayüz olmadan dener: node test/motor-test.js "<skin dosyası>" ["<oyun klasörü>"]
const path = require("node:path");
const { Engine, readSkinInfo } = require("../src/engine");

const skin = process.argv[2];
const game = process.argv[3] || "C:\\Riot Games\\League of Legends\\Game";
if (!skin) {
  console.error("Kullanım: node test/motor-test.js <skin.fantome> [oyun klasörü]");
  process.exit(2);
}

const kok = path.join(__dirname, "..");
const engine = new Engine({
  root: path.join(kok, ".veri-test", "official-ltk-bridge"),
  bridgeExe: path.join(kok, "motor", "exe-motor.exe"),
  managerSource: path.join(kok, "motor", "app")
});
const t0 = Date.now();
const log = (...a) => console.log(`[${((Date.now() - t0) / 1000).toFixed(2)}s]`, ...a);
engine.on("frame", (f) => log("kare:", JSON.stringify(f).slice(0, 300)));
engine.on("closed", (e) => log("motor kapandı", e || "(temiz)"));

(async () => {
  log("skin:", JSON.stringify(await readSkinInfo(skin)));
  try {
    await engine.apply([skin], game);
    log("UYGULANDI, active =", engine.active);
    await new Promise((r) => setTimeout(r, 6000));
    await engine.stop();
    log("DURDURULDU");
    await engine.apply([skin], game);
    log("İKİNCİ UYGULAMA tamam");
    await new Promise((r) => setTimeout(r, 2000));
  } catch (e) {
    log("HATA:", e.message);
    process.exitCode = 1;
  } finally {
    await engine.shutdown();
    log("kapatıldı");
  }
})();
