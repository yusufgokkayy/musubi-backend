const { initializeApp, cert } = require('firebase-admin/app');
const { getMessaging } = require('firebase-admin/messaging');
const serviceAccount = require('../firebase-service-account.json');

initializeApp({
    credential: cert(serviceAccount)
});

module.exports = { getMessaging };