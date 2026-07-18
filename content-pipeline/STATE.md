# Gece Koşusu — Durum ve Sözleşme

Bu dosya /loop turlarının tek hakikat kaynağıdır. Her tur: burayı oku →
"Sıradaki iş"i yap → ilerlemeyi ve saati buraya işle → lokal commit at.

## Görev (Faz 1 — meaningTr + tür düzeltme)

Dev DB'deki kelimeler için Türkçe anlam üretimi. Kaynak sıralama: önce
isCore=true (3000), sonra kalan. Dilim boyutu: ~250 kelime/tur.

Her kelime için üretilen kayıt (out/meaningtr-NNN.jsonl):
`{id, kanji, kana, jlptLevel, meaningEn, type, meaningTr}`
- meaningTr: kısa, UI'da quiz cevabı olarak gösterilebilir (1-4 kelime,
  ≤40 karakter). Parantez yalnız ayırt edicilik şartsa (くれる → "vermek
  (bana)"); süsleme/açıklama parantezi yasak.
- type: 5'li enum (fiil/sıfat/isim/zarf/diğer) — meaningEn+kanji'den
  yeniden değerlendirilir, çoğunluk "isim" varsayımına güvenilmez.
- Format onayı: pilot (out/pilot-meaningtr.jsonl) kullanıcı tarafından
  onaylandıktan sonra bu kurallar donar.

Her dilimden sonra doğrulama: `node content-pipeline/05-validate-tr.js <dosya>`
(enum, uzunluk, aynı seviyede meaningTr çakışması). Çakışanlar aynı turda
yeniden yazılır; çözülemeyen İNSAN-KUYRUĞU bölümüne düşer.

## Sözleşme (değişmez kurallar)

- YAZILABİLİR: content-pipeline/out/*, bu dosya, hafıza dizini. Başka hiçbir
  dosya gece değiştirilmez (models/, modules/, seeds/, API.md dahil).
- DB'ye GECE YAZILMAZ. Import (06-import-tr.js) sabah kullanıcı onayıyla
  koşulur. Prod'a hiçbir koşulda dokunulmaz.
- Git: her dilim sonunda lokal commit (checkpoint). PUSH ASLA YOK.
- Kapsam genişletme yok: örnek cümle üretimi (Faz 2), şema değişikliği,
  kotoba tarafında değişiklik bu koşunun dışındadır.
- Belirsizlikte: kelimeyi İNSAN-KUYRUĞU'na yaz, akışı durdurma.
- KOTA KURALI: hiçbir koşulda ek kullanım/ücret tetiklenmez. Kota biterse
  istekler kendiliğinden durur — bu normaldir; dönüşte kaldığı dilimden
  devam edilir. Kullanıcı sabah 9-10 arası gelecek.
- Saat 10:30'u (Europe/Istanbul) geçtiyse yeni tur başlatma: son durumu yaz,
  özet raporu bu dosyanın başına ekle, döngüyü ScheduleWakeup stop ile bitir.
- Kota/hata nedeniyle tur yarım kaldıysa: sonraki tur aynı dilimi baştan alır
  (dilim dosyası atomik yazılır: önce .tmp, doğrulama geçince asıl ad).

## İlerleme

| Dilim | Kelime | Durum | Dosya |
|---|---|---|---|
| pilot | 20 | ONAYLANDI (19.07 ~01:30) + doğrulandı | out/pilot-meaningtr.jsonl |
| 001 | 250 (N5 core) | TAMAM 19.07 ~01:50, 0 hata 0 uyarı | out/meaningtr-001.jsonl |

## İnsan kuyruğu

- 外 (6a5a2c6d4743caeb1e823932, N5): kana ほか ama meaningEn "outside" —
  kaynak veride okunuş/anlam uyuşmazlığı (外/そと=dışarı, 外/ほか=başka).
  meaningTr geçici olarak kana'ya göre "başka, diğeri" yazıldı; Yusuf karar
  versin: kana そと'ya mı çevrilir, anlam mı düzeltilir.
- kana alanında ayraç/çoklu okunuş kalıntısı (Faz 0 kapsamı dışıydı, ayrı
  temizlik adayı): 十 "(〜を) とお", 勉強・結婚・練習 "...(する)",
  何 "なん; なに", 行く "いく; ゆく" — TTS kana okuyacağı için mağaza öncesi
  temizlenmeli.

## Sıradaki iş

Hazırlık TAMAM (04/05/06 scriptleri yazıldı ve smoke-test edildi; şemaya
meaningTr eklendi). Döngü protokolü her turda:
1. `node content-pipeline/04-slice.js` → out/slice-current.json
2. Dilimi oku, meaningTr+type üret → hedef dosyaya yaz (önce .tmp, sonra asıl ad)
3. `node content-pipeline/05-validate-tr.js <dosya>` → hata varsa aynı turda düzelt
4. Bu tabloya satır ekle, lokal commit at, sıradaki tura geç (dilim 001'den başla)
