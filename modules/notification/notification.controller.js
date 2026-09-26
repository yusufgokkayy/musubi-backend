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
    }),

    // Elle push testi: giriş yapmış kullanıcının kayıtlı fcmToken'ına anında
    // gönderir, notificationSettings'ten bağımsız (test tipi SETTING_MAP'te yok)
    sendTest: catchAsync(async (req, res) => {
        const { title, body } = req.body || {};
        const notification = await NotificationService.create(req.user.id, {
            type: 'test',
            title: String(title || 'Test Bildirimi').slice(0, 100),
            body: String(body || 'Bu bir test bildirimidir.').slice(0, 500),
            data: { test: true }
        });
        res.status(200).json({ success: true, data: notification });
    })
};

module.exports = NotificationController;
