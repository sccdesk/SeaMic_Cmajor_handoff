# SeaMic — oturum durumu ve çalıştırma kılavuzu (güncel: 29/09/2026)

## Yapılandırma (config)

- **Proje:** SeaMic — denetimsiz kazı mikrofonu. Sabit **16 kHz** mono kanal, **48 kHz'e upsample
  Opus'a gerek yok** (Opus wideband, karar sahibi tarafından onaylandı).
- **Kullanılabilir araçlar:**
  - Cmajor CLI: `Cmajor\tools\cmaj.exe` (VSCode Cmajor Tools paketinden kopyalandı, v1.0.3209)
  - VSCode Cmajor Tools eklentisi (derleme + patch yükleme)
  - .NET 8 SDK (`dotnet`) — yardımcı araçlar için
- **Donanım:** Windows 10 (x86), WASAPI; testte ZOOM F Series Multi Track Audio girişi doğrulandı.
  Kulaklık takılı (canlı test için hazır).

## Durum (özet)

| İş | Durum |
|----|-------|
| chain1–chain4 (filtre/VAD/AGC-gate-limiter/graf), chain6–chain13 probe'ları | ✅ derleniyor |
| VAD v2 (pencere-min floor, -40 dBFS boot cap, flatness exit, donmuş-pencere düzeltmesi) | ✅ düzeltildi + offline doğrulandı |
| Analyzer float32/EXTENSIBLE düzeltmesi (anwav2) | ✅ |
| Offline render doğrulaması (16 kHz, 7 s stimulus) | ✅ R1–R5 sağlandı (tablo: `SeaMic/VAD_DEBUG.md`) |
| Canlı MVP `SeaMicLive.cmajorpatch` WASAPI gerçek cihazda | ✅ çalışıyor (16 kHz, 256 block) |
| Akademik yıl-sonu raporu (PDF, 22 sayfa) | ✅ `report/SeaTime_DSP_Report.pdf` |

Kalan: kulaklıkla **kulağa dayalı test** (`SeaMic/MIC_TEST.md` protokolü), opus DTX entegrasyonu,
SeaTime C++ motoruna port.

## Faza 1 — Offline doğrulama (donanım gerekmez) — DOĞRULANDI

```powershell
cd C:\Users\engcouce\Documents\Cmajor\SeaMic
..\tools\cmaj.exe render SeaMic.cmajorpatch --rate=16000 --blockSize=128 --input=stimulus16k.wav --output=render_final.wav
.\anwav2\bin\Release\net8.0\anwav2.exe render_final.wav analysis_final.txt   # segment RMS/peak
..\tools\cmaj.exe render SeaMicVadProbe.cmajorpatch --rate=16000 --blockSize=128 --input=stimulus16k.wav --output=render_probe.wav  # VAD bayrağı = 440 Hz beep
```

Beklenen (doğrulanan): suskun segmentler susturulmuş, sessiz konuşma geçiyor, gürültü bastırılmış,
peak ≤ 0.936, 0 dBFS aşımı yok. seg0 render motoru warm-up'i nedeniyle simsiyahtır — yok say.

## Faza 2 — Canlı MVP (kulaklık takılıyken) — ÇALIŞIYOR

```powershell
cd C:\Users\engcouce\Documents\Cmajor
powershell -ExecutionPolicy Bypass -File .\SeaMic\run_live.ps1   # SeaMicLive — gerçek mikrofon
# Ya da VSCode: SeaMicLive.cmajorpatch açık → Ctrl+Shift+P → "Cmajor: Load Current Focused Patch"
# Ya da CLI:  .\tools\cmaj.exe play SeaMic\SeaMicLive.cmajorpatch
```

Ayar: 16000 Hz, WASAPI. Canlı zincir = DC-block → **VADv2** → AGC → soft-gate (açılışta kapalı,
+400 ms hold) → limiter. Test protokolü: `SeaMic/MIC_TEST.md`.
`SeaMic.cmajorpatch` (debug outs) cihazda açılış hatası verir — canlı için **SeaMicLive** kullan.

## Faza 3 — Rapor (PDF)

```powershell
powershell -ExecutionPolicy Bypass -File C:\Users\engcouce\Documents\Cmajor\report\run_pdf.ps1
```

`report/p01.html … p16.html` kaynakları → `SeaTime_DSP_Report.html` → **`SeaTime_DSP_Report.pdf`**
(22 sayfa, A4, SVG şekiller + tablo kaynak kodu dahil). Not: Edge headless bu makinede PDF üretmiyor;
script yüklenmiş Chrome + `puppeteer-core` (`report/topdf.js`) kullanıyor.

## Önemli dosyalar

- `report/SeaTime_DSP_Report.pdf` — akademik rapor: mimari, literatür, tasarım kararları (bölümler 2–5) ve hata günlüğü (bölüm 6)
- `SeaMic/BUGFIXES.md` — bu oturumda düzeltilen Cmajor sözdizimi hataları (M1)
- `SeaMic/VAD_DEBUG.md` — kök neden analizi + **FINAL STATUS** sayıları (raporun 6–7. bölümlerinin ham malzemesi)
- `SeaMic/MIC_TEST.md` — elle dinleme protokolü
- `report/` — akademik rapor (HTML parçaları + PDF + run_pdf.ps1 + topdf.js)
- `SeaMic/mkstim/`, `SeaMic/anwav2/`, `SeaMic/dumpwav/`, `SeaMic/vadprobe/` — stimulus üretici, ölçüm ve debug araçları (.NET 8)

## Geçici dosyalar (ister sil, depoya girmez)

- `render_*.wav`, `analysis_*.txt`, `mic_test_raw.wav`, `render_out.wav` — render/ölçüm çıktıları
- `tools/cmaj.exe` — VSCode eklentisinden kopyalanan CLI
- `report/node_modules/`, `report/package*.json` — puppeteer-core (PDF baskı için)
- `report/assemble.js`, `report/qa_shots.js` — HTML birleştirme (UTF-8) ve görsel kalite kontrolü
- `HANDOFF_PROMPT.md` — başka bir makinede devam etmek için yapıştırılmaya hazır istem (durum,
  invariantlar, tuzaklar, yapılacaklar). `powershell -File report\make_handoff_zip.ps1` ile
  e-postaya sığan ZIP paketi üretilir (`SeaMic_Cmajor_handoff.zip`, ~2 MB; cmaj.exe hariç)

## Kodlama (karakter) kuralı — PDF bozulmasını önler

HTML birleştirmesi **`report/assemble.js` (Node, katı UTF-8)** ile yapılır; PowerShell 5.1
`Get-Content` BOM'suz UTF-8 dosyalarını ANSI kod sayfasıyla okuyup yeniden kodladığı için
«—», «á», «→» gibi karakterler mojibake'e («â€”», «Ã¡») dönüşür. İlk PDF derlemesindeki
okunamaz karakterlerin kök nedeni buydu; 2026-09-29'da düzeltildi. `run_pdf.ps1` artık
basmadan önce assemble çıktısını doğrular (`mojibakeMarkers: []` olmalı) ve
`node report/qa_shots.js` başlık/sayfa görüntülerini üretip gliflerin doğru çizildiğini
görsel olarak kontrol etmeyi sağlar.

