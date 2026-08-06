const express = require('express');
const QuizController = require('./quiz.controller');
// protect + isEmailVerified app.js'te mount seviyesinde uygulanır

const router = express.Router();

router.get('/status',       QuizController.getStatus);
router.post('/start',       QuizController.start);
router.post('/:id/answer',  QuizController.answerQuestion);

module.exports = router;
