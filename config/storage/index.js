// Depolama adaptörü — uygulamanın geri kalanı dosyaların NEREDE durduğunu bilmez.
//
// Sözleşme (her sürücü bunu sağlar):
//   put(buffer, { folder, filename }) → key      dosyayı yazar, key döner
//   remove(key)                       → void     yoksa da hata vermez
//   publicUrl(key)                    → string   tarayıcı/uygulama için tam URL
//   servesLocally                     → boolean  true ise app.js /uploads'ı statik sunar
//
// KRİTİK: veritabanında `url` DEĞİL `key` saklanır. URL sürücüye göre değişir
// (bugün railway.app/uploads/..., yarın res.cloudinary.com/...); key değişmez.
// Böylece sağlayıcı değiştirmek "dosyaları taşı + STORAGE_DRIVER'ı değiştir"
// olur; kayıtlı binlerce satırı yeniden yazan bir migrasyon script'i gerekmez.
const drivers = {
    local: () => require('./local.storage')
    // cloudinary: () => require('./cloudinary.storage')   ← hesap açılınca eklenecek
};

const name = (process.env.STORAGE_DRIVER || 'local').trim();
const load = drivers[name];
if (!load) {
    throw new Error(
        `Bilinmeyen STORAGE_DRIVER="${name}". Geçerli sürücüler: ${Object.keys(drivers).join(', ')}`
    );
}

const driver = load();

module.exports = { ...driver, driverName: name };
