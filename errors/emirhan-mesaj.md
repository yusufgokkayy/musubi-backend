# Musubi — Ders Akışı: Mobil Hataları ve Yeni Sözleşme

**Tarih:** 21.09.2026
**Nasıl bulundu:** Yeni bir test hesabıyla baştan sona canlı tur (kayıt →
doğrulama → sınav → ders → diğer ekranlar). Telefonun logları USB üzerinden
kaydedildi, şüpheli her nokta ayrıca bellek içi bir veritabanında sunucuya
karşı ölçüldü.

**İki bölüm var:** (1) mobilde düzeltilmesi gerekenler, (2) sunucuda değişen
sözleşme. Tam referans API.md'de; burada yalnızca değişenler var.

---

# BÖLÜM 1 — Mobilde düzeltilecekler

Ders akışında kalan hataların tamamı istemci tarafında. Sunucu bu senaryolarda
doğru veriyi gönderiyor; uygulama ya yanlış alana bakıyor ya kuyruğu yanlış
kuruyor. Maddeler birbirine bağlı, ilki düzelince bazıları kendiliğinden kapanır.

## 1. Kuyruk tazeleme ters çalışıyor (en kritik)

20 kelimelik havuzda 17 kelime cevaplandı, 3 kelime "Şimdilik Geç" ile
ertelendi. Ardından `/userwords/today` yeniden çağrıldı:

```
14:42:39  GET /userwords/today → 200
14:42:39  ders → kuyruk tazelendi, 17 kelime kaldı: 私, あなた, これ, ... 家
```

Kuyruğa giren 17 kelime **cevaplanmış** olanlar. Ertelenmiş 3 kelime
(この, その, 土) kuyruktan **düşmüş**. Olması gerekenin tam tersi.

**Sunucunun o anda gönderdiği yanıt ölçüldü, doğruydu:**
- `progress`: `{total: 20, completed: 17, postponed: 3, remaining: 0}`
- Cevaplanmışlar `answeredToday: true`, ertelenmişler `answeredToday: false`
- Senin söylediğin ilk yükleme filtresi (`!k.answeredToday`) bu veriyle doğru
  sonucu veriyor: geriye yalnızca 3 ertelenmiş kelime kalıyor

Demek ki kuyruk **tazeleme** yolu ilk yüklemeden farklı bir mantık kullanıyor.

> **Not:** Yeni sözleşmede `queue` alanını okuman bu sorunu tamamen bitirir —
> sıra artık sunucuda, ertelenenler de dahil (bkz. Bölüm 2).

## 2. Havuz bitmeden tüm kelimeler yeniden soruluyor

```
15:27:58  ders /today → progress={total 20, completed 17, postponed 3, remaining 0}
15:27:58  ders → sorulacak 20 kelime: 私, あなた, これ, ... (hepsi)
15:27:58  ders → gün ilerlemesi: 17/20, bar başlangıcı: 0
```

Sunucu `remaining: 0` diyor, istemci 20 kelimenin tamamını yeniden kuyruğa
koyuyor ve barı 0'dan başlatıyor.

Bu "Tekrar Çöz" modu muydu? Tasarımda havuz %100 olunca o buton çıkıyor ve
aynı kelimeleri yeniden çözmek normal (sunucu bunları saymaz, `counted: false`
döner). Ama burada ilerleme **%85 (17/20)** idi, yani kart "Devam" halindeydi.

Kesin olan: **ertelenmiş 3 kelime hiçbir modda görünmüyor.** Kullanıcı
ertelediği kelimeyi bir daha göremiyor.

### Ek kanıt — 21.09 akşamı, backend yayına alındıktan SONRA

Aynı davranış yeni sözleşmeyle de sürüyor. Sunucunun gönderdiği:

```
progress = {total: 20, completed: 16, postponed: 4, remaining: 0, touched: 20}
canFinish: true, canOpenNextPool: false, goal: 20
```

Yani: 20 kelimenin hepsine dokunulmuş, 16'sı cevaplanmış, 4'ü ertelenmiş,
dokunulmamış kelime yok. Uygulamanın aynı anda yaptığı:

```
ders → sorulacak 20 kelime: 私, あなた, これ, ... (hepsi)
ders → gün ilerlemesi: 16/20, bar başlangıcı: 0
```

