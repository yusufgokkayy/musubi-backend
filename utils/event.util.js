const Event = require('../models/Event');

// Analitik olay yazar — fire-and-forget: await edilmez, asla hata fırlatmaz.
// Log yazılamaması hiçbir kullanıcı akışını etkilememelidir.
const logEvent = (userId, type, data = {}) => {
    if (!userId || !type) return;
    Event.create({ user: userId, type, data }).catch(() => {});
};

module.exports = logEvent;
