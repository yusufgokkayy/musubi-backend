const express = require('express');
const StudySessionController = require('./studysession.controller');
const { protect } = require('../../middlewares/auth.middleware');

const router = express.Router();

router.post('/start',       StudySessionController.startSession);
router.put('/update',       StudySessionController.updateSession);
router.put('/complete',     StudySessionController.completeSession);
router.get('/today',        StudySessionController.getTodaySession);
router.get('/history',      StudySessionController.getSessionHistory);

module.exports = router;