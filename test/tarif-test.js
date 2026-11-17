"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const binmotor = require("../src/binmotor");
const { buildStoreZip, tarifCikar } = require("../src/engine");

function prop(entries) {
  const head = Buffer.alloc(12 + entries.length * 4);
  head.write("PROP", 0, "latin1");
  head.writeUInt32LE(1, 4);
  head.writeUInt32LE(entries.length, 8);
  for (let i = 0; i < entries.length; i++) head.writeUInt32LE(entries[i].typeHash, 12 + i * 4);
  const blobs = entries.map((entry) => {
    const blob = Buffer.alloc(10);
    blob.writeUInt32LE(6, 0);
    blob.writeUInt32LE(entry.keyHash, 4);
    blob.writeUInt16LE(0, 8);
    return blob;
  });
  for (let i = 0; i < entries.length; i++) {
    const blob = Buffer.from(blobs[i]);
    blob.writeUInt16LE(entries[i].value, 8);
    blobs[i] = blob;
  }
  return Buffer.concat([head, ...blobs]);
}

const temp = fs.mkdtempSync(path.join(os.tmpdir(), "skin-tarif-"));
try {
  const gamePath = path.join(temp, "Game");
  const wadPath = path.join(gamePath, "DATA", "FINAL", "champion.wad.client");
  const internalPath = "Characters/Test/Skins/Skin01/skin.bin";
  const assetPath = "Characters/Test/Skins/Skin01/Particles/test.dds";
  const baseEntries = [
    { keyHash: 0x10000001, typeHash: 0x20000001, value: 1 },
    { keyHash: 0x10000002, typeHash: 0x20000002, value: 2 }
  ];
  const modEntries = [
    { keyHash: 0x10000001, typeHash: 0x20000001, value: 9 },
    { keyHash: 0x10000002, typeHash: 0x20000002, value: 2 },
    { keyHash: 0x10000003, typeHash: 0x20000003, value: 3 }
  ];
  const assetHash = binmotor.yolHash(assetPath);

  fs.mkdirSync(path.dirname(wadPath), { recursive: true });
  fs.writeFileSync(wadPath, binmotor.wadYaz([
    { hash: binmotor.yolHash(internalPath), data: prop(baseEntries) },
    { hash: assetHash, data: Buffer.from("asset") }
  ]));

  const modFile = path.join(temp, "test.fantome");
  fs.writeFileSync(modFile, buildStoreZip([
    { name: "META/info.json", data: Buffer.from("{}") },
    { name: `WAD/champion.wad.client/${internalPath}`, data: prop(modEntries) },
    { name: `WAD/champion.wad.client/${assetPath}`, data: Buffer.from("mod asset") }
  ]));

  tarifCikar(modFile, gamePath).then((tarif) => {
    assert.strictEqual(tarif.yama, null);
    assert.strictEqual(tarif.binler.length, 1);
    const [bin] = tarif.binler;
    assert.strictEqual(bin.oyunWad, path.join("DATA", "FINAL", "champion.wad.client"));
    assert.strictEqual(bin.hash, binmotor.yolHash(internalPath).toString(16));
    assert.deepStrictEqual(
      bin.sahip,
      [
        { keyHash: 0x10000001, typeHash: 0x20000001 },
        { keyHash: 0x10000003, typeHash: 0x20000003 }
      ]
    );
    assert.deepStrictEqual(bin.referans, []);
    assert.ok(bin.gonderilen.includes(assetHash.toString(16)));
  }).finally(() => fs.rmSync(temp, { recursive: true, force: true }));
} catch (error) {
  fs.rmSync(temp, { recursive: true, force: true });
  throw error;
}
