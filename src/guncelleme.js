// Sürüm denetimi: GitHub "latest release" bilgisini okuyup kurulu sürümle karşılaştırır. Hiçbir şey indirmez ya da kurmaz.
// Yalnızca genel API çağrısı yapılır; kullanıcıya ait hiçbir bilgi gönderilmez.

// Motor: resmi LTK Manager. Uygulama: kendi sürümlerinin yayımlanacağı "sahip/depo" (boşsa uygulama denetimi kapalıdır).
const MOTOR_DEPO = "LeagueToolkit/ltk-manager";
const UYGULAMA_DEPO = "";

const SURUM_RE = /(\d+)\.(\d+)\.(\d+)/;

function surumCoz(s) {
  const m = SURUM_RE.exec(String(s || ""));
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

/** son, mevcut'tan kesin olarak daha yeniyse true. Çözülemeyen sürümde false. */
function yeniMi(mevcut, son) {
  const a = surumCoz(mevcut);
  const b = surumCoz(son);
  if (!a || !b) return false;
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return b[i] > a[i];
  return false;
}

// Yalnızca github.com adreslerine izin verilir (tarayıcıda açılacak bağlantı için).
function guvenliSayfa(url) {
  return typeof url === "string" && /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\//.test(url);
}

/** {surum, sayfa} döndürür; depo geçersizse null, ağ/sunucu hatasında fırlatır. */
async function sonSurum(depo, getir = fetch) {
  if (!/^[\w.-]+\/[\w.-]+$/.test(depo || "")) return null;
  const r = await getir(`https://api.github.com/repos/${depo}/releases/latest`, {
    headers: { Accept: "application/vnd.github+json", "User-Agent": "EXE-Skin-Manager" },
    signal: AbortSignal.timeout(8000)
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const j = await r.json();
  const sayfa = guvenliSayfa(j.html_url) ? j.html_url : `https://github.com/${depo}/releases/latest`;
  if (!surumCoz(j.tag_name)) throw new Error("sürüm okunamadı");
  return { surum: String(j.tag_name), sayfa };
}

/** Bir bileşenin denetim sonucu: {mevcut, son, yeni, sayfa, durum: "guncel"|"yeni"|"hata"|"kapali"} */
async function denetle(mevcut, depo, getir) {
  try {
    const s = await sonSurum(depo, getir);
    if (!s) return { mevcut, son: null, yeni: false, sayfa: null, durum: "kapali" };
    const yeni = yeniMi(mevcut, s.surum);
    return { mevcut, son: s.surum, yeni, sayfa: s.sayfa, durum: yeni ? "yeni" : "guncel" };
  } catch {
    return { mevcut, son: null, yeni: false, sayfa: null, durum: "hata" };
  }
}

// Oyunun resmi yama notları sayfası: her yama notunun adresi "patch-26-22-notes" biçimindedir; en büyük numara güncel yamadır.
const YAMA_SAYFASI = "https://www.leagueoflegends.com/tr-tr/news/tags/patch-notes/";

/** HTML içinden en yeni yamayı ("26.22") bulur; bulunamazsa null. Numaralar sayısal karşılaştırılır; yazılış sayfadaki gibi korunur. */
function yamaCoz(html) {
  let en = null;
  for (const m of String(html).matchAll(/patch-(\d{2})-(\d{1,2})-notes/g)) {
    const a = [Number(m[1]), Number(m[2])];
    if (!en || a[0] > en.a[0] || (a[0] === en.a[0] && a[1] > en.a[1])) en = { a, ad: `${m[1]}.${m[2]}` };
  }
  return en ? en.ad : null;
}

/** Resmi sayfadan güncel yama numarasını okur; ağ/sunucu hatasında ya da bulunamazsa null döndürür. */
async function resmiYama(getir = fetch) {
  try {
    const r = await getir(YAMA_SAYFASI, { headers: { "User-Agent": "EXE-Skin-Manager", "Accept-Language": "tr-TR" }, signal: AbortSignal.timeout(15000) });
    if (!r.ok) return null;
    return yamaCoz(await r.text());
  } catch {
    return null;
  }
}

module.exports = { MOTOR_DEPO, UYGULAMA_DEPO, YAMA_SAYFASI, surumCoz, yeniMi, guvenliSayfa, sonSurum, denetle, yamaCoz, resmiYama };
