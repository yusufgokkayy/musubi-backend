const express = require('express');
const WordController = require('./word.controller');
const { protect } = require('../../middlewares/auth.middleware');
const { isAdmin } = require('../../middlewares/auth.middleware');
const { uploadAudioBatch } = require('../../middlewares/upload.middleware');

const router = express.Router();

// Kullanıcı endpointleri
router.get('/',         WordController.getAllWords);
router.get('/:id',      WordController.getWordById);

// Toplu ses yükleme (kelime + örnek cümle). Yalnızca admin; gönderici:
// scripts/import-audio.js. uploadLimiter (60/15dk) BİLEREK yok: 11.600 dosya
// 50'şerli ~230 istekte gelir, o sınır yüklemeyi bir saate yayardı. Genel
// sınır (300/15dk) yine geçerli ve tek seferde bitmesine yetiyor.
router.post('/audio', isAdmin, uploadAudioBatch, WordController.uploadAudio);

// Admin endpointleri
// router.post('/',        protect, isAdmin, WordController.createWord);
// router.put('/:id',      protect, isAdmin, WordController.updateWord);
// router.delete('/:id',   protect, isAdmin, WordController.deleteWord);

module.exports = router;