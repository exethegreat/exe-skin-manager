# Dışa aktarma seçenekleri (⤓) — kısa tasarım

Tarih: 2026-11-19 · Durum: onaylandı

**Amaç:** ⤓ bugün modu yalnız klasöre açıyor. Kullanıcı modları (ör. RuneForge'da Old SGU) paylaşmak için doğrudan
dosya olarak da almak istiyor.

**Davranış:** ⤓ → küçük pencere: **Klasör** / **.fantome** / **.zip** + ☐ **Bilinmeyenleri temizle (n)** + Kapat.
- Klasör: bugünkü akış (klasör seç → `<ad>` alt klasörüne açılır, Explorer'da açılır).
- .fantome / .zip: "Farklı kaydet"; önerilen ad `<Ad> <Sürüm>.<uzantı>` (sürüm yoksa yalnız ad); kaydedince
  `shell.showItemInFolder`. .zip = aynı içerik.
- Bilinmeyenleri temizle: ✎'deki kuralın aynısı (`modduzenle` `bilinmeyenMi`); yalnız çıkan kopyaya uygulanır,
  uygulamadaki mod değişmez. Varsayılan kapalı; n = 0 iken pasif.
- Kaynak: Uygula'nın kullandığı dosya (senkron / kalıcı onarım türevi varsa o, yoksa orijinal) — *benim kararım*.
- Tek `.wad.client` olarak eklenmiş mod dosyaya çıkarılırken META/info.json eklenip fantome'a çevrilir.
- 13 dilde metin; `test/dil-test.js` geçmeli.

**Hedef olmayan:** .modpkg (kullanıcı vazgeçti: yazıcı yok, biçim alanları belirsiz).

**Yaklaşımlar:** (1) küçük seçim penceresi — SEÇİLDİ; (2) uygulama içinde ayrı dışa aktarma ayarları sayfası — üç
seçenek için fazla; (3) Windows kaydet penceresinin "dosya türü" listesi — klasör seçeneğini taşıyamaz.
