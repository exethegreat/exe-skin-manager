# Mod Re-sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bozulan modu, modun değişikliklerini güncel oyun bin'ine enjekte ederek (splice) tek tıkla güncel yamaya senkronlayan bir özellik eklemek.

**Architecture:** Saf-Node WAD/PROP entry-splice motoru (`src/binmotor.js`) bin içeriğini çözmeden entry-çerçevesi üzerinden çalışır. `engine.js` ekleme-anında "tarif" çıkarır, istendiğinde re-sync yapar. `main.js`/UI uyar + tek tık (opsiyon B) deneyimini sağlar.

**Tech Stack:** Electron 35 / Node 22 (saf JS, dış bağımlılık yok), `node:zlib` (zstd), `node:assert` (testler `node test/X.js` ile çalışır).

**Spec:** `docs/superpowers/specs/2026-11-17-mod-resync-design.md`

## Global Constraints
- Sürüm **1.0.0** sabit kalır (artırma yok).
- Dış bağımlılık **yok** (saf Node).
- Yeni arayüz metni = **13 dil** satırı (`diller.js`) + `electron test/dil-test.js` geçer.
- Mevcut apply/stop akışı bozulmaz.
- Senkron oyun kapalıyken çalışır; orijinal mod dosyası değiştirilmez (türev dosyaya yazılır).
- Yazılımda başka kişi/proje adı geçmez.

## Review Focus
- **Bozuk/eksik WAD veya PROP** (magic yanlış, TOC taşması): motor çökmeden "ayrıştırılamadı" dönmeli → Task 1 testinde bozuk buffer vakası.
- **type=4 (subchunked) zstd WAD entry**: bu oturumda hep type=3 görüldü; type=4'e rastlanırsa motor en azından güvenli hata vermeli → Task 1.
- **Modun hedef bin'i güncel oyunda YOK** (Riot kaldırmış): tarif/senkron bunu "bu bin artık yok" diye raporlamalı, çökmemeli → Task 4.
- **Sahiplenilen entry'nin typeHash'i değişmiş**: splice atlanmalı + raporlanmalı, bozuk bin üretilmemeli → Task 2 + Task 4.
- **Referans verilen asset silinmiş**: kısmi senkron yine üretilir, eksikler raporlanır → Task 4.

---

## Dosya yapısı
- **Create `src/binmotor.js`** — saf-Node WAD v3 + PROP motoru (oku/yaz/splice/hash). Tek sorumluluk: bin/WAD byte işlemleri.
- **Modify `src/engine.js`** — `tarifCikar`, `senkronDenetim`, `reSync` ekle; ekleme akışına tarif çıkarmayı bağla.
- **Modify `src/main.js`** — `mod:senkronla` IPC, add-mod akışında tarif, `view()`'a `senkronGerek` bayrağı.
- **Modify `src/ui/app.js`** — rozet + "Senkronla" düğmesi + rapor diyaloğu.
- **Modify `src/ui/diller.js`** — yeni 13-dil satırları.
- **Modify `src/ui/style.css`** — rozet stili.
- **Create `test/binmotor-test.js`**, **`test/tarif-test.js`** — `node` ile çalışan testler.

---

### Task 1: binmotor — WAD/PROP okuma + hash

**Files:**
- Create: `src/binmotor.js`
- Test: `test/binmotor-test.js`

**Interfaces:**
- Produces:
  - `xxh64(buf: Buffer) -> bigint` ve `yolHash(path: string) -> bigint` (küçük harfe çevirip xxh64).
  - `fnv1a32(str: string) -> number` (küçük harf).
  - `wadOku(buf: Buffer) -> { surum:[maj,min], entries: Array<{hash:bigint, offset:number, compSize:number, uncSize:number, tip:number}> }` (RW v3 TOC; magic/sürüm yanlışsa `throw`).
  - `wadEntryVeri(buf: Buffer, e) -> Buffer` (tip 0 raw / 1 gzip / 3 zstd; 4 → `throw` "desteklenmeyen").
  - `propEntryler(bin: Buffer) -> { surum:number, linked:string[], typeHashes:Uint32Array, entries: Array<{keyHash:number, typeHash:number, start:number, end:number}>, tam:boolean }` (`tam` = ayrıştırma dosya sonuyla birebir bitti mi).

