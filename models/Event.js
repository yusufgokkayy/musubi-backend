const mongoose = require('mongoose');

// Analitik olay kaydı: retention (D1/D7), özellik kullanımı ve ileride XP
// sistemi bu koleksiyonun üzerine kurulur. Yazımlar fire-and-forget'tir
// (utils/event.util.js) — ana akışı asla yavaşlatmaz/bozmaz.
const EventSchema = new mongoose.Schema({
    user: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    // ör: register, login, daily_pool_created, answer_submitted,
    //     quiz_started, quiz_completed, session_completed
    type: {
        type: String,
        required: true
    },
    data: {
        type: Object,
        default: {}
    },
    createdAt: {
        type: Date,
        default: Date.now
    }
});

EventSchema.index({ user: 1, createdAt: -1 });
EventSchema.index({ type: 1, createdAt: -1 });

module.exports = mongoose.model('Event', EventSchema);
