// veri-seti/musubi_n{1..5}.json içeriğini Word koleksiyonuna aktarır.
// Ders kitabı kökenli, meaningTr/örnek cümle/eş anlamlı cevap dizileriyle
// zaten zenginleştirilmiş omurga müfredat verisi — eski content-pipeline
// hattının yerini alır (bkz. seeds/PLAN.md).
//
// Kullanım: node seeds/seed-veri-seti.js
const mongoose = require('mongoose');
const dotenv = require('dotenv');
const fs = require('fs');
const path = require('path');
const wanakana = require('wanakana');
const Word = require('../models/Word');
const { mergeFurigana } = require('./furigana-merge');

dotenv.config();

const LEVEL_FILES = {
    N5: 'musubi_n5.json',
    N4: 'musubi_n4.json',
    N3: 'musubi_n3.json',
    N2: 'musubi_n2.json',
    N1: 'musubi_n1.json'
};

// Örnek cümlenin okunuşları ayrı dosyada duruyor; hedef kelime vurgusu ise
// yalnızca furigansız dosyada var. İkisi seed sırasında birleştirilir —
// bkz. seeds/furigana-merge.js
const furiganaFile = (filename) => filename.replace('.json', '_furigana.json');

const readJson = (filePath) => JSON.parse(fs.readFileSync(filePath, 'utf-8'));

async function seed() {
    await mongoose.connect(process.env.MONGO_URI);
    console.log('MongoDB connected');

    for (const [level, filename] of Object.entries(LEVEL_FILES)) {
        const filePath = path.join(__dirname, '../veri-seti', filename);

        if (!fs.existsSync(filePath)) {
            console.log(`${filename} not found, skipping`);
            continue;
        }

        const entries = readJson(filePath);

        // Furiganalı dosya iki sette de aynı sırada ve aynı cümleleri taşır;
        // yine de kelime bazında eşleştiriyoruz ki sıra bozulursa sessizce
        // yanlış cümleye okunuş yazmayalım.
        const furiganaPath = path.join(__dirname, '../veri-seti', furiganaFile(filename));
        const furiganaByKey = new Map();
        if (fs.existsSync(furiganaPath)) {
            readJson(furiganaPath).forEach(e => furiganaByKey.set(`${e.order}|${e.word}`, e.exampleJp));
        } else {
            console.log(`${furiganaFile(filename)} bulunamadı, furigana atlanıyor`);
        }

        const words = entries.map(e => ({
            kanji: e.word,
            kana: e.kana,
            romaji: wanakana.toRomaji(e.kana || e.word),
            meaning: e.meaningEn,
            meaningTr: e.meaningTr,
            meaningTrAccepted: e.meaningTrAccepted && e.meaningTrAccepted.length ? e.meaningTrAccepted : undefined,
            meaningEnAccepted: e.meaningEnAccepted && e.meaningEnAccepted.length ? e.meaningEnAccepted : undefined,
            type: e.type,
            jlptLevel: level,
            example: e.exampleJp,
            exampleFurigana: mergeFurigana(e.exampleJp, furiganaByKey.get(`${e.order}|${e.word}`)),
            exampleTr: e.exampleTr,
            // Müfredat sırası: seviye içi 'order' (küçük = önce öğretilir)
            frequencyRank: e.order,
            isCore: true
        })).filter(w => w.kanji && w.meaning && w.romaji && w.type);

        console.log(`${level}: ${words.length} kelime bulundu`);

        const ops = words.map(w => ({
            updateOne: {
                filter: { kanji: w.kanji, jlptLevel: w.jlptLevel },
                update: { $set: w },
                upsert: true
            }
        }));

        const result = await Word.bulkWrite(ops);
        console.log(`${level} eklendi: ${result.upsertedCount}, güncellendi: ${result.modifiedCount}`);
    }

    await mongoose.disconnect();
}

seed().catch(err => {
    console.error(err);
    process.exit(1);
});
