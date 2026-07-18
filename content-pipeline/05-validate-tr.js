// Faz 1 doğrulama: üretilen meaningTr JSONL dosyalarını denetler.
//   - zorunlu alanlar + tür enum'u + uzunluk sınırı
//   - aynı seviye içinde birebir aynı meaningTr (quiz cevap uzayı çakışması) → HATA
//   - seviyeler arası aynı meaningTr → uyarı (bilgi amaçlı)
// Çakışma denetimi TÜM üretilmiş dosyalar üzerinden yapılır; hedef dosyada
// hata varsa çıkış kodu 1 döner (loop turu aynı dilimi yeniden yazar).
//
// Kullanım: node content-pipeline/05-validate-tr.js out/meaningtr-001.jsonl
const fs = require('fs');
const path = require('path');

const OUT_DIR = path.join(__dirname, 'out');
const TYPES = new Set(['fiil', 'sıfat', 'isim', 'zarf', 'diğer']);
const MAX_LEN = 40;

const targets = process.argv.slice(2);
if (!targets.length) {
    console.error('Kullanım: node 05-validate-tr.js <dosya...>');
    process.exit(2);
}

function loadAll() {
    const all = [];
    for (const f of fs.readdirSync(OUT_DIR)) {
        if (!/^(pilot-meaningtr|meaningtr-\d+)\.jsonl$/.test(f)) continue;
        const lines = fs.readFileSync(path.join(OUT_DIR, f), 'utf-8').split('\n');
        lines.forEach((line, i) => {
            if (!line.trim()) return;
            try { all.push({ dosya: f, satir: i + 1, ...JSON.parse(line) }); }
            catch { all.push({ dosya: f, satir: i + 1, _parseHatasi: true }); }
        });
    }
    return all;
}

const all = loadAll();
const targetNames = new Set(targets.map(t => path.basename(t)));
const errors = [];
const warnings = [];

for (const r of all) {
    if (!targetNames.has(r.dosya)) continue;
    const yer = `${r.dosya}:${r.satir}`;

    if (r._parseHatasi) { errors.push(`${yer} JSON parse edilemedi`); continue; }
    for (const alan of ['id', 'kanji', 'jlptLevel', 'type', 'meaningTr']) {
        if (!r[alan] || !String(r[alan]).trim()) errors.push(`${yer} ${r.kanji || '?'}: ${alan} eksik`);
    }
    if (r.type && !TYPES.has(r.type)) errors.push(`${yer} ${r.kanji}: geçersiz tür "${r.type}"`);
    if (r.meaningTr && r.meaningTr.length > MAX_LEN) errors.push(`${yer} ${r.kanji}: meaningTr ${r.meaningTr.length} karakter (>${MAX_LEN})`);
    if (r.meaningTr && /^to\s|\b(the|and|of)\b/i.test(r.meaningTr)) warnings.push(`${yer} ${r.kanji}: meaningTr İngilizce kokuyor: "${r.meaningTr}"`);
}

// çakışmalar: aynı meaningTr, tüm dosyalar genelinde
const byMeaning = new Map();
for (const r of all) {
    if (r._parseHatasi || !r.meaningTr) continue;
    const key = r.meaningTr.trim().toLowerCase();
    if (!byMeaning.has(key)) byMeaning.set(key, []);
    byMeaning.get(key).push(r);
}
for (const [meaning, group] of byMeaning) {
    if (group.length < 2) continue;
    const seviyeler = new Map();
    for (const r of group) {
        if (!seviyeler.has(r.jlptLevel)) seviyeler.set(r.jlptLevel, []);
        seviyeler.get(r.jlptLevel).push(r);
    }
    for (const [lvl, rs] of seviyeler) {
        if (rs.length > 1 && rs.some(r => targetNames.has(r.dosya))) {
            errors.push(`ÇAKIŞMA ${lvl} "${meaning}": ${rs.map(r => `${r.kanji}(${r.dosya}:${r.satir})`).join(', ')}`);
        }
    }
    if (seviyeler.size > 1 && group.some(r => targetNames.has(r.dosya))) {
        warnings.push(`seviyeler arası aynı anlam "${meaning}": ${group.map(r => `${r.kanji}/${r.jlptLevel}`).join(', ')}`);
    }
}

for (const w of warnings) console.log('UYARI  ' + w);
for (const e of errors) console.log('HATA   ' + e);
console.log(`\n${targets.join(', ')}: ${errors.length} hata, ${warnings.length} uyarı`);
process.exit(errors.length ? 1 : 0);
