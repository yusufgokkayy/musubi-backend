const catchAsync = require('../../utils/catchAsync');
const StudySessionService = require('./studysession.service');

const StudySessionController = {
    startSession: catchAsync(async (req, res) => {
        const { jlptLevel } = req.body;
        const session = await StudySessionService.startSession(req.user.id, jlptLevel);
        res.status(200).json({ success: true, data: session });
    }),

    updateSession: catchAsync(async (req, res) => {
        const { result } = req.body;
        const session = await StudySessionService.updateSession(req.user.id, result);
        res.status(200).json({ success: true, data: session });
    }),

    completeSession: catchAsync(async (req, res) => {
        const session = await StudySessionService.completeSession(req.user.id);
        res.status(200).json({ success: true, data: session });
    }),

    getTodaySession: catchAsync(async (req, res) => {
        const session = await StudySessionService.getTodaySession(req.user.id);
        res.status(200).json({ success: true, data: session });
    }),

    getSessionHistory: catchAsync(async (req, res) => {
        const sessions = await StudySessionService.getSessionHistory(req.user.id);
        res.status(200).json({ success: true, data: sessions });
    })
};

module.exports = StudySessionController;