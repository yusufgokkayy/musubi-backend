const express = require('express');
const HomeController = require('./home.controller');
const { protect } = require('../../middlewares/auth.middleware');

const router = express.Router();

router.get('/summary',  HomeController.getSummary);
router.get('/calendar', HomeController.getCalendar);
router.get('/day/:date', HomeController.getDayDetail);

module.exports = router;