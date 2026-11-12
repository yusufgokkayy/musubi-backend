// Kelime verisini (~/Belgeler/musubi-veri) var olan bir veritabanıyla eşitler.
//
// Seed'den farkı: var olan DB'yi güvenle günceller.
//   - Yeniden adlandırmalar (kaynak/yeniden_adlandirma.json) ÖNCE uygulanır: belge _id'siyle
//     korunur, kullanıcı ilerlemesi (UserWord, havuzlar, ReviewLog) kelimeye bağlı kalır.
//   - Dosyada olup DB'de olmayan kelime eklenir.
//   - Var olan kelimede YALNIZCA değişen alanlar yazılır; dosyada olmayan alanlara
//     (ses/görsel anahtarları vb.) dokunulmaz, boş/eksik alan var olanı silmez.
//   - DB'de olup dosyada olmayan kelime SİLİNMEZ, yalnızca raporlanır.
//   - Varsayılan DENEME: hiçbir şey yazılmaz, ne olacağı raporlanır. Yazmak için --yaz.
//
// Kullanım:
//   node scripts/sync-words.js --kaynak ~/Belgeler/musubi-veri [--seviye N5,N4] [--yaz]
//   MONGO_URI=".../musubi" node scripts/sync-words.js --kaynak ...
const fs = require('fs');
const os = require('os');
const path = require('path');
const mongoose = require('mongoose');
const dotenv = require('dotenv');
const Word = require('../models/Word');
const { LEVEL_FILES, buildLevel } = require('../seeds/build-words');

dotenv.config();

const SYNC_FIELDS = ['kana', 'romaji', 'meaning', 'meaningTr', 'meaningTrAccepted', 'meaningEnAccepted', 'type',
    'example', 'exampleFurigana', 'exampleTr', 'exampleEn', 'frequencyRank', 'isCore'];

const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

async function syncWords(dir, { write = false, levels = Object.keys(LEVEL_FILES) } = {}) {
    const report = { seviyeler: {}, yenidenAdlandirma: [], cakisma: [] };

    // 1) Yeniden adlandırmalar
    const renamePath = path.join(dir, 'yeniden_adlandirma.json');
    const renames = fs.existsSync(renamePath) ? JSON.parse(fs.readFileSync(renamePath, 'utf-8')) : [];
    for (const r of renames) {
        if (!levels.includes(r.seviye)) continue;
        const oldDoc = await Word.findOne({ kanji: r.eski, jlptLevel: r.seviye }).select('_id').lean();
        const newDoc = await Word.findOne({ kanji: r.yeni, jlptLevel: r.seviye }).select('_id').lean();
        if (oldDoc && newDoc) { report.cakisma.push(`${r.seviye} ${r.eski} → ${r.yeni}: ikisi de DB'de var`); continue; }
        if (!oldDoc) continue; // zaten uygulanmış ya da hiç yok
        report.yenidenAdlandirma.push(`${r.seviye} ${r.eski} → ${r.yeni}`);
        if (write) await Word.updateOne({ _id: oldDoc._id }, { $set: { kanji: r.yeni } });
    }
    const pendingRename = new Map(report.yenidenAdlandirma.map(s => {
        const [lv, rest] = [s.slice(0, 2), s.slice(3)]; const [eski, yeni] = rest.split(' → ');
        return [`${lv}|${yeni}`, `${lv}|${eski}`];
    }));

    // 2) Seviye seviye karşılaştır
    for (const level of levels) {
        const docs = buildLevel(dir, level);
        if (!docs) continue;
        const db = await Word.find({ jlptLevel: level }).select(['kanji', ...SYNC_FIELDS].join(' ')).lean();
        const byKey = new Map(db.map(w => [`${level}|${w.kanji}`, w]));
        const st = { dosya: docs.length, db: db.length, eklenecek: 0, guncellenecek: 0, ayni: 0, alanlar: {}, dosyadaYok: [] };
        const ops = [];
        const seen = new Set();
        for (const d of docs) {
            const key = `${level}|${d.kanji}`;
            // deneme modunda yeniden adlandırma henüz yapılmadı → eski adla bul
            const cur = byKey.get(key) || byKey.get(pendingRename.get(key));
            seen.add(cur ? `${level}|${cur.kanji}` : key);
            if (!cur) {
                st.eklenecek++;
                const doc = Object.fromEntries(Object.entries(d).filter(([, v]) => v !== undefined));
                ops.push({ insertOne: { document: doc } });
                continue;
            }
            const set = {};
            for (const f of SYNC_FIELDS) {
                if (d[f] === undefined) continue; // eksik alan var olanı silmez
                if (!same(d[f], cur[f])) { set[f] = d[f]; st.alanlar[f] = (st.alanlar[f] || 0) + 1; }
            }
            if (Object.keys(set).length) { st.guncellenecek++; ops.push({ updateOne: { filter: { _id: cur._id }, update: { $set: set } } }); }
            else st.ayni++;
        }
        for (const w of db) if (!seen.has(`${level}|${w.kanji}`)) st.dosyadaYok.push(w.kanji);
        if (write && ops.length) await Word.bulkWrite(ops, { ordered: true });
        report.seviyeler[level] = st;
    }
    return report;
}

async function main() {
    const i = process.argv.indexOf('--kaynak');
    if (i < 0 || !process.argv[i + 1]) {
        console.error('Kullanım: node scripts/sync-words.js --kaynak <klasör> [--seviye N5,N4] [--yaz]');
        process.exit(1);
    }
    const dir = process.argv[i + 1].replace(/^~(?=$|\/)/, os.homedir());
    const j = process.argv.indexOf('--seviye');
    const levels = j > 0 ? process.argv[j + 1].split(',') : Object.keys(LEVEL_FILES);
    const write = process.argv.includes('--yaz');

    await mongoose.connect(process.env.MONGO_URI);
    console.log(`DB: ${mongoose.connection.name}  ${write ? '(--yaz AÇIK)' : '(DENEME — hiçbir şey yazılmayacak)'}`);
    console.log(`Kaynak: ${dir}  Seviyeler: ${levels.join(', ')}\n`);
    const r = await syncWords(dir, { write, levels });
    if (r.yenidenAdlandirma.length) console.log('Yeniden adlandırma:', r.yenidenAdlandirma.join('; '));
    if (r.cakisma.length) console.log('ÇAKIŞMA (atlandı):', r.cakisma.join('; '));
    for (const [lv, s] of Object.entries(r.seviyeler)) {
        console.log(`${lv}: dosya ${s.dosya}, DB ${s.db} → eklenecek ${s.eklenecek}, güncellenecek ${s.guncellenecek}, aynı ${s.ayni}`);
        if (Object.keys(s.alanlar).length) console.log('   değişen alanlar:', JSON.stringify(s.alanlar));
        if (s.dosyadaYok.length) console.log(`   DB'de olup dosyada OLMAYAN (silinmedi): ${s.dosyadaYok.length} → ${s.dosyadaYok.slice(0, 10).join(', ')}`);
    }
    if (!write) console.log('\nYazmak için aynı komutu --yaz ile çalıştır.');
    await mongoose.disconnect();
}

if (require.main === module) {
    main().catch(err => { console.error(err); process.exit(1); });
}

module.exports = { syncWords, SYNC_FIELDS };
