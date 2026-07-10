const mongoose = require('mongoose');
const dotenv = require('dotenv');
const fs = require('fs');
const path = require('path');
const csv = require('csv-parse/sync');
const wanakana = require('wanakana');
const Word = require('../models/Word');

dotenv.config({ path: './config/.env' });

const LEVEL_FILES = {
    N5: 'n5.csv',
    N4: 'n4.csv',
    N3: 'n3.csv',
    N2: 'n2.csv',
    N1: 'n1.csv'
};

function guessType(meaning = '', expression = '') {
    if (!meaning) return 'diğer';
    const m = meaning.toLowerCase().trim();

    if (/^to\s/.test(m) || /[,;]\s*to\s/.test(m)) return 'fiil';
    if (/^(very|often|always|usually|sometimes|already|still|soon|slowly|quickly|frequently|gradually|immediately|exactly|not\s(very|yet|much|at all))\b/.test(m)) return 'zarf';
    if (expression.endsWith('い') || expression.endsWith('な')) return 'sıfat';
    return 'isim';
}

async function seed() {
    await mongoose.connect(process.env.MONGO_URI);
    console.log('MongoDB connected');

    for (const [level, filename] of Object.entries(LEVEL_FILES)) {
        const filePath = path.join(__dirname, '../jlpt-word-list/src', filename);

        if (!fs.existsSync(filePath)) {
            console.log(`${filename} not found, skipping`);
            continue;
        }

        const content = fs.readFileSync(filePath, 'utf-8');
        const records = csv.parse(content, {
            columns: true,
            skip_empty_lines: true
        });

        const words = records.map(r => ({
            kanji: r.expression,
            // CSV'deki kana okunuşu latin romaji'ye çevrilir (たべる -> taberu)
            romaji: wanakana.toRomaji(r.reading || r.expression || ''),
            meaning: r.meaning,
            type: guessType(r.meaning, r.expression),
            jlptLevel: level
        })).filter(w => w.kanji && w.meaning && w.romaji);

        console.log(`${level}: ${words.length} words found`);

        const ops = words.map(w => ({
            updateOne: {
                filter: { kanji: w.kanji, jlptLevel: w.jlptLevel },
                update: {
                    // type ve romaji her seed'de tazelenir, diğer alanlar sadece ilk eklemede yazılır
                    $set: { type: w.type, romaji: w.romaji },
                    $setOnInsert: { kanji: w.kanji, meaning: w.meaning, jlptLevel: w.jlptLevel }
                },
                upsert: true
            }
        }));

        const result = await Word.bulkWrite(ops);
        console.log(`${level} inserted: ${result.upsertedCount}`);
    }

    await mongoose.disconnect();
}

seed().catch(err => {
    console.error(err);
    process.exit(1);
});