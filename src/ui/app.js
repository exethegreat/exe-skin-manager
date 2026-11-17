const $ = (id) => document.getElementById(id);
const el = (etiket, sinif, metin) => {
  const e = document.createElement(etiket);
  if (sinif) e.className = sinif;
  if (metin != null) e.textContent = metin;
  return e;
};

const API = window.DILLER_API; // çeviri tablosu (diller.js)
let katalog = []; // [{key, dd, cid, name (İngilizce), icon, skins: [...]}]
let adlar = null; // seçili dildeki görünen adlar: {ch, n, rn, rs} ya da null (İngilizce)
let g = { sira: 0, dil: "tr", selected: {}, indirilen: [], suren: [], custom: [], status: { kind: "idle", text: "" }, running: false, dirty: false, gameOk: true, dilYukleniyor: false, dilSonuc: "ok" };
let sayfa = null; // "secilenler" | "kendi" | "ayarlar" | şampiyon key
let sonSayfa = null;
let yazilan = null; // Ayarlar'daki klasör kutusuna yazılan, henüz kaydedilmemiş metin
let mesgul = false;
let hata = null; // ana süreçten dönen son hata (durum satırında gösterilir; zaten seçili dilde gelir)

const T = (k, v) => API.t(g.dil || "tr", k, v);
const OYUN_YOLU = "C:\\Riot Games\\League of Legends\\Game";

// ── Görünen adlar: seçili dilde yoksa İngilizce (depo adı) ──────────────────────────────
const champAd = (c) => (adlar && adlar.ch && adlar.ch[c.key]) || c.name;
const skinAd = (c, s) => (s.sadeceRenk ? `${champAd(c)} (${T("klasik")})` : (adlar && adlar.n && adlar.n[c.key] && adlar.n[c.key][s.num]) || s.name);
const renkAd = (c, r) => (adlar && adlar.rn && adlar.rn[c.key] && adlar.rn[c.key][r.id]) || r.name;
// Form adları depoda İngilizce: "Form 2", "Stage 3", "Level 16" kalıpları çevrilir, özel adlar (Rhaast vb.) olduğu gibi kalır.
function formGrup(grup) {
  const m = /^(Form|Stage|Level) (\d+)$/.exec(grup);
  if (!m) return grup;
  return T(m[1] === "Form" ? "formN" : m[1] === "Stage" ? "asamaN" : "seviyeN", { n: m[2] });
}
const formRenk = (f) => (adlar && adlar.rs && adlar.rs[f.renkEn.toLowerCase()]) || f.renkEn;
// Seçili varyantın görünen adı (renk paketi ya da form)
function varyantAdi(c, v) {
  if (v.grup === undefined) return renkAd(c, v);
  return v.renkEn ? formGrup(v.grup) + " · " + formRenk(v) : formGrup(v.grup);
}

// Yalnızca daha yeni (ya da aynı) sıra numaralı görüntü uygulanır; geç gelen eski yayın yok sayılır.
function gorunumUygula(v) {
  if (typeof v.sira === "number" && v.sira < g.sira) return false;
  g = v;
  return true;
}

async function cagir(p) {
  const r = await p;
  if (!r.ok) {
    hata = r.hata;
    ciz();
    return null;
  }
  hata = null;
  if (r.veri && !Array.isArray(r.veri) && r.veri.status && gorunumUygula(r.veri)) ciz();
  return r.veri;
}

// Veri kaynakları yamayı "16.22" diye numaralar; oyun istemcisi aynı yamayı "26.22" (yıl) olarak gösterir.
function yamaAdi(p) {
  const m = /^(\d+)\.(\d+)/.exec(p);
  return m && Number(m[1]) < 20 ? `${Number(m[1]) + 10}.${m[2]}` : p;
}

const secimSayisi = () => Object.keys(g.selected).length + g.custom.filter((s) => s.selected).length;
const siraliKatalog = () => [...katalog].sort((a, b) => champAd(a).localeCompare(champAd(b), g.dil || "tr"));

