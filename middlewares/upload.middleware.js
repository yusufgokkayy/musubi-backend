const multer = require('multer');

// 20 MB. Eskiden 5 MB'tı ve modern telefon fotoğraflarını (48 MP cihazlarda
// 8-15 MB) reddediyordu — oysa sunucu görseli zaten yeniden kodluyor ve aynı
// fotoğraf çıktıda ~60-120 KB'a iniyor, yani tavan hiçbir depolama/trafik
// kazancı sağlamadan admin'i "Görsel çok büyük" hatasına düşürüyordu.
// Asıl koruma burada değil: kaynak tüketimini image.util.js'teki 50 megapiksel
// sınırı (zip bombası muadili) ve uploadLimiter (60 istek/15 dk) tutuyor.
const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

// memoryStorage — diskStorage DEĞİL. multer'ın disk modu dosyayı önce geçici
// bir yola yazar; o yol Railway'de kalıcı değildir ve doğrulamadan ÖNCE yazdığı
// için reddedilen dosyalar da diske değer. Tek dosya, tek istek ve admin'e özel
// bir uç olduğu için buffer'ı RAM'de tutmak hem daha güvenli hem sürücüden
// bağımsız (Cloudinary'ye de aynı buffer gider).
const uploadSingleImage = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: MAX_UPLOAD_BYTES, files: 1, fields: 5 }
}).single('image');

// ——— Toplu ses yükleme (POST /api/words/audio, yalnızca admin) ———
//
// Kelime ve örnek cümle sesleri bilgisayarda üretilip scripts/import-audio.js
// ile gönderilir: ~11.600 küçük dosya. Dosya başına bir istek, genel hız
// sınırına (300 istek / 15 dk) takılır ve yükleme saatler sürerdi; bu yüzden
// tek istek en fazla MAX_AUDIO_BATCH dosya taşır.
//
// 512 KB: 64 kbps mono MP3'te kelime ~10 KB, en uzun örnek cümle ~120 KB.
// Sınır cömert ama WAV'ı (aynı cümle ~1 MB) bilerek dışarıda bırakıyor.
const AppError = require('../utils/AppError');
const MAX_AUDIO_BYTES = 512 * 1024;
const MAX_AUDIO_BATCH = 50;

const audioBatch = multer({
    storage: multer.memoryStorage(),
    // fieldSize: `items` alanı (dosyaların hangi kelimeye ait olduğunu söyleyen
    // JSON) 50 satırda birkaç KB tutar
    limits: { fileSize: MAX_AUDIO_BYTES, files: MAX_AUDIO_BATCH, fields: 3, fieldSize: 256 * 1024 }
}).array('audio', MAX_AUDIO_BATCH);

// multer hataları genel errorHandler'da GÖRSEL diliyle çevriliyor ("Görsel çok
// büyük"); ses ucunun hatası kendi sınırlarını söylemeli, o yüzden burada
// AppError'a çevrilir.
const uploadAudioBatch = (req, res, next) => audioBatch(req, res, (err) => {
    if (!err) return next();
    if (err.name !== 'MulterError') return next(err);
    const message =
        err.code === 'LIMIT_FILE_SIZE'
            ? `Ses dosyası çok büyük (dosya başına en fazla ${MAX_AUDIO_BYTES / 1024} KB)`
            : err.code === 'LIMIT_FILE_COUNT' || err.code === 'LIMIT_UNEXPECTED_FILE'
                ? `Tek istekte en fazla ${MAX_AUDIO_BATCH} ses dosyası yüklenebilir (alan adı: 'audio')`
                : 'Ses dosyaları yüklenemedi';
    next(new AppError(message, 400));
});

module.exports = { uploadSingleImage, MAX_UPLOAD_BYTES, uploadAudioBatch, MAX_AUDIO_BYTES, MAX_AUDIO_BATCH };
