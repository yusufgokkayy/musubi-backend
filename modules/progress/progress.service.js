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
                const totalWords = await Word.countDocuments({ jlptLevel: p.jlptLevel });
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
        const totalWords = await Word.countDocuments({ jlptLevel });
        if (totalWords === 0) return 0;

        const learnedWords = await UserWord.countDocuments({
            user: userId,
            status: 'learned',
            word: { $in: await Word.find({ jlptLevel }).distinct('_id') }
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
            if (currentIndex === -1 || currentIndex === 0) return; // N1 zaten en yüksek

            const nextLevel = LEVELS[currentIndex - 1];

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

    async unlockByQuiz(userId, jlptLevel) {
        const currentIndex = LEVELS.indexOf(jlptLevel);
        if (currentIndex === -1 || currentIndex === 0) {
            throw new AppError('Invalid level', 400);
        }

        const nextLevel = LEVELS[currentIndex - 1];

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