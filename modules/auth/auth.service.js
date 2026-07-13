const User = require('../../models/User');
const UserWord = require('../../models/UserWord');
const Progress = require('../../models/Progress');
const Streak = require('../../models/Streak');
const StudySession = require('../../models/StudySession');
const DailyWordPool = require('../../models/DailyWordPool');
const Notification = require('../../models/Notification');
const QuizAttempt = require('../../models/QuizAttempt');
const DeviceSession = require('../../models/DeviceSession');
const AppError = require('../../utils/AppError');
const sendEmail = require('../../utils/sendEmail');
const crypto = require('crypto');
const ProgressService = require('../progress/progress.service');
const StreakService = require('../streak/streak.service');
const { signAccessToken, signRefreshToken, verifyRefreshToken } = require('../../utils/jwt.util');
const verifySocialToken = require('../../utils/socialAuth');
const { safeTimezone } = require('../../utils/date.util');
const Event = require('../../models/Event');
const logEvent = require('../../utils/event.util');

const MAX_SESSIONS_PER_USER = 5;

const hashToken = (token) =>
    crypto.createHash('sha256').update(token).digest('hex');

// Yeni cihaz oturumu aç; kullanıcı başına en fazla 5 oturum (en eskisi düşer)
const createSession = async (userId, refreshToken, deviceName) => {
    const count = await DeviceSession.countDocuments({ user: userId });
    if (count >= MAX_SESSIONS_PER_USER) {
        const oldest = await DeviceSession.find({ user: userId })
            .sort({ lastUsedAt: 1 })
            .limit(count - MAX_SESSIONS_PER_USER + 1);
        await DeviceSession.deleteMany({ _id: { $in: oldest.map(s => s._id) } });
    }
    await DeviceSession.create({
        user: userId,
        tokenHash: hashToken(refreshToken),
        deviceName: deviceName || 'Bilinmeyen cihaz'
    });
};

// Şifre değişimi/sıfırlama sonrası tüm oturumları kapatıp mevcut cihaz için
// taze bir token çifti üretir
const rotateAllSessions = async (userId, deviceName) => {
    await DeviceSession.deleteMany({ user: userId });
    const accessToken = signAccessToken(userId);
    const refreshToken = signRefreshToken(userId);
    await createSession(userId, refreshToken, deviceName);
    return { accessToken, refreshToken };
};


