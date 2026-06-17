const express = require('express');
const ProgressController = require('./progress.controller');
const { protect, isEmailVerified } = require('../../middlewares/auth.middleware');

const router = express.Router();

router.get('/',             protect, isEmailVerified, ProgressController.getProgress);
router.post('/check',       protect, isEmailVerified, ProgressController.checkAndUnlock);

module.exports = router;