// Çevrilebilir hata: mesaj metni değil çeviri anahtarı ve değişkenleri taşır (src/ui/diller.js).
class Hata extends Error {
  constructor(k, v) {
    super(k);
    this.k = k;
    this.v = v || {};
  }

  // Herhangi bir hatayı çevrilebilir tanıma çevirir: Hata ise {k, v}, değilse ham mesaj metni.
  static tanim(err) {
    if (err instanceof Hata) return { k: err.k, v: err.v };
    return err && err.message ? String(err.message) : String(err);
  }
}

module.exports = { Hata };
