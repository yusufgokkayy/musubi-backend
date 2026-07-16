// Kullanıcı verisi temizliği — kelime kataloğuna (words) DOKUNMAZ.
// Test dönemi sıfırlamaları için: hesaplar, SRS ilerlemesi, oturumlar,
// bildirimler ve quiz geçmişi silinir; seed edilmiş kelimeler aynen kalır
// (yeniden seed gerekmez, isCore seçimi ve kelime id'leri korunur).
//
// Kullanım:  node seeds/wipe-user-data.js         → yalnızca sayıları gösterir (dry-run)
//            node seeds/wipe-user-data.js --yes   → gerçekten siler
const mongoose = require('mongoose');
const dotenv = require('dotenv');

dotenv.config();

const MODELS = [
    require('../models/User'),
    require('../models/UserWord'),
    require('../models/Progress'),
    require('../models/Streak'),
    require('../models/StudySession'),
    require('../models/DailyWordPool'),
    require('../models/Notification'),
    require('../models/QuizAttempt'),
    require('../models/DeviceSession'),
    require('../models/Event')
];

async function wipe() {
    const confirmed = process.argv.includes('--yes');

    await mongoose.connect(process.env.MONGO_URI);
    console.log(`Bağlanıldı: ${mongoose.connection.name}\n`);

    for (const Model of MODELS) {
        const count = await Model.countDocuments();
        if (confirmed) {
            await Model.deleteMany({});
            console.log(`  ${Model.collection.name}: ${count} kayıt silindi`);
        } else {
            console.log(`  ${Model.collection.name}: ${count} kayıt silinecek`);
        }
    }

    const Word = require('../models/Word');
    console.log(`\n  words: ${await Word.countDocuments()} kelime KORUNUYOR`);

    if (!confirmed) {
        console.log('\nDry-run — silmek için: node seeds/wipe-user-data.js --yes');
    }

    await mongoose.disconnect();
}

wipe().catch(err => {
    console.error(err);
    process.exit(1);
});
