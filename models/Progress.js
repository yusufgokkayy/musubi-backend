const mongoose = require('mongoose');

const ProgressSchema = new mongoose.Schema({
    user: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    jlptLevel: {
        type: String,
        enum: ['N5', 'N4', 'N3', 'N2', 'N1'],
        required: true
    },
    isUnlocked: {
        type: Boolean,
        default: false
    },
    unlockedAt: {
        type: Date
    },
    unlockedBy: {
        type: String,
        enum: ['study', 'quiz'],  // çalışarak mı quiz ile mi açtı
    },
    completionRate: {
        type: Number,
        default: 0  // yüzde olarak
    },
    createdAt: {
        type: Date,
        default: Date.now
    }
});

ProgressSchema.index({ user: 1, jlptLevel: 1 }, { unique: true });

module.exports = mongoose.model('Progress', ProgressSchema);