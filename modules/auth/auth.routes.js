const express = require('express');
const AuthController = require('./auth.controller');
const { protect } = require('../../middlewares/auth.middleware');
const { isEmailVerified } = require('../../middlewares/auth.middleware');
const { authLimiter } = require('../../middlewares/rateLimiter');

const router = express.Router();

router.post('/check-email',     authLimiter, AuthController.checkEmail);
router.post('/register',        authLimiter, AuthController.register);
router.post('/login',           authLimiter, AuthController.login);
router.post('/social',          authLimiter, AuthController.socialLogin);
router.post('/logout',          protect, AuthController.logout);
router.post('/refresh', AuthController.refresh);
router.get('/me',               protect, isEmailVerified, AuthController.getMe);
router.post('/forgot-password', authLimiter, AuthController.forgotPassword);
router.post('/reset-password',  authLimiter, AuthController.resetPassword);
router.get('/verify-email/:token', AuthController.verifyEmail);
router.post('/verify-email',    authLimiter, AuthController.verifyEmailPost);
router.put('/update-info',      protect, isEmailVerified, AuthController.updateInfo);
router.post('/resend-verification-email', authLimiter, AuthController.resendVerificationEmail);
router.post('/verify-password', protect, isEmailVerified, authLimiter, AuthController.verifyPassword);
router.put('/change-password', protect, isEmailVerified, authLimiter, AuthController.changePassword);
router.delete('/delete-account', protect, isEmailVerified, AuthController.deleteAccount);


module.exports = router;