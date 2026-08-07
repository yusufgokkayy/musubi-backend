const catchAsync = require('../../utils/catchAsync');
const MemoryService = require('./memory.service');

const MemoryController = {
    getMemory: catchAsync(async (req, res) => {
        const data = await MemoryService.getMemory(req.user.id, req.query.jlptLevel);
        res.status(200).json({ success: true, data });
    }),

    getBoxWords: catchAsync(async (req, res) => {
        const { box, jlptLevel, page, limit } = req.query;
        const data = await MemoryService.getBoxWords(req.user.id, { box, jlptLevel, page, limit });
        res.status(200).json({ success: true, data });
    })
};

module.exports = MemoryController;
