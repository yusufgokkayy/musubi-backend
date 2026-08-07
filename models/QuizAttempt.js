const mongoose = require('mongoose');

const QuizQuestionSchema = new mongoose.Schema({
    word: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Word',
        required: true
    },
    // Sorunun çekildiği seviye. Sınav artık TEK denemede beş seviyeden soru
    // sorduğu için seviye deneme başına değil SORU başına anlamlı: soru
    // ekranındaki "N4" rozeti buradan çizilir ve seviye belirleme hesabı
    // (seviye bazlı doğruluk oranı) bu alanla gruplanır.
    jlptLevel: {
        type: String,
        enum: ['N5', 'N4', 'N3', 'N2', 'N1'],
        required: true
    },
    // meaning: kelime göster anlam seçtir | reverse: anlam göster kelime seçtir |
    // reading: kanji göster okunuş seçtir | typing: kelime göster anlamını YAZDIR (şıksız) |
    // fillblank: örnek cümlede boşluğa gelecek kelimeyi seçtir | image: görsele uyan kelimeyi seçtir
    format: {
        type: String,
        enum: ['meaning', 'reverse', 'reading', 'typing', 'fillblank', 'image'],
        required: true
    },
    prompt: {
        type: Object,
        required: true
    },
    choices: {
        type: [String],
        // Yazma sorusunun şıkkı yoktur
        required: function () { return this.format !== 'typing'; }
    },
    // Cevap anahtarı — client'a asla gönderilmez (controller sanitize eder)
    correctIndex: {
        type: Number,
        required: function () { return this.format !== 'typing'; }
    },
    // Yazma sorusunun kabul edilen cevapları (anlam + virgülle ayrılmış varyantları).
    // Cevap anahtarıdır, client'a gönderilmez.
    correctAnswers: {
        type: [String],
        required: function () { return this.format === 'typing'; }
    },
    // Soru bazlı cevap akışı (POST /quiz/:id/answer): her sorunun cevabı anında
    // puanlanıp burada birikir; tüm sorular cevaplanınca deneme sonuçlanır
    yourAnswer: mongoose.Schema.Types.Mixed,
    isCorrect: Boolean,
    answeredAt: Date
}, { _id: false });

const QuizAttemptSchema = new mongoose.Schema({
    user: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        index: true
    },
    // Şimdilik tek tür: placement (Seviye Tespit Sınavı). Seviye atlama sınavı
    // (levelup) kaldırıldı — seviye artık yalnızca ustalıkla açılıyor (%75) ve
    // geçiş kullanıcının onayına bağlı. Alan enum olarak duruyor ki ileride
    // başka bir sınav türü gelirse şema kırılmasın.
    type: {
        type: String,
        enum: ['placement'],
        required: true
    },
    status: {
        type: String,
        // abandoned: kullanıcı sınavı yarıda bırakıp çıktı (tasarım: "Çık →
        // sınav geçersiz"). expired: 30 dk içinde bitirilmedi — ağ kopması gibi
        // durumlar için, kullanıcı iradesi değil.
        enum: ['in_progress', 'completed', 'expired', 'abandoned'],
        default: 'in_progress'
    },
    // Sınav sonucu: "Seviyen Belirlendi" ekranındaki seviye. Sınav bitince
    // kullanıcının activeLevel'ı da buraya taşınır (quiz.service.js).
    determinedLevel: {
        type: String,
        enum: ['N5', 'N4', 'N3', 'N2', 'N1']
    },
    questions: {
        type: [QuizQuestionSchema],
        required: true
    },
    score: {
        type: Number
    },
    // Doğru cevap sayısı — sonuç ekranındaki "7 Doğru / 23 Yanlış" çubuğu
    correctCount: {
        type: Number
    },
    completedAt: {
        type: Date
    },
    createdAt: {
        type: Date,
        default: Date.now
    }
});

// Cooldown ve "sınava girdi mi" sorguları hep (kullanıcı, tür, en yeni)
// üzerinden gidiyor; jlptLevel artık deneme seviyesinde olmadığı için indexten
// de çıktı.
QuizAttemptSchema.index({ user: 1, type: 1, createdAt: -1 });

module.exports = mongoose.model('QuizAttempt', QuizAttemptSchema);
