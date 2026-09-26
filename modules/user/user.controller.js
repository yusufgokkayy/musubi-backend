const catchAsync = require('../../utils/catchAsync');
const AppError = require('../../utils/AppError');
const UserService = require('./user.service');

const UserController = {
    setAvatar: catchAsync(async (req, res) => {
        if (!req.file) {
            throw new AppError("Görsel dosyası gerekli (multipart/form-data, alan adı: 'image')", 400);
        }
        const data = await UserService.setAvatar(req.user.id, req.file.buffer);
        res.status(200).json({ success: true, data });
    }),

    removeAvatar: catchAsync(async (req, res) => {
        const data = await UserService.removeAvatar(req.user.id);
        res.status(200).json({ success: true, data });
    })
};

module.exports = UserController;
