// icon.jfif -> src/ui/icon.ico (16-256 px, PNG'li ICO) + src/ui/icon.png. Kullanım: node build/ico-yap.js [kaynak]
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const kok = path.join(__dirname, "..");
const kaynak = path.resolve(process.argv[2] || path.join(kok, "icon.jfif"));
const gecici = path.join(__dirname, "_tmp");
const boyutlar = [16, 24, 32, 48, 64, 128, 256];
fs.mkdirSync(gecici, { recursive: true });

const pngler = boyutlar.map((s) => {
  const dosya = path.join(gecici, `i${s}.png`);
  execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-i", kaynak, "-vf", `scale=${s}:${s}:flags=lanczos,format=rgba`, "-frames:v", "1", dosya]);
  return { s, veri: fs.readFileSync(dosya) };
});

const baslik = Buffer.alloc(6);
baslik.writeUInt16LE(1, 2); // tür: simge
baslik.writeUInt16LE(pngler.length, 4);
const dizin = Buffer.alloc(16 * pngler.length);
let ofset = 6 + dizin.length;
pngler.forEach((p, i) => {
  const o = i * 16;
  dizin.writeUInt8(p.s === 256 ? 0 : p.s, o); // 0 = 256
  dizin.writeUInt8(p.s === 256 ? 0 : p.s, o + 1);
  dizin.writeUInt16LE(1, o + 4); // düzlem
  dizin.writeUInt16LE(32, o + 6); // bit/piksel
  dizin.writeUInt32LE(p.veri.length, o + 8);
  dizin.writeUInt32LE(ofset, o + 12);
  ofset += p.veri.length;
});
fs.writeFileSync(path.join(kok, "src", "ui", "icon.ico"), Buffer.concat([baslik, dizin, ...pngler.map((p) => p.veri)]));
fs.copyFileSync(path.join(gecici, "i256.png"), path.join(kok, "src", "ui", "icon.png"));
fs.rmSync(gecici, { recursive: true, force: true });
console.log("icon.ico yazıldı:", boyutlar.join(", "), "px");
