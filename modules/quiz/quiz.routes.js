const express = require('express');
const QuizController = require('./quiz.controller');
// protect + isEmailVerified app.js'te mount seviyesinde uygulanır

const router = express.Router();

router.get('/status',       QuizController.getStatus);
router.post('/start',       QuizController.start);
// Anasayfa modalındaki "Daha Sonra" — modal bir daha çıkmaz
router.post('/placement/defer', QuizController.defer);
router.post('/:id/answer',  QuizController.answerQuestion);
// Sınavdan çıkış: yarım deneme geçersiz sayılır, sonraki girişte baştan başlanır
router.post('/:id/abandon', QuizController.abandon);

module.exports = router;
