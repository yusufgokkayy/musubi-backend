const express = require('express');
const NotificationController = require('./notification.controller');
// protect + isEmailVerified app.js'te mount seviyesinde uygulanır

const router = express.Router();

router.get('/',             NotificationController.getNotifications);
router.post('/test',        NotificationController.sendTest);
router.put('/read-all',     NotificationController.markAllAsRead);
router.put('/:id/read',     NotificationController.markAsRead);

module.exports = router;
