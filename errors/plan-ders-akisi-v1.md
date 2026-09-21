# Plan — Ders Akışı v1 Yeniden Düzenlemesi

**Tarih:** 21.09.2026 · **Durum:** ONAY BEKLİYOR, kod yazılmadı
**Dayanak:** `errors/bulgular-kelime-akisi.md` (tespitler) ve 14–21.09 kararları

---

## 1. Hedef

Ders akışını yeni havuz kurallarına taşımak, tespit edilen sunucu hatalarını
kapatmak, kullanılmayan uçları temizlemek. Sonunda API.md yeniden yazılıp
mobil tarafa tek ve eksiksiz bir sözleşme verilecek.

**Yeni kurallar (karar verildi):**
- Günde **en fazla 2 havuz**.
- 2. havuz **yalnızca 1. havuz tamamen bitince** açılır: dokunulmamış kelime
  de, ertelenmiş kelime de kalmayacak.
- 2. havuz **kullanıcı isterse** açılır, kendiliğinden asla açılmaz.
- Ertelenen kelime **aynı ders içinde** kuyruğun sonuna döner.
- Bitiş ekranı yalnızca **dokunulmamış kelime kalmayınca** açılır.
- Anasayfa çemberi: günün hedefi dolunca **dolu kalır**, ekstra çalışma
  ayrı gösterilir ("+4 ekstra"). Çember asla geri düşmez.

---

## 2. Veri modeli

### 2.1 `DailyWordPool` — her havuz ayrı doküman
Bugün: aynı doküman üzerine yazılıyor, önceki turun bilgisi siliniyor.
Olacak: her havuz kendi dokümanı.

| Alan | Değişiklik |
|---|---|
| `poolNo` | **YENİ** — 1 veya 2 |
| `startedAt` | **YENİ** — havuzun açılma anı (`roundStartedAt` yerine) |
| `roundStartedAt` | **KALDIRILIYOR** — kapsam artık havuzun kendi kelime listesi |
| `roundClosedAt` | **KALDIRILIYOR** — "bitmiş havuz" kelimelerin durumundan türer |
| `targetGoal` | Kalıyor |
| Tekil anahtar | `{user, date, jlptLevel}` → `{user, date, jlptLevel, poolNo}` |

**Neden ayrı doküman:** "bugün kaç havuz açıldı" sorusunun cevabı olsun,
çemberin paydası (1. havuz) ile ekstra çalışma ayırt edilebilsin, geçmiş
kaybolmasın, hata ayıklama kolaylaşsın.

**Tur kapsamı** artık havuzun kendisi: "bu havuzda dokunuldu mu" sorusu
`lastReviewDate >= pool.startedAt` ile değil, **havuzun kelime listesi +
o havuzun kendi durumu** üzerinden cevaplanır. Bu, H1'in kök nedenini
(gün kapsamı ile tur kapsamının çakışması) tamamen ortadan kaldırır.

### 2.2 `StudySession` — değişiklik yok
Gün kapsamlı kalır: `correctCount`, `wrongCount`, `emptyCount`, `totalWords`.
Çemberin payı yine `completedTotal` (doğru + yanlış).

---

## 3. Sözleşme (API) değişiklikleri

### 3.1 `GET /userwords/today`
Aktif havuzu döner (2. havuz açıksa o, değilse 1.).

```jsonc
{
  "poolNo": 1,
  "reviewWords": [...], "newWords": [...],
  "queue": ["...", "..."],      // önce dokunulmamışlar, SONRA ertelenenler
  "postponedIds": [...],
  "completedIds": [...],
  "progress": {
    "total": 20,
    "completed": 14,   // doğru + yanlış
    "postponed": 3,
    "remaining": 3,    // bu havuzda hiç dokunulmamış
    "touched": 17      // completed + postponed — DERS BARININ PAYI (eski adı: answered)
  },
  "canFinish": false,        // YENİ — remaining === 0
  "canOpenNextPool": false,  // YENİ — poolNo===1 && remaining===0 && postponed===0
  "goal": 20,                // GÜNÜN hedefi = 1. havuzun boyutu (2. havuz açılınca DEĞİŞMEZ)
  "today": {
    "completedWords": 14,
    "extra": 0,              // YENİ — hedefin üstüne yapılan iş: max(0, completedWords - goal)
    "totalWords": 17, "correctCount": 11, "wrongCount": 3,
    "emptyCount": 3, "isCompleted": false
  }
}
```
- `queue` artık ertelenenleri de içerir (sonda, en önce ertelenen en önde).
- `progress.answered` → **`progress.touched`** (aynı sayı, dürüst isim).
- `goal` artık **günün hedefi**, turun boyutu değil. 2. havuz açılsa da 20 kalır.
- Çember: pay `min(completedWords, goal)`, ayrıca `extra` ayrı gösterilir.

