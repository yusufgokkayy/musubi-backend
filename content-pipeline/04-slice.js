// Faz 1 dilimleyici: meaningTr'si henüz üretilmemiş kelimelerden sıradaki
// dilimi çeker ve out/slice-current.json'a yazar. "Üretilmiş" bilgisi DB'den
// değil out/*.jsonl dosyalarından okunur — DB'ye import sabah ayrı adımdır.
//
// Sıralama: önce core (isCore=true), seviye N5→N1, seviye içinde frekans.
// Kullanım: node content-pipeline/04-slice.js [dilimBoyutu=250]
const mongoose = require('mongoose');
const dotenv = require('dotenv');
const fs = require('fs');
const path = require('path');
const Word = require('../models/Word');

dotenv.config();

const OUT_DIR = path.join(__dirname, 'out');
const SLICE_SIZE = parseInt(process.argv[2], 10) || 250;
const LEVEL_ORDER = { N5: 0, N4: 1, N3: 2, N2: 3, N1: 4 };

function doneIds() {
    const ids = new Set();
    for (const f of fs.readdirSync(OUT_DIR)) {
        if (!/^(pilot-meaningtr|meaningtr-\d+)\.jsonl$/.test(f)) continue;
        for (const line of fs.readFileSync(path.join(OUT_DIR, f), 'utf-8').split('\n')) {
            if (!line.trim()) continue;
            ids.add(JSON.parse(line).id);
        }
    }
    return ids;
}

function nextSliceNumber() {
    const nums = fs.readdirSync(OUT_DIR)
        .map(f => f.match(/^meaningtr-(\d+)\.jsonl$/))
        .filter(Boolean)
        .map(m => parseInt(m[1], 10));
    return (nums.length ? Math.max(...nums) : 0) + 1;
}

async function main() {
    await mongoose.connect(process.env.MONGO_URI);

    const done = doneIds();
    const words = await Word.find({}).select('kanji kana jlptLevel type meaning isCore frequencyRank').lean();

    const remaining = words
        .filter(w => !done.has(String(w._id)))
        .sort((a, b) =>
            (b.isCore - a.isCore)
            || (LEVEL_ORDER[a.jlptLevel] - LEVEL_ORDER[b.jlptLevel])
            || ((a.frequencyRank ?? 1e9) - (b.frequencyRank ?? 1e9)));

    const slice = remaining.slice(0, SLICE_SIZE).map(w => ({
        id: String(w._id),
        kanji: w.kanji, kana: w.kana, jlptLevel: w.jlptLevel,
        type: w.type, meaningEn: w.meaning
    }));

    const sliceNo = String(nextSliceNumber()).padStart(3, '0');
    const out = {
        sliceNo,
        hedefDosya: `out/meaningtr-${sliceNo}.jsonl`,
        toplamKelime: words.length,
        uretilen: done.size,
        kalan: remaining.length,
        dilim: slice
    };
    fs.writeFileSync(path.join(OUT_DIR, 'slice-current.json'), JSON.stringify(out, null, 1));
    console.log(`dilim ${sliceNo}: ${slice.length} kelime | üretilen ${done.size} | kalan ${remaining.length} | → out/slice-current.json`);

    await mongoose.disconnect();
}

main().catch(err => { console.error(err); process.exit(1); });
