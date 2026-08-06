// Adres bazlı mail gönderim kısıtı.
//
// Neden IP limiti yetmiyor: rateLimiter'daki authLimiter IP başına sayar.
// Saldırgan IP değiştirerek (VPN, mobil şebeke, botnet) bir kurbanın adresine
// istediği kadar doğrulama/sıfırlama maili attırabilir — gelen kutusu taciz
// aracına döner ve domain'in gönderim itibarı zarar görür. Buradaki sayaç
// hedef HESABIN dokümanında tutulduğu için IP değiştirmek işe yaramaz.
//
// Enumeration politikası bilinçli olarak "dürüst cevap" yönünde belirlendi
// (bilinmeyen adres 404); bu kısıt o kararın karşılığıdır.
const AppError = require('./AppError');

const COOLDOWN_MS = 60 * 1000;   // iki mail arası en az 1 dakika
const DAILY_LIMIT = 5;           // aynı adrese günde en fazla 5 mail
const DAY_MS = 24 * 60 * 60 * 1000;

// kind: 'verification' | 'reset'
const slot = (user, kind) => {
    if (!user.mailThrottle) user.mailThrottle = {};
    if (!user.mailThrottle[kind]) user.mailThrottle[kind] = { dayCount: 0 };
    return user.mailThrottle[kind];
};

// Gönderime izin yoksa 429 atar. Çağrı, mail gönderilmeden ÖNCE yapılmalı.
const assertMailAllowed = (user, kind) => {
    const s = slot(user, kind);
    const now = Date.now();

    if (s.lastSentAt) {
        const waited = now - new Date(s.lastSentAt).getTime();
        if (waited < COOLDOWN_MS) {
            const err = new AppError(
                'Çok sık istek gönderdiniz, lütfen biraz bekleyin',
                429
            );
            err.retryAfterSeconds = Math.ceil((COOLDOWN_MS - waited) / 1000);
            throw err;
        }
    }

    // Gün penceresi ilk gönderimde başlar, 24 saat sonra kendiliğinden sıfırlanır
    const windowFresh = s.dayStart && (now - new Date(s.dayStart).getTime()) < DAY_MS;
    if (windowFresh && s.dayCount >= DAILY_LIMIT) {
        const err = new AppError(
            'Bu adrese bugün çok fazla mail gönderildi, yarın tekrar deneyin',
            429
        );
        err.retryAfterSeconds = Math.ceil(
            (DAY_MS - (now - new Date(s.dayStart).getTime())) / 1000
        );
        throw err;
    }
};

// Sayaçları ilerletir. Dokümanı KAYDETMEZ — çağıran zaten token'ı yazarken
// save() ediyor, ikinci bir yazma yapmayalım diye.
const markMailSent = (user, kind) => {
    const s = slot(user, kind);
    const now = new Date();

    const windowFresh = s.dayStart && (now - new Date(s.dayStart).getTime()) < DAY_MS;
    if (!windowFresh) {
        s.dayStart = now;
        s.dayCount = 0;
    }

    s.lastSentAt = now;
    s.dayCount += 1;
    user.markModified('mailThrottle');
};

// Gönderim patlarsa sayaç geri alınır: kullanıcı, hiç gelmemiş bir mail
// yüzünden bir dakika boyunca tekrar denemekten alıkonmamalı
const rollbackMailSent = (user, kind) => {
    const s = slot(user, kind);
    s.lastSentAt = undefined;
    s.dayCount = Math.max(0, (s.dayCount || 1) - 1);
    user.markModified('mailThrottle');
};

module.exports = { assertMailAllowed, markMailSent, rollbackMailSent, COOLDOWN_MS, DAILY_LIMIT };
