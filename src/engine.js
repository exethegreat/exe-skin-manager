// Motor: motor/exe-motor.exe (üçüncü taraf köprü programı, MIT) üzerinden resmi LTK Manager'ı sürer.
// Not: bocchi-*.json gibi veri dosyası adları köprü programının içinde sabittir; değiştirilemez.
// Protokol: köprüye stdin'den satır başına bir JSON ({id, epoch, action}), stdout'tan yanıt/olay satırları.
const { EventEmitter } = require("node:events");
const { spawn, execFile } = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const StreamZip = require("node-stream-zip");
const { Hata } = require("./hata");
const binmotor = require("./binmotor");

const exists = (p) => fsp.stat(p).then(() => true, () => false);

async function fileHash(file) {
  const hash = crypto.createHash("sha256");
  for await (const chunk of fs.createReadStream(file)) hash.update(chunk);
  return hash.digest("hex");
}

async function atomicJson(file, value) {
  const staging = `${file}.tmp`;
  await fsp.writeFile(staging, JSON.stringify(value));
  await fsp.rename(staging, file);
}

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

// Sıkıştırmasız (store) zip üretir; .fantome biçimi budur.
function buildStoreZip(entries) {
  const chunks = [];
  const central = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name, "utf8");
    const crc = crc32(entry.data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(33, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(entry.data.length, 18);
    local.writeUInt32LE(entry.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    chunks.push(local, name, entry.data);
    const rec = Buffer.alloc(46);
    rec.writeUInt32LE(0x02014b50, 0);
    rec.writeUInt16LE(20, 4);
    rec.writeUInt16LE(20, 6);
    rec.writeUInt16LE(33, 14);
    rec.writeUInt32LE(crc, 16);
    rec.writeUInt32LE(entry.data.length, 20);
    rec.writeUInt32LE(entry.data.length, 24);
    rec.writeUInt16LE(name.length, 28);
    rec.writeUInt32LE(offset, 42);
    central.push(rec, name);
    offset += 30 + name.length + entry.data.length;
  }
  const centralSize = central.reduce((n, c) => n + c.length, 0);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralSize, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...chunks, ...central, eocd]);
}

// META/info.json'da LTK Manager'ın istediği alanlar eksikse tamamlar.
function managerMetadata(source, original) {
  const fail = () => {
    throw new Hata("mInfo", { ad: path.basename(source) });
  };
  let info = {};
  if (original) {
    try {
      info = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(original).replace(/^﻿/, ""));
    } catch {
      fail("UTF-8 JSON bekleniyordu");
    }
    if (!info || Array.isArray(info) || typeof info !== "object") fail("JSON nesnesi bekleniyordu");
  }
  let changed = !original;
  const defaults = { Name: path.basename(source), Author: "Unknown", Description: "", Version: "1.0.0" };
  for (const [key, fallback] of Object.entries(defaults)) {
    if (info[key] == null) {
      info[key] = fallback;
      changed = true;
    } else if (key !== "Version" && typeof info[key] !== "string") fail(`${key} metin olmalı`);
  }
  return changed ? Buffer.from(JSON.stringify(info)) : original;
}

// Bir skin dosyasının adını/yazarını/sürümünü okur (liste için; aynı adlı modlar sürümle ayırt edilir).
async function readSkinInfo(file) {
  const fallback = { name: path.basename(file).replace(/\.(fantome|zip|wad(\.client)?)$/i, ""), author: "", version: "" };
  if (!/\.(fantome|zip)$/i.test(file)) return fallback;
  const zip = new StreamZip.async({ file });
  try {
    const entries = Object.values(await zip.entries());
    const entry = entries.find((e) => e.name.replace(/\\/g, "/").toLowerCase() === "meta/info.json");
    if (!entry || entry.size > 1024 * 1024) return fallback;
    const info = JSON.parse((await zip.entryData(entry)).toString("utf8").replace(/^﻿/, ""));
    return {
      name: typeof info.Name === "string" && info.Name.trim() ? info.Name.trim() : fallback.name,
      author: typeof info.Author === "string" ? info.Author : "",
      version: typeof info.Version === "string" ? info.Version.trim().slice(0, 24) : ""
    };
  } catch {
    return fallback;
  } finally {
    await zip.close().catch(() => {});
  }
}

// Köprünün olay kaydından (jsonl) son başlatmada "onarılamaz" çıkan paketleri okur: [{sha, kurallar}].
// Manager böyle bir paket (örn. skinhack) bulursa oyun açılınca TÜM modları devre dışı bırakır.
function kotuPaketler(metin) {
  const satirlar = String(metin).split("\n");
  for (let i = satirlar.length - 1; i >= 0; i--) {
    if (!satirlar[i].includes('"start-accepted"')) continue;
    try {
      const o = JSON.parse(satirlar[i]);
      return ((o.facts && o.facts.health) || [])
        .filter((h) => h.health && h.health.health === "unrepairable")
        .map((h) => ({ sha: h.name, kurallar: (h.health.problems || []).map((p) => p.title) }));
    } catch {}
  }
  return [];
}

