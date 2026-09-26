const catchAsync = require('../../utils/catchAsync');
const StreakService = require('./streak.service');

const StreakController = {
    getStreak: catchAsync(async (req, res) => {
        const streak = await StreakService.getStreak(req.user.id);
        res.status(200).json({ success: true, data: streak });
    })
};

module.exports = StreakController;