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
    }]
});

DailyWordPoolSchema.index({ user: 1, date: 1 }, { unique: true });

module.exports = mongoose.model('DailyWordPool', DailyWordPoolSchema);