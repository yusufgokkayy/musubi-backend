const express = require('express');
const StreakController = require('./streak.controller');
const { protect, isEmailVerified } = require('../../middlewares/auth.middleware');

const router = express.Router();

router.get('/',     protect, isEmailVerified, StreakController.getStreak);
router.put('/update', protect, isEmailVerified, StreakController.updateStreak);

module.exports = router;