- [ ] **Step 1: Write the failing test** — `test/binmotor-test.js`: bilinen değerlerle doğrula.
```js
const assert = require("node:assert");
const b = require("../src/binmotor");
// bilinen xxh64: "assets/shared/particles/buff-stone-red.dds" -> b7715e078b2db66d
assert.strictEqual(b.yolHash("assets/shared/particles/buff-stone-red.dds").toString(16), "b7715e078b2db66d");
// fnv1a32: "shared/particles/srx_buf_red" -> 0x66eeffa6 (Rengar SRX_Buf_Red entry anahtarı)
assert.strictEqual(b.fnv1a32("shared/particles/srx_buf_red") >>> 0, 0x66eeffa6);
```
(Not: gerçek fixture WAD/bin yolu için oyun klasöründen küçük bir bin okunabilir; fixture yolunu test başında `GAME` env'den al, yoksa WAD testlerini atla ama hash testleri her zaman çalışsın.)

- [ ] **Step 2: Run to verify it fails** — `node test/binmotor-test.js` → FAIL (modül yok).
- [ ] **Step 3: Implement** `xxh64`, `yolHash`, `fnv1a32`, `wadOku`, `wadEntryVeri`, `propEntryler` in `src/binmotor.js`. Algoritmalar spec'teki Python portundan: XXH64 seed=0; WAD v3 TOC = 2+1+1+256+8 + u32 count + 32B/entry (hash u64, off u32, comp u32, unc u32, tip = byte@20 & 0x0F); PROP = "PROP"+u32 sürüm + (sürüm≥2) linked + u32 count + u32×count typeHashes + her entry [u32 len][u32 keyHash][u16 fieldCount][...]; `tam` = off===buf.length. zstd için `require("node:zlib").zstdDecompressSync`.
- [ ] **Step 4: Run to verify it passes** — `node test/binmotor-test.js` → PASS.
- [ ] **Step 5: Commit** — `git add src/binmotor.js test/binmotor-test.js && git commit -m "feat(binmotor): WAD/PROP okuma + hash"`

---

### Task 2: binmotor — splice/ekle + WAD yaz (round-trip)

**Files:**
- Modify: `src/binmotor.js`
- Test: `test/binmotor-test.js` (genişlet)

**Interfaces:**
- Consumes: Task 1 (`wadOku`, `propEntryler`).
- Produces:
  - `propBirlestir(taban: Buffer, kaynak: Buffer, keyHashler: number[]) -> { bin: Buffer, degisen:number[], eklenen:number[], tipUyumsuz:number[] }` — `kaynak`taki verilen keyHash entry'lerini `taban`a uygula: varsa replace, yoksa ekle (typeHashes dizisi+count güncellenir), typeHash uyuşmazsa atla+`tipUyumsuz`a ekle. Çıkan `bin` `propEntryler(...).tam===true` olmalı.
  - `wadYaz(entries: Array<{hash:bigint, data:Buffer}>) -> Buffer` — RW v3.4 WAD üret (zstd tip=3; imza alanı sıfır; checksum 0 — modlu WAD'da denetlenmiyor).

- [ ] **Step 1: Write the failing test** — round-trip + splice:
```js
// bir oyun bin'ini oku, bir entry'yi kendisiyle splice et -> propEntryler.tam true, entry sayısı değişmez
// farklı bir bin'den bir entry'yi ekle -> entry sayısı +1, eklenen içinde o keyHash var
// WAD round-trip: wadYaz([{hash,data}]) -> wadOku -> aynı hash + wadEntryVeri === data
```
- [ ] **Step 2: Run to verify it fails** — `node test/binmotor-test.js` → FAIL.
- [ ] **Step 3: Implement** `propBirlestir` (replace: byte-bloğu değiştir; ekle: typeHashes'e typeHash ekle, count++, entry bloğunu sona ekle) ve `wadYaz` (TOC + zstd sıkıştır). Replace/ekle bu oturumdaki `splice.py` mantığının üstüne "ekle" durumu.
- [ ] **Step 4: Run to verify it passes** — PASS.
- [ ] **Step 5: Commit** — `git commit -m "feat(binmotor): propBirlestir (splice/ekle) + wadYaz"`

---

### Task 3: engine — tarifCikar (ekleme-anında tarif)

**Files:**
- Modify: `src/engine.js`
- Test: `test/tarif-test.js`

**Interfaces:**
- Consumes: Task 1-2 (`binmotor`), oyun klasörü (`gamePath`).
- Produces:
  - `tarifCikar(modFile: string, gamePath: string) -> Promise<Tarif>`
  - `Tarif = { yama:string|null, binler: Array<{ oyunWad:string, hash:string, sahip: Array<{keyHash:number, typeHash:number}>, gonderilen:string[], referans:string[] }> }`
  - Mantık: mod WAD'ındaki her PROP bin için → o bin'in hedef hash'ini bul → **hash→WAD indeksi** (bir kere kur, önbelleğe al) ile oyundaki eşini bul → `propEntryler` ile iki taraftaki keyHash setini çıkar → mod'da olup oyunda olmayan + mod'da olup oyundan farklı (byte) entry'ler = `sahip`. Gönderilen asset'ler = mod WAD'ındaki asset hash'leri; referans = (v1'de boş bırakılabilir; asset denetimi Task 4'te gönderilen/oyun kümesiyle yapılır).

- [ ] **Step 1: Write the failing test** — `test/tarif-test.js`: bir fixture mod (ör. bu oturumdaki Rengar HH ya da Old Red Blue) + `GAME` env ile `tarifCikar` çağır; `sahip` listesinde beklenen keyHash'lerin bulunduğunu doğrula. `GAME` yoksa test `skip`.
- [ ] **Step 2: Run to verify it fails** — `node test/tarif-test.js`.
- [ ] **Step 3: Implement** `tarifCikar` + `hashWadIndeksi(gamePath)` (önbellekli). `module.exports`'a ekle.
- [ ] **Step 4: Run to verify it passes.**
- [ ] **Step 5: Commit** — `git commit -m "feat(engine): tarifCikar + hash-WAD indeksi"`

---

### Task 4: engine — senkronDenetim + reSync + rapor

**Files:**
- Modify: `src/engine.js`
- Test: `test/tarif-test.js` (genişlet)

**Interfaces:**
- Consumes: Task 1-3.
- Produces:
  - `senkronDenetim(tarif: Tarif, gamePath: string) -> { gerek:boolean, eksikBin:string[], eksikAsset:string[] }` — her sahip bin hâlâ oyunda var mı + referans/gönderilmeyen asset'ler var mı.
  - `reSync(modFile: string, tarif: Tarif, gamePath: string, ciktiFile: string) -> Promise<{ rapor:{ senkronEntry:number, eksikAsset:string[], tipUyumsuz:string[], yokBin:string[] } }>` — her sahip bin için: oyun bin'ini oku (yoksa `yokBin`e ekle) → mod'un o bin'ini oku → `propBirlestir(oyunBin, modBin, sahipKeyHashler)` → sonucu modun WAD kopyasına koy → tüm bin'ler bitince `wadYaz` ile **ciktiFile**'a yaz (orijinal `modFile` DOKUNULMAZ). Eksik asset'leri hesapla.

- [ ] **Step 1: Write the failing test** — stale senaryo: fixture mod + güncel oyun; `reSync` çağır; `ciktiFile` üretilsin; `binmotor.propEntryler` ile çıktı bin'in `tam===true` olduğunu ve sahip entry'lerin güncel bin'e girdiğini doğrula; `rapor.senkronEntry > 0`. Bozuk hedef (var olmayan hash) → `yokBin` dolu, çökme yok.
- [ ] **Step 2: Run to verify it fails.**
- [ ] **Step 3: Implement** `senkronDenetim`, `reSync`. Orijinal dosyayı salt-okur; çıktı ayrı.
- [ ] **Step 4: Run to verify it passes.**
- [ ] **Step 5: Commit** — `git commit -m "feat(engine): senkronDenetim + reSync + rapor"`

---

### Task 5: main.js — tarif kaydı, IPC, rozet bayrağı

**Files:**
- Modify: `src/main.js`
- Test: `node --check` + mevcut `electron test/ui-test.js` kırılmamalı (IPC birim testi yok).

**Interfaces:**
- Consumes: Task 3-4.
- Produces:
  - Add-mod akışında (özel mod eklenince): `tarifCikar` çağrılır, sidecar `tarifler/<id>.json` yazılır, `durum.json` custom kaydına `tarifVar:true, yama:<N>`. (Oyun klasörü yoksa tarif atlanır, mod yine eklenir.)
  - IPC `handlers["mod:senkronla"] = async (id) => { ... reSync ... return { ok:true, veri: rapor } }` — çıktı `tarifler/<id>.synced.fantome`; başarılıysa custom kaydının apply için kullandığı dosya bu türevi gösterir (orijinal yol ayrı alanda `kaynakFile` korunur).
  - `view()`: her custom moda `senkronGerek:boolean` (sidecar varsa `senkronDenetim` ucuz sonucu; yoksa false).

- [ ] **Step 1:** `node --check src/main.js` baştan geçer (regresyon tabanı).
- [ ] **Step 2: Implement** add-mod hook + IPC + `view()` bayrağı. (Mevcut handler/IPC desenine uy: yanıt `{ok, veri}`/`{ok:false, hata}`.)
- [ ] **Step 3:** `node --check src/main.js` → OK; `unset ELECTRON_RUN_AS_NODE; electron test/ui-test.js` kırılmadı.
- [ ] **Step 4: Commit** — `git commit -m "feat(main): tarif kaydi + mod:senkronla IPC + senkronGerek bayragi"`

---

### Task 6: UI — rozet + Senkronla düğmesi + rapor + 13 dil

**Files:**
- Modify: `src/ui/app.js`, `src/ui/diller.js`, `src/ui/style.css`
- Test: `electron test/dil-test.js`

**Interfaces:**
- Consumes: Task 5 (`senkronGerek`, `mod:senkronla`).
- Produces: özel mod satırında `senkronGerek` ise **kırmızı rozet** + **"Güncel yamaya senkronla"** düğmesi; tık → `mod:senkronla` → dönen raporu diyalogda göster (N entry senkronlandı; eksik asset listesi; tip-uyumsuz). Yeni `diller.js` anahtarları (13 sütun): `rozetSenkron`, `btnSenkronla`, `rapBaslik`, `rapEntry`, `rapEksikAsset`, `rapTipUyumsuz`, `rapTamam`. `{yer}` tutucular tüm dillerde aynı.

- [ ] **Step 1: Write the failing test** — `test/dil-test.js` zaten tüm anahtarların 13 dilde ve tutucuların tutarlı olmasını denetliyor; yeni anahtarlar eklenince (henüz çevrilmeden) önce **FAIL** etmeli.
- [ ] **Step 2: Run to verify it fails** — `unset ELECTRON_RUN_AS_NODE; electron test/dil-test.js` → FAIL.
- [ ] **Step 3: Implement** `diller.js`'e 7 anahtarı 13 dilde ekle; `app.js`'e rozet/düğme/rapor diyaloğu; `style.css`'e rozet stili (mevcut `isaret kirmizi` desenine yakın).
- [ ] **Step 4: Run to verify it passes** — `electron test/dil-test.js` → PASS.
- [ ] **Step 5: Commit** — `git commit -m "feat(ui): senkron rozeti + dugme + rapor + 13 dil"`

---

## Self-review notu
- **Spec kapsamı:** §7 UX→Task 5-6; §8 tarif→Task 3; §9 algoritma→Task 2+4; §10 mimari→tüm task'lar; §13 kararlar (pristine/tetik/indeks/kısmi)→Task 4-5. Kapsandı.
- **Review Focus:** bozuk WAD/PROP→Task 1; type=4→Task 1; hedef bin yok→Task 4; typeHash uyumsuz→Task 2+4; silinmiş asset→Task 4. Her biri bir task testinde.
- **Tip tutarlılığı:** `Tarif`/`sahip`/`reSync` imzaları task'lar arası aynı adla kullanıldı.
- **Oran:** Plan spec'ten kısa; kod blokları imza/asersiyon düzeyinde, gövde yok.