// ---------------- Mod sağlık rozeti ----------------
// Manager'ın denetim kararından arayüz sınıfı: "guncel" (yeşil), "fix" (sarı: onarıldı/uyarı var/güncellenmeli),
// "bozuk" (kırmızı: ölümcül hata ya da skinhack — onarılamaz, Manager'ı zorlar ya da tüm modları kapattırır). Karar yoksa null.
function saglikSinifi(karar, onarim) {
  if (!karar) return null;
  const c = karar.counts || {};
  const kurallar = (karar.rules || []).map((r) => String(r.rule || ""));
  if ((c.fatals || 0) > 0 || kurallar.some((r) => /skinhack/i.test(r))) return "bozuk";
  if ((c.errors || 0) > 0 || (onarim || 0) > 0) return "fix";
  // Yalnız uyarı (ör. bin/object-link) ve onarılabilir bir şey yoksa: Manager modu kapatmaz, FIX'e tıklamak da bir şey
  // değiştiremez → yeşil. Onarılabilir uyarı varsa (fixable > 0) FIX kalır.
  const onarilabilir = (karar.fixable || 0) > 0 || (karar.rules || []).some((r) => (r.fixable || 0) > 0);
  if ((c.warnings || 0) > 0) return onarilabilir ? "fix" : "guncel";
  if (karar.health !== "healthy") return "fix";
  return "guncel";
}

async function jsonOku(file) {
  try {
    return JSON.parse((await fsp.readFile(file, "utf8")).replace(/^﻿/, ""));
  } catch {
    return null;
  }
}

// mods: [{anahtar, hash}] (hash = kaynak dosyanın sha256'sı ya da öneki). Dönüş: Map(anahtar -> {durum, onarim}).
// Eşleme: kaynak hash → (seçimdeki hazırlanmış kopya | sync kaydı | library.json) → Manager mod id → sağlık kararı.
async function modSagliklari(library, mods) {
  const sonuc = new Map();
  const [sync, secim, kutup, kararlar] = await Promise.all([
    jsonOku(path.join(library, "bocchi-sync.json")),
    jsonOku(path.join(library, "bocchi-selection.json")),
    jsonOku(path.join(library, "library.json")),
    jsonOku(path.join(library, "mod-health-verdicts.json"))
  ]);
  if (!kararlar || !kararlar.verdicts) return sonuc;
  const syncMods = (sync && sync.mods) || {};
  const paketler = (secim && secim.packages) || [];
  const kutupMods = (kutup && kutup.mods) || [];
  const onarim = new Map();
  try {
    const metin = await fsp.readFile(path.join(library, "bocchi-bridge-events.jsonl"), "utf8");
    for (const satir of metin.split("\n")) {
      if (!satir.includes('"mod-repaired"')) continue;
      try {
        const o = JSON.parse(satir);
        if (o.facts && o.facts.modId) onarim.set(o.facts.modId, { at: Date.parse(o.at), n: Number(o.facts.repaired) || 0 });
      } catch {}
    }
  } catch {}
  for (const { anahtar, hash } of mods) {
    if (!hash) continue;
    const h = String(hash).toLowerCase();
    const ozetler = new Set([h]);
    for (const p of paketler) if (String(p.sourceId || "").startsWith(h) && p.sha256) ozetler.add(p.sha256);
    let modId = null;
    for (const [d, m] of Object.entries(syncMods)) {
      if ([...ozetler].some((o) => d.startsWith(o)) && m && m.id) {
        modId = m.id;
        break;
      }
    }
    if (!modId) {
      const k = kutupMods.find((m) => [...ozetler].some((o) => String(m.sourceSha256 || "").startsWith(o)));
      if (k) modId = k.id;
    }
    if (!modId) continue;
    // Onarım olayı yalnızca onarım >0 iken yazılır: karardan (checkedAt) bir dakikadan uzak eski olay bayattır, sayılmaz.
    const karar = kararlar.verdicts[modId];
    const o = onarim.get(modId);
    const denetim = karar && Date.parse(karar.checkedAt);
    const n = o && (!denetim || !o.at || Math.abs(o.at - denetim) <= 60000) ? o.n : 0;
    const durum = saglikSinifi(karar, n);
    if (durum) sonuc.set(anahtar, { durum, onarim: n, modId });
  }
  return sonuc;
}

// ltk-manager.exe'nin sürümünü dosya özelliklerinden okur ("v1.33.0" biçiminde).
function dosyaSurumu(exe) {
  return new Promise((resolve) => {
    const ps = "(Get-Item -LiteralPath '" + exe.replace(/'/g, "''") + "').VersionInfo.ProductVersion";
    execFile("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", ps], { windowsHide: true, timeout: 15000 }, (err, out) => {
      const m = /(\d+)\.(\d+)\.(\d+)/.exec(String(out || ""));
      resolve(m ? `v${m[1]}.${m[2]}.${m[3]}` : "v1.33.0");
    });
  });
}

