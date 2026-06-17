const catchAsync = require('../../utils/catchAsync');
const HomeService = require('./home.service');

const HomeController = {
    getSummary: catchAsync(async (req, res) => {
        const summary = await HomeService.getSummary(req.user.id);
        res.status(200).json({ success: true, data: summary });
    }),

    getCalendar: catchAsync(async (req, res) => {
        const calendar = await HomeService.getCalendar(req.user.id);
        res.status(200).json({ success: true, data: calendar });
    })
};

module.exports = HomeController;