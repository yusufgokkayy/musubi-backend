const mongoose = require('mongoose');

// Anasayfanın üstündeki "bilgi kutucukları" — daire kapak + dokununca açılan
// tam ekran görsel kartlar (Instagram hikâyeleri düzeni). İçerik adminler
// tarafından /admin panelinden girilir.
const StorySchema = new mongoose.Schema({
    // Dairenin ALTINDAKİ etiket. Tasarımda tek satır ve daire genişliğinde
    // ("musubi", "trenadam") — uzun başlık orada kırpılıp çirkin duruyor,
    // sınır bu yüzden şemada.
    title: {
        type: String,
        required: [true, 'Başlık zorunlu'],
        trim: true,
        maxlength: [24, 'Başlık en fazla 24 karakter olabilir']
    },
    // Görseller URL değil KEY olarak saklanır: URL depolama sürücüsüne göre
    // değişir (bugün /uploads, yarın bir CDN), key değişmez. Sağlayıcı
    // değiştiğinde kayıtlara dokunmak gerekmesin diye — bkz. config/storage/.
    coverKey: {
        type: String,
        required: [true, 'Kapak görseli zorunlu']
    },
    slides: {
        type: [{
            _id: false,
            imageKey: { type: String, required: true }
        }],
        validate: {
            validator: (v) => Array.isArray(v) && v.length > 0,
            message: 'En az bir slayt gerekli'
        }
    },
    isActive: {
        type: Boolean,
        default: true
    },
    // Sabitlenen hikâyeler şeridin başında durur. Sıralama iki kademeli:
    // önce isPinned, sonra order. Böylece `order` her grup içinde 0'dan
    // başlayabiliyor ve tek bir global sıra numarası uydurmak gerekmiyor.
    isPinned: {
        type: Boolean,
        default: false
    },
    // Küçük olan önce gösterilir; KENDİ GRUBU içinde geçerlidir.
    // Panelde sürükle-bırak ile toplu yazılır.
    order: {
        type: Number,
        default: 0
    },
    // null = süresiz. TTL indeksi BİLEREK yok: süresi dolan hikâye gizlenir,
    // silinmez — admin tarihi uzatıp yeniden yayına alabilsin.
    expiresAt: {
        type: Date,
        default: null
    },
    // "Görüldü" halkasının ne zaman yeniden yanacağını belirler. updatedAt
    // KULLANILAMAZ: onu sıralama (bulkWrite), yayından kaldırma, başlık düzeltme
    // gibi içerikle ilgisi olmayan her işlem ilerletiyor ve hikâye herkese
    // yeniden "yeni" görünüyordu (ölçüldü). Bu alan YALNIZCA kapak veya
    // slaytlar gerçekten değişince güncellenir.
    contentUpdatedAt: {
        type: Date,
        default: Date.now
    },
    createdBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    }
}, { timestamps: true });

StorySchema.index({ isActive: 1, isPinned: -1, order: 1 });

module.exports = mongoose.model('Story', StorySchema);
