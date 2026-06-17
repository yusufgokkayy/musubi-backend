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

module.exports = { protect, isEmailVerified, isAdmin };