const ERR = require('../utils/errorCodes');

const errorHandler = (err, req, res, next) => {
    let statusCode = err.statusCode || 500;
    let message = err.message || 'Server Error';
    // Makine-okur kod (bkz. utils/errorCodes.js): AppError.withCode() ile
    // gelir ya da aşağıda kütüphane hatalarından türetilir
    let code = err.errorCode;

    // Mongoose duplicate key
    if (err.code === 11000) {
        const field = Object.keys(err.keyValue)[0];
        message = `${field} already in use`;
        statusCode = 400;
        // Kayıtta check-email ile yazma arasında adresi başkası alırsa buraya
        // düşer; kullanıcı İngilizce alan adı yerine anlaşılır bir cümle görsün
        if (field === 'email') {
            message = 'Bu e-posta adresi zaten kullanımda';
            code = ERR.EMAIL_TAKEN;
        }
    }

    // Mongoose validation error
    if (err.name === 'ValidationError') {
        message = Object.values(err.errors).map(e => e.message).join(', ');
        statusCode = 400;
        // Kayıt e-posta biçimini ve şifre kurallarını şemaya bırakıyor; bu iki
        // alanın hatası istemcinin ayrı ele aldığı form hatalarıdır
        if (err.errors.email) code = ERR.EMAIL_INVALID;
        else if (err.errors.password) code = ERR.WEAK_PASSWORD;
    }

    // Geçersiz ObjectId formatı (örn. :id param) — yakalanmazsa 500 dönerdi
    if (err.name === 'CastError') {
        message = 'Invalid ID format';
        statusCode = 400;
    }

    // JWT hataları — buraya yalnızca ERİŞİM token'ınınkiler düşer; yenileme
    // token'ı AuthService.refresh'te kendi koduyla (REFRESH_INVALID) yakalanır
    if (err.name === 'JsonWebTokenError') {
        message = 'Invalid token';
        statusCode = 401;
        code = ERR.TOKEN_INVALID;
    }

    if (err.name === 'TokenExpiredError') {
        message = 'Token expired';
        statusCode = 401;
        code = ERR.TOKEN_EXPIRED;
    }

    // multer hataları (dosya boyutu/adedi) istemci hatasıdır; yakalanmazsa
    // 500 dönerdi ve "boyut sınırını geçtin" bilgisi kullanıcıya hiç ulaşmazdı
    if (err.name === 'MulterError') {
        statusCode = 400;
        const { MAX_UPLOAD_BYTES } = require('./upload.middleware');
        message =
            err.code === 'LIMIT_FILE_SIZE'
                ? `Görsel çok büyük (en fazla ${Math.round(MAX_UPLOAD_BYTES / 1024 / 1024)} MB)`
                : err.code === 'LIMIT_FILE_COUNT' || err.code === 'LIMIT_UNEXPECTED_FILE'
                    ? "Tek seferde tek görsel yüklenebilir (alan adı: 'image')"
                    : 'Görsel yüklenemedi';
    }

    // Beklenen istemci hataları (süresi dolan token, yanlış şifre, validasyon)
    // rutin akıştır: tek satır yeter. Tam stack yalnızca gerçek sorunlarda (5xx)
    // basılır ki loglarda sinyal/gürültü ayrımı yapılabilsin.
    if (process.env.NODE_ENV !== 'test') {
        if (statusCode >= 500) {
            console.error(err);
        } else {
            console.warn(`${statusCode} ${req.method} ${req.originalUrl} — ${message}`);
        }
    }

    // Bekleme gerektiren hatalar (giriş kilidi, mail kısıtı) kaç saniye
    // beklenmesi gerektiğini err.retryAfterSeconds'ta taşır. Eskiden bu değer
    // hesaplanıp HİÇBİR YERE yazılmıyordu — istemci "Tekrar Gönder (54)" geri
    // sayımını tahminle kuruyordu. Hem standart Retry-After başlığına hem
    // details'e yazılır.
    let details = err.details;
    if (Number.isFinite(err.retryAfterSeconds) && err.retryAfterSeconds > 0) {
        res.set('Retry-After', String(err.retryAfterSeconds));
        details = { ...(details || {}), retryAfterSeconds: err.retryAfterSeconds };
    }

    res.status(statusCode).json({
        success: false,
        message,
        // Kodu olmayan hata eskisi gibi { success, message } kalır
        ...(code && { code }),
        // Yalnızca AppError açıkça verdiyse eklenir (bkz. utils/AppError.js)
        ...(details !== undefined && { details })
    });
};

module.exports = errorHandler;