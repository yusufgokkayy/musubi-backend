const express = require('express');
const dotenv = require('dotenv');
const connectDatabase = require('./config/db');
const errorHandler = require('./middlewares/errorHandler');
const cors = require('cors');
const cron = require('node-cron');
const StreakService = require('./modules/streak/streak.service');

dotenv.config({ path: './config/.env' });

connectDatabase();

const app = express();

app.use(cors());

app.use(express.json());

app.use('/api/auth', require('./modules/auth/auth.routes'));
app.use('/api/words', require('./modules/word/word.routes'));
app.use('/api/userwords', require('./modules/userword/userword.routes'));
app.use('/api/sessions', require('./modules/studysession/studysession.routes'));
app.use('/api/progress', require('./modules/progress/progress.routes'));
app.use('/api/streak', require('./modules/streak/streak.routes'));
app.use('/api/home', require('./modules/home/home.routes'));

// Her gece 00:01'de çalışır
cron.schedule('1 0 * * *', async () => {
    console.log('Streak reset çalışıyor...');
    await StreakService.resetExpiredStreaks();
});

app.use(errorHandler);

process.on('unhandledRejection', (err) => {
    console.error('Unhandled Rejection:', err.message);
    process.exit(1);
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT} - ${process.env.NODE_ENV}`);
});