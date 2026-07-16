const catchAsync = require('../../utils/catchAsync');
const AuthService = require('./auth.service');

const AuthController = {
    checkEmail: catchAsync(async (req, res) => {
        const { available } = await AuthService.checkEmail(req.body.email);
        res.status(200).json({ success: true, available });
    }),

    socialLogin: catchAsync(async (req, res) => {
        const { provider, idToken, name, surname } = req.body;
        const deviceName = req.body.deviceName || req.headers['user-agent'];
        const { user, accessToken, refreshToken, isNewUser } =
            await AuthService.socialLogin({ provider, idToken, name, surname, deviceName });
        res.status(isNewUser ? 201 : 200).json({
            success: true,
            accessToken,
            refreshToken,
            isNewUser,
            isEmailVerified: true,
            data: { id: user._id, name: user.name }
        });
    }),

    register: catchAsync(async (req, res) => {
        const { name, surname, email, password } = req.body;
        const deviceName = req.body.deviceName || req.headers['user-agent'];
        const { user, accessToken, refreshToken, verificationToken } = await AuthService.register({ name, surname, email, password, deviceName });
        res.status(201).json({
            success: true,
            accessToken,
            refreshToken,
            ...(process.env.NODE_ENV !== 'production' && { verificationToken }),
            data: { id: user._id, name: user.name }
        });
    }),

    login: catchAsync(async (req, res) => {
        const { email, password } = req.body;
        const deviceName = req.body.deviceName || req.headers['user-agent'];
        const { user, accessToken, refreshToken, isEmailVerified } = await AuthService.login(email, password, deviceName);
        res.status(200).json({
            success: true,
            accessToken,
            refreshToken,
            isEmailVerified,
            data: { id: user._id, name: user.name }
        });
    }),

    logout: catchAsync(async (req, res) => {
        // refreshToken verilirse sadece bu cihaz, verilmezse tüm cihazlar
        await AuthService.logout(req.user.id, req.body?.refreshToken);
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
            ...(process.env.NODE_ENV !== 'production' && { resetToken })
        });
    }),

    resetPassword: catchAsync(async (req, res) => {
        // deviceName BİLEREK yalnızca body'den okunur (user-agent fallback'i yok):
        // web landing sayfası deviceName göndermez ve tarayıcıya oturum açılmaz;
        // uygulama deviceName gönderir ve login sözleşmesiyle taze çift alır
        const { token, password, deviceName } = req.body;
        const result = await AuthService.resetPassword(token, password, deviceName);
        res.status(200).json({ success: true, data: result });
    }),

    updateInfo: catchAsync(async (req, res) => {
        const user = await AuthService.updateInfo(req.user.id, req.body);
        res.status(200).json({ success: true, data: user });
    }),

    verifyEmail: catchAsync(async (req, res) => {
        const result = await AuthService.verifyEmail(req.params.token, req.headers['user-agent']);
        res.status(200).json({ success: true, data: result });
    }),

    // Landing sayfası + uygulama için POST varyantı. deviceName gönderilirse
    // (uygulama) oturum açılıp token çifti döner; gönderilmezse (web) yalnızca
    // doğrulama yapılır — mail istemcisi tarayıcısına token/oturum üretilmez
    verifyEmailPost: catchAsync(async (req, res) => {
        const { token, deviceName } = req.body;
        const result = await AuthService.verifyEmail(token, deviceName);
        res.status(200).json({ success: true, data: result });
    }),

    resendVerificationEmail: catchAsync(async (req, res) => {
        await AuthService.resendVerificationEmail(req.body.email);
        res.status(200).json({ success: true, message: 'Verification email sent' });
    }),

    verifyPassword: catchAsync(async (req, res) => {
        await AuthService.verifyPassword(req.user.id, req.body.password);
        res.status(200).json({ success: true, message: 'Password verified' });
    }),

    changePassword: catchAsync(async (req, res) => {
        const { oldPassword, newPassword } = req.body;
        const deviceName = req.body.deviceName || req.headers['user-agent'];
        const tokens = await AuthService.changePassword(req.user.id, oldPassword, newPassword, deviceName);
        // Diğer cihazların oturumları kapandı; bu cihaz için taze token çifti döner
        res.status(200).json({ success: true, message: 'Password changed successfully', data: tokens });
    }),

    deleteAccount: catchAsync(async (req, res) => {
        // Şifreli hesap password, şifresiz sosyal hesap idToken gönderir
        await AuthService.deleteAccount(req.user.id, req.body);
        res.status(200)
            .cookie('access_token', '', { httpOnly: true, expires: new Date(0) })
            .json({ success: true, message: 'Account deleted' });
    }),
};

module.exports = AuthController;