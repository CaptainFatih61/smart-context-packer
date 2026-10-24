<div align="center">

[🇬🇧 English](../README.md) | 🇹🇷 Türkçe Dokümantasyon

# 📦 Smart Context Packer (`scp`)

**Büyük Dil Modelleri (LLM) için Yüksek Doğruluklu Bağlam Paketleyici ve Çok Dilli Bağımlılık Grafı Analizcisi**

*Yapay zeka asistanınızın gerçekten görmesi gereken kodu paketleyin — sıfır halüsinasyon, minimum token.*

[![CI](https://github.com/CaptainFatih61/smart-context-packer/actions/workflows/ci.yml/badge.svg)](https://github.com/CaptainFatih61/smart-context-packer/actions)
[![NPM Version](https://img.shields.io/npm/v/smart-context-packer.svg?color=blue)](https://www.npmjs.com/package/smart-context-packer)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![MCP: 15 Tools](https://img.shields.io/badge/MCP-15%20Tools%20JSON--RPC-brightgreen.svg)](https://modelcontextprotocol.io/)

</div>

---

## 📑 İçindekiler

1. [Projenin Amacı ve Çözdüğü Problem](#1-projenin-amacı-ve-çözdüğü-problem)
2. [Temel Tasarım İlkeleri (Core Philosophy)](#2-temel-tasarım-ilkeleri-core-philosophy)
3. [Rakiplerle Karşılaştırma (OSS Benchmark Matrix)](#3-rakiplerle-karşılaştırma-oss-benchmark-matrix)
4. [Sistem Mimarisi ve Modüller](#4-sistem-mimarisi-ve-modüller)
   - [4.1 16 Dilli Ultra-Polyglot Bağımlılık Grafı Motoru (`analyzer.ts`)](#41-16-dilli-ultra-polyglot-bağımlılık-grafı-motoru-analyzerts)
   - [4.2 12 Manifest Dosyası & Halüsinasyon Önleyici Versiyon Sabitleme (`dependencies.ts`)](#42-12-manifest-dosyası--halüsinasyon-önleyici-versiyon-sabitleme-dependenciest)
   - [4.3 Akıllı Skeletonizer & Middle-Out Slicing (`filter.ts`)](#43-akıllı-skeletonizer--middle-out-slicing-filterts)
   - [4.4 Token Bütçe Optimizatörü ve Bütçe HUD Göstergesi (`tokens.ts`, `hud.ts`)](#44-token-bütçe-optimizatörü-ve-bütçe-hud-göstergesi-tokensts-hudts)
   - [4.5 Blast-Radius & Test Etki Analizi (`blast-radius.ts`)](#45-blast-radius--test-etki-analizi-blast-radiusts)
   - [4.6 PageRank Mimari Kuşbakışı Haritası (`repo-map.ts`)](#46-pagerank-mimari-kuşbakışı-haritası-repo-mapts)
   - [4.7 Bellek İçi BM25 Niyet Arama Motoru (`query.ts`)](#47-bellek-içi-bm25-niyet-arama-motoru-queryts)
   - [4.8 Çökme Korumalı Aktif Görev Takibi (`task.ts`)](#48-çökme-korumalı-aktif-görev-takibi-taskts)
   - [4.9 SHA-256 Tabanlı İki Kademeli Hızlı AST Önbelleği (`cache.ts`)](#49-sha-256-tabanlı-iki-kademeli-hızlı-ast-önbelleği-cachets)
   - [4.10 Kalıcı ve Takım Dostu Proje Hafızası (`memory.ts`)](#410-kalıcı-ve-takım-dostu-proje-hafızası-memoryts)
   - [4.11 Kurumsal Gizli Bilgi & API Anahtarı Temizleyicisi (`redactor.ts`)](#411-kurumsal-gizli-bilgi--api-anahtarı-temizleyicisi-redactorts)
   - [4.12 Komut Çıktısı Kum Havuzu & Sıkıştırma (`sandbox.ts`)](#412-komut-çıktısı-kum-havuzu--sıkıştırma-sandboxts)
   - [4.13 Çevrimdışı İnteraktif HTML5 Canvas Görselleştirici (`visualizer.ts`)](#413-çevrimdışı-i̇nteraktif-html5-canvas-görselleştirici-visualizerts)
   - [4.14 12 Evrensel AI Kodlama Asistanı Ön-Ayarı (`agent-rules.ts`)](#414-12-evrensel-ai-kodlama-asistanı-ön-ayarı-agent-rulests)
   - [4.15 15 Araçlı Model Context Protocol (MCP) Sunucusu (`mcp.ts`)](#415-15-araçlı-model-context-protocol-mcp-sunucusu-mcpts)
   - [4.16 Git Çalışma Ağacı & Diff Entegrasyonu (`git.ts`)](#416-git-çalışma-ağacı--diff-entegrasyonu-gitts)
   - [4.17 Prisma Şema ve İlişki Ayıklayıcı (`prisma.ts`)](#417-prisma-şema-ve-i̇lişki-ayıklayıcı-prismats)
   - [4.18 VS Code & IDE Entegrasyonu (`ide.ts`)](#418-vs-code--ide-entegrasyonu-idets)
5. [CLI Komut Satırı Kullanım Kılavuzu](#5-cli-komut-satırı-kullanım-kılavuzu)
6. [15 MCP Aracının Kademeli Kullanım Kılavuzu (Progressive Disclosure)](#6-15-mcp-aracının-kademeli-kullanım-kılavuzu-progressive-disclosure)
7. [Dizin ve Dosya Yapısı](#7-dizin-ve-dosya-yapısı)
8. [Programatik TypeScript API Kullanımı](#8-programatik-typescript-api-kullanımı)
9. [Test ve Kalite Güvencesi](#9-test-ve-kalite-güvencesi)

---

## 1. Projenin Amacı ve Çözdüğü Problem

Modern yazılım geliştirmede Büyük Dil Modelleri (ChatGPT, Claude, Gemini, Cursor, Copilot, Windsurf vb.) kritik bir rol oynamaktadır. Ancak geliştiriciler ve AI kodlama ajanları kod yazarken iki büyük çıkmazla karşı karşıya kalır:

1. **"Tüm Depoyu Gönderme" Tuzağı (Full Repo Dump):**
   - Projenin tamamı (binlerce satır ve onlarca alakasız dosya) LLM context penceresine atılır.
   - **Sonuç:** 80.000–150.000+ token harcanır, API faturaları katlanır, model "dikkat kaybı" (lost in the middle) yaşar ve asıl çözülmesi gereken işi unutup alakasız dosyalardaki kodlarla kafası karışır.

2. **"İzole Dosya" Tuzağı (Isolated File):**
   - Token harcamamak için geliştirici yalnızca değiştirmek istediği tek bir dosyayı kopyalayıp modele verir.
   - **Sonuç:** Model, bu dosyanın import ettiği tipleri, yardımcı fonksiyonları, veritabanı modellerini ve servis sınırlarını göremez. Olmayan fonksiyonları uydurur (hallucination), geçersiz parametreler kullanır ve projeyi derlenemez hale getirir.

### Çözüm: `smart-context-packer` (`scp`)

`smart-context-packer`, hedeflediğiniz bir veya birden fazla başlangıç noktasından (entry file) başlayarak:
- Dosyaların **doğrudan ve dolaylı tüm yerel bağımlılıklarını** analiz eder,
- Alakasız dosyaları eler,
- Hassas API anahtarlarını, şifreleri ve JWT'leri anında maskeler,
- Harici paketlerin gerçek versiyonlarını manifestolardan çekip doğrular,
- Token bütçenizi aşmamak için derin bağımlılıkların gövdelerini otomatik olarak tip imzalarına (skeleton) dönüştürür,
- Modelin doğru sınırlar içinde kod yazmasını garanti eden bir **AI Pre-flight Directive** başlığı ekleyerek panoya kopyalar veya çıktı dosyasına kaydeder.

---

## 2. Temel Tasarım İlkeleri (Core Philosophy)

* **⚡ Sıfır Ağır Bağımlılık (Zero Bloat Policy):**
  Piyasadaki pek çok araç Python çalışma zamanı, C++ derleyicileri gerektiren yerel SQLite binary'leri, Docker konteynerleri veya ağır vektör veritabanları (ChromaDB vb.) dayatır. `scp`, **%100 saf TypeScript / Node.js** üzerinde çalışır. Hiçbir harici sistem kurulumu gerektirmez.
* **🎯 Cerrahi ve Kademeli Bağlam (Progressive Disclosure):**
  Bir ajanın aynı anda her şeyi bilmesine gerek yoktur. Önce 50 tokenlik bir sembol indeksi (Layer 1), ardından mimari graf (Layer 2), gerektiğinde tam kod ve diff (Layer 3), en son cerrahi sembol çekimi (Layer 4) yapılır.
* **🛡️ Güvenlik Öncelikli (Security by Default):**
  Kaynak kodlar LLM'lere aktarılırken asla AWS gizli anahtarı, GitHub tokenı, Stripe secret key'i veya veritabanı şifresi sızdırılmaz; tüm çıktılar varsayılan olarak sanitize edilir.
* **🌐 Gerçek Anlamda Çok Dilli (Ultra-Polyglot):**
  Sadece JavaScript/TypeScript değil; C#, Java, Kotlin, C/C++, PHP, Dart/Flutter, Swift, Ruby, Svelte, Python, Go, Rust, Vue 3, Lua ve Prisma tam desteklenir.

---

## 3. Rakiplerle Karşılaştırma (OSS Benchmark Matrix)

| Yetenek / Mimari Alan | `code-review-graph` | `claude-mem` | `mem0` | `context-mode` | **`smart-context-packer` v2.3** |
| :--- | :---: | :---: | :---: | :---: | :---: |
| **Dil Desteği (AST Analizi)** | Kısmi (2-3 dil) | Yok | Yok | Kısmi | **✅ 16 Dil (TS/JS/C#/Java/Kotlin/C++/PHP/Dart/Swift/Ruby/Svelte/Py/Go/Rust/Vue/Lua)** |
| **Paket & Manifest Doğrulama** | ❌ | ❌ | ❌ | ❌ | **✅ 12 Manifest Formatı (`.csproj`, `pom.xml`, `build.gradle`, `composer.json`, `pubspec.yaml`, `Package.swift`, `Gemfile`, `CMakeLists.txt`, `package.json`, `go.mod`, `Cargo.toml`, `requirements.txt`)** |
| **Yapay Zeka Ajan Ön-Ayarları** | ❌ | ❌ | ❌ | ❌ | **✅ 12 Asistan (`all`, `cursor`, `claude`, `copilot`, `windsurf`, `agent`, `opencode`, `codex`, `continue`, `zed`, `clinerules`, `aider`, `jetbrains`)** |
| **MCP Araç Paketi** | ❌ | Kısmi (6 araç) | ❌ | ❌ | **✅ 15 Yerel Araç (4 Kademeli Mimari: Index, Topology, Slicing, Surgical Layer 4)** |
| **Cerrahi Sembol Çekimi (<200t)** | ❌ | ❌ | ❌ | ❌ | **✅ (`extract_symbol_definition`)** |
| **Etkilenen Birim Test Tespiti** | Kısmi | ❌ | ❌ | ❌ | **✅ (`get_impacted_tests`, otomatik ters graf analizi)** |
| **Sızıntı Denetimi (Audit Leak)** | ❌ | ❌ | ❌ | ❌ | **✅ (`audit_context_leak`)** |
| **Aktif Görev & Plan Takibi** | ❌ | ❌ | ❌ | ❌ | **✅ (`-t, --task`, `.scp/tasks.json` çökme korumalı)** |
| **Komut Çıktı Sıkıştırma (Sandbox)** | ❌ | ❌ | ❌ | Kısmi | **✅ (%80-95 token tasarrufu, hata kök nedenini korur)** |
| **PageRank Mimari Repo Haritası**| ❌ | ❌ | ❌ | ❌ | **✅ (Centrality scored ~500-1024 tokenlık kuşbakışı harita)** |
| **BM25 Niyet Bazlı Akıllı Arama** | ❌ | ❌ | ❌ | ❌ | **✅ (camelCase ayrıştırma ve sembol ağırlıklandırmasıyla `-i`)** |
| **İnteraktif Görselleştirici** | ❌ | ❌ | ❌ | ❌ | **✅ (Sıfır bağımlılıklı çevrimdışı HTML5 Canvas kuvvet simülasyonu)** |
| **Gizli Bilgi & Şifre Maskeleme** | ❌ | ❌ | ❌ | ❌ | **✅ (AWS, GitHub, Stripe, OpenAI, JWT, DB URL'leri)** |
| **Çalışma Zamanı & Kurulum Yükü** | Ağır Python / ChromaDB | Bun / SQLite | Vektör DB / Python | Node | **⚡ Saf Node.js / TS (Sıfır Ekstra Derleyici / Veritabanı)** |

---

## 4. Sistem Mimarisi ve Modüller

### 4.1 16 Dilli Ultra-Polyglot Bağımlılık Grafı Motoru (`analyzer.ts`)
Projenin omurgası olan `analyzer.ts`, verilen hedef dosyalardan başlayarak yönlü bir bağımlılık grafı (DAG) inşa eder. Her dosyanın import ve require ifadelerini çözer ve yerel diskteki karşılıklarını bulur.

* **TypeScript / JavaScript:** Statik `import`, dinamik `import()`, `export ... from`, `require()`, `tsconfig.json` path alias'ları (`@/*`, `~/*`).
* **C# / .NET (`.cs`):** `using Foo.Bar;` bildirimlerini ayrıştırır, proje ad alanları ve dosya hiyerarşisiyle eşleştirir.
* **Java (`.java`):** `import com.example.service.*;` ve paket yapılarını çözer.
* **Kotlin (`.kt`, `.kts`):** Paket bildirimleri ve Kotlin import sözdizimini çözer.
* **C / C++ (`.c`, `.h`, `.cpp`, `.hpp`, `.cc`, `.cxx`):** Hem `#include "header.h"` (yerel) hem `#include <lib.h>` (sistem/harici) eşleştirmelerini yapar.
* **PHP (`.php`):** `use App\Services\Auth;`, `require_once` ve namespace eşlemelerini yapar.
* **Dart / Flutter (`.dart`):** `import 'package:flutter/...';` ve yerel bağıl importları takip eder.
* **Swift (`.swift`):** `import Foundation`, `import UIKit` ve modül bağımlılıklarını çözer.
* **Ruby (`.rb`):** `require` ve `require_relative` bağlantılarını analiz eder.
* **Svelte (`.svelte`):** `<script>` ve `<script context="module">` bloklarındaki TypeScript/JS bağımlılıklarını izole eder.
* **Python (`.py`):** `import foo`, `from .module import bar` ve `__init__.py` paketlerini çözer.
* **Go (`.go`):** Tekli ve çok satırlı `import (...)` bloklarını `go.mod` modül kökü ile haritalar.
* **Rust (`.rs`):** `mod parser;`, `use crate::...` ve `mod.rs` hiyerarşisini çözer.
* **Vue 3 SFCs (`.vue`):** `<script>` ve `<script setup>` mantık bloklarını ayrıştırır.
* **Lua / FiveM (`.lua`):** `fxmanifest.lua` tablolarını (`shared_scripts`, `client_scripts`, `server_scripts`) ve dot-notation `require('client.utils')` sözdizimini çözer.
* **Prisma (`.prisma`):** Model ve enum ilişkilerini analiz eder.

### 4.2 12 Manifest Dosyası & Halüsinasyon Önleyici Versiyon Sabitleme (`dependencies.ts`)
AI modelleri sıklıkla eski veya henüz çıkmamış kütüphane API'larını halüsinasyon olarak üretir. `DependencyManifestResolver`, kaynak kodlarda import edilen üçüncü parti paketleri projenin manifest dosyasıyla eşleştirir ve promptun en tepesine versiyonları sabitlenmiş bir özet ekler:

* `package.json` (Node / Web)
* `go.mod` (Go)
* `Cargo.toml` (Rust)
* `requirements.txt` (Python)
* `*.csproj` (C# / .NET)
* `pom.xml` (Java Maven)
* `build.gradle` & `build.gradle.kts` (Java / Kotlin Gradle)
* `composer.json` (PHP)
* `pubspec.yaml` (Dart / Flutter)
* `Package.swift` (Swift SPM)
* `Gemfile` (Ruby)
* `CMakeLists.txt` (C/C++)

### 4.3 Akıllı Skeletonizer & Middle-Out Slicing (`filter.ts`)
* **Skeletonizer (`--skeleton`):**
  Bir bağımlılık dosyasının içeriğindeki fonksiyon, metod ve sınıf gövdelerini atıp sadece tip imzalarını (signatures) bırakır:
  ```typescript
  // Orijinal dosya: 200 satırlık karmaşık algoritma
  export function processTransaction(order: Order): TransactionReceipt {
    // 198 satır işlem mantığı...
  }

  // Skeleton Mode:
  export function processTransaction(order: Order): TransactionReceipt { /* [Implementation omitted for token efficiency] */ }
  ```
  AI model, fonksiyonun girdi/çıktı tipini ve adını tam olarak görür ancak gövdeye token harcanmaz (%85 tasarruf).
* **Middle-Out Slicing:**
  500 satırdan uzun devasa dosyalarda, en üstteki kritik import/konfigürasyon satırları ile en alttaki export/dönüş satırları korunur; orta kısımdaki tekrarlayan satırlar güvenli atlama belirteçleriyle (`/* ... [Middle omitted: X lines] ... */`) budanır.

### 4.4 Token Bütçe Optimizatörü ve Bütçe HUD Göstergesi (`tokens.ts`, `hud.ts`)
* **Otomatik Token Bütçeleme (`--max-tokens <sayı>`):**
  Kullanıcı örneğin `-m 4000` dediğinde:
  1. `scp` toplam token sayısını hesaplar.
  2. Hedef dosyayı (derinlik 0) asla budamaz (geliştiricinin düzenlediği dosyanın tam kalması şarttır).
  3. En derin bağımlılıklardan (derinlik 3, ardından 2, ardından 1) başlayarak en çok yer kaplayan dosyaları sırayla skeleton moduna geçirir.
  4. Toplam token bütçenin altına indiği anda işlemi durdurur.
* **Terminal HUD Göstergesi:**
  Context penceresinin doluluk oranını (128k, 200k, 1M modeller) ve tokenların kategorik dağılımını (Hedefler, Bağımlılıklar, Git Diff, Bellek, Görev Yönergesi) şık ASCII barlarıyla gösterir.

### 4.5 Blast-Radius & Test Etki Analizi (`blast-radius.ts`)
Bir dosyayı değiştirirken projenin nerelerinin kırılabileceğini hesaplar:
* **Ters Graf (Reverse Fan-in):** Hedef dosyayı import eden tüm diğer dosyaları tarar.
* **Birim Test Eşleme:** Değişen modülü test eden `*.test.ts`, `*.spec.ts`, `tests/**` dosyalarını bulur.
* **0-10 Risk Skoru:**
  * `LOW (0.0 - 3.5):` İzole edilmiş değişiklikler veya kapsamlı test koruması olan alanlar.
  * `MEDIUM (3.6 - 6.9):` 1-3 çağırıcısı olan veya testi eksik modüller.
  * `HIGH (7.0 - 10.0):` Çekirdek paylaşılan kütüphaneler (4+ çağırıcı) veya hiç testi olmayan kritik servisler.

### 4.6 PageRank Mimari Kuşbakışı Haritası (`repo-map.ts`)
Büyük projelerde LLM'lerin "tünel vizyonu" (sadece baktığı dosyayı görüp mimariyi kaçırması) sorununu çözer. Tüm bağımlılık grafı üzerinde PageRank Centrality (damping 0.85) çalıştırır ve projenin en merkezi mimari merkezlerinden (hubs) dışa aktarılan sembolleri ~500-1024 tokenlık kompakt bir kuşbakışı özete dönüştürür.

### 4.7 Bellek İçi BM25 Niyet Arama Motoru (`query.ts`)
Kullanıcı dosya yolunu tam hatırlamadığında (`-i "stripe payment webhook"`), semantik niyet aramasını çalıştırır:
* Tanımlayıcıları parçalar (`handleStripeWebhook` -> `handle`, `stripe`, `webhook`).
* Dışa aktarılan fonksiyon/sınıf adlarına 2.5 kat ağırlık verir.
* 10 milisaniyenin altında en alakalı başlangıç dosyalarını otomatik tespit edip bağlama ekler.

### 4.8 Çökme Korumalı Aktif Görev Takibi (`task.ts`)
AI asistanların uzun soluklu işlerde hedeften sapmasını engeller:
* Görev adımları `.scp/tasks.json` dosyasında saklanır (IDE kapansa veya model çökse bile plan kaybolmaz).
* Modelin promptuna tamamlanan ve bekleyen adımları içeren bir kontrol listesi (checklist) enjekte edilir.

### 4.9 SHA-256 Tabanlı İki Kademeli Hızlı AST Önbelleği (`cache.ts`)
* **1. Kademe:** Dosya boyutu ve `mtimeMs` kontrolü (mikrosaniye düzeyinde).
* **2. Kademe:** Değişiklik varsa `crypto.createHash('sha256')` kontrolü.
* Ayrıştırılan importlar ve dışa aktarılan semboller `.scp/cache.json` dosyasında saklanır. Büyük projelerde sonraki çalıştırmalar milisaniyeler sürer.

### 4.10 Kalıcı ve Takım Dostu Proje Hafızası (`memory.ts`)
Modellerin her oturumda aynı hataları yapmasını önlemek için takım kararlarını ve mimari kuralları dosya desenlerine bağlar (`.scp/memory.json`):
* Örnek: `scp --add-memory "src/auth/**:JWT son kullanma tarihini daima UTC sunucu zamanıyla doğrula"`
* Bu desenle eşleşen bir dosya paketlendiğinde, bu hafıza notu otomatik olarak AI direktifine eklenir.

### 4.11 Kurumsal Gizli Bilgi & API Anahtarı Temizleyicisi (`redactor.ts`)
8'den fazla kategorideki hassas bilgiyi kaynak kod dışarı çıkmadan önce otomatik maskeler:
* OpenAI / Anthropic / Cohere / HuggingFace API anahtarları (`sk-...`, `sk-ant-...`)
* GitHub Personal Access Token'ları (`ghp_...`, `github_pat_...`)
* AWS Access Key ID & Secret Access Key (`AKIA...`)
* Stripe Secret Key'leri (`sk_live_...`, `sk_test_...`)
* PEM Private Key blokları (`-----BEGIN PRIVATE KEY-----`)
* Veritabanı bağlantı URI'lerindeki şifreler (`postgres://user:pass@host/db` -> `postgres://user:[REDACTED]@host/db`)
* Slack / Discord bot tokenları ve RFC 7519 JWT tokenları

### 4.12 Komut Çıktısı Kum Havuzu & Sıkıştırma (`sandbox.ts`)
Test çalıştırıcılarının (Vitest, Jest), derleyicilerin veya linter'ların devasa terminal çıktılarını (`scp --sandbox "npm test"`) %80-95 oranında sıkıştırır. Başarılı geçen yüzlerce satırı eler; yalnızca başarısız olan testleri, assertion hatalarını, yığın izlerini (stack trace) ve hata veren dosya yollarını korur.

### 4.13 Çevrimdışı İnteraktif HTML5 Canvas Görselleştirici (`visualizer.ts`)
`scp src/index.ts --visualize` komutuyla oluşturulan `.scp/visualizer.html`:
* Tek bir dosya içerisine gömülü CSS, JS ve veri barındırır.
* Harici CDN veya internet bağlantısı gerektirmez.
* Düğümlerin boyutu token büyüklüğünü, renkleri ise risk seviyesini (Yeşil: Düşük, Turuncu: Orta, Kırmızı: Yüksek) temsil eder.
* Fizik tabanlı kuvvet yönlendirmeli (force-directed) canlı etkileşim, sürükleme, yakınlaştırma ve tıklanan dosyanın kaynak kodunu gösteren yan panel sunar.

### 4.14 12 Evrensel AI Kodlama Asistanı Ön-Ayarı (`agent-rules.ts`)
`scp --init-agent` komutu, sektördeki tüm popüler AI asistanlarının proje kökünde `smart-context-packer` MCP araçlarını kullanmasını sağlayan yönergeleri otomatik oluşturur:
1. `all`: Tüm asistan konfigürasyonlarını üretir.
2. `cursor`: `.cursorrules` ve `.cursor/rules/smart-context-packer.mdc`
3. `claude`: `CLAUDE.md` ve `.claude/config.json`
4. `copilot`: `.github/copilot-instructions.md`
5. `windsurf`: `.windsurfrules`
6. `agent`: `.agent/rules/smart-context-packer.md` ve `AGENTS.md` (Antigravity IDE)
7. `opencode`: `.opencode/instructions.md`
8. `codex`: `CODEX.md` ve `CONVENTIONS.md`
9. `continue`: `.continue/config.json`
10. `zed`: `.zed/settings.json`
11. `clinerules`: `.clinerules` ve `.roomodes`
12. `aider`: `.aider.conf.yml`
13. `jetbrains`: `.idea/ai/instructions.md`

### 4.15 15 Araçlı Model Context Protocol (MCP) Sunucusu (`mcp.ts`)
`scp --mcp` komutuyla başlatılan yerel JSON-RPC 2.0 sunucusu, AI modellerinin proje üzerinde 4 kademeli bağlam stratejisiyle çalışmasını sağlar. Herhangi bir yerel kuruluma gerek kalmadan, doğrudan NPM üzerinden sıfır kurulumla (zero-install) tüm yapay zeka istemcilerine eklenebilir:

#### Sıfır Kurulum MCP İstemci Yapılandırması (Claude Desktop, Cursor, Antigravity, Windsurf, Cline, OpenCode):
```json
{
  "mcpServers": {
    "smart-context-packer": {
      "command": "npx",
      "args": ["-y", "smart-context-packer", "--mcp"]
    }
  }
}
```

### 4.16 Git Çalışma Ağacı & Diff Entegrasyonu (`git.ts`)
`--diff` veya `--staged` bayrakları:
* Değiştirilmiş veya henüz commit edilmemiş dosyaları otomatik olarak hedef dosya olarak seçer.
* Bu dosyaların bağımlılıklarını çözer.
* Çıktının sonuna temiz bir unified `diff` yaması iliştirir (özellikle PR incelemeleri ve hızlı hata düzeltmeleri için idealdir).

### 4.17 Prisma Şema ve İlişki Ayıklayıcı (`prisma.ts`)
Eğer kod içinde Prisma veritabanı sorguları (`prisma.user.findMany`) varsa, 2.000 satırlık dev `schema.prisma` dosyasını tamamen yapıştırmak yerine, **sadece kodda kullanılan modelleri ve onların 1. derece ilişkili modellerini** çekerek prompta ekler.

### 4.18 VS Code & IDE Entegrasyonu (`ide.ts`)
`scp --init-vscode` komutu, `.vscode/tasks.json` dosyasını otomatik güncelleyerek Command Palette (`Ctrl+Shift+P` / `Cmd+Shift+P`) üzerinden 3 hazır görevi kullanılabilir hale getirir:
1. Aktif dosyayı bağımlılıklarıyla kopyala
2. Aktif dosyayı Skeleton imzalarıyla kopyala
3. Git diff değişikliklerini bağımlılıklarıyla kopyala

---

## 5. CLI Komut Satırı Kullanım Kılavuzu

### Genel Sözdizimi
```bash
scp [seçenekler] [hedef_dosyalar...]
```

### Parametre Referans Tablosu

| Bayrak | Kısa | Açıklama | Varsayılan |
|:---|:---:|:---|:---:|
| `--task <metin>` | `-t` | Aktif görevi başlatır, BM25 ile başlangıç dosyalarını bulur ve plan kontrol listesi ekler | |
| `--task-list` | | Kayıtlı görevleri listeler (`.scp/tasks.json`) | `false` |
| `--task-done <id>` | | Görevi veya alt adımı tamamlandı olarak işaretler | |
| `--sandbox <komut>` | | Shell komutunu çalıştırır ve çıktıyı %80-95 sıkıştırarak özetler | |
| `--query <niyet>` | `-i` | BM25 semantik niyet aramasıyla ilgili dosyaları otomatik bulur | |
| `--repo-map [token]` | | PageRank mimari kuşbakışı haritası üretir (bütçe varsayılanı: 1024 token) | `false` |
| `--visualize [yol]` | | İnteraktif çevrimdışı HTML canvas görselleştirici raporu üretir | `false` |
| `--diff` | | Commit edilmemiş git değişikliklerini hedefler ve diff yamasını ekler | `false` |
| `--staged` | | Yalnızca stage edilmiş git dosyalarını hedefler ve diff yamasını ekler | `false` |
| `--blast-radius` | `-b` | Ters bağımlılıkları (çağırıcıları) ve birim testleri bulup 0-10 Risk Skoru üretir | `false` |
| `--max-tokens <sayı>`| `-m` | Bütçeye sığmak için derin bağımlılıkları otomatik skeleton yapar | |
| `--skeleton` | `-s` | Bağımlılıkların fonksiyon gövdelerini atıp sadece tip imzalarını bırakır | `false` |
| `--depth <sayı>` | `-d` | Bağımlılık arama derinliği (`0` = sadece hedef, `1` = doğrudan, `2` = dolaylı) | `2` |
| `--reverse` | `-r` | Hedef dosyayı import eden projede bulunan dosyaları da bağlama dahil eder | `false` |
| `--copy` | `-c` | Üretilen çıktıyı doğrudan işletim sistemi panosuna kopyalar | `false` |
| `--output <dosya>` | `-o` | Çıktı dosyasının kaydedileceği yol | `.context-pack.md` |
| `--format <md\|xml>` | `-f` | Çıktı formatı: Markdown (`md`) veya yapılandırılmış XML (`xml`) | `md` |
| `--stdout` | | Çıktıyı doğrudan konsola yazdırır (diğer araçlara pipe etmek için) | `false` |
| `--tree-only` | | Dosya gövdelerini hariç tutup sadece hiyerarşi ağacını basar | `false` |
| `--no-cache` | | SHA-256 AST disk önbelleğini devre dışı bırakır | `false` |
| `--clear-cache` | | Yerel `.scp/cache.json` önbelleğini tamamen temizler | `false` |
| `--add-memory <not>` | | Belirli bir dosya desenine kalıcı takım hafıza notu ekler | |
| `--list-memory` | | Kayıtlı proje hafıza notlarını listeler | `false` |
| `--init-agent [ayar]`| | 12 AI asistan kural dosyasını üretir (`all`, `cursor`, `claude`, `copilot`, `windsurf`, vb.) | `all` |
| `--init-vscode` | | `.vscode/tasks.json` dosyasına Command Palette görevlerini yazar | `false` |
| `--mcp` | | 15 araçlı Model Context Protocol (MCP) stdio sunucusunu başlatır | `false` |
| `--no-deps` | | Harici paket manifest özetini çıktıdan kaldırır | `false` |
| `--no-redact` | | Otomatik şifre ve anahtar temizleme mekanizmasını kapatır | `false` |
| `--quiet` | `-q` | Terminal bilgi tablolarını ve özetleri gizler | `false` |
| `--version` | `-v` | Yüklü sürümü görüntüler (`2.3.0`) | |

### Gerçek Hayat Kullanım Örnekleri

```bash
# 1. Günlük Geliştirme: Bir controller dosyasını analiz et, panoya kopyala ve ChatGPT/Claude'a yapıştır:
scp src/controllers/auth.ts -c

# 2. Maksimum Token Tasarrufu: 3 derinlikte bağımlılıkları çek ama gövdeleri kırp (Skeleton):
scp src/main.ts -d 3 -s -c

# 3. Kesin Bütçe Yönetimi: Toplam bağlam 3500 tokenı geçmesin:
scp src/server.ts -m 3500 -c

# 4. PR Öncesi İnceleme: Commit edilmemiş değişiklikler + bağımlılıkları + diff yaması:
scp --diff -b -c

# 5. Ne Yapacağını Bilmediğinde Semantik Arama:
scp -i "veritabanı kullanıcı şifresi sıfırlama akışı" -c

# 6. Büyük Refactoring: Etki haritasını ve risk skorunu çıkararak görselleştir:
scp src/services/payment.ts -b --visualize

# 7. Test Hatalarını Sıkıştırarak Modele Sun:
scp --sandbox "npm test" -c
```

---

## 6. 15 MCP Aracının Kademeli Kullanım Kılavuzu (Progressive Disclosure)

`smart-context-packer` Model Context Protocol (MCP) stdio sunucusu, yapay zeka ajanlarının token harcamasını minimize eden **4 Aşamalı Kademeli Açığa Çıkarma (Progressive Disclosure)** mimarisine sahiptir:

```text
┌────────────────────────────────────────────────────────────────────────┐
│  Katman 1: Keşif & Kuşbakışı (Discovery & Index)                       │
│  search_codebase_index (~50t) | search_codebase_intent | repo-map      │
└───────────────────────────────────┬────────────────────────────────────┘
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│  Katman 2: Topoloji & Mimari (Topology & Architecture)                 │
│  inspect_dependency_graph | generate_visualizer | framework_manifest   │
└───────────────────────────────────┬────────────────────────────────────┘
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│  Katman 3: Dilimleme & Paketleme (Slicing & Context Packing)          │
│  pack_context | pack_git_diff                                          │
└───────────────────────────────────┬────────────────────────────────────┘
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│  Katman 4: Cerrahi Müdahale & Güvenlik (Surgical Fetch & Auditing)     │
│  extract_symbol_definition | get_impacted_tests | audit_context_leak   │
└────────────────────────────────────────────────────────────────────────┘
```

| Katman | Araç Adı | Parametreler | Ne İşe Yarar? |
|:---|:---|:---|:---|
| **Layer 1** | `search_codebase_index` | `query?`, `limit?`, `cwd?` | Dosyaları açmadan dosya adları, boyutları ve dışa aktarılan sembolleri ~50 tokenlık kompakt listede döner. |
| **Layer 1** | `search_codebase_intent`| `query`, `topK?`, `cwd?` | Doğal dille aranan özelliğe uygun dosyaları BM25 algoritmasıyla bulur. |
| **Layer 1** | `generate_repo_map` | `tokenBudget?`, `cwd?` | PageRank skoruna göre projenin en kilit mimari merkezlerini içeren kuşbakışı özet sunar. |
| **Layer 2** | `inspect_dependency_graph` | `targets`, `reverse?`, `blastRadius?` | Kod gövdelerini yüklemeden import/export ilişkilerini, ASCII ağacını ve risk skorunu verir. |
| **Layer 2** | `generate_visualizer` | `targets`, `outputPath?`, `cwd?` | Etkileşimli HTML force-graph görselleştirici dosyasını üretir. |
| **Layer 2** | `get_framework_manifest`| `cwd?` | Projede kullanılan paketlerin gerçek versiyonlarını döner (12 manifest formatı). |
| **Layer 3** | `pack_context` | `targets`, `depth?`, `skeleton?`, `maxTokens?`, `blastRadius?`, `format?` | Hedef dosyaları, bağımlılıkları, aktif görevleri ve manifestoları birleştirip tam bağlam paketi oluşturur. |
| **Layer 3** | `pack_git_diff` | `stagedOnly?`, `depth?`, `skeleton?`, `maxTokens?`, `format?` | Commit edilmemiş veya stage edilmiş değişiklikleri çevreleyen bağımlılıklarla paketler. |
| **Layer 4** | `extract_symbol_definition` | `filePath`, `symbolName`, `cwd?` | **Cerrahi Araç:** Tüm dosyayı çekmeden sadece istenen fonksiyon, sınıf veya struct tanımını <200 token ile çeker. |
| **Layer 4** | `get_impacted_tests` | `targets`, `cwd?` | **Test Radarı:** Değiştirilen dosyalardan etkilenen birim test dosyalarını ters graf analiziyle anında listeler. |
| **Layer 4** | `audit_context_leak` | `contextText?`, `filePath?`, `cwd?` | **Güvenlik Denetimi:** Gönderilecek metinde şifre, API key veya JWT sızıntısı olup olmadığını denetler. |
| **Ops** | `manage_task_context` | `action`, `taskName?`, `items?`, `itemIndex?` | Çökme korumalı görev planını ve kontrol listesini yönetir (`.scp/tasks.json`). |
| **Ops** | `sandbox_tool_output` | `rawOutput`, `maxLines?` | Test ve derleyici loglarını %80-95 oranında sıkıştırır. |
| **Bellek**| `save_project_memory` | `pattern`, `content`, `category?` | Dosya desenine bağlı kalıcı kural veya gotcha kaydeder (`.scp/memory.json`). |
| **Bellek**| `query_project_memory`| `query?`, `category?` | Kayıtlı takım ve proje hafızasını sorgular. |

---

## 7. Dizin ve Dosya Yapısı

```text
smart-context-packer/
├── .github/
│   └── workflows/
│       └── ci.yml                 # Node 20 & 22 üzerinde koşan GitHub Actions CI iş akışı
├── .scp/                          # Çalışma zamanı yerel verileri (gitignore'a ekli)
│   ├── cache.json                 # İki kademeli SHA-256 AST disk önbelleği
│   ├── memory.json                # Takım dostu kalıcı proje hafızası (isteğe bağlı commit edilir)
│   ├── tasks.json                 # Çökme korumalı aktif görev planları
│   └── visualizer.html            # Çevrimdışı interaktif görselleştirici çıktısı
├── docs/
│   └── README.tr.md               # [BU DOSYA] Kapsamlı Türkçe teknik rehber
├── src/
│   ├── index.ts                   # Ana giriş kapısı ve kütüphane orkestrasyonu
│   ├── cli.ts                     # Commander tabanlı terminal CLI arayüzü
│   ├── mcp.ts                     # 15 araçlı JSON-RPC 2.0 stdio MCP sunucusu
│   ├── types.ts                   # TypeScript tip tanımlamaları ve arayüzler
│   ├── analyzer.ts                # 16 dilli bağımlılık grafı ve import ayrıştırıcısı
│   ├── dependencies.ts            # 12 manifest dosyasından versiyon çözücü
│   ├── filter.ts                  # Skeletonizer (gövde budama) ve Middle-Out Slicing
│   ├── tokens.ts                  # BPE token sayacı ve context kullanım hesaplayıcı
│   ├── hud.ts                     # ASCII bütçe göstergesi ve terminal HUD
│   ├── blast-radius.ts            # Ters graf çağırıcı analizi ve risk skoru
│   ├── repo-map.ts                # PageRank centrality mimari harita motoru
│   ├── query.ts                   # Bellek içi BM25 niyet arama motoru
│   ├── task.ts                    # Aktif plan ve checklist yöneticisi
│   ├── cache.ts                   # SHA-256 AST önbellek yöneticisi
│   ├── memory.ts                  # Proje hafıza notları yöneticisi
│   ├── redactor.ts                # Gizli bilgi ve token maskeleme motoru
│   ├── sandbox.ts                 # Test ve log çıktılarını sıkıştırma motoru
│   ├── visualizer.ts              # HTML5 Canvas görselleştirici şablon üreticisi
│   ├── agent-rules.ts             # 12 AI asistanı için kural üreticisi
│   ├── git.ts                     # Git diff ve çalışma ağacı analizcisi
│   ├── prisma.ts                  # Prisma şema ve model ayıklayıcısı
│   └── ide.ts                     # VS Code tasks.json üreticisi
├── tests/                         # 26 test süiti, 119 birim & entegrasyon testi
├── package.json                   # Paket konfigürasyonu, scriptler ve anahtar kelimeler
├── smithery.yaml                  # Smithery.ai MCP Registry konfigürasyonu
├── glama.json                     # Glama.ai MCP Registry şema manifestosu
├── tsconfig.json                  # Strict NodeNext TypeScript ayarları
├── tsup.config.ts                 # Çift format (ESM/CJS) ve DTS derleyici konfigürasyonu
└── README.md                      # İngilizce genel tanıtım ve dokümantasyon
```

---

## 8. Programatik TypeScript API Kullanımı

```typescript
import { 
  packContext, 
  analyzeDependencies, 
  formatContext,
  AstCache,
  ProjectMemoryManager,
  DependencyManifestResolver 
} from 'smart-context-packer';

// 1. Tek Seferde Bağlam Paketleme:
const result = await packContext({
  targets: ['src/services/auth.ts'],
  depth: 2,                  // 2 derinlikte bağımlılıkları topla
  skeleton: true,            // Bağımlılıkları tip imzasına indirge
  maxTokens: 4000,           // 4000 token sınırına sığdır
  blastRadius: true,         // Etki analizi ve testleri dahil et
  diff: true,                // Commit edilmemiş diff varsa ekle
  format: 'md',              // Markdown formatında üret
  copy: false,
  output: '.context-pack.md'
});

console.log(`Paketlenen dosya sayısı: ${result.graph.nodes.size}`);
console.log(`Tahmini toplam token: ${result.stats.totalTokens}`);

// 2. Alt Seviye Bağımlılık Grafı Analizi:
const graph = await analyzeDependencies(['src/index.ts'], {
  cwd: process.cwd(),
  maxDepth: 3,
  reverse: true,             // Ters çağırıcıları da getir
});

for (const [filePath, node] of graph.nodes) {
  console.log(`${filePath} (Derinlik: ${node.depth})`);
  console.log(`  Import ettikleri:`, node.imports);
}
```

---

## 9. Test ve Kalite Güvencesi

Proje, kurumsal düzeyde kararlılık için **Vitest** ile kapsamlı şekilde test edilmiştir.

* **Toplam Test Süiti:** 26 test dosyası
* **Toplam Birim / Entegrasyon Testi:** 119 test
* **Başarı Oranı:** %100 Yeşil (0 hata, 0 uyarı)
* **Sürekli Entegrasyon (CI):**
  * GitHub Actions üzerinde hem **Node.js 20** hem de **Node.js 22** sürümlerinde Ubuntu ortamında her commit ve tag için otomatik çalıştırılır.

---

<div align="center">
  <b>Smart Context Packer</b> • Geliştiriciler ve Yapay Zeka Ajanları için En Yüksek Standart.
</div>
