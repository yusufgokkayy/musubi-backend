# Emirhan için istemci notları — 16.07.2026

Bildirdiğin üç sorun da backend'de kapandı. Aşağıdakiler senin tarafında
yapılacaklar / bilmen gerekenler. Endpoint sözleşmelerinin tamamı API.md'de.

## 1. `http://undefined` mail linki → düzeldi

Railway'e `CLIENT_URL` eklendi ve mail linkleri artık tek yerden kurulup
env eksikse sessizce kırık link gitmek yerine hata veriyor. Maildeki link
artık buton görünümlü `<a href>` (düz metin URL bozulması derdine karşı).

## 2. Doğrulama ekranı + deep link köprüsü → hazır

Maildeki linkler artık API'ye değil şu HTML sayfalarına gidiyor:

- `GET /verify-email/:token` — mobilde otomatik `musubi://verify-email/<token>`
  dener; sayfada "Uygulamada Aç" + "Burada Doğrula" butonları var.
- `GET /reset-password/:token` — mobilde otomatik `musubi://reset-password/<token>`
  dener; uygulama yoksa tarayıcıda yeni şifre formu gösterir (emniyet ağı).

### Senin yapman gerekenler

1. **Deep link route'ları**: uygulama `musubi://verify-email/<token>` ve
   `musubi://reset-password/<token>` biçimini karşılamalı. Sen farklı bir
   format kullanıyorsan (örn. `musubi://reset?token=...`) söyle, backend'de
   tek sabitten uyarlarız.
2. **Doğrulama artık POST**: `POST /api/auth/verify-email` gövdesinde
   `{ token, deviceName }`. `deviceName` gönderirsen login sözleşmesiyle taze
   access+refresh çifti döner (kullanıcı otomatik giriş yapar). Eski
   `GET /api/auth/verify-email/:token` geriye uyumluluk için duruyor ama
   yeni kodda POST kullan.
3. **Reset ekranı**: deep link'ten aldığın token ile
   `POST /api/auth/reset-password` gövdesinde `{ token, password, deviceName }`.
   ÖNEMLİ: `deviceName` göndermezsen artık token çifti DÖNMEZ (web formu bu
   modu kullanıyor); uygulamadan her zaman `deviceName` gönder.
4. Universal Links (iOS) / App Links (Android) mağaza hazırlığına ertelendi —
   gerçek bundle ID belirlenince `.well-known` dosyalarını birlikte kurarız.
   Mail linkleri o noktada DEĞİŞMEDEN doğrudan uygulamayı açmaya başlar.

## 3. Tek testte "ustalık 3" → düzeldi (aynı-gün kuralı)

Sebep: SRS algoritması (SM-2) her `POST /userwords/answer` çağrısında bir adım
ilerliyordu. Uygulama bir kelimeyi öğrenme + test aşamalarında iki kez
cevaplatınca, dakikalar arayla gelen iki doğru kelimeyi tek oturumda 3. seviyeye
zıplatıyordu.

Yeni kural (backend tarafında, senin bir şey yapman gerekmiyor):

- Aynı güne (kullanıcının saat diliminde) denk gelen İKİNCİ doğru cevap SRS'i
  ilerletmez — seviye/interval sabit kalır, yalnızca istatistik sayacı işler.
- Yanlış cevap her koşulda sıfırlar (aynı gün bile).
- `result: "easy"` artık kabul ediliyor (doğru sayılır, en yüksek SM-2 kalitesi).

Not: Uygulaman kelime başına gerçekten iki `POST /answer` atıyorsa backend artık
buna dayanıklı; ama gereksiz istekse istemcide teke düşürmek isteyebilirsin.
Hesabındaki mevcut şişkin seviyeler geriye dönük düzelmez — kelimeler vadesi
gelince gerçek performansa oturur (zaten test verisi; DB temizliği de planda).

## 4. WhatsApp'ta bildirdiğin ders bug'ları — 17.07.2026

Detaylı sözleşmeler API.md'de; senin tarafta değişmesi gerekenler:

