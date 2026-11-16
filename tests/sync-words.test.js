// scripts/sync-words.js — eşleşme anahtarı (yazılış + okunuş + seviye) ve --sil davranışı.
// In-memory MongoDB; gerçek DB'ye dokunmaz.
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

let mongod, Word, UserWord, syncWords;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'musubi-sync-'));

const entry = (order, word, kana, meaningTr) => ({
    order, word, kana, type: 'isim', meaningTr, meaningEn: `${word} en`,
    meaningTrAccepted: [meaningTr], meaningEnAccepted: [`${word} en`],
    exampleJp: `**${word}**です。`, exampleTr: 'örnek'
});
const writeN5 = (dir, entries) => {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'musubi_n5.json'), JSON.stringify(entries));
};

before(async () => {
    try { mongod = await MongoMemoryServer.create(); }
    catch { process.env.MONGOMS_DISTRO = 'ubuntu-22.04'; mongod = await MongoMemoryServer.create(); }
    await mongoose.connect(mongod.getUri('musubi-sync-test'));
    Word = require('../models/Word');
    UserWord = require('../models/UserWord');
    ({ syncWords } = require('../scripts/sync-words'));
});

after(async () => {
    await mongoose.disconnect();
    await mongod?.stop();
    fs.rmSync(tmp, { recursive: true, force: true });
});

describe('sync-words', () => {
    it('yazılış+okunuş anahtarı, okunuş düzeltmesi, --sil ve bağlı kayıt koruması', async () => {
        const v1 = path.join(tmp, 'v1');
        writeN5(v1, [
            entry(1, '辛い', 'からい', 'acı (tat)'),
            entry(2, '手数', 'てかず', 'zahmet'),
            entry(3, '削除', 'さくじょ', 'silme'),
            entry(4, '残る', 'のこる', 'kalmak')
        ]);
        await syncWords(v1, { write: true, levels: ['N5'] });
        assert.strictEqual(await Word.countDocuments(), 4);
        const tekasu = await Word.findOne({ kanji: '手数' }).lean();
        const nokoru = await Word.findOne({ kanji: '残る' }).lean();
        // 残る'ya kullanıcı kaydı bağlı → silinmemeli
        await UserWord.collection.insertOne({ word: nokoru._id, user: new mongoose.Types.ObjectId() });

        const v2 = path.join(tmp, 'v2');
        writeN5(v2, [
            entry(1, '辛い', 'からい', 'acı (tat)'),
            entry(2, '辛い', 'つらい', 'zor, acı veren'),
            entry(3, '手数', 'てすう', 'zahmet')
        ]);

        // Deneme: hiçbir şey yazılmaz
        const dry = await syncWords(v2, { write: false, remove: true, levels: ['N5'] });
        assert.strictEqual(dry.seviyeler.N5.eklenecek, 1);
        assert.deepStrictEqual(dry.seviyeler.N5.silinecek, ['削除(さくじょ)']);
        assert.strictEqual(await Word.countDocuments(), 4);

        const r = await syncWords(v2, { write: true, remove: true, levels: ['N5'] });
        const s = r.seviyeler.N5;
        assert.strictEqual(s.eklenecek, 1);            // 辛い つらい
        assert.strictEqual(s.guncellenecek, 1);        // 手数 okunuşu
        assert.deepStrictEqual(s.silinecek, ['削除(さくじょ)']);
        assert.strictEqual(s.bagliKayit.length, 1);    // 残る korunur

        const karai = await Word.find({ kanji: '辛い' }).lean();
        assert.deepStrictEqual(karai.map(w => w.kana).sort(), ['からい', 'つらい']);
        const tekasu2 = await Word.findOne({ kanji: '手数' }).lean();
        assert.strictEqual(String(tekasu2._id), String(tekasu._id)); // aynı belge, ilerleme bağlı kalır
        assert.strictEqual(tekasu2.kana, 'てすう');
        assert.strictEqual(await Word.countDocuments({ kanji: '削除' }), 0);
        assert.strictEqual(await Word.countDocuments({ kanji: '残る' }), 1);

        // İkinci tur: değişiklik yok
        const again = await syncWords(v2, { write: true, levels: ['N5'] });
        assert.strictEqual(again.seviyeler.N5.eklenecek, 0);
        assert.strictEqual(again.seviyeler.N5.guncellenecek, 0);
    });
});
