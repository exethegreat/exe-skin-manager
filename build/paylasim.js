// setup/ içindeki Setup.exe + BENIOKU.txt'yi paylasim/ klasöründe toplar (BENIOKU.txt Not Defteri için UTF-8 BOM'lu yazılır).
const fs = require("node:fs");
const path = require("node:path");
const kok = path.join(__dirname, "..");
const surum = require(path.join(kok, "package.json")).version;
const setup = path.join(kok, "setup", `EXE-Skin-Manager-Setup-${surum}.exe`);
if (!fs.existsSync(setup)) throw new Error("Önce npm run setup çalıştır: " + setup);
const hedef = path.join(kok, "paylasim");
fs.mkdirSync(hedef, { recursive: true });
for (const f of fs.readdirSync(hedef)) fs.rmSync(path.join(hedef, f), { force: true });
fs.copyFileSync(setup, path.join(hedef, path.basename(setup)));
const metin = fs.readFileSync(path.join(kok, "BENIOKU.txt"), "utf8").replace(/^﻿/, "").replace(/\r?\n/g, "\r\n");
fs.writeFileSync(path.join(hedef, "BENIOKU.txt"), "﻿" + metin, "utf8");
const lisans = fs.readFileSync(path.join(kok, "LISANS.txt"), "utf8").replace(/^﻿/, "").replace(/\r?\n/g, "\r\n");
fs.writeFileSync(path.join(hedef, "LISANS.txt"), "﻿" + lisans, "utf8");
console.log("paylasim/ hazır:", fs.readdirSync(hedef).join(", "));
