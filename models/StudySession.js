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

module.exports = mongoose.model('StudySession', StudySessionSchema);