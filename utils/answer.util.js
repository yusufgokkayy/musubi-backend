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

// Kullanıcının dilindeki anlam: İngilizce arayüzde `meaning`, Türkçede
// `meaningTr` (yoksa İngilizceye düşer). Şık metni, geri bildirim kartı ve
// "doğru cevap" satırı bununla üretilir.
const meaningIn = (word, lang = 'tr') =>
    (lang === 'en' ? word.meaning : (word.meaningTr || word.meaning));

// Yazma sorusunda kabul edilen cevaplar. İKİ DİL DE kabul edilir, kullanıcının
// dili önce gelir (ilk eleman "doğru cevap" olarak gösterilir).
//
// Eskiden meaningTr varsa YALNIZCA Türkçe kabul ediliyordu. Veri setindeki her
// kelimede meaningTr olduğu için İngilizce arayüzdeki kullanıcı "su"ya "water"
// yazıp yanlış alıyordu — yazma sorusunu hiç doğru yapamıyordu (26.09.2026,
// doğrulandı). Türk kullanıcının "water" yazması da anlamı bildiğini gösterir;
// iki dili birden kabul etmek bir dilin cevabını diğerinde yanlış saymaktan
// doğrudur.
const wordAnswerVariants = (word, lang = 'tr') => {
    const tr = word.meaningTr
        ? [...meaningVariants(word.meaningTr), ...(word.meaningTrAccepted || [])]
        : [];
    const en = word.meaning
        ? [...meaningVariants(word.meaning), ...(word.meaningEnAccepted || [])]
        : [];
    return [...new Set(lang === 'en' ? [...en, ...tr] : [...tr, ...en])];
};

module.exports = { normalizeAnswer, meaningVariants, gradeTyping, wordAnswerVariants, meaningIn };
