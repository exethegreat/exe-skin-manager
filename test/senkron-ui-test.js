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
  // Sağlık rozeti için iki mod daha: Manager kararı "sağlıklı" (yeşil) ve "ölümcül hata" (kırmızı)
  const ekMod = (mid, ad) => {
    const f = path.join(veri, "skinler", `${mid}_${ad}.fantome`);
    fs.writeFileSync(f, buildStoreZip([{ name: "META/info.json", data: Buffer.from(JSON.stringify({ Name: ad })) }, { name: "WAD/x.wad.client/a.txt", data: Buffer.from(ad) }]));
    return { id: mid, file: f, name: ad, author: "", selected: false, tarifVar: true };
  };
  const lib = path.join(veri, "official-ltk-bridge", "libraries", "persistent");
  fs.mkdirSync(lib, { recursive: true });
  // Sarı (FIX) mod: Manager 5 onarım yaptı; overlay'de onarılmış hâli var → FIX tıklaması kalıcı onarmalı
  const sariId = "3".repeat(16);
  const sariFile = path.join(veri, "skinler", `${sariId}_Sari Test.fantome`);
  fs.writeFileSync(sariFile, buildStoreZip([
    { name: "META/info.json", data: Buffer.from('{"Name":"Sari Test"}') },
    { name: "WAD/Map11.wad.client", data: binmotor.wadYaz([{ hash: 77n, data: Buffer.from("eski") }]) }
  ]));
  const ovKlasor = path.join(lib, "profiles", "bocchi", "overlay", "DATA", "FINAL", "Maps", "Shipping");
  fs.mkdirSync(ovKlasor, { recursive: true });
  fs.writeFileSync(path.join(ovKlasor, "Map11.wad.client"), binmotor.wadYaz([{ hash: 77n, data: Buffer.from("onarilmis") }]));
  fs.writeFileSync(path.join(lib, "profiles", "bocchi", "overlay.json"), JSON.stringify({ enabledMods: ["m-sari"] }));
  fs.writeFileSync(path.join(lib, "bocchi-selection.json"), JSON.stringify({ packages: [{ sourceId: "3".repeat(64), sha256: "3".repeat(64), path: sariFile }] }));
  fs.writeFileSync(path.join(lib, "bocchi-bridge-events.jsonl"), JSON.stringify({ at: "2026-11-17T09:00:00Z", event: "mod-repaired", facts: { modId: "m-sari", repaired: 5 } }) + "\n");
  fs.writeFileSync(path.join(lib, "bocchi-sync.json"), JSON.stringify({ mods: { ["1".repeat(64)]: { id: "m-yesil" }, ["2".repeat(64)]: { id: "m-kirmizi" }, ["3".repeat(64)]: { id: "m-sari" } } }));
  fs.writeFileSync(path.join(lib, "mod-health-verdicts.json"), JSON.stringify({ verdicts: {
    "m-yesil": { health: "healthy", counts: { fatals: 0, errors: 0, warnings: 0 }, rules: [] },
    "m-kirmizi": { health: "unrepairable", counts: { fatals: 3, errors: 0, warnings: 0 }, rules: [{ rule: "bin/property-type" }] },
    "m-sari": { health: "healthy", counts: { fatals: 0, errors: 0, warnings: 0 }, rules: [], checkedAt: "2026-11-17T09:00:00Z" }
  } }));
  fs.writeFileSync(path.join(veri, "durum.json"), JSON.stringify({
    gamePath, selected: {}, yama: "26.22",
    custom: [
      { id, file: modFile, name: "Senkron Test", author: "x", selected: true, tarifVar: true, yama: "26.21" },
      ekMod("1".repeat(16), "Yesil Test"),
      ekMod("2".repeat(16), "Kirmizi Test"),
      { id: sariId, file: sariFile, name: "Sari Test", author: "", selected: false, tarifVar: true }
    ]
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
    for (let i = 0; i < 60 && !(rozet = await js(`!!document.querySelector("#liste .etiket.saglikFix")`)); i++) await bekle(250);
    kontrol("rozet görünüyor", rozet, await js(`document.querySelector("#liste .etiket.saglikFix")?.textContent || ""`));
    kontrol("senkron düğmesi var", await js(`!!document.querySelector("#liste .senkronBtn")`));
    const rozetler = await js(`[...document.querySelectorAll("#liste .satir")].map(r => [r.querySelector(".ad b").textContent, (r.querySelector(".etiket") || {}).className || "", (r.querySelector(".etiket") || {}).textContent || "", (r.querySelector(".etiket") || {}).title || ""])`);
    const bul = (ad) => rozetler.find((r) => r[0] === ad) || [];
    kontrol("yeşil Güncel rozeti", /saglikGuncel/.test(bul("Yesil Test")[1]) && bul("Yesil Test")[2] === "Güncel" && !!bul("Yesil Test")[3], JSON.stringify(bul("Yesil Test")));
    kontrol("kırmızı Tamir edilemez rozeti", /saglikBozuk/.test(bul("Kirmizi Test")[1]) && bul("Kirmizi Test")[2] === "Tamir edilemez", JSON.stringify(bul("Kirmizi Test")));
    kontrol("sarı FIX (senkron gerekli)", /saglikFix/.test(bul("Senkron Test")[1]) && bul("Senkron Test")[2] === "FIX", JSON.stringify(bul("Senkron Test")));
    const png1 = (await win.webContents.capturePage()).toPNG();
    fs.writeFileSync(path.join(cikti, "senkron-1-rozet.png"), png1);

    await js(`document.querySelector("#liste .senkronBtn").click()`);
    let rapor = "";
    for (let i = 0; i < 80 && !(rapor = await js(`document.querySelector("#liste .senkronRapor")?.innerText || ""`)); i++) await bekle(250);
    kontrol("rapor kutusu", /2 değişiklik/.test(rapor), JSON.stringify(rapor));
    const satirEtiket = (ad) => js(`(() => { const r = [...document.querySelectorAll("#liste .satir")].find(x => x.querySelector(".ad b").textContent === ${JSON.stringify(ad)}); const e = r && r.querySelector(".etiket"); return r ? (e ? e.className : "") : null; })()`);
    kontrol("rozet kalktı", !/saglikFix/.test(await satirEtiket("Senkron Test")));
    kontrol("türev dosya oluştu", fs.existsSync(path.join(veri, "tarifler", "abcdef0123456789.synced.fantome")));
    const durum = JSON.parse(fs.readFileSync(path.join(veri, "durum.json"), "utf8"));
    kontrol("durum.json synced alanı", /synced\.fantome$/.test((durum.custom.find((c) => c.name === "Senkron Test") || {}).synced || ""));
    fs.writeFileSync(path.join(cikti, "senkron-2-rapor.png"), (await win.webContents.capturePage()).toPNG());
    await js(`[...document.querySelectorAll("#liste .senkronRapor button")][0].click()`);
    await bekle(200);
    kontrol("Tamam raporu kapatır", !(await js(`!!document.querySelector("#liste .senkronRapor")`)));

    // Sarı FIX rozetine tıkla → kalıcı onarım (overlay'deki onarılmış hâl moda yazılır)
    kontrol("Sari Test FIX rozeti tıklanabilir", /saglikFix tiklanir/.test(await satirEtiket("Sari Test")), await satirEtiket("Sari Test"));
    await js(`[...document.querySelectorAll("#liste .satir")].find(x => x.querySelector(".ad b").textContent === "Sari Test").querySelector(".etiket").click()`);
    let onarRapor = "";
    for (let i = 0; i < 40 && !(onarRapor = await js(`document.querySelector("#liste .senkronRapor")?.innerText || ""`)); i++) await bekle(250);
    kontrol("onarım raporu", /Onarım raporu/.test(onarRapor) && /1 bölüm/.test(onarRapor), JSON.stringify(onarRapor));
    const onarilmis = path.join(veri, "tarifler", `${"3".repeat(16)}.synced.fantome`);
    kontrol("onarılmış kopya oluştu", fs.existsSync(onarilmis));
    if (fs.existsSync(onarilmis)) {
      const StreamZip = require("node-stream-zip");
      const z = new StreamZip.async({ file: onarilmis });
      const w = await z.entryData("WAD/Map11.wad.client");
      await z.close();
      kontrol("onarılmış içerik", binmotor.wadEntryVeri(w, binmotor.wadOku(w).entries[0]).toString() === "onarilmis");
    }
    kontrol("orijinal dokunulmadı", fs.existsSync(path.join(veri, "skinler", `${"3".repeat(16)}_Sari Test.fantome`)));
    await js(`document.querySelector("#liste .senkronRapor button").click()`);

    // Kırmızı rozete tıkla → onay → mod listeden ve diskten kalkar
    await js(`window.confirm = () => true; true`);
    await js(`[...document.querySelectorAll("#liste .satir")].find(x => x.querySelector(".ad b").textContent === "Kirmizi Test").querySelector(".etiket").click()`);
    let gitti = false;
    for (let i = 0; i < 40 && !(gitti = (await satirEtiket("Kirmizi Test")) === null); i++) await bekle(250);
    kontrol("Tamir edilemez tıklanınca mod kaldırıldı", gitti);
    kontrol("dosyası silindi", !fs.existsSync(path.join(veri, "skinler", `${"2".repeat(16)}_Kirmizi Test.fantome`)));
    // Onay verilmezse kaldırılmaz: kırmızı rozetli yeni durum yok, Yeşil rozet tıklanamaz olmalı
    kontrol("Güncel rozeti tıklanamaz", !/tiklanir/.test(await satirEtiket("Yesil Test")));
  } catch (e) {
    log("HATA:", e.message);
    kod = 1;
  }
  log("bitti, kod =", kod);
  process.exitCode = kod;
  app.quit();
});