class Engine extends EventEmitter {
  /**
   * @param {{root: string, bridgeExe: string, managerSource: string}} o
   *  root: yazılabilir veri klasörü; bridgeExe: köprü programı (exe-motor.exe); managerSource: ltk-manager.exe'nin bulunduğu klasör
   */
  constructor(o) {
    super();
    this.root = o.root;
    this.bridgeExe = o.bridgeExe;
    this.managerSource = o.managerSource;
    this.managerOverride = o.managerOverride || ""; // varsa ve içinde ltk-manager.exe bulunuyorsa önceliklidir
    this.child = null;
    this.sequence = 0;
    this.epoch = 0;
    this.requests = new Map();
    this.active = false;
    this.busy = false;
    this.game = null;
    this.kaynaklar = new Map(); // hazırlanan paketin sha256'sı → kaynak dosya yolu
    this.exited = Promise.resolve();
  }

  get library() {
    return path.join(this.root, "libraries", "persistent");
  }

  // Manager'ı yazılabilir köke kopyalar (yanında hash kaydıyla); zaten güncelse dokunmaz.
  async ensureManager() {
    const dest = path.join(this.root, "app");
    const exe = path.join(dest, "ltk-manager.exe");
    const manifest = path.join(dest, "bocchi-install.json");
    let kaynak = this.managerSource;
    if (this.managerOverride && (await exists(path.join(this.managerOverride, "ltk-manager.exe")))) kaynak = this.managerOverride;
    const srcExe = path.join(kaynak, "ltk-manager.exe");
    if (!(await exists(srcExe))) throw new Hata("mLtkYok");
    const srcStat = await fsp.stat(srcExe);
    const cur = await fsp.stat(exe).catch(() => null);
    const degisti = !cur || cur.size !== srcStat.size || Math.abs(cur.mtimeMs - srcStat.mtimeMs) > 2000;
    if (degisti || !(await exists(manifest))) {
      await fsp.mkdir(dest, { recursive: true });
      for (const name of ["ltk-manager.exe", "ltk_patcher_host.exe"]) {
        const from = path.join(kaynak, name);
        if (await exists(from)) await fsp.copyFile(from, path.join(dest, name));
      }
      const sha = await fileHash(exe);
      const version = await dosyaSurumu(exe);
      await atomicJson(manifest, { schema: 1, version, installerSha256: sha, managerSha256: sha });
    }
    return exe;
  }

  async ensureLibrary() {
    const library = this.library;
    const marker = path.join(library, "bocchi-owned.json");
    const index = path.join(library, "library.json");
    await fsp.mkdir(path.join(library, "mods"), { recursive: true });
    if (!(await exists(index))) {
      const id = crypto.randomUUID();
      const now = new Date().toISOString();
      await atomicJson(index, {
        version: 2,
        mods: [],
        profiles: [
          { id, name: "EXE", slug: "exe", enabledMods: [], modOrder: [], layerStates: {}, createdAt: now, lastUsed: now }
        ],
        activeProfileId: id,
        folders: [{ id: "root", name: "", modIds: [] }],
        folderOrder: ["root"]
      });
    }
    await atomicJson(marker, { schema: 2 });
    return library;
  }

