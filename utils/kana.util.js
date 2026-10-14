// Okunuş sorusunun yanlış şıkları: doğru okunuşun KÜÇÜK bozulmaları.
//
// JLPT'nin 漢字読み sorusu böyle kurulur (病院 → びょういん / びょうい /
// ひょういん / ぴょういん). Şıklar başka kelimelerin okunuşu olsaydı soru hiçbir
// şey ölçmezdi: uzunluğu ya da ilk sesi tutmayan şık bakmadan elenir, kelimeyi
// hiç bilmeyen biri de doğruyu bulur. Öğrencinin gerçekte karıştırdığı şeyler
// sesli/sessiz ayrımı (か/が), uzun-kısa ünlü (こう/こ), küçük っ ve küçük
// ゃゅょ'dur — bozulmalar tam olarak bunlardır.

// Sesli/sessiz/yarı sesli üçlüleri (hiragana). Katakana karşılıkları aşağıda
// kod noktası kaydırılarak türetilir.
const VOICING_GROUPS = [
    'かが', 'きぎ', 'くぐ', 'けげ', 'こご',
    'さざ', 'しじ', 'すず', 'せぜ', 'そぞ',
    'ただ', 'てで', 'とど',
    'はばぱ', 'ひびぴ', 'ふぶぷ', 'へべぺ', 'ほぼぽ'
];

const KATAKANA_OFFSET = 0x60;
const toKatakana = (s) => [...s].map(c => String.fromCodePoint(c.codePointAt(0) + KATAKANA_OFFSET)).join('');
const bothScripts = (s) => s + toKatakana(s);

const VOICING = new Map();
for (const group of [...VOICING_GROUPS, ...VOICING_GROUPS.map(toKatakana)]) {
    for (const ch of group) VOICING.set(ch, [...group].filter(c => c !== ch));
}

const O_ROW = bothScripts('おこそとのほもよろごぞどぼぽょ');
const U_ROW = bothScripts('うくすつぬふむゆるぐずづぶぷゅ');
const E_ROW = bothScripts('えけせてねへめれげぜでべぺ');
// Önüne küçük っ gelebilen satırlar (か・さ・た・ぱ)
const GEMINABLE = bothScripts('かきくけこさしすせそたちつてとぱぴぷぺぽ');
// や/ゆ/よ'nun küçülüp birleşebildiği (きゃ, しゅ, ちょ…) i-sırası heceler
const I_ROW_CONSONANT = bothScripts('きしちにひみりぎじびぴ');

const SMALL_TO_LARGE = new Map([...'ゃやゅゆょよ'.match(/../g), ...toKatakana('ゃやゅゆょよ').match(/../g)]
    .map(pair => [pair[0], pair[1]]));
const LARGE_TO_SMALL = new Map([...SMALL_TO_LARGE].map(([small, large]) => [large, small]));

const isKatakana = (ch) => ch >= 'ァ' && ch <= 'ヿ';
const inScript = (hiragana, like) => (isKatakana(like) ? toKatakana(hiragana) : hiragana);

const VOWELS = bothScripts('あいうえお') + 'ー';

// Aynı ünsüz satırının heceleri (な → に ぬ ね の). ぢ/づ bilerek yok: günlük
// yazımda neredeyse hiç geçmezler, şıkta görünce "bu yanlış" diye elenirler.
const SAME_ROW = new Map();
for (const row of ['あいうえお', 'かきくけこ', 'がぎぐげご', 'さしすせそ', 'ざじずぜぞ', 'たちつてと',
    'だでど', 'なにぬねの', 'はひふへほ', 'ばびぶべぼ', 'ぱぴぷぺぽ', 'まみむめも', 'やゆよ', 'らりるれろ']) {
    for (const r of [row, toKatakana(row)]) {
        for (const ch of r) SAME_ROW.set(ch, [...r].filter(c => c !== ch));
    }
}
const SMALL_YOON = bothScripts('ゃゅょ');

