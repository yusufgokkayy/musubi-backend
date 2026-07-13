const mongoose = require('mongoose');

const QuizQuestionSchema = new mongoose.Schema({
    word: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Word',
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
    // placement: ilk giriş seviye belirleme merdiveni | levelup: seviye atlama sınavı
    type: {
        type: String,
        enum: ['placement', 'levelup'],
        required: true
    },
    jlptLevel: {
        type: String,
        enum: ['N5', 'N4', 'N3', 'N2', 'N1'],
        required: true
    },
    status: {
        type: String,
        enum: ['in_progress', 'completed', 'expired'],
        default: 'in_progress'
    },
    questions: {
        type: [QuizQuestionSchema],
        required: true
    },
    score: {
        type: Number
    },
    // Doğru cevap sayısı — placement sonuç özeti basamak toplamlarını bundan hesaplar
    correctCount: {
        type: Number
    },
    passed: {
        type: Boolean
    },
    // O seviye için art arda kaçıncı başarısız levelup denemesi
    failCount: {
        type: Number,
        default: 0
    },
    // Başarısız levelup sonrası bir sonraki denemenin serbest kaldığı an
    nextAttemptAllowedAt: {
        type: Date
    },
    completedAt: {
        type: Date
    },
    createdAt: {
        type: Date,
        default: Date.now
    }
});

QuizAttemptSchema.index({ user: 1, type: 1, jlptLevel: 1, createdAt: -1 });

module.exports = mongoose.model('QuizAttempt', QuizAttemptSchema);