  // Seçilen dosyaları içerik hash'iyle önbelleğe hazırlar ve seçim listesini yazar.
  async prepareSelection(library, sources) {
    const cache = path.join(library, "bocchi-prepared");
    await fsp.mkdir(cache, { recursive: true });
    const packages = [];
    for (const source of sources) {
      const st = await fsp.lstat(source);
      if (!st.isFile()) throw new Hata("mGecersizDosya", { ad: path.basename(source) });
      const sourceHash = await fileHash(source);
      let digest = sourceHash;
      let transformed;
      const layers = { base: true };
      if (/\.wad(?:\.client)?$/i.test(source)) {
        // Oyun WAD'ı adıyla eşleştirir: "Rengar.wad.client". Uygulamanın eklediği "<id>_" öneki atılır, ".wad" ise ".wad.client" olur.
        let wadAd = path.basename(source).replace(/^[0-9a-f]{16}_/i, "");
        if (/\.wad$/i.test(wadAd)) wadAd += ".client";
        transformed = buildStoreZip([
          { name: "META/info.json", data: managerMetadata(wadAd) },
          { name: `WAD/${wadAd}`, data: await fsp.readFile(source) }
        ]);
      } else if (/\.(fantome|zip)$/i.test(source)) {
        const zip = new StreamZip.async({ file: source });
        try {
          const entries = Object.values(await zip.entries());
          for (const e of entries) {
            const layer = /^(?:WAD|RAW)_([^/]+)\//i.exec(e.name.replace(/\\/g, "/"));
            if (layer) layers[layer[1]] = false;
          }
          const infos = entries.filter((e) => e.name.replace(/\\/g, "/").toLowerCase() === "meta/info.json");
          if (infos.length > 1) throw new Hata("mInfoCift", { ad: path.basename(source) });
          const infoEntry = infos[0];
          if (infoEntry && (infoEntry.isDirectory || infoEntry.size > 1024 * 1024)) {
            throw new Hata("mInfo", { ad: path.basename(source) });
          }
          const original = infoEntry ? await zip.entryData(infoEntry) : undefined;
          const info = managerMetadata(source, original);
          if (!original || !info.equals(original) || infoEntry.name.includes("\\")) {
            let bytes = 0;
            const files = [];
            for (const e of entries.filter((x) => !x.isDirectory)) {
              bytes += e.size;
              if (bytes > 512 * 1024 * 1024) throw new Hata("mBuyuk");
              files.push(e === infoEntry ? { name: "META/info.json", data: info } : { name: e.name, data: await zip.entryData(e) });
            }
            if (!infoEntry) files.push({ name: "META/info.json", data: info });
            transformed = buildStoreZip(files);
          }
        } finally {
          await zip.close();
        }
      } else {
        throw new Hata("mTur", { ad: path.basename(source) });
      }
      if (transformed) digest = crypto.createHash("sha256").update(transformed).digest("hex");
      const target = path.join(cache, `${digest}.fantome`);
      if (!(await exists(target))) {
        const temp = `${target}.tmp`;
        try {
          if (transformed) await fsp.writeFile(temp, transformed);
          else await fsp.copyFile(source, temp);
          await fsp.rename(temp, target);
        } finally {
          await fsp.rm(temp, { force: true });
        }
      }
      await fsp.utimes(target, new Date(), new Date());
      if (!packages.some((p) => p.sha256 === digest)) packages.push({ sourceId: sourceHash, sha256: digest, path: target, layers });
      this.kaynaklar.set(digest, source);
    }
    const revision = crypto.createHash("sha256").update(JSON.stringify(packages)).digest("hex");
    await atomicJson(path.join(library, "bocchi-selection.json"), { schema: 2, revision, packages });
    // Önbellek 256 MB'ı aşarsa, kullanılmayan en eski dosyaları sil.
    const keep = new Set(packages.map((p) => p.path));
    const files = [];
    for (const name of await fsp.readdir(cache)) {
      if (!/^[a-f0-9]{64}\.fantome$/.test(name)) continue;
      const file = path.join(cache, name);
      const s = await fsp.stat(file);
      files.push({ file, size: s.size, time: s.mtimeMs });
    }
    let total = files.reduce((n, f) => n + f.size, 0);
    for (const f of files.sort((a, b) => a.time - b.time)) {
      if (total <= 256 * 1024 * 1024) break;
      if (keep.has(f.file)) continue;
      await fsp.unlink(f.file);
      total -= f.size;
    }
  }

  childAlive() {
    return !!this.child && this.child.exitCode === null && !this.child.killed;
  }