// Sabit arayüz metinlerini, yönü ve yazı dilini seçili dile göre ayarlar.
function uygulaDil() {
  const kod = g.dil || "tr";
  const d = API.DILLER.find((x) => x.kod === kod);
  document.documentElement.lang = kod;
  document.documentElement.dir = d && d.rtl ? "rtl" : "ltr";
  for (const e of document.querySelectorAll("[data-i18n]")) e.textContent = T(e.dataset.i18n);
  for (const e of document.querySelectorAll("[data-i18n-ph]")) e.placeholder = T(e.dataset.i18nPh);
  temaYaz();
}

function tiklanir(e, fn) {
  e.tabIndex = 0;
  e.addEventListener("click", fn);
  e.addEventListener("keydown", (ev) => {
    if (ev.target !== e) return;
    if (ev.key === " " || ev.key === "Enter") {
      ev.preventDefault();
      fn();
    }
  });
}

function solOge(id, ad, simge, sag) {
  const o = el("div", "oge" + (sayfa === id ? " acik" : ""));
  o.append(simge, el("span", "ad", ad));
  if (sag) o.append(sag);
  tiklanir(o, () => {
    sayfa = id;
    ciz();
  });
  return o;
}

function cizSol() {
  const sol = $("sol");
  const kaydirma = sol.scrollTop;
  sol.textContent = "";
  const kod = g.dil || "tr";
  const q = $("ara").value.trim().toLocaleLowerCase(kod);
  const n = secimSayisi();
  sol.append(
    solOge("secilenler", T("secilenler"), el("span", "simge", "✓"), n ? el("span", "rozet", String(n)) : null),
    solOge("kendi", T("kendi"), el("span", "simge", "+"), null),
    solOge("ayarlar", T("ayarlar"), el("span", "simge", "⚙"), !g.gameOk ? el("span", "isaret kirmizi") : g.guncelleme && g.guncelleme.yeniVar ? el("span", "isaret") : null),
    el("div", "ayrac")
  );
  for (const c of siraliKatalog()) {
    const ad = champAd(c);
    if (q && !ad.toLocaleLowerCase(kod).includes(q) && !c.name.toLowerCase().includes(q) && !c.key.toLowerCase().includes(q)) continue;
    let simge;
    if (c.icon) {
      simge = document.createElement("img");
      simge.src = c.icon;
      simge.alt = "";
      simge.loading = "lazy";
    } else simge = el("span", "simge", ad[0]);
    sol.append(solOge(c.key, ad, simge, c.key in g.selected ? el("span", "isaret") : null));
  }
  sol.scrollTop = kaydirma;
}

// Mod Re-sync: son senkronun raporu (kendi dosyalarım sayfasının başında gösterilir, Tamam ile kapanır).
let senkronRapor = null;
let senkronSuren = false;
async function senkronla(s) {
  if (senkronSuren) return;
  senkronSuren = true;
  try {
    const v = await cagir(window.api.senkronla(s.id));
    if (v && v.rapor) {
      senkronRapor = { ad: s.name, rapor: v.rapor };
      ciz();
    }
  } finally {
    senkronSuren = false;
  }
}

function senkronRaporKutusu() {
  const { ad, rapor } = senkronRapor;
  const k = el("div", "senkronRapor");
  k.setAttribute("role", "status");
  k.append(el("b", null, T("rapBaslik", { ad })));
  k.append(el("p", null, T("rapEntry", { n: rapor.senkronEntry })));
  const kisalt = (a) => (a.length > 8 ? a.slice(0, 8).join(", ") + ", …" : a.join(", "));
  if (rapor.tipUyumsuz.length) k.append(el("p", "uyari", T("rapTipUyumsuz", { n: rapor.tipUyumsuz.length, liste: kisalt(rapor.tipUyumsuz) })));
  if (rapor.yokBin.length) k.append(el("p", "uyari", T("rapYokBin", { n: rapor.yokBin.length, liste: kisalt(rapor.yokBin) })));
  if (rapor.eksikAsset.length) k.append(el("p", "uyari", T("rapEksikAsset", { n: rapor.eksikAsset.length, liste: kisalt(rapor.eksikAsset) })));
  const b = el("button", "ikincil", T("rapTamam"));
  b.addEventListener("click", () => {
    senkronRapor = null;
    ciz();
  });
  k.append(b);
  return k;
}

