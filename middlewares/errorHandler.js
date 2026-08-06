const errorHandler = (err, req, res, next) => {
    let statusCode = err.statusCode || 500;
    let message = err.message || 'Server Error';

    // Mongoose duplicate key
    if (err.code === 11000) {
        const field = Object.keys(err.keyValue)[0];
        message = `${field} already in use`;
        statusCode = 400;
    }

    // Mongoose validation error
    if (err.name === 'ValidationError') {
        message = Object.values(err.errors).map(e => e.message).join(', ');
        statusCode = 400;
    }

    // Geçersiz ObjectId formatı (örn. :id param) — yakalanmazsa 500 dönerdi
    if (err.name === 'CastError') {
        message = 'Invalid ID format';
        statusCode = 400;
    }

    // JWT hataları
    if (err.name === 'JsonWebTokenError') {
        message = 'Invalid token';
        statusCode = 401;
    }

    if (err.name === 'TokenExpiredError') {
        message = 'Token expired';
        statusCode = 401;
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

    res.status(statusCode).json({
        success: false,
        message,
        // Yalnızca AppError açıkça verdiyse eklenir (bkz. utils/AppError.js)
        ...(err.details !== undefined && { details: err.details })
    });
};

module.exports = errorHandler;