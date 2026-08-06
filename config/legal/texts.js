// Hukuki metinlerin KANONİK kaynağı.
//
// Metinler BİLEREK bu dosyada yaşar, veritabanında değil: hukuki bir metnin
// hangi tarihte hangi hâlde olduğu git geçmişinden kanıtlanabilir olmalı ve
// yanlışlıkla bir DB yazımıyla değişememelidir.
//
// ⚠️ Bir metni DEĞİŞTİRİYORSAN version'ı da yükselt. Sürüm yükseltmek, tüm
// kullanıcılardan yeniden rıza istemek demektir (bkz. config/consents.js).
// Metni değiştirip sürümü aynı bırakmak, kullanıcının onaylamadığı bir metne
// onay vermiş görünmesine yol açar — KVKK açısından kanıt değeri sıfırdır.
//
// Metinler ALPSOY YAZILIM tarafından iletildiği ŞEKLİYLE, birebir durur.
// Yazım/ifade düzeltmesi yapılmaz; hukuki metin paraphrase edilmez.

const COMPANY = 'ALPSOY YAZILIM ARGE MÜHENDİSLİK LİMİTED ŞİRKETİ';
const SUPPORT_EMAIL = 'destek@musubi.app';

// Metinlerin dili Türkçedir. İngilizce sürümü YOKTUR ve makine çevirisi
// yapılmaz — bağlayıcı bir sözleşmenin çevirisi hukuki inceleme ister.
// ?lang=en ile açıldığında sayfa metni Türkçe gösterir, üstte not düşer.
const CANONICAL_LANG = 'tr';

