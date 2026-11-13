// Renk paketi ve form seçimini uçtan uca dener: electron test/varyant-test.js
// Her çalıştırmada yeni, benzersiz bir veri klasörü kullanır (gerçek ayarlara dokunmaz).
const { app, BrowserWindow } = require("electron");
const fs = require("node:fs");
const path = require("node:path");
const cikti = path.join(__dirname, "..", ".veri-test");
const veri = path.join(cikti, "ui-varyant-" + Date.now());
app.setPath("userData", veri);
process.env.SKIN_INTRO_YOK = "1";
require("../src/main.js");
const bekle = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log("[varyant-test]", ...a);

app.whenReady().then(async () => {
  let kod = 0;
  const kontrol = (ad, ok, ek = "") => {
    log(ok ? "OK   " : "HATA ", ad, ek);
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
    const bekleKi = async (kosul, sn, ad) => {
      for (let i = 0; i < sn * 4; i++) {
        if (await js(kosul)) return true;
        await bekle(250);
      }
      throw new Error("zaman aşımı: " + ad);
    };
    const durum = () => JSON.parse(fs.readFileSync(path.join(veri, "durum.json"), "utf8"));
    const zipMi = (p) => {
      if (!fs.existsSync(p)) return false;
      const b = fs.readFileSync(p);
      return b.length > 100 && b[0] === 0x50 && b[1] === 0x4b;
    };
    const sampiyon = async (ad) => {
      await js(`[...document.querySelectorAll("#sol .oge")].find(x => x.textContent.includes(${JSON.stringify(ad)})).click()`);
      await bekle(600);
    };
    const kart = (ad) => `[...document.querySelectorAll("#liste .kart")].find(k => k.querySelector(".kartAlt b").textContent.includes(${JSON.stringify(ad)}))`;

    await bekleKi(`document.querySelectorAll("#sol .oge").length > 100`, 40, "katalog");

    // 1) Renk paketi: Teemo / Omega Timi (3 renk)
    await sampiyon("Teemo");
    await bekleKi(`!!(${kart("Omega Timi")})`, 60, "Türkçe skin adlarının yüklenmesi");
    const noktalar = await js(`(() => { const k = ${kart("Omega Timi")}; return k ? [...k.querySelectorAll(".nokta")].map(n => n.getAttribute("aria-label")) : null; })()`);
    kontrol("Omega Timi kartında 3 renk noktası", Array.isArray(noktalar) && noktalar.length === 3, JSON.stringify(noktalar));
    kontrol("renk adları Türkçe", Array.isArray(noktalar) && noktalar.some((t) => /İnci|Kumtaşı|Obsidiyen/.test(t)));
    await js(`${kart("Omega Timi")}.scrollIntoView({ block: "center" })`);
    await foto("11-renk-noktalari.png");

    await js(`${kart("Omega Timi")}.querySelectorAll(".nokta")[0].click()`);
    await bekleKi(`${kart("Omega Timi")}.querySelector(".etiket.inik")`, 60, "renk indirme");
    const d1 = durum();
    kontrol("seçim 'skin:renk' olarak kaydedildi", /^\d+:\d+$/.test(String(d1.selected.Teemo)), String(d1.selected.Teemo));
    const [n1, v1] = String(d1.selected.Teemo).split(":");
    kontrol("renk dosyası indi ve geçerli", zipMi(path.join(veri, "indirilen", "Teemo", `${n1}-${v1}.fantome`)));
    kontrol("kartta seçili renk yazıyor", /İnci|Kumtaşı|Obsidiyen/.test(await js(`${kart("Omega Timi")}.querySelector(".aktifVaryant").textContent`)));
    await js(`${kart("Omega Timi")}.scrollIntoView({ block: "center" })`);
    await foto("12-renk-secili.png");

    await js(`[...document.querySelectorAll("#sol .oge")].find(x => x.textContent.includes("Seçilenler")).click()`);
    await bekle(400);
    const sec1 = await js(`document.querySelector("#liste .satir .ad b").textContent`);
    kontrol("Seçilenler'de 'skin — renk' görünüyor", /Omega Timi Teemo — /.test(sec1), sec1);

    // aynı noktaya tekrar basınca ana skine dön
    await sampiyon("Teemo");
    await js(`${kart("Omega Timi")}.querySelector(".nokta.aktif").click()`);
    await bekleKi(`${kart("Omega Timi")}.querySelector(".etiket.inik")`, 60, "ana skin indirme");
    await bekle(500);
    kontrol("aktif noktaya tekrar basınca ana skine döndü", typeof durum().selected.Teemo === "number", String(durum().selected.Teemo));

    // 2) Form: Akali / Star Guardian (Form 2)
    await sampiyon("Akali");
    const formKart = await js(`(() => { const k = [...document.querySelectorAll("#liste .kart")].find(x => x.querySelector(".chip")); return k ? { ad: k.querySelector(".kartAlt b").textContent, chip: [...k.querySelectorAll(".chip")].map(c => c.textContent) } : null; })()`);
    kontrol("Akali'de form chip'i olan kart var", !!formKart, JSON.stringify(formKart));
    await js(`[...document.querySelectorAll("#liste .kart")].find(x => x.querySelector(".chip")).querySelector(".chip").click()`);
    await bekleKi(`document.querySelector("#liste .kart.secili .etiket.inik")`, 60, "form indirme");
    const d2 = durum();
    const [n2, v2] = String(d2.selected.Akali).split(":");
    kontrol("form seçimi kaydedildi ve dosyası geçerli", !!v2 && zipMi(path.join(veri, "indirilen", "Akali", `${n2}-${v2}.fantome`)), String(d2.selected.Akali));
    await js(`[...document.querySelectorAll("#liste .kart")].find(x => x.querySelector(".chip")).scrollIntoView({ block: "center" })`);
    await foto("13-form.png");

    // 3) Adsız temel skin: Bard (Klasik): yalnızca renkler seçilebilir
    await sampiyon("Bard");
    const klasik = await js(`(() => { const k = ${kart("Klasik")}; return k ? { noktalar: k.querySelectorAll(".nokta").length, ipucu: (k.querySelector(".aktifVaryant") || {}).textContent } : null; })()`);
    kontrol("Bard (Klasik) kartı renkli ve 'Bir renk seç' diyor", !!klasik && klasik.noktalar === 3 && /renk seç/i.test(klasik.ipucu || ""), JSON.stringify(klasik));
    await js(`${kart("Klasik")}.click()`);
    await bekle(500);
    kontrol("gövdeye basmak klasik kartı seçmiyor", durum().selected.Bard === undefined);
    await js(`${kart("Klasik")}.querySelectorAll(".nokta")[1].click()`);
    await bekleKi(`${kart("Klasik")}.querySelector(".etiket.inik")`, 60, "klasik renk indirme");
    const d3 = durum();
    const [n3, v3] = String(d3.selected.Bard).split(":");
    kontrol("klasik skin rengi kaydedildi (0:id) ve dosyası geçerli", n3 === "0" && zipMi(path.join(veri, "indirilen", "Bard", `0-${v3}.fantome`)), String(d3.selected.Bard));

    // 4) Seçilen karışımı motorla uygula
    await js(`document.getElementById("ana").click()`);
    await bekleKi(`/ready|error/.test(document.getElementById("durum").className)`, 180, "uygula");
    const son = await js(`document.getElementById("durum").className + " | " + document.getElementById("durumMetin").textContent`);
    kontrol("renk + form + klasik renk motorda 'hazır'", son.includes("ready"), son);
    await js(`document.getElementById("durdur").click()`);
    await bekleKi(`/idle|error/.test(document.getElementById("durum").className)`, 60, "durdur");
  } catch (e) {
    log("HATA:", e.message);
    kod = 1;
  }
  process.exitCode = kod;
  log("bitti, kod =", kod);
  app.quit();
});
