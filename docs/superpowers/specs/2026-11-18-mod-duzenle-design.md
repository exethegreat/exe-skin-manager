# Mod düzenleme penceresi (✎) — tasarım

Tarih: 2026-11-18 · Durum: onay bekliyor

## Amaç ve neden
"Kendi dosyalarım" listesindeki her modun yanında ✎ düğmesi olur; tıklanınca açılan iki sekmeli pencerede modun
bilgileri ve WAD'ları düzenlenir, **Uygula** ile mod dosyası yeniden paketlenir. Kullanıcı kendi modlarını
(ör. Old SGU, Old Recall) sık düzenleyip deniyor: bugün ad/sürüm/açıklama değiştirmek ya da bir WAD eklemek/çıkarmak
için modu dışarıda yeniden paketleyip ✕ ile silip tekrar eklemek gerekiyor; ayrıca WAD klasöründe unutulan metin
dökümleri (`.py`, `.rito`) Manager'da ölümcül hata yaptırabiliyor (Old Runes dersi). Örnek alınan arayüz: kullanıcının
gösterdiği başka bir uygulamadaki "Edit mod" penceresi (INFO / FILES sekmeleri) — yazılımda o uygulamanın adı geçmez.

## Hedefler
- Bilgi sekmesi: `META/info.json` alanları **Ad (Name), Yazar (Author), Sürüm (Version), Ana sayfa (Home),
  Destek bağlantısı (Heart), Açıklama (Description)** + `META/image.png` (seç / kaldır, küçük önizleme).
