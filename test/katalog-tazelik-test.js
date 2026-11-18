"use strict";

// Katalog tazelik kuralı (node test/katalog-tazelik-test.js): liste ne zaman yeniden çekilir?
// Normalde 6 saatte bir; skin deposu Riot'un son yamasından geride kaldıysa (yeni yama günü) saatte bir; eksikse hemen.
const assert = require("node:assert/strict");
const { yenilemeGerekli, depoGeride } = require("../src/catalog");

const SAAT = 60 * 60 * 1000;
const simdi = Date.UTC(2026, 10, 19, 12);
const d = (yasSaat, patch, ddSurum, eksik = false) => ({ zaman: simdi - yasSaat * SAAT, patch, ddSurum, eksik });

assert.strictEqual(depoGeride(d(0, "16.22", "16.23.1")), true, "depo 16.22, Riot 16.23 → geride");
assert.strictEqual(depoGeride(d(0, "16.23", "16.23.1")), false);
assert.strictEqual(depoGeride(d(0, "16.24", "16.23.1")), false, "depo PBE ile önde olabilir");
assert.strictEqual(depoGeride(d(0, "", "16.23.1")), false, "bilinmeyen yama: geride sayılmaz");
assert.strictEqual(depoGeride(d(0, "16.9", "16.10.1")), true, "sayısal karşılaştırma (9 < 10)");

assert.strictEqual(yenilemeGerekli(d(2, "16.23", "16.23.1"), simdi), false, "güncel depo: 2 saatlik liste taze");
assert.strictEqual(yenilemeGerekli(d(7, "16.23", "16.23.1"), simdi), true, "güncel depo: 6 saati geçti");
assert.strictEqual(yenilemeGerekli(d(0.5, "16.22", "16.23.1"), simdi), false, "geride depo: yarım saatlik liste taze");
assert.strictEqual(yenilemeGerekli(d(1.5, "16.22", "16.23.1"), simdi), true, "geride depo: saatte bir yenilenir");
assert.strictEqual(yenilemeGerekli(d(0, "16.23", "16.23.1", true), simdi), true, "eksik veri: hemen");
console.log("katalog-tazelik-test: TÜM testler GEÇTİ");
