const express = require('express');
const WordController = require('./word.controller');
const { protect, isEmailVerified } = require('../../middlewares/auth.middleware');
const { isAdmin } = require('../../middlewares/auth.middleware');

const router = express.Router();

// Kullanıcı endpointleri
router.get('/',         protect, isEmailVerified, WordController.getAllWords);
router.get('/search',   protect, isEmailVerified, WordController.searchWords);
router.get('/:id',      protect, isEmailVerified, WordController.getWordById);

// Admin endpointleri
router.post('/',        protect, isAdmin, WordController.createWord);
router.put('/:id',      protect, isAdmin, WordController.updateWord);
router.delete('/:id',   protect, isAdmin, WordController.deleteWord);

module.exports = router;