const catchAsync = require('../../utils/catchAsync');
const AppError = require('../../utils/AppError');
const WordService = require('./word.service');

const WordController = {
    getAllWords: catchAsync(async (req, res) => {
        const { jlptLevel, type, page, limit, includeAll } = req.query;
        const result = await WordService.getAllWords({
            jlptLevel, type, page, limit,
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