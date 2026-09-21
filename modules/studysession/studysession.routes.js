const express = require('express');
const StudySessionController = require('./studysession.controller');
const { protect } = require('../../middlewares/auth.middleware');

const router = express.Router();

// PUT /update KALDIRILDI (21.09.2026): mobil hiç çağırmıyordu (kod tabanında
// tek satır bile geçmediği teyit edildi) ve kelime kontrolü olmadan günün
// sayaçlarını artırabiliyordu. Sayaçları yalnızca /userwords/answer günceller.
router.post('/start',       StudySessionController.startSession);
router.put('/complete',     StudySessionController.completeSession);
router.post('/next-pool',   StudySessionController.openNextPool);
router.get('/current',      StudySessionController.getCurrentRound);
router.get('/today',        StudySessionController.getTodaySession);
router.get('/history',      StudySessionController.getSessionHistory);

module.exports = router;