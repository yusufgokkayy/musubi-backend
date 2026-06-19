const UserWord = require('../../models/UserWord');
const Word = require('../../models/Word');
const AppError = require('../../utils/AppError');
const DailyWordPool = require('../../models/DailyWordPool');
const StreakService = require('../streak/streak.service');
const ProgressService = require('../progress/progress.service');
const StudySessionService = require('../studysession/studysession.service');

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
        today.setHours(0, 0, 0, 0);

        // Bugün için havuz var mı kontrol et
        let pool = await DailyWordPool.findOne({
            user: userId,
            date: today,
            jlptLevel
        });

        if (pool) {
            // Havuz zaten var, sabit listeyi döndür
            const reviewWords = await UserWord.find({
                _id: { $in: pool.reviewWordIds }
            }).populate('word');

            const newWords = await Word.find({
                _id: { $in: pool.newWordIds }
            });

            return { reviewWords, newWords };
        }

        // Havuz yok, yeni oluştur
        const reviewWordsRaw = await UserWord.find({
            user: userId,
            nextReviewDate: { $lte: new Date() },
            status: { $in: ['learning', 'learned'] }
        })
        .populate({
            path: 'word',
            match: jlptLevel ? { jlptLevel } : {}
        })
        .sort({ nextReviewDate: 1 })
        .limit(REVIEW_DAILY_LIMIT);

        const learnedWordIds = await UserWord.find({ user: userId }).distinct('word');

        // Rastgele yeni kelimeler
        const newWordsRaw = await Word.aggregate([
            {
                $match: {
                    _id: { $nin: learnedWordIds },
                    ...(jlptLevel && { jlptLevel })
                }
            },
            { $sample: { size: NEW_WORD_DAILY_LIMIT } }
        ]);

        // Havuzu kaydet
        await DailyWordPool.create({
            user: userId,
            date: today,
            jlptLevel,
            reviewWordIds: reviewWordsRaw.map(uw => uw._id),
            newWordIds: newWordsRaw.map(w => w._id)
        });

        return { reviewWords: reviewWordsRaw, newWords: newWordsRaw };
    },

    async submitAnswer(userId, wordId, result) {
        const quality = qualityMap[result];
        if (!quality) throw new AppError('Invalid result, use: correct, empty, wrong', 400);

        // wordId gerçekten var mı kontrol et
        const wordExists = await Word.findById(wordId);
        if (!wordExists) throw new AppError('Word not found', 404);

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
            userWord.status = interval >= 21 ? 'learned' : 'learning';
        } else {
            userWord.wrongCount += 1;
            userWord.status = 'learning';
        }

        await userWord.save();

        // İlk cevapta streak güncelle (kısmi ilerleme bile sayılsın)
        await StreakService.updateStreak(userId);
        await ProgressService.checkAndUnlockNextLevel(userId, wordExists.jlptLevel);

        try {
            await StudySessionService.updateSession(userId, result);
        } catch (err) {
            // Session yoksa sessizce geç, hata fırlatma
        }

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
    },

    async getTodayMistakes(userId, page = 1, limit = 10) {
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const skip = (page - 1) * limit;

        const [mistakes, total] = await Promise.all([
            UserWord.find({
                user: userId,
                lastReviewDate: { $gte: today },
                $expr: { $gt: ['$wrongCount', 0] }
            })
            .populate('word')
            .sort({ wrongCount: -1 })
            .skip(skip)
            .limit(limit),

            UserWord.countDocuments({
                user: userId,
                lastReviewDate: { $gte: today },
                $expr: { $gt: ['$wrongCount', 0] }
            })
        ]);

        return {
            mistakes,
            total,
            page,
            totalPages: Math.ceil(total / limit)
        };
    },
};

module.exports = UserWordService;