  request(action) {
    const child = this.child;
    if (!child || !child.stdin.writable) return Promise.reject(new Hata("mCalismiyor"));
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.requests.delete(id);
        reject(new Hata("mYanitYok", { a: action }));
      }, action === "apply" ? 600000 : 200000);
      this.requests.set(id, { resolve, reject, timer });
      child.stdin.write(JSON.stringify({ id, epoch: this.epoch, action }) + "\n", (err) => {
        if (err) {
          clearTimeout(timer);
          this.requests.delete(id);
          reject(err);
        }
      });
    });
  }

  launch(manager, template) {
    const child = spawn(this.bridgeExe, ["--official-ltk-supervisor", manager, template], {
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
      detached: false
    });
    this.child = child;
    let output = "";
    let errorText = "";
    child.stderr.on("data", (c) => {
      errorText = (errorText + c.toString()).slice(-8192);
    });
    child.stdin.on("error", () => {});
    child.stdout.on("data", (chunk) => {
      output += chunk.toString();
      let end;
      while ((end = output.indexOf("\n")) >= 0) {
        const line = output.slice(0, end);
        output = output.slice(end + 1);
        let frame;
        try {
          frame = JSON.parse(line);
        } catch {
          continue;
        }
        this.emit("frame", frame);
        if (frame.type === "response") {
          const pending = this.requests.get(frame.id);
          if (!pending) continue;
          clearTimeout(pending.timer);
          this.requests.delete(frame.id);
          if (frame.ok) pending.resolve(frame.value);
          else pending.reject(frame.error ? new Error(frame.error) : new Hata("mReddetti"));
        } else if (frame.epoch === this.epoch && frame.type === "event") {
          const message = frame.line || "";
          if (message.startsWith("error ")) {
            this.active = false;
            this.emit("error-message", message);
          } else this.emit("status", message);
        } else if (frame.epoch === this.epoch && frame.type === "warning") {
          this.emit("warning", frame.message);
        } else if (frame.epoch === this.epoch && frame.type === "idle") {
          this.active = false;
          this.emit("idle", frame.message);
        }
      }
    });
    this.exited = new Promise((resolve) => {
      const finish = (error) => {
        if (this.child !== child) return resolve();
        this.child = null;
        this.game = null;
        this.active = false;
        for (const p of this.requests.values()) {
          clearTimeout(p.timer);
          p.reject(error || new Hata("mKapandi"));
        }
        this.requests.clear();
        this.emit("closed", error ? Hata.tanim(error) : null);
        resolve();
      };
      child.once("error", (e) => finish(e));
      child.once("close", (code) => finish(code === 0 ? undefined : errorText.trim() ? new Error(errorText.trim()) : new Hata("mBeklenmedik", { kod: code })));
    });
  }

  /** Seçilen skin dosyalarını uygular. gamePath: "...\\League of Legends\\Game" */
  async apply(sources, gamePath) {
    if (this.busy) throw new Hata("mMesgul");
    if (!sources.length) throw new Hata("mSkinYok");
    this.busy = true;
    ++this.epoch;
    try {
      const game = path.resolve(gamePath);
      if (this.child && !this.childAlive()) this.child = null;
      if (this.child && this.game !== game) {
        await this.shutdown();
      }
      if (this.child) await this.request("stop");
      const manager = this.child ? null : await this.ensureManager();
      const library = await this.ensureLibrary();
      if (!this.child) {
        const template = path.join(this.root, "test-settings.json");
        await atomicJson(template, {
          modStoragePath: library,
          leaguePath: game,
          firstRunComplete: true,
          startInTray: true,
          minimizeToTray: true,
          alwaysStartPatcher: false,
          autoDownloadUpdates: false,
          launchMode: "classic",
          stopPatcherOnSessionEnd: false
        });
        this.game = game;
        this.launch(manager, template);
        try {
          await this.request("stop");
        } catch (e) {
          const msg = (e && e.message) || "";
          // Motorun başlangıçta verdiği, zararsız olduğu bilinen hatalar
          if (!(msg.includes("get_patcher_status") || msg.includes("settings restoration") || msg.includes("not allowed by ACL"))) throw e;
        }
      }
      await this.prepareSelection(library, sources);
      await this.request("apply");
      this.active = true;
      // Manager'ın sağlık denetiminde onarılamaz çıkan kaynaklar (bunlar yüzünden oyun tüm modları kapatır)
      let kayit = "";
      try {
        const dosya = await fsp.open(path.join(library, "bocchi-bridge-events.jsonl"), "r");
        try {
          const { size } = await dosya.stat();
          const n = Math.min(size, 512 * 1024);
          const buf = Buffer.alloc(n);
          await dosya.read(buf, 0, n, size - n);
          kayit = buf.toString("utf8");
        } finally {
          await dosya.close();
        }
      } catch {}
      return kotuPaketler(kayit)
        .map((k) => ({ source: this.kaynaklar.get(k.sha), kurallar: k.kurallar }))
        .filter((k) => k.source);
    } finally {
      this.busy = false;
    }
  }

  async stop() {
    ++this.epoch;
    this.active = false;
    if (this.childAlive()) await this.request("stop");
  }

  /** Uygulama kapanırken: yamayı durdurur, köprüyü düzgünce kapatır. */
  async shutdown() {
    const child = this.child;
    if (!child) return;
    ++this.epoch;
    try {
      if (this.childAlive()) await Promise.race([this.request("stop"), new Promise((r) => setTimeout(r, 15000))]);
    } catch {}
    try {
      child.stdin.end(); // EOF: köprü Manager'ın ayarlarını geri yükleyip çıkar
    } catch {}
    await Promise.race([this.exited, new Promise((r) => setTimeout(r, 20000))]);
    if (child.exitCode === null) child.kill();
    this.active = false;
  }
}

// ---------------- Mod Re-sync: tarif ----------------
// Tarif = modun oyun bin'lerinde "sahiplendiği" (eklediği/değiştirdiği) PROP entry'leri.
// Yama gelip mod bozulunca bu liste güncel bin'e yeniden uygulanır (reSync).

// Oyundaki .wad.client dosyalarını (DATA/FINAL altında) bulur; göreli yollar.
async function oyunWadlari(gamePath) {
  const kok = path.join(gamePath, "DATA", "FINAL");
  const sonuc = [];
  async function gez(dir) {
    let ogeler;
    try { ogeler = await fsp.readdir(dir, { withFileTypes: true }); } catch { return; }
    for (const o of ogeler) {
      const tam = path.join(dir, o.name);
      if (o.isDirectory()) await gez(tam);
      else if (/\.wad\.client$/i.test(o.name)) sonuc.push(path.relative(gamePath, tam));
    }
  }
  await gez(kok);
  return sonuc;
}

// Yalnızca WAD başlığı + TOC okunur (veri değil): hash listesi.
async function wadTocOku(file) {
  const fh = await fsp.open(file, "r");
  try {
    const bas = Buffer.alloc(272);
    await fh.read(bas, 0, 272, 0);
    if (bas.toString("latin1", 0, 2) !== "RW" || bas[2] !== 3) return [];
    const count = bas.readUInt32LE(268);
    const toc = Buffer.alloc(count * 32);
    await fh.read(toc, 0, toc.length, 272);
    const hashler = new Array(count);
    for (let i = 0; i < count; i++) hashler[i] = toc.readBigUInt64LE(i * 32);
    return hashler;
  } finally {
    await fh.close();
  }
}

