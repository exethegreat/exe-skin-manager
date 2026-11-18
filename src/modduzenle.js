"use strict";

// Mod düzenleme penceresi (✎): bir modun içeriğini okur ve istenen değişikliklerle yeni fantome girdileri üretir.
// Saf modül (Electron'a bağlı değil): yazma, kimlik ve tarif taşıma main.js'tedir.
const fsp = require("node:fs/promises");
const path = require("node:path");
const StreamZip = require("node-stream-zip");
const { Hata } = require("./hata");

const ZIP_RE = /\.(fantome|zip)$/i;
const WAD_AD_RE = /\.wad(\.client)?$/i;
const BILINEN_RE = /^(meta|wad|wad_[^/]+|raw|raw_[^/]+)\//i;
// WAD klasörlerinin içinde unutulan metin dökümleri: oyun okumaz, Manager tarayıp hata sayabilir.
const DOKUM_RE = /\.(py|rito|txt|json)$/i;
const INFO = "meta/info.json";
const RESIM = "meta/image.png";

const wadAdi = (ad) => (/\.wad$/i.test(ad) ? ad + ".client" : ad);
const kucuk = (s) => s.toLowerCase();

// "WAD/Udyr.wad.client/..." ya da "WAD/Udyr.wad.client" → "Udyr.wad.client"
function wadKok(name) {
  const m = /^wad\/([^/]+)/i.exec(name);
  return m ? m[1] : null;
}

function bilinmeyenMi(name) {
  if (!BILINEN_RE.test(name)) return true;
  return /^wad\/[^/]+\/.+/i.test(name) && DOKUM_RE.test(name);
}

async function girdileriOku(file) {
  if (!ZIP_RE.test(file)) return [{ name: `WAD/${wadAdi(path.basename(file))}`, data: await fsp.readFile(file) }];
  const zip = new StreamZip.async({ file });
  try {
    const girdiler = [];
    for (const e of Object.values(await zip.entries())) {
      if (e.isDirectory) continue;
      girdiler.push({ name: e.name.replace(/\\/g, "/"), data: await zip.entryData(e) });
    }
    return girdiler;
  } finally {
    await zip.close().catch(() => {});
  }
}

function infoOku(girdiler) {
  const g = girdiler.find((x) => kucuk(x.name) === INFO);
  if (!g) return {};
  try {
    const o = JSON.parse(g.data.toString("utf8").replace(/^﻿/, ""));
    return o && typeof o === "object" && !Array.isArray(o) ? o : {};
  } catch {
    return {};
  }
}

async function modIcerigi(file) {
  const girdiler = await girdileriOku(file);
  const sayac = new Map();
  for (const g of girdiler) {
    const k = wadKok(g.name);
    if (k) sayac.set(k, (sayac.get(k) || 0) + 1);
  }
  return {
    info: infoOku(girdiler),
    wadlar: [...sayac].map(([ad, dosya]) => ({ ad, dosya })).sort((a, b) => a.ad.localeCompare(b.ad, "en")),
    bilinmeyen: girdiler.filter((g) => bilinmeyenMi(g.name)).length,
    resimVar: girdiler.some((g) => kucuk(g.name) === RESIM)
  };
}

// Eklenecek WAD: dosya (X.wad / X.wad.client) ya da klasör (X.wad.client\ ya da içinde WAD'lar olan klasör).
async function wadGirdileri(yol) {
  const st = await fsp.stat(yol);
  const ad = path.basename(yol);
  if (st.isFile()) return [{ ad: wadAdi(ad), girdiler: [{ name: `WAD/${wadAdi(ad)}`, data: await fsp.readFile(yol) }] }];
  const yuru = async (abs, onek, hedef) => {
    for (const d of await fsp.readdir(abs, { withFileTypes: true })) {
      const p = path.join(abs, d.name);
      if (d.isDirectory()) await yuru(p, `${onek}${d.name}/`, hedef);
      else if (d.isFile()) hedef.push({ name: `${onek}${d.name}`, data: await fsp.readFile(p) });
    }
  };
  const gruplar = [];
  const klasorWad = async (abs, wad) => {
    const girdiler = [];
    await yuru(abs, `WAD/${wad}/`, girdiler);
    gruplar.push({ ad: wad, girdiler });
  };
  if (WAD_AD_RE.test(ad)) await klasorWad(yol, wadAdi(ad));
  else {
    for (const d of await fsp.readdir(yol, { withFileTypes: true })) {
      if (!WAD_AD_RE.test(d.name)) continue;
      const p = path.join(yol, d.name);
      if (d.isDirectory()) await klasorWad(p, wadAdi(d.name));
      else if (d.isFile()) gruplar.push({ ad: wadAdi(d.name), girdiler: [{ name: `WAD/${wadAdi(d.name)}`, data: await fsp.readFile(p) }] });
    }
  }
  if (!gruplar.length) throw new Hata("mKlasorBos", { ad });
  return gruplar;
}

