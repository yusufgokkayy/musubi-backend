# İçerik Boru Hattı Planı

Hedef: kelime içeriği kalitesi 45/100 → 80-85/100 (TR anlam, güvenilir tür,
örnek cümleler, temiz iskelet). Bu dosya çalışma planıdır — düzenleyin,
kararlar netleştikçe güncellenir.

## Durum özeti

| Faz | İş | Durum |
|-----|----|-------|
| 0 | Deterministik temizlik (bozuk/mükerrer/romaji) | ✅ dev'de tamam (19.07.2026) |
| 0.5 | Kotoba-analyzer entegrasyonu (ihraç + kapı) | ✅ doğrulandı |
| 1 | Tür düzeltme + meaningTr + gloss yeniden yazımı | 🔄 gece koşusuyla sürüyor (core 1520/3000, 19.07) |
| 2 | Örnek cümle üretimi (JA+TR) + doğrulama kapısı | ⏳ plan revize edildi (19.07), hazırlık yapılabilir |
| 3 | Şema/import/istemci + prod uygulaması | ⏳ kısmen bağımsız |

Yöntem notu (19.07): Batch API / LLM anahtarı beklemeye gerek kalmadı —
Faz 1, Claude Code gece koşusunda (/loop + STATE.md) dilim dilim in-session
üretiliyor. Faz 2 de aynı modeli kullanacak.

