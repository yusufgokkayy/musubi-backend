class AppError extends Error {
    // details: istemcinin ÜZERİNE İŞ YAPABİLECEĞİ ek veri (örn. "kaç kelime
    // kaldı"). İsteğe bağlıdır; verilmezse yanıt eskisi gibi {success,message}
    // kalır — mevcut hata sözleşmesi değişmez.
    constructor(message, statusCode, details) {
        super(message);
        this.statusCode = statusCode;
        this.details = details;
        this.status = statusCode >= 400 && statusCode < 500 ? 'fail' : 'error';
        this.isOperational = true;
        Error.captureStackTrace(this, this.constructor);
    }

    // Makine-okur hata kodu (bkz. utils/errorCodes.js); yanıtta `code` olarak
    // döner. Zincirlenir: throw new AppError('...', 401).withCode(ERR.X)
    // Alan adı bilerek `code` DEĞİL: Mongo (11000) ve multer ('LIMIT_FILE_SIZE')
    // kendi err.code'larını taşıyor ve errorHandler onlara bakıyor.
    withCode(code) {
        this.errorCode = code;
        return this;
    }
}

module.exports = AppError;