const mongoose = require('mongoose');

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
    // Session tamamlandığında set edilir (studysession.service.js), tur
    // yenilendiğinde (userword.service.js) null'a döner. StudySession.isCompleted
    // KULLANILMAZ: /sessions/start her çağrıldığında onu hemen false'a
    // sıfırlıyor (bul-veya-yeniden-aç) — istemci "başlat, sonra kelimeleri
    // getir" sırasıyla çağırırsa (en doğal akış) tetikleyici hiç görülmeden
    // silinirdi. Bu alan o çağrı sırasından tamamen bağımsız.
    roundClosedAt: {
        type: Date
    },
    // Bu havuz/tur kurulurken hedeflenen dailyGoal. Havuz kıtlıktan (yeterli
    // tekrar/yeni kelime yok) hedefin altında kurulabilir — poolSize'ı hedef
    // sanıp her /today çağrısında yeniden doldurmaya çalışmak, hiçbir şey
    // bulunamasa bile payda sabit kalsın diye targetGoal ayrı tutulur.
    // Genişleme yalnızca dailyGoal bu değerin ÜSTÜNE çıkınca tetiklenir.
    targetGoal: {
        type: Number
    }
});

// Kullanıcı aynı gün farklı JLPT seviyeleri için ayrı havuz oluşturabilir
DailyWordPoolSchema.index({ user: 1, date: 1, jlptLevel: 1 }, { unique: true });

module.exports = mongoose.model('DailyWordPool', DailyWordPoolSchema);