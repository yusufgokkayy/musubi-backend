const express = require('express');
const HomeController = require('./home.controller');
const { protect, isEmailVerified } = require('../../middlewares/auth.middleware');

const router = express.Router();

router.get('/summary',  protect, isEmailVerified, HomeController.getSummary);
router.get('/calendar', protect, isEmailVerified, HomeController.getCalendar);
router.get('/day/:date', protect, isEmailVerified, HomeController.getDayDetail);

module.exports = router;