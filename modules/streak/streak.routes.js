const express = require('express');
const StreakController = require('./streak.controller');
const { protect } = require('../../middlewares/auth.middleware');

const router = express.Router();

router.get('/',     StreakController.getStreak);
// PUT /update KALDIRILDI (26.09.2026): belgelenmemişti, hiçbir istemci
// çağırmıyordu ve çalışmadan seriyi sürdürmeye izin veriyordu. Seri yalnızca
// günün ilk gerçek cevabında (POST /userwords/answer) ilerler.

module.exports = router;