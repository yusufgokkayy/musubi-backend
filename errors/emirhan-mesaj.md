# Ders Akışı — Mobil Tarafta Bulunan Hatalar

**Tarih:** 21.09.2026
**Nasıl bulundu:** Yeni bir test hesabıyla baştan sona canlı tur (kayıt →
doğrulama → sınav → ders). Telefonun logları USB üzerinden kaydedildi,
şüpheli noktalar ayrıca bellek içi bir veritabanında sunucuya karşı ölçüldü.

**Özet:** Ders akışında kalan hataların tamamı istemci tarafında. Sunucu bu
senaryoda doğru veriyi gönderiyor; uygulama ya yanlış alana bakıyor ya da
kuyruğu yanlış kuruyor. Aşağıdaki 5 madde birbirine bağlı, ilki düzelince
bazıları kendiliğinden kapanabilir.

---

## 1. Kuyruk tazeleme ters çalışıyor (en kritik)

20 kelimelik havuzda 17 kelime cevaplandı, 3 kelime "Şimdilik Geç" ile
ertelendi. Ardından `/userwords/today` yeniden çağrıldı:

```
14:42:39  GET /userwords/today → 200
14:42:39  ders → kuyruk tazelendi, 17 kelime kaldı: 私, あなた, これ, ... 家
```

Kuyruğa giren 17 kelime **cevaplanmış** olanlar. Ertelenmiş 3 kelime
(この, その, 土) kuyruktan düşmüş. Olması gerekenin tam tersi.

**Sunucunun o anda gönderdiği yanıt ölçüldü, doğru:**
- `progress`: `{total: 20, completed: 17, postponed: 3, remaining: 0}`
- `queue`: boş, `postponedIds`: 3 kelime, `completedIds`: 17 kelime
- Cevaplanmış kelimeler: `answeredToday: true`
- Ertelenmiş kelimeler: `answeredToday: false`, `todayResult: "empty"`

Senin söylediğin ilk yükleme filtresi (`!k.answeredToday`) bu veriyle doğru
sonucu veriyor: geriye yalnızca 3 ertelenmiş kelime kalıyor. Demek ki kuyruk
**tazeleme** yolu ilk yüklemeden farklı bir mantık kullanıyor ve ters çalışıyor.

## 2. Havuz bitmeden tüm kelimeler yeniden soruluyor

```
15:27:58  ders /today → progress={total 20, completed 17, postponed 3, remaining 0}
15:27:58  ders → sorulacak 20 kelime: 私, あなた, これ, ... (hepsi)
15:27:58  ders → gün ilerlemesi: 17/20, bar başlangıcı: 0
```

Sunucu `remaining: 0` diyor, istemci 20 kelimenin tamamını yeniden kuyruğa
koyuyor ve barı 0'dan başlatıyor. Kullanıcının gördüğü: "ders baştan başlıyor".

**Soru:** Bu "Tekrar Çöz" modu mu? Tasarımda havuz %100 olunca o buton çıkıyor
ve aynı kelimeleri yeniden çözmek normal (sunucu bunları saymaz,
`counted: false` döner). Ama burada ilerleme **%85 (17/20)** idi, yani kart
"Devam" halindeydi. Kasıtlıysa sorun yok; değilse 1. maddenin devamı.

Her hâlükârda kesin olan: **ertelenmiş 3 kelime hiçbir modda görünmüyor.**
Kullanıcı ertelediği kelimeyi bir daha göremiyor.

## 3. "Dersi Bitir" sunucuya istek atmıyor

Tüm log boyunca `PUT /sessions/complete` **sıfır kez** çağrıldı. Kullanıcı
butona bastı, istek gitmedi.

Sonuçları:
- Oturum sunucuda hiç kapanmıyor (`isCompleted` hep `false`).
- `completedAt` / `duration` hesaplanmıyor, bitiş kaydı hiç oluşmuyor.
- Takvim ve istatistiklerde o gün "tamamlanmamış" görünüyor.

`ders_service.dart:60`'ta çağrı var demiştin; koşulu tutmuyor olabilir.

## 4. Anasayfa çemberi yanlış alanı okuyor

Ekranda görünen: **"20/20 tamamlandı · 3 kelime ertelendi"**
Sunucunun gönderdiği: `completedWords: 17`, `totalWords: 20`, `emptyCount: 3`