### 3.2 `POST /userwords/answer`
- **H4:** Kelime bugünün havuzlarından birinde değilse **400**.
- **H1:** Bu havuzda zaten ertelenmiş kelimeye tekrar "Şimdilik Geç" gelirse
  sayaçlar oynamaz (`counted:false`) ama kelime kuyruğun **sonuna** taşınır.
- Yanıt `/today` ile aynı `progress` + `goal` + `today` bloklarını taşır,
  `poolNo`, `canFinish`, `canOpenNextPool` da eklenir.
- `result`/`todayResult` ayrımı aynen korunur.

### 3.3 `PUT /sessions/complete` — görevi değişiyor
**Bugünkü durum:** İstemci bu ucu hiç çağırmıyor (H6), üstelik çağrıldığında
havuzu "kapandı" işaretleyip bir sonraki `/today` çağrısında **kendiliğinden
yeni tur** açıyor. Yeni kuralda yeni havuz yalnızca kullanıcı isteğiyle
açılacağı için bu davranış kalkıyor.

**Yeni görevi (21.09 kararı):** Yalnızca "bitiş ekranını gördüm" demektir.
Havuzu KİLİTLEMEZ.
- En az bir kelimeye dokunulmuş olmalı. Hiç dokunulmadıysa **400**
  (`"Hiç kelimeye dokunmadan ders bitirilemez"`).
- Dokunulmamış kelime kalmışsa da **200** döner. Kullanıcı sonra geri gelip
  kalanlara devam edebilir — havuz açık kalır, `/today` aynı havuzu döndürür.
- Ertelenmiş kelime bitirmeyi engellemez.
- Günün oturumunu `isCompleted` yapar, süreyi ve doğruluk oranını hesaplar.
- **Yeni havuz AÇMAZ.**
- İdempotent kalır.
- Yanıt: `accuracy`, `pendingWords`, `canOpenNextPool`.

**Bunun sonucu — `closedAt` alanına gerek kalmıyor.** Bir havuzun "bitmiş"
olması kelimelerin durumundan türer: dokunulmamış 0 **ve** ertelenmiş 0.
`next-pool` bu koşula bakar, `complete`'e bakmaz. Böylece "kullanıcı erken
bitirdi ama havuzda 15 kelime var" gibi çelişkili bir durum hiç oluşmaz.
Eski `roundClosedAt` de tamamen tarihe karışır.

### 3.4 `POST /sessions/next-pool` — YENİ
2. havuzu açar. Koşullar:
- 1. havuzda dokunulmamış 0 **ve** ertelenmiş 0. Değilse **400** (hangi
  koşulun tutmadığı gövdede).
- Bugün zaten 2 havuz varsa **400** (`"Bugün en fazla 2 havuz açılabilir"`).
- **Boyutu: günlük hedefin yarısı** (hedef 20 ise 10). Kullanıcıya yeni bir
  20'lik duvar çıkarmamak için.
- Havuz içeriği: **önce vadesi gelmiş tekrarlar**, yer kalırsa yeni kelimeler.
- Yanıt: `/userwords/today` ile aynı gövde (`poolNo: 2`).

### 3.5 Kaldırılan uçlar
| Uç | Gerekçe |
|---|---|
| `PUT /sessions/update` | Mobil kullanmıyor (teyit edildi), sayaç şişirme riski (H3) |
| `GET /home/calendar` | Tasarımda takvim ekranı yok |
| `GET /home/day/:date` | Aynı |

**Emirhan'ın cevabı beklenenler** (şimdilik dokunulmuyor):
`/streak`, `/sessions/today`, `/sessions/history`, `/userwords/list`

### 3.6 Diğer
- `touchedToday` alanı `/today` yanıtından **kaldırılıyor** (kimse okumuyor).
- `GET /sessions/current` kalıyor, yeni alanlarla (`poolNo`, `canFinish`,
  `canOpenNextPool`).
- **Sınav modalı:** `shouldPromptPlacement` artık "herhangi bir deneme var mı"
  yerine **"tamamlanmış sınav var mı"** sorusuna bakacak. Yarıda bırakan ya da
  süresi dolan kullanıcıya modal yeniden çıkar. "Daha Sonra" yine kalıcı kapatır.

---

## 4. İş sırası

Her aşama kendi commit'i, testleriyle birlikte. Aşamalar bağımsız çalışır.

### Aşama 1 — Temizlik (düşük risk)
1. `PUT /sessions/update` kaldır (route + controller + service + API.md).
2. `GET /home/calendar`, `GET /home/day/:date` kaldır (+ `getCalendar`,
   `getDayDetail` servisleri).
3. `touchedToday` alanını kaldır.
4. `progress.answered` → `progress.touched` (tüm üreticiler + testler).
5. Sınav modalı kuralını düzelt.

