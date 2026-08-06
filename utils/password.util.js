// "Yeni Şifre Oluştur" ekranının kuralları (tasarımdaki hata metinleriyle birebir).
// Bu kurallar YALNIZCA yeni şifre belirlenen üç kapıda çalışır: kayıt,
// şifre sıfırlama, şifre değiştirme. Login'de BİLEREK uygulanmaz — kural
// öncesinde açılmış zayıf şifreli hesaplar aksi halde kilitlenirdi.
const AppError = require('./AppError');

const MIN_LENGTH = 8;

// Kuralların TEK tanımı. Sıra ekrandaki güç göstergesinin 4 çubuğuna karşılık
// gelir ve utils/i18n.js'teki ruleLength / ruleUpperDigit / ruleSpecial
// mesajlarıyla aynı sırayla eşleşir.
//
// Desenler ayrı export edilir çünkü şifre sıfırlama WEB SAYFASI da canlı güç
// göstergesi çiziyor; oradaki JS bu desenleri aynen kullanır. Böylece kural
// sunucuda, mobilde ve web sayfasında ayrı ayrı yazılmış olmaz.
const RULE_PATTERNS = [
    { minLength: MIN_LENGTH },
    { source: '[A-ZÇĞİÖŞÜ]' },
    { source: '\\d' },
    // Harf ve rakam dışındaki her şey özel karakter sayılır (boşluk dahil değil)
    { source: '[^\\p{L}\\p{N}\\s]', flags: 'u' }
];

const RULE_MESSAGES = [
    `Şifreniz çok kısa (en az ${MIN_LENGTH} karakter olmalı).`,
    'Şifrenizde en az bir büyük harf, bir rakam ve bir özel karakter olmalı.',
    'Şifrenizde en az bir büyük harf, bir rakam ve bir özel karakter olmalı.',
    'Şifrenizi daha sağlam yapmak için bir özel karakter kullanın.'
];

const RULES = RULE_PATTERNS.map((spec, i) => ({
    test: spec.minLength !== undefined
        ? (pw) => pw.length >= spec.minLength
        : (pw) => new RegExp(spec.source, spec.flags || '').test(pw),
    message: RULE_MESSAGES[i]
}));

// İlk ihlal edilen kuralın mesajı, hepsi geçiyorsa null.
// Sıra önemli: kullanıcı önce uzunluğu, sonra içerik kurallarını görür.
// Hem servis katmanı hem User şeması bu tek kaynaktan beslenir.
const firstPasswordViolation = (password) => {
    if (typeof password !== 'string' || !password) return 'Şifre zorunludur';
    return RULES.find(rule => !rule.test(password))?.message ?? null;
};

// Servis katmanı kapısı: ihlal varsa 400 atar, geçerliyse sessizce döner
const validatePassword = (password) => {
    const violation = firstPasswordViolation(password);
    if (violation) throw new AppError(violation, 400);
};

// Güç göstergesi (0-4) — client kendi hesaplasa da, aynı kaynaktan
// beslenmesi için gerektiğinde uçtan da verilebilir
const passwordStrength = (password = '') =>
    RULES.filter(rule => rule.test(password)).length;

module.exports = { validatePassword, firstPasswordViolation, passwordStrength, RULE_PATTERNS, MIN_LENGTH };
