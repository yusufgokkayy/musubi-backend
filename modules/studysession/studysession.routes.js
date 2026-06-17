const express = require('express');
const StudySessionController = require('./studysession.controller');
const { protect, isEmailVerified } = require('../../middlewares/auth.middleware');

const router = express.Router();

router.post('/start',       protect, isEmailVerified, StudySessionController.startSession);
router.put('/update',       protect, isEmailVerified, StudySessionController.updateSession);
router.put('/complete',     protect, isEmailVerified, StudySessionController.completeSession);
router.get('/today',        protect, isEmailVerified, StudySessionController.getTodaySession);
router.get('/history',      protect, isEmailVerified, StudySessionController.getSessionHistory);

module.exports = router;