const { app, BrowserWindow, ipcMain, dialog, shell } = require("electron");
const { execFile } = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const StreamZip = require("node-stream-zip");
const { Engine, readSkinInfo, buildStoreZip, dosyaSurumu, tarifCikar, senkronDenetim, reSync } = require("./engine");
const G = require("./guncelleme");
const modpkg = require("./modpkg");
const { Catalog } = require("./catalog");
const { Hata } = require("./hata");
const diller = require("./ui/diller");

const SKIN_RE = /\.(fantome|zip|wad|wad\.client|modpkg)$/i;
const motorDir = app.isPackaged ? path.join(process.resourcesPath, "motor") : path.join(__dirname, "..", "motor");
const userData = app.getPath("userData");
const skinsDir = path.join(userData, "skinler");
const stateFile = path.join(userData, "durum.json");
// Mod Re-sync: tarifler\<id>.json (ekleme anındaki tarif) + tarifler\<id>.synced.fantome (senkron türevi; orijinal dokunulmaz)
const tarifDir = path.join(userData, "tarifler");

let win = null;
// selected: {şampiyonKey: skinNum | "skinNum:varyantId"} (şampiyon başına tek skin; varyant = renk paketi ya da form); custom: kullanıcının kendi eklediği dosyalar
let state = { gamePath: "", selected: {}, custom: [], yama: "" }; // yama: resmi sayfadan okunan son yama ("26.22"), ağ yokken de gösterilir
let dirty = false; // motor çalışırken seçim değişti mi

// Dil: yalnızca bellekte tutulur, kaydedilmez; uygulama her açılışta Türkçe başlar.
let dil = diller.varsayilan;
let dilYukleniyor = false;
let dilSonuc = "ok"; // "ok" | "yok" (Riot bu dili desteklemiyor) | "ag" (adlar indirilemedi)
const T = (k, v) => diller.t(dil, k, v);

// Çevrilebilir tanım ({k, v} ya da ham metin) → seçili dildeki metin. v içindeki tanımlar da çevrilir.
function metin(d) {
  if (d && typeof d === "object" && d.k) {
    const v = {};
    for (const [a, b] of Object.entries(d.v || {})) v[a] = metin(b);
    return T(d.k, v);
  }
  return d == null ? "" : String(d);
}

// Durum satırı anahtar olarak saklanır; dil değişince kendiliğinden yeni dilde görünür.
let status = { kind: "idle", desc: { k: "ilkDurum" } };

const engine = new Engine({
  root: path.join(userData, "official-ltk-bridge"),
  bridgeExe: path.join(motorDir, "exe-motor.exe"),
  managerSource: path.join(motorDir, "app"),
  managerOverride: path.join(userData, "motor-guncel")
});
const catalog = new Catalog(userData);

const exists = (p) => fsp.stat(p).then(() => true, () => false);

async function saveState() {
  const tmp = stateFile + ".tmp";
  await fsp.writeFile(tmp, JSON.stringify(state, null, 1));
  await fsp.rename(tmp, stateFile);
}

async function gameOk(p) {
  return !!p && (await exists(path.join(p, "League of Legends.exe")));
}

async function detectGame() {
  const adaylar = [];
  for (const d of ["C", "D", "E", "F"]) adaylar.push(`${d}:\\Riot Games\\League of Legends\\Game`);
  for (const a of adaylar) if (await gameOk(a)) return a;
  return "";
}