// hash(hex) -> oyun WAD göreli yolu. Oyun klasörü + WAD boyut/zamanına göre önbellekli.
const indeksOnbellek = new Map();
async function hashWadIndeksi(gamePath) {
  const wadlar = await oyunWadlari(gamePath);
  const imzaParca = [];
  for (const w of wadlar) {
    const st = await fsp.stat(path.join(gamePath, w)).catch(() => null);
    if (st) imzaParca.push(`${w}:${st.size}:${st.mtimeMs}`);
  }
  const imza = imzaParca.join("|");
  const eski = indeksOnbellek.get(gamePath);
  if (eski && eski.imza === imza) return eski.indeks;
  const indeks = new Map();
  for (const w of wadlar) {
    let hashler;
    try { hashler = await wadTocOku(path.join(gamePath, w)); } catch { continue; }
    for (const h of hashler) {
      const k = h.toString(16);
      if (!indeks.has(k)) indeks.set(k, w);
    }
  }
  indeksOnbellek.set(gamePath, { imza, indeks });
  return indeks;
}

// Mod arşivindeki WAD içeriği: Map(küçük-harf wad adı -> {ad, ogeler:[{hash:bigint, veri:()=>Promise<Buffer>}]}).
// İki biçim: "WAD/x.wad.client/yol/dosya" (açık klasör) veya "WAD/x.wad.client" (paket WAD).
// WAD dışındaki arşiv girdileri (META/...) `diger` listesine girer.
async function modWadIcerigi(zip) {
  const sonuc = new Map();
  const diger = [];
  const ekle = (ad, oge) => {
    const k = ad.toLowerCase();
    if (!sonuc.has(k)) sonuc.set(k, { ad, ogeler: [] });
    sonuc.get(k).ogeler.push(oge);
  };
  for (const e of Object.values(await zip.entries())) {
    if (e.isDirectory) continue;
    const ad = e.name.replace(/\\/g, "/");
    const m = /^wad\/([^/]+\.wad(?:\.client)?)(?:\/(.+))?$/i.exec(ad);
    if (!m) {
      diger.push(e);
      continue;
    }
    const wadAdi = m[1].replace(/\.wad$/i, ".wad.client");
    if (m[2]) {
      const dosya = path.posix.basename(m[2]);
      const hex = /^([0-9a-f]{16})(\.[a-z0-9]+)?$/i.exec(dosya);
      const hash = hex && m[2] === dosya ? BigInt("0x" + hex[1]) : binmotor.yolHash(m[2]);
      ekle(wadAdi, { hash, veri: () => zip.entryData(e) });
    } else {
      const wbuf = await zip.entryData(e);
      for (const we of binmotor.wadOku(wbuf).entries) {
        ekle(wadAdi, { hash: we.hash, veri: async () => binmotor.wadEntryVeri(wbuf, we) });
      }
    }
  }
  return { wadlar: sonuc, diger };
}

// Oyun WAD'ından tek bir entry'yi okur (yoksa null).
// Dev WAD'ı (Global ~GB) belleğe almamak için yalnızca TOC + o entry'nin baytları okunur.
async function oyunEntryOku(gamePath, oyunWad, hash) {
  const fh = await fsp.open(path.join(gamePath, oyunWad), "r");
  try {
    const bas = Buffer.alloc(272);
    await fh.read(bas, 0, 272, 0);
    if (bas.toString("latin1", 0, 2) !== "RW" || bas[2] !== 3) return null;
    const count = bas.readUInt32LE(268);
    const toc = Buffer.alloc(count * 32);
    await fh.read(toc, 0, toc.length, 272);
    for (let i = 0; i < count; i++) {
      if (toc.readBigUInt64LE(i * 32) !== hash) continue;
      const b = i * 32;
      const e = { offset: 0, compSize: toc.readUInt32LE(b + 12), tip: toc[b + 20] & 0x0f };
      const blob = Buffer.alloc(e.compSize);
      await fh.read(blob, 0, e.compSize, toc.readUInt32LE(b + 8));
      return binmotor.wadEntryVeri(blob, e);
    }
    return null;
  } finally {
    await fh.close();
  }
}

function propMu(buf) {
  return buf.length >= 8 && buf.toString("latin1", 0, 4) === "PROP";
}