function infoBirlestir(eski, bilgi) {
  const info = { ...eski };
  const yazi = (v) => (typeof v === "string" ? v : "");
  info.Name = yazi(bilgi.Name).trim() || yazi(eski.Name) || "Mod";
  info.Author = yazi(bilgi.Author).trim();
  info.Version = yazi(bilgi.Version).trim().slice(0, 24);
  info.Description = yazi(bilgi.Description);
  for (const k of ["Home", "Heart"]) {
    const v = yazi(bilgi[k]).trim();
    if (v) info[k] = v;
    else delete info[k];
  }
  return info;
}

const imza = (girdiler) =>
  girdiler
    .filter((g) => !/^meta\//i.test(g.name))
    .map((g) => g.name + "\0" + g.data.toString("base64"))
    .sort()
    .join("\n");

// d = {bilgi, resim: yol|null|"sil", wadSil: [ad], wadEkle: [{yol}], bilinmeyenSil}
async function yenidenPaketle(file, d) {
  const eski = await girdileriOku(file);
  let girdiler = eski.slice();
  const wadCikar = (ad) => {
    girdiler = girdiler.filter((g) => {
      const k = wadKok(g.name);
      return !k || kucuk(k) !== kucuk(ad);
    });
  };
  for (const ad of d.wadSil || []) wadCikar(ad);
  for (const { yol } of d.wadEkle || []) {
    for (const grup of await wadGirdileri(yol)) {
      wadCikar(grup.ad);
      girdiler.push(...grup.girdiler);
    }
  }
  if (d.bilinmeyenSil) girdiler = girdiler.filter((g) => !bilinmeyenMi(g.name));
  if (d.resim) {
    girdiler = girdiler.filter((g) => kucuk(g.name) !== RESIM);
    if (d.resim !== "sil") girdiler.push({ name: "META/image.png", data: await fsp.readFile(d.resim) });
  }
  const info = infoBirlestir(infoOku(eski), d.bilgi || {});
  const infoAd = (eski.find((g) => kucuk(g.name) === INFO) || {}).name || "META/info.json";
  girdiler = girdiler.filter((g) => kucuk(g.name) !== INFO);
  girdiler.unshift({ name: infoAd, data: Buffer.from(JSON.stringify(info, null, 2)) });
  if (!girdiler.some((g) => wadKok(g.name) || /^raw/i.test(g.name))) throw new Hata("wadYok");
  return { girdiler, info, wadDegisti: imza(eski) !== imza(girdiler) };
}

// Dışa aktarma (⤓): modun girdileri olduğu gibi; temizle → metin dökümleri atılır; tek WAD dosyasına META eklenir.
async function disaAktarGirdileri(file, { temizle } = {}) {
  let girdiler = await girdileriOku(file);
  if (temizle) girdiler = girdiler.filter((g) => !bilinmeyenMi(g.name));
  if (!girdiler.some((g) => kucuk(g.name) === INFO)) {
    const ad = path.basename(file).replace(/\.(wad\.client|wad|fantome|zip)$/i, "");
    girdiler.unshift({ name: "META/info.json", data: Buffer.from(JSON.stringify({ Name: ad, Author: "", Version: "1.0.0", Description: "" }, null, 2)) });
  }
  return girdiler;
}

// Kimlik değişince ne taşınır: yalnız META değiştiyse tarif ve senkron türevi yeni kimliğe taşınır;
// WAD değiştiyse ikisi de geçersizdir, tarif o anki yamadan yeniden çıkarılır.
function kimlikTasima({ wadDegisti, synced }) {
  if (wadDegisti) return { tarifTasi: false, senkronTasi: false, tarifYeniden: true };
  return { tarifTasi: true, senkronTasi: !!synced, tarifYeniden: false };
}

module.exports = { modIcerigi, yenidenPaketle, wadGirdileri, kimlikTasima, disaAktarGirdileri };
