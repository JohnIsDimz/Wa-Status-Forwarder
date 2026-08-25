/**
 * Owner Mark: © joo.exe
 * Bot ini milik joo.exe.
 */

const { spawn } = require('child_process');
const path = require('path');

const BOT_FILE = path.join(__dirname, 'index.js');
const RESTART_DELAY_BASE_MS = 5000;
const MAX_RESTART_DELAY_MS = 30000;
const MAX_RESTARTS_PER_WINDOW = 5;
const RESTART_WINDOW_MS = 10 * 60 * 1000;
const HEALTHY_UPTIME_MS = 2 * 60 * 1000;
const FORCE_KILL_TIMEOUT_MS = 5000;
const EXIT_CODE_FATAL_CONFIG = 70;
const EXIT_CODE_FATAL_STORAGE = 71;
const NO_RESTART_EXIT_CODES = new Set([EXIT_CODE_FATAL_CONFIG, EXIT_CODE_FATAL_STORAGE]);
const EXIT_CODE_LABELS = {
    [EXIT_CODE_FATAL_CONFIG]: 'fatal_config',
    [EXIT_CODE_FATAL_STORAGE]: 'fatal_storage'
};

const NOISE_PATTERNS = [
    'Failed to decrypt message with any known session',
    'Session error:Error: Bad MAC',
    'Error: Bad MAC',
    'Decrypted message with closed session.',
    'Removing old closed session: SessionEntry',
    'at Object.verifyMAC',
    'at SessionCipher.',
    'at async _asyncQueueExecutor',
    'libsignal/src/session_cipher.js',
    'libsignal/src/crypto.js'
];

let child = null;
let stopping = false;
let restartTimes = [];
let childStartedAt = 0;

const ANSI = {
    reset: '\x1b[0m',
    bold: '\x1b[1m',
    red: '\x1b[31m',
    yellow: '\x1b[33m'
};

function paint(text, color) {
    return `${color}${text}${ANSI.reset}`;
}

function padLine(label, value, width = 44) {
    const normalizedLabel = `${label}:`;
    const safeValue = String(value || '').slice(0, Math.max(0, width - normalizedLabel.length - 1));
    const rawLine = `${normalizedLabel} ${safeValue}`;
    return rawLine + ' '.repeat(Math.max(0, width - rawLine.length));
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

function formatDisplayDateTime() {
    return `${new Date().toLocaleString('id-ID', {
        day: '2-digit', month: '2-digit', year: 'numeric',
        hour: '2-digit', minute: '2-digit', second: '2-digit',
        timeZone: 'Asia/Jakarta'
    })} WIB`;
}

function logError(message) {
    renderConsoleBox(' RUNNER ERROR ', ANSI.red, [
        paint(padLine('INFO', message, 44), ANSI.red),
        paint(padLine('WAKTU', formatDisplayDateTime(), 44), ANSI.yellow)
    ]);
}

function pruneRestartTimes() {
    const cutoff = Date.now() - RESTART_WINDOW_MS;
    restartTimes = restartTimes.filter((time) => time >= cutoff);
}

function canRestart() {
    pruneRestartTimes();
    return restartTimes.length < MAX_RESTARTS_PER_WINDOW;
}

function getRestartDelayMs() {
    pruneRestartTimes();
    const multiplier = Math.max(1, restartTimes.length);
    return Math.min(MAX_RESTART_DELAY_MS, RESTART_DELAY_BASE_MS * multiplier);
}

function recordHealthyUptime() {
    if (!childStartedAt) return;
    const uptime = Date.now() - childStartedAt;
    if (uptime >= HEALTHY_UPTIME_MS) {
        restartTimes = [];
    }
}

function scheduleRestart(reason) {
    if (stopping) return;

    recordHealthyUptime();

    if (!canRestart()) {
        logError(`Batas restart tercapai. Alasan terakhir: ${reason}`);
        process.exit(1);
    }

    restartTimes.push(Date.now());
    const delayMs = getRestartDelayMs();
    logError(`Bot restart dalam ${Math.ceil(delayMs / 1000)} detik. Alasan: ${reason}`);

    setTimeout(() => {
        if (!stopping) {
            startBot();
        }
    }, delayMs);
}

function shouldSuppressLine(line) {
    const text = String(line || '').trim();
    if (!text) return false;
    return NOISE_PATTERNS.some((pattern) => text.includes(pattern));
}

function shouldSuppressSessionBlockStart(line) {
    const text = String(line || '').trim();
    return text.includes('Closing session: SessionEntry')
        || text.includes('Removing old closed session: SessionEntry')
        || text === 'SessionEntry {';
}

function getBraceDelta(line) {
    const text = String(line || '');
    let delta = 0;
    for (const char of text) {
        if (char === '{') delta += 1;
        if (char === '}') delta -= 1;
    }
    return delta;
}

function pipeStream(stream, target) {
    let buffer = '';
    let suppressSessionBlock = false;
    let sessionBraceDepth = 0;

    stream.on('data', (chunk) => {
        buffer += chunk.toString();
        const lines = buffer.split(/\r?\n/);
        buffer = lines.pop() || '';

        for (const line of lines) {
            if (suppressSessionBlock) {
                sessionBraceDepth += getBraceDelta(line);
                if (sessionBraceDepth <= 0) {
                    suppressSessionBlock = false;
                    sessionBraceDepth = 0;
                }
                continue;
            }

            if (shouldSuppressSessionBlockStart(line)) {
                suppressSessionBlock = true;
                sessionBraceDepth = Math.max(1, getBraceDelta(line));
                continue;
            }

            if (!shouldSuppressLine(line)) {
                target.write(`${line}\n`);
            }
        }
    });

    stream.on('end', () => {
        if (!suppressSessionBlock && buffer && !shouldSuppressLine(buffer)) {
            target.write(`${buffer}\n`);
        }
    });
}

function startBot() {
    childStartedAt = Date.now();

    child = spawn(process.execPath, [BOT_FILE], {
        cwd: __dirname,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: process.env
    });

    pipeStream(child.stdout, process.stdout);
    pipeStream(child.stderr, process.stderr);

    child.on('exit', (code, signal) => {
        const reason = `exit code=${code} signal=${signal || '-'}`;
        child = null;
        if (stopping) return;
        if (NO_RESTART_EXIT_CODES.has(code)) {
            const label = EXIT_CODE_LABELS[code] || 'fatal_exit';
            logError(`Bot berhenti tanpa restart. Alasan: ${reason} | label=${label}`);
            process.exit(code || 0);
            return;
        }
        scheduleRestart(reason);
    });

    child.on('error', (error) => {
        child = null;
        if (stopping) return;
        scheduleRestart(`spawn error: ${error.message}`);
    });
}

function shutdown() {
    if (stopping) return;
    stopping = true;

    if (child) {
        child.kill('SIGTERM');
        setTimeout(() => {
            if (child) {
                child.kill('SIGKILL');
            }
            process.exit(0);
        }, FORCE_KILL_TIMEOUT_MS);
    } else {
        process.exit(0);
    }
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

startBot();