Çember `totalWords` (dokunulan kelime sayısı) ile çiziliyor. Doğrusu
`completedWords` (doğru + yanlış). `totalWords` ertelenenleri de sayar, bu
yüzden ekran hem "tamamlandı" hem "3 kelime ertelendi" diyerek kendi içinde
çelişiyor.

## 5. "Şimdilik Geç" yanlış gövde gönderiyor

Şu an gönderilen:
```jsonc
{ "wordId": "...", "answer": "" }
```

Sunucu bunu "yazma sorusunda kutu boş bırakıldı" olarak puanlıyor; "Şimdilik
Geç" ile ayırt edemiyor. Gönderilmesi gereken:
```jsonc
{ "wordId": "...", "result": "empty" }
```

**Bu, Ağustos'ta bildirdiğin "doğru cevapladım ama `result: empty` döndü"
hatasının kaynağı.** Zincir canlıda görüldü:

```
15:28:04  ders /answer → 私   : result:empty  todayResult:correct  counted:false
15:28:05  ders /answer → あなた : result:empty  todayResult:correct  counted:false
```

1. madde yüzünden bugün doğru cevaplanmış kelime tekrar soruluyor, kullanıcı
"Şimdilik Geç"e basıyor, sunucu "bu gönderim boştu" diyor. Kelimenin gerçek
durumu yanıtta zaten var: `todayResult: "correct"`.

**Kural:** `result` = bu gönderimin puanı (geri bildirim için).
`todayResult` = kelimenin güne kayıtlı sonucu (rozet/durum için).
Rozet ve "ertelendi" işareti **`todayResult`'a** bakmalı.

---

## Küçük notlar

- **`/home/summary` anasayfa açılışında üç kez çağrılıyor.** (14:36:27.726,
  14:36:28.249, 14:36:28.447)
- **Ayarlar'da her dokunuş ayrı istek atıyor:** yarım dakikada 11 kez
  `PUT /auth/update-info`. Değişiklikleri biriktirip tek istekte göndermek
  ya da kısa gecikmeyle birleştirmek daha iyi olur.

## Sunucu tarafında bizim yapacaklarımız

- Ertelenmiş kelime **aynı ders içinde** kuyruğa geri dönecek (şu an sonraki
  tura saklanıyor). Sıra: önce hiç dokunulmamışlar, sonra ertelenmişler.
- Havuz kuralları değişiyor: günde en fazla 2 havuz, ikinci havuz ancak
  birincisi tamamen bitince (dokunulmamış da ertelenmiş de kalmadan) açılacak.
- `PUT /sessions/update` kaldırılacak (kullanmadığını teyit ettin).
- `touchedToday` kaldırılacak. `progress.answered` ise **kalacak**, adı
  `touched` olacak — ders barının payı olarak belgelenecek.

Sözleşme değişiklikleri kodlanınca API.md güncellenip ayrıca iletilecek.

---

## Ek notlar (ikinci tur, 21.09 akşam)

Diğer ekranlar gezildi: hata listesi, hikâyeler, bildirimler, Hafıza'nın beş
kutusu, Kütüphane, Seviyeler. **Hepsi düzgün çalışıyor**, tüm yanıtlar 200.
Süresi dolan oturum anahtarı kendiliğinden yenilendi — o akış da sağlam.

İki küçük konu:

1. **`POST /notifications/test` kullanıcıya açık.** Ekrandan 14 kez
   tetiklenebildi. Sürüm derlemesinde gizlenmeli.
2. **Aramada her tuşa basışta istek gidiyor:** `q=tekil`, `q=tekill`,
   `q=tekilli`, `q=tekillik`… Üstelik bazı tuşlarda iki istek atılıyor (biri
   `jlptLevel` filtreli, biri filtresiz). Kısa bir gecikmeyle birleştirilmeli.

**Bir sorumuz var:** Şu uçlar hiç çağrılmıyor — ekranları var mı, yoksa
kaldıralım mı?
`/streak` · `/userwords/list` · `/sessions/current` · `/sessions/today` ·
`/sessions/history`

(`/home/calendar` ve `/home/day/:tarih` tasarımda karşılığı olmadığı için
kaldırılacak — anasayfadaki yedi günlük şerit zaten `/home/summary` içinde
geliyor.)
