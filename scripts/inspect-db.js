#!/usr/bin/env node

const path = require('node:path');
const fs = require('node:fs');
const BetterSqlite3 = require('better-sqlite3');

const databaseFile = path.resolve(process.argv[2] || 'status-antispam.db');
const readableViews = [
    ['v_pending_status_backlog', 'Antrian status yang belum selesai'],
    ['v_processed_status_records', 'Riwayat status yang sudah diproses'],
    ['v_daily_status_reports', 'Ringkasan laporan harian']
];

if (!fs.existsSync(databaseFile)) {
    console.error(`Database tidak ditemukan: ${databaseFile}`);
    process.exitCode = 1;
} else {
    const db = new BetterSqlite3(databaseFile, { readonly: true, fileMustExist: true });
    try {
        const existingViews = new Set(
            db.prepare("SELECT name FROM sqlite_master WHERE type = 'view'").all().map((row) => row.name)
        );

        console.log(`Database: ${databaseFile}`);
        for (const [viewName, label] of readableViews) {
            console.log(`\n=== ${label} (${viewName}) ===`);
            if (!existingViews.has(viewName)) {
                console.log('View belum tersedia. Jalankan bot satu kali untuk migrasi schema.');
                continue;
            }

            const orderBy = viewName === 'v_pending_status_backlog'
                ? 'created_at_utc DESC'
                : viewName === 'v_processed_status_records'
                    ? 'processed_at_utc DESC'
                    : 'generated_at_utc DESC';
            const rows = db.prepare(`SELECT * FROM ${viewName} ORDER BY ${orderBy} LIMIT 100`).all();
            if (rows.length === 0) console.log('(kosong)');
            else console.table(rows);
        }
    } finally {
        db.close();
    }
}
