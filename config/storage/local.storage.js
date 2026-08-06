// Yerel dosya sistemi sürücüsü — dosyalar diske yazılır, Express `/uploads`
// altından statik servis eder.
//
// ⚠️ Railway'de konteynerin diski KALICI DEĞİLDİR: her deploy yeni bir konteyner
// başlatır ve bir öncekinin yazdığı her şey kaybolur. Bu sürücü canlıda ancak
// servise bir Volume bağlanıp UPLOAD_DIR o mount path'e ayarlanırsa güvenlidir
// (örn. UPLOAD_DIR=/data/uploads). Volume yoksa hata vermez, sessizce veri
// kaybeder — tuzağın adı budur.
const fs = require('fs/promises');
const path = require('path');
const clientUrl = require('../../utils/clientUrl');

// Kök dizin ÇAĞRI ANINDA okunur, modül yüklenirken değil: testler ve
// seed script'leri UPLOAD_DIR'i require sırasından bağımsız ayarlayabilsin.
const root = () => path.resolve(process.env.UPLOAD_DIR || './uploads');

// key = "<klasör>/<dosya>" — depolama sürücüleri arasında taşınabilir tek kimlik.
// Tam URL DEĞİL: URL sürücüye göre değişir, key değişmez (bkz. config/storage/index.js).
const put = async (buffer, { folder, filename }) => {
    const dir = path.join(root(), folder);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, filename), buffer);
    return `${folder}/${filename}`;
};

const remove = async (key) => {
    try {
        await fs.unlink(path.join(root(), key));
    } catch (err) {
        // Zaten yoksa silme başarılı sayılır: silme çağrısı idempotent olmalı
        if (err.code !== 'ENOENT') throw err;
    }
};

const publicUrl = (key) => clientUrl(`/uploads/${key}`);

module.exports = { put, remove, publicUrl, root, servesLocally: true };
