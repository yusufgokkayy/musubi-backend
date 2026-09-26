const AppError = require('../utils/AppError');
const { getAppCheck } = require('../config/firebase');

// Firebase App Check — isteğin GERÇEK Musubi uygulamasından geldiğini doğrular.
//
// Neden: kayıt, giriş ve mail gönderen uçlar herkese açık. Birçok IP kullanan
// biri, IP başına rate limit'i aşmadan toplu hesap açıp keyfi adreslere
// doğrulama maili göndertebilir (Resend alan adının itibarı düşer) ya da
// girişe şifre denemesi yayabilir. App Check, isteğin mağazadan kurulmuş
// uygulamadan geldiğini Play Integrity / App Attest ile kanıtlatır.
//
// VARSAYILAN KAPALI: istemci App Check SDK'sını entegre edip her isteğe
// `X-Firebase-AppCheck` başlığını koymadan açılırsa uygulama giriş yapamaz.
// Açmak için: APP_CHECK_ENFORCE=true. Web simülatörü App Check token'ı
// üretemediği için zorlama açık ortamda simülatörle kayıt/giriş yapılamaz —
// simülatörü zorlamanın kapalı olduğu bir ortamda (staging) kullanın.
const requireAppCheck = async (req, res, next) => {
    if (process.env.APP_CHECK_ENFORCE !== 'true') return next();

    const token = req.get('x-firebase-appcheck');
    if (!token) return next(new AppError('Uygulama doğrulaması eksik', 401));

    const appCheck = getAppCheck();
    if (!appCheck) {
        // Zorlama açık ama Firebase başlatılamamış: kapıyı açık bırakmak
        // korumayı sessizce kapatmak olurdu — kapalı tarafta kal
        console.error('[appcheck] APP_CHECK_ENFORCE=true ama Firebase başlatılamadı');
        return next(new AppError('Uygulama doğrulaması şu an yapılamıyor', 503));
    }

    try {
        await appCheck.verifyToken(token);
        next();
    } catch {
        next(new AppError('Uygulama doğrulaması geçersiz', 401));
    }
};

module.exports = { requireAppCheck };
