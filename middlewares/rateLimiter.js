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

// Profil fotoğrafı: uploadLimiter'dan AYRI ve daha sıkı, çünkü bu uç her
// doğrulanmış kullanıcıya açık (uploadLimiter admin'e özel uçları korur).
// Gerçek kullanıcı fotoğrafını 15 dakikada birkaç kez değiştirir, fazlası döngüdür.
const avatarLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 10,
    standardHeaders: true,
    legacyHeaders: false,
    skip: skipInTest,
    message: { success: false, message: 'Çok fazla yükleme denemesi, lütfen daha sonra tekrar deneyin' }
});

// Kullanıcı adı müsaitliği: istemci yazarken sorar (debounce'lu). authLimiter
// kullanılsaydı bu kontroller login bütçesini (20/15dk) tüketirdi. Kullanıcı
// adları zaten herkese açık olduğu için sayım saldırısı burada bir sızıntı
// değil; sınır yalnızca döngüye/kazımaya karşı.
const usernameCheckLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 60,
    standardHeaders: true,
    legacyHeaders: false,
    skip: skipInTest,
    message: { success: false, message: 'Çok fazla istek, lütfen daha sonra tekrar deneyin' }
});

// Simülatörden (public/) gelen istekler AYRI kovada sayılır — bkz. app.js.
// Amaç kısıtlamak değil, YALITMAK: test eden biri ile gerçek kullanıcı aynı
// çıkış IP'sinin (ofis, üniversite, mobil NAT) arkasındaysa, testin harcadığı
// bütçe gerçek kullanıcıyı 429'a düşürmemeli.
//
// ⚠️ Bu bir güvenlik sınırı DEĞİLDİR: kova, istemcinin gönderdiği başlığa göre
// seçilir ve başlık taklit edilebilir. Yani başlığı bilen biri aynı IP'den iki
// bütçe kullanabilir. Kabul edilebilir: burada korunan şey kotanın adilliği,
// verinin kendisi değil (o /api'nin auth'unda).
const simulatorApiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 300,
    standardHeaders: true,
    legacyHeaders: false,
    skip: skipInTest,
    message: { success: false, message: 'Çok fazla istek, lütfen daha sonra tekrar deneyin' }
});

module.exports = { generalLimiter, authLimiter, uploadLimiter, avatarLimiter, usernameCheckLimiter, simulatorApiLimiter };
