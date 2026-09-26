// Kullanıcı adı kuralları — kayıt, sosyal giriş, update-info ve müsaitlik ucu
// AYNI fonksiyondan geçer; kural iki yerde yazılırsa biri eskir.
//
// Saklama biçimi: küçük harf, başında "@" olmadan. Profil/sıralama/davet linki
// (musubi.alpsoysoft.com/u/<username>) bu değeri kullanır; büyük/küçük harf
// ayrımı olsaydı "Emomu" ile "emomu" iki ayrı hesap olabilir ve davet linki
// yanlış kişiye giderdi.
const MIN_LENGTH = 3;
const MAX_LENGTH = 20;

// Yalnızca ASCII: Türkçe karakter (ş, ı) ve emoji davet linkinde URL
// kodlamasına, aramada da "i/ı" belirsizliğine yol açar.
const ALLOWED = /^[a-z0-9_.]+$/;

// Uygulamanın kendi adına konuşuyormuş gibi görünebilecek adlar ve ileride
// URL yolu olarak kullanılabilecek kelimeler
const RESERVED = new Set([
    'admin', 'administrator', 'root', 'system', 'sistem', 'musubi', 'official',
    'resmi', 'support', 'destek', 'help', 'yardim', 'moderator', 'staff',
    'team', 'ekip', 'api', 'www', 'mail', 'null', 'undefined', 'anonymous',
    'deleted', 'silindi', 'settings', 'ayarlar', 'login', 'register', 'signup',
    'profile', 'profil', 'user', 'users', 'leaderboard', 'invite', 'davet'
]);

// Küfür filtresi. İki liste var çünkü tek bir "içeriyor mu" kontrolü ya çok
// gevşek ya çok sert oluyor:
//   - ROOTS: uzun, yanlış pozitifi pek olmayan kökler — adın HERHANGİ bir
//     yerinde geçerse reddedilir ("xorospux").
//   - EXACT: kısa kelimeler — yalnızca ayraçlarla bölünmüş bir parçanın
//     KENDİSİ ise reddedilir. İçeriyor mu diye bakılsaydı "sik" kökü "klasik"i,
//     "amk" kısaltması masum adları yakalardı.
// Liste bilinçli olarak kısa: amaç en bariz vakaları kayıtta durdurmak.
// Gözden kaçanlar şikâyet akışıyla (admin paneli) temizlenir.
const ROOTS = [
    'orospu', 'siktir', 'sikis', 'yarrak', 'amcik', 'pezevenk', 'kahpe',
    'gavat', 'fuck', 'bitch', 'cunt', 'nigger', 'nigga', 'whore', 'slut',
    'hitler', 'porno'
];
const EXACT = new Set([
    'amk', 'aq', 'sik', 'pic', 'got', 'ibne', 'oc', 'mk', 'sg',
    'shit', 'dick', 'cock', 'porn', 'sex', 'nazi'
]);

// Rakamla harf taklidi ("0r0spu") köke eşlenir ki filtre bir rakamla aşılamasın
const LEET = { 0: 'o', 1: 'i', 3: 'e', 4: 'a', 5: 's', 7: 't', 8: 'b' };

// "@Emomu " → "emomu". Tip hatası (sayı, nesne) boş string'e düşer ki
// doğrulama "geçersiz" desin, sunucu 500 atmasın.
const normalizeUsername = (input) => {
    if (typeof input !== 'string') return '';
    return input.trim().replace(/^@/, '').toLowerCase();
};

const isInappropriate = (username) => {
    const deleet = username.replace(/[0-9]/g, d => LEET[d] ?? '');
    const squashed = deleet.replace(/[_.]/g, '');
    if (ROOTS.some(root => squashed.includes(root))) return true;
    // Parçalar rakamla da ayrılır: "sik123" → ["sik"]
    const parts = username.split(/[_.0-9]+/).filter(Boolean);
    return parts.some(part => EXACT.has(part));
};

// Hata nedenleri makine tarafından okunur: istemci mesajı kendi dilinde
// gösterebilsin diye her nedenin sabit bir kodu var. Sıra önemlidir —
// kullanıcıya önce düzeltebileceği biçim hatası söylenir.
const REASON_MESSAGES = {
    invalid: `Kullanıcı adı ${MIN_LENGTH}-${MAX_LENGTH} karakter olmalı; yalnızca küçük harf, rakam, "_" ve "." içerebilir`,
    reserved: 'Bu kullanıcı adı kullanılamaz',
    inappropriate: 'Bu kullanıcı adı uygun değil',
    taken: 'Bu kullanıcı adı alınmış'
};

/**
 * Biçim/içerik kontrolü (veritabanına bakmaz — müsaitlik ayrı).
 * @returns {string|null} ihlal nedeni kodu veya null
 */
const usernameViolation = (username) => {
    if (username.length < MIN_LENGTH || username.length > MAX_LENGTH) return 'invalid';
    if (!ALLOWED.test(username)) return 'invalid';
    // Nokta başta/sonda veya art arda: "emo..mu", ".emomu" — linkte ve
    // ekranda okunaksız, ayrıca dosya adı/yol gibi yorumlanabiliyor
    if (/^\.|\.$|\.\./.test(username)) return 'invalid';
    // Yalnızca rakam/ayraçtan oluşan ad ("12345") hesap kimliğiyle karışır
    if (!/[a-z]/.test(username)) return 'invalid';
    if (RESERVED.has(username)) return 'reserved';
    if (isInappropriate(username)) return 'inappropriate';
    return null;
};

module.exports = {
    normalizeUsername,
    usernameViolation,
    REASON_MESSAGES,
    MIN_LENGTH,
    MAX_LENGTH
};
