const User = require('../../models/User');
const AppError = require('../../utils/AppError');
const sendEmail = require('../../utils/sendEmail');
const crypto = require('crypto');
const ProgressService = require('../progress/progress.service');
const StreakService = require('../streak/streak.service');
const { signAccessToken, signRefreshToken, verifyRefreshToken } = require('../../utils/jwt.util');


const AuthService = {
    async register({ name, surname, email, password }) {
        const user = await User.create({ name, surname, email, password });
        await ProgressService.initializeProgress(user._id);
        await StreakService.initializeStreak(user._id);

        const verificationToken = crypto.randomBytes(20).toString('hex');
        user.emailVerificationToken = crypto
            .createHash('sha256')
            .update(verificationToken)
            .digest('hex');
        user.emailVerificationExpire = Date.now() + 24 * 60 * 60 * 1000;

        const accessToken = signAccessToken(user._id);
        const refreshToken = signRefreshToken(user._id);
        user.refreshToken = refreshToken;

        await user.save();

        try {
            const verificationUrl = `${process.env.CLIENT_URL}/api/auth/verify-email/${verificationToken}`;
            await sendEmail({
                to: email,
                subject: 'Kotoba - Email Doğrulama',
                html: `<p>Hesabını doğrulamak için <a href="${verificationUrl}">tıkla</a>. Link 24 saat geçerli.</p>`
            });
        } catch (err) {
            await User.findByIdAndDelete(user._id);
            throw new AppError('Email gönderilemedi, tekrar deneyin', 500);
        }

        return { user, accessToken, refreshToken, verificationToken };
    },

    async login(email, password) {
        const user = await User.findOne({ email }).select('+password +refreshToken');
        if (!user) throw new AppError('Invalid credentials', 401);

        const isMatch = await user.comparePassword(password);
        if (!isMatch) throw new AppError('Invalid credentials', 401);

        const accessToken = signAccessToken(user._id);
        const refreshToken = signRefreshToken(user._id);

        user.refreshToken = refreshToken;
        await user.save();

        return {
            user,
            accessToken,
            refreshToken,
            isEmailVerified: user.isEmailVerified
        };
    },

    async refresh(refreshToken) {
        if (!refreshToken) throw new AppError('No refresh token', 401);

        const decoded = verifyRefreshToken(refreshToken);
        const user = await User.findById(decoded.id).select('+refreshToken');

        if (!user || user.refreshToken !== refreshToken) {
            throw new AppError('Invalid refresh token', 401);
        }

        const accessToken = signAccessToken(user._id);
        return { accessToken };
    },

    async logout(userId) {
        await User.findByIdAndUpdate(userId, { refreshToken: undefined });
    },

    async forgotPassword(email) {
        const user = await User.findOne({ email });
        if (!user) throw new AppError('No user with that email', 404);

        const resetToken = crypto.randomBytes(20).toString('hex');
        user.resetPasswordToken = crypto
            .createHash('sha256')
            .update(resetToken)
            .digest('hex');
        user.resetPasswordExpire = Date.now() + parseInt(process.env.RESET_PASSWORD_EXPIRE);
        await user.save();

        try {
            const resetUrl = `${process.env.CLIENT_URL}/api/auth/reset-password/${resetToken}`;
            await sendEmail({
                to: email,
                subject: 'Kotoba - Şifre Sıfırlama',
                html: `<p>Şifreni sıfırlamak için <a href="${resetUrl}">tıkla</a>. Link 1 saat geçerli.</p>`
            });
        } catch (err) {
            user.resetPasswordToken = undefined;
            user.resetPasswordExpire = undefined;
            await user.save();
            throw new AppError('Email gönderilemedi, tekrar deneyin', 500);
        }

        return { resetToken };
    },

    async resetPassword(resetToken, newPassword) {
        const hashedToken = crypto
            .createHash('sha256')
            .update(resetToken)
            .digest('hex');

        const user = await User.findOne({
            resetPasswordToken: hashedToken,
            resetPasswordExpire: { $gt: Date.now() }
        });

        if (!user) throw new AppError('Invalid or expired token', 400);

        user.password = newPassword;
        user.resetPasswordToken = undefined;
        user.resetPasswordExpire = undefined;
        await user.save();

        const token = user.generateJWT();
        return { token };
    },

    async updateInfo(userId, updates) {
        const user = await User.findById(userId);
        if (!user) throw new AppError('User not found', 404);

        if (updates.name) user.name = updates.name;
        if (updates.surname) user.surname = updates.surname;
        if (updates.email) user.email = updates.email;
        if (updates.password) user.password = updates.password;

        await user.save(); // pre-save hook çalışır, şifre hash'lenir
        return user;
    },

    async verifyEmail(verificationToken) {
        const hashedToken = crypto
            .createHash('sha256')
            .update(verificationToken)
            .digest('hex');

        const user = await User.findOne({
            emailVerificationToken: hashedToken,
            emailVerificationExpire: { $gt: Date.now() }
        });

        if (!user) throw new AppError('Invalid or expired token', 400);

        user.isEmailVerified = true;
        user.emailVerificationToken = undefined;
        user.emailVerificationExpire = undefined;
        await user.save();

        const token = user.generateJWT();
        return { token };
    },

    async resendVerificationEmail(email) {
        const user = await User.findOne({ email });
        if (!user) throw new AppError('No user with that email', 404);
        if (user.isEmailVerified) throw new AppError('Email already verified', 400);

        const verificationToken = crypto.randomBytes(20).toString('hex');
        user.emailVerificationToken = crypto
            .createHash('sha256')
            .update(verificationToken)
            .digest('hex');
        user.emailVerificationExpire = Date.now() + 24 * 60 * 60 * 1000;
        await user.save();

        try {
            const verificationUrl = `${process.env.CLIENT_URL}/api/auth/verify-email/${verificationToken}`;
            await sendEmail({
                to: email,
                subject: 'Kotoba - Email Doğrulama',
                html: `<p>Hesabını doğrulamak için <a href="${verificationUrl}">tıkla</a>. Link 24 saat geçerli.</p>`
            });
        } catch (err) {
            throw new AppError('Email gönderilemedi, tekrar deneyin', 500);
        }
    },

    async changePassword(userId, oldPassword, newPassword) {
        const user = await User.findById(userId).select('+password');
        if (!user) throw new AppError('User not found', 404);

        const isMatch = await user.comparePassword(oldPassword);
        if (!isMatch) throw new AppError('Old password is incorrect', 401);

        user.password = newPassword;
        await user.save();
    },

    async deleteAccount(userId, password) {
        const user = await User.findById(userId).select('+password');
        if (!user) throw new AppError('User not found', 404);

        const isMatch = await user.comparePassword(password);
        if (!isMatch) throw new AppError('Password is incorrect', 401);

        await User.findByIdAndDelete(userId);
    },
};

module.exports = AuthService;