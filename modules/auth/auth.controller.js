const catchAsync = require('../../utils/catchAsync');
const AuthService = require('./auth.service');
const UserService = require('../user/user.service');

// Giriş/kayıt yanıtlarının `data` bloğu. needsUsername true ise istemci ana
// ekrana geçmeden "Kişisel Bilgiler" ekranını göstermeli (v2 öncesi hesaplar
// ve kullanıcı adı göndermeden kaydolan eski istemciler).
const authData = (user) => ({
    id: user._id,
    name: user.name,
    username: user.username || null,
    needsUsername: !user.username
});

const AuthController = {
    checkEmail: catchAsync(async (req, res) => {
        const { available } = await AuthService.checkEmail(req.body.email);
        res.status(200).json({ success: true, available });
    }),

    // Uygunsuz/alınmış ad bir HATA değil, beklenen cevaptır: 200 + available:false
    checkUsername: catchAsync(async (req, res) => {
        const data = await UserService.checkUsername(req.body?.username, req.user?._id);
        res.status(200).json({ success: true, data });
    }),

    socialLogin: catchAsync(async (req, res) => {
        const { provider, idToken, name, surname, username, consents,
                dailyGoal, timezone, reminderTime, dailyReminder, language } = req.body;
        const deviceName = req.body.deviceName || req.headers['user-agent'];
        const { user, accessToken, refreshToken, isNewUser } =
            await AuthService.socialLogin({
                provider, idToken, name, surname, username, deviceName,
                consents, ip: req.ip, userAgent: req.headers['user-agent'],
                // register ile aynı onboarding alanları; yalnızca yeni hesapta uygulanır
                dailyGoal, timezone, reminderTime, dailyReminder, language
            });
        res.status(isNewUser ? 201 : 200).json({
            success: true,
            accessToken,
            refreshToken,
            isNewUser,
            isEmailVerified: true,
            data: authData(user)
        });
    }),

    register: catchAsync(async (req, res) => {
        // Onboarding'in son adımına kadar toplanan her şey tek istekte gelir
        const { name, surname, username, email, password, dailyGoal, timezone, reminderTime, dailyReminder, language, consents } = req.body;
        const deviceName = req.body.deviceName || req.headers['user-agent'];
        const { user, accessToken, refreshToken } = await AuthService.register({
            name, surname, username, email, password, deviceName, dailyGoal, timezone, reminderTime, dailyReminder, language,
            // KVKK rıza kanıtı: kaydın hangi bağlamda yapıldığı
            consents, ip: req.ip, userAgent: req.headers['user-agent']
        });
        // Doğrulama token'ı BİLEREK yanıtta dönmez — hiçbir ortamda.
        // Eskiden NODE_ENV !== 'production' koşuluyla dönüyordu; bu fail-OPEN
        // bir kontroldü: deploy'da değişken boş kalırsa token açığa çıkardı.
        // Testler token'ı sendEmail.outbox'taki maildan okur (gerçek kullanıcı
        // yolunun aynısı).
        res.status(201).json({
            success: true,
            accessToken,
            refreshToken,
            data: authData(user)
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
            data: authData(user)
        });
    }),

    logout: catchAsync(async (req, res) => {
        // refreshToken verilirse sadece bu cihaz, verilmezse tüm cihazlar.
        // req.user optionalAuth'tan gelir ve süresi dolmuş access token'da
        // BULUNMAZ — o durumda kimlik refreshToken'dan türetilir.
        await AuthService.logout(req.user?.id, req.body?.refreshToken);
        res.status(200)
            .cookie('access_token', '', { httpOnly: true, expires: new Date(0) })
            .json({ success: true, message: 'Logged out' });
    }),

    // Kullanıcı bildirim iznini işletim sisteminden kapattığında çağrılır:
    // sunucudaki token ölü kalmasın. update-info token'ı YAZAR ama boş değeri
    // yok saydığı için silme yolu yoktu.
    clearFcmToken: catchAsync(async (req, res) => {
        await AuthService.clearFcmToken(req.user.id);
        res.status(200).json({ success: true, message: 'Push token temizlendi' });
    }),

    refresh: catchAsync(async (req, res) => {
        const { refreshToken } = req.body;
        const result = await AuthService.refresh(refreshToken);
        res.status(200).json({ success: true, data: result });
    }),

    // "E-postanı Doğrula" bekleme ekranı için düz durum ucu.
    // isEmailVerified middleware'i BİLEREK yok — zaten doğrulanmamış kullanıcı
    // soruyor. /auth/me'yi kullanıp 403'ü "doğrulanmadı" sinyali saymak yerine
    // ayrı bir uç var çünkü: (1) 403 bir HATA kodudur, başka sebeple gelen
    // 403'ten ayırt edilemez, (2) bu ekran yoklama yaparsa her istek
    // errorHandler'da console.warn olarak loglanır ve logları doldurur.
    getVerificationStatus: catchAsync(async (req, res) => {
        res.status(200).json({
            success: true,
            data: {
                isEmailVerified: req.user.isEmailVerified,
                email: req.user.email
            }
        });
    }),

    // Oturum varsa kullanıcının rıza durumu da döner (protect opsiyonel)
    getConsents: catchAsync(async (req, res) => {
        const data = await AuthService.getConsentStatus(req.user?.id || null);
        res.status(200).json({ success: true, data });
    }),

    acceptConsents: catchAsync(async (req, res) => {
        const data = await AuthService.acceptConsents(req.user.id, {
            consents: req.body.consents,
            ip: req.ip,
            userAgent: req.headers['user-agent']
        });
        res.status(200).json({ success: true, data });
    }),

    getMe: catchAsync(async (req, res) => {
        res.status(200).json({
            success: true,
            data: UserService.toMe(req.user)
        });
    }),

    forgotPassword: catchAsync(async (req, res) => {
        // resetToken yanıtta dönmez (register'daki notla aynı gerekçe)
        await AuthService.forgotPassword(req.body.email);
        res.status(200).json({
            success: true,
            message: 'Password reset email sent'
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
        res.status(200).json({ success: true, data: UserService.toMe(user) });
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