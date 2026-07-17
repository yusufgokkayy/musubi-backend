// Yazma cevabı puanlama — quiz ve günlük ders akışlarının ORTAK doğruluk
// kaynağı. "to see / watch" gibi çok varyantlı anlamlarda her varyant tek
// başına kabul edilir; istemcilerin kendi eşleştirmesini yazması gerekmez.

// Türkçe küçük harf, parantez içleri opsiyonel, noktalama/fazla boşluk yok sayılır
const normalizeAnswer = (s) => String(s ?? '')
    .toLocaleLowerCase('tr')
    .replace(/\([^)]*\)/g, ' ')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();

// "gelecek yıl, seneye" / "to see / watch" gibi anlamlarda her varyant
// tek başına da kabul edilir
const meaningVariants = (meaning) => {
    const variants = [meaning, ...meaning.split(/[,;/]/)]
        .map(v => v.trim())
        .filter(Boolean);
    return [...new Set(variants)];
};

const gradeTyping = (answer, correctAnswers) => {
    const typed = normalizeAnswer(answer);
    if (!typed) return false; // boş bırakılan ("Şimdilik Geç") yanlış sayılır
    return correctAnswers.some(c => normalizeAnswer(c) === typed);
};

module.exports = { normalizeAnswer, meaningVariants, gradeTyping };
