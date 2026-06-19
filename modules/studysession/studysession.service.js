const StudySession = require('../../models/StudySession');
const AppError = require('../../utils/AppError');
const StreakService = require('../streak/streak.service');

const StudySessionService = {
    async startSession(userId, jlptLevel) {
        // Bugün zaten açık session var mı
        const today = new Date();
        today.setHours(0, 0, 0, 0);

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
        const today = new Date();
        today.setHours(0, 0, 0, 0);

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
        const today = new Date();
        today.setHours(0, 0, 0, 0);

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
        return session;
    },

    async getTodaySession(userId) {
        const today = new Date();
        today.setHours(0, 0, 0, 0);

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