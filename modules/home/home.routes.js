const express = require('express');
const HomeController = require('./home.controller');
const { protect } = require('../../middlewares/auth.middleware');

const router = express.Router();

// Takvim/gün detayı uçları KALDIRILDI (21.09.2026): tasarımda takvim ekranı
// yok, anasayfadaki yedi günlük şerit zaten /summary içindeki streak.week'ten
// çiziliyor. Mobil tarafın hiç çağırmadığı da canlı loglarla teyit edildi.
router.get('/summary',  HomeController.getSummary);

module.exports = router;