const express = require('express');
const AuthController = require('./auth.controller');
const { protect, optionalAuth } = require('../../middlewares/auth.middleware');
const { isEmailVerified } = require('../../middlewares/auth.middleware');
const { authLimiter } = require('../../middlewares/rateLimiter');
// Kayıt/giriş/mail gönderen açık uçlar: App Check (APP_CHECK_ENFORCE=true ile
// açılır; kapalıyken geçirgendir — bkz. middlewares/appCheck.js)
const { requireAppCheck } = require('../../middlewares/appCheck');

const router = express.Router();

router.post('/check-email',     authLimiter, requireAppCheck, AuthController.checkEmail);
router.post('/register',        authLimiter, requireAppCheck, AuthController.register);
router.post('/login',           authLimiter, requireAppCheck, AuthController.login);
router.post('/social',          authLimiter, requireAppCheck, AuthController.socialLogin);
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
router.post('/forgot-password', authLimiter, requireAppCheck, AuthController.forgotPassword);
router.post('/reset-password',  authLimiter, AuthController.resetPassword);
router.get('/verify-email/:token', authLimiter, AuthController.verifyEmail);
router.post('/verify-email',    authLimiter, AuthController.verifyEmailPost);
router.put('/update-info',      protect, isEmailVerified, AuthController.updateInfo);
router.post('/resend-verification-email', authLimiter, requireAppCheck, AuthController.resendVerificationEmail);
router.post('/verify-password', protect, isEmailVerified, authLimiter, AuthController.verifyPassword);
router.put('/change-password', protect, isEmailVerified, authLimiter, AuthController.changePassword);
router.delete('/delete-account', protect, isEmailVerified, AuthController.deleteAccount);


module.exports = router;