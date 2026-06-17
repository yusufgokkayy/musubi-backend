const mongoose = require('mongoose');

const connectDatabase = async () => {
    await mongoose.connect(process.env.MONGO_URI);
    console.log('MongoDB connected');
};

module.exports = connectDatabase;