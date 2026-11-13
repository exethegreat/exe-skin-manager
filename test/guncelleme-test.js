// Sürüm denetimi: node test/guncelleme-test.js  (ağ yok: getir() taklit edilir; "--ag" verilirse gerçek GitHub'a da bakar)
const assert = require("node:assert");
const G = require("../src/guncelleme");

const log = (...a) => console.log("[guncelleme-test]", ...a);
const yanit = (j, ok = true, status = 200) => async () => ({ ok, status, json: async () => j });

(async () => {
  assert.strictEqual(G.yeniMi("v1.33.0", "v1.34.0"), true);
  assert.strictEqual(G.yeniMi("v1.33.0", "v1.33.0"), false);
  assert.strictEqual(G.yeniMi("v1.33.0", "v1.32.9"), false);
  assert.strictEqual(G.yeniMi("v1.9.0", "v1.10.0"), true, "sayısal karşılaştırma (metin değil)");
  assert.strictEqual(G.yeniMi("v1.33.0", "v2.0.0"), true);
  assert.strictEqual(G.yeniMi("v1.33.0", "yok"), false);
  assert.strictEqual(G.yeniMi(null, "v1.0.0"), false);
  log("sürüm karşılaştırma OK");

  assert.ok(G.guvenliSayfa("https://github.com/LeagueToolkit/ltk-manager/releases/tag/v1.34.0"));
  assert.ok(!G.guvenliSayfa("https://evil.example.com/https://github.com/a/b/"));
  assert.ok(!G.guvenliSayfa("file:///C:/Windows/System32/calc.exe"));
  assert.ok(!G.guvenliSayfa("http://github.com/a/b/c"));
  log("bağlantı güvenliği OK");

  const yeni = await G.denetle("v1.33.0", "LeagueToolkit/ltk-manager", yanit({ tag_name: "v1.34.0", html_url: "https://github.com/LeagueToolkit/ltk-manager/releases/tag/v1.34.0" }));
  assert.deepStrictEqual([yeni.durum, yeni.yeni, yeni.son], ["yeni", true, "v1.34.0"]);
  const guncel = await G.denetle("v1.33.0", "LeagueToolkit/ltk-manager", yanit({ tag_name: "v1.33.0", html_url: "https://github.com/x/y/releases/tag/v1.33.0" }));
  assert.strictEqual(guncel.durum, "guncel");
  const kotuUrl = await G.denetle("v1.0.0", "a/b", yanit({ tag_name: "v1.1.0", html_url: "https://evil.example.com/" }));
  assert.strictEqual(kotuUrl.sayfa, "https://github.com/a/b/releases/latest", "güvensiz bağlantı yerine güvenli olan");
  assert.strictEqual((await G.denetle("v1.0.0", "a/b", yanit({}, false, 403))).durum, "hata");
  assert.strictEqual((await G.denetle("v1.0.0", "a/b", yanit({ tag_name: "sürümsüz" }))).durum, "hata");
  assert.strictEqual((await G.denetle("v1.0.0", "a/b", async () => { throw new Error("ağ yok"); })).durum, "hata");
  assert.strictEqual((await G.denetle("v1.0.0", "", yanit({}))).durum, "kapali", "depo boşsa kapalı");
  assert.strictEqual((await G.denetle("v1.0.0", "../../etc", yanit({}))).durum, "kapali", "geçersiz depo adı");
  log("denetim durumları OK");

  // Resmi yama sayfası: en büyük numara seçilmeli (sıradan bağımsız), yıl dönümü doğru işlenmeli
  const sayfa = (...a) => a.map((x) => `<a href="/tr-tr/news/game-updates/patch-${x}-notes/">`).join("\n");
  assert.strictEqual(G.yamaCoz(sayfa("26-22", "26-21", "26-9")), "26.22");
  assert.strictEqual(G.yamaCoz(sayfa("26-9", "26-21", "26-22")), "26.22", "sıra önemsiz");
  assert.strictEqual(G.yamaCoz(sayfa("26-24", "27-1", "26-23")), "27.1", "yıl dönümü");
  assert.strictEqual(G.yamaCoz(sayfa("26-24", "27-01")), "27.01", "yazılış korunur");
  assert.strictEqual(G.yamaCoz(sayfa("26-9", "26-10")), "26.10", "9 < 10 (sayısal)");
  assert.strictEqual(G.yamaCoz("yama yok, patch-s1-notes"), null);
  assert.strictEqual(await G.resmiYama(async () => ({ ok: true, text: async () => sayfa("26-23", "26-22") })), "26.23");
  assert.strictEqual(await G.resmiYama(async () => ({ ok: false, status: 500 })), null);
  assert.strictEqual(await G.resmiYama(async () => { throw new Error("ağ yok"); }), null);
  log("resmi yama okuma OK");

  if (process.argv.includes("--ag")) {
    const y = await G.resmiYama();
    assert.ok(/^\d{2}\.\d{1,2}$/.test(y || ""), "gerçek sayfadan yama okunamadı: " + y);
    log("gerçek resmi yama:", y);
    const s = await G.sonSurum(G.MOTOR_DEPO);
    assert.ok(G.surumCoz(s.surum) && G.guvenliSayfa(s.sayfa));
    log("gerçek GitHub:", s.surum, s.sayfa);
  }
  log("TAMAM");
})().catch((e) => {
  console.error("[guncelleme-test] HATA", e);
  process.exit(1);
});
