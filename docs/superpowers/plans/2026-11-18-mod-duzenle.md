# Mod düzenleme penceresi (✎) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** "Kendi dosyalarım"daki her modun yanına ✎; iki sekmeli (Bilgi / Dosyalar) pencerede info.json, resim ve WAD'lar düzenlenip Uygula ile mod yeniden paketlenir.

**Architecture:** Saf paketleme mantığı yeni `src/modduzenle.js`'te (zip okuma + girdileri değiştirme, test edilebilir). `main.js` IPC uçları dosya seçimi, yazma ve kimlik taşımayı (tarif, senkron türevi, senkronGerek) yapar. Arayüz `app.js`'te `el()` ile kurulan bir katman pencere.

**Tech Stack:** Electron 35, düz JS, node-stream-zip, `engine.buildStoreZip`.

**Spec:** `docs/superpowers/specs/2026-11-18-mod-duzenle-design.md`

## Global Constraints
- Yeni arayüz metni = 13 dil satırı `src/ui/diller.js`'te; `{yer}` tutucular tüm dillerde aynı; `electron test/dil-test.js` geçmeli.
- Sürüm 1.0.1 kalır. Yazılımda başka kişi/proje adı geçmez.
- Mod kimliği = yeni zip'in sha256'sının ilk 16 hanesi; dosya `skinsDir/<id>_<ad>.fantome`.
- info.json'da bilinmeyen anahtarlar (ör. `Layers`) korunur; boş Home/Heart yazılmaz; Sürüm ≤ 24 karakter; Ad boş olamaz.
- Resim yalnız PNG → `META/image.png`.
- `.wad` → `.wad.client` adlandırması.
- Bilinmeyenleri sil: `META/` ve `WAD/` dışındaki girdiler + WAD klasörleri içindeki `.py .rito .txt .json` dosyaları.

## Review Focus
- WAD girdisi tek dosya (`WAD/X.wad.client`) ile klasör (`WAD/X.wad.client/...`) karışık modlar → liste ikisini de tek satırda göstermeli. (Task 1 testi)
- Klasör WAD'ı yerine aynı adlı dosya WAD'ı eklemek (ya da tersi) → eski girdilerin tamamı silinmeli, karışık kalıntı olmamalı. (Task 1 testi)
- `.wad.client` dosyası olarak eklenmiş mod (fantome değil) → düzenlenince fantome'a dönmeli, META oluşturulmalı. (Task 1 testi)
- Yeni içerik başka bir modla aynı kimliğe denk gelirse → hata, hiçbir şey değişmemeli. (Task 2)
- Yalnız META değişimi senkronlu modda → `synced` yolu taşınmalı, `syncedHash` aynı kalmalı. (Task 2 testi)

---

### Task 1: `src/modduzenle.js` — içerik okuma ve yeniden paketleme

**Files:**
- Create: `src/modduzenle.js`
- Test: `test/duzenle-test.js`

**Interfaces:**
- Produces:
  - `modIcerigi(file: string) → Promise<{info: object, wadlar: {ad: string, dosya: number}[], bilinmeyen: number, resimVar: boolean}>` — `bilinmeyen` = Bilinmeyenleri sil'in sileceği girdi sayısı.
  - `yenidenPaketle(file: string, d: Degisiklik) → Promise<{girdiler: {name, data: Buffer}[], wadDegisti: boolean}>`
  - `Degisiklik = {bilgi: {Name, Author, Version, Home, Heart, Description}, resim: string|null|"sil", wadSil: string[], wadEkle: {yol: string}[], bilinmeyenSil: boolean}` — `wadEkle.yol` dosya ya da klasör.
  - `wadGirdileri(yol: string) → Promise<{ad: string, girdiler}[]>` (dosya → tek girdi `WAD/<ad>`; klasör `X.wad.client` → `WAD/<ad>/...`; içinde birden çok `*.wad(.client)` olan klasör → her biri).
- Fantome değilse (`.wad`/`.wad.client`) içerik = tek WAD + boş info.

- [ ] **Step 1: Failing test** — `test/duzenle-test.js` geçici klasörde `buildStoreZip` ile sentetik fantome kurar (META/info.json `{Name:"A",Author:"x",Version:"1",Description:"",Layers:[1]}`, `META/image.png`, `WAD/Udyr.wad.client/data/a.bin`, `WAD/Udyr.wad.client/data/a.py`, `WAD/Ahri.wad.client` (dosya), `README.txt`) ve doğrular:
  - `modIcerigi`: wadlar = `[{ad:"Ahri.wad.client",dosya:1},{ad:"Udyr.wad.client",dosya:2}]` (ada göre sıralı), `bilinmeyen === 2`, `resimVar`.
  - yalnız bilgi değişimi: `wadDegisti === false`, info `Name:"B"`, `Layers` korunur, `Home` yok; WAD girdileri bayt bayt aynı.
  - `wadSil:["Ahri.wad.client"]` → Ahri yok, `wadDegisti`.
  - `wadEkle` bir `X.wad` dosyası → `WAD/X.wad.client`; `Udyr.wad.client` adlı dosya eklenince klasör hâlinin tüm girdileri gider.
  - `bilinmeyenSil` → `README.txt` ve `a.py` yok, `a.bin` var.
  - `resim:"sil"` → image.png yok; png yolu → image.png içeriği o dosya.
  - `.wad.client` dosyası girdi olarak verildiğinde `modIcerigi` 1 WAD döner; `yenidenPaketle` META/info.json üretir.
