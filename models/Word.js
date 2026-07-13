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
    // Kana okunuşu (えき) — kelime detay kartında kanjinin altında gösterilir.
    // Seed CSV'deki reading alanından gelir; eski kayıtlarda boş olabilir,
    // client boşsa romaji'ye düşmelidir.
    kana: {
        type: String
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
    // Kelimenin geçtiği örnek cümle (東京駅で会いましょう。) — kütüphane detay
    // kartındaki "Örnek Kullanım" ve boşluk doldurma sorusu bundan üretilir.
    // İçerik geldikçe dolar; boş olan kelimeler bu soru tipine girmez.
    example: {
        type: String
    },
    // Görselli soru için kelime görseli; boş olan kelimeler bu tipe girmez
    imageUrl: {
        type: String
    },
    // Aktif oyun havuzu: seviye başına frekansa göre seçilen çekirdek kelimeler
    // (N5:300, N4:400, N3:550, N2:750, N1:1000). seeds/select-core.js ile işaretlenir.
    isCore: {
        type: Boolean,
        default: false
    },
    frequencyRank: {
        type: Number
    },
    createdAt: {
        type: Date,
        default: Date.now
    }
});

WordSchema.index({ jlptLevel: 1, isCore: 1 });

module.exports = mongoose.model('Word', WordSchema);