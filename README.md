# Wa Status Forwarder

Wa Status Forwarder adalah layanan **Node.js** yang menerima event dari akun WhatsApp tertaut melalui Baileys, menyaring Status yang valid, mengambil media yang diizinkan, lalu meneruskannya ke Telegram Cloud Bot API. Bot dirancang untuk berjalan sebagai proses background di VPS atau Pterodactyl tanpa WhatsApp Desktop, Telegram Desktop, browser automation, atau sesi browser yang harus tetap terbuka.

Bot tetap memerlukan satu akun WhatsApp yang ditautkan sebagai perangkat tertaut. Baileys digunakan sebagai client protokol WhatsApp Web di dalam aplikasi; bot bukan WhatsApp Business Cloud API.

## Fungsi utama

Bot menangkap Status realtime dan Status yang tersedia melalui history sync atau recovery setelah reconnect. Setiap Status melewati klasifikasi, pembatasan rate, deduplikasi, pemrosesan media, natural view, auto-like, dan forwarding sesuai konfigurasi.

Bot juga menyimpan state penting agar event yang sama tidak diteruskan berkali-kali. Queue sementara berada di memory, sedangkan backlog Status dan metadata deduplikasi disimpan di SQLite untuk pemulihan setelah restart atau koneksi terputus.

## Cakupan pemrosesan

Bot hanya memproses data yang benar-benar diterima oleh akun WhatsApp tertaut. Bot **tidak membaca atau meneruskan seluruh isi chat**.

| Sumber pesan | Perilaku |
|---|---|
| Status kontak biasa | Diproses dan diteruskan jika memenuhi filter. |
| Group Status | Diproses dengan metadata participant dan sumber yang tersedia. |
| Pesan chat grup biasa | Tidak masuk pipeline Status. |
| Media channel/newsletter yang diteruskan ke chat biasa | Dapat diteruskan secara terbatas jika metadata forward valid dan konfigurasi mengizinkan; tidak diberi auto-like Status. |
| Konten channel yang benar-benar diterima sebagai Status | Mengikuti pipeline Status, termasuk natural view, auto-like, verifikasi reaction, deduplikasi, dan backlog. |
| Media yang dikirim langsung melalui chat pribadi biasa | Tidak diproses atau diteruskan. |
| Pesan channel langsung atau scraping channel | Tidak dilakukan. |
| View Once | Dilewati; bot tidak mencoba melewati kontrol privasi. |

Tipe media yang dapat diproses mengikuti `allowedMediaTypes` pada `config.js`, seperti gambar, video, audio, dokumen, stiker, dan teks.

## Alur kerja

```text
WhatsApp / Baileys
        ↓
Event realtime, history, update, atau reconnect
        ↓
Classifier Status dan filter cakupan
        ↓
Queue, rate limit, dan anti-spam
        ↓
Fingerprint serta deduplikasi SQLite
        ↓
Natural view dan auto-like untuk Status aktual
        ↓
Download media dari event WhatsApp
        ↓
Caption terstruktur dan upload ke Telegram Cloud Bot API
        ↓
Audit, metrics, backlog, dan verifikasi hasil
```

Event realtime menggunakan `messages.upsert`. History dan catch-up digunakan untuk mengambil Status yang diterima saat koneksi offline. Snapshot pesan dan backlog membantu proses retry atau recovery ketika payload event tidak lengkap.

## Auto-like dan reaction

Auto-like hanya dilakukan pada Status aktual yang lolos filter dan bukan Status milik sendiri jika opsi tersebut aktif. Status channel yang benar-benar masuk sebagai Status mengikuti jalur auto-like yang sama. Media channel yang hanya diteruskan ke chat biasa tidak diperlakukan sebagai Status dan tidak diberi reaction Status.

Reaction menggunakan emoji yang diatur melalui satu konstanta di bagian atas `config.js`:

```js
const AUTO_LIKE_EMOJI = '💚';
```

Bot melakukan verifikasi echo reaction apabila `likeVerificationEnabled` aktif. Log sukses tidak dianggap final hanya karena request reaction berhasil dikirim; hasil dapat tercatat sebagai terkonfirmasi atau belum terkonfirmasi.

## Anti-spam dan deduplikasi

