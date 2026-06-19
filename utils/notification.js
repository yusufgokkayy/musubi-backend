const { getMessaging } = require('../config/firebase');

const sendNotification = async ({ token, title, body, data = {} }) => {
    if (!token) return;

    await getMessaging().send({
        token,
        notification: { title, body },
        data
    });
};

module.exports = sendNotification;