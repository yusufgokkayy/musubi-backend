const resend = require('../config/resend');

// Test ortamında gerçek gönderim yapılmaz: mailler outbox'ta biriktirilir ki
// testler alıcıyı/linki doğrulayabilsin. failNextSend() bir sonraki gönderimi
// bilerek patlatır (register rollback gibi hata yollarını test etmek için).
const outbox = [];
let failNext = false;

const sendEmail = async ({ to, subject, html }) => {
    if (process.env.NODE_ENV === 'test') {
        if (failNext) {
            failNext = false;
            throw new Error('Simulated email failure');
        }
        outbox.push({ to, subject, html });
        return;
    }

    if (!process.env.EMAIL_FROM) {
        throw new Error('EMAIL_FROM tanımlı değil (.env)');
    }

    // Resend SDK hata durumunda exception ATMAZ, { data, error } döner.
    // error kontrol edilmezse başarısız gönderim sessizce başarılı sanılır
    // ve register/reset akışlarındaki rollback'ler hiç tetiklenmez.
    const { data, error } = await resend.emails.send({
        from: process.env.EMAIL_FROM,
        to,
        subject,
        html,
        // Doğrulama/sıfırlama mailleri zamana duyarlı işlem mailleridir: yüksek
        // öncelik başlıkları istemcide öne çıkarır. Not: spam'e düşmemenin asıl
        // belirleyicisi bu başlıklar değil, EMAIL_FROM domain'inin Resend'de
        // SPF+DKIM+DMARC ile doğrulanmış olmasıdır.
        headers: {
            'X-Priority': '1',
            'X-MSMail-Priority': 'High',
            'Importance': 'high'
        }
    });

    if (error) {
        throw new Error(`Resend: ${error.message || error.name || 'bilinmeyen hata'}`);
    }
    return data;
};

sendEmail.outbox = outbox;
sendEmail.failNextSend = () => { failNext = true; };

module.exports = sendEmail;
