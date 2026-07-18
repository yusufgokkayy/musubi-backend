const StudySession = require('../../models/StudySession');
const Streak = require('../../models/Streak');
const Progress = require('../../models/Progress');
const UserWord = require('../../models/UserWord');
const User = require('../../models/User');
const Word = require('../../models/Word');
const Event = require('../../models/Event');
const DailyWordPool = require('../../models/DailyWordPool');
const AppError = require('../../utils/AppError');
const { startOfDayInTz, startOfDateInTz, addDays } = require('../../utils/date.util');

const HomeService = {
    async getSummary(userId) {
        const user = await User.findById(userId).select('timezone name dailyGoal');
        const today = startOfDayInTz(user?.timezone);
        const tomorrow = addDays(today, 1);
        const tomorrowEnd = addDays(today, 2);

        const [todaySession, streak, progress, reviewCount, tomorrowReviews, todayMistakeCount, todayPools] = await Promise.all([
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
                nextReviewDate: { $gte: tomorrow, $lt: tomorrowEnd }
            }),

            // "Bugünün Hataları — 8 Hata" başlığı; liste /userwords/mistakes'ten
            // gelir, filtre oradakiyle birebir aynı olmalı: bugün cevaplanmış
            // VE son cevabı yanlış (ömür boyu wrongCount filtre DEĞİLDİR)
            UserWord.countDocuments({
                user: userId,
                lastReviewDate: { $gte: today },
                lastResult: 'wrong'
            }),

            // Çemberin paydası için bugünün havuz(lar)ı
            DailyWordPool.find({ user: userId, date: { $gte: today } })
        ]);

        // Çemberin paydası = BUGÜNÜN HAVUZU (günün sözleşmesi). dailyGoal canlı
        // tercih değeridir: gün içinde değişince payda anında oynamamalı —
        // havuz genişlerse (hedef artışı) goal zaten onunla birlikte büyür.
        const todayPoolSize = todayPools.reduce(
            (sum, p) => sum + p.newWordIds.length + p.reviewWordIds.length, 0
        );

        return {
            name: user?.name || '',        // "Merhaba Emirhan" başlığı
            goal: todayPoolSize || user?.dailyGoal || 20, // ilerleme çemberinin PAYDASI
            dailyGoal: user?.dailyGoal || 20, // ayarlardaki tercih (çember için KULLANMA)
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
            tomorrowReviews,       // "Yarın N Kart Bekliyor" bandı
            todayMistakeCount
        };
    },

    // Takvimden bir güne dokununca açılan detay: o günün sayıları + çalışılan
    // kelimeler (her kelimenin o günkü SON cevabıyla). Kelime listesi
    // answer_submitted event'lerinden geri kurulur.
    async getDayDetail(userId, dateStr) {
        const user = await User.findById(userId).select('timezone dailyGoal');
        const dayStart = startOfDateInTz(user?.timezone, dateStr);
        if (!dayStart) throw new AppError('Geçersiz tarih, YYYY-MM-DD bekleniyor', 400);
        const dayEnd = addDays(dayStart, 1);

        const [session, events, pools] = await Promise.all([
            StudySession.findOne({ user: userId, date: { $gte: dayStart, $lt: dayEnd } }),
            Event.find({
                user: userId,
                type: 'answer_submitted',
                createdAt: { $gte: dayStart, $lt: dayEnd }
            }).sort({ createdAt: 1 }).select('data'),
            DailyWordPool.find({ user: userId, date: { $gte: dayStart, $lt: dayEnd } })
        ]);

        // Kelime başına o günkü son SAYILAN cevap geçerlidir (kronolojik sıra
        // korunur); tekrar çalışma turlarının nötr cevapları (practice) günün
        // sonucunu ezmez
        const resultByWord = new Map();
        for (const e of events) {
            if (e.data?.wordId && !e.data.practice) {
                resultByWord.set(String(e.data.wordId), e.data.result);
            }
        }

        const wordDocs = await Word.find({ _id: { $in: [...resultByWord.keys()] } })
            .select('kanji romaji meaning type jlptLevel');
        const wordById = new Map(wordDocs.map(w => [String(w._id), w]));

        const words = [...resultByWord.entries()]
            .filter(([id]) => wordById.has(id))
            .map(([id, result]) => ({ word: wordById.get(id), result }));

        // Çemberin paydası: o günün havuz büyüklüğü (tarihsel hedef);
        // havuz kaydı yoksa güncel dailyGoal'a düşülür
        const poolSize = pools.reduce(
            (sum, p) => sum + p.newWordIds.length + p.reviewWordIds.length, 0
        );

        return {
            date: dateStr,
            goal: poolSize || user?.dailyGoal || 20,
            totalWords: session?.totalWords || 0,
            correctCount: session?.correctCount || 0,
            wrongCount: session?.wrongCount || 0,
            emptyCount: session?.emptyCount || 0,
            isCompleted: session?.isCompleted || false,
            words
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