const express = require('express');
const MemoryController = require('./memory.controller');

const router = express.Router();

// Hafıza sekmesinin tamamı: seviye kartı + beş kutu + haftalık çip.
// Kapsam varsayılan olarak kullanıcının aktif seviyesidir (?jlptLevel ile
// başka bir seviyeye de bakılabilir).
router.get('/',      MemoryController.getMemory);
// Seçili kutunun kelime listesi ("Zayıf Kutusundakiler" → "Tümünü Gör")
router.get('/words', MemoryController.getBoxWords);

module.exports = router;