const AuthService = {
    // Onboarding e-posta adımı: ad-soyad/şifre ekranlarına geçmeden önce
    // client adresin biçimini ve müsaitliğini burada öğrenir
    async checkEmail(email) {
        // User modelindeki e-posta regex'i ile aynı desen
        if (!email || !/^[\w-\.]+@([\w-]+\.)+[\w-]{2,}$/.test(email)) {
            throw new AppError('Geçerli bir e-posta adresi girin', 400);
        }
        const exists = await User.exists({ email });
        return { available: !exists };
    },

    async register({ name, surname, email, password, deviceName }) {
        const user = await User.create({ name, surname, email, password });

        const verificationToken = crypto.randomBytes(20).toString('hex');
        user.emailVerificationToken = crypto
            .createHash('sha256')
            .update(verificationToken)
            .digest('hex');
        user.emailVerificationExpire = Date.now() + 24 * 60 * 60 * 1000;

        const accessToken = signAccessToken(user._id);
        const refreshToken = signRefreshToken(user._id);

        await user.save();

        // E-posta gönderimi, yan kayıtlar (Progress/Streak/oturum) oluşmadan ÖNCE
        // denenir: başarısızlıkta yalnızca User silinir, yetim doküman kalmaz.
        try {
            const verificationUrl = `${process.env.CLIENT_URL}/api/auth/verify-email/${verificationToken}`;
            await sendEmail({
                to: email,
                subject: 'Musubi - Email Doğrulama',
                html: `<p>Hesabını doğrulamak için <a href="${verificationUrl}">tıkla</a>. Link 24 saat geçerli.</p>`
            });
        } catch (err) {
            await User.findByIdAndDelete(user._id);
            throw new AppError('Email gönderilemedi, tekrar deneyin', 500);
        }

        await ProgressService.initializeProgress(user._id);
        await StreakService.initializeStreak(user._id);
        await createSession(user._id, refreshToken, deviceName);
        logEvent(user._id, 'register');

        return { user, accessToken, refreshToken, verificationToken };
    },

    async login(email, password, deviceName) {
        const user = await User.findOne({ email }).select('+password');
        if (!user) throw new AppError('Invalid credentials', 401);

        const isMatch = await user.comparePassword(password);
        if (!isMatch) throw new AppError('Invalid credentials', 401);

        const accessToken = signAccessToken(user._id);
        const refreshToken = signRefreshToken(user._id);

        await createSession(user._id, refreshToken, deviceName);
        logEvent(user._id, 'login', { deviceName });

        return {
            user,
            accessToken,
            refreshToken,
            isEmailVerified: user.isEmailVerified
        };
    },

    // Google/Apple ile giriş: hesap yoksa oluşturur (isNewUser: true), varsa
    // giriş yapar. Aynı e-postayla local hesap varsa sosyal hesaba bağlanır —
    // sağlayıcı e-posta sahipliğini zaten doğruladığı için bu güvenlidir.
    async socialLogin({ provider, idToken, name, surname, deviceName }) {
        const profile = await verifySocialToken(provider, idToken);

        // Doğrulanmamış e-postayla hesap bağlama/oluşturma, hesap ele
        // geçirmeye kapı açar
        if (!profile.emailVerified) {
            throw new AppError('Sosyal hesabınızın e-postası doğrulanmamış', 400);
        }

        let user = await User.findOne({ provider, providerId: profile.providerId });
        let isNewUser = false;

        if (!user) {
            user = await User.findOne({ email: profile.email });
            if (user) {
                user.provider = provider;
                user.providerId = profile.providerId;
                user.isEmailVerified = true;
                await user.save();
            }
        }

        if (!user) {
            user = await User.create({
                // Apple ad bilgisini token'da değil ilk girişte ayrıca gönderir;
                // client iletirse body'den, yoksa token'dan, o da yoksa e-postadan
                name: name || profile.name || profile.email.split('@')[0],
                surname: surname || profile.surname || '',
                email: profile.email,
                provider,
                providerId: profile.providerId,
                isEmailVerified: true // sağlayıcı doğruladı, mail akışı gerekmez
            });
            await ProgressService.initializeProgress(user._id);
            await StreakService.initializeStreak(user._id);
            isNewUser = true;
        }

        const accessToken = signAccessToken(user._id);
        const refreshToken = signRefreshToken(user._id);
        await createSession(user._id, refreshToken, deviceName);
        logEvent(user._id, isNewUser ? 'register' : 'login', { provider, deviceName });

        return { user, accessToken, refreshToken, isNewUser };
    },

    async refresh(refreshToken) {
        if (!refreshToken) throw new AppError('No refresh token', 401);

        const decoded = verifyRefreshToken(refreshToken);
        const session = await DeviceSession.findOne({
            user: decoded.id,
            tokenHash: hashToken(refreshToken)
        });

        if (!session) throw new AppError('Invalid refresh token', 401);

        session.lastUsedAt = new Date();
        await session.save();

        const accessToken = signAccessToken(decoded.id);
        return { accessToken };
    },

    // refreshToken verilirse sadece o cihazın oturumu, verilmezse tüm oturumlar kapanır
    async logout(userId, refreshToken) {
        if (refreshToken) {
            await DeviceSession.deleteOne({ user: userId, tokenHash: hashToken(refreshToken) });
        } else {
            await DeviceSession.deleteMany({ user: userId });
        }
    },

    async forgotPassword(email) {
        const user = await User.findOne({ email });
        // E-posta enumeration koruması: kayıt yoksa da başarılı gibi dön.
        // Doğrulanmamış hesap da sıfırlayabilir — maildeki linke tıklamak
        // zaten adres sahipliğini kanıtlar; 403 dönmek hem hesap varlığını
        // sızdırır hem de kullanıcıyı çıkmaza sokar.
        if (!user) return {};

        const resetToken = crypto.randomBytes(20).toString('hex');
        user.resetPasswordToken = crypto
            .createHash('sha256')
            .update(resetToken)
            .digest('hex');
        // Fallback 1 saat: env unset ise parseInt NaN üretir ve token anında geçersiz olurdu
        user.resetPasswordExpire = Date.now() + (parseInt(process.env.RESET_PASSWORD_EXPIRE) || 3600000);
        await user.save();

        try {
            const resetUrl = `${process.env.CLIENT_URL}/api/auth/reset-password/${resetToken}`;
            await sendEmail({
                to: email,
                subject: 'Musubi - Şifre Sıfırlama',
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

    async resetPassword(resetToken, newPassword, deviceName) {
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

        // Güvenlik: şifre sıfırlanınca tüm eski oturumlar kapanır
        const tokens = await rotateAllSessions(user._id, deviceName);
        return tokens; // { accessToken, refreshToken } — login ile aynı sözleşme
    },

    async updateInfo(userId, updates) {
        const user = await User.findById(userId);
        if (!user) throw new AppError('User not found', 404);

        if (updates.name) user.name = updates.name;
        if (updates.surname) user.surname = updates.surname;

        // E-posta değişiyorsa doğrulama sıfırlanır ve yeni adrese doğrulama maili gider
        if (updates.email && updates.email !== user.email) {
            const emailTaken = await User.findOne({ email: updates.email });
            if (emailTaken) throw new AppError('Bu e-posta adresi zaten kullanımda', 400);

            const verificationToken = crypto.randomBytes(20).toString('hex');

            try {
                const verificationUrl = `${process.env.CLIENT_URL}/api/auth/verify-email/${verificationToken}`;
                await sendEmail({
                    to: updates.email,
                    subject: 'Musubi - Yeni E-posta Doğrulama',
                    html: `<p>Yeni e-posta adresini doğrulamak için <a href="${verificationUrl}">tıkla</a>. Link 24 saat geçerli.</p>`
                });
            } catch (err) {
                throw new AppError('Doğrulama maili gönderilemedi, e-posta değiştirilmedi', 500);
            }

            user.email = updates.email;
            user.isEmailVerified = false;
            user.emailVerificationToken = crypto
                .createHash('sha256')
                .update(verificationToken)
                .digest('hex');
            user.emailVerificationExpire = Date.now() + 24 * 60 * 60 * 1000;
        }

        if (updates.password) user.password = updates.password;
        if (updates.dailyGoal) user.dailyGoal = updates.dailyGoal;
        if (updates.fcmToken) user.fcmToken = updates.fcmToken;
        if (updates.timezone) user.timezone = safeTimezone(updates.timezone);
        if (updates.notificationSettings) {
            user.notificationSettings = {
                ...user.notificationSettings,
                ...updates.notificationSettings
            };
        }
        // Dil/Tema/Font kısmi güncellenir; geçersiz değerleri enum validasyonu 400'e çevirir.
        // isPremium burada BİLEREK yok: yalnızca satın alma doğrulaması set edebilir.
        if (updates.preferences) {
            user.preferences = {
                ...user.preferences?.toObject?.() ?? user.preferences,
                ...updates.preferences
            };
        }

        await user.save();
        return user;
    },

    async verifyEmail(verificationToken, deviceName) {
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

        // Login ile aynı token sözleşmesi: access + refresh çifti
        const accessToken = signAccessToken(user._id);
        const refreshToken = signRefreshToken(user._id);
        await createSession(user._id, refreshToken, deviceName);

        return { accessToken, refreshToken };
    },

    async resendVerificationEmail(email) {
        const user = await User.findOne({ email });
        // E-posta enumeration koruması: kayıt yoksa veya zaten doğrulanmışsa
        // da sessizce başarılı dön (forgot-password ile aynı davranış)
        if (!user || user.isEmailVerified) return;

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
                subject: 'Musubi - Email Doğrulama',
                html: `<p>Hesabını doğrulamak için <a href="${verificationUrl}">tıkla</a>. Link 24 saat geçerli.</p>`
            });
        } catch (err) {
            throw new AppError('Email gönderilemedi, tekrar deneyin', 500);
        }
    },

    // Ayarlardaki adım adım şifre değiştirme akışının ilk ekranı: mevcut şifre
    // doğrulanmadan yeni şifre ekranına geçilmez ("Şifreniz yanlış" durumu burada)
    async verifyPassword(userId, password) {
        const user = await User.findById(userId).select('+password');
        if (!user) throw new AppError('User not found', 404);

        if (!user.password) {
            throw new AppError('Bu hesap sosyal girişle açılmış; şifre belirlemek için şifre sıfırlama akışını kullanın', 400);
        }

        const isMatch = await user.comparePassword(password);
        if (!isMatch) throw new AppError('Şifreniz yanlış. Lütfen tekrar deneyin.', 401);
    },

    async changePassword(userId, oldPassword, newPassword, deviceName) {
        const user = await User.findById(userId).select('+password');
        if (!user) throw new AppError('User not found', 404);

        // Sosyal hesabın şifresi yoktur; şifre belirlemek isterse forgot-password akışını kullanır
        if (!user.password) {
            throw new AppError('Bu hesap sosyal girişle açılmış; şifre belirlemek için şifre sıfırlama akışını kullanın', 400);
        }

        const isMatch = await user.comparePassword(oldPassword);
        if (!isMatch) throw new AppError('Old password is incorrect', 401);

        user.password = newPassword;
        await user.save();

        // Güvenlik: diğer tüm cihazların oturumları kapanır, bu cihaz taze çift alır
        return rotateAllSessions(userId, deviceName);
    },

    async deleteAccount(userId, { password, idToken } = {}) {
        const user = await User.findById(userId).select('+password');
        if (!user) throw new AppError('User not found', 404);

        // Silme onayı: şifreli hesap şifresiyle, şifresiz sosyal hesap taze idToken ile
        if (user.password) {
            const isMatch = await user.comparePassword(password);
            if (!isMatch) throw new AppError('Password is incorrect', 401);
        } else {
            const profile = await verifySocialToken(user.provider, idToken);
            if (profile.providerId !== user.providerId) {
                throw new AppError('Kimlik doğrulanamadı', 401);
            }
        }

        // KVKK: kullanıcıya ait tüm veriler silinir
        await Promise.all([
            UserWord.deleteMany({ user: userId }),
            Progress.deleteMany({ user: userId }),
            Streak.deleteMany({ user: userId }),
            StudySession.deleteMany({ user: userId }),
            DailyWordPool.deleteMany({ user: userId }),
            Notification.deleteMany({ user: userId }),
            QuizAttempt.deleteMany({ user: userId }),
            DeviceSession.deleteMany({ user: userId }),
            Event.deleteMany({ user: userId })
        ]);

        await User.findByIdAndDelete(userId);
    },
};

module.exports = AuthService;