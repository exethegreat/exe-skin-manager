const { contextBridge, ipcRenderer, webUtils } = require("electron");

const cagir = (kanal, ...args) => ipcRenderer.invoke(kanal, ...args);

contextBridge.exposeInMainWorld("api", {
  durumAl: () => cagir("durum:al"),
  katalogAl: () => cagir("katalog:al"),
  katalogSec: (key, num, vid, on) => cagir("katalog:sec", key, num, vid, on),
  secimiTemizle: () => cagir("secim:temizle"),
  skinSec: () => cagir("skin:sec"),
  skinEkle: (dosyalar) => cagir("skin:ekle", dosyalar.map((f) => webUtils.getPathForFile(f)).filter(Boolean)),
  klasorSec: () => cagir("skin:klasorSec"),
  cikar: (id, secenek) => cagir("skin:cikar", id, secenek),
  isaretle: (id, on) => cagir("skin:isaretle", id, on),
  sil: (id) => cagir("skin:sil", id),
  senkronla: (id) => cagir("mod:senkronla", id),
  onar: (id) => cagir("mod:onar", id),
  kaldir: (id) => cagir("mod:kaldir", id),
  modIcerik: (id) => cagir("mod:icerik", id),
  modWadSec: () => cagir("mod:wadSec"),
  modWadKlasorSec: () => cagir("mod:wadKlasorSec"),
  modResimSec: () => cagir("mod:resimSec"),
  modGozat: (id) => cagir("mod:gozat", id),
  modDuzenle: (id, d) => cagir("mod:duzenle", id, d),
  oyunSec: () => cagir("oyun:sec"),
  oyunYaz: (yol) => cagir("oyun:yaz", yol),
  oyunBul: () => cagir("oyun:bul"),
  motorKlasoru: () => cagir("motor:klasor"),
  lisansOku: () => cagir("lisans:oku"),
  guncellemeDenetle: () => cagir("guncelleme:denetle"),
  guncellemeAc: (hangi) => cagir("guncelleme:ac", hangi),
  dilSec: (kod) => cagir("dil:sec", kod),
  uygula: () => cagir("motor:uygula"),
  durdur: () => cagir("motor:durdur"),
  gorunumDinle: (fn) => ipcRenderer.on("gorunum", (_e, g) => fn(g)),
  katalogYenilendiDinle: (fn) => ipcRenderer.on("katalog:yenilendi", () => fn())
});
