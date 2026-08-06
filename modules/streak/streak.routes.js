const express = require('express');
const StreakController = require('./streak.controller');
const { protect } = require('../../middlewares/auth.middleware');

const router = express.Router();

router.get('/',     StreakController.getStreak);
router.put('/update', StreakController.updateStreak);

module.exports = router;