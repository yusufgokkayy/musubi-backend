const mongoose = require('mongoose');

const QuizQuestionSchema = new mongoose.Schema({
    word: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Word',
        required: true
    },
    // meaning: kelime göster anlam seçtir | reverse: anlam göster kelime seçtir | reading: kanji göster okunuş seçtir
    format: {
        type: String,
        enum: ['meaning', 'reverse', 'reading'],
        required: true
    },
    prompt: {
        type: Object,
        required: true
    },
    choices: {
        type: [String],
        required: true
    },
    // Cevap anahtarı — client'a asla gönderilmez (controller sanitize eder)
    correctIndex: {
        type: Number,
        required: true
    }
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
