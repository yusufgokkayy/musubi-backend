// veri-seti/musubi_n{N}.json ile musubi_n{N}_furigana.json'u tek cümlede birleştirir.
//
// Neden gerekli: iki dosya aynı cümleleri farklı işaretlemeyle taşıyor ve her biri
// diğerinde olmayan bir bilgiyi tutuyor —
//
//   furigansız : 東京**駅**で会いましょう。            (hedef kelime vurgusu var, okunuş yok)
//   furiganalı : 東京[とうきょう]駅[えき]で会[あ]いましょう。  (okunuş var, vurgu YOK — 5816/5816'sında)
//
// Tasarımdaki örnek cümle ikisini birden istiyor: 駅 hem kırmızı hem üstünde えき.
// İki dosyanın düz metinleri (işaretlemeler soyulduğunda) 5816/5816 birebir aynı
// olduğu için ** işaretleri furiganalı metne karakter hizasıyla taşınabiliyor.

const AT_SIGN = /\[[^\]]*\]/g;

// "東京[とうきょう]駅[えき]で" → düz metin "東京駅で"
const stripFurigana = (s) => s.replace(AT_SIGN, '');
const stripBold = (s) => s.replaceAll('**', '');

// Furiganalı metni "atom"lara böler. Bir atom = tek bir düz metin karakteri +
// hemen ardından geliyorsa ona ait okunuş parantezi. 毎朝[まいあさ] iki atomdur:
// (毎) ve (朝[まいあさ]) — yani parantez kendinden önceki TEK karaktere bağlanır.
// ** kapanışını parantezden sonraya koyabilmek için bu gruplama şart, aksi hâlde
// 駅**[えき]** gibi okunuşu vurgunun dışında bırakan bir çıktı üretirdik.
function toAtoms(furigana) {
    const atoms = [];
    let i = 0;
    while (i < furigana.length) {
        const ch = furigana[i];
        i += 1;
        let raw = ch;
        if (furigana[i] === '[') {
            const close = furigana.indexOf(']', i);
            if (close === -1) throw new Error(`Kapanmayan köşeli parantez: ${furigana}`);
            raw += furigana.slice(i, close + 1);
            i = close + 1;
        }
        atoms.push(raw);
    }
    return atoms;
}

// plainBold içindeki **...** aralıklarını düz metin karakter ofseti olarak döndürür
function boldRanges(plainBold) {
    const ranges = [];
    let plainIdx = 0;
    let open = null;
    for (let i = 0; i < plainBold.length; i += 1) {
        if (plainBold[i] === '*' && plainBold[i + 1] === '*') {
            if (open === null) open = plainIdx;
            else { ranges.push([open, plainIdx]); open = null; }
            i += 1;
            continue;
        }
        plainIdx += 1;
    }
    if (open !== null) throw new Error(`Kapanmayan ** işareti: ${plainBold}`);
    return ranges;
}

/**
 * @param {string} plainExample     furigansız dosyadaki exampleJp (** işaretli)
 * @param {string} furiganaExample  furiganalı dosyadaki exampleJp ([...] işaretli)
 * @returns {string} ikisini birleştiren cümle, ör. 東京[とうきょう]**駅[えき]**で会[あ]いましょう。
 * @throws iki cümlenin düz metni tutmuyorsa — sessizce bozuk veri üretmektense durur
 */
function mergeFurigana(plainExample, furiganaExample) {
    // Okunuş yoksa alan boş kalır. Furigansız cümleyi buraya kopyalamak,
    // tüketiciye olmayan bir okunuş verisini varmış gibi gösterirdi.
    if (!furiganaExample) return undefined;
    if (!plainExample) return furiganaExample;

    const plain = stripBold(plainExample);
    if (plain !== stripFurigana(furiganaExample)) {
        throw new Error(
            `Düz metinler uyuşmuyor:\n  furigansız: ${plain}\n  furiganalı: ${stripFurigana(furiganaExample)}`
        );
    }

    const ranges = boldRanges(plainExample);
    if (ranges.length === 0) return furiganaExample;

    const atoms = toAtoms(furiganaExample);
    const opensAt = new Set(ranges.map(([s]) => s));
    const closesAt = new Set(ranges.map(([, e]) => e - 1));

    let out = '';
    atoms.forEach((raw, idx) => {
        if (opensAt.has(idx)) out += '**';
        out += raw;
        if (closesAt.has(idx)) out += '**';
    });

    // Birleştirme hiçbir karakteri kaybetmemiş/uydurmamış olmalı
    if (stripBold(out) !== furiganaExample) {
        throw new Error(`Birleştirme furigana metnini bozdu:\n  girdi: ${furiganaExample}\n  çıktı: ${stripBold(out)}`);
    }
    if (stripFurigana(stripBold(out)) !== plain) {
        throw new Error(`Birleştirme düz metni bozdu: ${out}`);
    }

    return out;
}

module.exports = { mergeFurigana, stripFurigana, stripBold };
