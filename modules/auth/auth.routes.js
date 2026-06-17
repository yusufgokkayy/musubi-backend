const express = require('express');
const AuthController = require('./auth.controller');
const { protect } = require('../../middlewares/auth.middleware');
const { isEmailVerified } = require('../../middlewares/auth.middleware');

const router = express.Router();

router.post('/register',        AuthController.register);
router.post('/login',           AuthController.login);
router.post('/logout',          protect, AuthController.logout);
router.post('/refresh', AuthController.refresh);
router.get('/me',               protect, isEmailVerified, AuthController.getMe);
router.post('/forgot-password', AuthController.forgotPassword);
router.post('/reset-password',  AuthController.resetPassword);
router.get('/verify-email/:token', AuthController.verifyEmail);
router.put('/update-info',      protect, isEmailVerified, AuthController.updateInfo);
router.post('/resend-verification-email', AuthController.resendVerificationEmail);
router.put('/change-password', protect, isEmailVerified, AuthController.changePassword);
router.delete('/delete-account', protect, isEmailVerified, AuthController.deleteAccount);


module.exports = router;