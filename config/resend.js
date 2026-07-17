const { Resend } = require('resend');

// Tembel kurulum: Resend constructor'ı API key yokken fırlatıyor. Kurulum
// require anında yapılırsa .env'siz ortamlar (CI, test) daha uygulama
// yüklenirken çöker — key'in gerçekten gerektiği an gönderim anıdır.
let client;
const getResend = () => {
    if (!client) client = new Resend(process.env.RESEND_API_KEY);
    return client;
};

module.exports = getResend;
