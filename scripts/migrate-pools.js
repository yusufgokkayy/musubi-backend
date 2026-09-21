// Havuz modeli geçişi (21.09.2026)
//
// Eski şema: gün+seviye başına TEK havuz dokümanı, ikinci tur aynı dokümanın
// üzerine yazılıyordu. Alanlar: roundStartedAt / roundClosedAt.
// Yeni şema: her havuz kendi dokümanı, poolNo (1|2) + startedAt.
//
// Ne yapar:
//   1. poolNo'su olmayan havuzlara poolNo: 1 yazar.
//   2. roundStartedAt → startedAt taşır (yoksa date'e düşer).
//   3. Eski tekil indeksi ({user,date,jlptLevel}) düşürür; yenisini Mongoose kurar.
//
// Eski alanlar SİLİNMEZ: bir sorun çıkarsa önceki sürüm aynı veriyle çalışmaya
// devam edebilsin. İdempotenttir, iki kez çalıştırmak bir şey bozmaz.
//
// Kullanım: node scripts/migrate-pools.js [--dry]
const mongoose = require('mongoose');

const ESKI_INDEX = 'user_1_date_1_jlptLevel_1';

const migratePools = async (db, { dry = false, log = () => {} } = {}) => {
    const col = db.collection('dailywordpools');
    const sonuc = { poolNo: 0, startedAt: 0, indexDropped: false };

    const poolNoSuz = await col.countDocuments({ poolNo: { $exists: false } });
    const startedAtSiz = await col.countDocuments({ startedAt: { $exists: false } });
    log(`poolNo'suz havuz: ${poolNoSuz}, startedAt'siz havuz: ${startedAtSiz}`);

    if (!dry) {
        if (poolNoSuz > 0) {
            const r = await col.updateMany({ poolNo: { $exists: false } }, { $set: { poolNo: 1 } });
            sonuc.poolNo = r.modifiedCount;
        }
        // startedAt: önce roundStartedAt, yoksa günün başlangıcı (date)
        const eksikler = await col.find({ startedAt: { $exists: false } })
            .project({ roundStartedAt: 1, date: 1 }).toArray();
        for (const p of eksikler) {
            await col.updateOne(
                { _id: p._id },
                { $set: { startedAt: p.roundStartedAt || p.date } }
            );
            sonuc.startedAt += 1;
        }

        const indexler = await col.indexes();
        if (indexler.some(i => i.name === ESKI_INDEX)) {
            await col.dropIndex(ESKI_INDEX);
            sonuc.indexDropped = true;
            log(`eski tekil indeks düşürüldü: ${ESKI_INDEX}`);
        }
    }

    return sonuc;
};

const main = async () => {
    require('dotenv').config({ path: './.env' });
    const dry = process.argv.includes('--dry');
    if (!process.env.MONGO_URI) throw new Error('MONGO_URI tanımlı değil');

    await mongoose.connect(process.env.MONGO_URI);
    console.log(dry ? '— KURU ÇALIŞMA (hiçbir şey yazılmaz) —' : '— GEÇİŞ BAŞLIYOR —');

    const sonuc = await migratePools(mongoose.connection.db, { dry, log: console.log });
    console.log('sonuç:', sonuc);

    // Yeni tekil indeks (user,date,jlptLevel,poolNo) modelden kurulur
    if (!dry) {
        await require('../models/DailyWordPool').syncIndexes();
        console.log('yeni indeksler kuruldu');
    }
    await mongoose.disconnect();
};

if (require.main === module) {
    main().catch(err => { console.error(err); process.exit(1); });
}

module.exports = { migratePools, ESKI_INDEX };