async function tarifCikar(modFile, gamePath, secenek = {}) {
  const zip = new StreamZip.async({ file: modFile });
  try {
    const { wadlar } = await modWadIcerigi(zip);
    const indeks = await hashWadIndeksi(gamePath);
    const binler = [];
    for (const { ogeler } of wadlar.values()) {
      const binOgeleri = [];
      const gonderilen = [];
      for (const oge of ogeler) {
        let veri;
        try { veri = await oge.veri(); } catch { continue; }
        if (propMu(veri)) binOgeleri.push({ hash: oge.hash, veri });
        else gonderilen.push(oge.hash.toString(16));
      }
      for (const { hash, veri } of binOgeleri) {
        let mod;
        try { mod = binmotor.propEntryler(veri); } catch { continue; }
        if (!mod.tam) continue;
        const oyunWad = indeks.get(hash.toString(16)) || null;
        const oyunEntry = new Map();
        let oyunOzet = null;
        if (oyunWad) {
          try {
            const oyunVeri = await oyunEntryOku(gamePath, oyunWad, hash);
            if (oyunVeri && propMu(oyunVeri)) {
              oyunOzet = ozet(oyunVeri);
              for (const e of binmotor.propEntryler(oyunVeri).entries) {
                oyunEntry.set(e.keyHash, oyunVeri.subarray(e.start, e.end));
              }
            }
          } catch {}
        }
        const sahip = [];
        for (const e of mod.entries) {
          const oyundaki = oyunEntry.get(e.keyHash);
          if (!oyundaki || !oyundaki.equals(veri.subarray(e.start, e.end))) {
            sahip.push({ keyHash: e.keyHash, typeHash: e.typeHash });
          }
        }
        if (sahip.length) binler.push({ oyunWad, hash: hash.toString(16), oyunOzet, sahip, gonderilen, referans: [] });
      }
    }
    return { yama: secenek.yama || null, binler };
  } finally {
    await zip.close().catch(() => {});
  }
}

const ozet = (buf) => crypto.createHash("sha1").update(buf).digest("hex");

// Hızlı denetim: tarifteki bin'ler oyunda duruyor mu, ekleme anından beri Riot değiştirdi mi,
// referans verilen asset'ler hâlâ var mı. Mod dosyasını açmaz.
async function senkronDenetim(tarif, gamePath) {
  const indeks = await hashWadIndeksi(gamePath);
  const eksikBin = [];
  const eksikAsset = new Set();
  let degisti = false;
  for (const bin of tarif.binler || []) {
    const gonderilen = new Set(bin.gonderilen || []);
    for (const r of bin.referans || []) if (!gonderilen.has(r) && !indeks.has(r)) eksikAsset.add(r);
    if (!bin.oyunWad) continue; // modun kendi eklediği bin: oyunda karşılığı hiç yoktu
    const oyunWad = indeks.get(bin.hash);
    if (!oyunWad) {
      eksikBin.push(bin.hash);
      continue;
    }
    let veri = null;
    try { veri = await oyunEntryOku(gamePath, oyunWad, BigInt("0x" + bin.hash)); } catch {}
    if (!veri || !propMu(veri)) eksikBin.push(bin.hash);
    else if (ozet(veri) !== bin.oyunOzet) degisti = true;
  }
  const eksik = [...eksikAsset];
  return { gerek: degisti || eksikBin.length > 0 || eksik.length > 0, eksikBin, eksikAsset: eksik };
}

// Re-sync: her sahiplenilen bin için taban = GÜNCEL oyun bin'i, üstüne modun sahip entry'leri.
// Orijinal modFile salt-okunur; sonuç ciktiFile'a (.fantome) yazılır. WAD'lar paket (RW 3.4) olarak yazılır.
async function reSync(modFile, tarif, gamePath, ciktiFile) {
  const rapor = { senkronEntry: 0, eksikAsset: [], tipUyumsuz: [], yokBin: [] };
  const ozetler = {}; // hash -> senkronda taban alınan güncel oyun bin özeti (rozet bunu karşılaştırır)
  const tarifBin = new Map((tarif.binler || []).map((b) => [b.hash, b]));
  const indeks = await hashWadIndeksi(gamePath);
  const zip = new StreamZip.async({ file: modFile });
  const arsiv = [];
  try {
    const { wadlar, diger } = await modWadIcerigi(zip);
    for (const e of diger) arsiv.push({ name: e.name.replace(/\\/g, "/"), data: await zip.entryData(e) });
    for (const { ad, ogeler } of wadlar.values()) {
      const parcalar = [];
      for (const oge of ogeler) {
        let data = await oge.veri();
        const tb = tarifBin.get(oge.hash.toString(16));
        if (tb && propMu(data)) data = await binSenkronla(gamePath, indeks, tb, data, rapor, ozetler);
        parcalar.push({ hash: oge.hash, data });
      }
      arsiv.push({ name: `WAD/${ad}`, data: binmotor.wadYaz(parcalar) });
    }
  } finally {
    await zip.close().catch(() => {});
  }
  const gecici = `${ciktiFile}.${process.pid}.tmp`;
  await fsp.writeFile(gecici, buildStoreZip(arsiv));
  await fsp.rename(gecici, ciktiFile);
  rapor.eksikAsset = (await senkronDenetim(tarif, gamePath)).eksikAsset;
  return { rapor, ozetler };
}

async function binSenkronla(gamePath, indeks, tb, modBin, rapor, ozetler) {
  if (!tb.oyunWad) return modBin; // oyunda karşılığı olmayan bin: modunki aynen kalır
  const oyunWad = indeks.get(tb.hash);
  let oyunBin = null;
  if (oyunWad) {
    try { oyunBin = await oyunEntryOku(gamePath, oyunWad, BigInt("0x" + tb.hash)); } catch {}
  }
  if (!oyunBin || !propMu(oyunBin)) {
    rapor.yokBin.push(tb.hash);
    return modBin;
  }
  const r = binmotor.propBirlestir(oyunBin, modBin, tb.sahip.map((s) => s.keyHash));
  if (!binmotor.propEntryler(r.bin).tam) {
    rapor.yokBin.push(tb.hash); // güvenlik: ayrışmayan bin üretme
    return modBin;
  }
  ozetler[tb.hash] = ozet(oyunBin);
  rapor.senkronEntry += r.degisen.length + r.eklenen.length;
  for (const k of r.tipUyumsuz) rapor.tipUyumsuz.push((k >>> 0).toString(16));
  return r.bin;
}

