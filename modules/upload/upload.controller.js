const catchAsync = require('../../utils/catchAsync');
const AppError = require('../../utils/AppError');
const UploadService = require('./upload.service');

const UploadController = {
    uploadImage: catchAsync(async (req, res) => {
        if (!req.file) {
            throw new AppError("Görsel dosyası gerekli (multipart/form-data, alan adı: 'image')", 400);
        }
        // preset multipart alanı olarak da query olarak da gelebilir: multipart
        // gövdesinde alan sırası dosyadan sonra olursa multer onu req.body'ye
        // koyar, ama bazı istemciler sıralamayı garanti etmez.
        const preset = req.body?.preset || req.query.preset || 'story';
        const result = await UploadService.storeImage(req.file.buffer, preset);
        res.status(201).json({ success: true, data: { ...result, preset } });
    }),

    deleteImage: catchAsync(async (req, res) => {
        const key = req.query.key || req.body?.key;
        await UploadService.deleteImage(key);
        res.status(200).json({ success: true, message: 'Görsel silindi' });
    })
};

module.exports = UploadController;
