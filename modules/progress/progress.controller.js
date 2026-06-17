const catchAsync = require('../../utils/catchAsync');
const ProgressService = require('./progress.service');

const ProgressController = {
    getProgress: catchAsync(async (req, res) => {
        const progress = await ProgressService.getProgress(req.user.id);
        res.status(200).json({ success: true, data: progress });
    }),

    checkAndUnlock: catchAsync(async (req, res) => {
        const { jlptLevel } = req.body;
        const result = await ProgressService.checkAndUnlockNextLevel(req.user.id, jlptLevel);
        res.status(200).json({ success: true, data: result });
    }),

    unlockByQuiz: catchAsync(async (req, res) => {
        const { jlptLevel } = req.body;
        const result = await ProgressService.unlockByQuiz(req.user.id, jlptLevel);
        res.status(200).json({ success: true, data: result });
    })
};

module.exports = ProgressController;