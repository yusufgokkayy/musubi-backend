// Musubi kelime listesini kotoba-analyzer'ın VocabularyEntry formatına ihraç
// eder. Tek yönlü: hakikat kaynağı bu repo'nun DB'sidir; kotoba tarafındaki
// dosya her koşuda baştan yazılır, elle düzenlenmez.
//
// Analyzer'ın JsonVocabularyRepository'si lemma üzerinde teklik zorlar; aynı
// kanji farklı okunuşlarla birden çok seviyede bulunabildiğinden (開く:
// あく/ひらく) lemma çakışmasında düşük seviyeli kayıt kazanır, diğerinin
// kana'sı surface_forms'a eklenir.
//
// Kullanım: node content-pipeline/03-export-vocab.js [çıktı-yolu]
//   varsayılan çıktı: ../kotoba-analyzer/data/musubi_vocabulary.json
const mongoose = require('mongoose');
const dotenv = require('dotenv');
const fs = require('fs');
const path = require('path');
const Word = require('../models/Word');

dotenv.config();

const OUT_PATH = process.argv[2]
    || path.join(__dirname, '../../kotoba-analyzer/data/musubi_vocabulary.json');

const TYPE_MAP = { fiil: 'verb', 'sıfat': 'adjective', isim: 'noun', zarf: 'adverb', 'diğer': 'other' };
const LEVEL_ORDER = { N5: 0, N4: 1, N3: 2, N2: 3, N1: 4 };

async function main() {
    await mongoose.connect(process.env.MONGO_URI);
    const words = await Word.find({}).lean();

    // lemma = kanji yazımı; ～ önekleri analyzer tokenizasyonunda görünmez, temizlenir
    const byLemma = new Map();
    for (const w of words) {
        const lemma = w.kanji.replace(/～/g, '');
        if (!lemma) continue;

        const entry = {
            id: String(w._id),
            lemma,
            surface_forms: w.kana && w.kana !== lemma ? [w.kana.replace(/～/g, '')] : [],
            reading: w.kana || null,
            jlpt_level: w.jlptLevel,
            meaning: w.meaning || null,
            word_type: TYPE_MAP[w.type] || 'other',
            frequency_rank: w.frequencyRank || null,
            source: 'musubi',
        };

        const existing = byLemma.get(lemma);
        if (!existing) {
            byLemma.set(lemma, entry);
        } else if (LEVEL_ORDER[entry.jlpt_level] < LEVEL_ORDER[existing.jlpt_level]) {
            entry.surface_forms = [...new Set([...entry.surface_forms, ...existing.surface_forms])];
            byLemma.set(lemma, entry);
        } else {
            existing.surface_forms = [...new Set([...existing.surface_forms, ...entry.surface_forms])];
        }
    }

    const entries = [...byLemma.values()];
    fs.writeFileSync(OUT_PATH, JSON.stringify(entries, null, 1));
    console.log(`${words.length} kelime → ${entries.length} lemma → ${OUT_PATH}`);

    await mongoose.disconnect();
}

main().catch(err => { console.error(err); process.exit(1); });
