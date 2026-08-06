const express = require('express');
const ProgressController = require('./progress.controller');
const { protect } = require('../../middlewares/auth.middleware');

const router = express.Router();

router.get('/',                 ProgressController.getProgress);
// Seviye kontrolü her cevapta otomatik yapılır; seviye atlama quiz akışından geçer:
// POST /api/quiz/start + POST /api/quiz/:id/answer
router.get('/:jlptLevel/distribution', ProgressController.getDistribution);

module.exports = router;