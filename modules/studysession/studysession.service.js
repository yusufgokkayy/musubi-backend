const StudySession = require('../../models/StudySession');
const AppError = require('../../utils/AppError');
const StreakService = require('../streak/streak.service');
const { startOfTodayForUser } = require('../../utils/date.util');
const logEvent = require('../../utils/event.util');

const StudySessionService = {
    // GÜNLÜK TEK OTURUM: gün içinde tekrar giriş aynı kaydı sürdürür,
    // bitirilmiş oturum yeniden açılır. Aynı güne ikinci doküman asla oluşmaz
    // (eskiden complete sonrası start yeni doküman açıyor, home rastgele
    // birini okuyordu). Oturum "günün ilk gerçek cevaplarının" özetidir;
    // tekrar çalışma turları buraya yazılmaz (submitAnswer nötr geçer).
    async startSession(userId, jlptLevel) {
        const today = await startOfTodayForUser(userId);

        const existingSession = await StudySession.findOne({
            user: userId,
            date: { $gte: today }
        });

        if (existingSession) {
            if (existingSession.isCompleted) {
                existingSession.isCompleted = false;
                await existingSession.save();
            }
            return existingSession;
        }

        return StudySession.create({
            user: userId,
            jlptLevel
        });
    },

    // fromEmpty: ertelenmiş ("Şimdilik Geç") kelimenin günün ilk gerçek cevabı —
    // kelime totalWords'e empty olarak zaten sayılmıştı; sayaç devredilir
    // (emptyCount--, sonuç sayacı++), toplam değişmez
    async updateSession(userId, result, { fromEmpty = false } = {}) {
        const today = await startOfTodayForUser(userId);

        // isCompleted filtresi YOK: kullanıcı oturumu bitirdikten sonra ertelenmiş
        // kelimeyi cevaplarsa düzeltme yine günün kaydına işlenir
        const session = await StudySession.findOne({
            user: userId,
            date: { $gte: today }
        });

        if (!session) throw new AppError('No active session found', 404);

        if (fromEmpty) {
            session.emptyCount = Math.max(0, session.emptyCount - 1);
        } else {
            session.totalWords += 1;
        }
        if (result === 'correct' || result === 'easy') session.correctCount += 1;
        else if (result === 'wrong') session.wrongCount += 1;
        else if (result === 'empty') session.emptyCount += 1;

        await session.save();
        return session;
    },

    async completeSession(userId) {
        const today = await startOfTodayForUser(userId);

        const session = await StudySession.findOne({
            user: userId,
            date: { $gte: today }
        });

        if (!session) throw new AppError('No active session found', 404);

        session.isCompleted = true;
        session.completedAt = new Date();
        session.duration = Math.round(
            (session.completedAt - session.date) / 60000
        );

        await session.save();

        logEvent(userId, 'session_completed', {
            totalWords: session.totalWords,
            correctCount: session.correctCount,
            wrongCount: session.wrongCount,
            duration: session.duration
        });

        // Bitiş ekranındaki "Accuracy %" hazır gelsin — istemci hesaplamasın
        const accuracy = session.totalWords > 0
            ? Math.round((session.correctCount / session.totalWords) * 100)
            : 0;
        return { ...session.toObject(), accuracy };
    },

    async getTodaySession(userId) {
        const today = await startOfTodayForUser(userId);

        const session = await StudySession.findOne({
            user: userId,
            date: { $gte: today }
        });

        return session;
    },

    async getSessionHistory(userId) {
        const sessions = await StudySession.find({ user: userId })
            .sort({ date: -1 })
            .limit(30);

        return sessions;
    }
};

module.exports = StudySessionService;