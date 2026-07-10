const catchAsync = require('../../utils/catchAsync');
const NotificationService = require('./notification.service');

const NotificationController = {
    getNotifications: catchAsync(async (req, res) => {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 20;
        const result = await NotificationService.list(req.user.id, page, limit);
        res.status(200).json({ success: true, data: result });
    }),

    markAsRead: catchAsync(async (req, res) => {
        const notification = await NotificationService.markAsRead(req.user.id, req.params.id);
        res.status(200).json({ success: true, data: notification });
    }),

    markAllAsRead: catchAsync(async (req, res) => {
        const result = await NotificationService.markAllAsRead(req.user.id);
        res.status(200).json({ success: true, data: result });
    })
};

module.exports = NotificationController;
