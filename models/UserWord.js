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
    createdAt: {
        type: Date,
        default: Date.now
    }
});

UserWordSchema.index({ user: 1, word: 1 }, { unique: true });

module.exports = mongoose.model('UserWord', UserWordSchema);