- Dosyalar sekmesi: moddaki WAD'ların listesi (her biri ✕ ile silinir), **WAD ekle** (`.wad.client` / `.wad` dosyası),
  **Klasör ekle** (açılmış WAD klasörü, ör. `Udyr.wad.client\`), **Göz at** (modun içini geçici bir klasöre açıp
  Explorer'da gösterir), **☐ Bilinmeyenleri sil**.
- **Uygula**: değişiklikler tek seferde yeni bir `.fantome` olarak yazılır; mod listede aynı yerde, aynı seçim
  durumuyla kalır. **Kapat**: hiçbir şey değişmez.
- Mod Re-sync ve sağlık rozeti düzenlemeden sonra da doğru çalışır (kimlik taşıma, aşağıda).

## Hedef olmayanlar
- WAD içindeki tek tek dosyaları (bin, dds…) düzenlemek / gezinmek. Göz at yalnız bakmak içindir; orada yapılan
  değişiklikler moda geri alınmaz.
- Katalog (indirilen) skinleri düzenlemek — yalnız kendi eklenen modlar.
- Mod dosyasını uygulamanın dışında (masaüstündeki kaynak dosyada) değiştirmek: yalnız uygulamanın kendi kopyası
  (`skinsDir` altındaki dosya) değişir.

## Olmaması gerekenler (anti-hedefler)
- Kapat'a basınca ya da Uygula hata verince mod bozulmuş/yarım yazılmış kalması. Yazma geçici dosyaya yapılır,
  başarılıysa yer değiştirilir; eski dosya en son silinir.
- Düzenlenen modun rozetinin yanlış (eski moda ait) karar göstermesi ya da tarifinin eski içerikle kalması.
- Başka kişi/proje adlarının arayüzde geçmesi.

## Kısıtlar
- Modun kimliği (`id`) dosya içeriğinin sha256'sının ilk 16 hanesi; içerik değişince kimlik değişir. Kimliğe bağlı
  olanlar: `tarifler\<id>.json` (tarif), `tarifler\<id>.synced.fantome` (senkron türevi), `senkronGerek` haritası,
  sağlık rozeti (Manager kararı sha256 ile eşlenir), dosya adı `skinsDir\<id>_<ad>.fantome`.
- Yeni arayüz metinleri 13 dilde satır olarak `diller.js`'e eklenir; `test/dil-test.js` geçmeli. Uygulama sürümü
  1.0.1 kalır.
- Büyük modlar (OldSR V3 ≈ 361 MB) da düzenlenebilmeli; info.json 32 MB'a kadar olabilir (`INFO_EN_BUYUK`).
- Mod uygulanmışken (motor çalışırken) düzenleme serbest; değişiklik sonraki Uygula'da etkili olur (eklemedeki gibi
  `secimDegisti()` → `dirty`).

## Yaklaşımlar
1. **Uygula'da yeniden paketleme (SEÇİLDİ).** Pencere orijinal fantome'u okur; Uygula'da girdiler (META + WAD'lar,
  eklenen/silinen uygulanmış hâliyle) `buildStoreZip` ile yeni dosyaya yazılır, kimliğe bağlı her şey yeni kimliğe
  taşınır. Tek tık, diskte fazladan kopya yok. Kullanıcının Old SGU akışına (düzenle → dene) en hızlısı.
2. Çalışma klasörüne açıp oradan geri paketleme. Daha esnek (WAD içi dosyalar da düzenlenir) ama iki adımlı ve her
  mod için diskte kopya kalır. Seçilmedi.
3. Yalnız uygulama kaydında ad/sürüm değiştirme (dosyaya dokunmadan). Dosyalar sekmesi gerçek içerik değişikliği
  gerektirdiği ve dışarı çıkarılan modda eski ad göründüğü için elendi.

## Kararlaştırılan davranış
### Bilgi sekmesi
- Alanlar mevcut info.json'dan doldurulur; info.json'daki bilinmeyen diğer anahtarlar (ör. katmanlı modlarda
  `Layers`) **olduğu gibi korunur**, yalnız bu 6 alan yazılır. Boş Home/Heart anahtar olarak yazılmaz.
- Ad boş olamaz (Uygula düğmesi pasif + uyarı). Sürüm en çok 24 karakter (listede zaten 24'e kırpılıyor).
- Resim: yalnız PNG kabul edilir (Manager `META/image.png` okur), `META/image.png` olarak yazılır; ✕ kaldırır.

### Dosyalar sekmesi
- Liste: `WAD/` altındaki en üst ad (dosya `WAD/X.wad.client` ya da klasör `WAD/X.wad.client/...`) her satırda bir
  WAD. Klasör hâlindeki WAD'da kaç dosya olduğu alt satırda.
- WAD ekle: `.wad` uzantısı `.wad.client`'e çevrilir (motor düzeltmesi #10 ile aynı kural). Aynı adlı WAD varsa yenisi
  onun yerine geçer.
- Klasör ekle: mevcut `klasorGirdileri` düzen kuralları kullanılır (klasörün kendisi `X.wad.client` ise o WAD olur;
  içinde WAD'lar varsa her biri). Aynı adlı WAD'ın yerine geçer.
- Bilinmeyenleri sil (işaretlenirse Uygula'da): `META/` ve `WAD/` dışındaki her girdi + WAD klasörlerinin içindeki
  metin dökümleri (`.py`, `.rito`, `.txt`, `.json`, `.cdtb.py` — oyunun okumadığı, Manager'ın tarayıp hata
  sayabildiği dosyalar). Kaç dosyanın silineceği işaretlenince yazılır.
- Göz at: modun **şu anki kaydedilmiş** hâli `%TEMP%` altında bir klasöre açılır ve Explorer'da gösterilir.
- Mod `.wad`/`.wad.client` tek dosya olarak eklenmişse pencere açılınca o tek WAD listede görünür; Uygula'da mod
  fantome'a dönüşür (META oluşturulur).

### Uygula (kayıt)
1. Yeni içerik bellekte kurulur → yeni `id` hesaplanır. İçerik değişmediyse hiçbir şey yapılmaz.
2. Yeni id başka bir modla aynıysa hata (`eAyniMod`), hiçbir şey değişmez.
3. Yeni dosya `skinsDir\<yeniId>_<ad>.fantome` olarak geçici addan yazılıp yerine konur; kayıt (`state.custom`)
   aynı sırada ve aynı `selected` ile güncellenir (`name/author/version` yeni info'dan); eski dosya silinir.
4. Kimlik taşıma:
   - **Yalnız META değiştiyse** (WAD girdileri bayt bayt aynı): `tarifler\<eskiId>.json` → `<yeniId>.json`,
     senkron türevi `<eskiId>.synced.fantome` → `<yeniId>.synced.fantome` (yolu `s.synced` güncellenir, `syncedHash`
     aynı kalır → rozet korunur), `senkronGerek` değeri taşınır.
   - **WAD değiştiyse**: eski tarif ve senkron türevi silinir, `s.synced/syncedHash` temizlenir, `tarifKaydet` ile o anki
     yamadan yeni tarif çıkarılır (düzenlenmiş hâl o an çalışan hâl sayılır — eklemedeki kural), `senkronGerek=false`.
     Rozet bir sonraki Uygula'ya (Manager yeni dosyayı denetleyene) kadar boş görünür.
5. Seçiliyse `secimDegisti()`; `saveState()`; `view()` döner. Durum satırında "Mod güncellendi" mesajı.

## Mimari (öneri)
- `src/modduzenle.js` (yeni): `modIcerigi(file)` → `{info, wadlar:[{ad, dosyaSayisi}], bilinmeyenler:[...], resimVar}`;
  `yenidenPaketle(file, degisiklik)` → `{girdiler, metaDegisti, wadDegisti}` (saf, test edilebilir; `buildStoreZip`
  `engine.js`'ten).
- `main.js` IPC: `mod:icerik(id)`, `mod:wadSec()`, `mod:klasorSec()`, `mod:resimSec()` (yalnız yol döner, değişiklik
  pencere kapanana kadar arayüzde bekler), `mod:gozat(id)`, `mod:duzenle(id, degisiklik)` → `view()`.
  `degisiklik = {bilgi:{Name,Author,Version,Home,Heart,Description}, resim: yol|null|"sil", wadSil:[ad], wadEkle:[{yol, tur:"dosya"|"klasor"}], bilinmeyenSil:bool}`.
- `preload.js`: karşılık gelen `window.api` işlevleri.
- `ui/app.js`: `skinSatiri`'na ✎ düğmesi (`duzenle` seçeneği, ⤓'nün solunda); pencere `el()` ile kurulan bir katman
  (arka plan karartma, Esc/Kapat kapatır, odak pencerede kalır); `style.css`'te açık/koyu temaya uyan stil;
  Arapça'da RTL.
- `diller.js`: pencere başlığı, sekme adları, alan etiketleri, düğmeler, uyarılar (13 dil).

## Testler
- `node test/duzenle-test.js` (yeni, sentetik fantome): yalnız META değişimi → WAD girdileri aynı, `Layers` korunur;
  WAD ekle/sil/yerine koy; `.wad`→`.wad.client`; bilinmeyenleri sil `.py/.rito` dökümlerini atar, oyun dosyalarına
  dokunmaz; içerik aynıysa değişiklik yok.
- `electron test/senkron-ui-test.js`'e ya da yeni bir UI testine: ✎ → pencere → ad değiştir → Uygula → listede yeni ad,
  seçim korunur, tarif dosyası yeni kimlikte; WAD sil → tarif yeniden çıkarılır.
- `electron test/dil-test.js` 13 dil.

## Kurucuya bırakılanlar (benim kararlarım, onayda düzeltilebilir)
- ✎ ikonunun yeri (⤓'nün solu) ve pencerenin görsel ayrıntıları mevcut tasarım diline göre.
- "Göz at"ın geçici klasörü uygulama kapanınca temizlenir.
- Çok büyük modlarda Uygula sırasında durum satırında "Mod paketleniyor…" gösterilir; pencere düğmeleri pasif.
- Motor uygularken (Uygula sürerken) pencerenin Uygula düğmesi pasif.
