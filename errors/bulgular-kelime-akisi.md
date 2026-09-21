# Kelime Akışı — Doğrulama Bulguları

**Tarih:** 14.09.2026
**Kaynak:** Emirhan'ın 07.08.2026 tarihli "Ders Akışı: Backend'den Beklenenler" belgesi (`errors/hatalar-kelime-akisi.pdf`)
**Kontrol edilen kod:** `main` @ `386cd21` (5 Eylül değişiklikleri dahil)

**Yöntem:**
- Kod baştan sona okundu.
- Şüpheli durumlar bellek içi geçici bir veritabanında gerçek HTTP istekleriyle denendi. Gerçek veritabanına dokunulmadı.
- Madde 0 için 5 Eylül öncesi kod (`6fbbe5d`) aynı isteklerle ayrıca çalıştırıldı.
- Mevcut test takımı: 200 test, hepsi geçiyor. Aşağıdaki H1 ve H2'nin testi yok.

---

## 1. Özet

| Madde | Konu | Durum |
|---|---|---|
| 0 | Doğru cevap `result: "empty"` dönüyor | ⚠️ **KISMEN** — `answer: null` kapandı, `answer: ""` hâlâ aynı yanıtı üretiyor |
| 1 | `counted` / `goal` / `today` sözleşmeye alınsın | ✅ Düzeldi (API.md'de "kaldırılmayacaktır" yazıyor) |
| 2.1 | `todayResult` geliyor mu | ✅ Düzeldi |
| 2.2 | `newWords` bugünkü durumu taşımıyor | ✅ Düzeldi (Emirhan'ın "yok" dediği alanlar zaten geliyordu) |
| 2.3 | `progress` ayrıştırılsın | ✅ Düzeldi (`completed` / `postponed` / `remaining`) |
| 3 | Oturum durumu sunucuda (`/sessions/current`) | ✅ Uç var — ama **H1** hatası bu akışı bozuyor |
| 4 | 409 kalksın | ✅ Düzeldi |
| 5 | Anasayfa ile ders ekranı aynı sayıyı göstersin | ✅ Tek seviyede doğru — **H2**: gün içinde seviye değişince tutmuyor |
| 6 | `placementAvailable` | ✅ Düzeldi |
| Ek | Kullanılmayan alanlar kaldırılsın | ✅ Düzeldi |

**Yeni bulunan hatalar:** H1 (yüksek), H2 (orta), H3 (risk). Ayrıntılar aşağıda.

---

## 2. Yeni bulunan hatalar

### H1 — Taşınan kelime yeni turda tekrar "Şimdilik Geç" yapılamıyor · YÜKSEK · DOĞRULANDI

**Senaryo:**
1. Turda bir kelimeye "Şimdilik Geç" basılır, kalanlar cevaplanır, ders bitirilir.
2. Yeni tur açılır. Ertelenen kelime doğru şekilde sıranın başına (`queue[0]`) taşınır.
3. Kullanıcı bu kelimeye yeniden "Şimdilik Geç" basar.

**Olan:** Sunucu cevabı `counted: false` ile yok sayar ve hiçbir şey kaydetmez.
- Kelime `queue[0]`'da kalır.
- `progress.postponed` 0 kalır, `postponedIds` boş kalır.
- `/sessions/current` da aynı kelimeyi sıranın başında gösterir.

**Sonuç:** İstemci sunucunun kuyruğunu izlerse aynı kelime sonsuza kadar tekrar sorulur. Kullanıcı ya o kelimeyi cevaplamak ya da dersi yarıda bitirmek zorunda kalır. "Şimdilik Geç" ikinci turda çalışmıyor.

**Denemede görülen:**
```
tur 2 açıldı                      queue0IsCarried: true,  progress: {total 5, completed 0, postponed 0, remaining 5}
tur 2 — tekrar "Şimdilik Geç"      counted: false,          progress: {total 5, completed 0, postponed 0, remaining 5}
/sessions/current                 queue0IsCarried: true,   postponedIds: 0
```

**Kök neden** (`modules/userword/userword.service.js`):
- `submitAnswer` içinde, **bugün** zaten ertelenmiş bir kelimeye tekrar "empty" gelirse istek erken dönüyor. Kayıt yapılmıyor, yani `lastReviewDate` güncellenmiyor.
- Tur hesabı (`buildRoundState`) ise "bu turda dokunuldu mu" sorusunu `lastReviewDate >= roundStartedAt` ile soruyor.
- Kelimenin `lastReviewDate`'i önceki turdan kaldığı için yeni turda hiç "dokunulmuş" sayılmıyor.
- Kısacası "aynı gün ikinci empty sayılmasın" kuralı **gün** kapsamlı, kuyruk hesabı ise **tur** kapsamlı. İkisi 5 Eylül'de ayrıştı, ama bu nokta birbirine bağlanmadı.

**Önerilen düzeltme:**
- Kelime bugün ertelenmiş ama bu turda henüz dokunulmamışsa (`lastReviewDate < pool.roundStartedAt`), yalnızca `lastReviewDate` güncellensin.
- Sayaçlara (emptyCount) ve SM-2'ye dokunulmasın.
- Bu senaryo için test eklensin.

---

### H2 — Gün içinde seviye değişince anasayfa ile ders ekranı farklı hedef gösteriyor · ORTA · DOĞRULANDI

**Senaryo:** Kullanıcı N5'te 1 kelime cevaplar, Ayarlar'dan N4'e geçer, N4'te 1 kelime cevaplar (dailyGoal 5).

| Ekran | goal (payda) | Pay |
|---|---|---|
| Ders ekranı (`/answer` yanıtı) | **5** | `progress.completed` 1 · `today.completedWords` 2 |
| Anasayfa (`/home/summary`) | **10** | `today.completedWords` 2 |

**Kök neden:**
- `home.service.js` çemberin paydasını bugünün **tüm** havuzlarının toplamından hesaplıyor (N5 + N4 = 10).
- Ders ekranı yalnızca aktif seviyenin havuzunu okuyor (5).
- Madde 5'in "aynı sayı" şartı bu durumda bozuluyor.

**Not:** Yalnızca aynı gün seviye değiştiren kullanıcıda görülür.

**Önerilen düzeltme:** Anasayfa paydası da yalnızca `activeLevel` havuzundan hesaplansın. Ürün kararı gerekiyor: gün içinde iki seviyede çalışan kullanıcının çemberi nasıl görünmeli?

**Yan not:** `home.service.js` içindeki "kapanan turların hedefleri de dahil edilir" yorumu yanlış. Yeni tur aynı havuz kaydının üzerine yazıldığı için eski turların boyutu hesaba katılmıyor. Davranış doğru, yorum yanıltıcı.

---

### H3 — `PUT /sessions/update` hâlâ açık ve sayaçları şişirebiliyor · RİSK · DOĞRULANDI

- Bu uç hiçbir kelime kontrolü yapmadan günün sayacını artırıyor.
- Denemede 2 kelime cevaplandıktan sonra bir kez çağrıldı, anasayfa `completedWords: 3` gösterdi.
- API.md'de "normalde çağırmana gerek yok" yazıyor, ama uç çalışıyor.

**Mobil uygulama bu ucu çağırıyorsa**, Temmuzdaki "sayılar bazen tutmuyor" şikâyetinin kaynaklarından biri olabilir.

**Önerilen düzeltme:** Mobilin kullanmadığı teyit edilince uç kaldırılsın.

---

### H4 — Havuzda olmayan kelime de cevaplanabiliyor · GÜVENLİK/HİLE · KODDA GÖRÜLDÜ

**Sorun:** `POST /userwords/answer` yalnızca iki şeye bakıyor: kelime var mı, bugünün oturumu açık mı. Gönderilen kelimenin **bugünkü havuzda olup olmadığını kontrol etmiyor**.

**Nasıl kötüye kullanılır:**
- Uygulamayı kullanmadan, hesap anahtarıyla (token) doğrudan API'ye istek atan biri bunu yapabilir.
- Seçmeli sorularda doğru/yanlış kararını istemci verdiği için `result: "correct"` göndermesi yeterli.
- Böylece havuz dışındaki, hatta başka seviyedeki yüzlerce kelimeyi "doğru" işaretleyebilir.
- Her kelime günde bir kez sayıldığı için kelimelerin seviyesi ilerler, seviye kilitleri açılır, çember ve seri şişer.

**Kimi etkiler:** Sıradan kullanıcı değil, bunun için teknik bilgi gerekiyor. Ama seviye kilidi ve sınav gibi "kazanılan" şeyleri anlamsızlaştırır.

**Önerilen düzeltme:**
- Cevap yalnızca bugünkü havuzdaki kelime için kabul edilsin, havuz dışı kelime 400 alsın.
- Tek havuz geçişiyle aynı pakette yapılabilir, çünkü havuz okuması o sırada zaten değişecek.
- **Dikkat:** Bugünün hatalarını gösteren liste (`/userwords/mistakes`) gibi havuz dışından cevap gönderen bir ekran varsa, o ekran bu kuraldan etkilenir. Emirhan'a sorulmalı (7. bölüm, soru 7).

---

## 3. Madde 0 — ayrıntılı açıklama

### Emirhan'ın gördüğü yanıt
```
correctCount: 1, lastResult: "correct", masteryLevel: 2,
result: "empty", counted: false, correctAnswer: "ben"
```

### Bu yanıt ne anlatıyor?

1. **`correctAnswer` alanı var.** Bu alan yalnızca istemci `result` göndermeyip yazılı cevap (`answer`) gönderdiğinde, yani sunucu puanlama yaptığında dolar. Demek ki bu istek bir yazma sorusu isteğiydi.

2. **`counted: false`.** Bu istek hiçbir şeye işlenmedi. Sunucu kelimeyi "bugün zaten nihai cevabı verilmiş" diye tanıdı ve tekrar çalışma (nötr) dalına soktu.

3. **`correctCount: 1`, `lastResult: "correct"`, `masteryLevel: 2`.** Bu değerler bu isteğin sonucu **değil**. Nötr dal kaydı olduğu gibi geri döndürür. Bunlar **aynı gün daha önce gelmiş ayrı bir isteğin** kaydettiği değerler.

4. **`result: "empty"`.** Bu, **bu isteğin** puanı. Sunucu bu istekte gerçekten boş bir cevap aldı.

**Sonuç:** Arka arkaya **iki istek** gitmiş.
- **1. istek:** Doğru cevap ("ben") → `counted: true`, correctCount 0→1, seviye 1→2. Bu yanıt doğruydu.
- **2. istek:** Aynı kelime için boş cevap → nötr dal → `result: "empty"`.

Emirhan ikinci yanıta baktığı için "doğru cevapladım ama empty döndü, correctCount da arttı" diye okumuş. correctCount aslında ilk istekte artmıştı.

### Eski kod ile güncel kodun aynı isteklere verdiği yanıtlar

Önce "ben" gönderildi, sonra aşağıdaki ikinci istekler denendi:

| İkinci istek | 5 Eylül öncesi (`6fbbe5d`) | Güncel (`386cd21`) |
|---|---|---|
| Gövdede ne `result` ne `answer` | 400 | 400 |
| `answer: null` | **Emirhan'ın yanıtı birebir** | 400 ✅ |
| `answer: ""` | **Emirhan'ın yanıtı birebir** | **Emirhan'ın yanıtı birebir** ❌ |
| `answer: "   "` | **Emirhan'ın yanıtı birebir** | **Emirhan'ın yanıtı birebir** ❌ |

**Commit notunda düzeltilmesi gereken bir şey:** 5 Eylül commit'i kök nedeni "gövdesiz istek" olarak anlatıyor. Bu doğru değil. Hiç `answer` alanı olmayan istek eski kodda da zaten 400 alıyordu. Boş cevap yalnızca `answer: null` ya da `answer: ""` / boşluk gelince üretiliyordu.

### Durum

- **Mobil ikinci istekte `answer: null` gönderiyorsa:** Artık o istek **400 hatası** alıyor. Yanlış "boş geçildi" gösterimi biter, ama uygulama bu 400'ü bir hata ekranı olarak gösterebilir.
- **Mobil ikinci istekte `answer: ""` gönderiyorsa:** Sorun **aynen devam ediyor**.
- **Asıl soru:** Mobil neden aynı kelime için ikinci bir istek atıyor? Olası örnek: "Kontrol Et"ten sonra "Devam"da, temizlenmiş metin kutusuyla tekrar gönderim. Bu mobil kodu görülmeden kesinleşemez.

**İlk dokunuşta aynı boş istek:** Kelime `counted: true` ile ertelenmiş sayılır ve `emptyCount` 1 artar. Emirhan'ın "emptyCount şişiyor" dediği durum budur. Sunucu açısından bu doğru davranış, çünkü boş metin gerçekten "boş geçtim" demek. Ama istemci bunu yanlışlıkla gönderiyorsa sayaç haksız yere şişer.

---

## 4. Mobil tarafa MUTLAKA iletilecek sözleşme notları

Bu iki madde 5 Eylül'de değişti. Emirhan'ın 07.08 belgesindeki anlayışla uyuşmuyor. Mobil bunlara uymadıysa ekranlar yanlış sayı gösterir.

1. **`goal` artık "turun boyutu".**
   - Belgede "bugünün havuz boyutu" olarak geçiyor.
   - İlk turda iki anlam aynı sayıyı verir, ikinci turda ayrışır.
   - `goal` ile `progress.total` her zaman aynı sayıdır.
2. **Ders barı `progress.completed` / `progress.total` okumalı.**
   - `today.completedWords` okunmamalı. O sayı günün toplamıdır, turlar boyunca birikir.
   - Bar onu okursa taze turun ilk sorusunda **"20/20 · %100 Tamamlandı"** yazar.
   - `today` yalnızca anasayfa çemberi ve bitiş ekranı içindir.

> Not: Aşağıdaki "günde tek havuz" kararı alınırsa tur kavramı kalkar. O zaman
> bu iki not da sadeleşir: goal yeniden günün havuzu olur, progress ile today
> ayrımı gereksizleşir. Karar verilene kadar yukarıdaki haliyle geçerlidir.

---

## 5. Bekleyen ürün kararı: günde yalnızca bir havuz

**Yusuf'un hatırladığı kural:** Bir kullanıcıya günde yalnızca bir havuz verilir. İlkini bitirince yeni havuz oluşturulmaz.

**Tarihçe:**
- **18.07.2026:** Tasarım tam olarak buydu. Günde tek havuz vardı. "Tekrar çalış" modu aynı havuzu yeniden soruyordu ve sunucu bu cevapları saymıyordu (`counted: false`).
- **22.07.2026:** `4381c99` commit'inde "yeni tur desteği" eklendi. Oturum bitince bir sonraki `/today` çağrısı önceki kelimeleri hariç tutarak taze bir set üretiyor. Commit mesajı **gerekçe vermiyor**, bir sayaç hatası düzeltmesinin içine eklenmiş.
- **05.09.2026:** Tur kavramının üzerine tur/gün sayaç ayrımı, ertelenenlerin taşınması ve `roundStartedAt` kuruldu.

**Bu kararın dokunduğu yerler:**
- **H1:** Yalnızca tur olduğu için var. Tek havuzda bu hata ortadan kalkar.
- **H2:** Gün içinde seviye değişimi aynı güne ikinci bir havuz açıyor. Bu da "günde tek havuz" kuralıyla çelişiyor.
- **Madde 3, 4, 5:** `roundStartedAt`, ertelenenlerin taşınması ve iki ayrı sayaç ailesi turun üzerine kurulu.
- **Madde 0'ın olası kaynağı:** Kullanıcı aynı havuzu tekrar çalıştıysa ya da kelime ekranda kalıp yeniden gönderildiyse, ikinci istek `counted: false` döner. Kesin değil, mobil kodu görülmeden bilinemez.

**Durum:** ✅ KARARLAŞTIRILDI (14.09.2026): günde tek havuz. Ayrıntılı kurallar 6.3'te.

---

## 6. Madde 2–6 tartışma notları (14.09.2026)

### 6.1 Mobil tarafa iletilecek bilgiler
- **Tekrar listesinin (`reviewWords`) boş gelmesi hata değil.** Yeni hesapta tekrar kelimesi olmaz. Bir kelime önce cevaplanmalı, sonra vadesi gelmeli. Bu da en erken ertesi gün olur. Tekrar listesini ve oradaki `todayResult`'ı görmek için **bir gün önce çalışılmış bir hesap** gerekir.
- **`progress.answered` eskiden kalma bir alan.** Ertelenenleri de sayıyor. İlerleme sayısı olarak **kullanılmamalı**, `progress.completed` okunmalı.
- **`progress.remaining` "bu turda dokunulmamışlar" demek.** Emirhan'ın belgesindeki "bugün hiç dokunulmamışlar" değil. Tek havuz kararı alınırsa ikisi aynı şeye iner.

Şimdilik burada not olarak duruyor. Kararlar netleşince API.md'ye işlenecek.

### 6.2 Kaldırılması düşünülen alanlar
| Alan | Nerede | Kod içinde okuyan | Testlerde |
|---|---|---|---|
| `touchedToday` | `/today` → `reviewWords[]`, `newWords[]` | Yok | 1 yer |
| `progress.answered` | `/today`, `/answer`, `/sessions/current` | Yok | 5 yer |

**Şart:** Mobilin bu alanları okumadığı teyit edilmeli (bkz. 7. bölüm, soru 6).

### 6.3 Yön olarak kabul edilenler (Yusuf, 14.09.2026)
- **KARAR: Günde tek havuz.** Bir kullanıcıya günde yalnızca bir havuz verilir, havuz bitince yeni havuz ya da yeni tur açılmaz. 22.07'de eklenen tur mekanizması kaldırılacak.
- **KARAR: Havuz karışık seviyeli olmaz.** N5 havuzuna N4 kelimesi girmez. Bu yüzden H2 için B seçeneği elendi.
- **KARAR: Seviye değişimi C seçeneği.**
  - Bugün hiç cevap verilmemişse havuz hemen yeni seviyeyle yeniden kurulur.
  - En az bir cevap (erteleme dahil) varsa bugünün havuzu eski seviyede kalır, yeni seviye ertesi gün başlar.
  - Kullanıcıya mesaj gösterilir: "Bugünkü dersine başladığın için N4 yarın başlayacak."
  - *Planda netleşecek:* `activeLevel` anında mı değişir, yoksa "bekleyen seviye" olarak mı tutulur? O gün anasayfa hangi seviyeyi gösterir?
- **KARAR: Ertelenen kelimenin cevabı normal sayılır.**
  - Havuz bitince yeni tur ya da yeni kelime gelmez.
  - Kullanıcı oturumu tekrar açıp yalnızca ertelediği kelimeleri cevaplayabilir.
  - Bu cevaplar kelimenin seviyesini ilerletir ve çemberi doldurur (bugünkü "ertelenmişin ilk gerçek cevabı" kuralı aynen kalır).
- **KARAR: Bitiş ekranı kuralı.**
  - Dersten **çıkmak** her zaman serbest. Çıkınca bir şey kapanmaz, geri gelince kaldığı yerden devam eder.
  - **Bitiş ekranı** yalnızca her kelimeye en az bir kez dokunulunca açılır (dokunulmamış kelime sayısı 0).
  - Dokunulmamış kelimeler bitince ertelenenler sıranın sonuna geri döner.
  - Bitiş ekranında "X kelimeyi sonraya bıraktın, istediğin zaman dönebilirsin" yazar.
  - "Şimdilik Geç" sayısına **sınır yok**, çünkü erteleme seviye, seri ya da çember kazandırmıyor, hile değeri yok.
  - *Planda netleşecek:* Dokunulmamış kelime varken `complete` isteğini sunucu mu reddeder, yoksa yalnızca istemci mi engeller?
- **KARAR: Yarıda bırakılan sınav modalı kapatmaz.** Sınava girip çıkan ya da süresi dolan kullanıcıya "Seviyeni Öğrenelim Mi?" modalı yeniden gösterilir. Modalı yalnızca **tamamlanmış** bir sınav ya da "Daha Sonra" kalıcı olarak kapatır.
- **Madde 4:** Ertelenenler günün havuzundan düşmez, "bitir" yalnızca bitiş ekranını gösterir. Emirhan'ın belgedeki (a) seçeneği bu. Tek havuz kararıyla birlikte ertelenenleri taşıma mekanizması kalkar.
- **Madde 5:** Çemberin %100'ü aşması (örnek: 23/20) tek havuzla çözülür. Tur ve gün sayaçları tek bir aileye iner, 4. bölümdeki iki mobil notu gereksizleşir.

### 6.4 Konuşulacaklar

> **14.09.2026 güncellemesi:** Aşağıdaki 1–4 numaralı konuların hepsi kararlaştırıldı, bkz. 6.3. Tarihçe için olduğu gibi bırakıldı.
1. **Dokunulmamış kelimelerle ders bitirilebilmeli mi?**
   - Şu an bitirilebiliyor ve bunu doğrulayan bir test var.
   - Böyle bitirilen turdaki dokunulmamış kelimeler o gün bir daha sorulmuyor.
   - Veri kaybı yok: yeni kelimeler yarın müfredattan tekrar gelir, tekrarlar vadede kalır.
2. **Tek havuzda ertelenen kelime ne zaman tekrar sorulur?** Şu an aynı turda sorulmuyor, sonraki tura taşınıyor. Tur kalkınca yeni bir kural gerekir.
3. **H2'nin çözümü:** Gün içinde seviye değişince havuza ne olacak?

   **Şu anki durum:** `setActiveLevel` yalnızca `User.activeLevel` alanını değiştiriyor. Havuz anahtarı `{user, gün, seviye}` olduğu için bir sonraki `/today` çağrısı aynı güne **ikinci bir havuz** açıyor. Bu hem "günde tek havuz" kuralına aykırı, hem de anasayfa 10 / ders 5 farkının kaynağı.

   | Seçenek | Nasıl çalışır | Artısı | Eksisi |
   |---|---|---|---|
   | **A. Ertesi günden geçerli** | Seviye kaydedilir, bugünün havuzu eski seviyede kalır | En basiti, tek havuz kendiliğinden korunur | "Şimdi Geç" butonu anında geçmiyor, kullanıcıya "yarından itibaren" demek gerekir |
   | **B. Havuz yeni seviyeye dönüşür** (önerilen) | Havuz güne tekil olur (`{user, gün}`). Seviye değişince **dokunulmamış** kelimeler yeni seviyenin kelimeleriyle değiştirilir, cevaplanan ve ertelenenler havuzda kalır, hedef aynı kalır | Geçiş anında hissedilir, tek havuz korunur, anasayfa ile ders aynı sayıyı verir | Gün içinde havuz karışık seviyeli olabilir. Havuz anahtarı değişeceği için canlı veritabanında geçiş (migration) gerekir |
   | **C. Yalnızca havuza dokunulmamışsa anında** | Hiç cevap yoksa havuz yeniden kurulur, varsa A gibi ertesi gün | B'den basit | Kullanıcı için tutarsız: bazen anında, bazen yarın |

   **B'nin ayrıntıları:**
   - Günün 20 kelimesini bitirmiş kullanıcı seviye değiştirirse değiştirilecek kelime kalmaz. Yeni seviye yarın başlar. Bu da tek havuzun "günün hedefi bitti" mantığıyla uyumlu.
   - `tests/api.test.js` içindeki "N4 ve N5 havuzları ayrı ayrı korunmalı" testi değişir. Yeni beklenti: tek havuz ve cevaplananlar korunur.

4. **Yarıda bırakılan sınav modalı kalıcı olarak kapatıyor** (Madde 6 yan bulgusu, düşük öncelik): `placementPrompt`, **herhangi** bir sınav denemesi varsa `false` dönüyor. Sınava girip çıkan ya da süresi dolan kullanıcı sonuç almamış olsa bile "Seviyeni öğrenelim mi?" modalını bir daha görmüyor. Ayarlar'daki satır açık kaldığı için sınava yine girilebiliyor. Bu bilinçli mi?

### 6.5 Yapılmış, müdahale gerektirmeyenler
Kodda ve denemede doğrulandı:
- **2.1:** `todayResult` hem `reviewWords` hem `newWords` öğelerinde geliyor.
- **2.2:** `newWords` içinde `answeredToday` / `todayResult` var (5 Eylül öncesinde de vardı).
- **2.3:** `progress` içinde `completed` / `postponed` / `remaining` ayrı geliyor. Ertele, sonra cevapla sırasında sayılar doğru değişiyor.
- **3:** `GET /sessions/current` var. `queue` sunucu sırasıyla geliyor, `currentIndex` her zaman 0. Bu uçtaki H1 hatası ayrı bir konu.
- **4:** 409 kalktı. Bitirme yanıtında `pendingWords` ve `accuracy` geliyor, doğruluk oranında payda doğru + yanlış.
- **5:** `completedWords` = doğru + yanlış. Erteleme → cevap sırasında `emptyCount` düşüyor, `completedWords` artıyor. Anasayfa ile `/answer` aynı sayıyı veriyor. H2 bunun istisnası.
- **6:** `/home/summary` yanıtında `placementAvailable` ve `nextAttemptAllowedAt` var.
  - `placementPrompt` (modal kendiliğinden açılsın mı) ile `placementAvailable` (sınava şu an girilebilir mi) farklı sorular.
  - İkisi **çelişemez**: prompt yalnızca hiç denemesi olmayan kullanıcıda true döner, o kullanıcıda bekleme süresi de olamaz.
- **Ek:** Anasayfadaki `progress`, `pendingReviews` ve `tomorrowReviews` alanları arkalarındaki sorgularla birlikte kaldırıldı.

---

## 7. Emirhan'a sorulacaklar

1. Yazma sorusunda bir kelimeye cevap gönderildikten sonra **aynı kelime için ikinci bir `POST /userwords/answer`** atılıyor mu? Atılıyorsa gövdesi ne? (`answer: null` mı, `""` mı?)
2. Uygulama `PUT /sessions/update` ucunu herhangi bir yerde çağırıyor mu?
3. Ders barı `progress.completed` / `progress.total` mı okuyor, yoksa hâlâ `today.completedWords` mı?
4. Ders sırası sunucunun `queue` alanından mı geliyor, yoksa istemci kendi sırasını mı kuruyor? H1'in kullanıcıya nasıl yansıyacağı buna bağlı.
5. 5 Eylül değişikliklerinden sonra uygulamanın canlı sürümüyle bu belgedeki durumlar yeniden denendi mi?
6. Uygulama `touchedToday` ya da `progress.answered` alanlarını herhangi bir yerde okuyor mu? Okumuyorsa ikisi de kaldırılacak.
7. Havuz **dışındaki** bir kelime için `POST /userwords/answer` gönderen bir ekran var mı? Örneğin "Bugünün Hataları" listesinden tekrar çalışma. H4 düzeltmesi bu ekranları etkiler.

---

## 8. Yapılacak işler

Kod yazılmadı. Önce onaylı plan hazırlanacak.

| # | İş | Durum |
|---|---|---|
| **Tek havuz** | Tur mekanizmasının kaldırılması: `roundClosedAt`, `roundStartedAt`, ertelenenlerin taşınması. Havuz kimliği `{user, gün, seviye}` → `{user, gün}`, canlı veritabanı geçişiyle. `progress` ile `today` tek aileye iner | Karar verildi, plan bekliyor |
| H1 | Tek havuzla **kendiliğinden ortadan kalkar** (taşıma yok). Test olarak "ertelenen kelime tekrar ertelenebilir" senaryosu eklenmeli | Tek havuza bağlı |
| H2 | Seviye değişimi C kuralı (bkz. 6.3) + test | Karar verildi, plan bekliyor |
| Bitiş kuralı | Bitiş yalnızca dokunulmamış kelime 0 iken. Ertelenenler sıranın sonuna döner | Karar verildi, plan bekliyor |
| H4 | Cevap ucunda "kelime bugünkü havuzda mı" kontrolü | Karar verildi, Emirhan'ın teyidi bekleniyor (soru 7) |
| Sınav modalı | `shouldPromptPlacement` yalnızca tamamlanmış sınava ya da "Daha Sonra"ya bakacak | Karar verildi, plan bekliyor |
| H3 | `/sessions/update` ucunun kaldırılması | Emirhan'ın teyidi bekleniyor (soru 2) |
| Alan temizliği | `touchedToday` ve `progress.answered` kaldırılması | Emirhan'ın teyidi bekleniyor (soru 6) |
| Madde 0 | İkinci isteğin kaynağının bulunması | Emirhan'ın cevabı bekleniyor (soru 1) |
| Belgeler | API.md'nin yeni kurallara göre yeniden yazılması. Hafıza kaydındaki "gövdesiz istek" ifadesinin düzeltilmesi | Kodla birlikte |

---

## 9. Emirhan'ın cevapları (20.09.2026)

Mobil taraf 7 sorunun hepsini kod okuyarak cevapladı. Uygulamayı çalıştırıp gerçek istek/yanıt görmedi.

### 9.1 MADDE 0 ÇÖZÜLDÜ — kök neden bulundu

**"Şimdilik Geç" sunucuya şunu gönderiyor:**
```jsonc
{ "wordId": "...", "answer": "" }
```
`result: "empty"` göndermiyor. İstemcide `cevapla(null)` çağrılıyor, `cevap?.trim() ?? ""` bunu boş metne çeviriyor. `answer: null` gönderen bir yol **yok**.

**Sonuç:** Sunucu "Şimdilik Geç" ile "yazma sorusunda kutuyu boş bıraktı"yı ayırt edemiyor, ikisi de boş cevap olarak puanlanıyor.

**Emirhan'ın gördüğü hata tam olarak şöyle oluşuyor:**
1. Kelimenin bugünkü gerçek cevabı zaten verilmiş (`lastResult: "correct"`).
2. Kelime istemcinin kuyruğunda bir daha çıkıyor.
3. Kullanıcı "Şimdilik Geç"e basıyor → `answer: ""` gidiyor.
4. Sunucu kelimeyi "bugün zaten cevaplanmış" diye tanıyıp tekrar çalışma dalına sokuyor: `result: "empty"`, `counted: false`.
5. İstemci `result`'a bakıp kelimeyi "ertelendi" sayıyor, boş geçme sayacı şişiyor.

**5 Eylül düzeltmesi bu akışa hiç dokunmuyor.** O düzeltme yalnızca `answer: null` yolunu kapattı, ama istemci hiçbir zaman `null` göndermiyor. Yani **canlıdaki uygulama için düzeltme fiilen etkisiz kaldı.**

**Çözüm (iki parça):**
- **İstemci:** "Şimdilik Geç" `answer: ""` değil, `result: "empty"` göndermeli. Sözleşme bunu zaten destekliyor.
- **Sunucu:** Tek havuz düzeninde, bugünkü gerçek cevabı verilmiş kelime kuyrukta hiç kalmayacağı için 2. adım da ortadan kalkar.

### 9.2 Kapanan konular

| Soru | Cevap | Sonuç |
|---|---|---|
| `/sessions/update` çağrılıyor mu? | Kod tabanında tek satır bile yok | **H3 kaldırılabilir**, engel yok |
| Havuz dışı kelimeye cevap gönderen ekran var mı? | Yok. "Bugünün Hataları" ve Kütüphane salt okunur, cevap ucunu yalnızca ders ekranı çağırıyor | **H4 düzeltmesi güvenli** |
| `touchedToday` okunuyor mu? | Hiç okunmuyor | Kaldırılabilir |
| Aynı kelimeye ikinci istek atılıyor mu? | Yalnızca ertelenen kelime kuyrukta tekrar çıkarsa. Uygulamada "tekrar çalış" ekranı yok, "Devam" butonu ağ isteği atmıyor | 9.1'deki akış |

### 9.3 Yeni çıkan uyumsuzluklar

1. **Ders barını istemci kendi hesaplıyor.**
   - Payda: `progress.total` (sunucudan).
   - Pay: istemcide tutulan "bu oturumda dokunulan benzersiz kelime" sayısı + `progress.total - kuyruk uzunluğu` ile türetilen bir başlangıç değeri.
   - Yani bar hem sunucudan hem istemciden besleniyor, uygulama kapanınca payın bir kısmı yeniden türetiliyor.
   - **Emirhan'ın gerekçesi:** Bar "Şimdilik Geç"i ilerleme saymalı, çember saymamalı. Bu **doğru bir istek**.
   - **Sonuç:** `progress.answered` alanını kaldırma kararı yanlış olur. Bu alan barın tam olarak ihtiyacı duyduğu sayı (cevaplanan + ertelenen = dokunulan). Kaldırmak yerine **`touched` olarak yeniden adlandırılıp** "ders barının payı" diye belgelenmeli.
   - Yeni bitiş kuralımızla da birebir örtüşüyor: bar dolduğunda (`touched == total`) bitiş ekranı açılabilir.
2. **İstemci `queue` alanını hiç okumuyor.**
   - Sırayı kendisi kuruyor: `reviewWords` + `newWords` birleştirip `answeredToday: true` olanları atıyor.
   - Yani Madde 3 sunucuda yapıldı ama mobil tarafa **hiç bağlanmadı**. "Uygulama silinse bile ders kaldığı yerden devam eder" faydası bugün alınmıyor.
   - Tek havuz geçişinde bu bağlanmalı, yoksa sıra kuralları iki yerde ayrı ayrı yaşamaya devam eder.

### 9.4 Emirhan'ın elindeki imkân

- Uygulamada ağ günlüğü ekranı var (istek/yanıt dökümü alınabiliyor), hata ayıklama sürümü (`app-debug.apk`) hazır.
- Ders akışında zaten tanı logları duruyor, birinin yorumu "tekrar sorulan kelime hatası için" diyor. Yani kelimelerin tekrar sorulması sorunu mobil tarafta da araştırılmış.
- **İstenecek döküm:** Bir ders turu boyunca `/userwords/today` ve her `/userwords/answer` isteği + yanıtı. Özellikle **bugün cevaplanmış bir kelimeye "Şimdilik Geç"e basılan an** (9.1'deki akış).
- Emirhan'ın `ders_cubit.dart`'ta commit edilmemiş bir yaması var (oturum alanlarını sıfırlıyor, davranışı bugün değiştirmiyor).

---

## 10. KARAR GERİ ALINDI — çok havuza dönüş (21.09.2026)

14.09'da "günde tek havuz" diye kesinleştirdiğimiz karar geçersiz. Emirhan
fikrini değiştirdi: **birden fazla havuz olacak.**

**Gerekçesi henüz alınmadı.** Sorulacak: neden değişti, ekranda nasıl
görünecek (kullanıcı mı istiyor, kendiliğinden mi açılıyor), kaç tura kadar?

**Bunun geri getirdikleri:**
- **H1 yeniden gerçek bir hata.** Taşınan kelime yeni turda tekrar ertelenemiyor,
  kuyruğun başında takılı kalıyor. Tek havuzda kendiliğinden kalkacaktı, artık
  düzeltilmesi ŞART.
- **Tur/gün sayaç ayrımı kalıyor.** `progress` (tur) ile `today` (gün) ayrımı ve
  4. bölümdeki iki mobil notu geçerliliğini koruyor.
- **H2'nin çözümü yeniden açık.** "Havuz güne tekil olsun" fikri artık geçersiz.
- **Madde 0'ın sunucu tarafı ayağı kalıyor.** "Cevaplanmış kelime kuyrukta
  kalmasın" tek havuz varsayımına dayanıyordu.

**Kararlaştırılacak tasarım soruları:** 6.3'teki tek havuza bağlı kararlar
(ertelenenler, bitiş ekranı, seviye değişimi C) bu yeni düzende yeniden
gözden geçirilmeli.

### 10.1 Çok havuz tasarımı — Yusuf'un kuralları (21.09.2026)

**Ürün gerekçesi:** Uygulama büyüme ve gelir hedefliyor. İsteyen kullanıcı
günde daha fazla öğrenebilmeli. Henüz test edilmedi, kullanıcı geri bildirimi
yok.

**Kurallar:**
- Günde **en fazla 2 havuz**.
- İkinci havuz **yalnızca birinci havuz TAMAMEN bitirilmişse** açılır:
  dokunulmamış kelime de, ertelenmiş kelime de kalmayacak.
- Ekstra havuzun kelimeleri günün toplamına **eklenir**.

**Bu kuralın büyük yan faydası:** Ertelenen kelimeyi yeni tura TAŞIMA
mekanizmasına gerek kalmıyor. İkinci havuz ancak ertelenmiş kelime kalmayınca
açıldığı için taşınacak kelime hiç olmuyor. **H1 bu tasarımla ortadan kalkar**
(taşıma kodu silinecek, senaryo için test eklenecek).

**Açık kalan: çember nasıl görünecek?**
Kullanıcı 20/20 ile %100 yapıp ikinci havuzu açınca, payda 40 olursa çember
%50'ye düşer — tamamlanmış bir gün yarım görünür. Seçenekler:
- (a) Çember o anki havuzun ilerlemesini gösterir, altında "bugün toplam N kelime".
- (b) Payda büyür (20/40) — Yusuf'un ilk önerisi, çember geri düşer.
- (c) Çember 20/20 dolu kalır, ekstra "+N" olarak ayrı yazılır.

**Öneri (ayrıca):** İkinci havuz önce vadesi gelmiş TEKRARLARDAN kurulsun,
yeni kelime ancak tekrar kalmadıysa girsin. Yoksa aynı gün iki kat yeni kelime
ertesi güne iki kat tekrar borcu olarak döner.

---

## 11. H5 — İstemcinin kuyruk tazelemesi TERS çalışıyor · YÜKSEK · CANLIDA GÖRÜLDÜ (21.09.2026)

**Nasıl görüldü:** Yeni test hesabıyla canlı ders turu, telefon loglarından.
20 kelimelik havuzda 17 kelime cevaplandı (15 doğru + 2 yanlış), 3 kelime
"Şimdilik Geç" ile ertelendi. Sonra istemci `/userwords/today`'i yeniden çağırdı:

```
14:42:39  GET /userwords/today → 200
14:42:39  ders → kuyruk tazelendi, 17 kelime kaldı: 私, あなた, これ, ... 家
```
Listelenen 17 kelime **cevaplanmış** olanlar. Ertelenmiş 3 kelime (この, その, 土)
kuyruktan **düşmüş**. Olması gerekenin tam tersi.

Hemen ardından kullanıcı 私'yi tekrar cevapladı:
```
14:42:50  ders /answer → 私 ... result: correct, counted: false,
          progress: {total 20, completed 17, postponed 3, remaining 0}
```

**Sunucu suçsuz — ölçüldü.** Aynı senaryo bellek içi veritabanında birebir
kuruldu (17 cevap + 3 erteleme), sunucunun `/userwords/today` yanıtı:
- `progress`: total 20, completed 17, postponed 3, remaining 0 ✓
- `queue`: 0, `postponedIds`: 3, `completedIds`: 17 ✓
- Cevaplanmış kelimeler: `answeredToday=true` ✓
- Ertelenmiş kelimeler: `answeredToday=false`, `todayResult="empty"` ✓
- Emirhan'ın söylediği filtre (`!answeredToday`) uygulanınca geriye **yalnızca
  3 ertelenmiş kelime** kalıyor — yani doğru sonuç.

**Sonuç:** İstemcinin ilk yükleme filtresi doğru, ama "kuyruk tazeleme" yolu
başka bir mantık kullanıyor ve ters çalışıyor. Cevaplanmışları tutuyor,
ertelenmişleri atıyor.

**Bu hata iki şikâyetin birden kaynağı:**
1. "Kelime tekrar soruluyor" (Temmuz'dan beri bildiriliyor).
2. **Madde 0.** Cevaplanmış kelime tekrar sorulunca kullanıcı "Şimdilik Geç"e
   basıyor, `answer: ""` gidiyor, sunucu tekrar-çalışma dalında
   `result: "empty"`, `counted: false` dönüyor, istemci "boş geçildi" gösteriyor.
   Zincirin tamamı artık canlıda görülmüş durumda.

**Kimde düzeltilecek:** Mobil. Emirhan'a iletilecek.

### 11.1 Buna bağlı SUNUCU değişikliği (yeni kurallardan doğan)

Sunucu bugün ertelenmiş kelimeyi **aynı turda kuyruğa geri koymuyor** (tasarım
böyleydi: sonraki tura taşınıyordu). Ama yeni kural "ikinci havuz ancak hiç
ertelenmiş kelime kalmayınca açılır" diyor. O hâlde kullanıcının ertelediği
kelimeyi **aynı ders içinde** tekrar görmesi ŞART, yoksa ikinci havuzu asla
açamaz.

**Yapılacak:** Kuyruk sırası = önce hiç dokunulmamışlar, sonra ertelenmişler.
`queue` alanı ertelenenleri de içersin (sonda). Bitiş ekranı kuralı da buna
bağlanır.

### 11.2 Küçük gözlem
Anasayfa açılışında `GET /home/summary` **üç kez** çağrılıyor. Hata değil,
gereksiz yük. Mobil tarafa not.

### 11.3 Ayarlar ekranı: her dokunuşta ayrı istek
Canlı logda (21.09, 14:43) Ayarlar'da yarım dakikada **11 kez**
`PUT /auth/update-info` gitti. Aradaki dil değişimleri (en → tr) de ayrı
isteklerdi. Her dokunuş/anahtar tam bir profil güncelleme isteği atıyor.
Hata değil, veri bozulmuyor; gereksiz yük ve her istek doğrulamadan geçiyor.
Öneri (mobil): değişiklikleri biriktirip ekrandan çıkarken tek istekle
göndermek ya da kısa bir gecikmeyle birleştirmek.

### 11.4 Ağ günlüğü panelinin kapsamı
Uygulamada iki ayrı kayıt yolu var: (a) auth ekranlarındaki elle yazılmış
`print` satırları (checkEmail, register, dogruladim), (b) ağ ara katmanı
(`GET /yol → kod`). Uygulama içindeki Ağ Günlüğü paneli yalnızca (b)'yi
gösteriyor ve ara katman oturum açıldıktan sonraki istemciye bağlı — bu yüzden
kayıt/doğrulama istekleri panelde görünmüyor. logcat ikisini de görüyor.
Eksiklik değil, kapsam farkı.

---

## 12. Canlı turun geri kalanı (21.09.2026) — üç yeni bulgu

### H6 — "Dersi Bitir" sunucuya HİÇ istek atmıyor · YÜKSEK · CANLIDA GÖRÜLDÜ
Tüm log dosyasında `PUT /sessions/complete` çağrısı **sıfır kez** geçiyor.
Kullanıcı "Dersi Bitir"e bastığını söylüyor, ama istek gitmemiş.

**Sonuçları:**
- Oturum sunucuda hiç kapanmıyor (`isCompleted` hep false).
- `completedAt`, `duration` hiç hesaplanmıyor, `session_completed` event'i hiç yazılmıyor.
- Havuz "tur kapandı" (`roundClosedAt`) olarak işaretlenmiyor, yani **sunucu
  tarafındaki yeni tur mekanizması pratikte hiç tetiklenmiyor**.
- Gün detayı/istatistiklerde o gün "tamamlanmamış" görünür.

**Not:** Emirhan `ders_service.dart:60`'ta `PUT /sessions/complete` olduğunu
söylemişti. Kod var ama çağrılmıyor ya da koşulu tutmuyor. Mobil tarafta
araştırılmalı.

### H7 — Kuyruk boşalınca istemci TÜM havuzu yeniden soruyor · YÜKSEK · CANLIDA GÖRÜLDÜ
```
15:27:58  ders /today → progress={total 20, completed 17, postponed 3, remaining 0}
15:27:58  ders → sorulacak 20 kelime: 私, あなた, これ, ... (hepsi)
15:27:58  ders → gün ilerlemesi: 17/20, bar başlangıcı: 0
```
Sunucu "remaining 0" diyor, istemci yine de 20 kelimenin tamamını kuyruğa
koyuyor ve barı 0'dan başlatıyor. Kullanıcının gördüğü: "baştan çözdürüyor".
H5'in (ters kuyruk tazeleme) ikizi; ikisi de aynı yerde, istemcinin kuyruk
kurma mantığında.

**Dikkat:** Ertelenmiş 3 kelime bu listede de yok. Kullanıcı ertelediği
kelimeleri hiç göremiyor, yani yeni kuralla ikinci havuzu asla açamaz.

### H8 — Anasayfa çemberi "20/20 Tamamlandı" diyor, gerçekte 17 · ORTA · CANLIDA GÖRÜLDÜ
Kullanıcının gördüğü: "20/20 tamamlandı · 3 kelime ertelendi".
Sunucunun söylediği: `completedWords: 17`, `totalWords: 20`, `emptyCount: 3`.

İstemci çemberi `totalWords` (dokunulan) ile çiziyor, `completedWords` ile
değil. Bu, 06.08.2026'da sunucuda çözülen "20/20 ama ders bitmiyor" hatasının
istemci tarafındaki kalıntısı. Üstelik kendi içinde de çelişiyor: hem
"tamamlandı" diyor hem "3 kelime ertelendi".

### MADDE 0 — canlıda birebir görüldü
```
15:28:04  ders /answer → 私   : result:empty todayResult:correct counted:false
15:28:05  ders /answer → あなた : result:empty todayResult:correct counted:false
15:28:06  ders /answer → これ  : result:empty todayResult:correct counted:false
15:28:08  ders /answer → それ  : result:empty todayResult:correct counted:false
```
Bugün doğru cevaplanmış dört kelime H7 yüzünden tekrar soruldu, kullanıcı
"Şimdilik Geç"e bastı, `answer: ""` gitti, sunucu tekrar-çalışma dalında
`result: "empty"` döndürdü. Emirhan'ın 07.08'de bildirdiği yanıtın aynısı.
**Zincirin tamamı artık kayıt altında.** Sunucu `todayResult: "correct"`
göndererek doğru bilgiyi de veriyor; istemci `result`'a bakıyor.

### Bu turun sonucu
Ders akışında kalan hataların **tamamı istemci tarafında**. Sunucunun bu
senaryodaki tek eksiği, ertelenmiş kelimeyi aynı turda kuyruğa geri koymaması
(bkz. 11.1) — o da yeni kurallarla birlikte değişecek.

---

## 13. İkinci tur: diğer ekranlar (21.09.2026, 15:28–15:39)

**Sağlıklı çalışanlar:** Hata listesi, hikâye açma/görme, bildirimler (liste,
okundu, tümünü okundu), Hafıza'nın beş kutusu (new/weak/medium/good/mastered),
Kütüphane listesi ve arama, Seviyeler dağılımı. Hepsi 200 döndü.
Süresi dolan oturum anahtarı kendiliğinden yenilendi, istek tekrarlandı (401 → 200).

### 13.1 `POST /notifications/test` yayındaki uygulamada açık
Kullanıcı bu ucu ekrandan 14 kez tetikleyebildi. Test/hata ayıklama amaçlı bir
uç, sürüm derlemesinde kullanıcıya görünmemeli. Sunucuda da yalnızca yönetici
ya da geliştirme ortamıyla sınırlanabilir.

### 13.2 Aramada her tuşa basışta istek gidiyor
```
q=tekil → q=tekill → q=tekilli → q=tekillik   (ayrı ayrı istekler)
```
Üstelik bazı tuşlarda **iki** istek atılıyor: biri seviye filtreli, biri
filtresiz (`q=tekil` ve `q=tekil&jlptLevel=N5`). Kısa bir gecikmeyle
(debounce) birleştirilmeli. 11.3'teki Ayarlar davranışının aynısı.

### 13.3 Hiç çağrılmayan uçlar
Bugüne kadarki tüm trafikte bir kez bile kullanılmadı:
`/streak`, `/home/calendar`, `/home/day/:tarih`, `/userwords/list`,
`/sessions/complete`, `/sessions/current`, `/sessions/today`, `/sessions/history`

- `/sessions/complete` → H6, gerçek hata.
- `/sessions/current` → Madde 3 mobile hiç bağlanmadı.
- `/streak`, `/sessions/today` → bilgileri zaten `/home/summary` içinde, gereksiz olabilir.
- `/home/calendar`, `/home/day/:tarih`, `/userwords/list` → ekranı var mı, karar verilmeli.

### 13.4 Figma kontrolü (21.09) — takvim ve "Tekrar Çöz"

**Takvim ekranı YOK.** Tasarımda yalnızca anasayfadaki yedi günlük seri şeridi
var ("🔥 12 Gün" + 7 daire). Bu veri zaten `/home/summary` → `streak.week`
içinde geliyor. Sonuç: `/home/calendar` ve `/home/day/:tarih` uçlarının
ekranı yok → **kaldırılacaklar** (kullanılmayan alanları temizlediğimiz gibi).

**"Tekrar Çöz" tasarımda VAR — H7 kısmen yeniden değerlendirilmeli.**
Anasayfadaki "Bugünün Çalışması" kartının dört hali var:
- `%0 · 0/20` → **Başla**
- `%52 · 11/20` → **Devam**
- `%100 · 20/20 tamamlandı` → **Tekrar Çöz**

Yani havuz bitince aynı kelimeleri yeniden çözmek **tasarlanmış bir özellik**.
Sunucu bunu zaten destekliyor (`counted: false`, hiçbir sayaç oynamaz).

Ama canlıda gördüğümüz durum yine de yanlış:
- İlerleme **17/20** iken (yani "Devam" halindeyken) tüm havuz baştan soruldu.
- Ertelenmiş 3 kelime hiçbir modda görünmedi.
- Kart "20/20 tamamlandı" dedi (H8), oysa 3 kelime cevapsızdı.

**Ayrıca:** "Tekrar Çöz" modunda kullanıcı bir kelimeye "Şimdilik Geç" derse
Madde 0 zinciri yine kurulur (`answer: ""` → `result: "empty"`). Yani mobilin
`result: "empty"` göndermesi ve rozeti `todayResult`'tan çizmesi şart.

**Yeni soru:** "Tekrar Çöz" ile "ikinci havuz" farklı şeyler. Birincisi aynı
kelimeler (sayılmaz), ikincisi yeni kelimeler (sayılır). Kullanıcı bu ikisini
ekranda nasıl ayıracak? Tasarımda ikinci havuz için bir hal yok.

**Yan gözlem:** Figma'da "Genel Sıralama" başlıklı bir çerçeve var ama içeriği
"Bugünün Hataları" listesi. Eski isim mi kalmış, yoksa sıralama/liderlik
tablosu planlanıyor mu? Sıralama gerçekten gelecekse backend'de yeni iş demek.

**"Genel Sıralama" çerçevesi — açıklandı:** v1 kapsamında değil. Emirhan'ın
v2 için düşündüğü sosyal özelliklerin taslağı: kullanıcılar birbirini
ekleyip arkadaş olabilecek, genel sıralama ve arkadaşlar arası sıralama
görülebilecek. Figma'daki çerçeve adı eski kopyadan kalmış, içerik "Bugünün
Hataları". **v1 için backend işi yok.**
