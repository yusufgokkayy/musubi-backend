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

// Bildirimler 30 gün sonra kendiliğinden silinir (MongoDB TTL). Kullanıcı başına
// günde 2-4 kayıt düşüyor; bir aydan eski bir "Bugünün Görevi" kaydının kimseye
// faydası yok ama depoyu dolduruyor (29.10.2026'ya kadar 90 gündü).
// Not: gün içi dedupe yalnızca bugüne bakar. Decay özetinin "son çalışmadan beri
// en fazla 3" kuralı ise bu süre kadar geriye bakabilir: uzun süre girmeyen
// kullanıcıya seviye özeti ayda en fazla 3 kez gider — bilinçli kabul edildi.
const TTL_SECONDS = 30 * 24 * 60 * 60;
NotificationSchema.index({ createdAt: 1 }, { expireAfterSeconds: TTL_SECONDS });

// Var olan TTL indeksinin süresi kodda değişince MongoDB yeni tanımı reddeder
// (IndexOptionsConflict) ve veritabanında eski süre sessizce kalır. Açılışta
// (server.js) mevcut indeks collMod ile koddaki süreye çekilir. Değiştirdiyse true.
NotificationSchema.statics.syncTtl = async function () {
    const indexes = await this.collection.indexes().catch(() => []);
    const ttl = indexes.find(i => i.key?.createdAt === 1 && i.expireAfterSeconds !== undefined);
    if (!ttl || ttl.expireAfterSeconds === TTL_SECONDS) return false;
    await this.db.db.command({
        collMod: this.collection.collectionName,
        index: { name: ttl.name, expireAfterSeconds: TTL_SECONDS }
    });
    return true;
};

module.exports = mongoose.model('Notification', NotificationSchema);
