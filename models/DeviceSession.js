const mongoose = require('mongoose');

// Cihaz başına bir oturum: refresh token'lar artık User üzerinde tek alan değil,
// oturum kaydı olarak tutulur. Böylece telefon + tablet aynı anda oturum açık
// kalabilir ve oturumlar tek tek iptal edilebilir.
const DeviceSessionSchema = new mongoose.Schema({
    user: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        index: true
    },
    // Refresh token'ın SHA-256 hash'i — DB sızıntısında ham token ele geçmez
    tokenHash: {
        type: String,
        required: true,
        index: true
    },
    deviceName: {
        type: String,
        default: 'Bilinmeyen cihaz'
    },
    createdAt: {
        type: Date,
        default: Date.now
    },
    // Yalnızca LRU tahliyesi için (5 oturum dolunca en eskisi düşer).
    // TTL BİLEREK bu alanda DEĞİL: burada olsaydı süre, token ömrü değil
    // "hareketsizlik" ölçerdi ve JWT_REFRESH_EXPIRE uzatıldığında geçerli
    // token'ın oturum kaydı erken silinip kullanıcı sebepsiz çıkış yapardı.
    lastUsedAt: {
        type: Date,
        default: Date.now
    },
    // TTL: refresh token'ın KENDİ `exp` claim'inden türetilir (bkz.
    // auth.service.js createSession). Böylece kayıt ile token tam olarak
    // aynı anda ölür ve süre ikinci bir yerde tekrar tanımlanmaz —
    // JWT_REFRESH_EXPIRE değiştiğinde burada düzeltilecek bir şey kalmaz.
    // Not: Mongo'nun TTL süpürücüsü ~60 sn'de bir çalışır, silme yaklaşıktır;
    // güvenlik zaten jwt.verify'da, bu yalnızca temizliktir.
    expiresAt: {
        type: Date,
        required: true,
        index: { expires: 0 }
    }
});

DeviceSessionSchema.index({ user: 1, tokenHash: 1 });

module.exports = mongoose.model('DeviceSession', DeviceSessionSchema);
