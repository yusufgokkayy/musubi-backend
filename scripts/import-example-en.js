// Örnek cümlelerin İngilizce çevirisini (exampleEn) mevcut Word kayıtlarına yazar.
//
// YALNIZCA exampleEn alanına dokunur. `npm run seed` tüm alanları dosyadan yeniden
// yazdığı için bu iş için fazla geniş; burada başka hiçbir alan değişmez, yeni kayıt
// da oluşturulmaz (upsert yok). Eşleşme seed'le aynı anahtardan: { kanji, jlptLevel }.
//
// Kullanım:
//   node scripts/import-example-en.js --kaynak ~/Belgeler/musubi-veri          # DENEME: yalnız rapor
//   node scripts/import-example-en.js --kaynak ~/Belgeler/musubi-veri --yaz    # gerçekten yazar
//   MONGO_URI=".../musubi" node scripts/import-example-en.js --kaynak ...     # başka DB
//
// Kaynak klasörde musubi_n{1..5}.json beklenir; exampleEn'i olmayan kayıtlar atlanır
// (henüz çevrilmemiş seviye). Var olan bir exampleEn boş değerle EZİLMEZ.
const fs = require('fs');
const os = require('os');
const path = require('path');
const mongoose = require('mongoose');
const dotenv = require('dotenv');
const Word = require('../models/Word');

dotenv.config();

const LEVEL_FILES = { N5: 'musubi_n5.json', N4: 'musubi_n4.json', N3: 'musubi_n3.json', N2: 'musubi_n2.json', N1: 'musubi_n1.json' };

// Dosyadaki kayıtları { kanji, jlptLevel, exampleEn } listesine çevirir.
// Saf fonksiyon: test edilebilsin diye DB'den ayrı.
function readEntries(dir) {
    const entries = [];
    for (const [level, file] of Object.entries(LEVEL_FILES)) {
        const p = path.join(dir, file);
        if (!fs.existsSync(p)) continue;
        for (const e of JSON.parse(fs.readFileSync(p, 'utf-8'))) {
            const en = typeof e.exampleEn === 'string' ? e.exampleEn.trim() : '';
            if (e.word && en) entries.push({ kanji: e.word, jlptLevel: level, exampleEn: en });
        }
    }
    return entries;
}

// write=false iken hiçbir şey yazmaz, yalnızca ne olacağını sayar.
async function importExampleEn(entries, { write = false } = {}) {
    const stats = { toplam: entries.length, eslesmeyen: [], ayni: 0, yazilacak: 0, yazilan: 0 };
    const ops = [];
    // Tek sorgu: kayıt başına findOne Atlas'ta binlerce gidiş-dönüş demek.
    const levels = [...new Set(entries.map(e => e.jlptLevel))];
    const byKey = new Map();
    for (const w of await Word.find({ jlptLevel: { $in: levels } }).select('kanji jlptLevel exampleEn').lean()) {
        byKey.set(`${w.jlptLevel}|${w.kanji}`, w);
    }
    for (const e of entries) {
        const w = byKey.get(`${e.jlptLevel}|${e.kanji}`);
        if (!w) { stats.eslesmeyen.push(`${e.jlptLevel} ${e.kanji}`); continue; }
        if (w.exampleEn === e.exampleEn) { stats.ayni++; continue; }
        stats.yazilacak++;
        ops.push({ updateOne: { filter: { _id: w._id }, update: { $set: { exampleEn: e.exampleEn } } } });
    }
    if (write && ops.length) {
        // timestamps:false — yalnız içerik eklendi, kaydın updatedAt'i oynamasın.
        const r = await Word.bulkWrite(ops, { timestamps: false });
        stats.yazilan = r.modifiedCount;
    }
    return stats;
}

async function main() {
    const i = process.argv.indexOf('--kaynak');
    if (i < 0 || !process.argv[i + 1]) {
        console.error('Kullanım: node scripts/import-example-en.js --kaynak <klasör> [--yaz]');
        process.exit(1);
    }
    const dir = process.argv[i + 1].replace(/^~(?=$|\/)/, os.homedir());
    const write = process.argv.includes('--yaz');

    const entries = readEntries(dir);
    await mongoose.connect(process.env.MONGO_URI);
    console.log(`DB: ${mongoose.connection.name}  ${write ? '(--yaz AÇIK)' : '(DENEME — hiçbir şey yazılmayacak)'}`);
    console.log(`Kaynak: ${dir} — exampleEn'i olan kayıt: ${entries.length}`);
    const perLevel = entries.reduce((a, e) => ((a[e.jlptLevel] = (a[e.jlptLevel] || 0) + 1), a), {});
    console.log('  seviye başına:', perLevel);

    const s = await importExampleEn(entries, { write });
    console.log(`\nEşleşmeyen (DB'de yok): ${s.eslesmeyen.length}${s.eslesmeyen.length ? ' → ' + s.eslesmeyen.slice(0, 10).join(', ') : ''}`);
    console.log(`Zaten aynı: ${s.ayni}`);
    console.log(`Yazılacak: ${s.yazilacak}`);
    if (write) console.log(`Yazılan: ${s.yazilan}`);
    else if (s.yazilacak) console.log('\nYazmak için aynı komutu --yaz ile çalıştır.');
    await mongoose.disconnect();
}

if (require.main === module) {
    main().catch(err => { console.error(err); process.exit(1); });
}

module.exports = { readEntries, importExampleEn };
