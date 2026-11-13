// Katalog: şampiyon / skin / renk paketi / form listesi (GitHub'daki skin deposunun index.json'u) + isteğe bağlı indirme ve önbellek.
// Katalog dilden bağımsızdır (İngilizce depo adları). Görünen adlar dil başına ayrı yüklenir (dilYukle → this.adlar).
const fsp = require("node:fs/promises");
const path = require("node:path");
const { Hata } = require("./hata");
const { DILLER } = require("./ui/diller");

const DEPO = "https://raw.githubusercontent.com/Yimikami/LeagueSkins-Experimental/main";
const DEPO_AGAC = "https://api.github.com/repos/Yimikami/LeagueSkins-Experimental/git/trees/main?recursive=1";
const DDRAGON = "https://ddragon.leagueoflegends.com";
const CDRAGON_TR = "https://raw.communitydragon.org/latest/plugins/rcp-be-lol-game-data/global/tr_tr/v1/skins.json";
const CDRAGON_ASSET = "https://raw.communitydragon.org/latest/plugins/rcp-be-lol-game-data/global/default/";
const TAZELIK_MS = 6 * 60 * 60 * 1000;
const DIL_TAZELIK_MS = 3 * 24 * 60 * 60 * 1000;
const SEMA = 7;
const DIL_SEMA = 1;

const exists = (p) => fsp.stat(p).then(() => true, () => false);

async function getJson(url, ms = 25000) {
  const r = await fetch(url, { signal: AbortSignal.timeout(ms) });
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  return r.json();
}

async function yazJson(dosya, veri) {
  const tmp = dosya + ".tmp";
  await fsp.writeFile(tmp, JSON.stringify(veri));
  await fsp.rename(tmp, dosya);
}

