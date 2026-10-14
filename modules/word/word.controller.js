const catchAsync = require('../../utils/catchAsync');
const AppError = require('../../utils/AppError');
const WordService = require('./word.service');

const WordController = {
    getAllWords: catchAsync(async (req, res) => {
        const { jlptLevel, type, q, page, limit, includeAll } = req.query;
        const result = await WordService.getAllWords({
            jlptLevel, type, q, page, limit,
            includeAll: includeAll === 'true'
        });
        res.status(200).json({ success: true, data: result });
    }),

    getWordById: catchAsync(async (req, res) => {
        const word = await WordService.getWordById(req.params.id);
        res.status(200).json({ success: true, data: word });
    }),

    searchWords: catchAsync(async (req, res) => {
        const { q } = req.query;
        if (!q) throw new AppError('Please provide a search query', 400);
        const words = await WordService.searchWords(q);
        res.status(200).json({ success: true, data: words });
    }),

    // Toplu ses yükleme (yalnızca admin). `items` multipart alanı JSON METNİ
    // olarak gelir; ayrıştırılamıyorsa hiçbir dosya yazılmadan 400 döner.
    uploadAudio: catchAsync(async (req, res) => {
        let items;
        try {
            items = JSON.parse(req.body?.items ?? '');
        } catch {
            throw new AppError('items alanı geçerli bir JSON dizisi olmalı', 400);
        }
        const result = await WordService.importAudio(req.files, items);
        res.status(200).json({ success: true, data: result });
    }),

    // createWord: catchAsync(async (req, res) => {
    //     const word = await WordService.createWord(req.body);
    //     res.status(201).json({ success: true, data: word });
    // }),

    // updateWord: catchAsync(async (req, res) => {
    //     const word = await WordService.updateWord(req.params.id, req.body);
    //     res.status(200).json({ success: true, data: word });
    // }),

    // deleteWord: catchAsync(async (req, res) => {
    //     await WordService.deleteWord(req.params.id);
    //     res.status(200).json({ success: true, message: 'Word deleted' });
    // })
};

module.exports = WordController;