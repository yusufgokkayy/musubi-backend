const express = require('express');
const StoryController = require('./story.controller');
const { isAdmin } = require('../../middlewares/auth.middleware');

const router = express.Router();

// Kullanıcı uçları — giriş + doğrulanmış e-posta app.js'te mount seviyesinde
router.get('/', StoryController.getStories);
router.post('/:id/opened', StoryController.markOpened);
router.post('/:id/seen', StoryController.markSeen);

// Admin uçları. SABİT yollar (/admin, /order) ':id' olanlardan ÖNCE gelmeli;
// aksi halde Express "/api/stories/admin"i id parametresi sanıp CastError verir.
router.get('/admin', isAdmin, StoryController.listForAdmin);
router.put('/order', isAdmin, StoryController.reorder);
router.post('/', isAdmin, StoryController.createStory);
router.put('/:id', isAdmin, StoryController.updateStory);
router.delete('/:id', isAdmin, StoryController.deleteStory);

module.exports = router;