function skinSatiri({ ad, alt, secili, yuvarlak, etiket, tikla, sil, cikar, senkron }) {
  const s = el("div", "satir" + (secili ? " secili" : ""));
  s.setAttribute("role", yuvarlak ? "radio" : "checkbox");
  s.setAttribute("aria-checked", String(!!secili));
  const metin = el("span", "ad");
  metin.append(el("b", null, ad));
  if (alt) metin.append(el("small", null, alt));
  s.append(el("span", "kutu" + (yuvarlak ? " yuvarlak" : ""), "✓"), metin);
  if (etiket) s.append(el("span", "etiket " + etiket[0], etiket[1]));
  if (senkron) {
    const b = el("button", "senkronBtn", "⟳ " + senkron[0]);
    b.title = senkron[0];
    b.addEventListener("click", (e) => {
      e.stopPropagation();
      senkron[1]();
    });
    s.append(b);
  }
  if (cikar) {
    const b = el("button", "sil", "⤓");
    b.title = cikar[0];
    b.setAttribute("aria-label", cikar[0]);
    b.addEventListener("click", (e) => {
      e.stopPropagation();
      cikar[1]();
    });
    s.append(b);
  }
  if (sil) {
    const b = el("button", "sil", "✕");
    b.title = sil[0];
    b.setAttribute("aria-label", sil[0]);
    b.addEventListener("click", (e) => {
      e.stopPropagation();
      sil[1]();
    });
    s.append(b);
  }
  tiklanir(s, tikla);
  return s;
}

// Renk paketi noktası: iki renkli olanlar çapraz bölünür; rengin adı araç ipucu olarak görünür.
function renkNoktasi(r, aktif, sec) {
  const b = el("button", "nokta" + (aktif ? " aktif" : ""));
  const [a, c] = [r.renk[0], r.renk[1]];
  b.style.background = !a ? "var(--soluk)" : c && c !== a ? "linear-gradient(135deg, " + a + " 50%, " + c + " 50%)" : a;
  b.title = r.ad;
  b.setAttribute("aria-label", r.ad);
  b.setAttribute("aria-pressed", String(!!aktif));
  b.addEventListener("click", (e) => {
    e.stopPropagation();
    sec(r.id);
  });
  return b;
}

// Kartın altındaki renk paketleri ve form grupları. v: {c, renkler, formlar, aktif, sec, cid, skinAd}
function varyantlar(v) {
  const kutu = el("div", "varyant");
  if (v.renkler.length) {
    const sat = el("div", "noktalar");
    for (const r of v.renkler) sat.append(renkNoktasi({ id: r.id, ad: renkAd(v.c, r), renk: r.renk, img: r.img }, v.aktif === r.id, v.sec, v));
    kutu.append(sat);
  }
  const gruplar = new Map();
  for (const f of v.formlar) {
    if (!gruplar.has(f.grup)) gruplar.set(f.grup, []);
    gruplar.get(f.grup).push(f);
  }
  for (const [grup, liste] of gruplar) {
    const sat = el("div", "formSatir");
    const duz = liste.find((x) => !x.renkEn);
    if (duz) {
      const chip = el("button", "chip" + (v.aktif === duz.id ? " aktif" : ""), formGrup(grup));
      chip.setAttribute("aria-pressed", String(v.aktif === duz.id));
      chip.addEventListener("click", (e) => {
        e.stopPropagation();
        v.sec(duz.id);
      });
      sat.append(chip);
    } else sat.append(el("span", "chip etiketli", formGrup(grup)));
    for (const f of liste.filter((x) => x.renkEn)) sat.append(renkNoktasi({ id: f.id, ad: formGrup(grup) + " · " + formRenk(f), renk: f.renk, form: true }, v.aktif === f.id, v.sec, v));
    kutu.append(sat);
  }
  return kutu;
}

