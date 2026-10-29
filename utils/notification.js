// Modül nesnesi üzerinden çağrılır (destructure edilmez): testler
// firebase.getMessaging'i taklit edip gönderilen mesajı yakalayabilsin
const firebase = require('../config/firebase');

// FCM üzerinden tek cihaza push gönderir.
// Firebase başlatılamamışsa veya token yoksa sessizce atlar.
const sendNotification = async ({ token, title, body, data = {} }) => {
    const messaging = firebase.getMessaging();
    if (!token || !messaging) return null;

    // FCM data alanı yalnızca string değer kabul eder
    const stringData = {};
    for (const [key, value] of Object.entries(data)) {
        if (value !== undefined && value !== null) stringData[key] = String(value);
    }

    return messaging.send({
        token,
        notification: { title, body },
        data: stringData
    });
};

module.exports = sendNotification;