async function loadState() {
  let ham = {};
  try {
    ham = JSON.parse(await fsp.readFile(stateFile, "utf8"));
  } catch {}
  state = { gamePath: ham.gamePath || "", selected: ham.selected || {}, custom: ham.custom || [], yama: /^\d{2}\.\d{1,2}$/.test(ham.yama || "") ? ham.yama : "" };
  await fsp.mkdir(skinsDir, { recursive: true });

  // Eski sürümün listesi (skins): katalogda karşılığı olanlar önbelleğe taşınır, kalanı "kendi dosyalarım" olur.
  const norm = (s) => String(s || "").toLocaleLowerCase("en").replace(/[^a-z0-9]/g, "");
  for (const s of ham.skins || []) {
    if (!(await exists(s.file))) continue;
    const c = s.group && catalog.data.champions.find((x) => norm(x.name) === norm(s.group) || norm(x.key) === norm(s.group));
    const k = c && c.skins.find((x) => norm(x.name) === norm(s.name));
    if (c && k) {
      await catalog.sahiplen(c.key, k.num, s.file);
      await fsp.rm(s.file, { force: true });
      if (s.selected) state.selected[c.key] = k.num;
    } else {
      state.custom.push({ id: s.id, file: s.file, name: s.name, author: s.author || "", selected: !!s.selected });
    }
  }

  const kalan = [];
  for (const s of state.custom) if (await exists(s.file)) kalan.push(s);
  state.custom = kalan;
  for (const [key, v] of Object.entries(state.selected)) {
    const m = secimCoz(v);
    if (!m || !catalog.bul(key, m.num, m.vid)) delete state.selected[key];
  }
  if (!(await gameOk(state.gamePath))) state.gamePath = await detectGame();
  await saveState();
}