// Şampiyon sayfasındaki resimli kart (resim: oyunun yükleme ekranı görseli).
function skinKarti({ resim, yedek, ad, secili, etiket, tikla, aktifAd, varyant }) {
  const k = el("div", "satir kart" + (secili ? " secili" : ""));
  k.setAttribute("role", "radio");
  k.setAttribute("aria-checked", String(!!secili));
  const img = document.createElement("img");
  img.src = resim;
  img.alt = "";
  img.loading = "lazy";
  img.addEventListener("error", () => {
    if (yedek && img.src !== yedek) img.src = yedek; // ilk kaynak yoksa yedek kaynağı dene
    else img.classList.add("yok");
  });
  const alt = el("div", "kartAlt");
  alt.append(el("b", null, ad));
  if (aktifAd) alt.append(el("small", "aktifVaryant", aktifAd));
  if (etiket) alt.append(el("span", "etiket " + etiket[0], etiket[1]));
  if (varyant) alt.append(varyantlar(varyant));
  const resimKutu = el("div", "resim");
  resimKutu.append(img);
  k.append(resimKutu, el("span", "kutu yuvarlak", "✓"), alt);
  tiklanir(k, tikla);
  return k;
}

async function dilDegistir(kod) {
  hata = null;
  await cagir(window.api.dilSec(kod)); // arayüz metinleri hemen değişir (ana süreç yayın yapar), adlar arkadan yüklenir
  await katalogYukle();
}

// Ayarlar sayfası: oyun klasörü, dil, motor güncelleme.
let lisansMetni = null; // LISANS.txt, ilk açılışta okunur
let lisansAcik = false;