### Aşama 2 — Havuz modeli (asıl iş)
6. `DailyWordPool`: `poolNo`, `startedAt`, `closedAt`, yeni tekil anahtar.
7. Geçiş betiği: `scripts/migrate-pool-no.js` (bkz. §6).
8. `getTodayWords`: otomatik yeni tur açma bloğunu **sil**, aktif havuzu
   (`closedAt` boş olan, yoksa en yüksek `poolNo`) oku.
9. Kuyruk sırası: dokunulmamışlar + ertelenenler (erteleme sırasına göre).
10. `buildRoundState`: `touched`, `canFinish`, `canOpenNextPool` üret.
11. `submitAnswer`: H4 kontrolü, H1 düzeltmesi (ertelenmişin tazelenmesi).
12. `completeSession`: yeni kurallar (§3.3).
13. `POST /sessions/next-pool` ucu.
14. `home.service`: `goal` = 1. havuzun boyutu, `today.extra` alanı.
15. `notification.service`: havuz okumasını yeni modele uyarla.

### Aşama 3 — Belgeler
16. API.md'yi yeni sözleşmeye göre yaz.
17. `errors/emirhan-mesaj.md`'yi güncelle: hatalar + yeni sözleşme tek mesaj.

---

## 5. Testler

Mevcut 200 test geçmeye devam etmeli (bazıları güncellenecek).

**Güncellenecek mevcut testler:** "session tamamlandıktan sonra today yeni bir
tur açar", "tur kapanınca yeni turun kuyruğu taşınan kelimeyle BAŞLAR",
"1. tur tamamlanıp 2. tur açılınca goal SABİT kalır", `progress.answered`
bekleyen 5 test, `/sessions/update` ve takvim uçlarının testleri.

**Yeni testler:**
1. Ertelenen kelime aynı havuzda kuyruğun **sonuna** döner, tekrar sorulur.
2. Aynı kelimeye ikinci "Şimdilik Geç": sayaç oynamaz, kelime yine kuyrukta.
3. `remaining > 0` iken `complete` → 400.
4. Ertelenmiş kelime varken `complete` → 200 (409 geri gelmedi).
5. `complete` artık yeni havuz **açmıyor**: sonraki `/today` aynı havuzu döner.
6. `next-pool`: 1. havuz bitmeden → 400.
7. `next-pool`: ertelenmiş kelime varken → 400.
8. `next-pool`: koşullar sağlanınca 2. havuz açılır, kelimeler 1. havuzunkinden farklı.
9. `next-pool` üçüncü kez → 400 (günde en fazla 2).
10. 2. havuz açılınca `goal` **değişmez** (20 kalır), `today.extra` artar.
11. Havuz dışı kelimeye cevap → 400 (H4).
12. 2. havuz önce vadesi gelmiş tekrarlardan kurulur.
13. Sınavı yarıda bırakan kullanıcıda `placementPrompt` yine `true`.
14. Kaldırılan uçlar 404 döner.

---

## 6. Canlı veritabanı geçişi

Havuzun tekil anahtarı değiştiği için sıra önemli:
1. Mevcut havuzlara `poolNo: 1` yaz, `roundStartedAt → startedAt`,
   `roundClosedAt → closedAt` taşı.
2. Eski tekil indeksi düşür, yenisini kur.
3. Betik **idempotent** olacak, iki kez çalışsa da bozmayacak.

**Risk:** Geçiş sırasında açık bir ders varsa havuz okuması bir anlığına
şaşabilir. Kullanıcı sayısı azken, akşam/gece yapılırsa etkisi yok sayılır.

**Geri dönüş:** Eski alanlar geçişte **silinmez**, yalnızca kopyalanır. Sorun
çıkarsa önceki sürüm aynı veriyle çalışmaya devam eder.

---

## 7. Kararlar (21.09.2026 — Yusuf onayladı)

1. **`complete` kapısı:** Hiç kelimeye dokunulmadıysa bitirilemez; bir kelimeye
   bile dokunulduysa bitirilebilir. Havuz kilitlenmez, kullanıcı geri dönüp
   kalanlara devam edebilir (bkz. §3.3).
2. **2. havuzun boyutu:** Günlük hedefin yarısı.
3. **2. havuzun içeriği:** Önce vadesi gelmiş tekrarlar, sonra yeni kelimeler.
4. **"Tekrar Çöz" kapsamı:** Günün tüm kelimeleri (hepsi zaten nötr sayılıyor).
5. **Aşama 1 ayrı yayına alınacak.**
6. **Çalışma biçimi:** Her aşama kendi dalında. Aşama 1 → `feat/ders-akisi-temizlik`,
   Aşama 2 → `feat/havuz-modeli`. Testler geçtikten ve Yusuf gözden geçirdikten
   sonra main'e birleştirilir. Canlı yayın main'den beslendiği için bu şart.
