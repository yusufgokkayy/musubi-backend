// Veri dosyalarını (musubi_n{N}.json + musubi_n{N}_furigana.json) Word belgelerine çevirir.
// seeds/seed-veri-seti.js ve scripts/sync-words.js aynı dönüşümü kullansın diye ayrı dosya:
// iki yerde tutulan eşleme er ya da geç ayrışır.
const fs = require('fs');
const path = require('path');
const wanakana = require('wanakana');
const { mergeFurigana } = require('./furigana-merge');

const LEVEL_FILES = {
    N5: 'musubi_n5.json',
    N4: 'musubi_n4.json',
    N3: 'musubi_n3.json',
    N2: 'musubi_n2.json',
    N1: 'musubi_n1.json'
};

const furiganaFile = (filename) => filename.replace('.json', '_furigana.json');
const readJson = (filePath) => JSON.parse(fs.readFileSync(filePath, 'utf-8'));

// Bir seviyenin belgelerini döndürür; dosya yoksa null.
function buildLevel(dir, level) {
    const filename = LEVEL_FILES[level];
    const filePath = path.join(dir, filename);
    if (!fs.existsSync(filePath)) return null;
    const entries = readJson(filePath);

    // Furiganalı dosya aynı sırada ve aynı cümleleri taşır; yine de kelime bazında
    // eşleştiriyoruz ki sıra bozulursa sessizce yanlış cümleye okunuş yazmayalım.
    const furiganaPath = path.join(dir, furiganaFile(filename));
    const furiganaByKey = new Map();
    if (fs.existsSync(furiganaPath)) {
        readJson(furiganaPath).forEach(e => furiganaByKey.set(`${e.order}|${e.word}`, e.exampleJp));
    }

    return entries.map(e => ({
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
        // Henüz çevrilmemiş seviyede alan yok → undefined, $set'ten düşer.
        exampleEn: e.exampleEn,
        // Müfredat sırası: seviye içi 'order' (küçük = önce öğretilir)
        frequencyRank: e.order,
        isCore: true
    })).filter(w => w.kanji && w.meaning && w.romaji && w.type);
}

module.exports = { LEVEL_FILES, buildLevel };
