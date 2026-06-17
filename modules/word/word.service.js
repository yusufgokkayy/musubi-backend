const Word = require('../../models/Word');
const AppError = require('../../utils/AppError');

const WordService = {
    async getAllWords({ jlptLevel, type, page = 1, limit = 20 }) {
        const filter = {};
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
        const words = await Word.find({
            $or: [
                { kanji: { $regex: query, $options: 'i' } },
                { romaji: { $regex: query, $options: 'i' } },
                { meaning: { $regex: query, $options: 'i' } }
            ]
        }).limit(20);
        return words;
    },

    async createWord(data) {
        const word = await Word.create(data);
        return word;
    },

    async updateWord(id, data) {
        const word = await Word.findByIdAndUpdate(id, data, {
            new: true,
            runValidators: true
        });
        if (!word) throw new AppError('Word not found', 404);
        return word;
    },

    async deleteWord(id) {
        const word = await Word.findByIdAndDelete(id);
        if (!word) throw new AppError('Word not found', 404);
    }
};

module.exports = WordService;