/**
 * Bir okunuşun tek adımlık bozulmaları, türüne göre gruplanmış. Sıra aynı
 * zamanda İNANDIRICILIK sırasıdır: `lengthen` sonlara kalır, çünkü ünlü uzatma
 * kelimenin ortasında yapay duran şıklar da üretir (たべる → たべいる).
 *
 * `vowel` (aynı satırda ünlü değişimi: おんな → おんの, えんな) en sondadır ve
 * yalnızca diğerleri yetmeyince kullanılır. Kısa okunuşların (女, 目, 火) başka
 * bozulması yoktur; o zaman şıklar başka kelimelerin okunuşlarından geliyordu
 * (おんな / こうばん / もんだい) ve bakmadan eleniyordu.
 * @returns {{voicing: string[], shorten: string[], sokuon: string[], yoon: string[], lengthen: string[], vowel: string[]}}
 */
const readingMutations = (kana) => {
    const chars = [...String(kana || '')];
    const out = {
        voicing: new Set(), shorten: new Set(), sokuon: new Set(), yoon: new Set(), lengthen: new Set(),
        vowel: new Set()
    };
    const splice = (i, remove, ...insert) => {
        const copy = [...chars];
        copy.splice(i, remove, ...insert);
        return copy.join('');
    };

    chars.forEach((ch, i) => {
        const prev = chars[i - 1];
        const next = chars[i + 1];

        // か → が, は → ば / ぱ
        for (const alt of VOICING.get(ch) || []) out.voicing.add(splice(i, 1, alt));

        // Uzun ünlüyü kısalt: こう → こ, せい → せ, コー → コ
        if (prev && (
            ((ch === 'う' || ch === 'ウ') && (O_ROW.includes(prev) || U_ROW.includes(prev))) ||
            ((ch === 'い' || ch === 'イ') && E_ROW.includes(prev)) ||
            ch === 'ー'
        )) out.shorten.add(splice(i, 1));

        // Kısa ünlüyü uzat: こ → こう, せ → せい, コ → コー. Zaten uzunsa ya da
        // hece çıplak ünlüyse (う → うう) dokunma; ん/っ önüne de eklenmez.
        const canLengthen = !VOWELS.includes(ch) && !(next && (VOWELS + 'んンっッ').includes(next));
        if (canLengthen && (O_ROW.includes(ch) || U_ROW.includes(ch))) {
            out.lengthen.add(splice(i + 1, 0, isKatakana(ch) ? 'ー' : 'う'));
        }
        if (canLengthen && E_ROW.includes(ch)) {
            out.lengthen.add(splice(i + 1, 0, isKatakana(ch) ? 'ー' : 'い'));
        }

        // Küçük っ: がっこう → がこう, いち → いっち
        if (ch === 'っ' || ch === 'ッ') out.sokuon.add(splice(i, 1));
        if (i > 0 && GEMINABLE.includes(ch) && !'っッんン'.includes(prev)) {
            out.sokuon.add(splice(i, 0, inScript('っ', ch)));
        }

        // Küçük/büyük や ゆ よ: きょう → きよう, きよ → きょ
        if (SMALL_TO_LARGE.has(ch)) out.yoon.add(splice(i, 1, SMALL_TO_LARGE.get(ch)));
        if (LARGE_TO_SMALL.has(ch) && prev && I_ROW_CONSONANT.includes(prev)) {
            out.yoon.add(splice(i, 1, LARGE_TO_SMALL.get(ch)));
        }

        // Aynı satırda ünlü değişimi: おんな → おんの. Ardından küçük ゃゅょ gelen
        // hece değişmez (きょ'nun き'si i-sırası olmak zorunda), kelime içindeki
        // çıplak ünlü de değişmez — çoğu zaman uzatmadır (こう → こあ anlamsız).
        const vowelInside = i > 0 && VOWELS.includes(ch);
        if (!vowelInside && !(next && SMALL_YOON.includes(next))) {
            for (const alt of SAME_ROW.get(ch) || []) out.vowel.add(splice(i, 1, alt));
        }
    });

    const clean = (set) => [...set].filter(v => v && v !== kana);
    return {
        voicing: clean(out.voicing),
        shorten: clean(out.shorten),
        sokuon: clean(out.sokuon),
        yoon: clean(out.yoon),
        lengthen: clean(out.lengthen),
        vowel: clean(out.vowel)
    };
};

module.exports = { readingMutations };