// Kullanıcının yazdığı/seçtiği yolu normalleştirir: tırnakları atar, exe dosyası verildiyse klasörüne çıkar,
// "League of Legends" klasörü verildiyse içindeki "Game"e iner. Geçerli klasörü ya da boş metin döndürür.
async function oyunKlasoru(girdi) {
  let p = String(girdi || "").trim().replace(/^["']+|["']+$/g, "");
  if (!p) return "";
  p = path.resolve(p);
  if (/[.]exe$/i.test(p)) p = path.dirname(p);
  for (const aday of [p, path.join(p, "Game")]) if (await gameOk(aday)) return aday;
  return "";
}

// Kayıtlı seçimi {num, vid} biçimine çevirir (eski kayıtlar yalnızca sayıdır).
function secimCoz(v) {
  if (typeof v === "number") return { num: v, vid: null };
  const m = /^([0-9]+):([0-9]+)$/.exec(String(v));
  return m ? { num: Number(m[1]), vid: Number(m[2]) } : null;
}

const running = () => engine.active || engine.busy;

// Sürüm denetimi (yalnızca bildirir): uygulamanın ve motorun (LTK Manager) yeni sürümü var mı? En geç 6 saatte bir bakılır.
let guncelleme = { zaman: 0, denetleniyor: false, uygulama: null, motor: null };
async function motorSurumu() {
  const guncel = path.join(userData, "motor-guncel", "ltk-manager.exe");
  return dosyaSurumu((await exists(guncel)) ? guncel : path.join(motorDir, "app", "ltk-manager.exe"));
}
async function guncellemeDenetle(zorla) {
  if (guncelleme.denetleniyor) return;
  if (!zorla && Date.now() - guncelleme.zaman < 6 * 3600 * 1000) return;
  guncelleme.denetleniyor = true;
  yayinla();
  try {
    const [uygulama, motor, yama] = await Promise.all([
      G.denetle("v" + app.getVersion(), G.UYGULAMA_DEPO),
      motorSurumu().then((v) => G.denetle(v, G.MOTOR_DEPO)),
      G.resmiYama()
    ]);
    guncelleme = { ...guncelleme, uygulama, motor, zaman: Date.now() };
    if (yama && yama !== state.yama) {
      state.yama = yama;
      await saveState();
    }
  } finally {
    guncelleme.denetleniyor = false;
    yayinla();
  }
}

// Her görüntüye artan bir sıra numarası verilir: arayüz, geç ulaşan eski bir yayını yok sayar (olay ve yanıt sırası garanti değildir).
let gorunumSira = 0;
async function view() {
  const oyunVar = await gameOk(state.gamePath);
  return {
    sira: ++gorunumSira,
    gameOk: oyunVar,
    gamePath: state.gamePath,
    selected: Object.fromEntries(Object.entries(state.selected).map(([k, v]) => [k, secimCoz(v)]).filter(([, m]) => m)),
    indirilen: [...catalog.indirilen],
    suren: [...catalog.suren.keys()],
    custom: state.custom.map(({ id, name, author, selected, synced }) => ({
      id,
      name,
      author,
      selected,
      senkronGerek: !!senkronGerek.get(id),
      senkronlu: !!synced
    })),
    status: { kind: status.kind, text: metin(status.desc) },
    patch: catalog.data.patch,
    resmiYama: state.yama,
    dil,
    dilYukleniyor,
    dilSonuc,
    running: running(),
    dirty: running() && dirty,
    guncelleme: {
      denetleniyor: guncelleme.denetleniyor,
      uygulama: guncelleme.uygulama,
      motor: guncelleme.motor,
      yeniVar: !!((guncelleme.uygulama && guncelleme.uygulama.yeni) || (guncelleme.motor && guncelleme.motor.yeni)),
      surum: "v" + app.getVersion()
    }
  };
}

async function yayinla() {
  if (win && !win.isDestroyed()) win.webContents.send("gorunum", await view());
}

function setStatus(kind, desc) {
  status = { kind, desc };
  yayinla();
}

function secimDegisti() {
  if (running()) dirty = true;
}

// ---------------- Mod Re-sync ----------------
// Sidecar tarifler\<id>.json = { tarif, senkron: {yama, ozetler, tarih} | null }.
// Tarif modun eklendiği anda (mod o yamada çalışırken) çıkarılır; senkron her zaman orijinal + tariften üretilir.
const tarifYolu = (id) => path.join(tarifDir, `${id}.json`);
const senkronYolu = (id) => path.join(tarifDir, `${id}.synced.fantome`);
const tarifUygun = (file) => /\.(fantome|zip)$/i.test(file);
const senkronGerek = new Map(); // id -> bool; view() sık çağrıldığı için önbellek (senkronDenetle günceller)

async function tarifOku(id) {
  try {
    return JSON.parse(await fsp.readFile(tarifYolu(id), "utf8"));
  } catch {
    return null;
  }
}

async function tarifYaz(id, kayit) {
  await fsp.mkdir(tarifDir, { recursive: true });
  const tmp = tarifYolu(id) + ".tmp";
  await fsp.writeFile(tmp, JSON.stringify(kayit));
  await fsp.rename(tmp, tarifYolu(id));
}

async function tarifKaydet(s) {
  if (!tarifUygun(s.file) || !(await gameOk(state.gamePath))) return false;
  try {
    const tarif = await tarifCikar(s.file, state.gamePath, { yama: state.yama || null });
    await tarifYaz(s.id, { tarif, senkron: null });
    s.tarifVar = true;
    s.yama = state.yama || "";
    return true;
  } catch (e) {
    console.warn("tarif çıkarılamadı:", s.name, e.message);
    return false;
  }
}

// Senkronlanmış modda karşılaştırma tabanı, senkron anındaki oyun bin'leridir (yoksa ekleme anındaki).
function denetimTarifi(kayit) {
  const oz = (kayit.senkron && kayit.senkron.ozetler) || {};
  return { ...kayit.tarif, binler: kayit.tarif.binler.map((b) => (oz[b.hash] ? { ...b, oyunOzet: oz[b.hash] } : b)) };
}

async function gerekMi(s) {
  const kayit = await tarifOku(s.id);
  if (!kayit || !kayit.tarif) return false;
  try {
    return (await senkronDenetim(denetimTarifi(kayit), state.gamePath)).gerek;
  } catch {
    return false;
  }
}

// Tüm özel modları denetler; tarifi olmayan (bu özellikten önce eklenmiş) modlara şimdiki yamadan tarif çıkarır.
let senkronIs = null;
function senkronDenetle() {
  if (senkronIs) return senkronIs;
  senkronIs = (async () => {
    if (!(await gameOk(state.gamePath))) {
      senkronGerek.clear();
      return;
    }
    let kaydet = false;
    let degisti = false;
    for (const s of [...state.custom]) {
      if (!s.tarifVar && tarifUygun(s.file) && (await tarifKaydet(s))) kaydet = true;
      const gerek = await gerekMi(s);
      if (senkronGerek.get(s.id) !== gerek) {
        senkronGerek.set(s.id, gerek);
        degisti = true;
      }
    }
    if (kaydet) await saveState();
    if (degisti) yayinla();
  })()
    .catch((e) => console.warn("senkron denetimi:", e.message))
    .finally(() => {
      senkronIs = null;
    });
  return senkronIs;
}

// Uygula'da kullanılacak dosya: senkron türevi varsa o, yoksa orijinal.
const uygulanacak = (s) => (s.synced && fs.existsSync(s.synced) ? s.synced : s.file);

// Klasörü fantome girdilerine çevirir. Kabul edilen düzenler: içinde WAD/ (ya da WAD_*/, RAW*/) klasörü olan hazır fantome düzeni,
// klasörün kendisi "Ad.wad.client" olması, ya da içinde "Ad.wad.client" klasörleri/dosyaları olması.
async function klasorGirdileri(dir) {
  const ad = path.basename(dir);
  const girdiler = [];
  let bayt = 0;
  const ekle = async (abs, name) => {
    const st = await fsp.lstat(abs);
    if (!st.isFile()) return; // simge bağlantılarını yok say
    bayt += st.size;
    if (bayt > 512 * 1024 * 1024) throw new Hata("mBuyuk");
    girdiler.push({ name, data: await fsp.readFile(abs) });
  };
  const yuru = async (abs, onek) => {
    for (const d of await fsp.readdir(abs, { withFileTypes: true })) {
      if (d.isSymbolicLink()) continue;
      if (d.isDirectory()) await yuru(path.join(abs, d.name), `${onek}${d.name}/`);
      else if (d.isFile()) await ekle(path.join(abs, d.name), `${onek}${d.name}`);
    }
  };
  const ust = await fsp.readdir(dir, { withFileTypes: true });
  const fantomeKlasoru = (d) => d.isDirectory() && /^(wad|raw|wad_.+|raw_.+|meta)$/i.test(d.name);
  if (ust.some((d) => d.isDirectory() && /^(wad|wad_.+)$/i.test(d.name))) {
    for (const d of ust.filter(fantomeKlasoru)) await yuru(path.join(dir, d.name), `${d.name}/`);
  } else if (/\.wad(\.client)?$/i.test(ad)) {
    await yuru(dir, `WAD/${/\.wad$/i.test(ad) ? ad + ".client" : ad}/`);
  } else {
    for (const d of ust) {
      if (!/\.wad(\.client)?$/i.test(d.name)) continue;
      const wadAd = /\.wad$/i.test(d.name) ? d.name + ".client" : d.name;
      if (d.isDirectory()) await yuru(path.join(dir, d.name), `WAD/${wadAd}/`);
      else if (d.isFile()) await ekle(path.join(dir, d.name), `WAD/${wadAd}`);
    }
  }
  if (!girdiler.some((g) => g.name.startsWith("WAD") || g.name.startsWith("RAW"))) throw new Hata("mKlasorBos", { ad });
  if (!girdiler.some((g) => g.name.toLowerCase() === "meta/info.json")) {
    girdiler.push({ name: "META/info.json", data: Buffer.from(JSON.stringify({ Name: ad, Author: "Unknown", Description: "", Version: "1.0.0" })) });
  }
  return girdiler;
}

async function addSkinFile(src) {
  const st = await fsp.stat(src).catch(() => null);
  if (!st) return false;
  const temiz = path.basename(src).replace(SKIN_RE, "");
  let id;
  let file;
  if (st.isDirectory() || (st.isFile() && /\.modpkg$/i.test(src))) {
    // .modpkg ve klasörler .fantome'a çevrilir; WAD adları korunur.
    const girdiler = st.isDirectory() ? await klasorGirdileri(src) : (await modpkg.fantomeGirdileri(src, path.basename(src))).girdiler;
    const zip = buildStoreZip(girdiler);
    id = crypto.createHash("sha256").update(zip).digest("hex").slice(0, 16);
    if (state.custom.some((s) => s.id === id)) return false;
    file = path.join(skinsDir, `${id}_${temiz}.fantome`);
    await fsp.writeFile(file, zip);
  } else if (st.isFile() && SKIN_RE.test(src)) {
    const hash = crypto.createHash("sha256");
    for await (const c of fs.createReadStream(src)) hash.update(c);
    id = hash.digest("hex").slice(0, 16);
    if (state.custom.some((s) => s.id === id)) return false;
    file = path.join(skinsDir, `${id}_${path.basename(src)}`);
    await fsp.copyFile(src, file);
  } else return false;
  const info = await readSkinInfo(file);
  const ad = info.name.replace(new RegExp(`^${id}_`), "").replace(SKIN_RE, "") || temiz;
  const kayit = { id, file, name: ad, author: info.author === "Unknown" ? "" : info.author, selected: true };
  state.custom.push(kayit);
  await tarifKaydet(kayit); // mod şu an (ekleme anında) çalışıyor varsayılır: yazar niyeti = mod − güncel oyun
  senkronGerek.set(id, false);
  return true;
}

async function addPaths(paths) {
  let n = 0;
  let ilkHata = null;
  for (const p of paths) {
    try {
      if (await addSkinFile(p)) n++;
    } catch (e) {
      console.warn("eklenemedi:", p, e.message);
      ilkHata = ilkHata || e;
    }
  }
  state.custom.sort((a, b) => a.name.localeCompare(b.name, dil));
  if (n) secimDegisti();
  await saveState();
  if (!n && ilkHata) throw ilkHata; // hiçbiri eklenemediyse nedenini kullanıcıya göster
  return n;
}

// Eklenmiş bir dosyanın içeriğini seçilen klasöre çıkarır (fantome/zip: WAD/<wad>/... düzeniyle; wad: dosyanın kendisi).
async function icerikCikar(s, hedef) {
  if (/\.(fantome|zip)$/i.test(s.file)) {
    const zip = new StreamZip.async({ file: s.file });
    try {
      return await zip.extract(null, hedef);
    } finally {
      await zip.close().catch(() => {});
    }
  }
  const ad = path.basename(s.file).replace(/^[0-9a-f]{16}_/i, "");
  await fsp.copyFile(s.file, path.join(hedef, ad));
  return 1;
}

function isRunning(image) {
  return new Promise((resolve) => {
    execFile("tasklist", ["/FI", `IMAGENAME eq ${image}`, "/NH"], { windowsHide: true }, (err, out) => {
      resolve(!err && out.toLowerCase().includes(image.toLowerCase()));
    });
  });
}

// Önceki çalıştırmadan kalmış, bizim klasörümüzden başlatılmış LTK süreçlerini kapatır (başkalarına dokunmaz).
function killOrphans() {
  const root = engine.root.replace(/'/g, "''");
  const ps = `Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -and $_.ExecutablePath.StartsWith('${root}', [StringComparison]::OrdinalIgnoreCase) } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }`;
  return new Promise((resolve) => {
    execFile("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", ps], { windowsHide: true, timeout: 15000 }, () => resolve());
  });
}

// Motorun ham (İngilizce) durum satırlarını çevrilebilir durumlara eşler; tanınmayan satırlar arayüze yansıtılmaz.
function motorDurumu(line) {
  if (/patcher ready/i.test(line)) return ["ready", { k: "sHazir" }];
  if (/overlay live/i.test(line)) return ["ready", { k: "sAktif" }];
  if (/preparing|injecting/i.test(line)) return ["working", { k: "sHazirlaniyor" }];
  return null;
}

engine.on("status", (line) => {
  const d = motorDurumu(line);
  if (d) setStatus(...d);
});
engine.on("warning", (m) => console.warn("[motor uyarı]", m));
// Motorun başlangıçta verdiği, zararsız olduğu bilinen geçici hatalar (bkz. engine.js stop yutma listesi)
// arayüzde kırmızı yanıp sönmesin; "overlay live" zaten hemen ardından geliyor.
const zararsizMotorHatasi = /get_patcher_status|settings restoration|not allowed by ACL/i;
engine.on("error-message", (m) => {
  const mesaj = String(m).replace(/^error /, "");
  if (zararsizMotorHatasi.test(mesaj)) {
    console.warn("[motor zararsız hata]", mesaj);
    return;
  }
  setStatus("error", { k: "sHata", v: { m: mesaj } });
});
// Manager'ın sağlık denetiminde onarılamaz çıkan modların adları (boşsa sorun yok)
let kotuAdlar = "";
engine.on("idle", (m) => {
  if (kotuAdlar && m) setStatus("error", { k: "sSkinhack", v: { ad: kotuAdlar } });
  else setStatus("idle", m ? { k: "sDurdu", v: { m } } : { k: "sDurduruldu" });
});
engine.on("closed", (err) => {
  if (err) setStatus("error", { k: "sMotorKapandi", v: { m: err } });
  else yayinla();
});

// Katalog arka planda yenilenince arayüze haber ver.
catalog.onYenilendi = () => {
  if (win && !win.isDestroyed()) win.webContents.send("katalog:yenilendi");
  yayinla();
};

const handlers = {
  "durum:al": () => view(),
  "katalog:al": () => ({ champions: catalog.data.champions, adlar: catalog.adlar }),
  // Seçili dile geçer: arayüz metinleri hemen değişir, şampiyon/skin/renk adları (Riot verisi) arkadan yüklenir.
  "dil:sec": async (_e, kod) => {
    if (!diller.DILLER.some((d) => d.kod === kod)) return view();
    dil = kod;
    dilYukleniyor = true;
    await yayinla();
    const sonuc = await catalog.dilYukle(kod);
    if (dil === kod) {
      dilYukleniyor = false;
      dilSonuc = sonuc.ok ? "ok" : sonuc.neden;
    }
    return view();
  },
  // Katalogdan skin seç/kaldır. Seçilince (inmemişse) arka planda indirilir.
  // vid: renk paketi / form kimliği (yoksa ana skin).
  "katalog:sec": async (_e, key, num, vid, on) => {
    if (!on) {
      const m = secimCoz(state.selected[key]);
      if (m && m.num === Number(num)) delete state.selected[key];
      secimDegisti();
      await saveState();
      return view();
    }
    const k = catalog.bul(key, num, vid || null);
    if (!k) throw new Hata("eSkinBulunamadi");
    const deger = vid ? `${k.s.num}:${Number(vid)}` : k.s.num;
    state.selected[key] = deger;
    secimDegisti();
    await saveState();
    const is = catalog.indir(key, k.s.num, vid || null);
    yayinla();
    try {
      await is;
    } catch (e) {
      if (state.selected[key] === deger) delete state.selected[key];
      await saveState();
      yayinla();
      throw e;
    }
    return view();
  },
  "secim:temizle": async () => {
    state.selected = {};
    for (const s of state.custom) s.selected = false;
    secimDegisti();
    await saveState();
    return view();
  },
  "skin:sec": async () => {
    const r = await dialog.showOpenDialog(win, {
      title: T("dSkinEkle"),
      properties: ["openFile", "multiSelections"],
      filters: [{ name: T("dSkinFiltre"), extensions: ["fantome", "zip", "wad", "client", "modpkg"] }]
    });
    if (!r.canceled) await addPaths(r.filePaths);
    return view();
  },
  "skin:klasorSec": async () => {
    const r = await dialog.showOpenDialog(win, { title: T("dKlasorEkle"), properties: ["openDirectory", "multiSelections"] });
    if (!r.canceled) await addPaths(r.filePaths);
    return view();
  },
  "skin:cikar": async (_e, id) => {
    const s = state.custom.find((x) => x.id === id);
    if (!s) return view();
    const r = await dialog.showOpenDialog(win, { title: T("dCikar"), properties: ["openDirectory", "createDirectory"] });
    if (r.canceled) return view();
    const guvenli = s.name.replace(/[<>:"/\\|?*\x00-\x1f]/g, "_").trim().replace(/[. ]+$/, "") || "skin";
    const hedef = path.join(r.filePaths[0], guvenli);
    await fsp.mkdir(hedef, { recursive: true });
    const n = await icerikCikar(s, hedef);
    setStatus("idle", { k: "sCikarildi", v: { n, yol: hedef } });
    shell.openPath(hedef);
    return view();
  },
  "skin:ekle": async (_e, paths) => {
    await addPaths(Array.isArray(paths) ? paths.filter((p) => typeof p === "string") : []);
    return view();
  },
  "skin:isaretle": async (_e, id, on) => {
    const s = state.custom.find((x) => x.id === id);
    if (s) {
      s.selected = !!on;
      secimDegisti();
      await saveState();
    }
    return view();
  },
  "skin:sil": async (_e, id) => {
    const i = state.custom.findIndex((x) => x.id === id);
    if (i >= 0) {
      const [s] = state.custom.splice(i, 1);
      if (path.dirname(s.file) === skinsDir) await fsp.rm(s.file, { force: true });
      await fsp.rm(tarifYolu(s.id), { force: true });
      await fsp.rm(senkronYolu(s.id), { force: true });
      senkronGerek.delete(s.id);
      if (s.selected) secimDegisti();
      await saveState();
    }
    return view();
  },
  "lisans:oku": async () => {
    const yol = app.isPackaged ? path.join(process.resourcesPath, "LISANS.txt") : path.join(__dirname, "..", "LISANS.txt");
    return { metin: (await fsp.readFile(yol, "utf8").catch(() => "")).replace(/^﻿/, "") };
  },
  "guncelleme:denetle": async () => {
    await guncellemeDenetle(true);
    return view();
  },
  "guncelleme:ac": async (_e, hangi) => {
    const k = hangi === "uygulama" ? guncelleme.uygulama : hangi === "motor" ? guncelleme.motor : null;
    if (k && G.guvenliSayfa(k.sayfa)) await shell.openExternal(k.sayfa);
    return view();
  },
  "motor:klasor": async () => {
    const k = path.join(userData, "motor-guncel");
    await fsp.mkdir(k, { recursive: true });
    await shell.openPath(k);
    return view();
  },
  // Güncel yamaya senkron: orijinal mod + tarif → tarifler\<id>.synced.fantome; Uygula bundan sonra türevi kullanır.
  "mod:senkronla": async (_e, id) => {
    const s = state.custom.find((x) => x.id === id);
    if (!s) return view();
    if (!(await gameOk(state.gamePath))) throw new Hata("eOyunKlasoruYok");
    const kayit = await tarifOku(id);
    if (!kayit || !kayit.tarif) throw new Hata("eTarifYok");
    setStatus("working", { k: "sSenkronlaniyor", v: { ad: s.name } });
    try {
      const { rapor, ozetler } = await reSync(s.file, kayit.tarif, state.gamePath, senkronYolu(id));
      kayit.senkron = { yama: state.yama || "", ozetler, tarih: Date.now() };
      await tarifYaz(id, kayit);
      s.synced = senkronYolu(id);
      if (s.selected) secimDegisti();
      await saveState();
      senkronGerek.set(id, await gerekMi(s));
      setStatus("idle", { k: "sSenkronlandi", v: { ad: s.name, n: rapor.senkronEntry } });
      return { ...(await view()), rapor };
    } catch (e) {
      setStatus("error", { k: "sHata", v: { m: Hata.tanim(e) } });
      throw e;
    }
  },
  "oyun:yaz": async (_e, girdi) => {
    if (running()) throw new Hata("eOnceDurdur");
    if (!String(girdi || "").trim()) throw new Hata("eYolBos");
    const p = await oyunKlasoru(girdi);
    if (!p) throw new Hata("eKlasorYok");
    state.gamePath = p;
    senkronDenetle();
    await saveState();
    return view();
  },
  "oyun:bul": async () => {
    if (running()) throw new Hata("eOnceDurdur");
    const p = await detectGame();
    if (!p) throw new Hata("eOtomatikYok");
    state.gamePath = p;
    senkronDenetle();
    await saveState();
    return view();
  },
  "oyun:sec": async () => {
    if (running()) throw new Hata("eOnceDurdur");
    const r = await dialog.showOpenDialog(win, {
      title: T("dKlasorSec"),
      properties: ["openDirectory"],
      defaultPath: state.gamePath || "C:\\Riot Games\\League of Legends"
    });
    if (!r.canceled) {
      const p = await oyunKlasoru(r.filePaths[0]);
      if (!p) throw new Hata("eSecilenYok");
      state.gamePath = p;
      senkronDenetle();
      await saveState();
    }
    return view();
  },
  "motor:uygula": async () => {
    const katalogSecim = Object.entries(state.selected);
    const kendi = state.custom.filter((s) => s.selected);
    if (!katalogSecim.length && !kendi.length) throw new Hata("eSkinSec");
    if (!(await gameOk(state.gamePath))) throw new Hata("eOyunKlasoruYok");
    if (await isRunning("Bocchi.exe")) throw new Hata("eDigerProgram");
    try {
      const dosyalar = [];
      let i = 0;
      for (const [key, v] of katalogSecim) {
        const m = secimCoz(v);
        i++;
        if (!catalog.guncel(key, m.num, m.vid)) setStatus("working", { k: "sIndiriliyor", v: { i, n: katalogSecim.length } });
        dosyalar.push(await catalog.indir(key, m.num, m.vid));
      }
      dosyalar.push(...kendi.map(uygulanacak));
      setStatus("working", { k: "sHazirlaniyor" });
      dirty = false;
      kotuAdlar = "";
      const kotu = await engine.apply(dosyalar, state.gamePath);
      if (kotu && kotu.length) {
        kotuAdlar = kotu
          .map((k) => {
            const c = state.custom.find((s) => s.file === k.source || s.synced === k.source);
            return c ? c.name : path.basename(k.source).replace(/\.fantome$/i, "");
          })
          .join(", ");
        setStatus("error", { k: "sSkinhack", v: { ad: kotuAdlar } });
      }
    } catch (e) {
      setStatus("error", { k: "sHata", v: { m: Hata.tanim(e) } });
      throw e;
    }
    return view();
  },
  "motor:durdur": async () => {
    await engine.stop();
    dirty = false;
    setStatus("idle", { k: "sDurduruldu" });
    return view();
  }
};

function createWindow() {
  win = new BrowserWindow({
    width: 900,
    height: 680,
    minWidth: 680,
    minHeight: 480,
    backgroundColor: "#0f1115",
    autoHideMenuBar: true,
    show: false,
    icon: path.join(__dirname, "ui", "icon.ico"),
    title: "EXE Skin Manager",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  win.removeMenu();
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  win.webContents.on("will-navigate", (e) => e.preventDefault());
  win.loadFile(path.join(__dirname, "ui", "index.html"));
}

// Açılış introsu: çerçevesiz küçük pencere; video sessiz oynar, ses exe.wav'dan gelir (özgün ExeIntro/main.py gibi).
const INTRO_MS = 3500;
function showIntro() {
  if (process.env.SKIN_INTRO_YOK) return Promise.resolve();
  return new Promise((resolve) => {
    const intro = new BrowserWindow({
      width: 480,
      height: 270,
      frame: false,
      resizable: false,
      movable: false,
      alwaysOnTop: true,
      skipTaskbar: true,
      center: true,
      backgroundColor: "#000000",
      webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, autoplayPolicy: "no-user-gesture-required" }
    });
    let bitti = false;
    const bitir = () => {
      if (bitti) return;
      bitti = true;
      if (!intro.isDestroyed()) intro.destroy();
      resolve();
    };
    intro.on("closed", bitir);
    intro.loadFile(path.join(__dirname, "ui", "intro.html")).catch(bitir);
    setTimeout(bitir, INTRO_MS);
  });
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });

  app.whenReady().then(async () => {
    const intro = showIntro();
    let katalogHata = null;
    try {
      await catalog.yukle();
    } catch (e) {
      katalogHata = Hata.tanim(e);
    }
    // Varsayılan dilin (Türkçe) adlarını yükle: önbellek varsa anında, yoksa arka planda indirilir.
    const dilIs = catalog.data.champions.length
      ? catalog.dilYukle(dil).then((r) => {
          dilSonuc = r.ok ? "ok" : r.neden;
          if (win && !win.isDestroyed()) win.webContents.send("katalog:yenilendi");
        })
      : Promise.resolve();
    await loadState();
    await killOrphans();
    status = katalogHata ? { kind: "error", desc: katalogHata } : { kind: "idle", desc: { k: "ilkDurum" } };
    for (const [kanal, fn] of Object.entries(handlers)) {
      ipcMain.handle(kanal, async (e, ...args) => {
        if (!win || e.sender !== win.webContents) throw new Error("unauthorized");
        try {
          return { ok: true, veri: await fn(e, ...args) };
        } catch (err) {
          return { ok: false, hata: metin(Hata.tanim(err)) };
        }
      });
    }
    createWindow();
    await intro;
    await Promise.race([dilIs, new Promise((r) => setTimeout(r, 2500))]); // adlar hazırsa pencere yerel adlarla açılsın
    win.show();
    guncellemeDenetle(false).catch(() => {});
    senkronDenetle(); // yama sonrası bozulan modlar için rozet
    setInterval(() => { if (!running()) senkronDenetle(); }, 10 * 60 * 1000);
  });

  let kapaniyor = false;
  app.on("before-quit", (e) => {
    if (kapaniyor) return;
    e.preventDefault();
    kapaniyor = true;
    engine
      .shutdown()
      .catch(() => {})
      .then(killOrphans)
      .finally(() => app.quit());
  });
  app.on("window-all-closed", () => {
    if (win) app.quit();
  });
}
