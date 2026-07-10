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
    lastUsedAt: {
        type: Date,
        default: Date.now
    }
});

DeviceSessionSchema.index({ user: 1, tokenHash: 1 });

module.exports = mongoose.model('DeviceSession', DeviceSessionSchema);
