const catchAsync = require('../../utils/catchAsync');
const ProgressService = require('./progress.service');

const ProgressController = {
    getProgress: catchAsync(async (req, res) => {
        const progress = await ProgressService.getProgress(req.user.id);
        res.status(200).json({ success: true, data: progress });
    }),

    getDistribution: catchAsync(async (req, res) => {
        const result = await ProgressService.getLevelDistribution(req.user.id, req.params.jlptLevel);
        res.status(200).json({ success: true, data: result });
    })
};

module.exports = ProgressController;