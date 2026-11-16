// Kelime verisini (~/Belgeler/musubi-veri) var olan bir veritabanıyla eşitler.
//
// Seed'den farkı: var olan DB'yi güvenle günceller.
//   - Yeniden adlandırmalar (kaynak/yeniden_adlandirma.json) ÖNCE uygulanır: belge _id'siyle
//     korunur, kullanıcı ilerlemesi (UserWord, havuzlar, ReviewLog) kelimeye bağlı kalır.
//   - Dosyada olup DB'de olmayan kelime eklenir.
//   - Var olan kelimede YALNIZCA değişen alanlar yazılır; dosyada olmayan alanlara
//     (ses/görsel anahtarları vb.) dokunulmaz, boş/eksik alan var olanı silmez.
//   - Eşleşme anahtarı seviye + yazılış + OKUNUŞ (16.11.2026): aynı yazılıp farklı okunan kelimeler
//     (辛い からい / つらい) ayrı kayıt olabilir. Okunuşu düzeltilmiş kelime yeni sanılmasın diye:
//     yazılış o seviyede dosyada da DB'de de TEK kayıtsa okunuş farkı güncelleme sayılır.
//   - DB'de olup dosyada olmayan kelime varsayılan olarak SİLİNMEZ, yalnızca raporlanır. --sil ile
//     silinir; ama kelimeye bağlı kullanıcı kaydı (UserWord, ReviewLog, quiz sorusu, günlük havuz)
//     varsa yine silinmez, raporlanır.
//   - Varsayılan DENEME: hiçbir şey yazılmaz, ne olacağı raporlanır. Yazmak için --yaz.
//
// Kullanım:
//   node scripts/sync-words.js --kaynak ~/Belgeler/musubi-veri [--seviye N5,N4] [--sil] [--yaz]
//   MONGO_URI=".../musubi" node scripts/sync-words.js --kaynak ...
const fs = require('fs');
const os = require('os');
const path = require('path');
const mongoose = require('mongoose');
const dotenv = require('dotenv');
const Word = require('../models/Word');
const UserWord = require('../models/UserWord');
const ReviewLog = require('../models/ReviewLog');
const QuizAttempt = require('../models/QuizAttempt');
const DailyWordPool = require('../models/DailyWordPool');
const { LEVEL_FILES, buildLevel } = require('../seeds/build-words');

dotenv.config();

const SYNC_FIELDS = ['kana', 'romaji', 'meaning', 'meaningTr', 'meaningTrAccepted', 'meaningEnAccepted', 'type',
    'example', 'exampleFurigana', 'exampleTr', 'exampleEn', 'frequencyRank', 'isCore'];

const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

// Bir kelimeye bağlı kullanıcı kaydı sayısı (silmeden önce)
async function referenceCount(id) {
    const counts = await Promise.all([
        UserWord.countDocuments({ word: id }),
        ReviewLog.countDocuments({ word: id }),
        QuizAttempt.countDocuments({ 'questions.word': id }),
        DailyWordPool.countDocuments({ newWordIds: id })
    ]);
    return counts.reduce((a, b) => a + b, 0);
}

