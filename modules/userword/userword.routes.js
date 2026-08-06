const express = require('express');
const UserWordController = require('./userword.controller');
const { protect } = require('../../middlewares/auth.middleware');

const router = express.Router();

router.get('/today',    UserWordController.getTodayWords);
router.get('/stats',    UserWordController.getUserStats);
router.post('/answer',  UserWordController.submitAnswer);
router.get('/mistakes', UserWordController.getTodayMistakes);
router.get('/list',     UserWordController.getWordList);

module.exports = router;