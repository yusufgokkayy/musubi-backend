const mongoose = require('mongoose');

// GÜNÜN HAVUZU. 21.09.2026'dan beri gün başına en fazla İKİ havuz olabilir ve
// her havuz KENDİ dokümanıdır (eskiden ikinci tur aynı dokümanın üzerine
// yazılıyor, birinci turun içeriği kayboluyordu).
const DailyWordPoolSchema = new mongoose.Schema({
    user: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    date: {
        type: Date,
        required: true
    },
    jlptLevel: {
        type: String,
        enum: ['N5', 'N4', 'N3', 'N2', 'N1']
    },
    reviewWordIds: [{
        type: mongoose.Schema.Types.ObjectId,
        ref: 'UserWord'
    }],
    newWordIds: [{
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Word'
    }],
    // 1 = günün hedefi, 2 = kullanıcının isteğiyle açılan ekstra havuz.
    // İkinci havuz yalnızca birincide dokunulmamış VE ertelenmiş kelime
    // kalmayınca açılabilir (bkz. userword.service.js openNextPool).
    poolNo: {
        type: Number,
        default: 1,
        min: 1,
        max: 2
    },
    startedAt: {
        type: Date,
        default: Date.now
    },
    // Bu havuz kurulurken hedeflenen boyut. Havuz kıtlıktan (yeterli tekrar/yeni
    // kelime yok) hedefin altında kurulabilir; poolSize'ı hedef sanıp her /today
    // çağrısında yeniden doldurmaya çalışmak paydayı sessizce büyütüyordu.
    targetGoal: {
        type: Number
    }
});

// Gün + seviye + havuz numarası tekildir. Eskiden anahtar {user,date,jlptLevel}
// idi; ikinci havuz ayrı doküman olduğu için poolNo anahtara girdi.
DailyWordPoolSchema.index({ user: 1, date: 1, jlptLevel: 1, poolNo: 1 }, { unique: true });

// Bir havuzun gerçek boyutu. targetGoal BİLEREK kullanılmaz: havuz kıtlıktan
// hedefin altında kurulmuş olabilir, "kaç kelime var" sorusunun cevabı her
// zaman gerçek içeriktir.
//
// Burada durur çünkü üç tüketicisi var: anasayfa çemberinin paydası
// (home.service.js), ders ekranının paydası (userword.service.js) ve
// "Bugünün Görevi" hatırlatmasının kalan iş hesabı (notification.service.js).
DailyWordPoolSchema.statics.goalTotal = (pool) =>
    pool ? pool.newWordIds.length + pool.reviewWordIds.length : 0;

module.exports = mongoose.model('DailyWordPool', DailyWordPoolSchema);
