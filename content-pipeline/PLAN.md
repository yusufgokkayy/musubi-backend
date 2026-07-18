# İçerik Boru Hattı Planı

Hedef: kelime içeriği kalitesi 45/100 → 80-85/100 (TR anlam, güvenilir tür,
örnek cümleler, temiz iskelet). Bu dosya çalışma planıdır — düzenleyin,
kararlar netleştikçe güncellenir.

## Durum özeti

| Faz | İş | Durum |
|-----|----|-------|
| 0 | Deterministik temizlik (bozuk/mükerrer/romaji) | ✅ dev'de tamam (19.07.2026) |
| 0.5 | Kotoba-analyzer entegrasyonu (ihraç + kapı) | ✅ doğrulandı |
| 1 | Tür düzeltme + meaningTr + gloss yeniden yazımı | ⏳ LLM anahtarı bekliyor |
| 2 | Örnek cümle üretimi (JA+TR) + doğrulama kapısı | ⏳ Faz 1 sonrası |
| 3 | Şema/import/istemci + prod uygulaması | ⏳ kısmen anahtardan bağımsız |

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

## Faz 2 — Örnek cümleler (üret-doğrula döngüsü)

1. **Üretim**: kelime başına JA cümle + TR çeviri. Prompt kısıtları: hedef
   kelime geçecek (çekimli olabilir), kelimenin seviyesini aşan kelime yok,
   6-12 kelime bandı, günlük/nötr üslup. Few-shot örnekleri kotoba'daki
   Tatoeba korpusundan seçilir (veri kaynağı değil, stil referansı).
2. **Kapı** (kotoba-analyzer, rule-only): tokenize → hedef kelime lemma
   eşleşmesi var mı; eşleşen kelimelerin maks seviyesi ≤ hedef seviye mi;
   uzunluk bandında mı. Sözlük: `data/musubi_vocabulary.json` (03 ihracı).
   Bilinen artefakt: nadir yanlış-pozitif lemma eşleşmesi (として→年 gibi) —
   kapı kuralları buna dayanıklı, skor tek başına kullanılmaz.
3. **Döngü**: kapıdan kalan cümle ret gerekçesiyle en fazla 2 tur yeniden
   üretilir; hâlâ geçemeyen insan kuyruğuna düşer (beklenti: %1-3).
4. **Import**: `example` + `exampleTr` upsert; boşluk doldurma sorusu ve
   detay kartı otomatik beslenir.

## Faz 3 — Yayın işleri

- **Prod uygulaması** (mağaza öncesi, sırası önemli): prod URI ile
  `01-fix-words --apply` → `02-dedupe` dry-run incele → `--apply`
  (prod'da UserWord/havuz referansları dolu olabilir; script taşıyor ama
  çıktı okunmalı) → `npm run seed` → `npm run select-core`.
- **Emirhan/istemci**: "Dinle" = kana alanı + cihaz TTS (ja-JP; kanji değil,
  kana verilir; ～ istemcide temizlenir). Ses yalnız sesin cevabı
  sızdırmadığı soru tiplerinde çalıştırılır (reverse/fillblank/image'da
  kapalı). meaningTr/exampleTr alanlarının kartlara bağlanması.
  → Bu maddeler EMIRHAN-NOTLARI.md'ye işlenecek.
- **Puan hedefi denetimi**: Faz 1-2 bitince 00-audit genişletilir
  (meaningTr/example kapsam yüzdeleri) ve örneklemle 80-85 bandı teyit edilir.

## Bekleyen kararlar

- [ ] LLM API anahtarı (Faz 1-2'yi açar) — tek gerçek bloker
- [ ] meaningTr üretilirken mevcut İngilizce `meaning` korunsun mu, yoksa
      istemci tamamen TR'ye mi geçecek? (öneri: koru, API'de ikisi de dursun)
- [ ] Faz 2 kapsamı: yalnız 3000 core mu, tüm 7900 mü? (öneri: önce core)
- [ ] Prod uygulama zamanı: hemen mi, mağaza sürümüyle birlikte mi?
