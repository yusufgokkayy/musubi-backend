const express = require('express');
const UserController = require('./user.controller');
const { uploadSingleImage } = require('../../middlewares/upload.middleware');
const { avatarLimiter } = require('../../middlewares/rateLimiter');

// Giriş + doğrulanmış e-posta app.js'te mount seviyesinde uygulanır.
// Doğrulanmamış hesap dosya YÜKLEYEMEZ: bu hesaplar 7 gün sonra silinir ve
// açık kalsaydı sahte kayıtlarla depolama doldurulabilirdi. Kayıt ekranında
// seçilen fotoğrafı istemci doğrulama tamamlanınca yükler.
const router = express.Router();

router.put('/me/avatar', avatarLimiter, uploadSingleImage, UserController.setAvatar);
router.delete('/me/avatar', avatarLimiter, UserController.removeAvatar);

module.exports = router;
