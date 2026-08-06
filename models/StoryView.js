const mongoose = require('mongoose');

// "Bu kullanıcı bu hikâyeyi gördü" kaydı. Tasarımda görülen hikâyenin halkası
// gri, görülmeyenin kırmızı (Anasayfa.png, ilk daire gri).
//
// Ayrı koleksiyon: alternatif olan "Story.viewedBy: [ObjectId]" dizisi kullanıcı
// sayısıyla birlikte sınırsız büyür ve tek dokümanın 16 MB sınırına dayanır.
const StoryViewSchema = new mongoose.Schema({
    user: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    story: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Story',
        required: true
    },
    // "Görüldü" hesabı bu tarihi hikâyenin updatedAt'iyle karşılaştırır:
    // admin hikâyeye slayt eklerse halka o kullanıcıda tekrar kırmızıya döner.
    // Ayrı bir "sürüm" alanı tutmaya gerek bırakmıyor.
    viewedAt: {
        type: Date,
        default: Date.now
    }
});

// Aynı kullanıcı-hikâye çifti tek kayıt; işaretleme upsert ile idempotent
StoryViewSchema.index({ user: 1, story: 1 }, { unique: true });

module.exports = mongoose.model('StoryView', StoryViewSchema);
