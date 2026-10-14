// Üretilmiş ses dosyalarını (kelime + örnek cümle) çalışan sunucuya yükler ve
// kelimelere bağlar.
//
// Kullanım:
//   npm run import-audio -- --dir ~/Belgeler/musubi-tts/cikti --dry-run
//   npm run import-audio -- --dir ~/Belgeler/musubi-tts/cikti --api https://musubi.alpsoysoft.com
//
//   --dir <klasör>       ses dosyalarının kökü (zorunlu)
//   --manifest <dosya>   liste dosyası (varsayılan: <dir>/manifest.json, yoksa dosya adlarından kurulur)
//   --api <adres>        sunucu (varsayılan: http://localhost:5000)
//   --level N5           yalnızca bu seviye
//   --kind word|example  yalnızca bu tür
//   --dry-run            sunucuya dokunmadan listeyi ve dosyaları denetler
//
// Kimlik: MUSUBI_ADMIN_EMAIL ve MUSUBI_ADMIN_PASSWORD (ortam değişkeni ya da
// .env). Hesap admin olmalı: npm run make-admin -- <e-posta>
//
// NEDEN DOĞRUDAN VERİTABANINA YAZMIYOR: dosyaların durduğu yer sunucunun
// diskidir (Railway Volume). Bu betik bilgisayarda canlı veritabanına bağlanıp
// çalışsaydı dosyalar Railway'e değil bu bilgisayarın diskine yazılır,
// veritabanında var görünen sesler canlıda 404 dönerdi. O yüzden dosyalar
// çalışan uygulamanın kendi ucundan (POST /api/words/audio) geçer.
//
// YENİDEN ÇALIŞTIRILABİLİR: yarıda kesilirse baştan başlatmak yeter. Aynı dosya
// ikinci kez geldiğinde sunucu "değişmedi" der; sesi değişen kelimenin eski
// dosyası sunucuda silinir.
//
// ——— Liste dosyası (manifest) ———
// JSON dizisi ya da satır başına bir JSON nesnesi. Her satır bir ses dosyası:
//   { "level": "N5", "order": 1, "word": "食べる", "kind": "word", "file": "n5/0001-kelime.mp3" }
// Türkçe alan adları da kabul edilir (seviye, sira, kelime, tur, dosya) ve
// tür "kelime"/"cumle" yazılabilir. `word` isteğe bağlı ama ÖNERİLİR: sunucu
// onu veritabanındaki kelimeyle karşılaştırır, liste bir satır kayarsa yanlış
// kelimeye ses yazılmaz.
//
// Liste yoksa dosya adlarından kurulur: <dir>/n5/0001-kelime.mp3,
// <dir>/n5/0001-cumle.mp3 (klasör = seviye, sayı = veri setindeki order).
// Bu durumda kelime karşılaştırması yapılamaz.
const fs = require('fs');
const path = require('path');
require('dotenv').config({ quiet: true });
const { isMp3 } = require('../utils/audio.util');

const BATCH = 50;                    // sunucudaki MAX_AUDIO_BATCH ile aynı
const MAX_BYTES = 512 * 1024;        // sunucudaki MAX_AUDIO_BYTES ile aynı
const LEVELS = ['N5', 'N4', 'N3', 'N2', 'N1'];
const KINDS = {
    word: 'word', kelime: 'word',
    example: 'example', cumle: 'example', 'cümle': 'example', sentence: 'example'
};

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const option = (name) => {
    const i = args.indexOf(`--${name}`);
    return i >= 0 ? args[i + 1] : undefined;
};
const die = (message) => { console.error(message); process.exit(1); };
const expandHome = (p) => (p?.startsWith('~') ? path.join(process.env.HOME || '', p.slice(1)) : p);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// Listedeki bir satırı sunucunun beklediği biçime çevirir (Türkçe/İngilizce
// alan adları, "n5" → "N5", "kelime" → "word")
const normalizeEntry = (raw) => {
    const pick = (...keys) => keys.map(k => raw[k]).find(v => v !== undefined && v !== null && v !== '');
    const kindRaw = String(pick('kind', 'tur', 'tür', 'type') ?? '').toLocaleLowerCase('tr');
    return {
        level: String(pick('level', 'seviye', 'jlptLevel') ?? '').toUpperCase(),
        order: Number(pick('order', 'sira', 'sıra')),
        word: pick('word', 'kelime'),
        kind: KINDS[kindRaw],
        file: pick('file', 'dosya', 'path')
    };
};