- [ ] **Step 2:** `node test/duzenle-test.js` → FAIL (modül yok).
- [ ] **Step 3:** `src/modduzenle.js`'i yaz (node-stream-zip ile girdileri oku; WAD adı = `WAD/` sonrası ilk parça; info birleştirme: eski info + bilgi alanları, boş Home/Heart sil, Version 24'e kırp).
- [ ] **Step 4:** `node test/duzenle-test.js` → `tamam`.
- [ ] **Step 5:** commit `feat: mod duzenleme paketleme modulu`.

### Task 2: `main.js` IPC + kimlik taşıma

**Files:**
- Modify: `src/main.js` (handlers; yeni `modDuzenle(s, d)`), `src/preload.js`
- Test: `test/duzenle-test.js` (taşıma kuralı için saf yardımcı)

**Interfaces:**
- Consumes: Task 1.
- Produces (IPC → `window.api`): `modIcerik(id)` → `mod:icerik`; `modWadSec()` → `mod:wadSec` (`string[]`); `modWadKlasorSec()` → `mod:wadKlasorSec` (`string[]`); `modResimSec()` → `mod:resimSec` (`string|null`, png filtresi); `modGozat(id)` → `mod:gozat`; `modDuzenle(id, d)` → `mod:duzenle` → `view()`.
- `modduzenle.kimlikTasima({wadDegisti, synced}) → {tarifTasi: boolean, senkronTasi: boolean, tarifYeniden: boolean}` (saf).

- [ ] **Step 1: Failing test** — `kimlikTasima({wadDegisti:false, synced:"x"})` → `{tarifTasi:true, senkronTasi:true, tarifYeniden:false}`; `synced` yoksa `senkronTasi:false`; `wadDegisti:true` → `{false,false,true}`.
- [ ] **Step 2:** test FAIL.
- [ ] **Step 3:** `kimlikTasima` + `main.js` `mod:duzenle`: `yenidenPaketle` → `buildStoreZip` → yeni id; aynıysa `view()`; başka modla çakışırsa `Hata("eAyniMod")`; `.tmp`'e yaz + rename; kayıt alanlarını (`id,file,name,author,version`) yerinde güncelle; taşıma kuralına göre tarif/synced dosyalarını yeniden adlandır ya da sil + `tarifKaydet`; `senkronGerek`/`saglik` anahtarlarını taşı; eski dosyayı sil; `secimDegisti()` (seçiliyse), `saveState()`, `setStatus("idle",{k:"sModGuncellendi",v:{ad}})`. `mod:gozat`: `os.tmpdir()/exe-skin-gozat/<id>`'ye `icerikCikar` + `shell.openPath`; uygulama kapanırken klasör silinir.
- [ ] **Step 4:** `node test/duzenle-test.js` → tamam.
- [ ] **Step 5:** commit.

### Task 3: Arayüz penceresi + 13 dil

**Files:**
- Modify: `src/ui/app.js` (`skinSatiri` → `duzenle` seçeneği ✎, ⤓'nün solu; `duzenlePenceresi(s)`), `src/ui/style.css`, `src/ui/diller.js`
- Test: `test/duzenle-ui-test.js` (yeni, electron; `senkron-ui-test` kalıbı)

**Interfaces:**
- Consumes: Task 2 `window.api` uçları.
- Dil anahtarları: `duzenle`, `dBaslik` ("Modu düzenle: {ad}"), `sekmeBilgi`, `sekmeDosyalar`, `alanAd`, `alanYazar`, `alanSurum`, `alanAnaSayfa`, `alanDestek`, `alanAciklama`, `alanResim`, `resimSec`, `resimKaldir`, `wadEkle`, `wadKlasorEkle`, `gozat`, `bilinmeyenSil` ("Bilinmeyenleri sil ({n})"), `kapat`, `uygulaDuzenle`, `wadDosya` ("{n} dosya"), `uAdBos`, `sModGuncellendi` ("“{ad}” güncellendi."), `eAyniMod`, `wadYok`.

- [ ] **Step 1: Failing UI test** — sentetik fantome ekle → ✎ → pencere görünür, Ad alanı info'daki ad → ad değiştir → Uygula → listede yeni ad, satır hâlâ seçili; tekrar ✎ → Dosyalar → WAD ✕ → Uygula → listede yine tek mod; Ad boşken Uygula pasif.
- [ ] **Step 2:** test FAIL.
- [ ] **Step 3:** pencere: arka plan katmanı + kutu; Esc/Kapat kapatır; sekmeler; bekleyen değişiklikler pencere durumunda; Uygula sonrası kapanır (hata olursa açık kalır, hata gösterilir); motor `running` iken Uygula pasif. Stil mevcut renk değişkenleriyle, açık/koyu.
- [ ] **Step 4:** `unset ELECTRON_RUN_AS_NODE; npx electron test/duzenle-ui-test.js`, `npx electron test/dil-test.js`, `npx electron test/senkron-ui-test.js` → geçer.
- [ ] **Step 5:** commit; `npm run paylasim` ile Setup derle.
