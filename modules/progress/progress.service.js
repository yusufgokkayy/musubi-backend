const mongoose = require('mongoose');
const Progress = require('../../models/Progress');
const UserWord = require('../../models/UserWord');
const Word = require('../../models/Word');
const AppError = require('../../utils/AppError');

const LEVELS = ['N5', 'N4', 'N3', 'N2', 'N1'];
const COMPLETION_THRESHOLD = 80; // %80

const ProgressService = {
    async initializeProgress(userId) {
        // Kullanıcı kayıt olunca sadece N5 açık
        await Progress.create({
            user: userId,
            jlptLevel: 'N5',
            isUnlocked: true,
            unlockedAt: new Date(),
            unlockedBy: 'study'
        });

        // Diğer seviyeler kilitli
        const lockedLevels = ['N4', 'N3', 'N2', 'N1'].map(level => ({
            user: userId,
            jlptLevel: level,
            isUnlocked: false
        }));

        await Progress.insertMany(lockedLevels);
    },

    async getProgress(userId) {
        const progress = await Progress.find({ user: userId }).sort({ jlptLevel: 1 });

        const progressWithCount = await Promise.all(
            progress.map(async (p) => {
                const totalWords = await Word.countDocuments({ jlptLevel: p.jlptLevel, isCore: true });
                return {
                    jlptLevel: p.jlptLevel,
                    isUnlocked: p.isUnlocked,
                    completionRate: p.completionRate,
                    totalWords
                };
            })
        );

        return progressWithCount;
    },

    async calculateCompletionRate(userId, jlptLevel) {
        const totalWords = await Word.countDocuments({ jlptLevel, isCore: true });
        if (totalWords === 0) return 0;

        // masteryLevel >= 3 (2 başarılı tekrar) "sayılır" — 'learned' (21 gün) beklenirse
        // çalışkan bir kullanıcı bile seviyeyi aylarca açamaz
        const learnedWords = await UserWord.countDocuments({
            user: userId,
            masteryLevel: { $gte: 3 },
            word: { $in: await Word.find({ jlptLevel, isCore: true }).distinct('_id') }
        });

        return Math.round((learnedWords / totalWords) * 100);
    },

    async checkAndUnlockNextLevel(userId, jlptLevel) {
        const completionRate = await ProgressService.calculateCompletionRate(userId, jlptLevel);

        // Tamamlanma oranını güncelle
        await Progress.findOneAndUpdate(
            { user: userId, jlptLevel },
            { completionRate }
        );

        if (completionRate >= COMPLETION_THRESHOLD) {
            const currentIndex = LEVELS.indexOf(jlptLevel);
            // N1 son seviye, sonrası yok
            if (currentIndex === -1 || currentIndex === LEVELS.length - 1) return;

            const nextLevel = LEVELS[currentIndex + 1];

            const nextProgress = await Progress.findOne({
                user: userId,
                jlptLevel: nextLevel
            });

            if (!nextProgress.isUnlocked) {
                nextProgress.isUnlocked = true;
                nextProgress.unlockedAt = new Date();
                nextProgress.unlockedBy = 'study';
                await nextProgress.save();

                return { unlocked: true, level: nextLevel };
            }
        }

        return { unlocked: false };
    },

    // Seviyeler ekranındaki donut grafik için: bu JLPT seviyesindeki
    // kelimelerin 1-5 mastery seviyelerine göre dağılımı
    async getLevelDistribution(userId, jlptLevel) {
        if (!LEVELS.includes(jlptLevel)) {
            throw new AppError('Invalid level', 400);
        }

        const wordIds = await Word.find({ jlptLevel, isCore: true }).distinct('_id');
        const totalWords = wordIds.length;

        const counts = await UserWord.aggregate([
            {
                $match: {
                    user: new mongoose.Types.ObjectId(userId),
                    word: { $in: wordIds }
                }
            },
            // Eski kayıtlarda masteryLevel alanı olmayabilir, 1 say
            { $group: { _id: { $ifNull: ['$masteryLevel', 1] }, count: { $sum: 1 } } }
        ]);

        const distribution = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
        let started = 0;
        counts.forEach(c => {
            distribution[c._id] = c.count;
            started += c.count;
        });

        return {
            jlptLevel,
            totalWords,
            distribution,
            notStarted: totalWords - started
        };
    },

    async unlockByQuiz(userId, jlptLevel) {
        const currentIndex = LEVELS.indexOf(jlptLevel);
        // N1 son seviye, sonrası yok
        if (currentIndex === -1 || currentIndex === LEVELS.length - 1) {
            throw new AppError('Invalid level', 400);
        }

        const nextLevel = LEVELS[currentIndex + 1];

        const nextProgress = await Progress.findOne({
            user: userId,
            jlptLevel: nextLevel
        });

        if (!nextProgress) throw new AppError('Progress not found', 404);
        if (nextProgress.isUnlocked) throw new AppError('Level already unlocked', 400);

        nextProgress.isUnlocked = true;
        nextProgress.unlockedAt = new Date();
        nextProgress.unlockedBy = 'quiz';
        await nextProgress.save();

        return { unlocked: true, level: nextLevel };
    }
};

module.exports = ProgressService;