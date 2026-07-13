const mongoose = require('mongoose');
const bcrypt = require('bcrypt');

const UserSchema = new mongoose.Schema({
    name: {
        type: String,
        required: [true, 'Please provide a name']
    },
    surname: {
        type: String,
        // Apple ilk girişte bile soyadı göndermeyebilir; sosyal hesapta zorunlu değil
        required: [function () { return this.provider === 'local'; }, 'Please provide a surname'],
        default: ''
    },
    email: {
        type: String,
        required: [true, 'Please provide an email'],
        unique: true,
        match: [/^[\w-\.]+@([\w-]+\.)+[\w-]{2,}$/, 'Please provide a valid email']
    },
    password: {
        type: String,
        minlength: [8, 'Şifreniz çok kısa (en az 8 karakter olmalı)'],
        // Sosyal girişle açılan hesapların şifresi yoktur; sonradan
        // forgot-password ile şifre belirlerse hibrit hesaba dönüşür
        required: [function () { return this.provider === 'local'; }, 'Please provide a password'],
        select: false
    },
    provider: {
        type: String,
        enum: ['local', 'google', 'apple'],
        default: 'local'
    },
    providerId: String,
    profile_image: {
        type: String,
        default: 'default.jpg'
    },
    role: {
        type: String,
        enum: ['user', 'admin'],
        default: 'user'
    },
    active: {
        type: Boolean,
        default: true
    },
    isEmailVerified: {
        type: Boolean,
        default: false
    },
    dailyGoal: {
        type: Number,
        default: 20,
        min: 5,
        max: 50
    },
    notificationSettings: {
        dailyReminder: { type: Boolean, default: true },
        streakReminder: { type: Boolean, default: true },
        wordLevelDown: { type: Boolean, default: true }
    },
    // Ayarlar ekranındaki cihazlar arası senkron tercihler (Dil/Tema/Font Boyutu)
    preferences: {
        language: { type: String, enum: ['tr'], default: 'tr' },
        theme: { type: String, enum: ['light', 'dark', 'system'], default: 'light' },
        fontSize: { type: String, enum: ['small', 'medium', 'large'], default: 'medium' }
    },
    // "Reklamları Kaldır" — yalnızca satın alma doğrulaması set eder,
    // update-info üzerinden değiştirilemez
    isPremium: {
        type: Boolean,
        default: false
    },
    fcmToken: {
        type: String,
        select: false
    },
    timezone: {
        type: String,
        default: 'Europe/Istanbul'
    },
    emailVerificationToken: String,
    emailVerificationExpire: Date,
    resetPasswordToken: String,
    resetPasswordExpire: Date,
    createdAt: {
        type: Date,
        default: Date.now
    }
});

// Aynı sağlayıcı hesabı iki kullanıcıya bağlanamaz; local kullanıcıların
// providerId'si olmadığından partial filter ile index dışında tutulurlar
UserSchema.index(
    { provider: 1, providerId: 1 },
    { unique: true, partialFilterExpression: { providerId: { $exists: true } } }
);

UserSchema.pre('save', async function () {
    if (!this.isModified('password')) return;
    this.password = await bcrypt.hash(this.password, 10);
});

UserSchema.methods.comparePassword = async function (enteredPassword) {
    // Sosyal hesapta şifre yoktur; bcrypt'e undefined geçmek exception atar
    if (!enteredPassword || !this.password) return false;
    return await bcrypt.compare(enteredPassword, this.password);
};

module.exports = mongoose.model('User', UserSchema);