// Veri sağlığı teşhisi: kelime seed'i ve kullanıcıların seviye kayıtları.
//
// Uygulamanın iki sessiz arıza biçimini tek komutta görünür kılar:
//   1) Kelimelerde isCore yoksa (ör. alan eklenmeden önce seed edilmiş kayıtlar)
//      ders, kütüphane, quiz ve hafıza BOŞ gelir ama hepsi 200 OK döner.
//   2) Kullanıcının 5 seviye kaydı eksikse "Öğrenme Seviyen" listesi boş gelir.
//      Uygulama bunu artık okuma anında onarıyor (ProgressService.ensureProgress),
//      ama --fix ile kullanıcının ekranı açmasını beklemeden toptan onarılır.
//
// Kullanım:
//   node scripts/check-data.js            # yalnızca RAPOR, hiçbir yazma yok
//   node scripts/check-data.js --fix      # eksik seviye kayıtlarını onarır
//   MONGO_URI=".../musubi" node scripts/check-data.js   # başka DB'ye bakmak için
const mongoose = require('mongoose');
const dotenv = require('dotenv');
const Word = require('../models/Word');
const User = require('../models/User');
const Progress = require('../models/Progress');
const ProgressService = require('../modules/progress/progress.service');

dotenv.config();

const LEVELS = ProgressService.LEVELS;
const fix = process.argv.includes('--fix');

async function main() {
    await mongoose.connect(process.env.MONGO_URI);
    console.log(`DB: ${mongoose.connection.name}${fix ? '  (--fix AÇIK: eksik kayıtlar onarılacak)' : '  (salt okunur)'}\n`);

    // ---------- Kelimeler ----------
    const total = await Word.countDocuments({});
    const alansiz = await Word.countDocuments({ isCore: { $exists: false } });
    console.log(`KELİMELER — toplam ${total}`);
    for (const level of LEVELS) {
        const all = await Word.countDocuments({ jlptLevel: level });
        const core = await Word.countDocuments({ jlptLevel: level, isCore: true });
        const uyari = core === 0 ? '   ← ÇEKİRDEK KELİME YOK, bu seviye her yerde boş görünür' : '';
        console.log(`  ${level}: ${String(all).padStart(5)} kayıt | isCore:true ${String(core).padStart(5)}${uyari}`);
    }
    if (alansiz) {
        console.log(`  ⚠ ${alansiz} kayıtta isCore ALANI HİÇ YOK (şema öncesi veri).`);
        console.log('    Çözüm: npm run seed — veri setindeki kelimeleri yerinde günceller,');
        console.log('    mükerrer kayıt üretmez, wipe gerekmez. Veri setinde olmayan kayıtlar');
        console.log('    isCore almadıkları için uygulamaya görünmez, isteğe bağlı temizlenir.');
    }

    // ---------- Kullanıcıların seviye kayıtları ----------
    const userCount = await User.countDocuments({});
    const progressCount = await Progress.countDocuments({});
    console.log(`\nKULLANICILAR — ${userCount} hesap | ${progressCount} seviye kaydı (beklenen ${userCount * LEVELS.length})`);

    const bozuk = await User.aggregate([
        { $lookup: { from: Progress.collection.name, localField: '_id', foreignField: 'user', as: 'p' } },
        { $project: { email: 1, provider: 1, activeLevel: 1, isEmailVerified: 1, createdAt: 1, n: { $size: '$p' } } },
        { $match: { n: { $ne: LEVELS.length } } },
        { $sort: { createdAt: 1 } }
    ]);

    if (!bozuk.length) {
        console.log('  Tüm hesapların 5 seviye kaydı tam.');
    } else {
        console.log(`  ⚠ ${bozuk.length} hesabın seviye kaydı eksik — "Öğrenme Seviyen" listesi boş gelir:`);
        bozuk.forEach(u => console.log(
            `    - ${u.email} | kayıt ${u.n}/${LEVELS.length} | ${u.provider || 'local'}` +
            ` | doğrulanmış:${u.isEmailVerified} | activeLevel:${u.activeLevel || '(yok)'}` +
            ` | ${u.createdAt ? u.createdAt.toISOString().slice(0, 10) : '?'}`
        ));

        if (fix) {
            for (const u of bozuk) {
                await ProgressService.ensureProgress(u._id);
            }
            console.log(`\n  ${bozuk.length} hesap onarıldı (mevcut ilerleme korunarak).`);
        } else {
            console.log('\n  Onarmak için: node scripts/check-data.js --fix');
        }
    }

    await mongoose.disconnect();
}

main().catch(err => {
    console.error('HATA:', err.message);
    process.exit(1);
});
