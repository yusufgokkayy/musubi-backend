const Word = require('../../models/Word');
const { meaningIn } = require('../../utils/answer.util');

// Bildirim metinleri KULLANICININ DİLİNDE ve OKUNDUĞU ANDA üretilir.
//
// Kayıtta asıl olan tip + data'dır (olay: "12 günlük seri", "şu kelime 3.
// seviyeye düştü"). title/body her listelemede kullanıcının o anki diline göre
// yeniden yazılır; böylece dilini değiştiren kullanıcı eski bildirimlerini de
// yeni dilde görür ve metin düzeltmeleri geçmişe de yansır. Push ise
// gönderildiği anki dilde gider — telefona düştükten sonra değiştirilemez.
//
// Yeni dil eklemek = TEXTS'e bir dil daha eklemek. Eksik anahtar önce
// İngilizceye, o da yoksa Türkçeye düşer; yarım çeviri bildirimi bozmaz.
//
// Şablon ya düz metindir ya da sayıya göre çekimlenen { plural, one, other }
// nesnesi: `plural` hangi parametrenin sayı olduğunu söyler, biçim
// Intl.PluralRules ile seçilir (Türkçede hep `other`, İngilizcede 1 → `one`;
// Rusça/Arapça gibi dillerde few/many de verilebilir).
//
// Türkçe metinler Figma › Versiyon 1.x.x › Bildirimler'deki kartlarla birebir.
const TEXTS = {
    tr: {
        daily_task: {
            title: 'Bugünün Görevi',
            body: 'Bugün {remaining} ezberlenecek kelime seni bekliyor!'
        },
        daily_word: {
            title: 'Günlük Kelime',
            body: 'Bugünün günlük kelimesi; {kanji} ({romaji}) = {meaning}'
        },
        streak_reminder: {
            title: '{currentStreak} Günlük Seri!',
            body: 'Serini devam ettirmeyi unutma.'
        },
        streak_warning: {
            title: 'Serini Kaybedeceksin',
            body: '1 saat sonra serini kaybedeceksin. Acele et, dersini kaçırma...'
        },
        word_level_down: {
            title: 'Kelimenin Seviyesi Düştü',
            body: '{kanji} ({romaji}) kelimesinin seviyesi {newLevel}. seviyeye düştü. Uygulamaya gir tekrar hatırla!'
        },
        // Tasarımda yalnızca tek kelimelik kart var; çoklu düşüş aynı kartın
        // dilinde tek bildirimde toplanır
        word_level_down_many: {
            title: 'Kelimelerin Seviyesi Düştü',
            body: '{kanji} ({romaji}) ve {rest} kelime daha seviye kaybetti. Uygulamaya gir tekrar hatırla!'
        }
    },
    en: {
        daily_task: {
            title: 'Today\'s Task',
            body: {
                plural: 'remaining',
                one: '{remaining} word is waiting for you today!',
                other: '{remaining} words are waiting for you today!'
            }
        },
        daily_word: {
            title: 'Word of the Day',
            body: 'Today\'s word: {kanji} ({romaji}) = {meaning}'
        },
        streak_reminder: {
            title: '{currentStreak}-Day Streak!',
            body: 'Don\'t forget to keep your streak going.'
        },
        streak_warning: {
            title: 'You\'re About to Lose Your Streak',
            body: 'Your streak ends in 1 hour. Hurry, don\'t miss your lesson...'
        },
        word_level_down: {
            title: 'A Word Dropped a Level',
            body: '{kanji} ({romaji}) dropped to level {newLevel}. Open the app and refresh your memory!'
        },
        word_level_down_many: {
            title: 'Some Words Dropped a Level',
            body: {
                plural: 'rest',
                one: '{kanji} ({romaji}) and {rest} more word lost a level. Open the app and refresh your memory!',
                other: '{kanji} ({romaji}) and {rest} more words lost a level. Open the app and refresh your memory!'
            }
        }
    }
};

const FALLBACK_LANGS = ['en', 'tr'];

const templateFor = (lang, key, part) => {
    for (const l of [lang, ...FALLBACK_LANGS]) {
        const tpl = TEXTS[l]?.[key]?.[part];
        if (tpl) return { tpl, lang: l };
    }
    return null;
};

// Eksik parametre varsa null döner: metin yarım kalacağına kayıttaki
// (oluşturulduğu andaki) metin gösterilir
const fill = (str, params) => {
    let missing = false;
    const out = str.replace(/\{(\w+)\}/g, (_, k) => {
        if (params[k] === undefined || params[k] === null || params[k] === '') missing = true;
        return params[k];
    });
    return missing ? null : out;
};

const format = (lang, key, part, params) => {
    const found = templateFor(lang, key, part);
    if (!found) return null;
    let { tpl } = found;
    if (typeof tpl === 'object') {
        const n = Number(params[tpl.plural]);
        const form = new Intl.PluralRules(found.lang).select(n);
        tpl = tpl[form] || tpl.other;
    }
    return fill(tpl, params);
};

// Tipin hangi şablonu ve hangi parametreleri kullandığı. Kelime gerektiren
// tipler kelimeyi data'daki id'den okur (anlam o dilde, kayıtta saklanmaz).
const paramsFor = (type, data = {}, words, lang) => {
    const word = (id) => (id ? words.get(String(id)) : null);
    const wordParams = (w) => (w ? { kanji: w.kanji, romaji: w.romaji, meaning: meaningIn(w, lang) } : {});

    switch (type) {
        case 'daily_task':
            return { key: type, params: { remaining: data.remaining } };
        case 'daily_word':
            return { key: type, params: wordParams(word(data.wordId)) };
        case 'streak_reminder':
        case 'streak_warning':
            return { key: type, params: { currentStreak: data.currentStreak } };
        case 'word_level_down':
            if (data.wordId) {
                return { key: type, params: { ...wordParams(word(data.wordId)), newLevel: data.newLevel } };
            }
            return {
                key: 'word_level_down_many',
                params: { ...wordParams(word(data.sampleWordId)), rest: (data.count || 0) - 1 }
            };
        default:
            return null; // test vb. — kayıttaki metin kullanılır
    }
};

const wordIdsOf = (items) => [...new Set(items.flatMap(n => [n.data?.wordId, n.data?.sampleWordId])
    .filter(Boolean).map(String))];

// [{ type, data, title?, body? }] → her biri için { title, body } (aynı sırada).
// Şablon ya da parametre eksikse o öğenin kendi title/body'si İKİSİ BİRDEN
// korunur — başlık yeni dilde, gövde eski dilde karışık bir kart çıkmasın.
const renderAll = async (items, lang = 'tr') => {
    const ids = wordIdsOf(items);
    const words = new Map(
        ids.length
            ? (await Word.find({ _id: { $in: ids } }).select('kanji romaji meaning meaningTr').lean())
                .map(w => [String(w._id), w])
            : []
    );

    return items.map((n) => {
        const spec = paramsFor(n.type, n.data, words, lang);
        const title = spec && format(lang, spec.key, 'title', spec.params);
        const body = spec && format(lang, spec.key, 'body', spec.params);
        return title && body ? { title, body } : { title: n.title, body: n.body };
    });
};

module.exports = { renderAll, TEXTS };
