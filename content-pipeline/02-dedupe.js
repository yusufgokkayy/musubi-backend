// Faz 0 tekilleştirme: aynı kanji+kana çiftine sahip kayıtlardan yalnız en
// düşük JLPT seviyesindeki kalır (kelime kullanıcıya bir kez, en erken
// seviyede öğretilir). Silinen kayıtların referansları taşınır/temizlenir:
//   - UserWord.word → kalan kayda taşınır (kullanıcıda ikisi de varsa
//     silinenin UserWord'ü düşürülür; user+word unique)
//   - DailyWordPool.newWordIds → silinen id kalanla değiştirilir
//   - DailyWordPool.reviewWordIds → düşürülen UserWord id'leri çekilir
//
// Kullanım: node content-pipeline/02-dedupe.js          (dry-run)
//           node content-pipeline/02-dedupe.js --apply
const mongoose = require('mongoose');
const dotenv = require('dotenv');
const fs = require('fs');
const path = require('path');
const csv = require('csv-parse/sync');
const Word = require('../models/Word');
const UserWord = require('../models/UserWord');
const DailyWordPool = require('../models/DailyWordPool');

dotenv.config();

const APPLY = process.argv.includes('--apply');
const LEVEL_ORDER = { N5: 0, N4: 1, N3: 2, N2: 3, N1: 4 };
const SRC_DIR = path.join(__dirname, '../jlpt-word-list/src');
const LEVEL_FILES = { N5: 'n5.csv', N4: 'n4.csv', N3: 'n3.csv', N2: 'n2.csv', N1: 'n1.csv' };

// Silinen kaydın CSV satırı da düşürülür; yoksa bir sonraki seed aynı
// kelimeyi aynı seviyeye yeniden ekler.
function removeCsvRow(level, expression) {
    const filePath = path.join(SRC_DIR, LEVEL_FILES[level]);
    if (!fs.existsSync(filePath)) return false;

    const records = csv.parse(fs.readFileSync(filePath, 'utf-8'), {
        columns: true, skip_empty_lines: true
    });
    const kept = records.filter(r => r.expression !== expression);
    if (kept.length === records.length) return false;

    if (APPLY) {
        const field = v => /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
        const lines = kept.map(r => [r.expression, r.reading, r.meaning, r.tags].map(field).join(','));
        fs.writeFileSync(filePath, 'expression,reading,meaning,tags\n' + lines.join('\n') + '\n');
    }
    return true;
}

async function main() {
    console.log(APPLY ? '== UYGULAMA MODU ==' : '== DRY-RUN (yazmak için --apply) ==');
    await mongoose.connect(process.env.MONGO_URI);

    const groups = await Word.aggregate([
        { $group: { _id: { kanji: '$kanji', kana: '$kana' }, n: { $sum: 1 }, docs: { $push: { id: '$_id', jlptLevel: '$jlptLevel', isCore: '$isCore' } } } },
        { $match: { n: { $gt: 1 } } }
    ]);

    console.log(`Mükerrer grup: ${groups.length}`);

    for (const g of groups) {
        const sorted = [...g.docs].sort((a, b) => LEVEL_ORDER[a.jlptLevel] - LEVEL_ORDER[b.jlptLevel]);
        const keep = sorted[0];
        const drop = sorted.slice(1);
        console.log(`\n${g._id.kanji} / ${g._id.kana}: ${keep.jlptLevel} kalır, ${drop.map(d => d.jlptLevel).join('+')} silinir`);

        for (const d of drop) {
            const userWords = await UserWord.find({ word: d.id }).lean();
            const pools = await DailyWordPool.find({ newWordIds: d.id }).select('_id').lean();
            const csvRow = removeCsvRow(d.jlptLevel, g._id.kanji);
            console.log(`  ${d.jlptLevel} (${d.id}): UserWord=${userWords.length}, havuz=${pools.length}, csv=${csvRow ? 'silinecek' : 'yok'}${d.isCore ? ', core idi' : ''}`);

            if (!APPLY) continue;

            for (const uw of userWords) {
                const existing = await UserWord.findOne({ user: uw.user, word: keep.id });
                if (existing) {
                    // kullanıcı kelimeyi kalan kayıtla da öğreniyor: silinenin
                    // ilerlemesi düşürülür, havuz referansları temizlenir
                    await DailyWordPool.updateMany(
                        { reviewWordIds: uw._id },
                        { $pull: { reviewWordIds: uw._id } }
                    );
                    await UserWord.deleteOne({ _id: uw._id });
                } else {
                    await UserWord.updateOne({ _id: uw._id }, { $set: { word: keep.id } });
                }
            }

            await DailyWordPool.updateMany(
                { newWordIds: d.id },
                { $set: { 'newWordIds.$[el]': keep.id } },
                { arrayFilters: [{ el: d.id }] }
            );

            await Word.deleteOne({ _id: d.id });
        }
    }

    if (APPLY && groups.length) {
        console.log('\nNot: core sayıları değişmiş olabilir — seeds/select-core.js yeniden koşulmalı.');
    }

    await mongoose.disconnect();
}

main().catch(err => { console.error(err); process.exit(1); });
