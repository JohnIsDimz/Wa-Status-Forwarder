const ANSI = {
    reset: '\x1b[0m',
    bold: '\x1b[1m',
    cyan: '\x1b[36m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    red: '\x1b[31m',
    magenta: '\x1b[35m',
    blue: '\x1b[34m',
    gray: '\x1b[90m'
};

const STARTUP_ASCII = String.raw`
 _______              ______                  _     
(_______)            (_____ \                | |    
     _  ___   ___     _____) )__  ____   ___ | |  _ 
 _  | |/ _ \ / _ \   |  ____/ _ \|  _ \ / _ \| |_/ )
| |_| | |_| | |_| |  | |   | |_| | |_| | |_| |  _ ( 
 \___/ \___/ \___/   |_|    \___/|  __/ \___/|_| \_)
                                 |_|                
`;

function createConsoleHelpers(options = {}) {
    const colorize = options.colorize !== false;
    const timeZone = options.timeZone || 'Asia/Jakarta';
    const autoLikeEmoji = String(options.autoLikeEmoji || '💚️');
    const showSendLogs = options.showSendLogs === true;
    const showLikeLogs = options.showLikeLogs === true;
    const showCallLogs = options.showCallLogs === true;
    const ultraMinimal = options.ultraMinimal === true;
    const consoleContentWidth = 42;

    function paint(text, color) {
        if (!colorize) return text;
        return `${color}${text}${ANSI.reset}`;
    }

    function truncateText(text, maxLength) {
        const value = String(text || '');
        if (value.length <= maxLength) return value;
        return `${value.slice(0, Math.max(0, maxLength - 1))}…`;
    }

    function padLine(label, value, width) {
        const normalizedLabel = `${label}:`;
        const maxValueLength = Math.max(0, width - normalizedLabel.length - 1);
        const safeValue = truncateText(value, maxValueLength);
        const rawLine = `${normalizedLabel} ${safeValue}`;
        return rawLine + ' '.repeat(Math.max(0, width - rawLine.length));
    }

    function formatSendTime() {
        return new Date().toLocaleTimeString('id-ID', {
            hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone
        });
    }

    function formatDisplayDateTime() {
        return `${new Date().toLocaleString('id-ID', {
            day: '2-digit', month: '2-digit', year: 'numeric',
            hour: '2-digit', minute: '2-digit', second: '2-digit',
            timeZone
        })} WIB`;
    }

    function renderConsoleBox(title, borderColor, lines) {
        const boxWidth = consoleContentWidth + 2;
        const topBorder = `┌${'─'.repeat(boxWidth)}┐`;
        const bottomBorder = `└${'─'.repeat(boxWidth)}┘`;
        console.log(paint(topBorder, borderColor));
        console.log(`│ ${paint(title.padEnd(consoleContentWidth), ANSI.bold)} │`);
        for (const line of lines) {
            console.log(`│ ${line} │`);
        }
        console.log(paint(bottomBorder, borderColor));
    }

    function renderLabeledConsoleBox(title, borderColor, rows = []) {
        const lines = rows.map(({ label, value, color = ANSI.gray }) => paint(padLine(label, value, consoleContentWidth), color));
        renderConsoleBox(` ${title} `, borderColor, lines);
    }

    function getMediaTypeColor(type) {
        switch (type) {
            case 'image': return ANSI.magenta;
            case 'video': return ANSI.red;
            case 'audio': return ANSI.yellow;
            case 'text': return ANSI.cyan;
            case 'document': return ANSI.blue;
            case 'sticker': return ANSI.green;
            default: return ANSI.gray;
        }
    }

    function logConfigValidation(summary = {}) {
        const status = summary.valid === false ? 'GAGAL' : 'VALID';
        const rows = [
            { label: 'STATUS', value: status, color: summary.valid === false ? ANSI.red : ANSI.green },
            { label: 'PRESET', value: summary.preset || '-', color: ANSI.cyan },
            { label: 'PEMERIKSAAN', value: `${summary.checked ?? 0} pengaturan`, color: ANSI.blue }
        ];
        if (summary.errors > 0) {
            rows.push({ label: 'KESALAHAN', value: `${summary.errors} item`, color: ANSI.red });
        }
        if (summary.warnings > 0) {
            rows.push({ label: 'PERINGATAN', value: `${summary.warnings} item`, color: ANSI.yellow });
        }
        rows.push({ label: 'WAKTU', value: formatDisplayDateTime(), color: ANSI.yellow });
        renderLabeledConsoleBox('VALIDASI KONFIGURASI', summary.valid === false ? ANSI.red : ANSI.green, rows);
    }

    function logOperationalHealth(summary = {}) {
        const status = String(summary.status || 'UNKNOWN').toUpperCase();
        const statusColor = status === 'SEHAT' || status === 'CONNECTED' ? ANSI.green : (status === 'WARNING' ? ANSI.yellow : ANSI.cyan);
        const rows = [
            { label: 'STATUS BOT', value: status, color: statusColor },
            { label: 'WHATSAPP', value: summary.whatsapp || '-', color: ANSI.cyan },
            { label: 'TELEGRAM', value: summary.telegram || '-', color: ANSI.blue },
            { label: 'DATABASE', value: summary.database || '-', color: ANSI.magenta },
            { label: 'STORAGE', value: summary.storage || '-', color: ANSI.gray },
            { label: 'ANTREAN', value: summary.queue || '-', color: ANSI.yellow },
            { label: 'BACKLOG', value: summary.backlog || '-', color: ANSI.yellow }
        ];
        if (summary.lastStatusAt) {
            rows.push({ label: 'STATUS TERAKHIR', value: summary.lastStatusAt, color: ANSI.gray });
        }
        if (summary.lastForwardedAt) {
            rows.push({ label: 'KIRIM TERAKHIR', value: summary.lastForwardedAt, color: ANSI.gray });
        }
        if (summary.lastError) {
            rows.push({ label: 'ERROR TERAKHIR', value: summary.lastError, color: ANSI.red });
        }
        rows.push({ label: 'DIPERIKSA PADA', value: formatDisplayDateTime(), color: ANSI.yellow });
        renderLabeledConsoleBox('HEALTH OPERASIONAL', status === 'WARNING' ? ANSI.yellow : ANSI.blue, rows);
    }

    function logCapacityWarning(summary = {}) {
        const rows = [
            { label: 'STATUS', value: summary.status || 'PERINGATAN', color: summary.status === 'KRITIS' ? ANSI.red : ANSI.yellow },
            { label: 'RUANG TERSISA', value: summary.free || '-', color: ANSI.yellow },
            { label: 'PENGGUNAAN DISK', value: summary.used || '-', color: ANSI.yellow },
            { label: 'UKURAN DATABASE', value: summary.database || '-', color: ANSI.magenta },
            { label: 'LOKASI', value: summary.location || '-', color: ANSI.gray },
            { label: 'TINDAKAN', value: summary.action || 'Periksa storage server', color: ANSI.cyan },
            { label: 'WAKTU', value: formatDisplayDateTime(), color: ANSI.yellow }
        ];
        renderLabeledConsoleBox('PERINGATAN KAPASITAS STORAGE', summary.status === 'KRITIS' ? ANSI.red : ANSI.yellow, rows);
    }

    function logBacklogRecovery(summary = {}) {
        const rows = [
            { label: 'DITEMUKAN', value: `${summary.found ?? 0} item`, color: ANSI.cyan },
            { label: 'DIJADWALKAN', value: `${summary.scheduled ?? 0} item`, color: ANSI.green },
            { label: 'KADALUARSA', value: `${summary.expired ?? 0} item`, color: ANSI.yellow },
            { label: 'TIDAK VALID', value: `${summary.invalid ?? 0} item`, color: ANSI.red },
            { label: 'TERSISA', value: `${summary.remaining ?? 0} item`, color: ANSI.magenta },
            { label: 'SUMBER', value: summary.source || 'SQLite', color: ANSI.blue },
            { label: 'WAKTU', value: formatDisplayDateTime(), color: ANSI.yellow }
        ];
        renderLabeledConsoleBox('PEMULIHAN BACKLOG', ANSI.green, rows);
    }

    function logBoot(message) {
        renderLabeledConsoleBox('MEMULAI BOT', ANSI.cyan, [
            { label: 'KETERANGAN', value: message, color: ANSI.green },
            { label: 'WAKTU', value: formatDisplayDateTime(), color: ANSI.yellow }
        ]);
    }

    function logCode(message) {
        renderLabeledConsoleBox('KODE PAIRING', ANSI.yellow, [
            { label: 'KODE', value: message, color: `${ANSI.bold}${ANSI.yellow}` },
            { label: 'WAKTU', value: formatDisplayDateTime(), color: ANSI.yellow }
        ]);
    }

    function logPairInfo(phoneNumber, detail = 'Buka WhatsApp lalu tautkan perangkat') {
        renderLabeledConsoleBox('INFO PAIRING', ANSI.yellow, [
            { label: 'NOMOR', value: phoneNumber, color: ANSI.cyan },
            { label: 'TINDAKAN', value: detail, color: ANSI.green },
            { label: 'WAKTU', value: formatDisplayDateTime(), color: ANSI.yellow }
        ]);
    }

    function logWaConnecting() {
        renderLabeledConsoleBox('WHATSAPP', ANSI.blue, [
            { label: 'STATUS', value: 'MENGHUBUNGKAN', color: ANSI.blue },
            { label: 'WAKTU', value: formatDisplayDateTime(), color: ANSI.yellow }
        ]);
    }

    function logWaConnected() {
        renderLabeledConsoleBox('WHATSAPP', ANSI.green, [
            { label: 'STATUS', value: 'TERHUBUNG', color: ANSI.green },
            { label: 'WAKTU', value: formatDisplayDateTime(), color: ANSI.yellow }
        ]);
    }

    function logSystem(message, detail = '', title = 'SISTEM', borderColor = ANSI.blue) {
        const rows = [
            { label: 'PESAN', value: message, color: ANSI.green }
        ];
        if (detail) {
            rows.push({ label: 'DETAIL', value: detail, color: ANSI.yellow });
        }
        rows.push({ label: 'WAKTU', value: formatDisplayDateTime(), color: ANSI.yellow });
        renderLabeledConsoleBox(title, borderColor, rows);
    }

    function logHistory(message) {
        logSystem(message, '', 'RIWAYAT STATUS', ANSI.blue);
    }

    function logDebug(message, detail = '') {
        logSystem(message, detail, 'DIAGNOSTIK', ANSI.gray);
    }

    function logWait(phoneNumber) {
        logSystem('Menunggu koneksi WhatsApp', phoneNumber, 'MENUNGGU KONEKSI', ANSI.yellow);
    }

    function isDailyResetReason(reason = '') {
        const normalized = String(reason || '').trim().toLowerCase().replace(/[_-]+/g, ' ');
        return normalized === 'jadwal harian 12 malam wib'
            || normalized.startsWith('jadwal harian 12 malam wib ');
    }

    function isDatabaseCheckIntervalReason(reason = '') {
        const normalized = String(reason || '').trim().toLowerCase().replace(/[_-]+/g, ' ');
        return normalized === 'interval 30 menit' || normalized === 'interval 30m';
    }

    function logDatabaseCheck(summary = {}) {
        const quickCheck = String(summary.quickCheck || 'ok').toLowerCase();
        const rows = [
            { label: 'STATUS', value: summary.status || 'OK', color: summary.status === 'WARNING' ? ANSI.yellow : ANSI.green },
            { label: 'INTEGRITAS', value: quickCheck === 'ok' ? 'Database konsisten' : quickCheck.toUpperCase(), color: quickCheck === 'ok' ? ANSI.green : ANSI.yellow },
            { label: 'BARIS DIPERIKSA', value: `${summary.scannedRows ?? 0} baris`, color: ANSI.cyan },
            { label: 'RECORD STATUS', value: `${summary.statusRecordRows ?? 0} record`, color: ANSI.blue },
            { label: 'FINGERPRINT', value: `${summary.fingerprintRows ?? 0} kunci deduplikasi`, color: ANSI.magenta },
            { label: 'DOKUMEN STATE', value: `${summary.documentRows ?? 0} dokumen`, color: ANSI.green }
        ];
        if ((summary.updatedRows ?? 0) > 0 || (summary.deletedRows ?? 0) > 0) {
            rows.push({ label: 'PERBAIKAN', value: `updated=${summary.updatedRows ?? 0}, deleted=${summary.deletedRows ?? 0}`, color: ANSI.yellow });
        }
        if (summary.lastResetAt) {
            rows.push({ label: 'RESET TERAKHIR', value: summary.lastResetAt, color: ANSI.gray });
        }
        if (summary.reason && !isDailyResetReason(summary.reason) && !isDatabaseCheckIntervalReason(summary.reason)) {
            rows.push({ label: 'ALASAN RESET', value: summary.reason, color: ANSI.gray });
        }
        rows.push({ label: 'DICEK PADA', value: formatDisplayDateTime(), color: ANSI.yellow });
        renderLabeledConsoleBox('DATABASE CHECK', ANSI.blue, rows);
    }

    function logSignalAudit(summary = {}) {
        const rows = [
            { label: 'STATUS', value: summary.statusLine || '-', color: ANSI.cyan },
            { label: 'ANTI-PANGGILAN', value: summary.antiCallLine || '-', color: ANSI.yellow },
            { label: 'BLOKIR OTOMATIS', value: summary.autoBlockLine || '-', color: ANSI.red }
        ];
        renderLabeledConsoleBox('PEMERIKSAAN SINYAL', ANSI.blue, rows);
    }

    function logDailySummary(summary = {}) {
        const totals = summary.totals || {};
        const topUploader = summary.topUploader || null;
        const failedCount = Array.isArray(summary.failures) ? summary.failures.length : 0;
        const rows = [
            { label: 'HARI', value: summary.dayKey || '-', color: ANSI.cyan },
            { label: 'TERDETEKSI', value: `${totals.detected || 0} Status`, color: ANSI.cyan },
            { label: 'GAMBAR', value: `${totals.image || 0} media`, color: ANSI.magenta },
            { label: 'VIDEO', value: `${totals.video || 0} media`, color: ANSI.red },
            { label: 'AUDIO', value: `${totals.audio || 0} media`, color: ANSI.yellow },
            { label: 'DOKUMEN', value: `${totals.document || 0} media`, color: ANSI.blue },
            { label: 'DITERUSKAN', value: `${totals.forwarded || 0} media`, color: ANSI.green },
            { label: 'DIABAIKAN', value: `${totals.skipped || 0} Status`, color: ANSI.gray },
            { label: 'DUPLIKAT', value: `${totals.duplicate || 0} Status`, color: ANSI.yellow },
            { label: 'RETRY', value: `${totals.retries || 0} percobaan`, color: ANSI.yellow },
            { label: 'LIKE TERVERIFIKASI', value: `${totals.liked || 0} Status`, color: ANSI.green },
            { label: 'GAGAL', value: `${totals.failed || failedCount} media`, color: ANSI.red },
            { label: 'PENGIRIM UTAMA', value: topUploader ? `${topUploader.displayName} (${topUploader.total} media)` : '-', color: ANSI.green },
            { label: 'WAKTU', value: formatDisplayDateTime(), color: ANSI.yellow }
        ];
        renderLabeledConsoleBox('RINGKASAN HARIAN', ANSI.green, rows);
    }

    function logDatabaseResetReport(summary = {}) {
        const rows = [
            { label: 'FINGERPRINT', value: `${summary.fingerprintRowsCleared ?? 0} kunci`, color: ANSI.magenta },
            { label: 'RECORD STATUS', value: `${summary.statusRecordRowsCleared ?? 0} record`, color: ANSI.blue },
            { label: 'DOKUMEN STATE', value: `${summary.documentRowsCleared ?? 0} dokumen`, color: ANSI.green },
            { label: 'DURASI', value: summary.durationMs != null ? `${summary.durationMs} ms` : '-', color: ANSI.yellow }
        ];
        if (summary.reason && !isDailyResetReason(summary.reason)) {
            rows.push({ label: 'ALASAN RESET', value: summary.reason, color: ANSI.gray });
        }
        rows.push({ label: 'SELESAI PADA', value: formatDisplayDateTime(), color: ANSI.yellow });
        renderLabeledConsoleBox('LAPORAN RESET DATABASE', ANSI.yellow, rows);
    }

    function logDuplicateSkip(identity, mediaInfo, reason = '', statusKey = '') {
        const borderColor = getMediaTypeColor(mediaInfo?.type);
        const reasonText = {
            duplicate: 'Duplikat terdeteksi',
            'precheck duplicate': 'Sudah tercatat sebelum diproses',
            'buffer duplicate': 'Duplikat sedang diproses'
        }[String(reason || '').toLowerCase()] || reason || 'Duplikat terdeteksi';
        const rows = [
            { label: 'NAMA KONTAK', value: identity?.displayName || '-', color: ANSI.green },
            { label: 'ID KONTAK', value: identity?.preferredJid || identity?.jid || identity?.number || '-', color: ANSI.cyan },
            { label: 'JENIS MEDIA', value: String(mediaInfo?.type || 'UNKNOWN').toUpperCase(), color: borderColor },
            { label: 'ALASAN', value: reasonText, color: ANSI.yellow }
        ];
        if (statusKey) {
            rows.push({ label: 'KUNCI STATUS', value: statusKey, color: ANSI.gray });
        }
        rows.push({ label: 'WAKTU', value: formatDisplayDateTime(), color: ANSI.yellow });
        renderLabeledConsoleBox('DUPLIKAT DIABAIKAN', borderColor, rows);
    }

    function logError(message, detail = '') {
        const rows = [
            { label: 'TOPIK', value: message, color: ANSI.red }
        ];
        if (detail) {
            rows.push({ label: 'DETAIL', value: detail, color: ANSI.yellow });
        }
        rows.push({ label: 'WAKTU', value: formatDisplayDateTime(), color: ANSI.yellow });
        renderLabeledConsoleBox('KESALAHAN', ANSI.red, rows);
    }

    function logVerbose(message) {
        if (!ultraMinimal) {
            logSystem(message, '', 'SISTEM', ANSI.gray);
        }
    }

    function logSend(mediaInfo, identity, statusCategory, correlationId = '') {
        if (!showSendLogs) return;
        const borderColor = getMediaTypeColor(mediaInfo.type);
        const title = ` KIRIM ${String(mediaInfo.type || '').toUpperCase()} `;
        const lines = [
            paint(padLine('NAMA KONTAK', identity.displayName, consoleContentWidth), ANSI.green),
            paint(padLine('NOMOR KONTAK', identity.number, consoleContentWidth), ANSI.cyan),
            paint(padLine('TERSIMPAN', identity.isUserSaved ? 'YA' : 'TIDAK', consoleContentWidth), identity.isUserSaved ? ANSI.green : ANSI.yellow),
            paint(padLine('JENIS MEDIA', String(mediaInfo.type || '').toUpperCase(), consoleContentWidth), getMediaTypeColor(mediaInfo.type)),
            paint(padLine('WAKTU KIRIM', formatSendTime(), consoleContentWidth), ANSI.yellow),
            paint(padLine('KATEGORI', statusCategory, consoleContentWidth), ANSI.blue),
            paint(padLine('CORRELATION ID', correlationId || '-', consoleContentWidth), ANSI.gray)
        ];
        renderConsoleBox(title, borderColor, lines);
    }

    function logLike(identity, mediaInfo, correlationId = '') {
        if (!showLikeLogs) return;
        const borderColor = getMediaTypeColor(mediaInfo.type);
        const title = ` REAKSI ${autoLikeEmoji} ${String(mediaInfo.type || '').toUpperCase()} `;
        const lines = [
            paint(padLine('NAMA KONTAK', identity.displayName, consoleContentWidth), ANSI.green),
            paint(padLine('NOMOR KONTAK', identity.number, consoleContentWidth), ANSI.cyan),
            paint(padLine('TERSIMPAN', identity.isUserSaved ? 'YA' : 'TIDAK', consoleContentWidth), identity.isUserSaved ? ANSI.green : ANSI.yellow),
            paint(padLine('JENIS MEDIA', String(mediaInfo.type || '').toUpperCase(), consoleContentWidth), getMediaTypeColor(mediaInfo.type)),
            paint(padLine('WAKTU REAKSI', formatSendTime(), consoleContentWidth), ANSI.yellow),
            paint(padLine('CORRELATION ID', correlationId || '-', consoleContentWidth), ANSI.gray)
        ];
        renderConsoleBox(title, borderColor, lines);
    }

    function logCall(call, identity, action) {
        if (!showCallLogs) return;
        const kindText = call?.isVideo ? 'VIDEO' : 'SUARA';
        const actionText = { REJECT: 'DITOLAK', BLOCK: 'DIBLOKIR' }[String(action || '').toUpperCase()] || String(action || 'DIPROSES').toUpperCase();
        const callStatus = String(call?.status || 'unknown').toUpperCase();
        const callStatusText = { REJECT: 'DITOLAK', BLOCK: 'DIBLOKIR', RINGING: 'BERDERING' }[callStatus] || callStatus;
        const borderColor = call?.isVideo ? ANSI.magenta : ANSI.red;
        const title = ` PANGGILAN ${actionText} ${kindText} `;
        const lines = [
            paint(padLine('NAMA KONTAK', identity.displayName, consoleContentWidth), ANSI.green),
            paint(padLine('NOMOR KONTAK', identity.number, consoleContentWidth), ANSI.cyan),
            paint(padLine('TERSIMPAN', identity.isUserSaved ? 'YA' : 'TIDAK', consoleContentWidth), identity.isUserSaved ? ANSI.green : ANSI.yellow),
            paint(padLine('STATUS PANGGILAN', callStatusText, consoleContentWidth), ANSI.red),
            paint(padLine('WAKTU PROSES', formatSendTime(), consoleContentWidth), ANSI.yellow)
        ];
        renderConsoleBox(title, borderColor, lines);
    }

    return {
        ANSI,
        STARTUP_ASCII,
        paint,
        truncateText,
        padLine,
        formatSendTime,
        formatDisplayDateTime,
        renderConsoleBox,
        renderLabeledConsoleBox,
        getMediaTypeColor,
        logBoot,
        logCode,
        logPairInfo,
        logWaConnecting,
        logWaConnected,
        logSystem,
        logHistory,
        logDebug,
        logWait,
        logDatabaseCheck,
        logConfigValidation,
        logOperationalHealth,
        logCapacityWarning,
        logBacklogRecovery,
        logSignalAudit,
        logDailySummary,
        logDatabaseResetReport,
        logDuplicateSkip,
        logError,
        logVerbose,
        logSend,
        logLike,
        logCall
    };
}

module.exports = {
    ANSI,
    STARTUP_ASCII,
    createConsoleHelpers
};
