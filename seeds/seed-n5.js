const mongoose = require('mongoose');
const dotenv = require('dotenv');
const Word = require('../models/Word');
const words = require('./n5-words.json');

dotenv.config({ path: './config/.env' });

async function seed() {
    try {
        await mongoose.connect(process.env.MONGO_URI);
        console.log('MongoDB connected');

        const ops = words.map(w => ({
            updateOne: {
                filter: { kanji: w.kanji, jlptLevel: w.jlptLevel },
                update: { $setOnInsert: w },
                upsert: true
            }
        }));

        const result = await Word.bulkWrite(ops);
        console.log('Inserted:', result.upsertedCount);
        console.log('Already existed:', result.matchedCount);

        await mongoose.disconnect();
    } catch (err) {
        console.error(err);
        process.exit(1);
    }
}

seed();