function ayarKarti() {
  const k = el("div", "ayar");
  k.append(el("h2", null, T("ayarKlasorBaslik")));
  k.append(el("p", "ipucu", T("ayarKlasorAciklama", { yol: OYUN_YOLU })));
  k.append(el("div", "ayarDurum " + (g.gameOk ? "iyi" : "kotu"), g.gameOk ? T("klasorGecerli") : g.gamePath ? T("klasorGecersiz") : T("klasorYok")));
  const giris = document.createElement("input");
  giris.type = "text";
  giris.dir = "ltr"; // dosya yolları her dilde soldan sağa yazılır
  giris.spellcheck = false;
  giris.placeholder = OYUN_YOLU;
  giris.value = yazilan ?? g.gamePath ?? "";
  giris.disabled = g.running;
  giris.addEventListener("input", () => (yazilan = giris.value));
  const dugme = (metin, sinif, fn) => {
    const b = el("button", sinif, metin);
    b.disabled = g.running || mesgul;
    b.addEventListener("click", fn);
    return b;
  };
  const kaydet = async () => {
    if (await cagir(window.api.oyunYaz(giris.value))) yazilan = null;
    ciz();
  };
  giris.addEventListener("keydown", (e) => {
    if (e.key === "Enter") kaydet();
  });
  const satir = el("div", "ayarSatir");
  satir.append(
    giris,
    dugme(T("kaydet"), "ikincil vurgulu", kaydet),
    dugme(T("gozat"), "ikincil", async () => {
      if (await cagir(window.api.oyunSec())) yazilan = null;
      ciz();
    }),
    dugme(T("otoBul"), "ikincil", async () => {
      if (await cagir(window.api.oyunBul())) yazilan = null;
      ciz();
    })
  );
  k.append(satir);
  if (g.running) k.append(el("p", "ipucu", T("calisirken")));
  k.append(el("p", "ipucu", T("klasorIpucu")));

  // Dil ayarları
  k.append(el("h2", "ayarBaslik", T("dilBaslik")));
  k.append(el("p", "ipucu", T("dilAciklama")));
  const dilSatir = el("div", "dilSatir");
  const etiket = el("label", null, T("dilEtiket"));
  etiket.htmlFor = "dilSec";
  const sec = document.createElement("select");
  sec.id = "dilSec";
  for (const d of API.DILLER) {
    const o = document.createElement("option");
    o.value = d.kod;
    o.textContent = d.ad;
    sec.append(o);
  }
  sec.value = g.dil || "tr";
  sec.addEventListener("change", () => dilDegistir(sec.value));
  dilSatir.append(etiket, sec);
  if (g.dilYukleniyor) dilSatir.append(el("span", "dilNot", T("dilYukleniyor")));
  k.append(dilSatir);
  if (!g.dilYukleniyor && g.dilSonuc !== "ok") k.append(el("p", "ipucu uyariNot", T("dilYok")));

  // Güncellemeler: yalnızca bildirir; kurulumu kullanıcı yapar
  k.append(el("h2", "ayarBaslik", T("gunBaslik")));
  const gun = g.guncelleme || {};
  const gunSatiri = (anahtar, ad, bilgi) => {
    if (!bilgi) return;
    const s = el("div", "gunSatir");
    s.append(el("span", "gunAd", T(anahtar, { mevcut: bilgi.mevcut })));
    if (bilgi.durum === "yeni") s.append(el("span", "ayarDurum kotu", T("gunYeni", { son: bilgi.son })));
    else if (bilgi.durum === "guncel") s.append(el("span", "ayarDurum iyi", T("gunGuncel")));
    else if (bilgi.durum === "hata") s.append(el("span", "ayarDurum kotu", T("gunBelirsiz")));
    if (bilgi.durum === "yeni") {
      const b = el("button", "ikincil", T("gunAc"));
      b.addEventListener("click", () => cagir(window.api.guncellemeAc(ad)));
      s.append(b);
    }
    k.append(s);
  };
  gunSatiri("gunUygulama", "uygulama", gun.uygulama || (gun.surum ? { mevcut: gun.surum, durum: "kapali" } : null));
  gunSatiri("gunMotor", "motor", gun.motor);
  const denetleBtn = el("button", "ikincil", gun.denetleniyor ? T("gunDenetleniyor") : T("gunDenetle"));
  denetleBtn.disabled = !!gun.denetleniyor;
  denetleBtn.addEventListener("click", () => cagir(window.api.guncellemeDenetle()));
  k.append(denetleBtn);
  k.append(el("p", "ipucu", T("gunMotorIpucu")));

  k.append(el("h2", "ayarBaslik", T("motorBaslik")));
  k.append(el("p", "ipucu", T("motorAciklama")));
  const b = el("button", "ikincil", T("motorKlasorAc"));
  b.addEventListener("click", () => cagir(window.api.motorKlasoru()));
  k.append(b);

  // Lisans
  k.append(el("h2", "ayarBaslik", T("lisansBaslik")));
  k.append(el("p", "ipucu", T("lisansNot")));
  const lb = el("button", "ikincil", lisansAcik ? T("lisansGizle") : T("lisansGoster"));
  lb.addEventListener("click", async () => {
    if (!lisansAcik && lisansMetni === null) {
      const r = await cagir(window.api.lisansOku());
      lisansMetni = r ? r.metin : "";
    }
    lisansAcik = !lisansAcik;
    ciz();
  });
  k.append(lb);
  if (lisansAcik) {
    const pre = el("pre", "lisans", lisansMetni);
    pre.dir = "ltr"; // metin Türkçe/İngilizce: her dilde soldan sağa
    k.append(pre);
  }
  return k;
}

function durumEtiketi(key, num, vid) {
  const id = `${key}/${num}${vid ? "-" + vid : ""}`;
  if (g.suren.includes(id)) return ["iniyor", T("iniyor")];
  if (g.indirilen.includes(id)) return ["inik", T("indirildi")];
  return null;
}