// Depodaki ad kuralı: "/" → "_", ":" silinir; klasör adlarında sondaki nokta/boşluk atılır.
const san = (ad, klasor = false) => {
  const s = String(ad).replace(/\//g, "_").replace(/:/g, "");
  return klasor ? s.replace(/[.\s]+$/, "") : s;
};
const yolKodla = (rel) => rel.split("/").map(encodeURIComponent).join("/");
const kimlik = (key, num, vid) => `${key}/${Number(num)}${vid ? `-${Number(vid)}` : ""}`;
// Renk paketi kaydından renk adını ayıklar. Riot verisinde biçim dile göre değişir:
// "Skin (Renk)" (çoğu dil; Asya dillerinde tam genişlikli parantez), "Skin – ''Renk''" (Rusça), "Skin Renk" (Çince).
// ana: bağlı skin'in aynı dildeki adı; kayıt ondan başlıyorsa kalan kısım renktir.
function renkAdi(ad, ana = "") {
  const e = String(ad || "").trim();
  if (!e) return "";
  const temizle = (s) => {
    let x = s.trim().replace(/^[-–—:]\s*/, "");
    for (let i = 0; i < 3; i++) {
      x = x.replace(/^(''|["'«»“”‘’「」『』(（\[［])+/, "").replace(/(''|["'«»“”‘’「」『』)）\]］])+$/, "").trim();
    }
    return x;
  };
  if (ana && e.startsWith(ana) && e.length > ana.length) {
    const r = temizle(e.slice(ana.length));
    if (r) return r;
  }
  const m = /[(（]([^()（）]+)[)）]\s*$/.exec(e);
  return m ? m[1].trim() : e;
}
// Rusça'daki ''Ad'' biçimli çift tek tırnakları tipografik tırnağa çevirir.
const duzelt = (s) => String(s).replace(/''([^']+)''/g, "«$1»");

class Catalog {
  /** @param {string} dir veri klasörü (katalog.json, dil-*.json ve indirilen/ burada durur) */
  constructor(dir) {
    this.dir = dir;
    this.cacheFile = path.join(dir, "katalog.json");
    this.skinDir = path.join(dir, "indirilen");
    this.surumFile = path.join(this.skinDir, "surum.json");
    // champions: [{key, dd, cid (Riot şampiyon numarası), name (İngilizce), icon, skins: [...]}]
    //   skin: {num, name (depodaki İngilizce ad), yuk, sadeceRenk?, renkler: [...], formlar: [...]}
    //   renkler: [{id, name, renk: [hex], dosya, img?}]                 (renk paketleri; img: standart dışı önizleme yolu)
    //   formlar: [{id, name, grup, renkEn, renk: [hex], dosya}]         (form / aşama varyasyonları)
    this.data = { sema: SEMA, zaman: 0, patch: "", ddSurum: "", eksik: false, champions: [] };
    this.indirilen = new Set(); // "Key/num" ya da "Key/num-vid"
    this.surum = {}; // kimlik -> indirildiği yama
    this.suren = new Map(); // kimlik -> Promise
    this.agac = null; // depo dosya ağacı (yalnızca ad uyuşmazlığında, bellekte)
    // Görünen adlar (seçili dil): {ch: {Key: ad}, n: {Key: {num: ad}}, rn: {Key: {renkId: ad}}, rs: {enRenkKucuk: ad}} ya da null (İngilizce)
    this.adlar = null;
    this.ham = null; // seçili dilin ham Riot verisi (katalog yenilenince adlar yeniden hesaplanır)
    this.dilKodu = null;
    this.onYenilendi = null; // arka plan yenilemesi bitince çağrılır
    this.yenileniyor = null;
    this.eskiCache = null; // önceki şemadan kalan katalog: Community Dragon'a ulaşılamazsa renk kodları/yedek görseller buradan devralınır
  }

  async yukle() {
    await fsp.mkdir(this.skinDir, { recursive: true });
    try {
      const d = JSON.parse(await fsp.readFile(this.cacheFile, "utf8"));
      if (d.sema === SEMA) this.data = d;
      else this.eskiCache = d;
    } catch {}
    try {
      this.surum = JSON.parse(await fsp.readFile(this.surumFile, "utf8"));
    } catch {}
    if (!this.data.champions.length) {
      // İlk çalıştırma: liste olmadan açılamaz.
      try {
        await this.yenile();
      } catch (e) {
        throw new Hata("sListeHata", { m: e.message });
      }
    } else if (this.data.eksik || Date.now() - (this.data.zaman || 0) > TAZELIK_MS) {
      this.yenileArka(); // eldeki liste hemen kullanılır; yenileme arkada yapılır, açılışı geciktirmez
    }
    for (const c of await fsp.readdir(this.skinDir, { withFileTypes: true })) {
      if (!c.isDirectory()) continue;
      for (const f of await fsp.readdir(path.join(this.skinDir, c.name))) {
        const m = /^(\d+)(?:-(\d+))?\.fantome$/.exec(f);
        if (m) this.indirilen.add(`${c.name}/${m[1]}${m[2] ? `-${m[2]}` : ""}`);
      }
    }
  }

  yenileArka() {
    if (this.yenileniyor) return this.yenileniyor;
    this.yenileniyor = this.yenile()
      .then(() => {
        if (this.ham) this.adlar = this.adlarHesapla(this.ham);
        if (this.onYenilendi) this.onYenilendi();
      })
      .catch(() => {}) // kaynaklara ulaşılamadıysa eldeki liste korunur, bir sonraki açılışta yeniden denenir
      .finally(() => {
        this.yenileniyor = null;
      });
    return this.yenileniyor;
  }

  // Listeyi internetten yeniler: yeni şampiyonlar/skin'ler/renkler ve yama numarası buradan gelir.
  async yenile() {
    const eskiVar = this.data.champions.length > 0;
    const index = await getJson(`${DEPO}/index.json`, 20000);
    let ddSurum = this.data.ddSurum || "";
    let en = {};
    try {
      ddSurum = (await getJson(`${DDRAGON}/api/versions.json`, 12000))[0];
      en = (await getJson(`${DDRAGON}/cdn/${ddSurum}/data/en_US/champion.json`, 15000)).data || {};
    } catch {}
    const enVar = Object.keys(en).length > 0;
    // Renk kodları ve yedek görseller Community Dragon'dan gelir.
    let tr = {};
    let cdVar = true;
    try {
      tr = await getJson(CDRAGON_TR, this.eskiCache ? 4000 : 8000); // eski katalog varsa renk kodları ondan devralınır, uzun beklemeye gerek yok
    } catch {
      cdVar = false;
    }
    // Eldeki liste sağlamsa, eksik veriyle ezilmesin.
    if (eskiVar && (!enVar || !cdVar)) throw new Error("kaynaklara ulaşılamadı");

    // Depo ile Riot arasında harf büyüklüğü farkı olabilir (örn. "FiddleSticks" / "Fiddlesticks").
    const kucuk = new Map(Object.keys(en).map((k) => [k.toLowerCase(), k]));
    const hexSoz = new Map(); // İngilizce renk adı (küçük harf) -> renk kodları (formların renkleri için)
    const eskiSampiyon = new Map((this.eskiCache?.champions || []).map((c) => [c.key, c]));

    const champions = Object.entries(index.champions || {}).map(([key, c]) => {
      const dd = kucuk.get(key.toLowerCase()) || key;
      const cid = Number(en[dd]?.key) || 0;
      const skinler = Object.entries(c.skins || {}).map(([num, name]) => ({ num: Number(num), name: String(name) }));
      // Adsız temel skin'in (num 0) renk paketleri varsa, onları ayrı bir kart olarak göster.
      if (c.chromas && c.chromas["0"]) skinler.push({ num: 0, name: "", sadeceRenk: true });
      skinler.sort((a, b) => a.num - b.num);
      for (const s of skinler) {
        const kayit = cid ? tr[cid * 1000 + s.num] : null;
        const eskiS = eskiSampiyon.get(key)?.skins?.find((x) => x.num === s.num);
        s.yuk = kayit?.loadScreenPath ? CDRAGON_ASSET + kayit.loadScreenPath.replace("/lol-game-data/assets/", "").toLowerCase() : eskiS?.yuk || "";
        const klasor = s.sadeceRenk ? key : san(s.name, true);
        const trRenk = new Map((kayit?.chromas || []).map((x) => [x.id, x]));
        s.renkler = Object.entries(c.chromas?.[String(s.num)] || {})
          .map(([id, enAd]) => {
            const e = trRenk.get(cid * 1000 + Number(id));
            const eskiR = eskiS?.renkler?.find((x) => x.id === Number(id));
            const hex = e ? [...new Set(e.colors || [])] : eskiR?.renk || [];
            if (hex.length && !hexSoz.has(String(enAd).toLowerCase())) hexSoz.set(String(enAd).toLowerCase(), hex);
            // Önizleme görseli genelde standart klasörde durur; farklı yerdeyse gerçek yolu saklanır.
            const rel = e?.chromaPath ? e.chromaPath.replace("/lol-game-data/assets/", "").toLowerCase() : "";
            const std = `v1/champion-chroma-images/${cid}/${cid * 1000 + Number(id)}.png`;
            const k = { id: Number(id), name: String(enAd), renk: hex, dosya: `${klasor}/${san(enAd)}.fantome` };
            if (rel && rel !== std) k.img = rel;
            else if (!e && eskiR?.img) k.img = eskiR.img;
            return k;
          })
          .sort((a, b) => a.id - b.id);
        s._klasor = klasor;
      }
      return { key, dd, cid, name: en[dd]?.name || key, icon: en[dd] ? `${DDRAGON}/cdn/${ddSurum}/img/champion/${en[dd].image.full}` : "", skins: skinler, _formlar: c.forms || {} };
    });

    // Formlar: "Renk - Grup" biçimindeki kayıtlar o grubun renkleri, düz ad formun kendisidir.
    for (const c of champions) {
      for (const s of c.skins) {
        const fm = c._formlar[String(s.num)] || {};
        s.formlar = Object.entries(fm)
          .map(([id, ad]) => {
            const i = String(ad).lastIndexOf(" - ");
            const renkEn = i > 0 ? String(ad).slice(0, i) : "";
            const grup = i > 0 ? String(ad).slice(i + 3) : String(ad);
            return { id: Number(id), name: String(ad), grup, renkEn, renk: renkEn ? hexSoz.get(renkEn.toLowerCase()) || [] : [], dosya: `${s._klasor}/${san(ad)}.fantome` };
          })
          .sort((a, b) => a.id - b.id);
        delete s._klasor;
      }
      delete c._formlar;
    }

    champions.sort((a, b) => a.name.localeCompare(b.name, "en"));
    this.data = { sema: SEMA, zaman: Date.now(), patch: String(index.patch || ""), ddSurum, eksik: !enVar || !cdVar, champions };
    await yazJson(this.cacheFile, this.data);
  }

  // ── Dil: Riot'un yerelleştirilmiş şampiyon/skin/renk adları ──────────────────────────────

  /** Seçili dilin adlarını yükler (önce disk önbelleği). {ok: true} ya da {ok: false, neden: "yok" | "ag"} */
  async dilYukle(kod) {
    this.dilKodu = kod;
    const d = DILLER.find((x) => x.kod === kod);
    if (!d || !d.riot) {
      this.ham = null;
      this.adlar = null;
      return { ok: false, neden: "yok" }; // Riot bu dili desteklemiyor (ör. Hintçe): adlar İngilizce kalır
    }
    const dosya = path.join(this.dir, `dil-${d.riot}.json`);
    let onbellek = null;
    try {
      const c = JSON.parse(await fsp.readFile(dosya, "utf8"));
      if (c.sema === DIL_SEMA && c.ham) onbellek = c;
    } catch {}
    let ham = onbellek ? onbellek.ham : null;
    if (!onbellek || Date.now() - onbellek.zaman > DIL_TAZELIK_MS) {
      try {
        ham = await this.dilIndir(d.riot);
        await yazJson(dosya, { sema: DIL_SEMA, zaman: Date.now(), ham });
      } catch {
        if (!ham) {
          if (this.dilKodu === kod) {
            this.ham = null;
            this.adlar = null;
          }
          return { ok: false, neden: "ag" };
        }
      }
    }
    if (this.dilKodu !== kod) return { ok: true }; // bu arada başka bir dil seçildi, sonucu yazma
    this.ham = ham;
    this.adlar = this.adlarHesapla(ham);
    return { ok: true };
  }

  async dilIndir(riot) {
    let surum = this.data.ddSurum;
    if (!surum) surum = (await getJson(`${DDRAGON}/api/versions.json`, 12000))[0];
    const j = await getJson(`${DDRAGON}/cdn/${surum}/data/${riot}/championFull.json`, 60000);
    const ham = {};
    for (const [k, c] of Object.entries(j.data || {})) {
      const n = {};
      for (const s of c.skins || []) if (s.num) n[s.num] = s.name; // skin ve renk paketi kayıtları (renkler "Skin (Renk)" biçiminde)
      ham[k] = { ad: c.name, n };
    }
    return ham;
  }

  // Ham Riot verisini mevcut kataloğa göre görünen adlara çevirir.
  adlarHesapla(ham) {
    const ch = {};
    const n = {};
    const rn = {};
    const say = new Map(); // İngilizce renk adı (küçük harf) -> {yerel ad: sayı}
    for (const c of this.data.champions) {
      const h = ham[c.dd];
      if (!h) continue;
      ch[c.key] = h.ad;
      const nn = {};
      const rr = {};
      for (const s of c.skins) {
        if (!s.sadeceRenk && h.n[s.num]) nn[s.num] = duzelt(h.n[s.num]);
        for (const r of s.renkler) {
          const yerel = h.n[r.id] ? duzelt(renkAdi(h.n[r.id], s.sadeceRenk ? "" : h.n[s.num])) : "";
          if (!yerel) continue;
          rr[r.id] = yerel;
          const k = r.name.toLowerCase();
          const g = say.get(k) || {};
          g[yerel] = (g[yerel] || 0) + 1;
          say.set(k, g);
        }
      }
      n[c.key] = nn;
      rn[c.key] = rr;
    }
    const rs = {};
    // Formların renk adları için sözlük: yalnızca bir İngilizce renk adı hep aynı yerel adla karşılanıyorsa (ör. Ruby → Yakut) güvenilir;
    // Çince gibi renk adının skin'e özgü olduğu dillerde sözlük kurulmaz, form renkleri İngilizce kalır.
    for (const [k, g] of say) {
      const sirali = Object.entries(g).sort((a, b) => b[1] - a[1]);
      const toplam = sirali.reduce((a, x) => a + x[1], 0);
      if (sirali[0][1] / toplam >= 0.6) rs[k] = sirali[0][0];
    }
    return { ch, n, rn, rs };
  }

  /** Hata iletilerinde kullanılacak görünen ad (seçili dilde, yoksa İngilizce). */
  ad(key, num, vid = null) {
    const k = this.bul(key, num, vid);
    if (!k) return `${key} #${num}`;
    const skin = this.adlar?.n?.[key]?.[k.s.num] || k.s.name || k.c.name;
    if (!k.v) return skin;
    return `${skin} — ${this.adlar?.rn?.[key]?.[k.v.id] || k.v.name}`;
  }

  /** Şampiyon + skin (+ varsa renk/form) kaydını döndürür; yoksa null. Adsız temel skin tek başına seçilemez. */
  bul(key, num, vid = null) {
    const c = this.data.champions.find((x) => x.key === key);
    const s = c?.skins.find((x) => x.num === Number(num));
    if (!c || !s) return null;
    if (!vid) return s.sadeceRenk ? null : { c, s, v: null };
    const v = [...(s.renkler || []), ...(s.formlar || [])].find((x) => x.id === Number(vid));
    return v ? { c, s, v } : null;
  }

  dosya(key, num, vid = null) {
    return path.join(this.skinDir, key, `${Number(num)}${vid ? `-${Number(vid)}` : ""}.fantome`);
  }

  // İnmiş ve bu yamaya ait mi? (Yama değiştiyse dosya yenilenmeli.)
  guncel(key, num, vid = null) {
    const id = kimlik(key, num, vid);
    return this.indirilen.has(id) && (this.surum[id] || "") === this.data.patch;
  }

  async agacYukle() {
    if (this.agac) return this.agac;
    const t = await getJson(DEPO_AGAC);
    this.agac = (t.tree || []).filter((x) => x.type === "blob" && x.path.startsWith("skins/") && x.path.endsWith(".fantome")).map((x) => x.path);
    return this.agac;
  }

  // Ad kuralıyla bulunamayan dosya için depo ağacında arama yapar (adlandırma farklarına karşı yedek).
  async agacYol(key, rel) {
    const agac = await this.agacYukle();
    const onek = `skins/${key}/`;
    const tam = onek + rel;
    if (agac.includes(tam)) return tam;
    const dosyaAdi = rel.split("/").pop().toLowerCase();
    const klasor = rel.includes("/") ? rel.split("/")[0].toLowerCase() : "";
    const adaylar = agac.filter((p) => p.startsWith(onek) && p.split("/").pop().toLowerCase() === dosyaAdi);
    return adaylar.find((p) => !klasor || p.split("/")[2]?.toLowerCase() === klasor) || (adaylar.length === 1 ? adaylar[0] : null);
  }

  // Güncel kopya varsa dokunmaz. Yoksa ya da yama değiştiyse indirir; indirilemezse eldeki eski kopyayı kullanır.
  indir(key, num, vid = null) {
    const id = kimlik(key, num, vid);
    if (this.suren.has(id)) return this.suren.get(id);
    const is = (async () => {
      const hedef = this.dosya(key, num, vid);
      const var_ = this.indirilen.has(id) && (await exists(hedef));
      if (var_ && this.guncel(key, num, vid)) return hedef;
      try {
        const k = this.bul(key, num, vid);
        if (!k) throw new Hata("cListede");
        const rel = k.v ? k.v.dosya : `${san(k.s.name)}.fantome`;
        let r = await fetch(`${DEPO}/skins/${encodeURIComponent(key)}/${yolKodla(rel)}`, { signal: AbortSignal.timeout(120000) });
        if (r.status === 404) {
          const alt = await this.agacYol(key, rel).catch(() => null);
          if (alt) r = await fetch(`${DEPO}/${yolKodla(alt)}`, { signal: AbortSignal.timeout(120000) });
        }
        if (r.status === 404) throw new Hata("cDepoda", { ad: this.ad(key, num, vid) });
        if (!r.ok) throw new Hata("cIndirilemedi", { kod: r.status });
        const veri = Buffer.from(await r.arrayBuffer());
        if (veri.length < 100 || veri[0] !== 0x50 || veri[1] !== 0x4b) throw new Hata("cGecersiz");
        await fsp.mkdir(path.dirname(hedef), { recursive: true });
        const tmp = hedef + ".tmp";
        await fsp.writeFile(tmp, veri);
        await fsp.rename(tmp, hedef);
        this.indirilen.add(id);
        this.surum[id] = this.data.patch;
        await yazJson(this.surumFile, this.surum);
        return hedef;
      } catch (e) {
        if (var_) return hedef; // eski kopya iş görür
        throw e;
      }
    })().finally(() => this.suren.delete(id));
    this.suren.set(id, is);
    return is;
  }

  // Elde hazır bir dosyayı (eski sürümden taşınan) önbelleğe alır.
  async sahiplen(key, num, kaynak) {
    const hedef = this.dosya(key, num);
    await fsp.mkdir(path.dirname(hedef), { recursive: true });
    if (!(await exists(hedef))) await fsp.rename(kaynak, hedef).catch(async () => fsp.copyFile(kaynak, hedef));
    this.indirilen.add(kimlik(key, num));
  }
}

module.exports = { Catalog, kimlik, renkAdi };
