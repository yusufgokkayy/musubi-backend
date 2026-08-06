// Mevcut bir kullanıcıyı yönetici yapar (veya yöneticiliğini alır).
//
// Kullanım:
//   npm run make-admin -- ornek@mail.com
//   npm run make-admin -- ornek@mail.com --revoke
//
// Rol yükseltme BİLEREK panelde değil, burada: adminlik verme yetkisi de
// tarayıcıda olsaydı ele geçirilen tek bir admin oturumu kalıcı arka kapı
// açabilirdi. Bu script sunucuya/DB'ye erişimi olan kişiyi gerektirir.
const mongoose = require('mongoose');
const dotenv = require('dotenv');
const User = require('../models/User');

dotenv.config();

async function main() {
    const args = process.argv.slice(2);
    const revoke = args.includes('--revoke');
    const email = args.find(a => !a.startsWith('--'))?.trim().toLowerCase();

    if (!email) {
        console.error('Kullanım: npm run make-admin -- <e-posta> [--revoke]');
        process.exit(1);
    }
    if (!process.env.MONGO_URI) {
        console.error('MONGO_URI tanımlı değil (.env)');
        process.exit(1);
    }

    await mongoose.connect(process.env.MONGO_URI);

    const rol = revoke ? 'user' : 'admin';
    const user = await User.findOneAndUpdate(
        { email },
        { role: rol },
        { new: true }
    ).select('email name surname role isEmailVerified');

    if (!user) {
        console.error(`Kullanıcı bulunamadı: ${email}`);
        console.error('Önce uygulamadan kayıt olun, sonra bu script\'i çalıştırın.');
        await mongoose.disconnect();
        process.exit(1);
    }

    console.log(`${user.email} → role: ${user.role}`);
    // Panel /auth/me'yi doğrulanmış e-posta isteyen uçlarla birlikte kullanıyor;
    // doğrulanmamış hesap panele giremez, uyaralım
    if (!user.isEmailVerified && !revoke) {
        console.warn('⚠️  Bu hesabın e-postası doğrulanmamış — panele giriş yapamaz.');
    }

    await mongoose.disconnect();
}

main().catch(async (err) => {
    console.error(err);
    await mongoose.disconnect().catch(() => {});
    process.exit(1);
});
