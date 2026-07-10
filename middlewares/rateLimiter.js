const rateLimit = require('express-rate-limit');

// Test süiti tek IP'den yüzlerce istek atar; limitler orada devre dışı kalır
const skipInTest = () => process.env.NODE_ENV === 'test';

// Tüm API için genel limit
const generalLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 300,
    standardHeaders: true,
    legacyHeaders: false,
    skip: skipInTest,
    message: { success: false, message: 'Çok fazla istek, lütfen daha sonra tekrar deneyin' }
});

// Brute-force'a açık auth endpoint'leri için sıkı limit
const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 20,
    standardHeaders: true,
    legacyHeaders: false,
    skip: skipInTest,
    message: { success: false, message: 'Çok fazla deneme, lütfen 15 dakika sonra tekrar deneyin' }
});

module.exports = { generalLimiter, authLimiter };
