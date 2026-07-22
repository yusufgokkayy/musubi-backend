const Word = require('../../models/Word');
const AppError = require('../../utils/AppError');

// Kullanıcı girdisindeki regex özel karakterlerini etkisizleştirir (ReDoS/regex injection koruması)
const escapeRegex = (str) => str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const WordService = {
    async getAllWords({ jlptLevel, type, page = 1, limit = 20, includeAll = false }) {
        // Query parametreleri kullanıcıdan gelir: sınırla ki ?limit=100000 atılamasın
        page = Math.max(parseInt(page) || 1, 1);
        limit = Math.min(Math.max(parseInt(limit) || 20, 1), 100);

        // Kütüphane varsayılan olarak aktif (core) kelime havuzunu gösterir
        const filter = includeAll ? {} : { isCore: true };
        if (jlptLevel) filter.jlptLevel = jlptLevel;
        if (type) filter.type = type;

        const skip = (page - 1) * limit;

        const [words, total] = await Promise.all([
            Word.find(filter).skip(skip).limit(limit),
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

    async searchWords(query) {
        const safeQuery = escapeRegex(String(query).slice(0, 100));
        const words = await Word.find({
            isCore: true,
            $or: [
                { kanji: { $regex: safeQuery, $options: 'i' } },
                { romaji: { $regex: safeQuery, $options: 'i' } },
                { meaning: { $regex: safeQuery, $options: 'i' } }
            ]
        }).limit(20);
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