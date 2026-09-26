const mongoose = require('mongoose');

const NotificationSchema = new mongoose.Schema({
    user: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        index: true
    },
    type: {
        type: String,
        enum: ['daily_word', 'streak_reminder', 'daily_task', 'streak_warning', 'word_level_down', 'test'],
        required: true
    },
    title: {
        type: String,
        required: true
    },
    body: {
        type: String
    },
    data: {
        type: Object,
        default: {}
    },
    read: {
        type: Boolean,
        default: false
    },
    createdAt: {
        type: Date,
        default: Date.now
    }
});

NotificationSchema.index({ user: 1, read: 1, createdAt: -1 });

// Bildirimler 90 gün sonra kendiliğinden silinir (MongoDB TTL). Her kullanıcıya
// günde birkaç kayıt düşüyor ve eskiden hiç silinmiyordu; 90 günden eski bir
// "Bugünün Görevi" kaydının kimseye faydası yok ama depoyu dolduruyor.
// Not: bildirim tekrar kısıtları (gün içi dedupe, decay özetinin "son
// çalışmadan beri en fazla 3" kuralı) en fazla birkaç günlük geçmişe bakar.
NotificationSchema.index({ createdAt: 1 }, { expireAfterSeconds: 90 * 24 * 60 * 60 });

module.exports = mongoose.model('Notification', NotificationSchema);
