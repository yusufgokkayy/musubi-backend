const Word = require('../../models/Word');
const AppError = require('../../utils/AppError');

// Kullanıcı girdisindeki regex özel karakterlerini etkisizleştirir (ReDoS/regex injection koruması)
const escapeRegex = (str) => str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Aranan metnin eşleşeceği alanlar. kana ve meaningTr şart: kullanıcı kelimeyi
// gördüğü gibi arar — "tren" (Türkçe anlam) ya da "でんしゃ" (kana) yazan biri
// yalnızca kanji/romaji/İngilizce anlamda arayan bir sorguda hiçbir sonuç bulamaz.
const SEARCH_FIELDS = ['kanji', 'kana', 'romaji', 'meaning', 'meaningTr'];

const buildSearchFilter = (q) => {
    const safeQuery = escapeRegex(String(q).trim().slice(0, 100));
    if (!safeQuery) return null;
    return { $or: SEARCH_FIELDS.map(f => ({ [f]: { $regex: safeQuery, $options: 'i' } })) };
};

// Alaka puanı. Salt "içeriyor" eşleşmesi arama sonucunu kullanılmaz yapıyordu:
// "eki" yazan kullanıcı 257 sonuç alıp 駅'i ilk sayfada göremiyordu (bunseki,
// kaiseki... hepsi "eki" içeriyor), "tren" yazan 電車 yerine "trend" anlamlı
// 傾向'u ilk sırada görüyordu. Tam eşleşme önce gelmeli.
//
//   3 → alan tam olarak aranan metin        (romaji "eki" → 駅)
//   2 → alan aranan metinle başlıyor, ya da virgülle ayrılmış anlamlardan biri
//       öyle başlıyor ("istasyon, tren istasyonu" içinde "tren")
//   1 → yalnızca içeriyor (kelime ortasında)
const relevanceScore = (q) => {
    const esc = escapeRegex(String(q).trim().slice(0, 100));
    const exact = new RegExp(`^${esc}$`, 'i');
    // Anlam alanları "istasyon, tren istasyonu" gibi listeler; ayırıcıdan
    // sonraki başlangıçlar da "baştan eşleşme" sayılır
    const prefix = new RegExp(`(^|[\\s,;/、·])${esc}`, 'i');

    return {
        $max: SEARCH_FIELDS.map(field => ({
            $switch: {
                branches: [
                    { case: { $regexMatch: { input: { $ifNull: [`$${field}`, ''] }, regex: exact } }, then: 3 },
                    { case: { $regexMatch: { input: { $ifNull: [`$${field}`, ''] }, regex: prefix } }, then: 2 }
                ],
                default: 1
            }
        }))
    };
};

const WordService = {
    // Kütüphane listesi VE arama aynı uçtan döner: ikisi de aynı sayfalama
    // şeklini üretsin ki istemci tarafında tek kod yolu olsun.
    async getAllWords({ jlptLevel, type, q, page = 1, limit = 20, includeAll = false }) {
        // Query parametreleri kullanıcıdan gelir: sınırla ki ?limit=100000 atılamasın
        page = Math.max(parseInt(page) || 1, 1);
        limit = Math.min(Math.max(parseInt(limit) || 20, 1), 100);

        // Kütüphane varsayılan olarak aktif (core) kelime havuzunu gösterir
        const filter = includeAll ? {} : { isCore: true };
        if (jlptLevel) filter.jlptLevel = jlptLevel;
        if (type) filter.type = type;

        const search = q ? buildSearchFilter(q) : null;
        if (search) Object.assign(filter, search);

        const skip = (page - 1) * limit;

        // Sıralama olmadan sayfalama güvenilmez: Mongo sırayı garanti etmediği
        // için aynı kelime iki sayfada birden çıkabilir ya da hiç görünmeyebilir.
        // frequencyRank seviye içi müfredat sırası — asıl kullanım olan
        // ?jlptLevel=N5 sorgusunda kelimeler öğretilme sırasında gelir.
        // Seviye filtresi yokken seviyeler bu sıraya göre iç içe geçer;
        // _id son çare olarak sırayı tekilleştirip sayfalamayı kararlı kılar.
        const listQuery = search
            // Aramada önce alaka, sonra müfredat sırası. Aggregate düz nesne
            // döndürdüğü için hydrate ile mongoose belgesine çevriliyor —
            // aksi hâlde yanıttaki isKana virtual'ı sessizce kaybolurdu.
            ? Word.aggregate([
                { $match: filter },
                { $addFields: { _score: relevanceScore(q) } },
                { $sort: { _score: -1, frequencyRank: 1, _id: 1 } },
                { $project: { _score: 0 } },
                { $skip: skip },
                { $limit: limit }
            ]).then(docs => docs.map(d => Word.hydrate(d)))
            : Word.find(filter).sort({ frequencyRank: 1, _id: 1 }).skip(skip).limit(limit);

        const [words, total] = await Promise.all([
            listQuery,
            Word.countDocuments(filter)
        ]);

        return {
            words,
            total,
            page,
            totalPages: Math.ceil(total / limit)
        };
    },

    async getWordById(id) {
        const word = await Word.findById(id);
        if (!word) throw new AppError('Word not found', 404);
        return word;
    },

    // Eski uç (GET /api/words/search): yalnız kelime dizisi döndürür, sayfa yok.
    // Yerini GET /api/words?q= aldı — mobil taraf geçene kadar duruyor, ama
    // arama alanları artık ortak (kana ve meaningTr burada da geçerli).
    async searchWords(query) {
        const { words } = await WordService.getAllWords({ q: query, page: 1, limit: 20 });
        return words;
    },

    // async createWord(data) {
    //     const word = await Word.create(data);
    //     return word;
    // },

    // async updateWord(id, data) {
    //     const word = await Word.findByIdAndUpdate(id, data, {
    //         new: true,
    //         runValidators: true
    //     });
    //     if (!word) throw new AppError('Word not found', 404);
    //     return word;
    // },

    // async deleteWord(id) {
    //     const word = await Word.findByIdAndDelete(id);
    //     if (!word) throw new AppError('Word not found', 404);
    // }
};

module.exports = WordService;