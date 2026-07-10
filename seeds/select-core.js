// Çekirdek kelime seçimi: her JLPT seviyesi için en yüksek frekanslı kelimeleri
// isCore=true olarak işaretler. Aktif oyun havuzu (günlük kelimeler, quiz,
// tamamlanma oranı) yalnızca core kelimeleri kullanır.
//
// Frekans kaynağı: hingston/japanese (Wikipedia korpusu, MeCab lemma, ~44k kelime)
// https://github.com/hingston/japanese — ilk çalıştırmada indirilir, sonra cache'lenir.
const mongoose = require('mongoose');
const dotenv = require('dotenv');
const fs = require('fs');
const path = require('path');
const https = require('https');
const Word = require('../models/Word');

dotenv.config({ path: './config/.env' });

// Seviye başına çekirdek kelime hedefi (toplam 3000)
const CORE_TARGETS = { N5: 300, N4: 400, N3: 550, N2: 750, N1: 1000 };

const FREQ_URL = 'https://raw.githubusercontent.com/hingston/japanese/master/44492-japanese-words-latin-lines-removed.txt';
const FREQ_FILE = path.join(__dirname, 'data', 'ja-freq-44k.txt');

function download(url, dest) {
    return new Promise((resolve, reject) => {
        https.get(url, res => {
            if (res.statusCode !== 200) return reject(new Error('İndirme başarısız: HTTP ' + res.statusCode));
            const file = fs.createWriteStream(dest);
            res.pipe(file);
            file.on('finish', () => file.close(resolve));
        }).on('error', reject);
    });
}

async function loadFrequencyRanks() {
    if (!fs.existsSync(FREQ_FILE)) {
        fs.mkdirSync(path.dirname(FREQ_FILE), { recursive: true });
        console.log('Frekans listesi indiriliyor...');
        await download(FREQ_URL, FREQ_FILE);
    }

    const ranks = new Map();
    fs.readFileSync(FREQ_FILE, 'utf-8').split('\n').forEach((line, i) => {
        const w = line.trim();
        if (w && !ranks.has(w)) ranks.set(w, i + 1);
    });
    console.log('Frekans listesi yüklendi:', ranks.size, 'kelime');
    return ranks;
}

async function selectCore() {
    await mongoose.connect(process.env.MONGO_URI);
    console.log('MongoDB connected');

    const ranks = await loadFrequencyRanks();
    const UNMATCHED_RANK = 999999;

    for (const [level, target] of Object.entries(CORE_TARGETS)) {
        const words = await Word.find({ jlptLevel: level }).select('kanji romaji');

        const ranked = words.map(w => ({
            id: w._id,
            // kanji formu, yoksa kana (romaji alanı) formu ile eşleştir
            rank: ranks.get(w.kanji) ?? ranks.get(w.romaji) ?? UNMATCHED_RANK
        })).sort((a, b) => a.rank - b.rank);

        const core = ranked.slice(0, target);
        const rest = ranked.slice(target);
        const matched = core.filter(w => w.rank !== UNMATCHED_RANK).length;

        await Word.bulkWrite([
            ...core.map(w => ({
                updateOne: {
                    filter: { _id: w.id },
                    update: { $set: { isCore: true, frequencyRank: w.rank === UNMATCHED_RANK ? null : w.rank } }
                }
            })),
            ...rest.map(w => ({
                updateOne: {
                    filter: { _id: w.id },
                    update: { $set: { isCore: false, frequencyRank: w.rank === UNMATCHED_RANK ? null : w.rank } }
                }
            }))
        ]);

        console.log(`${level}: ${core.length}/${words.length} core seçildi (${matched} frekans eşleşmeli)`);
    }

    const totalCore = await Word.countDocuments({ isCore: true });
    console.log('Toplam core kelime:', totalCore);

    await mongoose.disconnect();
}

selectCore().catch(err => {
    console.error(err);
    process.exit(1);
});
