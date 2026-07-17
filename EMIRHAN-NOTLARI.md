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
