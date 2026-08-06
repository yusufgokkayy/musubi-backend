const multer = require('multer');

const MAX_UPLOAD_BYTES = 5 * 1024 * 1024; // 5 MB

// memoryStorage — diskStorage DEĞİL. multer'ın disk modu dosyayı önce geçici
// bir yola yazar; o yol Railway'de kalıcı değildir ve doğrulamadan ÖNCE yazdığı
// için reddedilen dosyalar da diske değer. Görseller zaten 5 MB ile sınırlı,
// RAM'de tutup doğruladıktan sonra depolamaya vermek hem daha güvenli hem
// sürücüden bağımsız (Cloudinary'ye de aynı buffer gider).
const uploadSingleImage = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: MAX_UPLOAD_BYTES, files: 1, fields: 5 }
}).single('image');

module.exports = { uploadSingleImage, MAX_UPLOAD_BYTES };
