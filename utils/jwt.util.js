const jwt = require('jsonwebtoken');
const crypto = require('crypto');

const signAccessToken = (id) => {
    return jwt.sign({ id }, process.env.JWT_SECRET, {
        expiresIn: process.env.JWT_EXPIRE || '15m'
    });
};

const signRefreshToken = (id) => {
    // jti: aynı saniyede üretilen iki token'ın birebir aynı string olmasını
    // engeller — cihaz oturumları token hash'iyle ayrıştığı için benzersizlik şart
    return jwt.sign({ id, jti: crypto.randomUUID() }, process.env.JWT_REFRESH_SECRET, {
        expiresIn: process.env.JWT_REFRESH_EXPIRE || '7d'
    });
};

const verifyRefreshToken = (token) => {
    return jwt.verify(token, process.env.JWT_REFRESH_SECRET);
};

module.exports = { signAccessToken, signRefreshToken, verifyRefreshToken };