Analyzer anti-spam adalah analyzer lokal deterministik berbasis fingerprint, cache, state proses, dan SQLite. Ia tidak memanggil LLM eksternal untuk setiap Status, sehingga tidak memerlukan API key AI, biaya tambahan, atau latency eksternal.

Fingerprint dapat menggunakan message ID, remote JID, participant, file hash, encrypted hash, media key, direct path, tipe media, owner token, dan content signature. Sistem memeriksa event yang sedang diproses, cache memory, fingerprint SQLite, record Status, dan batas forwarding per kontak maupun total per jam.

Backlog dan record memakai kunci unik serta upsert. Retry atau reconnect tidak seharusnya membuat record logis kedua untuk Status yang sama. Tabel fingerprint adalah indeks teknis deduplikasi; operator sebaiknya membaca view record Status, bukan menganggap setiap fingerprint sebagai forwarding terpisah.

## Caption Telegram

Caption media menggunakan format konsisten dan footer `© joo.exe`:

```text
STATUS WHATSAPP BARU

Pengirim : Nama Kontak
ID       : identitas yang tersedia
Jenis    : VIDEO
Kategori : STATUS BROADCAST
Waktu    : waktu Status
Sumber   : sumber event jika tersedia

ISI STATUS
───────────
Isi caption Status

───────────
© joo.exe
```

Caption media dibatasi sesuai batas Telegram dan dinormalisasi agar spasi, baris kosong, serta karakter caption tidak merusak format. Pesan teks dan media dikirim menggunakan Cloud Bot API resmi melalui HTTPS.

## Alert dan Signal Audit

Alert operasional digunakan untuk masalah koneksi, sesi, database, panggilan, dan pengiriman Telegram. Alert kegagalan media berlaku untuk semua tipe media yang benar-benar masuk pipeline Status atau forwarded media yang diizinkan, dengan detail jenis media dan error yang diterima. Jika tersedia, detail juga mencantumkan ukuran media, method Telegram, jumlah percobaan, kategori kegagalan (`timeout`, `network_error`, atau `api_error`), HTTP status, dan pesan API yang sudah dinormalisasi.

Contoh blok console ringkas:

```text
SIGNAL AUDIT
STATUS    : 17x | sudah ada sinyal
ANTICALL  : 0x  | belum ada sinyal
AUTOBLOCK : 0x  | belum ada sinyal
```

Baris Signal Audit hanya menampilkan jumlah dan teks status, tanpa hari atau waktu.

## Database SQLite

Database utama adalah `status-antispam.db` dengan mode WAL. File pendamping berikut dapat muncul ketika SQLite aktif:

| File | Fungsi |
|---|---|
| `status-antispam.db` | Database utama, tabel, view, backlog, dan metadata. |
| `status-antispam.db-wal` | Transaksi terbaru sebelum checkpoint ke database utama. |
| `status-antispam.db-shm` | Koordinasi shared-memory untuk indeks WAL. |

Ketiga file tersebut adalah satu database logis. Jangan menghapus file `-wal` atau `-shm` ketika bot masih berjalan. File tersebut dapat tetap ada setelah shutdown paksa atau proses crash dan tidak otomatis berarti database rusak.

Metadata readable tersedia melalui view berikut:

| View | Isi |
|---|---|
| `v_processed_status_records` | Riwayat logis Status yang sudah diproses. |
| `v_pending_status_backlog` | Antrean Status yang belum selesai. |
| `v_daily_status_reports` | Ringkasan laporan harian. |

Untuk membaca database tanpa membuka `message_blob` internal:

```bash
npm run db:inspect
```

Jalankan pemeriksaan integritas ketika bot tidak sedang menulis database:

```bash
node -e "const DB=require('better-sqlite3'); const db=new DB('status-antispam.db',{readonly:true,fileMustExist:true}); console.log(db.pragma('journal_mode',{simple:true})); console.log(db.pragma('quick_check',{simple:true})); db.close();"
```

## Konfigurasi utama

Semua konfigurasi operasional berada di `config.js`. Nilai penting yang biasanya disesuaikan adalah:

```js
const AUTO_LIKE_EMOJI = '💚';

telegram: {
    botToken: 'ISI_BOT_TOKEN_TELEGRAM',
    chatId: '-100xxxxxxxxxx',
    requestTimeoutMs: 45000,
    maxRetries: 2,
    footerText: '© joo.exe'
}
```

