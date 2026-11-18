// ✎ Mod düzenleme penceresi uçtan uca (arayüz): electron test/duzenle-ui-test.js
// Sentetik mod: ✎ → ad değiştir → Kaydet → listede yeni ad, seçim korunur, dosya yeni kimlikle; WAD sil → moddan gider.
// Gerçek oyuna/ayarlara dokunmaz (.veri-test\duzenle).
const { app, BrowserWindow } = require("electron");
const fs = require("node:fs");
const path = require("node:path");
const cikti = path.join(__dirname, "..", ".veri-test");
const veri = path.join(cikti, "duzenle");
fs.rmSync(veri, { recursive: true, force: true });
fs.mkdirSync(veri, { recursive: true });
for (const f of ["katalog.json", "dil-tr_TR.json"]) {
  const k = path.join(cikti, "ui-dil", f);
  if (fs.existsSync(k)) fs.copyFileSync(k, path.join(veri, f)); // katalog önbelleği: ağ beklemesin
}
app.setPath("userData", veri);
process.env.SKIN_INTRO_YOK = "1";

const StreamZip = require("node-stream-zip");
const { buildStoreZip } = require("../src/engine");
const log = (...a) => console.log("[duzenle-ui]", ...a);
const bekle = (ms) => new Promise((r) => setTimeout(r, ms));
const durumOku = () => JSON.parse(fs.readFileSync(path.join(veri, "durum.json"), "utf8"));
async function zipAdlari(file) {
  const z = new StreamZip.async({ file });
  try {
    return Object.keys(await z.entries());
  } finally {
    await z.close();
  }
}

const id = "abcdef0123456789";
const modFile = path.join(veri, "skinler", `${id}_Duzenle Test.fantome`);
fs.mkdirSync(path.dirname(modFile), { recursive: true });
fs.writeFileSync(modFile, buildStoreZip([
  { name: "META/info.json", data: Buffer.from(JSON.stringify({ Name: "Duzenle Test", Author: "x", Version: "1.0", Description: "eski" })) },
  { name: "WAD/Ahri.wad.client", data: Buffer.from("ahri") },
  { name: "WAD/Udyr.wad.client/data/a.bin", data: Buffer.from("bin") }
]));
fs.writeFileSync(path.join(veri, "durum.json"), JSON.stringify({ gamePath: "", selected: {}, custom: [{ id, file: modFile, name: "Duzenle Test", author: "x", version: "1.0", selected: true }] }));
require("../src/main.js");

app.whenReady().then(async () => {
  let kod = 0;
  const kontrol = (ad, ok, ek = "") => {
    log(ok ? "OK  " : "HATA", ad, ek);
    if (!ok) kod = 1;
  };
  try {
    let win;
    for (let i = 0; i < 600 && !(win = BrowserWindow.getAllWindows()[0]); i++) await bekle(100);
    const js = (s) => win.webContents.executeJavaScript(s);
    for (let i = 0; i < 300 && !(await js(`!!document.getElementById("sol")`).catch(() => false)); i++) await bekle(100);
    await bekle(1500);
    await js(`[...document.querySelectorAll("#sol .oge")][1].click()`); // Kendi dosyalarım
    await bekle(300);
    kontrol("✎ düğmesi var", await js(`!!document.querySelector("#liste .duzenleBtn")`));
    await js(`document.querySelector("#liste .duzenleBtn").click()`);
    let acik = false;
    for (let i = 0; i < 40 && !(acik = await js(`!!document.querySelector(".pencere")`)); i++) await bekle(100);
    kontrol("pencere açıldı", acik);
    kontrol("Ad alanı dolu", (await js(`document.querySelector(".pencere [data-alan=Name]").value`)) === "Duzenle Test");
    kontrol("Açıklama alanı dolu", (await js(`document.querySelector(".pencere [data-alan=Description]").value`)) === "eski");

    // Ad boşken Kaydet pasif
    await js(`(() => { const i = document.querySelector(".pencere [data-alan=Name]"); i.value = "  "; i.dispatchEvent(new Event("input")); })()`);
    kontrol("ad boşken Kaydet pasif", await js(`document.querySelector(".pencere .pAlt .ana").disabled`));
    await js(`(() => { const i = document.querySelector(".pencere [data-alan=Name]"); i.value = "Yeni Ad"; i.dispatchEvent(new Event("input")); document.querySelector(".pencere [data-alan=Version]").value = "2.0"; })()`);
    fs.writeFileSync(path.join(cikti, "duzenle-1-bilgi.png"), (await win.webContents.capturePage()).toPNG());
    await js(`document.querySelector(".pencere .pAlt .ana").click()`);
    let yeni = false;
    for (let i = 0; i < 60 && !(yeni = await js(`[...document.querySelectorAll("#liste .satir .ad b")].some(b => b.textContent === "Yeni Ad")`)); i++) await bekle(150);
    kontrol("listede yeni ad", yeni);
    kontrol("pencere kapandı", !(await js(`!!document.querySelector(".pencere")`)));
    kontrol("satır hâlâ seçili", await js(`document.querySelector("#liste .satir").classList.contains("secili")`));
    let d = durumOku().custom[0];
    kontrol("kimlik değişti", d.id !== id && /^[0-9a-f]{16}$/.test(d.id), d.id);
    kontrol("yeni dosya var, eskisi silindi", fs.existsSync(d.file) && !fs.existsSync(modFile), d.file);
    kontrol("sürüm kayıtta", d.version === "2.0");

    // Dosyalar sekmesi: Ahri WAD'ını sil
    await js(`document.querySelector("#liste .duzenleBtn").click()`);
    for (let i = 0; i < 40 && !(await js(`!!document.querySelector(".pencere")`)); i++) await bekle(100);
    await js(`document.querySelectorAll(".pencere .sekme")[1].click()`);
    const wadlar = await js(`[...document.querySelectorAll(".pencere .wadSatir .ad b")].map(b => b.textContent)`);
    kontrol("WAD listesi", JSON.stringify(wadlar) === JSON.stringify(["Ahri.wad.client", "Udyr.wad.client"]), JSON.stringify(wadlar));
    await js(`document.querySelector(".pencere .wadSatir .sil").click()`);
    kontrol("silinecek işaretlendi", await js(`document.querySelector(".pencere .wadSatir").classList.contains("silinecek")`));
    await bekle(400); // ekran görüntüsü yeni kareyi yakalasın
    fs.writeFileSync(path.join(cikti, "duzenle-2-dosyalar.png"), (await win.webContents.capturePage()).toPNG());
    const eskiDosya = d.file;
    await js(`document.querySelector(".pencere .pAlt .ana").click()`);
    for (let i = 0; i < 60 && (await js(`!!document.querySelector(".pencere")`)); i++) await bekle(150);
    d = durumOku().custom[0];
    const adlar = await zipAdlari(d.file);
    kontrol("Ahri moddan gitti", !adlar.some((a) => /Ahri/.test(a)) && adlar.some((a) => /Udyr/.test(a)), JSON.stringify(adlar));
    kontrol("eski dosya silindi", d.file !== eskiDosya && !fs.existsSync(eskiDosya));
    kontrol("listede tek mod", (await js(`document.querySelectorAll("#liste .satir").length`)) === 1);
  } catch (e) {
    log("HATA:", e.message);
    kod = 1;
  }
  log("bitti, kod =", kod);
  process.exitCode = kod;
  app.quit();
});
