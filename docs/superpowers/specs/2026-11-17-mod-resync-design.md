# Tasarım: Mod Re-sync (güncel yamaya otomatik senkron)

**Tarih:** 2026-11-17 · **Proje:** EXE Skin Manager · **Durum:** onay bekliyor

## 1. Amaç ve neden
Kullanıcı (ExeTheGreat) LoL modları yapıyor. Modlar birkaç yama sonra bozuluyor: efektler/sesler kaybolur ya da oyun crash atar. Sebep neredeyse her zaman aynı: mod, eski bir **bütün bin'i** (karakter/items/shared) eski snapshot'ıyla eziyor; yeni oyun istemcisi bu eski yapıyı reddediyor ya da mod silinmiş asset'lere bağlı kalıyor.

Bu özellik, bozulan modu **güncel oyun bin'lerine yeniden senkronlar**: modun yaptığı değişiklikleri (sadece onları) **güncel bin'in üstüne enjekte eder** (splice). Crash'i yapısal olarak önler (asla eski bütün bin gönderilmez), efekt/ses'i geri getirir, silinmiş asset'leri dürüstçe raporlar. Bu, 2026-11'de Tiamat ve Rengar modları için elle yapılan işin otomatik hâlidir.

## 2. Hedefler
- Kendi modların yama sonrası **tek tıkla** güncel yamaya senkronlansın.
- Senkron **güncel bin'e ekleme** mantığıyla çalışsın → crash'i önlesin.
- Şeffaf olsun: neyin senkronlandığını, neyin (silinmiş asset) düzeltilemediğini söylesin.
- Kullanıcının **dış** mod yapma akışını (Obsidian/elle) hiç değiştirmesin.
- Dış bağımlılık eklemesin (saf Node; manager'ın mevcut yığını).

## 3. Hedef olmayanlar (non-goals)
- Mod **oluşturucu** değil (manager uygulayıcı kalır).
- Keyfi kara-kutu modları kusursuz düzeltmek değil; silinmiş asset'li modlar (Old Recall gibi) sadece **kısmen** düzelir + işaretlenir.
- Sessiz/otomatik senkron değil (opsiyon A reddedildi).
- Sıfırdan VFX yeniden yazımı değil.

## 4. Başarısızlık sayılır (anti-goals)
- Sessizce bozuk sonuç üretmek (eksik asset'i söylemeden senkronlamak).
- Modun değiştirmediği şeyi değiştirmek (stat/gameplay'i geri almak). Tasarım bunu **yapıca** engeller: tarif yalnızca modun gerçekten değiştirdiği entry'leri sahiplenir.

## 5. Kısıtlar
- Sürüm **1.0.0'da kalır** (kullanıcı kuralı) — özellik eklense de sürüm artmaz.
- Arayüz **sade** kalmalı; şişirme yok.
- Yeni arayüz metni = 13 dil çeviri satırı + `test/dil-test.js` geçmeli (CLAUDE.md §4).
- Mevcut apply/stop akışı bozulmamalı.
- Senkron **oyun kapalıyken** çalışmalı (patcher kuralı).

## 6. Değerlendirilen yollar
- **Yol 1 — ritobin + script'e yasla:** ELENDİ. Bu oturumda ritobin güncel (26.22) bin'leri çözemedi; çıkmaz.
- **Yol 2 — saf-Node entry-splice motoru:** SEÇİLDİ. Manager zaten WAD için Node zstd kullanıyor (`zlib.zstdDecompressSync`). Splice, bin **içeriğini çözmeden** entry-çerçevesi (PROP başlığı + uzunluk-öneki + keyHash) üzerinden yapılır — format-kararlı, araç-bağımsız. Bu oturumda Python'da kanıtlandı.
- **Yol 3 — ayrı fixer exe'si (LTK fix vb.):** ELENDİ. Motor sadece apply/stop açıyor; item/shared bin'lerini istediğimiz gibi halletmez; kırılgan.

Seçim: **Yol 2.** (Kullanıcı onayladı.)

## 7. Deneyim (UX — opsiyon B: uyar + tek tık)
- Her mod eklendiğinde, modun hangi yamada sağlıklı olduğu (oyun sürümü) **tarifle birlikte** saklanır.
- Oyun yaması değiştiğinde (ya da hızlı denetim eksik asset/tip uyumsuzluğu bulduğunda), ilgili mod listede **kırmızı "güncellenmeli" rozeti** + yanında **"Güncel yamaya senkronla"** düğmesiyle görünür.
- Düğmeye basınca senkron çalışır, bir **rapor** gösterir: kaç entry senkronlandı, hangi asset'ler silinmiş (liste), tip-uyumsuzluğu olan entry var mı.
- Başarılıysa modun dosyası + tarifteki yama damgası güncellenir, rozet kalkar.
- Mevcut sağlık denetimine (`kotuPaketler` / `patcher-wad-scan-failed`) entegre; otomatik senkron YOK, her şey kullanıcı tıkıyla.

## 8. Tarif (recipe) — çekirdek fikir
**Neden ekleme-anında yakalanır:** Mod eklenirken o yamada çalışıyordur; dolayısıyla `mod-bin ⟺ o-anki-oyun-bin'i` farkı = **saf yazar niyeti** (sürüm kayması yok denecek kadar az). Bu fark sonradan hesaplanamaz, çünkü 3 yama sonra fark = yazar niyeti + Riot'un değişiklikleri (ayırt edilemez). Bu yüzden tarif **ekleme anında** çıkarılır ve saklanır.

**Tarif, modun her bin dosyası için şunu tutar:**
- Hedef: bin'in gittiği oyun WAD'ı + hash yolu.
- Sahiplenilen entry keyHash listesi: modun o-anki oyun bin'ine göre **eklediği/değiştirdiği** entry'ler (keyHash + typeHash).
- Modun gönderdiği (kendi WAD'ındaki) asset yolları.
- Sahiplenilen entry'lerin **referans verdiği ama gönderilmeyen** (oyuna dayalı) asset yolları — senkronda varlığı denetlenir.
- Yakalama anındaki oyun yama damgası.

**Saklama:** `%APPDATA%\skin-yonetici\tarifler\<modId>.json` (sidecar; `durum.json` yalın kalır). `durum.json`'daki custom kaydına sadece `tarifVar: true` / `yama: "<N>"` eklenir.

**Stat/gameplay güvenliği yapıca gelir:** Tarif yalnızca modun gerçekten değiştirdiği entry'leri sahiplenir. Mod bir particle entry'si değiştirdiyse yalnızca o sahiplenilir; ItemData/stat değiştirmediyse tarifte yoktur → senkron onlara dokunmaz. (Bu oturumdaki "statları geri alma" riski, oradaki eski-bütün-bin yönteminden kaynaklanıyordu; tarif yöntemi bunu ortadan kaldırır.)

## 9. Senkron algoritması (bin başına)
1. Güncel oyun bin'ini (yeni yama) kayıtlı hash'ten oku → taban.
2. Tarifteki her sahiplenilen keyHash için modun entry baytlarını al:
   - Taban o keyHash'i içeriyorsa → **değiştir** (splice).
   - İçermiyorsa → **yeni entry ekle** (entryTypeHashes dizisi + sayaç güncellenir).
   - typeHash uyuşmuyorsa (sınıf değişmiş) → **işaretle**, atla, rapora yaz.
3. Birleşmiş bin'i yaz, modun WAD'ındaki bütün-bin'in yerine koy.
4. Asset'ler: modun gönderdiklerini olduğu gibi bırak; referans verilen-ama-gönderilmeyen asset'lerin yeni oyunda varlığını denetle → **eksik olanları listele**.
5. Rapor üret: N entry senkronlandı, M asset eksik (liste), K tip-uyumsuzluğu.

## 10. Mimari / dokunulan yerler
- **Yeni modül `src/binmotor.js`** (saf Node): WAD v3 oku/yaz (TOC, zstd via Node), PROP entry-çerçeve ayrıştır (başlık + linked + entryTypeHashes + uzunluk-önekli entry'ler), keyHash için splice/ekle, XXH64 (yol→hash), FNV1a-32 (entry anahtar→hash). (Bu oturumdaki `prop.py`/`wadtoc.py`/`xxh.py`/`splice.py` mantığının JS portu.)
- **`src/engine.js`**: ekleme akışında tarif çıkarma (`tarifCikar(modPath, gamePath)`); senkron (`reSync(modId, gamePath) → rapor`).
- **`src/main.js`**: IPC handler'ları (`tarif:cikar`, `mod:senkronla`); sağlık/yama denetimine rozet tetiği.
- **`src/ui/app.js` + `diller.js` + `style.css`**: kırmızı rozet, "Senkronla" düğmesi, rapor diyaloğu; yeni metinler 13 dilde.
- **`durum.json`**: custom kaydına `tarifVar`/`yama`. Yeni klasör `tarifler/`.

## 11. Builder'a bırakılanlar
- PROP'a **yeni entry ekleme** kodunun tam detayı (entryTypeHashes dizisi + sayaç + sıralama; replace zaten basit).
- WAD yeniden paketleme ayrıntıları (sıkıştırma tipi seçimi: değişen entry'yi zstd'le; entry checksum'ı — gerekiyorsa XXH3, yoksa koru/0).
- Rozet/düğme/rapor diyaloğunun görünümü + 13 dil satırları.
- Yama-değişti tetiğinin mevcut sağlık denetimine tam entegrasyonu.
- Saf-asset modları (bin yok): senkron sadece asset varlığını yeniden doğrular, splice yok.
- Zaten-bozuk eklenen mod: tarif temiz çıkmaz; düşük güven işaretiyle yine denenebilir (kenar durum, ileride).

## 12. Açık/riskli noktalar
- **Yeni entry ekleme** bu oturumda yapılmadı (sadece 1:1 replace yapıldı); PROP formatı tam biliniyor, port edilebilir ama test şart.
- Entry checksum doğrulaması: modlu WAD'larda genelde denetlenmiyor; mkoverlay ile doğrulanır.
- typeHash değişen entry'ler otomatik düzelmez (nadir; işaretlenir).

## 13. Builder-check sonrası netleşen kararlar (benim kararlarım)
- **Orijinal mod bozulmaz (pristine):** Senkron, modun `skinler\`'deki orijinal dosyasını **değiştirmez**. Senkron çıktısı ayrı bir türev olarak saklanır (ör. `tarifler\<id>.synced.fantome`) ve Uygula bunu kullanır. Her senkron **daima orijinal + tarif**ten üretilir → yama üstüne yama birikimli bozulma (drift) olmaz, istenirse orijinale dönülür. (§9.3'teki "yerine koy" bu türev dosyada olur, orijinalde değil.)
- **"Senkron gerekli" tetiği = hızlı denetim (yama numarası değil):** Her mod için, tarifteki her sahiplenilen bin'in güncel oyunda hâlâ var olup olmadığı + referans verilen asset'lerin mevcudiyeti hızlıca denetlenir; eksik/uyumsuz varsa rozet çıkar. Oyun yama numarası (`state.yama`) yalnızca ucuz bir ön-ipucu; asıl karar bu denetim. (Yama numarası web sayfasından geldiği için gecikebilir; gerçek kırılma sinyali daha güvenilir.)
- **Performans — hash→WAD indeksi:** Ekleme-anında bir mod bin'inin hangi oyun WAD'ında olduğunu bulmak için 394 WAD'ı taramak yerine, bir kere `hash→wad` indeksi kurulup önbelleğe alınır (oyun değişince yenilenir).
- **Kısmi senkron yine uygulanır:** Bazı asset'ler silinmişse mod yine de senkronlanıp uygulanır (eksik dokuyla da olsa çalışır); rapor eksikleri söyler, kullanıcı tutmaya/kapatmaya karar verir.
