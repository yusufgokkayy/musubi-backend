const express = require('express');
const UploadController = require('./upload.controller');
const { isAdmin } = require('../../middlewares/auth.middleware');
const { uploadSingleImage } = require('../../middlewares/upload.middleware');
const { uploadLimiter } = require('../../middlewares/rateLimiter');

const router = express.Router();

// Giriş + doğrulanmış e-posta app.js'te mount seviyesinde uygulanır; buraya
// yalnızca adminlik eklenir. Bu router'daki HER uç admin gerektirir — tek tek
// değil router seviyesinde yazılır ki yeni bir uç eklenirken unutulamasın.
router.use(isAdmin);

// Yükleme ayrı ve sıkı limitle korunur: genel 300/15dk limiti burada anlamsız,
// tek istek 5 MB gövde + sharp ile CPU harcıyor. Bu, yetkili bir hesabın
// (veya çalınmış bir admin token'ının) sunucuyu yormasının önündeki tek engel.
router.post('/', uploadLimiter, uploadSingleImage, UploadController.uploadImage);
router.delete('/', uploadLimiter, UploadController.deleteImage);

module.exports = router;
