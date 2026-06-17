const UserWord = require('../../models/UserWord');
const Word = require('../../models/Word');
const AppError = require('../../utils/AppError');

const NEW_WORD_DAILY_LIMIT = parseInt(process.env.NEW_WORD_DAILY_LIMIT) || 10;
const REVIEW_DAILY_LIMIT = parseInt(process.env.REVIEW_DAILY_LIMIT) || 10;

const qualityMap = {
    correct: 4,
    empty: 2,
    wrong: 1
};

const sm2 = (userWord, quality) => {
    // quality: 0-5 arası (0-2 yanlış, 3-5 doğru)
    let { easeFactor, interval, repetitions } = userWord;

    if (quality >= 3) {
        if (repetitions === 0) interval = 1;
        else if (repetitions === 1) interval = 6;
        else interval = Math.round(interval * easeFactor);

        repetitions += 1;
        easeFactor = easeFactor + (0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02));
        if (easeFactor < 1.3) easeFactor = 1.3;
    } else {
        repetitions = 0;
        interval = 1;
    }

    const nextReviewDate = new Date();
    nextReviewDate.setDate(nextReviewDate.getDate() + interval);

    return { easeFactor, interval, repetitions, nextReviewDate };
};

const UserWordService = {
    async getTodayWords(userId, jlptLevel) {
        const today = new Date();

        // Bugün tekrar edilecek kelimeler
        const reviewWords = await UserWord.find({
            user: userId,
            nextReviewDate: { $lte: today },
            status: { $in: ['learning', 'learned'] }
        })
        .populate({
            path: 'word',
            match: jlptLevel ? { jlptLevel } : {}
        })
        .sort({ nextReviewDate: 1 })
        .limit(REVIEW_DAILY_LIMIT);

        const learnedWordIds = await UserWord.find({ user: userId }).distinct('word');

        const newWords = await Word.find({
            _id: { $nin: learnedWordIds },
            ...(jlptLevel && { jlptLevel })
        }).limit(NEW_WORD_DAILY_LIMIT);

        return { reviewWords, newWords };
    },

    async submitAnswer(userId, wordId, result) {
        const quality = qualityMap[result];
        if (!quality) throw new AppError('Invalid result, use: easy, correct, empty, wrong', 400);

        let userWord = await UserWord.findOne({ user: userId, word: wordId });

        if (!userWord) {
            userWord = await UserWord.create({ user: userId, word: wordId });
        }

        const { easeFactor, interval, repetitions, nextReviewDate } = sm2(userWord, quality);

        userWord.easeFactor = easeFactor;
        userWord.interval = interval;
        userWord.repetitions = repetitions;
        userWord.nextReviewDate = nextReviewDate;
        userWord.lastReviewDate = new Date();

        if (quality >= 3) {
            userWord.correctCount += 1;
            userWord.status = repetitions >= 3 ? 'learned' : 'learning';
        } else {
            userWord.wrongCount += 1;
            userWord.status = 'learning';
        }

        await userWord.save();
        return userWord;
    },

    async getUserStats(userId) {
        const [total, learned, learning, review] = await Promise.all([
            UserWord.countDocuments({ user: userId }),
            UserWord.countDocuments({ user: userId, status: 'learned' }),
            UserWord.countDocuments({ user: userId, status: 'learning' }),
            UserWord.countDocuments({ user: userId, nextReviewDate: { $lte: new Date() } })
        ]);

        return { total, learned, learning, review };
    }
};

module.exports = UserWordService;