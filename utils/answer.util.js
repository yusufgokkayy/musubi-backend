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

// Kelimenin quiz/yazma sorusunda kabul edilecek doğru cevap varyantları.
// Uygulama tr-only (preferences.language enum'ı yalnızca 'tr'): kullanıcı
// Türkçe anlamı yazar, bu yüzden temel karşılaştırma meaningTr'dir; boşsa
// (henüz çevrilmemiş kelime) İngilizce meaning'e düşülür. meaningTrAccepted/
// meaningEnAccepted, hangi alan baz alındıysa onun eş anlamlı ek varyantlarıdır.
const wordAnswerVariants = (word) => {
    const base = word.meaningTr || word.meaning;
    const accepted = word.meaningTr ? word.meaningTrAccepted : word.meaningEnAccepted;
    return [...new Set([...meaningVariants(base), ...(accepted || [])])];
};

module.exports = { normalizeAnswer, meaningVariants, gradeTyping, wordAnswerVariants };
