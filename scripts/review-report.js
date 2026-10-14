// Hatırlama raporu: kullanıcılar kelimeleri gerçekten hatırlıyor mu?
//
// Tekrar geçmişinden (ReviewLog) okur, HİÇBİR ŞEY YAZMAZ. Her tekrarı, cevaptan
// önce kelimeye verilmiş aralığa göre kovalar ve o kovada kaç cevabın doğru
// olduğunu basar. Zamanlayıcı iyi çalışıyorsa oran kovalar arasında birbirine
// yakın ve ~%85-90 civarında durur; uzun aralıklarda düşüyorsa aralıklar fazla
// iyimser, hep %95+ ise kullanıcıya gereksiz tekrar yaptırılıyor demektir.
//
// Kullanım:
//   npm run review-report
//   MONGO_URI=".../musubi" node scripts/review-report.js   # başka DB'ye bakmak için
const mongoose = require('mongoose');
const dotenv = require('dotenv');
const ReviewLog = require('../models/ReviewLog');

// SM-2 merdiveninin basamakları: 1 → 6 → 15 → 38 → 95 gün
const INTERVAL_BUCKETS = [
    { min: 0, label: '1 gün' },
    { min: 2, label: '2-6 gün' },
    { min: 7, label: '7-15 gün' },
    { min: 16, label: '16-38 gün' },
    { min: 39, label: '39+ gün' }
];

const CORRECT = { $cond: [{ $in: ['$result', ['correct', 'easy']] }, 1, 0] };

const withRate = (row) => ({
    ...row,
    recall: row.count ? Math.round((row.correct / row.count) * 100) : null
});

async function buildReport() {
    const [totals] = await ReviewLog.aggregate([
        { $group: {
            _id: null,
            count: { $sum: 1 },
            users: { $addToSet: '$user' },
            from: { $min: '$reviewedAt' },
            to: { $max: '$reviewedAt' }
        } }
    ]);
    if (!totals) return { count: 0, users: 0, firstReviews: withRate({ count: 0, correct: 0 }), byInterval: [], byMode: [] };

    const [first] = await ReviewLog.aggregate([
        { $match: { firstReview: true } },
        { $group: { _id: null, count: { $sum: 1 }, correct: { $sum: CORRECT } } }
    ]);

    // İlk cevaplar hariç: onların önceki aralığı yok, hatırlama ölçmezler
    const buckets = await ReviewLog.aggregate([
        { $match: { firstReview: { $ne: true } } },
        { $bucket: {
            groupBy: '$before.interval',
            boundaries: INTERVAL_BUCKETS.map(b => b.min),
            default: INTERVAL_BUCKETS[INTERVAL_BUCKETS.length - 1].min,
            output: {
                count: { $sum: 1 },
                correct: { $sum: CORRECT },
                // Vadesinden ne kadar SONRA soruldu (borç birikiyor mu?)
                avgLateDays: { $avg: { $subtract: ['$elapsedDays', '$before.interval'] } }
            }
        } }
    ]);
    const byMin = new Map(buckets.map(b => [b._id, b]));

    const modes = await ReviewLog.aggregate([
        { $match: { firstReview: { $ne: true } } },
        { $group: { _id: '$answerMode', count: { $sum: 1 }, correct: { $sum: CORRECT } } },
        { $sort: { _id: 1 } }
    ]);

    return {
        count: totals.count,
        users: totals.users.length,
        from: totals.from,
        to: totals.to,
        firstReviews: withRate({ count: first?.count || 0, correct: first?.correct || 0 }),
        byInterval: INTERVAL_BUCKETS.map(b => {
            const row = byMin.get(b.min);
            return withRate({
                label: b.label,
                count: row?.count || 0,
                correct: row?.correct || 0,
                avgLateDays: row?.avgLateDays == null ? null : Math.round(row.avgLateDays * 10) / 10
            });
        }),
        byMode: modes.map(m => withRate({ mode: m._id, count: m.count, correct: m.correct }))
    };
}

const pct = (v) => (v == null ? '   —' : `%${String(v).padStart(3)}`);

async function main() {
    dotenv.config();
    await mongoose.connect(process.env.MONGO_URI);
    console.log(`DB: ${mongoose.connection.name}  (salt okunur)\n`);

    const r = await buildReport();
    if (!r.count) {
        console.log('Tekrar geçmişi boş: henüz sayılan cevap yok.');
        return;
    }

    const gun = (d) => d.toISOString().slice(0, 10);
    console.log(`TEKRAR GEÇMİŞİ — ${r.count} cevap | ${r.users} kullanıcı | ${gun(r.from)} → ${gun(r.to)}`);
    console.log(`\nİLK CEVAPLAR (kelime ilk kez soruldu) — ${r.firstReviews.count} cevap | doğru ${pct(r.firstReviews.recall)}`);

    console.log('\nHATIRLAMA — cevaptan önceki aralığa göre');
    for (const b of r.byInterval) {
        const gecikme = b.avgLateDays == null ? '' : ` | ort. gecikme ${b.avgLateDays} gün`;
        console.log(`  ${b.label.padEnd(10)} ${String(b.count).padStart(6)} cevap | doğru ${pct(b.recall)}${gecikme}`);
    }

    console.log('\nCEVAP BİÇİMİNE GÖRE (ilk cevaplar hariç)');
    for (const m of r.byMode) {
        const ad = m.mode === 'typed' ? 'yazarak' : 'şık/kart';
        console.log(`  ${ad.padEnd(10)} ${String(m.count).padStart(6)} cevap | doğru ${pct(m.recall)}`);
    }
}

if (require.main === module) {
    main()
        .catch((err) => { console.error('Hata:', err.message); process.exitCode = 1; })
        .finally(() => mongoose.disconnect());
}

module.exports = { buildReport };
