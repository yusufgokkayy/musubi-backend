const express = require('express');
const NotificationController = require('./notification.controller');
const { isAdmin } = require('../../middlewares/auth.middleware');
// protect + isEmailVerified app.js'te mount seviyesinde uygulanır

const router = express.Router();

router.get('/',             NotificationController.getNotifications);
// Elle push testi YALNIZCA admin: açıkken her kullanıcı istediği metinle
// sınırsız bildirim kaydı üretebiliyordu. Push'u denemek isteyen geliştirici
// hesabını `npm run make-admin -- <e-posta>` ile yetkilendirir.
router.post('/test',        isAdmin, NotificationController.sendTest);
router.put('/read-all',     NotificationController.markAllAsRead);
router.put('/:id/read',     NotificationController.markAsRead);

module.exports = router;
