const express = require('express');
const UserWordController = require('./userword.controller');
const { protect, isEmailVerified } = require('../../middlewares/auth.middleware');

const router = express.Router();

router.get('/today',    protect, isEmailVerified, UserWordController.getTodayWords);
router.get('/stats',    protect, isEmailVerified, UserWordController.getUserStats);
router.post('/answer',  protect, isEmailVerified, UserWordController.submitAnswer);
router.get('/mistakes', protect, isEmailVerified, UserWordController.getTodayMistakes);

module.exports = router;