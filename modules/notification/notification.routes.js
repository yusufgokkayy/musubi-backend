const express = require('express');
const NotificationController = require('./notification.controller');
const { protect, isEmailVerified } = require('../../middlewares/auth.middleware');

const router = express.Router();

router.get('/',             protect, isEmailVerified, NotificationController.getNotifications);
router.put('/read-all',     protect, isEmailVerified, NotificationController.markAllAsRead);
router.put('/:id/read',     protect, isEmailVerified, NotificationController.markAsRead);

module.exports = router;