1. **Ders kaldığı yerden devam eder**: `GET /userwords/today` artık her kelimede
   `answeredToday` + `todayResult`, kökte `progress: {total, answered, remaining}`
   döner. Derse girerken `answeredToday: false` olanlardan başla — baştan sorma.
   İlerleme çemberini `progress`'ten çiz.
2. **Sayaç şişmesi bitti**: aynı gün tekrar cevaplanan kelime session sayaçlarına
   bir daha eklenmiyor (15→19 sorunu). Çember artık hedefi aşamaz.
3. **Yazma sorusunu backend puanlasın**: `POST /userwords/answer`'a `result`
   yerine `{ wordId, answer: "to see" }` gönder. "to see / watch", "down / below"
   gibi anlamlarda her varyant kabul edilir, parantez içleri opsiyonel, büyük/küçük
   harf ve noktalama önemsiz. Yanıtta `result` (correct/wrong/empty) ve yanlışsa
   "Cevap: ..." satırı için `correctAnswer` gelir. **İstemcideki elle metin
   karşılaştırma kodunu tamamen sil.**
4. **Bitiş ekranı**: `PUT /sessions/complete` yanıtında hazır `accuracy` yüzdesi
   var — %0 Accuracy sorunu için istemcide hesap yapma, bu alanı göster.
5. **それから/いつも "kanji değil"**: tüm Word yanıtlarında `isKana` alanı var.
   `true` ise "kanji" etiketini ve kanjiyle aynı olan okunuş satırını gizle.

Türkçe anlamlar (`meaningTr`) ayrı iş olarak planda; şablon/çeviri kararı verilince
gelecek.

## 5. İkinci tur geri bildirimlerin — 17.07.2026 akşam

