const mongoose = require('mongoose');

const StudySessionSchema = new mongoose.Schema({
    user: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    date: {
        type: Date,
        default: Date.now
    },
    // Oturumun ait olduğu günün BAŞLANGICI (kullanıcının saat diliminde gece
    // yarısı, UTC olarak). Tek işi aşağıdaki tekillik index'i: "günde tek
    // oturum" kuralı eskiden yalnızca bul-yoksa-oluştur ile korunuyordu ve
    // aynı anda gelen iki /sessions/start (çift dokunma) günün İKİ oturumunu
    // açabiliyordu — sayaçlar ikiye bölünüyordu. `date` alanı oluşturma anı
    // olduğu için index'e uygun değil; bu alan günü temsil eder.
    // Eski kayıtlarda yok (partial index onları dışarıda bırakır).
    dayStart: {
        type: Date
    },
    totalWords: {
        type: Number,
        default: 0
    },
    correctCount: {
        type: Number,
        default: 0
    },
    wrongCount: {
        type: Number,
        default: 0
    },
    emptyCount: {
        type: Number,
        default: 0
    },
    duration: {
        type: Number,  // dakika cinsinden
        default: 0
    },
    jlptLevel: {
        type: String,
        enum: ['N5', 'N4', 'N3', 'N2', 'N1']
    },
    completedAt: {
        type: Date
    },
    isCompleted: {
        type: Boolean,
        default: false
    }
});

StudySessionSchema.index({ user: 1, date: 1 });
StudySessionSchema.index(
    { user: 1, dayStart: 1 },
    { unique: true, partialFilterExpression: { dayStart: { $type: 'date' } } }
);

// "X/Y Tamamlandı" ifadesinin PAYI: günün NİHAİ cevabı verilmiş kelime sayısı.
//
// totalWords BURADA KULLANILAMAZ: o, kelimeye dokunulduğu anda artar ve
// "Şimdilik Geç"i de sayar. Ertelenen kelime ise gün içinde yeniden sorulur,
// yani ders bitmemiştir — 18 kelime ertelenmişken başlık "20/20 Tamamlandı"
// derken kuyrukta 18 kelime kalıyordu (06.08.2026'da bildirilen hata). Üstelik
// sayaç bundan sonra donuyordu: ertelenenin gerçek cevabı emptyCount'u
// düşürür ama totalWords'e dokunmaz.
//
// correctCount + wrongCount tercih edilir (totalWords - emptyCount yerine):
// bu ikisi doğrudan artar, emptyCount'un ise negatife düşmeye karşı bir
// düzeltmesi var — türetilmiş değer o düzeltmeden etkilenmemeli.
//
// Burada durur çünkü üç tüketicisi var: anasayfa çemberi (home.service.js),
// ders ekranının başlığı (userword.service.js) ve gün detayı. Kopyalanırsa
// biri güncellenip diğeri unutulur, ekranlar yine farklı sayı söyler.
StudySessionSchema.statics.completedTotal = (session) =>
    (session?.correctCount || 0) + (session?.wrongCount || 0);

module.exports = mongoose.model('StudySession', StudySessionSchema);