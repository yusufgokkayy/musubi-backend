const crypto = require('crypto');
const Word = require('../../models/Word');
const AppError = require('../../utils/AppError');
const storage = require('../../config/storage');
const { isMp3 } = require('../../utils/audio.util');

const LEVELS = ['N5', 'N4', 'N3', 'N2', 'N1'];

// Ses türü → Word alanı. "word" kelimenin okunuşu ("Dinle" butonu),
// "example" örnek cümlenin sesi ("ÖRNEK KULLANIM" başlığındaki hoparlör).
const AUDIO_FIELDS = { word: 'audioKey', example: 'exampleAudioKey' };
const AUDIO_FOLDER = 'audio';

// Bir ses dosyasını hâlâ kullanan kelime var mı? Dosya adı içeriğin hash'i
// olduğu için iki kelime AYNI dosyayı paylaşabilir (aynı baytlar iki kez
// yüklenirse tek dosyaya düşer) — eski dosya körlemesine silinirse diğer
// kelimenin sesi kırılır. Hikâye görsellerindeki kuralın aynısı.
const removeAudioIfUnused = async (key) => {
    const stillUsed = await Word.exists({ $or: [{ audioKey: key }, { exampleAudioKey: key }] });
    if (!stillUsed) await storage.remove(key);
};

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

    // POST /api/words/audio — ses dosyalarını kelimelere bağlar.
    //
    // files[i] ile items[i] eşleşir (sıra sözleşmenin parçası: multer dosya
    // adındaki klasörü atıyor, "n5/0001.mp3" ile "n4/0001.mp3" aynı ada düşerdi).
    //
    // Kelime SEVİYE + MÜFREDAT SIRASI ile bulunur — ses üretimi veri setinden
    // yapılıyor ve oradaki kimlik budur (veritabanı id'sini bilmez). Öğe
    // `word` de taşıyorsa bulunan kelimenin yazımıyla KARŞILAŞTIRILIR: liste bir
    // satır kayarsa 駅'e 電車'nin sesi sessizce yazılmasın, öğe reddedilsin.
    //
    // İstek bütün olarak başarısız OLMAZ: her öğenin sonucu ayrı döner, hatalı
    // öğe diğerlerini durdurmaz (gönderici betik eksikleri raporlar ve yeniden
    // çalıştırılabilir — aynı dosya ikinci kez gelirse "unchanged" olur).
    async importAudio(files = [], items) {
        if (!Array.isArray(items) || items.length === 0) {
            throw new AppError("items gerekli: [{ level, order, kind, word? }] biçiminde JSON dizisi", 400);
        }
        if (files.length !== items.length) {
            throw new AppError(
                `Dosya sayısı (${files.length}) ile items sayısı (${items.length}) eşit olmalı`, 400
            );
        }

        const results = [];
        for (let index = 0; index < items.length; index++) {
            results.push({ index, ...(await WordService.importOneAudio(files[index], items[index])) });
        }

        const count = (status) => results.filter(r => r.status === status).length;
        const stored = count('stored');
        const unchanged = count('unchanged');
        return {
            summary: { total: results.length, stored, unchanged, failed: results.length - stored - unchanged },
            results
        };
    },

    async importOneAudio(file, item) {
        const fail = (status, message) => ({ status, message });

        const level = String(item?.level ?? '').toUpperCase();
        const order = Number(item?.order);
        const field = AUDIO_FIELDS[item?.kind];
        if (!LEVELS.includes(level)) return fail('invalid', 'level N5-N1 arasında olmalı');
        if (!Number.isInteger(order) || order < 1) return fail('invalid', 'order pozitif tam sayı olmalı');
        if (!field) return fail('invalid', 'kind "word" veya "example" olmalı');
        if (!isMp3(file?.buffer)) return fail('invalid', 'Dosya MP3 değil (WAV/OGG kabul edilmez, MP3\'e çevirin)');

        const candidates = await Word.find({ jlptLevel: level, frequencyRank: order, isCore: true });
        if (candidates.length === 0) {
            return fail('not_found', `${level} seviyesinde ${order}. sırada kelime yok`);
        }
        const expected = item.word == null ? null : String(item.word).trim();
        const word = expected === null
            ? (candidates.length === 1 ? candidates[0] : null)
            : candidates.find(w => w.kanji === expected);
        if (!word) {
            return fail(
                'mismatch',
                expected === null
                    ? `${level} #${order} birden çok kelimeye uyuyor; öğeye "word" ekleyin`
                    : `${level} #${order} veritabanında "${candidates[0].kanji}", listede "${expected}"`
            );
        }

        // Dosya adı İÇERİĞİN hash'i: aynı ses yeniden yüklenirse aynı dosyaya
        // yazılır, içerik değişmedikçe URL değişmez (/uploads immutable cache)
        const hash = crypto.createHash('sha256').update(file.buffer).digest('hex').slice(0, 32);
        const key = await storage.put(file.buffer, { folder: AUDIO_FOLDER, filename: `${hash}.mp3` });

        const previous = word[field];
        const base = { wordId: word._id, kanji: word.kanji, kind: item.kind, url: storage.publicUrl(key) };
        if (previous === key) return { status: 'unchanged', ...base };

        await Word.updateOne({ _id: word._id }, { [field]: key });
        if (previous) await removeAudioIfUnused(previous);
        return { status: 'stored', replaced: Boolean(previous), ...base };
    },

    // Seviye başına çekirdek kelime sayısı. Uygulamadaki TÜM kelime sorguları
    // (ders havuzu, kütüphane, quiz, hafıza, seviye listesi) isCore:true
    // filtreler; bir seviyede çekirdek kelime yoksa o seviye her yerde boş
    // görünür ama hiçbir uç hata vermez — "totalWords: 0" ve boş ders 200 OK
    // döner. Bu sayım açılışta loglanır (bkz. server.js), teşhis dakikalar
    // değil saniyeler sürsün.
    async coreWordCounts() {
        const rows = await Word.aggregate([
            { $match: { isCore: true } },
            { $group: { _id: '$jlptLevel', count: { $sum: 1 } } }
        ]);
        const counts = { N5: 0, N4: 0, N3: 0, N2: 0, N1: 0 };
        rows.forEach(r => { if (r._id in counts) counts[r._id] = r.count; });
        return counts;
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