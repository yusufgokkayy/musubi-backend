// Faz 1 import: üretilmiş meaningTr JSONL dosyalarını DB'ye işler.
// Yalnız meaningTr ve type alanlarını günceller; meaning (İngilizce) korunur.
// GECE KOŞULMAZ — sabah kullanıcı onayıyla, önce dry-run.
//
// Kullanım: node content-pipeline/06-import-tr.js out/meaningtr-*.jsonl          (dry-run)
//           node content-pipeline/06-import-tr.js --apply out/meaningtr-*.jsonl
const mongoose = require('mongoose');
const dotenv = require('dotenv');
const fs = require('fs');
const Word = require('../models/Word');

dotenv.config();

const APPLY = process.argv.includes('--apply');
const files = process.argv.slice(2).filter(a => a !== '--apply');

if (!files.length) {
    console.error('Kullanım: node 06-import-tr.js [--apply] <dosya...>');
    process.exit(2);
}

async function main() {
    console.log(APPLY ? '== UYGULAMA MODU ==' : '== DRY-RUN (yazmak için --apply) ==');
    await mongoose.connect(process.env.MONGO_URI);

    const records = [];
    for (const f of files) {
        for (const line of fs.readFileSync(f, 'utf-8').split('\n')) {
            if (line.trim()) records.push(JSON.parse(line));
        }
    }
    console.log(`Kayıt: ${records.length} (${files.length} dosya)`);

    // id'ler DB'de var mı + kanji tutuyor mu (yanlış eşleşmeye karşı emniyet)
    const ids = records.map(r => new mongoose.Types.ObjectId(r.id));
    const existing = await Word.find({ _id: { $in: ids } }).select('kanji').lean();
    const byId = new Map(existing.map(w => [String(w._id), w]));

    const missing = [];
    const mismatch = [];
    const ok = [];
    for (const r of records) {
        const w = byId.get(r.id);
        if (!w) { missing.push(r); continue; }
        if (w.kanji !== r.kanji) { mismatch.push(`${r.id}: dosyada ${r.kanji}, DB'de ${w.kanji}`); continue; }
        ok.push(r);
    }

    if (missing.length) console.log(`DB'de bulunamayan id: ${missing.length} → ${missing.slice(0, 5).map(r => r.kanji).join(', ')}...`);
    for (const m of mismatch) console.log('KANJİ UYUŞMAZLIĞI ' + m);
    console.log(`Yazılacak: ${ok.length}`);

    if (APPLY && ok.length) {
        const result = await Word.bulkWrite(ok.map(r => ({
            updateOne: {
                filter: { _id: r.id },
                update: { $set: { meaningTr: r.meaningTr, type: r.type } }
            }
        })));
        console.log(`Güncellenen: ${result.modifiedCount}`);
        const kapsam = await Word.countDocuments({ meaningTr: { $exists: true, $ne: '' } });
        console.log(`Toplam meaningTr kapsamı: ${kapsam}/${await Word.countDocuments()}`);
    }

    await mongoose.disconnect();
    if (mismatch.length) process.exit(1);
}

main().catch(err => { console.error(err); process.exit(1); });
