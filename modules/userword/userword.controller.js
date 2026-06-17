const catchAsync = require('../../utils/catchAsync');
const UserWordService = require('./userword.service');

const UserWordController = {
    getTodayWords: catchAsync(async (req, res) => {
        const { jlptLevel } = req.query;
        const data = await UserWordService.getTodayWords(req.user.id, jlptLevel);
        res.status(200).json({ success: true, data: data });
    }),

    submitAnswer: catchAsync(async (req, res) => {
        const { wordId, result } = req.body;
        const data = await UserWordService.submitAnswer(req.user.id, wordId, result);
        res.status(200).json({ success: true, data: data });
    }),

    getUserStats: catchAsync(async (req, res) => {
        const data = await UserWordService.getUserStats(req.user.id);
        res.status(200).json({ success: true, data: data });
    })
};

module.exports = UserWordController;