// E-posta linkleri için taban URL (production'da backend'in public adresi).
// Template literal içinde çıplak process.env.CLIENT_URL kullanımı, env eksikken
// "http://undefined/..." gibi kırık linklerin SESSİZCE gönderilmesine yol açtı;
// bu yardımcı eksikliği gürültülü bir hataya çevirir (mail akışlarındaki
// try/catch'ler yakalar: kullanıcı temiz bir 500 alır, register rollback çalışır).
const clientUrl = (path) => {
    const base = (
        process.env.CLIENT_URL ||
        (process.env.NODE_ENV !== 'production' && 'http://localhost:5000') ||
        ''
    ).trim().replace(/\/+$/, '');

    if (!base) throw new Error('CLIENT_URL tanımlı değil (.env)');
    return base + path;
};

module.exports = clientUrl;