1. **"Hâlâ aynı soru geliyor"** — backend'de değil: `GET /userwords/today`
   yanıtındaki `answeredToday` bayrağını uygulamada kullanman gerekiyor (madde
   4.1'de anlatıldı). Derse başlarken `answeredToday: true` olanları atla;
   ilerleme çubuğunu `progress.answered/total`'dan çiz. Bunu bağlayınca "kaldığım
   yerden devam" kendiliğinden çalışacak.
2. **"20 hatam var 30 gösteriyor"** — backend bug'ıydı, düzeltildi. "Bugünün
   Hataları" artık yalnızca bugün SON cevabı yanlış olan kelimeler: "Şimdilik
   Geç" hata sayılmaz, eski günlerin yanlışları bugüne taşınmaz, bugün doğruya
   dönen kelime listeden düşer.
3. **"Hedefi 30 yaptım, 20'de kaldı"** — backend bug'ıydı, düzeltildi: dailyGoal
   gün içinde artınca havuz bir sonraki `GET /userwords/today` çağrısında fark
   kadar genişler; cevaplananlar korunur. (Azaltma bugünü etkilemez.)
4. **Dikkatine**: 17.07 15:55'teki session kaydında 7 cevabın 7'si de "empty"
   düşmüş, doğru bildiklerin dahil. Yazma sorusunda `{ wordId, answer: "<metin>" }`
   gönderdiğinden emin ol — `answer` boş string giderse backend onu "boş
   bırakıldı" (empty) sayar.

## 6. Web-only doğrulama kararın uygulandı — 18.07.2026

Senin kararınla deep link akışı kaldırıldı; **2. bölümdeki deep link maddeleri
(musubi:// route'ları) artık GEÇERSİZ.** Yeni akış:

- Maildeki link web sayfasını açar; kullanıcı "E-postamı Doğrula" butonuna
  basar, doğrulama webde biter. Şifre sıfırlama da aynı şekilde webdeki formda.
- Uygulamada yapman gerekenler:
  1. Register sonrası **"e-postanı doğrula" bekleme ekranı** — kullanıcıyı ana
     ekrana alma (`isEmailVerified: false` / ✉️ endpoint'lerden 403).
  2. Ekranda **"Doğruladım" butonu** → `GET /auth/me`'yi yeniden dene; 200
     dönüyorsa içeri al. İstersen ekran açıkken birkaç saniyede bir sessiz
     `/auth/me` yoklaması da yapabilirsin — ikisi için de yeni endpoint gerekmez,
     register'ın verdiği token'lar bunun için var.
  3. **"Tekrar gönder"** → `POST /auth/resend-verification-email` (mevcut).
- `POST /api/auth/verify-email`'i artık uygulamadan çağırmana gerek yok
  (web sayfası çağırıyor); endpoint Postman/ileriye dönük için duruyor.

## 7. Ders akışı yeniden tasarımı — 18.07.2026 (BÜYÜK GÜNCELLEME)

Yusuf'la kararlaştırdığımız model: günlük TEK havuz + TEK oturum; havuz
bitince/yarıda kalınca tekrar çalışılabilir ama hiçbir şey şişmez. Detaylı
sözleşme API.md'de; senin tarafta yapılacaklar:

1. **Çemberi `GET /home/summary` yanıtındaki YENİ `goal` alanından çiz** —
   `dailyGoal`'dan DEĞİL. `goal` bugünün havuz boyutudur; kullanıcı ayarlardan
   hedefi değiştirince çember artık anında oynamaz (20/40 tutarsızlığı bitti).
   Ders içi çember için de `GET /userwords/today` → `progress.answered/total`.
2. **Ders kuyruğu**: `answeredToday: false` olanlardan kur. Artık
   "Şimdilik Geç" denen kelimeler de burada kalır (`todayResult: "empty"`) —
   yani ertelenen kelime sonraki oturuşta otomatik yeniden gelir.
3. **Tekrar çalışma modu bedava**: kullanıcı havuzu bitirdikten sonra "tekrar
   çalış" istersen tüm havuzu yeniden sorabilirsin — backend nihai cevabı
   verilmiş kelimede tamamen nötr davranır (`counted: false` döner; seviye ne
   çıkar ne iner, sayaçlar oynamaz). Puanlama yine döner, "Doğru!/Yanlış!"
   kartını normal gösterebilirsin. Tur içi skoru göstermek istersen kendin say.
4. **`counted` alanı**: cevabın kaydedilip kaydedilmediğini söyler — kaydedilen
   cevapta true, tekrar turunda false. UI'da fark göstermek istersen kullan.
5. **Oturum**: `POST /sessions/start` artık bitmiş oturumu yeniden açar, aynı
   güne ikinci kayıt oluşmaz — her ders girişinde çağırman güvenli.
   `PUT /sessions/complete`'i `progress.remaining === 0` olunca çağır.

## 8. Şifre kuralları — 18.07.2026

1. **Yeni şifre eskisiyle aynı olamaz**: `change-password` ve `reset-password`
   artık `400 "Yeni şifre eski şifrenle aynı olamaz"` dönebilir — bu metni
   ekranda göster. Reset'te bu 400 token'ı tüketmez; kullanıcı aynı linkle
   farklı şifre deneyebilir.
2. **`update-info` artık `password` kabul etmiyor** (400 döner): uygulaman
   şifreyi update-info ile gönderiyorsa `PUT /auth/change-password`'e
   (`{oldPassword, newPassword, deviceName}`) taşı — eski şifre doğrulaması ve
   oturum rotasyonu yalnızca orada var.

## 9. Login hataları artık ayrışıyor — 18.07.2026

Login "Invalid credentials" tekdüzeliği bitti; üç durumu ayrı göster:

| Durum | Kod | Mesaj (aynen gösterebilirsin) | UI önerisi |
|---|---|---|---|
| Mail kayıtlı değil | 404 | "Bu e-postayla kayıtlı bir hesap yok" | "Kayıt ol" yönlendirmesi |
| Hesap sosyal | 400 | "Bu hesap Google/Apple girişiyle açılmış; ... ile giriş yap" | Sosyal butonları vurgula |
| Şifre yanlış | 401 | "Şifreniz yanlış. Lütfen tekrar deneyin." | Şifre alanını temizle |

`resend-verification-email` de netleşti: bilinmeyen mail 404, zaten doğrulanmış
400 "E-posta zaten doğrulanmış" (login'e yönlendir). Şifremi-unuttum ise bilerek
hâlâ her durumda 200 döner (enumeration koruması orada duruyor).