| Bagian | Kegunaan |
|---|---|
| `whatsapp` | Nomor pairing dan folder sesi. |
| `owner` | Nomor pemilik untuk kontrol dan alert tertentu. |
| `telegram` | Token bot, chat tujuan, timeout, retry, dan footer. |
| `connection` | Reconnect, history sync, keep-online, privacy, dan anti-call. |
| `statusForwarder` | Media, queue, deduplikasi, rate limit, auto-like, dan channel-forward. |
| `operations` | Database, audit, metrics, backup sesi, dan pemeriksaan integritas. |
| `console` | Mode tampilan dan detail log. |

Jangan commit token Telegram, nomor sensitif, folder sesi, database runtime, atau file state ke repository. Setelah mengubah `config.js`, restart runner agar konfigurasi dimuat ulang.

## Persyaratan dan instalasi

| Komponen | Persyaratan |
|---|---|
| Node.js | `>=26.0.0` |
| npm | `>=11.0.0` |
| Sistem operasi | Linux server direkomendasikan. |
| WhatsApp | Akun yang dapat ditautkan sebagai perangkat tertaut. |
| Telegram | Bot token dan chat ID tujuan. |
| Storage | Folder persistent dan writable untuk sesi, state, serta SQLite. |

Instalasi:

```bash
git clone https://github.com/JohnIsDimz/Bot-Tele.git
cd Bot-Tele
npm ci
npm test
```

Menjalankan bot dengan runner:

```bash
npm start
```

Untuk debugging langsung tanpa supervisor:

```bash
npm run bot
```

`runner.js` akan menjalankan ulang proses bot ketika terjadi exit yang tidak diharapkan. Pada Pterodactyl, gunakan storage persistent agar `auth_info_baileys/`, `auth_backups/`, `status-antispam.db`, dan file state tidak hilang ketika container dibuat ulang.

## Operasi dan backup

Gunakan satu instance bot untuk satu folder sesi WhatsApp dan satu database. Jangan menjalankan dua instance yang memakai `auth_info_baileys/` atau `status-antispam.db` yang sama.

Backup minimal yang perlu disimpan adalah:

```text
auth_info_baileys/
auth_backups/
status-antispam.db
status-antispam.db-wal   jika ada
status-antispam.db-shm   jika ada
healthcheck.json
metrics.json
audit-log.json
failed-jobs.json
runtime-state.json
```

Hentikan bot secara normal sebelum backup manual database. Jika bot mati karena kill paksa, jangan langsung menghapus file WAL/SHM; jalankan pemeriksaan integritas terlebih dahulu.

## Troubleshooting singkat

| Masalah | Pemeriksaan utama |
|---|---|
| Pairing berulang | Pastikan folder `auth_info_baileys/` persistent dan writable. |
| Telegram gagal mengirim | Periksa koneksi outbound HTTPS, token, chat ID, permission bot, timeout, ukuran media, dan detail error API. |
| `fetch failed` | Periksa DNS, firewall, routing, resource container, bandwidth, dan timeout VPS. |
| Status terduplikasi | Periksa view SQLite, content signature, message ID, fingerprint, dan queue retry. |
| File WAL/SHM tetap ada | Pastikan tidak ada proses yang masih membuka database; jangan hapus saat bot aktif. |
| Auto-like tidak terlihat | Periksa key PN/LID, echo reaction, status milik sendiri, dan hasil verifikasi. |
| Server kehabisan memory | Kurangi history sync, queue, batas media, atau concurrency. |
| Bot restart terus | Baca log runner, `failed-jobs.json`, dan validasi `config.js`. |

## Perintah penting

```bash
npm ci             # instalasi dependency dari lockfile
npm test           # pemeriksaan syntax seluruh entrypoint
npm run db:inspect # membaca view SQLite readable
npm start          # menjalankan runner dan bot
npm run bot        # menjalankan bot langsung
```

## Referensi

- [Baileys v7 Migration Guide](https://baileys.wiki/migration/v7)
- [Baileys Events](https://baileys.wiki/concepts/events)
- [Baileys History Sync](https://baileys.wiki/advanced/history-sync)
- [Telegram Bot API](https://core.telegram.org/bots/api)
- [Telegram Bots FAQ](https://core.telegram.org/bots/faq)
- [SQLite Write-Ahead Logging](https://sqlite.org/wal.html)
- [SQLite Online Backup API](https://sqlite.org/backup.html)

© joo.exe
