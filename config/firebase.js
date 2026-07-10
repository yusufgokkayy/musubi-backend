const { initializeApp, cert } = require('firebase-admin/app');
const { getMessaging } = require('firebase-admin/messaging');

// Anahtar dosyası olmayan ortamlarda (CI, anahtarsız geliştirici makinesi)
// uygulama çökmesin; push sessizce devre dışı kalır.
let messaging = null;

try {
    const serviceAccount = require('../firebase-service-account.json');
    initializeApp({ credential: cert(serviceAccount) });
    messaging = getMessaging();
} catch (err) {
    console.warn('Firebase başlatılamadı (firebase-service-account.json eksik/bozuk) — push bildirimleri devre dışı');
}

module.exports = {
    getMessaging: () => messaging
};
