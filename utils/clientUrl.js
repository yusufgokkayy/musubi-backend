// E-posta linkleri için taban URL (production'da backend'in public adresi).
// Template literal içinde çıplak process.env.CLIENT_URL kullanımı, env eksikken
// "http://undefined/..." gibi kırık linklerin SESSİZCE gönderilmesine yol açtı;
// bu yardımcı eksikliği gürültülü bir hataya çevirir (mail akışlarındaki
// try/catch'ler yakalar: kullanıcı temiz bir 500 alır, register rollback çalışır).
const clientUrl = (path) => {
    // localhost fallback'i YALNIZCA test süiti için (CI'da .env yoktur).
    // Dev'de .env'den gelir; deploy ortamında NODE_ENV ne olursa olsun
    // fallback YOKTUR — "development" modda kalmış bir production, localhost
    // linkli mail atacağına gürültülü hata versin (yaşandı: Outlook maili
    // localhost linki yüzünden spam'e düşürdü).
    const base = (
        process.env.CLIENT_URL ||
        (process.env.NODE_ENV === 'test' && 'http://localhost:5000') ||
        ''
    ).trim().replace(/\/+$/, '');

    if (!base) throw new Error('CLIENT_URL tanımlı değil (.env)');
    return base + path;
};

module.exports = clientUrl;