Scriptler: `00-audit.js` (salt okunur denetim), `01-fix-words.js` ve
`02-dedupe.js` (CSV+DB düzeltme, dry-run varsayılan), `03-export-vocab.js`
(kotoba-analyzer'a kelime ihracı). Hepsi idempotent.

## Faz 1 — Kelime alanları (LLM, batch)

Kapsam: önce 3000 core, sonra kalan 4900.

1. **Şema** (LLM'siz, hemen yapılabilir): `Word`'e `meaningTr` (kısa, quiz'de
   cevaplanabilir TR anlam) ve `exampleTr` (örnek cümlenin TR çevirisi; Faz
   2'de dolar) alanları. API yanıtlarına eklenmesi + EMIRHAN-NOTLARI'na kayıt.
2. **Batch üretim scripti**: kelime başına tek istek — girdi kanji/kana/
   meaning/jlptLevel; çıktı `{ type, meaningTr, meaningEnDuzeltilmis }`.
   Claude Batch API, JSONL girdi/çıktı, `content-pipeline/out/` altında
   versiyonlu dosyalar. DB'ye yazma ayrı adım (import scripti, dry-run'lı).
3. **Deterministik doğrulama**: tür enum kontrolü; meaningTr uzunluk sınırı
   (≤ ~40 karakter, parantezsiz); aynı seviye içinde meaningTr çakışması
   (quiz cevap uzayı) raporu; kaçak İngilizce tespiti.
4. **Örneklem insan denetimi**: seviye başına ~30 kelime elle bakılır,
   sorun oranına göre prompt revize edilip yalnız sorunlu dilim yeniden koşulur.

Karar bekleyen: LLM API anahtarı (Anthropic Console hesabı). Model önerisi:
üretimde Haiku sınıfı + Batch API (maliyet: 8k kelime için birkaç dolar);
örneklemde sorun çıkarsa yalnız sorunlu dilimler Sonnet'e yükseltilir.

## Faz 2 — Örnek cümleler (üret-doğrula döngüsü) — 19.07 revizyonu

Kapsam kararı: **önce 3000 core** (oyun havuzu); core bitince istenirse
kalan 4900'e genişletilir. Yöntem: Faz 1'deki gece koşusu modeli (dilim →
üretim → kapı → İNSAN-KUYRUĞU → sabah onaylı import). Dilim boyutu Faz 1'den
küçük (~100-150), çünkü kelime başına iş daha ağır (cümle + çeviri + kapı).

1. **Üretim**: kelime başına JA cümle + TR çeviri, çıktı
   `out/example-NNN.jsonl`: `{id, kanji, jlptLevel, example, exampleTr}`.
   Prompt kısıtları:
   - **Hibrit form kuralı** (fill-blank uyumu — quiz.service `example.includes
     (word.kanji)` birebir arıyor, çekimli formu bulamaz): isimler zaten
     çekimsiz; fiil/sıfatta sözlük formunun doğal durduğu kalıplar tercih
     edilir (〜のは…です, 〜ことができる, ilgi cümleciği vb.); doğal
     olmuyorsa çekim serbest — o kelime fill-blank'a girmez, yalnız detay
     kartında görünür. Kapı, sözlük-formu kapsam oranını raporlar.
   - Cümledeki hiçbir kelime hedef kelimenin JLPT seviyesini aşmaz.
   - 6-12 kelime bandı, günlük/nötr üslup, N5-N4'te kibar (です/ます) bitiş.
   - Aynı seviye içinde cümle tekrarı yok; kalıp çeşitliliği gözetilir.
   - Few-shot örnekleri kotoba'daki Tatoeba korpusundan (stil referansı,
     veri kaynağı değil).
2. **Kapı** (kotoba-analyzer, rule-only; kotoba tarafına ince bir batch
   wrapper scripti yazılır — JSONL girdi → kelime başına geçti/kaldı +
   gerekçe): tokenize → hedef kelime lemma eşleşmesi var mı; cümledeki
   kelimelerin maks seviyesi ≤ hedef seviye mi; havuz dışı içerik kelimesi
   var mı; uzunluk bandında mı; sözlük-formu (birebir kanji) geçiyor mu
   (bilgi amaçlı). Sözlük: `data/musubi_vocabulary.json` (03 ihracı).
   Bilinen artefakt: nadir yanlış-pozitif lemma eşleşmesi (として→年 gibi) —
   kapı kuralları buna dayanıklı, skor tek başına kullanılmaz.
   **Yan ürün — exampleKana**: cümle kanası LLM'le üretilMEZ; tokenizer
   okunuşlarından kapı sırasında türetilip JSONL'e yazılır (ileride cümle
   TTS'i gerekirse hazır; şemaya şimdilik girmez).
3. **Döngü**: kapıdan kalan cümle ret gerekçesiyle en fazla 2 tur yeniden
   üretilir; hâlâ geçemeyen insan kuyruğuna düşer (beklenti: %1-3).
4. **Pilot**: Faz 1'deki gibi ~20 kelimelik pilot dosyası kullanıcı onayına
   sunulur; onay sonrası kurallar donar.
5. **Import**: `08-import-ex.js` (06 benzeri, dry-run'lı) `example` +
   `exampleTr` upsert eder; boşluk doldurma sorusu ve detay kartı otomatik
   beslenir. Ön koşul: `Word`'e `exampleTr` alanı (LLM'siz, hemen eklenebilir).

Scriptler: `07-slice-ex.js` (04 mantığı; done-bilgisi example-*.jsonl'den),
kotoba tarafında `scripts/validate_musubi_sentences.py` (kapı), `08-import-ex.js`.

## Faz 3 — Yayın işleri

- **Prod uygulaması** (mağaza öncesi, sırası önemli): prod URI ile
  `01-fix-words --apply` → `02-dedupe` dry-run incele → `--apply`
  (prod'da UserWord/havuz referansları dolu olabilir; script taşıyor ama
  çıktı okunmalı) → `npm run seed:veri-seti`.
- **Emirhan/istemci**: "Dinle" = kana alanı + cihaz TTS (ja-JP; kanji değil,
  kana verilir; ～ istemcide temizlenir). Ses yalnız sesin cevabı
  sızdırmadığı soru tiplerinde çalıştırılır (reverse/fillblank/image'da
  kapalı). meaningTr/exampleTr alanlarının kartlara bağlanması.
  → Bu maddeler EMIRHAN-NOTLARI.md'ye işlenecek.
- **Puan hedefi denetimi**: Faz 1-2 bitince 00-audit genişletilir
  (meaningTr/example kapsam yüzdeleri) ve örneklemle 80-85 bandı teyit edilir.

## Bekleyen kararlar

- [x] ~~LLM API anahtarı~~ — gerek kalmadı, üretim gece koşusunda in-session
- [x] Faz 2 kapsamı: **önce 3000 core** (19.07)
- [x] Fill-blank/çekim: **hibrit form kuralı** (19.07, ayrıntı Faz 2 §1)
- [x] exampleKana: **LLM'le üretilmez, kapıda tokenizer'dan türetilir,
      yalnız JSONL'de saklanır** (19.07)
- [ ] meaningTr üretilirken mevcut İngilizce `meaning` korunsun mu, yoksa
      istemci tamamen TR'ye mi geçecek? (öneri: koru, API'de ikisi de dursun)
- [ ] Prod uygulama zamanı: hemen mi, mağaza sürümüyle birlikte mi?
