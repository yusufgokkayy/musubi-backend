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

// Görsel yükleme: admin uçları olsa da tek istek 20 MB gövde okur ve sharp ile
// yeniden kodlar. Genel limitin (300/15dk) altında kalan bir döngü bile sunucuyu
// meşgul edebileceği için ayrı tutulur.
//
// 60: panel her görseli AYRI istekle yüklüyor (5 slaytlık hikâye = 6 istek).
// 30'da, dört hikâye giren bir admin yükleme ortasında 429 yiyordu. Uç zaten
// isAdmin arkasında; buradaki sınır kötü niyete değil, kazara döngüye karşı.
const uploadLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 60,
    standardHeaders: true,
    legacyHeaders: false,
    skip: skipInTest,
    message: { success: false, message: 'Çok fazla yükleme denemesi, lütfen daha sonra tekrar deneyin' }
});

module.exports = { generalLimiter, authLimiter, uploadLimiter };
