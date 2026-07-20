const { initializeApp, cert } = require('firebase-admin/app');
const { getMessaging } = require('firebase-admin/messaging');

// Kimlik iki kaynaktan gelebilir (öncelik sırasıyla):
//   1. FIREBASE_SERVICE_ACCOUNT_B64 ortam değişkeni — servis hesabı JSON'unun
//      base64'ü. Railway'de dosya olmadığı için production bunu kullanır:
//      base64 -w0 config/firebase-service-account.json  → değişkene yapıştır
//   2. config/firebase-service-account.json dosyası — lokal geliştirme
// İkisi de yoksa uygulama çökmesin; push sessizce devre dışı kalır.
let messaging = null;

try {
    let serviceAccount;
    if (process.env.FIREBASE_SERVICE_ACCOUNT_B64) {
        serviceAccount = JSON.parse(
            Buffer.from(process.env.FIREBASE_SERVICE_ACCOUNT_B64, 'base64').toString('utf-8')
        );
    } else {
        serviceAccount = require('./firebase-service-account.json');
    }
    initializeApp({ credential: cert(serviceAccount) });
    messaging = getMessaging();
    console.log(`Firebase hazır (proje: ${serviceAccount.project_id}) — push bildirimleri aktif`);
} catch (err) {
    console.warn('Firebase başlatılamadı (FIREBASE_SERVICE_ACCOUNT_B64 veya config/firebase-service-account.json gerekli) — push bildirimleri devre dışı');
}

module.exports = {
    getMessaging: () => messaging
};
