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
    const autoLikeEmoji = String(options.autoLikeEmoji || '❤️');
    const showSendLogs = options.showSendLogs === true;
    const showLikeLogs = options.showLikeLogs === true;
    const showCallLogs = options.showCallLogs === true;
    const ultraMinimal = options.ultraMinimal === true;

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
        const boxWidth = 44;
        const topBorder = `┌${'─'.repeat(boxWidth)}┐`;
        const bottomBorder = `└${'─'.repeat(boxWidth)}┘`;
        console.log(paint(topBorder, borderColor));
        console.log(`│${paint(title.padEnd(boxWidth), ANSI.bold)}│`);
        for (const line of lines) {
            console.log(`│${line}│`);
        }
        console.log(paint(bottomBorder, borderColor));
    }

    function renderLabeledConsoleBox(title, borderColor, rows = []) {
        const lines = rows.map(({ label, value, color = ANSI.gray }) => paint(padLine(label, value, 44), color));
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

    function logBoot(message) {
        renderLabeledConsoleBox('BOOT', ANSI.cyan, [
            { label: 'JOHN', value: 'STARTING', color: ANSI.cyan },
            { label: 'INFO', value: message, color: ANSI.green },
            { label: 'WAKTU', value: formatDisplayDateTime(), color: ANSI.yellow }
        ]);
    }

    function logCode(message) {
        renderLabeledConsoleBox('PAIR CODE', ANSI.yellow, [
            { label: 'KODE', value: message, color: `${ANSI.bold}${ANSI.yellow}` },
            { label: 'WAKTU', value: formatDisplayDateTime(), color: ANSI.yellow }
        ]);
    }

    function logPairInfo(phoneNumber, detail = 'Buka WhatsApp lalu tautkan perangkat') {
        renderLabeledConsoleBox('PAIR INFO', ANSI.yellow, [
            { label: 'NOMOR', value: phoneNumber, color: ANSI.cyan },
            { label: 'INFO', value: detail, color: ANSI.green },
            { label: 'WAKTU', value: formatDisplayDateTime(), color: ANSI.yellow }
        ]);
    }

    function logWaConnecting() {
        renderLabeledConsoleBox('WHATSAPP CONNECTING', ANSI.blue, [
            { label: 'STATUS', value: 'CONNECTING', color: ANSI.blue },
            { label: 'WAKTU', value: formatDisplayDateTime(), color: ANSI.yellow }
        ]);
    }

    function logWaConnected() {
        renderLabeledConsoleBox('WHATSAPP CONNECTED', ANSI.green, [
            { label: 'STATUS', value: 'CONNECTED', color: ANSI.green },
            { label: 'WAKTU', value: formatDisplayDateTime(), color: ANSI.yellow }
        ]);
    }

    function logSystem(message, detail = '', title = 'SYSTEM', borderColor = ANSI.blue) {
        const rows = [
            { label: 'INFO', value: message, color: ANSI.green }
        ];
        if (detail) {
            rows.push({ label: 'DETAIL', value: detail, color: ANSI.yellow });
        }
        rows.push({ label: 'WAKTU', value: formatDisplayDateTime(), color: ANSI.yellow });
        renderLabeledConsoleBox(title, borderColor, rows);
    }

    function logHistory(message) {
        logSystem(message, '', 'HISTORY', ANSI.blue);
    }

    function logDebug(message, detail = '') {
        logSystem(message, detail, 'DEBUG', ANSI.gray);
    }

    function logWait(phoneNumber) {
        logSystem('Menunggu koneksi WhatsApp', phoneNumber, 'WAIT', ANSI.yellow);
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
        if (summary.reason) {
            rows.push({ label: 'ALASAN RESET', value: summary.reason, color: ANSI.gray });
        }
        rows.push({ label: 'DICEK PADA', value: formatDisplayDateTime(), color: ANSI.yellow });
        renderLabeledConsoleBox('DATABASE CHECK', ANSI.blue, rows);
    }

    function logSignalAudit(summary = {}) {
        const rows = [
            { label: 'STATUS', value: summary.statusLine || '-', color: ANSI.cyan },
            { label: 'ANTICALL', value: summary.antiCallLine || '-', color: ANSI.yellow },
            { label: 'AUTOBLOCK', value: summary.autoBlockLine || '-', color: ANSI.red }
        ];
        renderLabeledConsoleBox('SIGNAL AUDIT', ANSI.blue, rows);
    }

    function logDailySummary(summary = {}) {
        const totals = summary.totals || {};
        const topUploader = summary.topUploader || null;
        const failedCount = Array.isArray(summary.failures) ? summary.failures.length : 0;
        const rows = [
            { label: 'HARI', value: summary.dayKey || '-', color: ANSI.cyan },
            { label: 'IMAGE', value: String(totals.image || 0), color: ANSI.magenta },
            { label: 'VIDEO', value: String(totals.video || 0), color: ANSI.red },
            { label: 'AUDIO', value: String(totals.audio || 0), color: ANSI.yellow },
            { label: 'DOC', value: String(totals.document || 0), color: ANSI.blue },
            { label: 'FORWARD', value: String(totals.forwarded || 0), color: ANSI.green },
            { label: 'FAILED', value: String(failedCount), color: ANSI.red },
            { label: 'TOP', value: topUploader ? `${topUploader.displayName} (${topUploader.total})` : '-', color: ANSI.green },
            { label: 'WAKTU', value: formatDisplayDateTime(), color: ANSI.yellow }
        ];
        renderLabeledConsoleBox('DAILY SUMMARY', ANSI.green, rows);
    }

    function logDatabaseResetReport(summary = {}) {
        const rows = [
            { label: 'FP', value: String(summary.fingerprintRowsCleared ?? 0), color: ANSI.magenta },
            { label: 'RECORD', value: String(summary.statusRecordRowsCleared ?? 0), color: ANSI.blue },
            { label: 'DOC', value: String(summary.documentRowsCleared ?? 0), color: ANSI.green },
            { label: 'DURASI', value: summary.durationMs != null ? `${summary.durationMs} ms` : '-', color: ANSI.yellow },
            { label: 'WAKTU', value: formatDisplayDateTime(), color: ANSI.yellow }
        ];
        if (summary.reason) {
            rows.splice(4, 0, { label: 'ALASAN', value: summary.reason, color: ANSI.gray });
        }
        renderLabeledConsoleBox('DATABASE RESET REPORT', ANSI.yellow, rows);
    }

    function logDuplicateSkip(identity, mediaInfo, reason = '', statusKey = '') {
        const borderColor = getMediaTypeColor(mediaInfo?.type);
        const rows = [
            { label: 'NAMA', value: identity?.displayName || '-', color: ANSI.green },
            { label: 'ID', value: identity?.preferredJid || identity?.jid || identity?.number || '-', color: ANSI.cyan },
            { label: 'JENIS', value: String(mediaInfo?.type || 'UNKNOWN').toUpperCase(), color: borderColor },
            { label: 'ALASAN', value: reason || 'duplicate', color: ANSI.yellow }
        ];
        if (statusKey) {
            rows.push({ label: 'KEY', value: statusKey, color: ANSI.gray });
        }
        rows.push({ label: 'WAKTU', value: formatDisplayDateTime(), color: ANSI.yellow });
        renderLabeledConsoleBox('DUPLICATE SKIP', borderColor, rows);
    }

    function logError(message, detail = '') {
        const rows = [
            { label: 'TOPIK', value: message, color: ANSI.red }
        ];
        if (detail) {
            rows.push({ label: 'DETAIL', value: detail, color: ANSI.yellow });
        }
        rows.push({ label: 'WAKTU', value: formatDisplayDateTime(), color: ANSI.yellow });
        renderLabeledConsoleBox('ERROR', ANSI.red, rows);
    }

    function logVerbose(message) {
        if (!ultraMinimal) {
            logSystem(message, '', 'SYSTEM', ANSI.gray);
        }
    }

    function logSend(mediaInfo, identity, statusCategory) {
        if (!showSendLogs) return;
        const borderColor = getMediaTypeColor(mediaInfo.type);
        const title = ` SEND ${String(mediaInfo.type || '').toUpperCase()} `;
        const lines = [
            paint(padLine('NAMA', identity.displayName, 44), ANSI.green),
            paint(padLine('NOMOR', identity.number, 44), ANSI.cyan),
            paint(padLine('SIMPAN', identity.isUserSaved ? 'IYA' : 'TIDAK', 44), identity.isUserSaved ? ANSI.green : ANSI.yellow),
            paint(padLine('JENIS', String(mediaInfo.type || '').toUpperCase(), 44), getMediaTypeColor(mediaInfo.type)),
            paint(padLine('JAM', formatSendTime(), 44), ANSI.yellow),
            paint(padLine('MODE', statusCategory, 44), ANSI.blue)
        ];
        renderConsoleBox(title, borderColor, lines);
    }

    function logLike(identity, mediaInfo) {
        if (!showLikeLogs) return;
        const borderColor = getMediaTypeColor(mediaInfo.type);
        const title = ` LIKE ${autoLikeEmoji} ${String(mediaInfo.type || '').toUpperCase()} `;
        const lines = [
            paint(padLine('NAMA', identity.displayName, 44), ANSI.green),
            paint(padLine('NOMOR', identity.number, 44), ANSI.cyan),
            paint(padLine('SIMPAN', identity.isUserSaved ? 'IYA' : 'TIDAK', 44), identity.isUserSaved ? ANSI.green : ANSI.yellow),
            paint(padLine('JENIS', String(mediaInfo.type || '').toUpperCase(), 44), getMediaTypeColor(mediaInfo.type)),
            paint(padLine('JAM', formatSendTime(), 44), ANSI.yellow)
        ];
        renderConsoleBox(title, borderColor, lines);
    }

    function logCall(call, identity, action) {
        if (!showCallLogs) return;
        const kindText = call?.isVideo ? 'VIDEO' : 'VOICE';
        const borderColor = call?.isVideo ? ANSI.magenta : ANSI.red;
        const title = ` CALL ${action} ${kindText} `;
        const lines = [
            paint(padLine('NAMA', identity.displayName, 44), ANSI.green),
            paint(padLine('NOMOR', identity.number, 44), ANSI.cyan),
            paint(padLine('SIMPAN', identity.isUserSaved ? 'IYA' : 'TIDAK', 44), identity.isUserSaved ? ANSI.green : ANSI.yellow),
            paint(padLine('STATUS', String(call?.status || 'unknown').toUpperCase(), 44), ANSI.red),
            paint(padLine('JAM', formatSendTime(), 44), ANSI.yellow)
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
