const StudySession = require('../../models/StudySession');
const Streak = require('../../models/Streak');
const Progress = require('../../models/Progress');
const UserWord = require('../../models/UserWord');

const HomeService = {
    async getSummary(userId) {
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 1);
        tomorrow.setHours(0, 0, 0, 0);

        const tomorrowEnd = new Date(tomorrow);
        tomorrowEnd.setHours(23, 59, 59, 999);

        const [todaySession, streak, progress, reviewCount, tomorrowReviews] = await Promise.all([
            // Bugünün session'ı
            StudySession.findOne({
                user: userId,
                date: { $gte: today }
            }),

            // Streak
            Streak.findOne({ user: userId }),

            // Tüm seviyelerin ilerlemesi
            Progress.find({ user: userId }),

            // Bekleyen tekrar sayısı
            UserWord.countDocuments({
                user: userId,
                nextReviewDate: { $lte: new Date() },
                status: { $in: ['learning', 'learned'] }
            }),
            UserWord.countDocuments({
                user: userId,
                nextReviewDate: { $gte: tomorrow, $lte: tomorrowEnd }
            })
        ]);

        return {
            today: {
                totalWords: todaySession?.totalWords || 0,
                correctCount: todaySession?.correctCount || 0,
                wrongCount: todaySession?.wrongCount || 0,
                emptyCount: todaySession?.emptyCount || 0,
                isCompleted: todaySession?.isCompleted || false
            },
            streak: {
                current: streak?.currentStreak || 0,
                longest: streak?.longestStreak || 0,
                lastStudyDate: streak?.lastStudyDate || null
            },
            progress: progress.map(p => ({
                jlptLevel: p.jlptLevel,
                isUnlocked: p.isUnlocked,
                completionRate: p.completionRate
            })),
            pendingReviews: reviewCount,
            tomorrowReviews  // bunu ekle
        };
    },

    async getCalendar(userId) {
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

        const sessions = await StudySession.find({
            user: userId,
            date: { $gte: thirtyDaysAgo }
        }).select('date totalWords isCompleted');

        return sessions;
    }
};

module.exports = HomeService;