`remaining: 0` okunmuş, "gün ilerlemesi 16/20" diye doğru yazılmış, ama kuyruk
yine sıfırdan kurulmuş.

**Olması gereken:** `queue` alanı okunsaydı elinde 4 kelime olurdu — kullanıcının
ertelediği kelimeler. Onlar cevaplanınca `canOpenNextPool` true olur ve
"Çalışmaya Devam Et" butonu çıkar.

Aynı kayıtta 5. maddenin de tekrarı var: zaten doğru cevaplanmış bir kelime
yeniden sorulmuş, kullanıcı "Şimdilik Geç"e basmış ve
`result: empty, todayResult: correct, counted: false` dönmüş.

## 3. "Dersi Bitir" sunucuya istek atmıyor

Tüm log boyunca `PUT /sessions/complete` **sıfır kez** çağrıldı.

Sonuçları: oturum sunucuda hiç kapanmıyor, `duration`/`completedAt`
hesaplanmıyor, takvim ve istatistiklerde o gün "tamamlanmamış" görünüyor.
`ders_service.dart:60`'ta çağrı var demiştin; koşulu tutmuyor olabilir.

## 4. Anasayfa çemberi yanlış alanı okuyor

Ekranda görünen: **"20/20 tamamlandı · 3 kelime ertelendi"**
Sunucunun gönderdiği: `completedWords: 17`, `totalWords: 20`, `emptyCount: 3`

Çember `totalWords` (dokunulan) ile çiziliyor; doğrusu `completedWords`
(doğru + yanlış). Ekran kendi içinde de çelişiyor: hem "tamamlandı" diyor hem
"3 kelime ertelendi".

## 5. "Şimdilik Geç" yanlış gövde gönderiyor

Şu an giden: `{ "wordId": "...", "answer": "" }`
Gitmesi gereken: `{ "wordId": "...", "result": "empty" }`

Sunucu boş metni "yazma sorusunda kutu boş bırakıldı" diye puanlıyor,
"Şimdilik Geç" ile ayırt edemiyor.

**Bu, Ağustos'ta bildirdiğin "doğru cevapladım ama `result: empty` döndü"
hatasının kaynağı.** Zincir canlıda görüldü:

```
15:28:04  ders /answer → 私   : result:empty  todayResult:correct  counted:false
15:28:05  ders /answer → あなた : result:empty  todayResult:correct  counted:false
```

1. madde yüzünden bugün doğru cevaplanmış kelime tekrar soruluyor, kullanıcı
"Şimdilik Geç"e basıyor, sunucu "bu gönderim boştu" diyor.

**Kural:** `result` = bu gönderimin puanı (anlık geri bildirim).
`todayResult` = kelimenin güne kayıtlı sonucu. **Rozet ve "ertelendi" işareti
`todayResult`'a bakmalı.**

## Küçük notlar

- `/home/summary` anasayfa açılışında **üç kez** çağrılıyor.
- Ayarlar'da her dokunuş ayrı istek atıyor: yarım dakikada 11 kez
  `PUT /auth/update-info`. Aramada da her tuşa basışta istek gidiyor
  (`q=tekil`, `q=tekill`, `q=tekilli`…), bazı tuşlarda ikişer tane.
- `POST /notifications/test` kullanıcıya açık; sürüm derlemesinde gizlenmeli.

---

# BÖLÜM 2 — Sunucuda değişen sözleşme

Hepsi kodlandı ve testleri geçti. API.md güncel, tam referans orada.

## Kaldırılan uçlar
`PUT /sessions/update` · `GET /home/calendar` · `GET /home/day/:date`

## Kaldırılan / yeniden adlandırılan alanlar
- `touchedToday` → **kaldırıldı**
- `progress.answered` → **`progress.touched`** (aynı sayı: cevaplanan +
  ertelenen). **Ders barının payı budur** — "Şimdilik Geç"i ilerleme sayman
  doğruydu, alanın adı yanlıştı.

## Yeni alanlar
`/userwords/today`, `/userwords/answer`, `/sessions/current` yanıtlarında:

