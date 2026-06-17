const mongoose = require('mongoose');

const WordSchema = new mongoose.Schema({
    kanji: {
        type: String,
        required: [true, 'Please provide kanji']
    },
    romaji: {
        type: String,
        required: [true, 'Please provide romaji']
    },
    meaning: {
        type: String,
        required: [true, 'Please provide meaning']
    },
    type: {
        type: String,
        enum: ['fiil', 'sıfat', 'isim', 'zarf', 'diğer'],
        required: [true, 'Please provide word type']
    },
    jlptLevel: {
        type: String,
        enum: ['N5', 'N4', 'N3', 'N2', 'N1'],
        required: [true, 'Please provide JLPT level']
    },
    audioUrl: {
        type: String
    },
    createdAt: {
        type: Date,
        default: Date.now
    }
});

module.exports = mongoose.model('Word', WordSchema);