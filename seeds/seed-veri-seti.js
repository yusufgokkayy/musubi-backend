// veri-seti/musubi_n{1..5}.json içeriğini Word koleksiyonuna aktarır.
// Ders kitabı kökenli, meaningTr/örnek cümle/eş anlamlı cevap dizileriyle
// zaten zenginleştirilmiş omurga müfredat verisi — eski content-pipeline
// hattının yerini alır (bkz. seeds/PLAN.md).
//
// Kullanım: node seeds/seed-veri-seti.js
const mongoose = require('mongoose');
const dotenv = require('dotenv');
const path = require('path');
const Word = require('../models/Word');
const { LEVEL_FILES, buildLevel } = require('./build-words');

dotenv.config();

// Var olan bir veritabanını güncellemek için seed yerine scripts/sync-words.js
// kullanın: yeniden adlandırmaları uygular, yalnızca değişen alanları yazar ve
// varsayılan olarak deneme modunda çalışır.
async function seed() {
    await mongoose.connect(process.env.MONGO_URI);
    console.log('MongoDB connected');

    for (const level of Object.keys(LEVEL_FILES)) {
        const words = buildLevel(path.join(__dirname, '../veri-seti'), level);
        if (!words) {
            console.log(`${LEVEL_FILES[level]} not found, skipping`);
            continue;
        }

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