async function syncWords(dir, { write = false, remove = false, levels = Object.keys(LEVEL_FILES) } = {}) {
    const report = { seviyeler: {}, yenidenAdlandirma: [], cakisma: [] };

    // 1) Yeniden adlandırmalar
    const renamePath = path.join(dir, 'yeniden_adlandirma.json');
    const renames = fs.existsSync(renamePath) ? JSON.parse(fs.readFileSync(renamePath, 'utf-8')) : [];
    for (const r of renames) {
        if (!levels.includes(r.seviye)) continue;
        const olds = await Word.find({ kanji: r.eski, jlptLevel: r.seviye }).select('_id').lean();
        const news = await Word.find({ kanji: r.yeni, jlptLevel: r.seviye }).select('_id').lean();
        if (olds.length && news.length) { report.cakisma.push(`${r.seviye} ${r.eski} → ${r.yeni}: ikisi de DB'de var`); continue; }
        if (olds.length > 1) { report.cakisma.push(`${r.seviye} ${r.eski}: aynı yazılışla ${olds.length} kayıt, hangisi belirsiz`); continue; }
        const oldDoc = olds[0];
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
        const byFull = new Map();   // yazılış|okunuş → belge
        const byKanji = new Map();  // yazılış → [belge]
        for (const w of db) {
            if (!byFull.has(`${w.kanji}|${w.kana}`)) byFull.set(`${w.kanji}|${w.kana}`, w);
            byKanji.set(w.kanji, [...(byKanji.get(w.kanji) || []), w]);
        }
        const fileKanjiCount = new Map();
        for (const d of docs) fileKanjiCount.set(d.kanji, (fileKanjiCount.get(d.kanji) || 0) + 1);
        const st = { dosya: docs.length, db: db.length, eklenecek: 0, guncellenecek: 0, ayni: 0, alanlar: {}, dosyadaYok: [], silinecek: [], bagliKayit: [] };
        const ops = [];
        const used = new Set(); // eşleşen DB belgelerinin _id'leri
        const free = (w) => w && !used.has(String(w._id));
        for (const d of docs) {
            // deneme modunda yeniden adlandırma henüz yapılmadı → eski adla da ara
            const renamed = pendingRename.get(`${level}|${d.kanji}`)?.slice(3);
            let cur = [d.kanji, renamed].filter(Boolean).map(k => byFull.get(`${k}|${d.kana}`)).find(free);
            if (!cur && fileKanjiCount.get(d.kanji) === 1) {
                // okunuş düzeltmesi: yazılış dosyada da DB'de de tekse aynı kelime sayılır
                const cands = [d.kanji, renamed].filter(Boolean).flatMap(k => byKanji.get(k) || []);
                if (cands.length === 1 && free(cands[0])) cur = cands[0];
            }
            if (!cur) {
                st.eklenecek++;
                const doc = Object.fromEntries(Object.entries(d).filter(([, v]) => v !== undefined));
                ops.push({ insertOne: { document: doc } });
                continue;
            }
            used.add(String(cur._id));
            const set = {};
            for (const f of SYNC_FIELDS) {
                if (d[f] === undefined) continue; // eksik alan var olanı silmez
                if (!same(d[f], cur[f])) { set[f] = d[f]; st.alanlar[f] = (st.alanlar[f] || 0) + 1; }
            }
            if (Object.keys(set).length) { st.guncellenecek++; ops.push({ updateOne: { filter: { _id: cur._id }, update: { $set: set } } }); }
            else st.ayni++;
        }
        for (const w of db) {
            if (used.has(String(w._id))) continue;
            st.dosyadaYok.push(w.kanji);
            if (!remove) continue;
            const refs = await referenceCount(w._id);
            if (refs) { st.bagliKayit.push(`${w.kanji}(${w.kana}): ${refs}`); continue; }
            st.silinecek.push(`${w.kanji}(${w.kana})`);
            ops.push({ deleteOne: { filter: { _id: w._id } } });
        }
        if (write && ops.length) await Word.bulkWrite(ops, { ordered: true });
        report.seviyeler[level] = st;
    }
    return report;
}

async function main() {
    const i = process.argv.indexOf('--kaynak');
    if (i < 0 || !process.argv[i + 1]) {
        console.error('Kullanım: node scripts/sync-words.js --kaynak <klasör> [--seviye N5,N4] [--sil] [--yaz]');
        process.exit(1);
    }
    const dir = process.argv[i + 1].replace(/^~(?=$|\/)/, os.homedir());
    const j = process.argv.indexOf('--seviye');
    const levels = j > 0 ? process.argv[j + 1].split(',') : Object.keys(LEVEL_FILES);
    const write = process.argv.includes('--yaz');
    const remove = process.argv.includes('--sil');

    await mongoose.connect(process.env.MONGO_URI);
    console.log(`DB: ${mongoose.connection.name}  ${write ? '(--yaz AÇIK)' : '(DENEME — hiçbir şey yazılmayacak)'}${remove ? '  --sil AÇIK' : ''}`);
    console.log(`Kaynak: ${dir}  Seviyeler: ${levels.join(', ')}\n`);
    const r = await syncWords(dir, { write, remove, levels });
    if (r.yenidenAdlandirma.length) console.log('Yeniden adlandırma:', r.yenidenAdlandirma.join('; '));
    if (r.cakisma.length) console.log('ÇAKIŞMA (atlandı):', r.cakisma.join('; '));
    for (const [lv, s] of Object.entries(r.seviyeler)) {
        console.log(`${lv}: dosya ${s.dosya}, DB ${s.db} → eklenecek ${s.eklenecek}, güncellenecek ${s.guncellenecek}, aynı ${s.ayni}`);
        if (Object.keys(s.alanlar).length) console.log('   değişen alanlar:', JSON.stringify(s.alanlar));
        if (s.dosyadaYok.length && !remove) console.log(`   DB'de olup dosyada OLMAYAN (silinmedi; silmek için --sil): ${s.dosyadaYok.length} → ${s.dosyadaYok.slice(0, 10).join(', ')}`);
        if (s.silinecek.length) console.log(`   silinecek: ${s.silinecek.length} → ${s.silinecek.join(', ')}`);
        if (s.bagliKayit.length) console.log(`   kullanıcı kaydı bağlı, SİLİNMEDİ: ${s.bagliKayit.join(', ')}`);
    }
    if (!write) console.log('\nYazmak için aynı komutu --yaz ile çalıştır.');
    await mongoose.disconnect();
}

if (require.main === module) {
    main().catch(err => { console.error(err); process.exit(1); });
}

module.exports = { syncWords, SYNC_FIELDS };