function cizSag() {
  const liste = $("liste");
  const btn = $("baslikBtn");
  const kaydirma = sonSayfa === sayfa ? liste.scrollTop : 0;
  sonSayfa = sayfa;
  queueMicrotask(() => (liste.scrollTop = kaydirma));
  liste.classList.remove("izgara");
  liste.textContent = "";
  btn.hidden = true;
  btn.onclick = null;

  if (sayfa === "secilenler") {
    $("baslik").textContent = T("secilenler");
    const n = secimSayisi();
    if (!n) {
      const b = el("div", "bos");
      b.append(el("b", null, T("bosBaslik")), T("bosAciklama"));
      liste.append(b);
      return;
    }
    btn.hidden = false;
    btn.textContent = T("tumunuKaldir");
    btn.onclick = () => cagir(window.api.secimiTemizle());
    for (const c of siraliKatalog()) {
      if (!(c.key in g.selected)) continue;
      const { num, vid } = g.selected[c.key];
      const s = c.skins.find((x) => x.num === num);
      const v = s && vid ? [...(s.renkler || []), ...(s.formlar || [])].find((x) => x.id === vid) : null;
      liste.append(
        skinSatiri({
          ad: s ? skinAd(c, s) + (v ? " — " + varyantAdi(c, v) : "") : `#${num}`,
          alt: champAd(c),
          secili: true,
          etiket: durumEtiketi(c.key, num, vid),
          tikla: () => cagir(window.api.katalogSec(c.key, num, null, false))
        })
      );
    }
    for (const s of g.custom.filter((x) => x.selected)) {
      liste.append(skinSatiri({ ad: s.name, alt: T("kendiDosyam"), secili: true, tikla: () => cagir(window.api.isaretle(s.id, false)) }));
    }
    return;
  }

  if (sayfa === "ayarlar") {
    $("baslik").textContent = T("ayarlar");
    liste.append(ayarKarti());
    return;
  }

  if (sayfa === "kendi") {
    $("baslik").textContent = T("kendi");
    btn.hidden = false;
    btn.textContent = T("dosyaEkle");
    btn.onclick = () => cagir(window.api.skinSec());
    const klasorBtn = el("button", "ikincil", T("klasorEkle"));
    klasorBtn.addEventListener("click", () => cagir(window.api.klasorSec()));
    liste.append(klasorBtn);
    if (!g.custom.length) {
      const b = el("div", "bos");
      b.append(el("b", null, T("kendiBosBaslik")), T("kendiBosAciklama"));
      liste.append(b);
      return;
    }
    if (senkronRapor) liste.append(senkronRaporKutusu());
    for (const s of g.custom) {
      liste.append(
        skinSatiri({
          ad: s.name,
          alt: s.author || "",
          secili: s.selected,
          etiket: s.senkronGerek ? ["senkronGerek", T("rozetSenkron")] : null,
          tikla: () => cagir(window.api.isaretle(s.id, !s.selected)),
          senkron: s.senkronGerek ? [T("btnSenkronla"), () => senkronla(s)] : null,
          cikar: [T("cikar"), () => cagir(window.api.cikar(s.id))],
          sil: [T("listedenKaldir"), () => cagir(window.api.sil(s.id))]
        })
      );
    }
    return;
  }

  const c = katalog.find((x) => x.key === sayfa);
  if (!c) {
    $("baslik").textContent = "";
    return;
  }
  $("baslik").textContent = champAd(c);
  liste.classList.add("izgara");
  for (const s of c.skins) {
    const m = g.selected[c.key];
    const secili = !!m && m.num === s.num;
    const aktif = secili ? m.vid : null;
    const aktifKayit = aktif ? [...(s.renkler || []), ...(s.formlar || [])].find((x) => x.id === aktif) : null;
    const sadeceRenk = !!s.sadeceRenk;
    const varyantVar = (s.renkler || []).length || (s.formlar || []).length;
    liste.append(
      skinKarti({
        resim: `https://ddragon.leagueoflegends.com/cdn/img/champion/loading/${c.dd || c.key}_${s.num}.jpg`,
        yedek: s.yuk || "",
        ad: skinAd(c, s),
        secili,
        aktifAd: aktifKayit ? varyantAdi(c, aktifKayit) : sadeceRenk && !secili ? T("birRenkSec") : "",
        etiket: durumEtiketi(c.key, s.num, aktif),
        // Adsız temel skin tek başına seçilemez: kartın gövdesi yalnızca seçimi kaldırır.
        tikla: () => (sadeceRenk ? (secili ? cagir(window.api.katalogSec(c.key, s.num, null, false)) : null) : cagir(window.api.katalogSec(c.key, s.num, null, !secili))),
        varyant: varyantVar
          ? {
              c,
              renkler: s.renkler || [],
              formlar: s.formlar || [],
              cid: c.cid,
              skinAd: skinAd(c, s),
              aktif,
              // Aktif olana tekrar basınca ana skine (adsız temel skinde: seçimin kaldırılmasına) dönülür.
              sec: (vid) => cagir(vid === aktif ? window.api.katalogSec(c.key, s.num, null, !sadeceRenk) : window.api.katalogSec(c.key, s.num, vid, true))
            }
          : null
      })
    );
  }
}

