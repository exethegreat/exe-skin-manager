# Dışa aktarma seçenekleri Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** ⤓ seçim penceresi: Klasör / .fantome / .zip + Bilinmeyenleri temizle.
**Architecture:** Saf `modduzenle.disaAktarGirdileri(file, {temizle})` girdileri üretir; `main.js` `skin:cikar(id, {tur, temizle})` yazar; `app.js` küçük pencere.
**Tech Stack:** Electron 35, node-stream-zip, `buildStoreZip`.
**Spec:** `docs/superpowers/specs/2026-11-19-disa-aktar-design.md`

## Global Constraints
- 13 dil satırı, `{yer}` aynı; sürüm 1.0.1.
- Kaynak = `uygulanacak(s)` (senkron türevi varsa o).
- Uygulamadaki mod dosyası değişmez.

## Review Focus
- Tek `.wad.client` mod → .fantome'da `META/info.json` + `WAD/<ad>` olmalı (Task 1 testi).
- `temizle:false` → girdiler kaynakla birebir aynı, info.json dokunulmaz (Task 1 testi).
- Kaydet penceresinde iptal → hiçbir dosya yazılmaz, durum değişmez (Task 2).
- Dosya adında geçersiz karakter (`:` `?`) → önerilen ad temizlenir (Task 2).
- Klasör seçeneğinde temizle işaretliyse dökümler klasöre çıkmaz (Task 2).

### Task 1: `disaAktarGirdileri` (modduzenle.js)
- Interfaces: `disaAktarGirdileri(file: string, {temizle: boolean}) → Promise<{name, data}[]>`; fantome değilse `META/info.json` (`Name` = dosya adı, `Version` "1.0.0") eklenir; `temizle` → `bilinmeyenMi` girdileri atılır.
- [ ] Test (`test/duzenle-test.js`'e ek): temizlesiz = kaynak adları/içerikleri aynı; temizli = `README.txt`, `a.py` yok; `Tek.wad.client` → `["META/info.json","WAD/Tek.wad.client"]`.
- [ ] FAIL → uygula → `node test/duzenle-test.js` tamam → commit.

### Task 2: IPC + pencere + 13 dil
- `skin:cikar(id, {tur: "klasor"|"fantome"|"zip", temizle})`: klasör → mevcut akış, temizle ise girdiler `disaAktarGirdileri` ile tek tek yazılır; dosya → `showSaveDialog` (`defaultPath` = önerilen ad, filtre tür), iptal → `view()`; yaz `.tmp` + rename; `shell.showItemInFolder`; durum `sDisaAktarildi {yol}`.
- `mod:icerik` zaten `bilinmeyen` sayısını veriyor; pencere onu kullanır.
- Diller: `dDisaBaslik` ("Dışa aktar: {ad}"), `disaKlasor`, `disaFantome`, `disaZip`, `disaTemizle` ("Bilinmeyenleri temizle ({n})"), `sDisaAktarildi` ("Dışa aktarıldı: {yol}"); `cikar` ipucu "Dışa aktar".
- [ ] UI testine ek (`duzenle-ui-test.js`): ⤓ → pencere 3 düğme; Kapat kapatır. (Kaydet penceresi otomatik basılamaz; dosya içeriği Task 1 testinde doğrulanır.)
- [ ] `duzenle-ui-test`, `dil-test`, `senkron-ui-test` geçer → commit → `npm run paylasim`.
