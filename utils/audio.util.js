// Ses dosyası doğrulama.
//
// Görsellerdeki kuralın aynısı (bkz. image.util.js): istemcinin gönderdiği
// dosya adı ve mimetype uydurmadır, dosyanın ne olduğuna SİHİRLİ BAYT ile
// bakılır. Yüklenen her dosya /uploads altından aynı origin'den servis edildiği
// için "uzantısı .mp3" diye kabul etmek yükleme ucunu keyfi dosya sunucusuna
// çevirirdi.
//
// Yalnızca MP3 kabul edilir: uygulamanın oynatacağı tek biçim olsun (iOS ve
// Android'in ikisi de ek kütüphanesiz çalar) ve depolama tahmin edilebilir
// kalsın — aynı kelimenin WAV'ı ~10 kat yer tutar.
const isMp3 = (buf) => {
    if (!Buffer.isBuffer(buf) || buf.length < 4) return false;
    // ID3v2 etiketiyle başlayan dosya
    if (buf.subarray(0, 3).toString('latin1') === 'ID3') return true;
    // Etiketsiz dosya doğrudan MPEG çerçevesiyle başlar: 11 bit eşitleme
    // (0xFFE) + katman bitleri 01 = Layer III
    return buf[0] === 0xFF && (buf[1] & 0xE0) === 0xE0 && (buf[1] & 0x06) === 0x02;
};

module.exports = { isMp3 };
