const resend = require('../config/resend');

const sendEmail = async ({ to, subject, html }) => {
    await resend.emails.send({
        from: process.env.EMAIL_FROM,
        to,
        subject,
        html
    });
};

module.exports = sendEmail;