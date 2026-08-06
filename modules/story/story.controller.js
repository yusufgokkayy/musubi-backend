const catchAsync = require('../../utils/catchAsync');
const StoryService = require('./story.service');

const StoryController = {
    // Kullanıcı: anasayfanın üstündeki şerit
    getStories: catchAsync(async (req, res) => {
        const stories = await StoryService.getActiveStories(req.user._id);
        res.status(200).json({ success: true, data: stories });
    }),

    markOpened: catchAsync(async (req, res) => {
        await StoryService.markOpened(req.user._id, req.params.id);
        res.status(200).json({ success: true, message: 'Açılma kaydedildi' });
    }),

    markSeen: catchAsync(async (req, res) => {
        await StoryService.markSeen(req.user._id, req.params.id);
        res.status(200).json({ success: true, message: 'Görüldü olarak işaretlendi' });
    }),

    // Admin: panel
    listForAdmin: catchAsync(async (req, res) => {
        const stories = await StoryService.listForAdmin();
        res.status(200).json({ success: true, data: stories });
    }),

    createStory: catchAsync(async (req, res) => {
        const id = await StoryService.createStory(req.body, req.user._id);
        res.status(201).json({ success: true, data: { id } });
    }),

    updateStory: catchAsync(async (req, res) => {
        await StoryService.updateStory(req.params.id, req.body);
        res.status(200).json({ success: true, message: 'Hikâye güncellendi' });
    }),

    deleteStory: catchAsync(async (req, res) => {
        await StoryService.deleteStory(req.params.id);
        res.status(200).json({ success: true, message: 'Hikâye silindi' });
    }),

    reorder: catchAsync(async (req, res) => {
        await StoryService.reorder(req.body || {});
        res.status(200).json({ success: true, message: 'Sıralama kaydedildi' });
    })
};

module.exports = StoryController;
