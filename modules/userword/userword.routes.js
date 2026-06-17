const express = require('express');
const UserWordController = require('./userword.controller');
const { protect, isEmailVerified } = require('../../middlewares/auth.middleware');

const router = express.Router();

router.get('/today',    protect, isEmailVerified, UserWordController.getTodayWords);
router.get('/stats',    protect, isEmailVerified, UserWordController.getUserStats);
router.post('/answer',  protect, isEmailVerified, UserWordController.submitAnswer);

module.exports = router;