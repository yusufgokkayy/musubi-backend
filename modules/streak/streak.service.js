const Streak = require('../../models/Streak');
const { startOfDayInTz, addDays, startOfTodayForUser } = require('../../utils/date.util');

const StreakService = {
    async initializeStreak(userId) {
        await Streak.create({ user: userId });
    },

    async updateStreak(userId) {
        let streak = await Streak.findOne({ user: userId });
        if (!streak) streak = await Streak.create({ user: userId });

        // "Bugün" kullanıcının kendi saat dilimine göre hesaplanır
        const today = await startOfTodayForUser(userId);
        const yesterday = addDays(today, -1);

        if (streak.lastStudyDate) {
            if (streak.lastStudyDate >= today) {
                // Bugün zaten güncellendi
                return streak;
            } else if (streak.lastStudyDate >= yesterday) {
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

    // Cron ile her saat başı çalışır: her kullanıcının KENDİ saat diliminde
    // "dünden beri çalışmamış" olanların serisi sıfırlanır. İdempotent.
    async resetExpiredStreaks() {
        const streaks = await Streak.find({ currentStreak: { $gt: 0 } })
            .populate('user', 'timezone');

        for (const streak of streaks) {
            try {
                const today = startOfDayInTz(streak.user?.timezone);
                const yesterday = addDays(today, -1);

                if (!streak.lastStudyDate || streak.lastStudyDate < yesterday) {
                    streak.currentStreak = 0;
                    await streak.save();
                }
            } catch (err) {
                console.error(`Streak reset hatası (${streak.user?._id}):`, err.message);
            }
        }
    }
};

module.exports = StreakService;
