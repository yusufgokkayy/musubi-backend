const StudySession = require('../../models/StudySession');
const AppError = require('../../utils/AppError');
const StreakService = require('../streak/streak.service');
const { startOfTodayForUser } = require('../../utils/date.util');
const logEvent = require('../../utils/event.util');

const StudySessionService = {
    async startSession(userId, jlptLevel) {
        // Bugün zaten açık session var mı
        const today = await startOfTodayForUser(userId);

        const existingSession = await StudySession.findOne({
            user: userId,
            date: { $gte: today },
            isCompleted: false
        });

        if (existingSession) return existingSession;

        const session = await StudySession.create({
            user: userId,
            jlptLevel
        });

        return session;
    },

    async updateSession(userId, result) {
        const today = await startOfTodayForUser(userId);

        const session = await StudySession.findOne({
            user: userId,
            date: { $gte: today },
            isCompleted: false
        });

        if (!session) throw new AppError('No active session found', 404);

        session.totalWords += 1;
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
            date: { $gte: today },
            isCompleted: false
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