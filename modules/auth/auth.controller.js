const catchAsync = require('../../utils/catchAsync');
const AuthService = require('./auth.service');

const AuthController = {
    register: catchAsync(async (req, res) => {
        const { name, surname, email, password } = req.body;
        const { user, accessToken, refreshToken, verificationToken } = await AuthService.register({ name, surname, email, password });
        res.status(201).json({
            success: true,
            accessToken,
            refreshToken,
            verificationToken, // production'da kaldır
            data: { id: user._id, name: user.name }
        });
    }),

    login: catchAsync(async (req, res) => {
        const { email, password } = req.body;
        const { user, accessToken, refreshToken, isEmailVerified } = await AuthService.login(email, password);
        res.status(200).json({
            success: true,
            accessToken,
            refreshToken,
            isEmailVerified,
            data: { id: user._id, name: user.name }
        });
    }),

    logout: catchAsync(async (req, res) => {
        await AuthService.logout(req.user.id);
        res.status(200)
            .cookie('access_token', '', { httpOnly: true, expires: new Date(0) })
            .json({ success: true, message: 'Logged out' });
    }),

    refresh: catchAsync(async (req, res) => {
        const { refreshToken } = req.body;
        const result = await AuthService.refresh(refreshToken);
        res.status(200).json({ success: true, data: result });
    }),

    getMe: catchAsync(async (req, res) => {
        res.status(200).json({
            success: true,
            data: req.user
        });
    }),

    forgotPassword: catchAsync(async (req, res) => {
        const { resetToken } = await AuthService.forgotPassword(req.body.email);
        res.status(200).json({ 
            success: true, 
            message: 'Password reset email sent',
            resetToken // geçici test için
        });
    }),

    resetPassword: catchAsync(async (req, res) => {
        const { token, password } = req.body;
        const result = await AuthService.resetPassword(token, password);
        res.status(200).json({ success: true, data: result });
    }),

    updateInfo: catchAsync(async (req, res) => {
        const user = await AuthService.updateInfo(req.user.id, req.body);
        res.status(200).json({ success: true, data: user });
    }),

    verifyEmail: catchAsync(async (req, res) => {
        const result = await AuthService.verifyEmail(req.params.token);
        res.status(200).json({ success: true, data: result });
    }),

    resendVerificationEmail: catchAsync(async (req, res) => {
        await AuthService.resendVerificationEmail(req.body.email);
        res.status(200).json({ success: true, message: 'Verification email sent' });
    }),

    changePassword: catchAsync(async (req, res) => {
        const { oldPassword, newPassword } = req.body;
        await AuthService.changePassword(req.user.id, oldPassword, newPassword);
        res.status(200).json({ success: true, message: 'Password changed successfully' });
    }),

    deleteAccount: catchAsync(async (req, res) => {
        await AuthService.deleteAccount(req.user.id, req.body.password);
        res.status(200)
            .cookie('access_token', '', { httpOnly: true, expires: new Date(0) })
            .json({ success: true, message: 'Account deleted' });
    }),
};

module.exports = AuthController;