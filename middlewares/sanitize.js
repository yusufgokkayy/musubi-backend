const AppError = require('../utils/AppError');

// MongoDB operatör enjeksiyonu kapısı.
//
// express.json gövdedeki nesneleri olduğu gibi geçirir. Bir alan string yerine
// {"$ne": null} veya {"$regex": "^a"} olarak gelirse Mongoose onu SORGU
// OPERATÖRÜ olarak çalıştırır: /auth/login'e e-posta yerine {"$ne": null}
// göndermek, adresi bilinmeyen rastgele bir hesaba hatalı deneme yazdırıyordu
// (kilitleme ve hesaplar arası şifre denemesi — 26.09.2026, doğrulandı).
//
// Uygulamanın hiçbir istek gövdesinde "$" ile başlayan anahtar yok; böyle bir
// anahtar taşıyan gövde doğrudan reddedilir. Tek tek uçlarda tip kontrolü
// yapmaktan sağlamdır: yeni yazılan bir uç unutsa da korunur.
//
// Özyineleme yerine yığın: 100 KB'lık bir gövde binlerce seviye iç içe dizi
// taşıyabilir, özyinelemeli tarama yığını taşırıp 500 üretirdi.
const hasOperatorKey = (root) => {
    const stack = [root];
    while (stack.length) {
        const value = stack.pop();
        if (!value || typeof value !== 'object') continue;
        if (Array.isArray(value)) {
            stack.push(...value);
            continue;
        }
        for (const key of Object.keys(value)) {
            if (key.startsWith('$')) return true;
            stack.push(value[key]);
        }
    }
    return false;
};

const rejectOperatorKeys = (req, res, next) => {
    if (hasOperatorKey(req.body)) return next(new AppError('Geçersiz istek gövdesi', 400));
    next();
};

module.exports = { rejectOperatorKeys, hasOperatorKey };
