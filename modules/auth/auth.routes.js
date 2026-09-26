const express = require('express');
const AuthController = require('./auth.controller');
const { protect, optionalAuth } = require('../../middlewares/auth.middleware');
const { isEmailVerified } = require('../../middlewares/auth.middleware');
const { authLimiter, usernameCheckLimiter } = require('../../middlewares/rateLimiter');

const router = express.Router();

router.post('/check-email',     authLimiter, AuthController.checkEmail);
// "Kişisel Bilgiler" ekranı yazarken sorar — kayıttan önce, yani oturumsuz.
// optionalAuth: girişli kullanıcı (profil düzenleme) kendi mevcut adını
// "alınmış" görmesin
router.post('/check-username',  usernameCheckLimiter, optionalAuth, AuthController.checkUsername);
router.post('/register',        authLimiter, AuthController.register);
router.post('/login',           authLimiter, AuthController.login);
router.post('/social',          authLimiter, AuthController.socialLogin);
// optionalAuth BİLEREK: süresi dolmuş access token'la gelen çıkış isteği
// protect altında 401 alıyordu ve oturum kapanamıyordu (bkz. AuthService.logout)
router.post('/logout',          optionalAuth, AuthController.logout);
router.post('/refresh', AuthController.refresh);
// Push token'ını siler. isEmailVerified BİLEREK yok: e-posta değişip doğrulama
// düşse bile kullanıcı bildirim kaydını kaldırabilmeli.
router.delete('/fcm-token',     protect, AuthController.clearFcmToken);
router.get('/me',               protect, isEmailVerified, AuthController.getMe);
// Doğrulama bekleme ekranının sorduğu durum ucu — isEmailVerified YOK,
// çünkü tam da doğrulanmamış kullanıcı için var
router.get('/verification-status', protect, AuthController.getVerificationStatus);
// Yürürlükteki metin sürümleri — oturumsuz da çağrılabilir (giriş ekranı).
// Oturum varsa kullanıcının rıza durumu ve yeniden onay gerekip gerekmediği eklenir.
router.get('/consents',         optionalAuth, AuthController.getConsents);
// Sürüm yükseltmesi sonrası yeniden rıza. isEmailVerified BİLEREK yok:
// doğrulamayı bekleyen kullanıcı da yeni metne rıza verebilmeli.
router.put('/consents',         protect, AuthController.acceptConsents);
router.post('/forgot-password', authLimiter, AuthController.forgotPassword);
router.post('/reset-password',  authLimiter, AuthController.resetPassword);
router.get('/verify-email/:token', authLimiter, AuthController.verifyEmail);
router.post('/verify-email',    authLimiter, AuthController.verifyEmailPost);
router.put('/update-info',      protect, isEmailVerified, AuthController.updateInfo);
router.post('/resend-verification-email', authLimiter, AuthController.resendVerificationEmail);
router.post('/verify-password', protect, isEmailVerified, authLimiter, AuthController.verifyPassword);
router.put('/change-password', protect, isEmailVerified, authLimiter, AuthController.changePassword);
router.delete('/delete-account', protect, isEmailVerified, AuthController.deleteAccount);


module.exports = router;