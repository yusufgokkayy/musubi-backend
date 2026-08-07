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

module.exports = { uploadSingleImage, MAX_UPLOAD_BYTES };
