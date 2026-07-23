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
        message
    });
};

module.exports = errorHandler;