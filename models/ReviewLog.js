const mongoose = require('mongoose');

// TEKRAR GEÇMİŞİ — günün her NİHAİ cevabı (correct/easy/wrong) için bir satır.
//
// İki işin veri kaynağıdır: zamanlama algoritmasının (ileride FSRS) gerçek
// kullanıcı verisiyle ayarlanması ve "kullanıcı N gün sonra kelimeyi
// hatırlıyor mu" sorusunun ölçülmesi (scripts/review-report.js).
//
// Event log'u bu işe yaramaz: yazımı fire-and-forget'tir ve cevaptan ÖNCEKİ
// durumu (aralık, vade) hiç tutmaz. Buradaki satır await edilerek yazılır ve
// UserWord'ün o cevaptan önceki/sonraki halini taşır — UserWord her cevapta
// üzerine yazıldığı için bu bilgi başka hiçbir yerden geri kurulamaz.
//
// "Şimdilik Geç" (empty) ve tekrar çalışma turları satır ÜRETMEZ: zamanlamaya
// da işlemezler. Ertelemenin izi `afterPostpone` alanında kalır.
const scheduleState = () => ({
    interval: Number,
    easeFactor: Number,
    repetitions: Number,
    masteryLevel: Number
});

const ReviewLogSchema = new mongoose.Schema({
    user: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    word: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Word',
        required: true
    },
    reviewedAt: {
        type: Date,
        required: true
    },
    // Kullanıcının KENDİ saat dilimindeki gün başlangıcı. "Günün cevabı"
    // kuralının anahtarı: bir kelime günde yalnızca bir kez sayılır.
    day: {
        type: Date,
        required: true
    },
    result: {
        type: String,
        enum: ['correct', 'easy', 'wrong'],
        required: true
    },
    // Cevap aynı gün "Şimdilik Geç"ten SONRA mı geldi — tereddüt sinyali
    afterPostpone: {
        type: Boolean,
        default: false
    },
    // typed: metni sunucu puanladı (hatırlama) · reported: sonucu istemci
    // bildirdi (şık/kart — tanıma). İkisinin hatırlama oranı aynı şey değildir.
    answerMode: {
        type: String,
        enum: ['typed', 'reported'],
        required: true
    },
    // Kelimenin ilk gerçek cevabı; önceki tekrar yoktur, elapsedDays null'dır
    firstReview: {
        type: Boolean,
        default: false
    },
    // Önceki gerçek tekrardan beri geçen gün. UserWord.lastReviewDate'ten
    // HESAPLANMAZ (ertelemeler de onu tazeler); vade − aralık'tan türetilir.
    elapsedDays: {
        type: Number,
        default: null
    },
    before: {
        ...scheduleState(),
        dueAt: Date
    },
    after: scheduleState(),
    wordLevel: String,     // kelimenin seviyesi
    lessonLevel: String,   // dersin seviyesi — tekrarlar başka seviyeden gelebilir
    poolNo: Number,        // 2 = kullanıcının kendi isteğiyle açtığı ekstra havuz
    // Satırı üreten zamanlayıcı; algoritma değişince eski satırlar ayırt edilsin
    scheduler: {
        type: String,
        default: 'sm2'
    },
    // İstemci gönderirse sorunun ekranda kaldığı süre
    durationMs: Number
}, { versionKey: false });

ReviewLogSchema.index({ user: 1, word: 1, day: 1 }, { unique: true });
ReviewLogSchema.index({ reviewedAt: 1 });

module.exports = mongoose.model('ReviewLog', ReviewLogSchema);
