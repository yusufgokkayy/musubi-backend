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
}

module.exports = AppError;