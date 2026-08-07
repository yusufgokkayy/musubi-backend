const mongoose = require('mongoose');

const UserWordSchema = new mongoose.Schema({
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
    status: {
        type: String,
        enum: ['new', 'learning', 'learned'],
        default: 'new'
    },
    interval: {
        type: Number,
        default: 1
    },
    easeFactor: {
        type: Number,
        default: 2.5
    },
    repetitions: {
        type: Number,
        default: 0
    },
    nextReviewDate: {
        type: Date,
        default: Date.now
    },
    correctCount: {
        type: Number,
        default: 0
    },
    wrongCount: {
        type: Number,
        default: 0
    },
    lastReviewDate: {
        type: Date
    },
    // Son cevabın sonucu — "bugün cevaplandı mı, sonucu neydi" bilgisini
    // /userwords/today'in kaldığı-yerden-devam işaretlemesi buradan okur
    // (Event log'u fire-and-forget olduğu için güvenilir kaynak değildir)
    lastResult: {
        type: String,
        enum: ['correct', 'easy', 'empty', 'wrong']
    },
    masteryLevel: {
        type: Number,
        min: 1,
        max: 5,
        default: 1
    },
    // Kelimenin "sayılan bölgeye" (masteryLevel >= 3 — seviye kilidini açan
    // eşiğin TA KENDİSİ) en son girdiği an. Hafıza ekranındaki "Bu hafta +23
    // kelime iyiye geçti" çipinin tek kaynağı. Seviye 3'ün altına düşerse
    // null'lanır ki kelime geri tırmandığında o hafta yeniden sayılsın.
    // Event log'dan türetilmez: yazımlar fire-and-forget'tir, güvenilir kaynak
    // değildir (bkz. yukarıdaki lastResult notu). Geçmiş kayıtlar BİLEREK
    // doldurulmadı — doldurulsaydı özelliğin ilk haftası devasa sahte bir sayı
    // gösterirdi; alan yalnızca bugünden sonraki geçişleri biriktirir.
    promotedAt: {
        type: Date,
        default: null
    },
    createdAt: {
        type: Date,
        default: Date.now
    }
}, {
    // Aynı kelimeye eşzamanlı iki cevap (çift tıklama/otomatik yeniden deneme)
    // ikisi de "bugün henüz cevaplanmamış" okuyup ikisini de sayabiliyordu —
    // save() artık okunan __v ile çakışırsa VersionError atar; submitAnswer
    // bunu yakalayıp taze durumu yeniden okur (bkz. userword.service.js).
    optimisticConcurrency: true
});

UserWordSchema.index({ user: 1, word: 1 }, { unique: true });
UserWordSchema.index({ user: 1, masteryLevel: 1 });
UserWordSchema.index({ user: 1, promotedAt: 1 });

module.exports = mongoose.model('UserWord', UserWordSchema);