// ---------------- Kalıcı onarım (FIX tıklaması) ----------------
// Manager her Uygula'da modu bellekte onarır ve onarılmış hâli overlay WAD'larına yazar. Bu fonksiyon modun
// entry'lerini overlay'deki hâlleriyle değiştirip yeni bir .fantome üretir: Manager artık onarım yapmaz (sağlıklı).
// Başka bir uygulanan modun da sağladığı hash'lere dokunulmaz (overlay'de birleşmiş olabilirler).
// Orijinal dosya salt-okunur; değişen yoksa çıktı yazılmaz.

// WAD TOC'u bir kez okunur: hash -> {offset, compSize, tip}
async function wadTocHaritasi(file) {
  const fh = await fsp.open(file, "r");
  try {
    const bas = Buffer.alloc(272);
    await fh.read(bas, 0, 272, 0);
    if (bas.toString("latin1", 0, 2) !== "RW" || bas[2] !== 3) return { fh: null, harita: new Map() };
    const count = bas.readUInt32LE(268);
    const toc = Buffer.alloc(count * 32);
    await fh.read(toc, 0, toc.length, 272);
    const harita = new Map();
    for (let i = 0; i < count; i++) {
      const b = i * 32;
      harita.set(toc.readBigUInt64LE(b), { offset: toc.readUInt32LE(b + 8), compSize: toc.readUInt32LE(b + 12), tip: toc[b + 20] & 0x0f });
    }
    return { fh, harita };
  } catch (e) {
    await fh.close().catch(() => {});
    throw e;
  }
}

async function modHashleri(file) {
  const kume = new Set();
  const zip = new StreamZip.async({ file });
  try {
    const { wadlar } = await modWadIcerigi(zip);
    for (const { ogeler } of wadlar.values()) for (const o of ogeler) kume.add(o.hash);
  } catch {
  } finally {
    await zip.close().catch(() => {});
  }
  return kume;
}

async function kaliciOnar(modFile, overlayDir, digerKaynaklar, ciktiFile) {
  const baska = new Set();
  for (const f of digerKaynaklar || []) for (const h of await modHashleri(f)) baska.add(h);
  let overlayWadlari = [];
  try {
    overlayWadlari = (await fsp.readdir(overlayDir, { recursive: true })).filter((f) => /\.wad\.client$/i.test(f));
  } catch {}
  const sonuc = { degisen: 0, ortak: 0 };
  const arsiv = [];
  const zip = new StreamZip.async({ file: modFile });
  try {
    const { wadlar, diger } = await modWadIcerigi(zip);
    for (const e of diger) arsiv.push({ name: e.name.replace(/\\/g, "/"), data: await zip.entryData(e) });
    for (const { ad, ogeler } of wadlar.values()) {
      const ovYol = overlayWadlari.find((f) => path.basename(f).toLowerCase() === ad.toLowerCase());
      const ov = ovYol ? await wadTocHaritasi(path.join(overlayDir, ovYol)) : { fh: null, harita: new Map() };
      try {
        const parcalar = [];
        for (const oge of ogeler) {
          let data = await oge.veri();
          const t = ov.harita.get(oge.hash);
          if (baska.has(oge.hash)) {
            if (t) sonuc.ortak++;
          } else if (t && ov.fh) {
            const blob = Buffer.alloc(t.compSize);
            await ov.fh.read(blob, 0, t.compSize, t.offset);
            let onarilmis = null;
            try {
              onarilmis = binmotor.wadEntryVeri(blob, { offset: 0, compSize: t.compSize, tip: t.tip });
            } catch {}
            if (onarilmis && !onarilmis.equals(data)) {
              data = onarilmis;
              sonuc.degisen++;
            }
          }
          parcalar.push({ hash: oge.hash, data });
        }
        arsiv.push({ name: `WAD/${ad}`, data: binmotor.wadYaz(parcalar) });
      } finally {
        if (ov.fh) await ov.fh.close().catch(() => {});
      }
    }
  } finally {
    await zip.close().catch(() => {});
  }
  if (sonuc.degisen > 0) {
    const gecici = `${ciktiFile}.${process.pid}.tmp`;
    await fsp.writeFile(gecici, buildStoreZip(arsiv));
    await fsp.rename(gecici, ciktiFile);
  }
  return sonuc;
}

module.exports = { Engine, readSkinInfo, buildStoreZip, kotuPaketler, dosyaSurumu, saglikSinifi, modSagliklari, fileHash, tarifCikar, hashWadIndeksi, senkronDenetim, reSync, kaliciOnar };
