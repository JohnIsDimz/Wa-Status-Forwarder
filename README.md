# Bot-Tele

Bot WhatsApp untuk mengambil media status dan meneruskannya ke Telegram.

## Persyaratan

Proyek ini menargetkan **Node.js 26.x** dan npm 11 atau yang lebih baru. Versi Baileys 7 menggunakan modul ESM, sehingga kode CommonJS proyek memuat Baileys melalui dynamic `import()`.

## Instalasi

```bash
npm install
```

## Verifikasi

```bash
npm test
```

Perintah tersebut menjalankan pemeriksaan sintaks seluruh berkas JavaScript. Pada CI, dependensi dipasang menggunakan `npm ci` dan diverifikasi di Node.js 26.x.

## Menjalankan

```bash
npm start
```

Konfigurasi bot disimpan di `config.js`. Jangan commit kredensial WhatsApp, token Telegram, atau berkas sesi ke repositori.