function cizAlt() {
  const d = hata ? { kind: "error", text: hata } : g.status;
  $("durum").className = "durum " + d.kind;
  $("durumMetin").textContent = d.text;
  $("durumMetin").title = d.text;
  const n = secimSayisi();
  $("sayi").textContent = n ? T("sayi", { n }) : "";
  $("durdur").hidden = !g.running;
  $("durdur").disabled = mesgul;
  const ana = $("ana");
  ana.hidden = g.running && !g.dirty;
  ana.textContent = g.running ? T("guncelle") : T("uygula");
  ana.disabled = mesgul || !n || g.suren.length > 0;
  $("uyari").hidden = g.gameOk;
  // Önce oyunun resmi yama notları sayfasından okunan yama; henüz okunamadıysa skin kaynağının yaması
  const yama = g.resmiYama || (g.patch ? yamaAdi(g.patch) : "");
  $("yama").textContent = yama ? T("yama", { v: yama }) : "";
}

function ciz() {
  uygulaDil();
  if (sayfa === null) sayfa = secimSayisi() ? "secilenler" : (siraliKatalog()[0] || {}).key || "kendi";
  cizSol();
  cizSag();
  cizAlt();
}

async function islem(fn) {
  if (mesgul) return;
  mesgul = true;
  cizAlt();
  try {
    await cagir(fn());
  } finally {
    mesgul = false;
    cizAlt();
  }
}

async function katalogYukle() {
  const r = await window.api.katalogAl();
  if (r && r.ok && r.veri) {
    katalog = r.veri.champions || [];
    adlar = r.veri.adlar || null;
    ciz();
  }
}

$("ara").addEventListener("input", cizSol);

// Aydınlık / karanlık tema (seçim bu bilgisayarda hatırlanır)
function temaYaz() {
  const acik = document.documentElement.dataset.theme === "light";
  const b = $("tema");
  b.textContent = acik ? "☾" : "☀";
  b.title = T(acik ? "temaKoyu" : "temaAcik");
  b.setAttribute("aria-label", b.title);
}
$("tema").addEventListener("click", () => {
  const yeni = document.documentElement.dataset.theme === "light" ? "dark" : "light";
  document.documentElement.dataset.theme = yeni;
  try {
    localStorage.setItem("tema", yeni);
  } catch {}
  temaYaz();
});
$("uyariBtn").addEventListener("click", () => {
  sayfa = "ayarlar";
  ciz();
});
$("ana").addEventListener("click", () => islem(() => window.api.uygula()));
$("durdur").addEventListener("click", () => islem(() => window.api.durdur()));

// Sürükle-bırak: kendi dosyalarıma ekler
let sayac = 0;
window.addEventListener("dragenter", (e) => {
  e.preventDefault();
  sayac++;
  $("birak").hidden = false;
});
window.addEventListener("dragleave", () => {
  if (--sayac <= 0) {
    sayac = 0;
    $("birak").hidden = true;
  }
});
window.addEventListener("dragover", (e) => e.preventDefault());
window.addEventListener("drop", (e) => {
  e.preventDefault();
  sayac = 0;
  $("birak").hidden = true;
  const dosyalar = [...(e.dataTransfer?.files || [])];
  if (dosyalar.length) {
    sayfa = "kendi";
    cagir(window.api.skinEkle(dosyalar));
  }
});

window.api.gorunumDinle((yeni) => {
  if (gorunumUygula(yeni)) ciz();
});
window.api.katalogYenilendiDinle(() => katalogYukle()); // liste ya da dil adları arka planda güncellendi

(async () => {
  await cagir(window.api.durumAl());
  await katalogYukle();
})();