| Alan | Anlamı |
|---|---|
| `poolNo` | 1 = günün havuzu, 2 = ekstra havuz |
| `canFinish` | "Dersi Bitir" çağrılabilir mi (en az bir kelimeye dokunuldu mu) |
| `canOpenNextPool` | "Çalışmaya Devam Et" butonu görünsün mü |
| `today.extra` | Günün hedefinin üstüne yapılan iş ("+4 ekstra") |
| `jlptLevel` | **Dersin** seviyesi (`activeLevel`'dan farklı olabilir) |
| `levelStartsTomorrow` | Yeni seviye yarın başlıyorsa `true` |

`/home/summary` ayrıca `lessonLevel` ve `levelStartsTomorrow` döner.

## Davranış kuralları

**1. Ertelenen kelime kuyruktan DÜŞMÜYOR**, kuyruğun **sonuna** gidiyor ve aynı
ders içinde geri geliyor. Tekrar "Şimdilik Geç" denirse yine sona gidiyor,
sayaçlar oynamıyor.

**2. `/userwords/today` artık ASLA yeni havuz açmıyor.** Eskiden ders bitince
bir sonraki çağrı taze bir set üretiyordu — "tekrar başlarken üstüne 20lik
daha soruyor" şikâyetinin kaynağı buydu.

**3. İkinci havuz `POST /sessions/next-pool` ile açılıyor.** Kuralları:
- Birinci havuz gerçekten bitmiş olacak: ne dokunulmamış ne ertelenmiş kelime
  kalacak (`canOpenNextPool: true`). Değilse `400` + `details`
- Günde en fazla 2 havuz
- Boyutu günlük hedefin yarısı (hedef 20 → 10)
- İçeriği önce vadesi gelmiş tekrarlar, yer kalırsa yeni kelimeler
- Yanıt `/userwords/today` ile aynı şekilde (`201`)

**4. `PUT /sessions/complete` havuzu kilitlemiyor.** Dokunulmamış kelime kalsa
da bitirilebiliyor; kullanıcı geri dönüp devam edebiliyor. Hiç kelimeye
dokunulmadıysa `400`. Yanıtta `canOpenNextPool` var.

**5. `goal` artık GÜNÜN HEDEFİ** (1. havuzun boyutu) ve ekstra havuz açılınca
**büyümüyor**. Çember hedef dolunca dolu kalıyor, fazlası `today.extra`'ya
yazılıyor. (Payda büyüseydi 20/20 yapıp devam eden kullanıcı %50'ye düşerdi.)

**6. Havuz dışı kelimeye cevap `400`.** Günün tüm havuzları kabul ediliyor,
yani "Tekrar Çöz" çalışmaya devam ediyor. Sebep: hesabının anahtarını bilen
biri uygulamayı hiç kullanmadan yüzlerce kelimeyi "doğru" işaretleyip seviye
kilitlerini açabiliyordu.

**7. Gün içinde seviye değişimi.** `activeLevel` **anında** değişir (liste,
bant, rozetler hemen yeni seviyeyi gösterir). Ama bugünkü derse başlanmışsa
bugünün havuzu eski seviyede kalır, yeni seviye **yarın** başlar —
`levelStartsTomorrow: true` gelir, ekranda "Bugünkü dersine başladığın için
N4 yarın başlayacak" denmeli. Bugün hiç cevap verilmemişse ders anında yeni
seviyeden kurulur.

## Ders ekranı için özet: hangi alanı oku

| Ekran parçası | Alan |
|---|---|
| Ders barı | pay `progress.touched`, payda `progress.total` |
| Anasayfa çemberi | pay `today.completedWords`, payda `goal`, yanında `today.extra` |
| Soru sırası | `queue` (sunucu sırası; ertelenenler sonda) |
| "Doğru!/Yanlış!" geri bildirimi | `result` |
| "Bugün boş geçmiştin" rozeti | `todayResult` |
| "Dersi Bitir" görünürlüğü | `canFinish` |
| "Çalışmaya Devam Et" görünürlüğü | `canOpenNextPool` |
| Dersin seviyesi | `jlptLevel` + `levelStartsTomorrow` |

---

# Sorumuz

Şu uçlar canlı trafikte bir kez bile çağrılmadı. Ekranları var mı, yoksa
kaldıralım mı?

`/streak` · `/sessions/today` · `/sessions/history` · `/userwords/list`

(`/home/calendar` ve `/home/day/:tarih` tasarımda karşılığı olmadığı için
kaldırıldı — yedi günlük şerit zaten `/home/summary` içinde geliyor.)
