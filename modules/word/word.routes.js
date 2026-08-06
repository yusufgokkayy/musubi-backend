const express = require('express');
const WordController = require('./word.controller');
const { protect } = require('../../middlewares/auth.middleware');
const { isAdmin } = require('../../middlewares/auth.middleware');

const router = express.Router();

// Kullanıcı endpointleri
router.get('/',         WordController.getAllWords);
router.get('/search',   WordController.searchWords);
router.get('/:id',      WordController.getWordById);

// Admin endpointleri
// router.post('/',        protect, isAdmin, WordController.createWord);
// router.put('/:id',      protect, isAdmin, WordController.updateWord);
// router.delete('/:id',   protect, isAdmin, WordController.deleteWord);

module.exports = router;