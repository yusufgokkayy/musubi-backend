const express = require('express');
const QuizController = require('./quiz.controller');
const { protect, isEmailVerified } = require('../../middlewares/auth.middleware');

const router = express.Router();

router.get('/status',       protect, isEmailVerified, QuizController.getStatus);
router.post('/start',       protect, isEmailVerified, QuizController.start);
router.post('/:id/answer',  protect, isEmailVerified, QuizController.answerQuestion);

module.exports = router;
