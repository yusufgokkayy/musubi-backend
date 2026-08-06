const jwt = require('jsonwebtoken');
const User = require('../models/User');
const AppError = require('../utils/AppError');
const catchAsync = require('../utils/catchAsync');

const protect = catchAsync(async (req, res, next) => {
    let token;

    if (req.headers.authorization?.startsWith('Bearer')) {
        token = req.headers.authorization.split(' ')[1];
    }

    if (!token) {
        return next(new AppError('Not authorized', 401));
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = await User.findById(decoded.id);

    if (!req.user) {
        return next(new AppError('User not found', 401));
    }

    next();
});

// Token varsa kullanıcıyı çözer, yoksa/bozuksa sessizce devam eder.
// Hem oturumlu hem oturumsuz çağrılabilen uçlar için (ör. GET /auth/consents:
// giriş ekranı yalnızca güncel sürümleri sorar, girişli kullanıcı ayrıca
// kendi rıza durumunu da alır). protect'in yerine GEÇMEZ — koruma gereken
// yerde protect kullanılmalı.
const optionalAuth = catchAsync(async (req, res, next) => {
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer')) return next();

    try {
        const decoded = jwt.verify(header.split(' ')[1], process.env.JWT_SECRET);
        req.user = await User.findById(decoded.id);
    } catch {
        // Süresi dolmuş/bozuk token oturumsuz sayılır, istek reddedilmez
    }
    next();
});

const isEmailVerified = (req, res, next) => {
    if (!req.user.isEmailVerified) {
        return next(new AppError('Please verify your email first', 403));
    }
    next();
};

const isAdmin = (req, res, next) => {
    if (req.user.role !== 'admin') {
        return next(new AppError('Not authorized', 403));
    }
    next();
};

module.exports = { protect, optionalAuth, isEmailVerified, isAdmin };