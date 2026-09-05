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
    // Turun başlama anı. "Bu TURDA dokunuldu mu" sorusunun tek ölçüsü:
    // ders barının payı (progress.completed), kuyruk (queue) ve "bu turda
    // ertelenenler" (postponedIds) bununla hesaplanır.
    //
    // Neden gün başlangıcı YETMİYOR: tur kapanırken ertelenmiş kelimeler yeni
    // tura TAŞINIYOR (bkz. userword.service.js carry-over notu) ve taşınan
    // kelimenin lastResult'ı hâlâ 'empty'. Gün kapsamıyla ölçseydik kelime
    // yeni turda da "ertelenmiş" görünür, kuyruğa hiç girmez, yani taşımanın
    // amacı tersine dönerdi. Tur kapsamında ise "bu turda henüz dokunulmadı"
    // olur ve sırasını bekler. Gün sayaçları (StudySession.emptyCount)
    // bundan etkilenmez — onlar bilerek gün kapsamlıdır.
    //
    // Eski kayıtlarda yok: okurken gün başlangıcına düşülür, yani bu alan
    // gelmeden önceki davranış birebir korunur.
    roundStartedAt: {
        type: Date
    },
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

// Bir havuzun o günkü boyutu — yalnızca GÜNCEL turun gerçek dizi uzunluğu.
// targetGoal BİLEREK kullanılmaz: havuz kıtlıktan hedefin altında kurulmuş
// olabilir, "kaç kelime var" sorusunun cevabı her zaman gerçek içerik olmalı.
//
// Burada durur çünkü iki tüketicisi var: anasayfa ilerleme çemberinin paydası
// (home.service.js) ve "Bugünün Görevi" hatırlatmasının kalan iş hesabı
// (notification.service.js). İki yerde kopyalanırsa biri güncellenip diğeri
// unutulur ve çember ile bildirim farklı sayılar söylemeye başlar.
DailyWordPoolSchema.statics.goalTotal = (pool) =>
    pool.newWordIds.length + pool.reviewWordIds.length;

module.exports = mongoose.model('DailyWordPool', DailyWordPoolSchema);