const DOCS = {
    terms: {
        key: 'terms',
        version: '1.0',
        effectiveDate: '2026-08-04',
        title: 'Kullanıcı Sözleşmesi',
        intro: `Bu Kullanıcı Sözleşmesi (Musubi), ${COMPANY} ile Musubi uygulamasını kullanan siz ("Kullanıcı") arasında geçerlidir. Uygulamayı indirerek, hesap oluşturarak veya kullanarak bu sözleşmenin tamamını okuduğunuzu ve kabul ettiğinizi beyan edersiniz.`,
        sections: [
            {
                heading: '1. Hizmetin Tanımı',
                body: 'Musubi, Japonca kelime dağarcığını aralıklı tekrar (SRS) yöntemiyle geliştirmeye yönelik bir mobil öğrenme uygulamasıdır. Uygulama; günlük çalışma listeleri, seviye sınavları, ilerleme takibi ve sesli telaffuz gibi özellikler sunar. Sunulan içerik ve özellikler zaman zaman güncellenebilir, genişletilebilir veya kaldırılabilir.'
            },
            {
                heading: '2. Hesap ve Güvenlik',
                body: `Uygulamayı kullanmak için doğru ve güncel bilgilerle bir hesap oluşturmanız gerekir. Hesap bilgilerinizin ve şifrenizin gizliliğini korumaktan siz sorumlusunuz. Hesabınız üzerinden gerçekleştirilen tüm işlemlerden siz sorumlu tutulursunuz. Yetkisiz bir kullanım fark ederseniz derhal ${SUPPORT_EMAIL} adresi üzerinden bize bildirmelisiniz.`
            },
            {
                heading: '3. Kullanım Koşulları',
                body: 'Uygulamayı yalnızca kişisel ve ticari olmayan öğrenme amacıyla kullanmayı kabul edersiniz. Uygulamayı tersine mühendisliğe tabi tutmak, içeriğini izinsiz kopyalamak veya dağıtmak, sistemin güvenliğini tehlikeye atacak eylemlerde bulunmak yasaktır. Bu koşullara aykırı davranış hâlinde hesabınız askıya alınabilir veya kapatılabilir.'
            },
            {
                heading: '4. Fikri Mülkiyet',
                body: `Musubi uygulamasındaki tüm yazılım, tasarım, marka, içerik ve kelime veri tabanı ${COMPANY}'ne veya lisans verenlerine aittir ve ilgili fikri mülkiyet mevzuatıyla korunmaktadır. Bu sözleşme, size uygulamayı kullanma dışında herhangi bir mülkiyet hakkı devretmez.`
            },
            {
                heading: '5. Premium ve Satın Almalar',
                body: 'Uygulama, isteğe bağlı ücretli özellikler (Premium) içerebilir. Satın almalar ilgili uygulama mağazası (App Store / Google Play) üzerinden gerçekleştirilir ve iade koşulları ilgili mağazanın politikalarına tabidir.'
            },
            {
                heading: '6. Sorumluluğun Sınırlandırılması',
                body: `Musubi "olduğu gibi" sunulmaktadır. Uygulama, öğrenme sonuçlarını garanti etmez. Yürürlükteki mevzuatın izin verdiği ölçüde, uygulamanın kullanımından doğabilecek dolaylı zararlardan ${COMPANY} sorumlu tutulamaz.`
            },
            {
                heading: '7. Değişiklikler ve İletişim',
                body: `${COMPANY} bu sözleşmeyi zaman zaman güncelleyebilir. Önemli değişiklikler uygulama içinden bildirilir. Sorularınız için ${SUPPORT_EMAIL} adresinden bize ulaşabilirsiniz.`
            }
        ]
    },

    privacy: {
        key: 'privacy',
        version: '1.0',
        effectiveDate: '2026-08-04',
        title: 'Gizlilik Politikası',
        intro: `${COMPANY} olarak gizliliğinize önem veriyoruz. Bu Gizlilik Politikası, Musubi uygulamasını kullanırken hangi verileri topladığımızı, bunları nasıl kullandığımızı ve haklarınızı açıklar.`,
        sections: [
            {
                heading: '1. Topladığımız Veriler',
                body: 'Hesap bilgileri (ad, soyad, e-posta), öğrenme verileri (çalışılan kelimeler, ilerleme, seri, sınav sonuçları) ve uygulamanın düzgün çalışması için gerekli teknik veriler (cihaz türü, uygulama sürümü). Şifreniz geri döndürülemez biçimde şifrelenerek saklanır.'
            },
            {
                heading: '2. Verileri Kullanma Amacımız',
                body: 'Verilerinizi; hesabınızı yönetmek, aralıklı tekrar algoritmasını çalıştırmak, ilerlemenizi göstermek, size hatırlatma bildirimleri göndermek ve uygulamayı iyileştirmek için kullanırız. Verilerinizi pazarlama amacıyla üçüncü taraflara satmayız.'
            },
            {
                heading: '3. Bildirimler',
                body: 'Günlük çalışma ve seri hatırlatmaları gibi bildirimleri, ayarlardan istediğiniz zaman açıp kapatabilirsiniz. Bildirim tercihleri yalnızca sizin belirlediğiniz şekilde uygulanır.'
            },
            {
                heading: '4. Veri Saklama ve Silme',
                body: 'Verileriniz hesabınız aktif olduğu sürece saklanır. Hesabınızı sildiğinizde, ilgili mevzuatın gerektirdiği durumlar dışında tüm kişisel verileriniz kalıcı olarak silinir.'
            },
            {
                heading: '5. Güvenlik',
                body: 'Verilerinizi yetkisiz erişime karşı korumak için şifreleme ve erişim denetimi gibi uygun teknik ve idari tedbirleri uygularız. Ancak internet üzerinden hiçbir aktarımın %100 güvenli olmadığını hatırlatırız.'
            },
            {
                heading: '6. İletişim',
                body: `Gizlilikle ilgili sorularınız için ${SUPPORT_EMAIL} adresinden bize ulaşabilirsiniz.`
            }
        ]
    },

    kvkk: {
        key: 'kvkk',
        version: '1.0',
        effectiveDate: '2026-08-04',
        title: 'KVKK Aydınlatma ve Açık Rıza Metni',
        intro: `İşbu Aydınlatma Metni, 6698 sayılı Kişisel Verilerin Korunması Kanunu ("KVKK") kapsamında, veri sorumlusu sıfatıyla ${COMPANY} tarafından hazırlanmıştır.`,
        sections: [
            {
                heading: '1. Veri Sorumlusu',
                body: `Kişisel verileriniz, veri sorumlusu ${COMPANY} tarafından aşağıda açıklanan kapsamda işlenmektedir.`
            },
            {
                heading: '2. İşlenen Kişisel Veriler',
                body: 'Kimlik ve iletişim verileri (ad, soyad, e-posta), Musubi uygulamasını kullanımınıza ilişkin işlem güvenliği ve öğrenme verileri (ilerleme, çalışma geçmişi, sınav sonuçları) işlenmektedir.'
            },
            {
                heading: '3. İşleme Amaçları',
                body: 'Kişisel verileriniz; üyelik işlemlerinin yürütülmesi, hizmetin sunulması ve iyileştirilmesi, ilerlemenizin takibi, talep ve şikâyetlerin yönetimi ile hukuki yükümlülüklerin yerine getirilmesi amaçlarıyla işlenir.'
            },
            {
                heading: '4. Hukuki Sebep ve Aktarım',
                body: "Verileriniz KVKK'nın 5. ve 6. maddelerinde belirtilen hukuki sebeplere dayanılarak işlenir. Verileriniz, hizmetin sağlanması için gerekli olduğu ölçüde yurt içi ve yurt dışındaki hizmet sağlayıcılarımızla (barındırma, bildirim vb.) paylaşılabilir."
            },
            {
                heading: '5. Haklarınız (KVKK m. 11)',
                body: `Kişisel verilerinizin işlenip işlenmediğini öğrenme, düzeltilmesini veya silinmesini isteme, işlemeye itiraz etme ve zararın giderilmesini talep etme haklarına sahipsiniz. Taleplerinizi ${SUPPORT_EMAIL} adresine iletebilirsiniz.`
            },
            {
                heading: '6. Açık Rıza',
                body: 'Uygulamayı kullanarak ve hesabınızı oluşturarak, yukarıda açıklanan kişisel verilerinizin belirtilen amaçlarla işlenmesine ve gerekli olduğu ölçüde aktarılmasına açık rıza vermiş olursunuz. Rızanızı dilediğiniz zaman geri alabilirsiniz.'
            }
        ]
    }
};

// Sıra, uygulamadaki ve karşılama ekranındaki sıralamayla aynı
const DOC_KEYS = ['terms', 'privacy', 'kvkk'];

const getDoc = (key) => DOCS[key] || null;

// Metinsiz özet — liste ucu ve rıza durumu için
const docSummary = (key) => {
    const d = DOCS[key];
    return {
        key: d.key,
        title: d.title,
        version: d.version,
        effectiveDate: d.effectiveDate,
        url: `/legal/${d.key}`
    };
};

module.exports = { DOCS, DOC_KEYS, COMPANY, SUPPORT_EMAIL, CANONICAL_LANG, getDoc, docSummary };
