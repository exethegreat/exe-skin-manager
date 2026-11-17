// Mod Re-sync uçtan uca (arayüz): electron test/senkron-ui-test.js
// Sentetik oyun klasörü: mod "eski yamada" eklenir (tarif), oyun bin'i değişir → açılışta rozet + düğme,
// tık → rapor kutusu, senkron türevi dosyası oluşur. Gerçek oyuna/ayarlara dokunmaz.
const { app, BrowserWindow } = require("electron");
const fs = require("node:fs");
const path = require("node:path");
const cikti = path.join(__dirname, "..", ".veri-test");
const veri = path.join(cikti, "senkron");
fs.rmSync(veri, { recursive: true, force: true });
fs.mkdirSync(veri, { recursive: true });
for (const f of ["katalog.json", "dil-tr_TR.json"]) {
  const k = path.join(cikti, "ui-dil", f);
  if (fs.existsSync(k)) fs.copyFileSync(k, path.join(veri, f)); // katalog önbelleği: ağ beklemesin
}
app.setPath("userData", veri);
process.env.SKIN_INTRO_YOK = "1";

const binmotor = require("../src/binmotor");
const { buildStoreZip, tarifCikar } = require("../src/engine");
const log = (...a) => console.log("[senkron-ui]", ...a);
const bekle = (ms) => new Promise((r) => setTimeout(r, ms));

function prop(entries) {
  const head = Buffer.alloc(12 + entries.length * 4);
  head.write("PROP", 0, "latin1");
  head.writeUInt32LE(1, 4);
  head.writeUInt32LE(entries.length, 8);
  entries.forEach((e, i) => head.writeUInt32LE(e[1], 12 + i * 4));
  return Buffer.concat([head, ...entries.map(([k, , v]) => {
    const b = Buffer.alloc(10);
    b.writeUInt32LE(6, 0);
    b.writeUInt32LE(k, 4);
    b.writeUInt16LE(v, 8);
    return b;
  })]);
}

const gamePath = path.join(veri, "Game");
const wadPath = path.join(gamePath, "DATA", "FINAL", "champion.wad.client");
const ic = "characters/test/skins/skin01/skin.bin";
const oyunuYaz = (entries) => {
  fs.mkdirSync(path.dirname(wadPath), { recursive: true });
  fs.writeFileSync(wadPath, binmotor.wadYaz([{ hash: binmotor.yolHash(ic), data: prop(entries) }]));
};

async function hazirla() {
  fs.writeFileSync(path.join(gamePath, "League of Legends.exe"), "") ;
}

(async () => {
  // Eski yama + mod + tarif (mod eklendiği an), sonra yeni yama
  oyunuYaz([[1, 11, 1], [2, 12, 2]]);
  await hazirla();
  const id = "abcdef0123456789";
  const modFile = path.join(veri, "skinler", `${id}_Test.fantome`);
  fs.mkdirSync(path.dirname(modFile), { recursive: true });
  fs.writeFileSync(modFile, buildStoreZip([
    { name: "META/info.json", data: Buffer.from('{"Name":"Senkron Test","Author":"x"}') },
    { name: `WAD/champion.wad.client/${ic}`, data: prop([[1, 11, 9], [2, 12, 2], [3, 13, 3]]) }
  ]));
  const tarif = await tarifCikar(modFile, gamePath, { yama: "26.21" });
  fs.mkdirSync(path.join(veri, "tarifler"), { recursive: true });
  fs.writeFileSync(path.join(veri, "tarifler", `${id}.json`), JSON.stringify({ tarif, senkron: null }));
  fs.writeFileSync(path.join(veri, "durum.json"), JSON.stringify({
    gamePath, selected: {}, yama: "26.22",
    custom: [{ id, file: modFile, name: "Senkron Test", author: "x", selected: true, tarifVar: true, yama: "26.21" }]
  }));
  oyunuYaz([[1, 11, 1], [2, 12, 22], [4, 14, 4]]); // yeni yama
  require("../src/main.js");
})();

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
    let rozet = false;
    for (let i = 0; i < 60 && !(rozet = await js(`!!document.querySelector("#liste .etiket.senkronGerek")`)); i++) await bekle(250);
    kontrol("rozet görünüyor", rozet, await js(`document.querySelector("#liste .etiket.senkronGerek")?.textContent || ""`));
    kontrol("senkron düğmesi var", await js(`!!document.querySelector("#liste .senkronBtn")`));
    const png1 = (await win.webContents.capturePage()).toPNG();
    fs.writeFileSync(path.join(cikti, "senkron-1-rozet.png"), png1);

    await js(`document.querySelector("#liste .senkronBtn").click()`);
    let rapor = "";
    for (let i = 0; i < 80 && !(rapor = await js(`document.querySelector("#liste .senkronRapor")?.innerText || ""`)); i++) await bekle(250);
    kontrol("rapor kutusu", /2 değişiklik/.test(rapor), JSON.stringify(rapor));
    kontrol("rozet kalktı", !(await js(`!!document.querySelector("#liste .etiket.senkronGerek")`)));
    kontrol("türev dosya oluştu", fs.existsSync(path.join(veri, "tarifler", "abcdef0123456789.synced.fantome")));
    const durum = JSON.parse(fs.readFileSync(path.join(veri, "durum.json"), "utf8"));
    kontrol("durum.json synced alanı", /synced\.fantome$/.test(durum.custom[0].synced || ""));
    fs.writeFileSync(path.join(cikti, "senkron-2-rapor.png"), (await win.webContents.capturePage()).toPNG());
    await js(`[...document.querySelectorAll("#liste .senkronRapor button")][0].click()`);
    await bekle(200);
    kontrol("Tamam raporu kapatır", !(await js(`!!document.querySelector("#liste .senkronRapor")`)));
  } catch (e) {
    log("HATA:", e.message);
    kod = 1;
  }
  log("bitti, kod =", kod);
  process.exitCode = kod;
  app.quit();
});