const readManifest = (file) => {
    const text = fs.readFileSync(file, 'utf8').trim();
    if (text.startsWith('[') || text.startsWith('{"items"')) {
        const data = JSON.parse(text);
        return Array.isArray(data) ? data : data.items;
    }
    // Satır başına bir JSON nesnesi (JSON Lines)
    return text.split('\n').filter(l => l.trim()).map(l => JSON.parse(l));
};

// Liste yokken: <dir>/<seviye>/<sıra>-<tür>.mp3 adlarından kurar
const scanDirectory = (dir) => {
    const entries = [];
    for (const levelDir of fs.readdirSync(dir, { withFileTypes: true })) {
        if (!levelDir.isDirectory() || !LEVELS.includes(levelDir.name.toUpperCase())) continue;
        for (const name of fs.readdirSync(path.join(dir, levelDir.name)).sort()) {
            const match = /^(\d+)[-_ ](.+)\.mp3$/i.exec(name);
            if (!match) continue;
            entries.push({
                level: levelDir.name,
                order: Number(match[1]),
                kind: match[2],
                file: path.join(levelDir.name, name)
            });
        }
    }
    return entries;
};

async function main() {
    const dir = expandHome(option('dir'));
    if (!dir) die('Kullanım: npm run import-audio -- --dir <klasör> [--api <adres>] [--dry-run]');
    if (!fs.existsSync(dir)) die(`Klasör bulunamadı: ${dir}`);

    const manifestPath = expandHome(option('manifest')) || path.join(dir, 'manifest.json');
    const hasManifest = fs.existsSync(manifestPath);
    const rawEntries = hasManifest ? readManifest(manifestPath) : scanDirectory(dir);
    console.log(hasManifest
        ? `Liste: ${manifestPath} (${rawEntries.length} satır)`
        : `Liste dosyası yok, dosya adlarından kuruldu (${rawEntries.length} dosya) — kelime karşılaştırması YAPILAMAZ`);

    // ——— Yerel denetim: sunucuya gitmeden yakalanabilecek her şey ———
    const onlyLevel = option('level')?.toUpperCase();
    const onlyKind = KINDS[option('kind')?.toLocaleLowerCase('tr')];
    const ready = [];
    const problems = [];
    rawEntries.forEach((raw, line) => {
        const e = normalizeEntry(raw);
        const where = `satır ${line + 1}${e.file ? ` (${e.file})` : ''}`;
        if (!LEVELS.includes(e.level)) return problems.push(`${where}: seviye N5-N1 olmalı`);
        if (!Number.isInteger(e.order) || e.order < 1) return problems.push(`${where}: sıra pozitif tam sayı olmalı`);
        if (!e.kind) return problems.push(`${where}: tür "word"/"kelime" ya da "example"/"cumle" olmalı`);
        if (!e.file) return problems.push(`${where}: dosya adı yok`);
        if ((onlyLevel && e.level !== onlyLevel) || (onlyKind && e.kind !== onlyKind)) return;

        const full = path.resolve(dir, e.file);
        if (!fs.existsSync(full)) return problems.push(`${where}: dosya bulunamadı`);
        const buffer = fs.readFileSync(full);
        if (buffer.length > MAX_BYTES) return problems.push(`${where}: ${Math.round(buffer.length / 1024)} KB (sınır ${MAX_BYTES / 1024} KB)`);
        if (!isMp3(buffer)) return problems.push(`${where}: MP3 değil`);
        ready.push({ ...e, buffer });
    });

    // Aynı kelimeye aynı türden iki dosya: hangisinin kalacağı sıraya bağlı
    // olurdu, sessizce birini ezmek yerine söyle
    const seen = new Map();
    for (const e of ready) {
        const id = `${e.level}#${e.order}/${e.kind}`;
        if (seen.has(id)) problems.push(`${id}: iki dosya var (${seen.get(id)} ve ${e.file})`);
        seen.set(id, e.file);
    }

    const total = (kind) => ready.filter(e => e.kind === kind).length;
    console.log(`Yüklenecek: ${ready.length} dosya (${total('word')} kelime, ${total('example')} cümle), `
        + `${(ready.reduce((n, e) => n + e.buffer.length, 0) / 1024 / 1024).toFixed(1)} MB`);
    if (problems.length) {
        console.log(`\nYerel denetimde ${problems.length} sorun:`);
        problems.slice(0, 30).forEach(p => console.log('  - ' + p));
        if (problems.length > 30) console.log(`  … ve ${problems.length - 30} tane daha`);
    }
    if (flag('dry-run')) {
        console.log('\n--dry-run: sunucuya hiçbir şey gönderilmedi.');
        process.exit(problems.length ? 1 : 0);
    }
    if (ready.length === 0) die('Yüklenecek dosya yok.');

    // ——— Giriş ———
    const api = (option('api') || `http://localhost:${process.env.PORT || 5000}`).replace(/\/+$/, '') + '/api';
    const email = process.env.MUSUBI_ADMIN_EMAIL;
    const password = process.env.MUSUBI_ADMIN_PASSWORD;
    if (!email || !password) die('MUSUBI_ADMIN_EMAIL ve MUSUBI_ADMIN_PASSWORD tanımlı olmalı (ortam değişkeni ya da .env)');
    console.log(`\nSunucu: ${api}`);

    const json = async (res) => res.json().catch(() => ({}));
    const loginRes = await fetch(`${api}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, deviceName: 'import-audio' })
    });
    const login = await json(loginRes);
    if (!loginRes.ok) die(`Giriş başarısız (${loginRes.status}): ${login.message || ''}`);
    let { accessToken } = login;
    const { refreshToken } = login;

    // Access token 15 dakikada ölüyor; büyük yükleme daha uzun sürebilir
    const refresh = async () => {
        const res = await fetch(`${api}/auth/refresh`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ refreshToken })
        });
        const body = await json(res);
        if (!res.ok) die(`Oturum yenilenemedi (${res.status}): ${body.message || ''}`);
        accessToken = body.data.accessToken;
    };

    const sendBatch = async (batch) => {
        for (let attempt = 0; attempt < 6; attempt++) {
            const form = new FormData();
            form.append('items', JSON.stringify(
                batch.map(({ level, order, word, kind }) => ({ level, order, kind, ...(word !== undefined && { word }) }))
            ));
            // Dosya adı sıra numarası: sunucu dosyaları items ile SIRAYLA eşleştirir
            batch.forEach((e, i) => form.append('audio', new Blob([e.buffer], { type: 'audio/mpeg' }), `${i}.mp3`));

            const res = await fetch(`${api}/words/audio`, {
                method: 'POST',
                headers: { Authorization: `Bearer ${accessToken}` },
                body: form
            });
            if (res.status === 401) { await refresh(); continue; }
            if (res.status === 429) {
                const wait = Number(res.headers.get('retry-after') || res.headers.get('ratelimit-reset')) || 60;
                console.log(`  hız sınırı: ${wait} sn bekleniyor…`);
                await sleep((wait + 1) * 1000);
                continue;
            }
            const body = await json(res);
            if (!res.ok) die(`Yükleme reddedildi (${res.status}): ${body.message || ''}`);
            return body.data;
        }
        die('Yükleme art arda başarısız oldu, daha sonra yeniden çalıştırın.');
    };

    // ——— Yükleme ———
    const sum = { stored: 0, unchanged: 0, failed: 0 };
    const failures = [];
    for (let start = 0; start < ready.length; start += BATCH) {
        const batch = ready.slice(start, start + BATCH);
        const data = await sendBatch(batch);
        sum.stored += data.summary.stored;
        sum.unchanged += data.summary.unchanged;
        sum.failed += data.summary.failed;
        data.results
            .filter(r => r.status !== 'stored' && r.status !== 'unchanged')
            .forEach(r => failures.push({ file: batch[r.index].file, status: r.status, message: r.message }));
        console.log(`  ${Math.min(start + BATCH, ready.length)}/${ready.length}`);
    }

    console.log(`\nBitti: ${sum.stored} yüklendi, ${sum.unchanged} değişmedi, ${sum.failed} başarısız.`);
    const report = path.join(dir, 'import-audio-hatalar.json');
    // Önceki çalıştırmanın raporu bu çalıştırmayı anlatmaz
    fs.rmSync(report, { force: true });
    if (failures.length) {
        fs.writeFileSync(report, JSON.stringify(failures, null, 2));
        console.log(`Başarısızlar: ${report}`);
        failures.slice(0, 20).forEach(f => console.log(`  - ${f.file}: ${f.message}`));
    }
    process.exit(failures.length || problems.length ? 1 : 0);
}

main().catch(err => die(`Beklenmeyen hata: ${err.message}`));
