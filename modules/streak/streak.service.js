const Streak = require('../../models/Streak');
const StudySession = require('../../models/StudySession');

const StreakService = {
    async initializeStreak(userId) {
        await Streak.create({ user: userId });
    },

    async updateStreak(userId) {
        let streak = await Streak.findOne({ user: userId });
        if (!streak) streak = await Streak.create({ user: userId });

        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const yesterday = new Date(today);
        yesterday.setDate(yesterday.getDate() - 1);

        const lastStudy = streak.lastStudyDate
            ? new Date(streak.lastStudyDate)
            : null;

        if (lastStudy) {
            lastStudy.setHours(0, 0, 0, 0);

            if (lastStudy.getTime() === today.getTime()) {
                // Bugün zaten güncellendi
                return streak;
            } else if (lastStudy.getTime() === yesterday.getTime()) {
                // Dün çalıştı, seri devam ediyor
                streak.currentStreak += 1;
            } else {
                // Ara verildi, seri sıfırlanıyor
                streak.currentStreak = 1;
            }
        } else {
            // İlk defa çalışıyor
            streak.currentStreak = 1;
        }

        streak.lastStudyDate = new Date();

        if (streak.currentStreak > streak.longestStreak) {
            streak.longestStreak = streak.currentStreak;
        }

        await streak.save();
        return streak;
    },

    async getStreak(userId) {
        const streak = await Streak.findOne({ user: userId });
        return streak;
    },

    async resetExpiredStreaks() {
        // Cron ile her gece çalışır
        const yesterday = new Date();
        yesterday.setDate(yesterday.getDate() - 1);
        yesterday.setHours(0, 0, 0, 0);

        await Streak.updateMany(
            { lastStudyDate: { $lt: yesterday } },
            { currentStreak: 0 }
        );
    }
};

module.exports = StreakService;