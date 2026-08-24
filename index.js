let makeWASocket;
let useMultiFileAuthState;
let DisconnectReason;
let fetchLatestBaileysVersion;
let makeCacheableSignalKeyStore;
let downloadMediaMessage;
let Browsers;
let baileysLoadPromise;

async function loadBaileys() {
    if (!baileysLoadPromise) {
        baileysLoadPromise = import('@whiskeysockets/baileys').then((module) => {
            makeWASocket = module.default;
            useMultiFileAuthState = module.useMultiFileAuthState;
            DisconnectReason = module.DisconnectReason;
            fetchLatestBaileysVersion = module.fetchLatestBaileysVersion;
            makeCacheableSignalKeyStore = module.makeCacheableSignalKeyStore;
            downloadMediaMessage = module.downloadMediaMessage;
            Browsers = module.Browsers;
            return module;
        });
    }
    return baileysLoadPromise;
}

const { Boom } = require('@hapi/boom');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const pino = require('pino');
const NodeCache = require('node-cache');
const config = require('./config');
const { createConsoleHelpers } = require('./node');

let BetterSqlite3 = null;

try {
    BetterSqlite3 = require('better-sqlite3');
} catch {
    BetterSqlite3 = null;
}

const logger = pino({ level: 'silent' });
const msgRetryCounterCache = new NodeCache();

const AUTH_FOLDER = config.whatsapp?.authFolder || 'auth_info_baileys';
const PAIRING_PHONE_NUMBER = (() => {
    const raw = String(config.whatsapp?.phoneNumber || '').replace(/\D/g, '');
    if (!raw) return '';
    if (raw.startsWith('0')) return `62${raw.slice(1)}`;
    return raw;
})();
const PAIRING_PHONE_JID = PAIRING_PHONE_NUMBER ? `${PAIRING_PHONE_NUMBER}@s.whatsapp.net` : '';

function isValidPairingPhoneNumber(value) {
    if (!value) return false;
    if (!/^\d{10,15}$/.test(value)) return false;
    if (value.startsWith('0')) return false;
    return true;
}

const TELEGRAM_BOT_TOKEN = config.telegram?.botToken || '';
const TELEGRAM_CHAT_ID = config.telegram?.chatId || '';
const TELEGRAM_REQUEST_TIMEOUT_MS = Math.max(5000, Number(config.telegram?.requestTimeoutMs || 45000));
const TELEGRAM_MAX_RETRIES = Math.max(0, Number(config.telegram?.maxRetries || 2));
const TELEGRAM_FOOTER_TEXT = String(config.telegram?.footerText || '© By John');
const TELEGRAM_MEDIA_CAPTION_LIMIT = 1024;
const TELEGRAM_TEXT_LIMIT = 4096;

const OPERATIONS = config.operations || {};
const HEALTH_STORE_FILE = path.join(__dirname, OPERATIONS.healthStoreFile || 'healthcheck.json');
const METRICS_STORE_FILE = path.join(__dirname, OPERATIONS.metricsStoreFile || 'metrics.json');
const AUDIT_STORE_FILE = path.join(__dirname, OPERATIONS.auditStoreFile || 'audit-log.json');
const FAILED_JOBS_STORE_FILE = path.join(__dirname, OPERATIONS.failedJobStoreFile || 'failed-jobs.json');
const RUNTIME_STATE_FILE = path.join(__dirname, OPERATIONS.runtimeStateFile || 'runtime-state.json');
const SESSION_BACKUP_DIR = path.join(__dirname, OPERATIONS.sessionBackupDir || 'auth_backups');
const SESSION_BACKUP_INTERVAL_MS = Math.max(5 * 60 * 1000, Number(OPERATIONS.sessionBackupIntervalMinutes || 60) * 60 * 1000);
const DATABASE_RESET_HOUR_WIB = Number(OPERATIONS.databaseResetHourWib ?? 0);
const DATABASE_INTEGRITY_CHECK_INTERVAL_MS = Math.max(60 * 1000, Number(OPERATIONS.databaseIntegrityCheckMinutes || 10) * 60 * 1000);
const SIGNAL_AUDIT_INTERVAL_MS = Math.max(60 * 1000, Number(OPERATIONS.signalAuditIntervalMinutes || 10) * 60 * 1000);
const SQLITE_DOCUMENT_WRITE_DEBOUNCE_MS = Math.max(50, Number(OPERATIONS.sqliteDocumentWriteDebounceMs || 750));
const DAILY_SUMMARY_RETENTION_DAYS = Math.max(1, Number(OPERATIONS.dailySummaryRetentionDays || 30));
const DAILY_SUMMARY_MAX_FAILURES = Math.max(5, Number(OPERATIONS.dailySummaryMaxFailures || 50));
const RETRY_BASE_DELAY_MS = Math.max(100, Number(OPERATIONS.retryBaseDelayMs || 500));
const RETRY_MAX_DELAY_MS = Math.max(RETRY_BASE_DELAY_MS, Number(OPERATIONS.retryMaxDelayMs || 2500));
const SNAPSHOT_ON_CONNECT = OPERATIONS.snapshotOnConnect !== false;
const MAX_SESSION_BACKUPS = Math.max(1, Number(OPERATIONS.maxSessionBackups || 5));
const MAX_AUDIT_ENTRIES = Math.max(50, Number(OPERATIONS.maxAuditEntries || 300));
const MAX_FAILED_JOBS = Math.max(20, Number(OPERATIONS.maxFailedJobs || 200));

const CONSOLE_MODE = config.console?.mode || 'minimal';
const MINIMAL_CONSOLE = config.console?.minimal !== false;
const ULTRA_MINIMAL_CONSOLE = CONSOLE_MODE === 'ultra-minimal';
const SHOW_SEND_LOGS = config.console?.showSendLogs === true && !ULTRA_MINIMAL_CONSOLE;
const SHOW_LIKE_LOGS = config.console?.showLikeLogs === true && !ULTRA_MINIMAL_CONSOLE;
const SHOW_CALL_LOGS = config.console?.showCallLogs === true && !ULTRA_MINIMAL_CONSOLE;
const COLORIZE_CONSOLE = config.console?.colorize !== false;
const DISPLAY_TIME_ZONE = 'Asia/Jakarta';
const EXIT_CODE_FATAL_CONFIG = 70;
const EXIT_CODE_FATAL_STORAGE = 71;
const CONNECTION = config.connection || {};
const PRIVACY = CONNECTION.privacy || {};
const KEEP_ONLINE_ENABLED = CONNECTION.keepOnline === true;
const KEEP_ALIVE_INTERVAL_MS = Math.max(15000, Number(CONNECTION.keepAliveIntervalSeconds || 90) * 1000);
const RECONNECT_DELAY_MS = Math.max(3000, Number(CONNECTION.reconnectDelaySeconds || 6) * 1000);
const SYNC_FULL_HISTORY_ON_CONNECT = CONNECTION.syncFullHistoryOnConnect !== false;
const PENDING_NOTIFICATIONS_TIMEOUT_MS = Math.max(5000, Number(STATUS.pendingNotificationsTimeoutSeconds || CONNECTION.pendingNotificationsTimeoutSeconds || 20) * 1000);
const PRIVACY_HARDENING_ENABLED = PRIVACY.enabled !== false;
const PRIVACY_LAST_SEEN = String(PRIVACY.lastSeen || 'none');
const PRIVACY_ONLINE = String(PRIVACY.online || 'match_last_seen');
const PRIVACY_PROFILE_PHOTO = String(PRIVACY.profilePhoto || 'none');
const PRIVACY_STATUS = String(PRIVACY.status || 'none');
const PRIVACY_GROUP_ADD = String(PRIVACY.groupAdd || 'contacts');
const PRIVACY_READ_RECEIPTS = String(PRIVACY.readReceipts || 'none');

const ANTI_CALL = CONNECTION.antiCall || {};
const ANTI_CALL_ENABLED = ANTI_CALL.enabled !== false;
const ANTI_CALL_SET_PRIVACY = ANTI_CALL.setPrivacy !== false;
const ANTI_CALL_PRIVACY_MODE = ANTI_CALL.privacyMode || 'none';
const ANTI_CALL_REJECT_INCOMING = ANTI_CALL.rejectIncoming !== false;
const ANTI_CALL_REJECT_DELAY_MS = Math.max(0, Number(ANTI_CALL.rejectDelayMs || 0));
const ANTI_CALL_AUTO_BLOCK_CALLER = ANTI_CALL.autoBlockCaller === true;
const ANTI_CALL_BLOCK_DELAY_MS = Math.max(0, Number(ANTI_CALL.blockDelayMs || 0));
const ANTI_CALL_SEND_BUSY_MESSAGE = ANTI_CALL.sendBusyMessage === true;
const ANTI_CALL_NOTIFY_TELEGRAM = ANTI_CALL.notifyTelegram === true;
const ANTI_CALL_BUSY_MESSAGE = String(ANTI_CALL.busyMessage || 'Mohon maaf, panggilan WhatsApp tidak dapat kami terima. Silakan kirim pesan melalui chat.');
const ANTI_CALL_BUSY_MESSAGE_VOICE = String(ANTI_CALL.busyMessageVoice || ANTI_CALL_BUSY_MESSAGE || 'Mohon maaf, panggilan suara WhatsApp tidak dapat kami terima. Silakan kirim pesan melalui chat.');
const ANTI_CALL_BUSY_MESSAGE_VIDEO = String(ANTI_CALL.busyMessageVideo || ANTI_CALL_BUSY_MESSAGE || 'Mohon maaf, panggilan video WhatsApp tidak dapat kami terima. Silakan kirim pesan melalui chat.');
const BLOCKED_CALL_STORE_FILE = path.join(__dirname, ANTI_CALL.blockedCallStoreFile || 'blocked-callers.json');

const STATUS = config.statusForwarder || {};
const ALLOWED_MEDIA_TYPES = Array.isArray(STATUS.allowedMediaTypes)
    ? STATUS.allowedMediaTypes
    : ['image', 'video', 'audio', 'document', 'sticker'];
const AUTO_LIKE_STATUS = STATUS.autoLikeStatus !== false;
const AUTO_LIKE_EMOJI = String(STATUS.autoLikeEmoji || '🔥️');
const LIKE_RETRIES = Math.max(0, Number(STATUS.likeRetries || 1));
const POST_READ_LIKE_DELAY_MS = Math.max(0, Number(STATUS.postReadLikeDelaySeconds || 10) * 1000);
const DUPLICATE_RETENTION_HOURS = Number(STATUS.duplicateRetentionHours || 72);
const DUPLICATE_RETENTION_SECONDS = Math.max(3600, DUPLICATE_RETENTION_HOURS * 60 * 60);
const CONTACT_STORE_FILE = path.join(__dirname, STATUS.contactStoreFile || 'contact-store.json');
const STATUS_REFERENCE_STORE_FILE = path.join(__dirname, STATUS.statusReferenceStoreFile || 'status-reference-store.json');
const NOTIFY_STATUS_REFERENCES = STATUS.notifyStatusReferences === true;
const STRICT_BUFFER_HASH = STATUS.strictBufferHash !== false;
const NATURAL_VIEW_MODE = STATUS.naturalViewMode !== false;
const IMAGE_VIEW_MS = Math.max(1000, Number(STATUS.imageViewSeconds || 3) * 1000);
const STICKER_VIEW_MS = Math.max(1000, Number(STATUS.stickerViewSeconds || 2) * 1000);
const DOCUMENT_VIEW_MS = Math.max(1000, Number(STATUS.documentViewSeconds || 3) * 1000);
const AUDIO_VIEW_MS = Math.max(1000, Number(STATUS.audioViewSeconds || 4) * 1000);
const MIN_VIDEO_VIEW_MS = Math.max(1000, Number(STATUS.minVideoViewSeconds || 4) * 1000);
const MAX_VIDEO_VIEW_MS = Math.max(MIN_VIDEO_VIEW_MS, Number(STATUS.maxVideoViewSeconds || 10) * 1000);
const VIEW_JITTER_MS = Math.max(0, Number(STATUS.viewJitterSeconds || 1) * 1000);
const POST_READ_FORWARD_DELAY_MS = Math.max(0, Number(STATUS.postReadForwardDelayMs || 500));
const MIN_TASK_GAP_MS = Math.max(0, Number(STATUS.minTaskGapMs || 200));
const MAX_TASK_GAP_MS = Math.max(MIN_TASK_GAP_MS, Number(STATUS.maxTaskGapMs || 900));
const MAX_TOTAL_FORWARDS_PER_HOUR = Math.max(1, Number(STATUS.maxTotalForwardsPerHour || 500));
const MAX_CONTACT_FORWARDS_PER_HOUR = Math.max(1, Number(STATUS.maxForwardsPerContactPerHour || 100));
const SKIP_STATUSES_OLDER_THAN_MINUTES = Math.max(0, Number(STATUS.skipStatusesOlderThanMinutes || 0));
const PROCESS_SAVED_CONTACTS_ONLY = STATUS.processSavedContactsOnly === true;
const MAX_MEDIA_SIZE_MB = Math.max(1, Number(STATUS.maxMediaSizeMB || 32));
const DEBUG_STATUS_TYPE_DETECTION = STATUS.debugStatusTypeDetection === true;
const PRIORITIZE_FRESH_STATUSES = STATUS.prioritizeFreshStatuses !== false;
const FRESH_STATUS_WINDOW_SECONDS = Math.max(10, Number(STATUS.freshStatusWindowSeconds || 600));
const URGENT_TASK_GAP_MS = Math.max(0, Number(STATUS.urgentTaskGapMs || 0));
const URGENT_TASK_GAP_MAX_MS = Math.max(URGENT_TASK_GAP_MS, Number(STATUS.urgentTaskGapMaxMs || 120));
const FRESH_IMAGE_VIEW_MS = Math.max(1000, Number(STATUS.freshImageViewSeconds || 2) * 1000);
const FRESH_VIDEO_MIN_VIEW_MS = Math.max(1000, Number(STATUS.freshVideoMinViewSeconds || 3) * 1000);
const FRESH_VIDEO_MAX_VIEW_MS = Math.max(FRESH_VIDEO_MIN_VIEW_MS, Number(STATUS.freshVideoMaxViewSeconds || 8) * 1000);
const FRESH_OTHER_VIEW_MS = Math.max(1000, Number(STATUS.freshOtherViewSeconds || 2) * 1000);
const CAPTURE_FRESH_STATUSES_FAST = STATUS.captureFreshStatusesFast !== false;
const HISTORY_CAPTURE_ENABLED = STATUS.historyCaptureEnabled !== false;
const HISTORY_STATUS_MAX_AGE_MS = Math.max(60 * 60 * 1000, Number(STATUS.historyStatusMaxAgeHours || 24) * 60 * 60 * 1000);
const STATUS_MESSAGE_CACHE_LIMIT = Math.max(1000, Number(STATUS.messageCacheLimit || 5000));
const RECONNECT_QUEUE_RETENTION_MS = Math.max(60 * 1000, Number(STATUS.reconnectQueueRetentionMinutes || 30) * 60 * 1000);
const MESSAGE_UPDATE_FALLBACK = STATUS.messageUpdateFallback !== false;
const DOWNLOAD_RETRIES = Math.max(0, Number(STATUS.downloadRetries || 2));
const MAX_QUEUE_SIZE = Math.max(100, Number(STATUS.maxQueueSize || 2000));
const MAX_URGENT_QUEUE_SIZE = Math.max(10, Number(STATUS.maxUrgentQueueSize || 500));
const MAX_HISTORY_ENQUEUE_PER_SYNC = Math.max(10, Number(STATUS.maxHistoryEnqueuePerSync || 300));
const DE_DUPLICATE_PENDING_QUEUE = STATUS.deDuplicatePendingQueue !== false;
const STATUS_PARTICIPANT_PN_PRIORITY = STATUS.statusParticipantPnPriority !== false;
const STATUS_LIKE_FALLBACK_ENABLED = STATUS.statusLikeFallbackEnabled !== false;
const STATUS_LIKE_PARTICIPANT_FALLBACKS = Math.max(1, Number(STATUS.statusLikeParticipantFallbacks || 4));
const SKIP_FROM_ME_STATUSES = STATUS.skipFromMeStatuses !== false;
const CAPTION_MAX_LENGTH = Math.max(100, Number(STATUS.captionMaxLength || 1200));
const DETAIL_MAX_LENGTH = Math.max(60, Number(STATUS.detailMaxLength || 240));
const SOURCE_LABEL_MAX_LENGTH = Math.max(30, Number(STATUS.sourceLabelMaxLength || 120));
const STATUS_TASK_RETRY_ATTEMPTS = Math.max(0, Number(STATUS.statusTaskRetryAttempts || 1));
const STATUS_TASK_RETRY_DELAY_MS = Math.max(0, Number(STATUS.statusTaskRetryDelayMs || 1200));
const QUEUE_STALE_TASK_MS = Math.max(0, Number(STATUS.queueStaleTaskMinutes || 0) * 60 * 1000);
const RUNTIME_BUSY_QUEUE_THRESHOLD = Math.max(5, Number(STATUS.runtimeBusyQueueThreshold || 25));
const RUNTIME_BUSY_MAX_VIEW_DELAY_MS = Math.max(0, Number(STATUS.runtimeBusyMaxViewDelayMs || 1200));
const RUNTIME_BUSY_POST_READ_DELAY_MS = Math.max(0, Number(STATUS.runtimeBusyPostReadDelayMs || 0));
const STATUS_DATABASE_FILE = path.join(__dirname, STATUS.databaseFile || config.storage?.sqlite?.file || 'status-antispam.db');
const STATUS_DATABASE_WARM_CACHE_LIMIT = Math.max(0, Number(STATUS.databaseWarmCacheLimit || 5000));

const DAILY_STATUS_SUMMARY_RUNTIME_KEY = 'daily_status_summary_runtime';

const SQLITE_REDIRECT_STORE_BASENAMES = new Set([
    path.basename(CONTACT_STORE_FILE),
    path.basename(STATUS_REFERENCE_STORE_FILE),
    path.basename(BLOCKED_CALL_STORE_FILE),
    path.basename(HEALTH_STORE_FILE),
    path.basename(METRICS_STORE_FILE),
    path.basename(AUDIT_STORE_FILE),
    path.basename(FAILED_JOBS_STORE_FILE),
    path.basename(RUNTIME_STATE_FILE)
]);

const processedStatusCache = new NodeCache({ stdTTL: DUPLICATE_RETENTION_SECONDS, checkperiod: 600, useClones: false });
const contactForwardRateCache = new NodeCache({ stdTTL: 3600, checkperiod: 600, useClones: false });
const totalForwardRateCache = new NodeCache({ stdTTL: 3600, checkperiod: 600, useClones: false });

let pairingReminderInterval = null;
let presenceKeepAliveInterval = null;
let reconnectTimeout = null;
let sessionBackupInterval = null;
let storePruneInterval = null;
let databaseResetTimeout = null;
let signalAuditInterval = null;
let queueActive = false;
let lastPhoneNumber = null;
let telegramConfigWarned = false;
let antiSpamStorageWarned = false;
let antiSpamStorageInfoShown = false;
let antiSpamStorageFatalError = '';
let waConnectedOnce = false;
let waConnectionReady = false;
let pendingAntiSpamStorageInfoDetail = '';
let lastDatabaseIntegrityCheckAt = 0;
let startupBannerShown = false;
const processingFingerprints = new Set();
const processingStatusKeys = new Set();
const queuedStatusKeys = new Set();
const selfJids = new Set();
const selfNumbers = new Set();
const contactIndexByNumber = new Map();
const contactIndexByName = new Map();
let antiSpamDb = null;
let antiSpamStatements = null;
let sqliteDocumentWriteTimer = null;
let connectJob = null;
let activeSocket = null;
let activeSocketGeneration = 0;
let pendingNotificationsTimeout = null;
let waConnectionOpen = false;
const pendingSqliteDocumentWrites = new Map();
const pendingQueueRetryTimers = new Set();
const pendingPreConnectHistoryMessages = [];
const pendingPreConnectLiveMessages = [];
const pendingPreConnectUpdates = [];
const pendingReconnectStatusTasks = [];
const messageSnapshotCache = new Map();
const urgentStatusQueue = [];
const normalStatusQueue = [];

const consoleHelpers = createConsoleHelpers({
    colorize: COLORIZE_CONSOLE,
    timeZone: DISPLAY_TIME_ZONE,
    autoLikeEmoji: AUTO_LIKE_EMOJI,
    showSendLogs: SHOW_SEND_LOGS,
    showLikeLogs: SHOW_LIKE_LOGS,
    showCallLogs: SHOW_CALL_LOGS,
    ultraMinimal: ULTRA_MINIMAL_CONSOLE
});

const {
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
} = consoleHelpers;

function logAntiSpamStorageInfo(detail) {
    if (antiSpamStorageInfoShown) return;
    if (!waConnectedOnce) {
        pendingAntiSpamStorageInfoDetail = detail;
        return;
    }
    antiSpamStorageInfoShown = true;
    pendingAntiSpamStorageInfoDetail = '';
    logSystem('AI anti spam storage aktif', detail, 'ANTI SPAM', ANSI.green);
}

function flushPostConnectSystemMessages() {
    if (pendingAntiSpamStorageInfoDetail && !antiSpamStorageInfoShown) {
        logAntiSpamStorageInfo(pendingAntiSpamStorageInfoDetail);
    }
}

function warnAntiSpamStorage(detail) {
    if (antiSpamStorageWarned) return;
    antiSpamStorageWarned = true;
    logSystem('AI anti spam storage warning', detail, 'ANTI SPAM', ANSI.yellow);
}

function initAntiSpamStorage() {
    if (STATUS.useSqliteStore === false) {
        const reason = 'SQLite dimatikan di config';
        antiSpamStorageFatalError = reason;
        warnAntiSpamStorage(reason);
        return false;
    }

    if (!BetterSqlite3) {
        const reason = 'better-sqlite3 belum terpasang';
        antiSpamStorageFatalError = reason;
        warnAntiSpamStorage(reason);
        return false;
    }

    try {
        antiSpamDb = new BetterSqlite3(STATUS_DATABASE_FILE);
        if (STATUS.databaseWalMode !== false) {
            antiSpamDb.pragma('journal_mode = WAL');
        }
        antiSpamDb.pragma('synchronous = NORMAL');
        antiSpamDb.pragma('temp_store = MEMORY');
        antiSpamDb.pragma('cache_size = -16000');

        antiSpamDb.exec(`
            CREATE TABLE IF NOT EXISTS processed_status_fingerprints (
                fingerprint TEXT PRIMARY KEY,
                processed_at INTEGER NOT NULL,
                participant TEXT,
                type TEXT,
                message_id TEXT,
                display_name TEXT,
                owner_mark TEXT DEFAULT '© By John'
            );
            CREATE INDEX IF NOT EXISTS idx_processed_status_fingerprints_processed_at
            ON processed_status_fingerprints (processed_at);

            CREATE TABLE IF NOT EXISTS processed_status_records (
                status_primary_key TEXT PRIMARY KEY,
                processed_at INTEGER NOT NULL,
                participant TEXT,
                remote_jid TEXT,
                chat_scope TEXT,
                source_type TEXT,
                media_type TEXT,
                message_id TEXT,
                content_signature TEXT,
                display_name TEXT,
                owner_mark TEXT DEFAULT '© By John'
            );
            CREATE INDEX IF NOT EXISTS idx_processed_status_records_processed_at
            ON processed_status_records (processed_at);
            CREATE INDEX IF NOT EXISTS idx_processed_status_records_message_id
            ON processed_status_records (message_id);
            CREATE UNIQUE INDEX IF NOT EXISTS idx_processed_status_records_remote_message_unique
            ON processed_status_records (remote_jid, message_id)
            WHERE remote_jid IS NOT NULL AND remote_jid <> '' AND message_id IS NOT NULL AND message_id <> '';
            CREATE UNIQUE INDEX IF NOT EXISTS idx_processed_status_records_participant_message_type_unique
            ON processed_status_records (participant, message_id, media_type)
            WHERE participant IS NOT NULL AND participant <> '' AND message_id IS NOT NULL AND message_id <> '';
            CREATE UNIQUE INDEX IF NOT EXISTS idx_processed_status_records_content_signature_unique
            ON processed_status_records (content_signature)
            WHERE content_signature IS NOT NULL AND content_signature <> '';

            CREATE TABLE IF NOT EXISTS kv_store (
                store_key TEXT PRIMARY KEY,
                value TEXT NOT NULL,
                updated_at INTEGER NOT NULL,
                owner_mark TEXT DEFAULT '© By John'
            );
            CREATE INDEX IF NOT EXISTS idx_kv_store_updated_at
            ON kv_store (updated_at);

            CREATE TABLE IF NOT EXISTS daily_status_reports (
                day_key TEXT PRIMARY KEY,
                generated_at INTEGER NOT NULL,
                summary_json TEXT NOT NULL,
                owner_mark TEXT DEFAULT '© By John'
            );
            CREATE INDEX IF NOT EXISTS idx_daily_status_reports_generated_at
            ON daily_status_reports (generated_at);
        `);

        try {
            antiSpamDb.exec('ALTER TABLE processed_status_records ADD COLUMN content_signature TEXT');
        } catch {
            // kolom sudah ada
        }

        antiSpamStatements = {
            hasFingerprint: antiSpamDb.prepare('SELECT 1 FROM processed_status_fingerprints WHERE fingerprint = ? LIMIT 1'),
            hasStatusRecord: antiSpamDb.prepare('SELECT 1 FROM processed_status_records WHERE status_primary_key = ? LIMIT 1'),
            insertFingerprint: antiSpamDb.prepare(`
                INSERT OR REPLACE INTO processed_status_fingerprints (
                    fingerprint,
                    processed_at,
                    participant,
                    type,
                    message_id,
                    display_name,
                    owner_mark
                ) VALUES (?, ?, ?, ?, ?, ?, '© By John')
            `),
            upsertStatusRecord: antiSpamDb.prepare(`
                INSERT OR REPLACE INTO processed_status_records (
                    status_primary_key,
                    processed_at,
                    participant,
                    remote_jid,
                    chat_scope,
                    source_type,
                    media_type,
                    message_id,
                    content_signature,
                    display_name,
                    owner_mark
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '© By John')
            `),
            getStatusRecord: antiSpamDb.prepare(`
                SELECT status_primary_key, processed_at, participant, remote_jid, chat_scope, source_type, media_type, message_id, content_signature, display_name
                FROM processed_status_records
                WHERE status_primary_key = ?
                LIMIT 1
            `),
            findStatusRecordByRemoteMessage: antiSpamDb.prepare(`
                SELECT status_primary_key, processed_at, participant, remote_jid, chat_scope, source_type, media_type, message_id, content_signature, display_name
                FROM processed_status_records
                WHERE remote_jid = ? AND message_id = ?
                LIMIT 1
            `),
            findStatusRecordByParticipantMessageType: antiSpamDb.prepare(`
                SELECT status_primary_key, processed_at, participant, remote_jid, chat_scope, source_type, media_type, message_id, content_signature, display_name
                FROM processed_status_records
                WHERE participant = ? AND message_id = ? AND media_type = ?
                LIMIT 1
            `),
            findStatusRecordByContentSignature: antiSpamDb.prepare(`
                SELECT status_primary_key, processed_at, participant, remote_jid, chat_scope, source_type, media_type, message_id, content_signature, display_name
                FROM processed_status_records
                WHERE content_signature = ?
                LIMIT 1
            `),
            deleteOlderThan: antiSpamDb.prepare('DELETE FROM processed_status_fingerprints WHERE processed_at < ?'),
            deleteStatusRecordsOlderThan: antiSpamDb.prepare('DELETE FROM processed_status_records WHERE processed_at < ?'),
            selectRecent: antiSpamDb.prepare(`
                SELECT fingerprint, processed_at
                FROM processed_status_fingerprints
                ORDER BY processed_at DESC
                LIMIT ?
            `),
            selectIntegrityRows: antiSpamDb.prepare(`
                SELECT rowid, fingerprint, processed_at, participant, type, message_id, display_name
                FROM processed_status_fingerprints
                ORDER BY processed_at DESC, rowid DESC
            `),
            selectIntegrityStatusRows: antiSpamDb.prepare(`
                SELECT rowid, status_primary_key, processed_at, participant, remote_jid, chat_scope, source_type, media_type, message_id, content_signature, display_name
                FROM processed_status_records
                ORDER BY processed_at DESC, rowid DESC
            `),
            updateFingerprintRow: antiSpamDb.prepare(`
                UPDATE processed_status_fingerprints
                SET participant = ?, type = ?, message_id = ?, display_name = ?
                WHERE rowid = ?
            `),
            updateStatusRecordRow: antiSpamDb.prepare(`
                UPDATE processed_status_records
                SET participant = ?, remote_jid = ?, chat_scope = ?, source_type = ?, media_type = ?, message_id = ?, content_signature = ?, display_name = ?
                WHERE rowid = ?
            `),
            deleteFingerprintRow: antiSpamDb.prepare('DELETE FROM processed_status_fingerprints WHERE rowid = ?'),
            deleteStatusRecordRow: antiSpamDb.prepare('DELETE FROM processed_status_records WHERE rowid = ?'),
            getDocument: antiSpamDb.prepare('SELECT value FROM kv_store WHERE store_key = ? LIMIT 1'),
            setDocument: antiSpamDb.prepare(`
                INSERT OR REPLACE INTO kv_store (
                    store_key,
                    value,
                    updated_at,
                    owner_mark
                ) VALUES (?, ?, ?, '© By John')
            `),
            upsertDailyStatusReport: antiSpamDb.prepare(`
                INSERT OR REPLACE INTO daily_status_reports (
                    day_key,
                    generated_at,
                    summary_json,
                    owner_mark
                ) VALUES (?, ?, ?, '© By John')
            `),
            deleteOldDailyStatusReports: antiSpamDb.prepare('DELETE FROM daily_status_reports WHERE generated_at < ?'),
            countFingerprints: antiSpamDb.prepare('SELECT COUNT(*) AS total FROM processed_status_fingerprints'),
            countStatusRecords: antiSpamDb.prepare('SELECT COUNT(*) AS total FROM processed_status_records'),
            countDocuments: antiSpamDb.prepare('SELECT COUNT(*) AS total FROM kv_store'),
            countDailyStatusReports: antiSpamDb.prepare('SELECT COUNT(*) AS total FROM daily_status_reports'),
            clearFingerprints: antiSpamDb.prepare('DELETE FROM processed_status_fingerprints'),
            clearStatusRecords: antiSpamDb.prepare('DELETE FROM processed_status_records'),
            clearDocuments: antiSpamDb.prepare('DELETE FROM kv_store')
        };

        antiSpamStatements.insertFingerprintMany = antiSpamDb.transaction((rows = []) => {
            for (const row of rows) {
                antiSpamStatements.insertFingerprint.run(
                    row.fingerprint,
                    row.processedAt,
                    row.participant,
                    row.type,
                    row.messageId,
                    row.displayName
                );
            }
        });

        antiSpamStatements.writeStatusPacket = antiSpamDb.transaction((statusRecord, fingerprintRows = []) => {
            antiSpamStatements.upsertStatusRecord.run(
                statusRecord.statusPrimaryKey,
                statusRecord.processedAt,
                statusRecord.participant,
                statusRecord.remoteJid,
                statusRecord.chatScope,
                statusRecord.sourceType,
                statusRecord.mediaType,
                statusRecord.messageId,
                statusRecord.contentSignature,
                statusRecord.displayName
            );

            for (const row of fingerprintRows) {
                antiSpamStatements.insertFingerprint.run(
                    row.fingerprint,
                    row.processedAt,
                    row.participant,
                    row.type,
                    row.messageId,
                    row.displayName
                );
            }
        });

        logAntiSpamStorageInfo(`${String(STATUS.antiSpamMode || 'ai-analyzer')} | ${path.basename(STATUS_DATABASE_FILE)}`);
        return true;
    } catch (error) {
        antiSpamDb = null;
        antiSpamStatements = null;
        antiSpamStorageFatalError = error?.message || 'sqlite_init_failed';
        warnAntiSpamStorage(antiSpamStorageFatalError);
        return false;
    }
}

function hasAntiSpamSqlite() {
    return Boolean(antiSpamDb && antiSpamStatements);
}

function antiSpamHasFingerprint(fingerprint) {
    if (!fingerprint || !hasAntiSpamSqlite()) return false;
    try {
        return Boolean(
            antiSpamStatements.hasFingerprint.get(fingerprint)
            || antiSpamStatements.hasStatusRecord.get(fingerprint)
        );
    } catch (error) {
        warnAntiSpamStorage(error?.message || 'sqlite_read_failed');
        return false;
    }
}

async function analyzeAiAntiSpam(fingerprints = []) {
    const uniqueFingerprints = [...new Set((Array.isArray(fingerprints) ? fingerprints : []).filter(Boolean))];
    for (const fingerprint of uniqueFingerprints) {
        if (processingStatusKeys.has(fingerprint) || processingFingerprints.has(fingerprint)) {
            return { exists: true, source: 'processing', fingerprint };
        }
        if (processedStatusCache.has(fingerprint)) {
            return { exists: true, source: 'cache', fingerprint };
        }
        if (antiSpamHasFingerprint(fingerprint)) {
            return { exists: true, source: 'sqlite', fingerprint };
        }
    }
    return { exists: false, source: 'none', fingerprint: '' };
}

function buildStatusRecordProbe(msg, participant, mediaInfo, identity = null) {
    const normalizedParticipant = normalizeStorageIdentity(participant || '').value;
    const normalizedRemoteJid = normalizeStorageIdentity(msg?.key?.remoteJid || '').value;
    const normalizedMessageId = normalizeStorageString(msg?.key?.id || '', 255);
    const normalizedMediaType = normalizeStorageString(mediaInfo?.type || '', 50);
    const normalizedSourceType = normalizeStorageString(mediaInfo?.sourceType || '', 50);
    const normalizedChatScope = normalizeStorageString(detectMessageScope(msg), 50);
    const normalizedDisplayName = normalizeStorageString(identity?.displayName || '', 255);
    const normalizedContentSignature = normalizeStorageString(buildStatusContentSignature(msg, participant, mediaInfo), 255);

    return {
        participant: normalizedParticipant,
        remoteJid: normalizedRemoteJid,
        messageId: normalizedMessageId,
        mediaType: normalizedMediaType,
        sourceType: normalizedSourceType,
        chatScope: normalizedChatScope,
        displayName: normalizedDisplayName,
        contentSignature: normalizedContentSignature
    };
}

function findExistingStatusRecord(statusPrimaryKey, probe = {}) {
    if (!hasAntiSpamSqlite()) return null;

    try {
        if (statusPrimaryKey) {
            const byPrimaryKey = antiSpamStatements.getStatusRecord.get(statusPrimaryKey);
            if (byPrimaryKey) return byPrimaryKey;
        }

        if (probe.remoteJid && probe.messageId) {
            const byRemoteMessage = antiSpamStatements.findStatusRecordByRemoteMessage.get(probe.remoteJid, probe.messageId);
            if (byRemoteMessage) return byRemoteMessage;
        }

        if (probe.participant && probe.messageId && probe.mediaType) {
            const byParticipantMessageType = antiSpamStatements.findStatusRecordByParticipantMessageType.get(
                probe.participant,
                probe.messageId,
                probe.mediaType
            );
            if (byParticipantMessageType) return byParticipantMessageType;
        }

        if (probe.contentSignature) {
            const byContentSignature = antiSpamStatements.findStatusRecordByContentSignature.get(probe.contentSignature);
            if (byContentSignature) return byContentSignature;
        }
    } catch (error) {
        warnAntiSpamStorage(error?.message || 'sqlite_find_status_record_failed');
    }

    return null;
}

function flushPendingSqliteDocumentWrites() {
    if (!hasAntiSpamSqlite() || pendingSqliteDocumentWrites.size === 0) {
        return;
    }

    const entries = [...pendingSqliteDocumentWrites.entries()];
    pendingSqliteDocumentWrites.clear();
    if (sqliteDocumentWriteTimer) {
        clearTimeout(sqliteDocumentWriteTimer);
        sqliteDocumentWriteTimer = null;
    }

    for (const [sqliteKey, payload] of entries) {
        antiSpamStatements.setDocument.run(sqliteKey, JSON.stringify(payload), Date.now());
    }
}

function schedulePendingSqliteDocumentWrites() {
    if (sqliteDocumentWriteTimer || !hasAntiSpamSqlite()) {
        return;
    }
    sqliteDocumentWriteTimer = setTimeout(() => {
        sqliteDocumentWriteTimer = null;
        try {
            flushPendingSqliteDocumentWrites();
        } catch (error) {
            warnAntiSpamStorage(error?.message || 'sqlite_document_flush_failed');
        }
    }, SQLITE_DOCUMENT_WRITE_DEBOUNCE_MS);
}

function clearPendingSqliteDocumentWrites() {
    pendingSqliteDocumentWrites.clear();
    if (sqliteDocumentWriteTimer) {
        clearTimeout(sqliteDocumentWriteTimer);
        sqliteDocumentWriteTimer = null;
    }
}

function readSqliteKvJson(storeKey, fallbackValue) {
    if (!hasAntiSpamSqlite()) return fallbackValue;
    try {
        if (pendingSqliteDocumentWrites.has(storeKey)) {
            return pendingSqliteDocumentWrites.get(storeKey);
        }
        const row = antiSpamStatements.getDocument.get(storeKey);
        if (row?.value) {
            return JSON.parse(row.value);
        }
    } catch (error) {
        warnAntiSpamStorage(error?.message || 'sqlite_runtime_doc_read_failed');
    }
    return fallbackValue;
}

function writeSqliteKvJson(storeKey, data, immediate = false) {
    if (!hasAntiSpamSqlite()) return;
    pendingSqliteDocumentWrites.set(storeKey, data);
    if (immediate) {
        flushPendingSqliteDocumentWrites();
        return;
    }
    schedulePendingSqliteDocumentWrites();
}

function getCurrentWibDayKey() {
    return getCurrentWibClock().dayKey;
}

function createEmptyDailyStatusSummary(dayKey = getCurrentWibDayKey()) {
    return {
        dayKey,
        generatedAt: null,
        totals: {
            detected: 0,
            forwarded: 0,
            failed: 0,
            image: 0,
            video: 0,
            audio: 0,
            document: 0,
            sticker: 0,
            text: 0,
            other: 0
        },
        uploaders: {},
        failures: [],
        updatedAt: new Date().toISOString()
    };
}

function loadCurrentDailyStatusSummary() {
    const fallback = createEmptyDailyStatusSummary();
    const data = readSqliteKvJson(DAILY_STATUS_SUMMARY_RUNTIME_KEY, fallback);
    if (!data || typeof data !== 'object') return fallback;
    if (!data.dayKey) data.dayKey = fallback.dayKey;
    if (!data.totals || typeof data.totals !== 'object') data.totals = { ...fallback.totals };
    if (!data.uploaders || typeof data.uploaders !== 'object') data.uploaders = {};
    if (!Array.isArray(data.failures)) data.failures = [];
    return data;
}

function saveCurrentDailyStatusSummary(summary, immediate = false) {
    summary.updatedAt = new Date().toISOString();
    writeSqliteKvJson(DAILY_STATUS_SUMMARY_RUNTIME_KEY, summary, immediate);
}

function getUploaderSummaryKey(identity) {
    return normalizeStorageString(identity?.preferredJid || identity?.jid || identity?.number || identity?.displayName || 'unknown', 255);
}

function ensureDailySummaryForCurrentDay() {
    const currentDayKey = getCurrentWibDayKey();
    const summary = loadCurrentDailyStatusSummary();
    if (summary.dayKey !== currentDayKey) {
        return createEmptyDailyStatusSummary(currentDayKey);
    }
    return summary;
}

function trackDailyStatusSuccess(identity, mediaInfo) {
    const summary = ensureDailySummaryForCurrentDay();
    summary.totals.detected += 1;
    summary.totals.forwarded += 1;
    const mediaType = String(mediaInfo?.type || 'other').toLowerCase();
    if (Object.prototype.hasOwnProperty.call(summary.totals, mediaType)) summary.totals[mediaType] += 1;
    else summary.totals.other += 1;

    const uploaderKey = getUploaderSummaryKey(identity);
    const uploader = summary.uploaders[uploaderKey] || {
        id: identity?.preferredJid || identity?.jid || identity?.number || '-',
        displayName: identity?.displayName || '-',
        total: 0,
        types: {}
    };
    uploader.total += 1;
    uploader.types[mediaType] = Number(uploader.types[mediaType] || 0) + 1;
    summary.uploaders[uploaderKey] = uploader;
    saveCurrentDailyStatusSummary(summary);
}

function trackDailyStatusFailure(identity, mediaInfo, msg, error) {
    const summary = ensureDailySummaryForCurrentDay();
    summary.totals.failed += 1;
    const mediaType = String(mediaInfo?.type || 'other').toLowerCase();
    summary.failures.push({
        time: new Date().toISOString(),
        displayName: identity?.displayName || '-',
        id: identity?.preferredJid || identity?.jid || identity?.number || '-',
        mediaType,
        messageId: msg?.key?.id || '',
        reason: String(error?.message || error || '').slice(0, 300)
    });
    if (summary.failures.length > DAILY_SUMMARY_MAX_FAILURES) {
        summary.failures.splice(0, summary.failures.length - DAILY_SUMMARY_MAX_FAILURES);
    }
    saveCurrentDailyStatusSummary(summary);
}

function buildDailyStatusSummaryReport(summary) {
    const uploaders = Object.values(summary?.uploaders || {}).sort((a, b) => Number(b.total || 0) - Number(a.total || 0));
    return {
        dayKey: summary?.dayKey || getCurrentWibDayKey(),
        generatedAt: new Date().toISOString(),
        totals: summary?.totals || createEmptyDailyStatusSummary().totals,
        topUploader: uploaders[0] || null,
        topUploaders: uploaders.slice(0, 5),
        failures: Array.isArray(summary?.failures) ? summary.failures.slice(-10) : []
    };
}

function clearQueueRetryTimers() {
    for (const timer of pendingQueueRetryTimers) {
        clearTimeout(timer);
    }
    pendingQueueRetryTimers.clear();
}

function closeAntiSpamStorage() {
    try {
        flushPendingSqliteDocumentWrites();
    } catch {
        // ignore flush errors during close
    }
    if (!antiSpamDb) return;
    try {
        antiSpamDb.close();
    } catch {
        // ignore close errors
    }
    antiSpamDb = null;
    antiSpamStatements = null;
}

function runDailyDatabaseReset(reason = 'scheduled', dayKeyOverride = '') {
    const dayKey = dayKeyOverride || getCurrentWibClock().dayKey;
    const startedAt = Date.now();
    let fingerprintRowsCleared = 0;
    let statusRecordRowsCleared = 0;
    let documentRowsCleared = 0;
    const dailySummary = buildDailyStatusSummaryReport(loadCurrentDailyStatusSummary());

    try {
        if (hasAntiSpamSqlite()) {
            flushPendingSqliteDocumentWrites();
            antiSpamStatements.upsertDailyStatusReport.run(
                dailySummary.dayKey,
                Date.now(),
                JSON.stringify(dailySummary)
            );
            antiSpamStatements.deleteOldDailyStatusReports.run(
                Date.now() - (DAILY_SUMMARY_RETENTION_DAYS * 24 * 60 * 60 * 1000)
            );
            fingerprintRowsCleared = Number(antiSpamStatements.countFingerprints.get()?.total || 0);
            statusRecordRowsCleared = Number(antiSpamStatements.countStatusRecords.get()?.total || 0);
            documentRowsCleared = Number(antiSpamStatements.countDocuments.get()?.total || 0);
            antiSpamStatements.clearFingerprints.run();
            antiSpamStatements.clearStatusRecords.run();
            antiSpamStatements.clearDocuments.run();
            clearPendingSqliteDocumentWrites();
            try {
                antiSpamDb.pragma('wal_checkpoint(TRUNCATE)');
            } catch {
                // ignore checkpoint errors
            }
            try {
                antiSpamDb.pragma('optimize');
            } catch {
                // ignore optimize errors
            }
            try {
                antiSpamDb.exec('VACUUM');
            } catch {
                // ignore vacuum errors
            }
        }

        contactStore.contacts = {};
        rebuildContactIndexes();
        statusReferenceStore.pendingRefs = {};
        statusReferenceStore.resolvedRefs = {};
        blockedCallStore.callers = {};
                healthStore.queue = { urgent: 0, normal: 0, total: 0 };
        healthStore.lastStatusReceivedAt = null;
        healthStore.lastStatusForwardedAt = null;
        healthStore.lastTelegramSuccessAt = null;
        healthStore.lastErrorAt = null;
        healthStore.lastErrorMessage = '';
        healthStore.lastDatabaseResetDay = dayKey;
        healthStore.lastDatabaseResetAt = new Date().toISOString();
        metricsStore.statusDetected = 0;
        metricsStore.statusForwarded = 0;
        metricsStore.statusLiked = 0;
        metricsStore.statusSkipped = 0;
        metricsStore.statusDuplicateSkipped = 0;
        metricsStore.statusFromMeSkipped = 0;
        metricsStore.statusRetried = 0;
        metricsStore.statusHistorySkippedOld = 0;
        metricsStore.statusSignalUpdatesRecovered = 0;
        metricsStore.statusReconnectRequeued = 0;
        metricsStore.statusQueueStaleSkipped = 0;
        metricsStore.statusReferencesCaptured = 0;
        metricsStore.statusReferencesResolved = 0;
        metricsStore.telegramSent = 0;
        metricsStore.telegramRetried = 0;
        metricsStore.downloadRetried = 0;
        metricsStore.likeRetried = 0;
        metricsStore.likeFallbackUsed = 0;
        metricsStore.likeFailed = 0;
        metricsStore.operationalSnapshots = 0;
        metricsStore.storePrunes = 0;
        metricsStore.callsRejected = 0;
        metricsStore.callsBlocked = 0;
        metricsStore.reconnects = 0;
        metricsStore.queueDrops = 0;
        auditStore.entries = [];
        failedJobStore.jobs = [];
        processedStatusCache.flushAll();
        contactForwardRateCache.flushAll();
        totalForwardRateCache.flushAll();
        messageSnapshotCache.clear();
        processingFingerprints.clear();
        processingStatusKeys.clear();
        clearQueuedStatusTasks('daily_database_reset');
        saveHealthStore();
        flushPendingSqliteDocumentWrites();
        const durationMs = Date.now() - startedAt;
        logSystem('Databese berhasil di riset ulang', reason, 'STORAGE', ANSI.yellow);
        if (!ULTRA_MINIMAL_CONSOLE) {
            logDailySummary(dailySummary);
            logDatabaseResetReport({
                fingerprintRowsCleared,
                statusRecordRowsCleared,
                documentRowsCleared,
                durationMs,
                reason
            });
        }
    } catch (error) {
        logError('Storage reset', error?.message || String(error));
    }
}

function normalizeJid(value) {
    const raw = String(value || '').trim();
    if (!raw) return '';
    const [left, domain = 's.whatsapp.net'] = raw.split('@');
    const base = left.split(':')[0];
    return `${base}@${domain}`;
}

function normalizeStorageString(value, maxLength = 255) {
    const text = String(value || '').replace(/\s+/g, ' ').trim();
    if (!text) return '';
    return text.slice(0, maxLength);
}

function normalizeStorageIdentity(value) {
    const normalized = normalizeJid(value);
    if (!normalized) {
        return { value: '', kind: 'unknown' };
    }

    const domain = getJidDomain(normalized);
    if (domain === 'newsletter') {
        return { value: normalized, kind: 'newsletter' };
    }
    if (domain === 'g.us') {
        return { value: normalized, kind: 'group' };
    }
    if (domain === 'broadcast') {
        return { value: normalized, kind: 'broadcast' };
    }
    if (domain === 's.whatsapp.net') {
        const phoneNumber = getNumberFromJid(normalized);
        if (/^\d{5,20}$/.test(phoneNumber)) {
            return { value: `${phoneNumber}@s.whatsapp.net`, kind: 'phone' };
        }
        return { value: normalized, kind: 'phone' };
    }
    return { value: normalized, kind: domain || 'unknown' };
}

function getNumberFromJid(jid) {
    const normalized = normalizeJid(jid);
    return normalized ? normalized.split('@')[0] : '';
}

function normalizeDetailText(value, maxLength = DETAIL_MAX_LENGTH) {
    const text = String(value || '').replace(/\s+/g, ' ').trim();
    if (!text) return '';
    return truncateText(text, maxLength);
}

function formatSourceLabel(mediaInfo, msg = null) {
    if (!mediaInfo) return '';

    if (mediaInfo.sourceType === 'newsletter') {
        const newsletterName = normalizeDetailText(mediaInfo.sourceName || 'Saluran', SOURCE_LABEL_MAX_LENGTH);
        const newsletterJid = normalizeJid(mediaInfo.sourceJid || '');
        return truncateText(
            newsletterJid ? `${newsletterName} (${newsletterJid})` : newsletterName,
            SOURCE_LABEL_MAX_LENGTH
        );
    }

    const sourceJid = normalizeJid(mediaInfo.sourceJid || mediaInfo.authorJid || '');
    if (sourceJid) {
        const sourceIdentity = resolveContactIdentity(sourceJid, msg || { pushName: mediaInfo.sourceName || '' });
        const displayName = normalizeDetailText(mediaInfo.sourceName || sourceIdentity.displayName || sourceJid, SOURCE_LABEL_MAX_LENGTH);
        if (displayName && displayName !== sourceJid) {
            return truncateText(`${displayName} (${sourceJid})`, SOURCE_LABEL_MAX_LENGTH);
        }
        return truncateText(displayName || sourceJid, SOURCE_LABEL_MAX_LENGTH);
    }

    return truncateText(normalizeDetailText(mediaInfo.sourceName || mediaInfo.sourceType || '', SOURCE_LABEL_MAX_LENGTH), SOURCE_LABEL_MAX_LENGTH);
}

function formatTelegramSourceLabel(mediaInfo, msg = null) {
    if (!mediaInfo) return '';

    if (mediaInfo.sourceType === 'newsletter') {
        return truncateText(
            normalizeDetailText(mediaInfo.sourceName || 'Saluran', SOURCE_LABEL_MAX_LENGTH),
            SOURCE_LABEL_MAX_LENGTH
        );
    }

    if (mediaInfo.sourceType === 'group_status' || mediaInfo.sourceType === 'status_reshare') {
        const sourceJid = normalizeJid(mediaInfo.sourceJid || mediaInfo.authorJid || '');
        if (mediaInfo.sourceName) {
            return truncateText(normalizeDetailText(mediaInfo.sourceName, SOURCE_LABEL_MAX_LENGTH), SOURCE_LABEL_MAX_LENGTH);
        }
        if (sourceJid) {
            const sourceIdentity = resolveContactIdentity(sourceJid, msg || { pushName: '' });
            return truncateText(
                normalizeDetailText(sourceIdentity.displayName || sourceIdentity.savedName || sourceIdentity.profileName || '', SOURCE_LABEL_MAX_LENGTH),
                SOURCE_LABEL_MAX_LENGTH
            );
        }
    }

    return formatSourceLabel(mediaInfo, msg);
}

function registerSelfIdentity(value) {
    const jid = normalizeJid(value);
    if (jid) selfJids.add(jid);
    const number = getNumberFromJid(jid || value);
    if (number) selfNumbers.add(number);
}

function isSelfJid(jid) {
    const normalized = normalizeJid(jid);
    if (!normalized) return false;
    if (selfJids.has(normalized)) return true;
    const number = getNumberFromJid(normalized);
    return Boolean(number && selfNumbers.has(number));
}

function isTransientError(error) {
    const text = String(error?.message || error || '').toLowerCase();
    if (!text) return false;
    return [
        'timed out',
        'timeout',
        'network',
        'socket hang up',
        'econnreset',
        'etimedout',
        'fetch failed',
        'aborted',
        '429',
        '500',
        '502',
        '503',
        '504',
        'connection closed',
        'stream errored',
        'media upload failed',
        'media download failed',
        'not-authorized'
    ].some((snippet) => text.includes(snippet));
}

function randomBetween(min, max) {
    if (max <= min) return min;
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function getSqliteDocumentStoreKey(filePath) {
    const baseName = path.basename(filePath || '');
    if (!baseName) return '';
    return SQLITE_REDIRECT_STORE_BASENAMES.has(baseName) ? baseName : '';
}

function readJsonFileFromDisk(filePath, fallbackValue) {
    if (!fs.existsSync(filePath)) return fallbackValue;
    try {
        return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch (error) {
        logError(`Read ${path.basename(filePath)}`, error.message);
        return fallbackValue;
    }
}

function writeJsonFileToDisk(filePath, data) {
    const tempFile = `${filePath}.tmp`;
    fs.writeFileSync(tempFile, JSON.stringify(data, null, 2), 'utf8');
    fs.renameSync(tempFile, filePath);
}

function readJsonFile(filePath, fallbackValue) {
    const sqliteKey = getSqliteDocumentStoreKey(filePath);
    if (sqliteKey) {
        if (!hasAntiSpamSqlite()) {
            return fallbackValue;
        }
        try {
            if (pendingSqliteDocumentWrites.has(sqliteKey)) {
                return pendingSqliteDocumentWrites.get(sqliteKey);
            }
            const row = antiSpamStatements.getDocument.get(sqliteKey);
            if (row?.value) {
                return JSON.parse(row.value);
            }
            return fallbackValue;
        } catch (error) {
            warnAntiSpamStorage(error?.message || 'sqlite_document_read_failed');
            return fallbackValue;
        }
    }

    return readJsonFileFromDisk(filePath, fallbackValue);
}

function writeJsonFile(filePath, data) {
    const sqliteKey = getSqliteDocumentStoreKey(filePath);
    if (sqliteKey) {
        if (!hasAntiSpamSqlite()) {
            throw new Error('sqlite_document_write_unavailable');
        }
        try {
            pendingSqliteDocumentWrites.set(sqliteKey, data);
            schedulePendingSqliteDocumentWrites();
            return;
        } catch (error) {
            warnAntiSpamStorage(error?.message || 'sqlite_document_write_failed');
            return;
        }
    }

    writeJsonFileToDisk(filePath, data);
}

function parseTimestampSeconds(value) {
    if (typeof value === 'number') return value;
    if (typeof value === 'string') return Number(value) || 0;
    if (typeof value === 'bigint') return Number(value);
    if (value && typeof value === 'object') {
        if (typeof value.low === 'number') return value.low;
        if (typeof value.toNumber === 'function') return value.toNumber();
    }
    return 0;
}

function isFreshStatusMessage(msg) {
    if (!PRIORITIZE_FRESH_STATUSES) return false;
    const timestampSeconds = parseTimestampSeconds(msg?.messageTimestamp);
    if (!timestampSeconds) return false;
    const ageSeconds = Math.floor((Date.now() - (timestampSeconds * 1000)) / 1000);
    return ageSeconds >= 0 && ageSeconds <= FRESH_STATUS_WINDOW_SECONDS;
}

initAntiSpamStorage();

const contactStore = readJsonFile(CONTACT_STORE_FILE, { contacts: {} });
const statusReferenceStore = readJsonFile(STATUS_REFERENCE_STORE_FILE, { pendingRefs: {}, resolvedRefs: {} });
const blockedCallStore = readJsonFile(BLOCKED_CALL_STORE_FILE, { callers: {} });
const healthStore = readJsonFile(HEALTH_STORE_FILE, {
    status: 'INITIALIZING',
    updatedAt: null,
    queue: { urgent: 0, normal: 0, total: 0 },
    lastStatusReceivedAt: null,
    lastStatusForwardedAt: null,
    lastTelegramSuccessAt: null,
    lastErrorAt: null,
    lastErrorMessage: '',
    reconnectAttempts: 0,
    reconnectDay: null,
    reconnectAttemptsToday: 0,
    lastDatabaseResetDay: null,
    lastDatabaseResetAt: null,
    signalHealth: {
        status: { lastAt: null, lastSource: '' },
        antiCall: { lastAt: null, lastSource: '' },
        autoBlock: { lastAt: null, lastSource: '' }
    }
});
const runtimeState = readJsonFile(RUNTIME_STATE_FILE, {
    pauseForward: false,
    pauseLike: false,
    pauseAntiCall: false,
    lastCommand: '',
    updatedAt: null
});
const metricsStore = readJsonFile(METRICS_STORE_FILE, {
    statusDetected: 0,
    statusForwarded: 0,
    statusLiked: 0,
    statusSkipped: 0,
    statusDuplicateSkipped: 0,
    statusFromMeSkipped: 0,
    statusRetried: 0,
    statusHistorySkippedOld: 0,
    statusSignalUpdatesRecovered: 0,
    statusReconnectRequeued: 0,
    statusQueueStaleSkipped: 0,
    statusReferencesCaptured: 0,
    statusReferencesResolved: 0,
    telegramSent: 0,
    telegramRetried: 0,
    downloadRetried: 0,
    likeRetried: 0,
    likeFallbackUsed: 0,
    likeFailed: 0,
    operationalSnapshots: 0,
    storePrunes: 0,
    callsRejected: 0,
    callsBlocked: 0,
    reconnects: 0,
    queueDrops: 0,
    updatedAt: null
});
const auditStore = readJsonFile(AUDIT_STORE_FILE, { entries: [] });
const failedJobStore = readJsonFile(FAILED_JOBS_STORE_FILE, { jobs: [] });

function saveContactStore() { writeJsonFile(CONTACT_STORE_FILE, contactStore); }
function saveStatusReferenceStore() { writeJsonFile(STATUS_REFERENCE_STORE_FILE, statusReferenceStore); }
function saveBlockedCallStore() { writeJsonFile(BLOCKED_CALL_STORE_FILE, blockedCallStore); }
function saveHealthStore() { writeJsonFile(HEALTH_STORE_FILE, healthStore); }
function saveRuntimeState() { runtimeState.updatedAt = new Date().toISOString(); writeJsonFile(RUNTIME_STATE_FILE, runtimeState); }
function saveMetricsStore() { metricsStore.updatedAt = new Date().toISOString(); writeJsonFile(METRICS_STORE_FILE, metricsStore); }
function saveAuditStore() { writeJsonFile(AUDIT_STORE_FILE, auditStore); }
function saveFailedJobStore() { writeJsonFile(FAILED_JOBS_STORE_FILE, failedJobStore); }

function ensureSignalHealthStore() {
    if (!healthStore.signalHealth || typeof healthStore.signalHealth !== 'object') {
        healthStore.signalHealth = {};
    }
    for (const key of ['status', 'antiCall', 'autoBlock']) {
        if (!healthStore.signalHealth[key] || typeof healthStore.signalHealth[key] !== 'object') {
            healthStore.signalHealth[key] = { lastAt: null, lastSource: '' };
        }
    }
}

function formatLastSignalAt(isoString) {
    if (!isoString) return 'belum ada';
    try {
        return new Date(isoString).toLocaleString('id-ID', {
            day: '2-digit', month: '2-digit',
            hour: '2-digit', minute: '2-digit', second: '2-digit',
            timeZone: DISPLAY_TIME_ZONE
        });
    } catch {
        return 'belum ada';
    }
}

function touchSignalHealth(signalKey, source = '') {
    ensureSignalHealthStore();
    healthStore.signalHealth[signalKey] = {
        lastAt: new Date().toISOString(),
        lastSource: String(source || '')
    };
    saveHealthStore();
}

function buildSignalAuditLine(metricValue, signalState) {
    const countValue = Number(metricValue || 0);
    const lastText = formatLastSignalAt(signalState?.lastAt);
    return `${countValue}x | ${lastText}`;
}

function emitSignalAuditBox() {
    ensureSignalHealthStore();
    if (ULTRA_MINIMAL_CONSOLE) return;
    logSignalAudit({
        statusLine: buildSignalAuditLine(metricsStore.statusDetected, healthStore.signalHealth.status),
        antiCallLine: buildSignalAuditLine(metricsStore.callsRejected, healthStore.signalHealth.antiCall),
        autoBlockLine: buildSignalAuditLine(metricsStore.callsBlocked, healthStore.signalHealth.autoBlock)
    });
}

function syncQueueHealth() {
    healthStore.queue = { urgent: urgentStatusQueue.length, normal: normalStatusQueue.length, total: urgentStatusQueue.length + normalStatusQueue.length };
    healthStore.updatedAt = new Date().toISOString();
    saveHealthStore();
}

function updateHealth(patch = {}) {
    Object.assign(healthStore, patch, { updatedAt: new Date().toISOString() });
    saveHealthStore();
}

function recordReconnectAttempt() {
    const today = new Date().toLocaleDateString('sv-SE', { timeZone: DISPLAY_TIME_ZONE });
    const nextCount = healthStore.reconnectDay === today
        ? Number(healthStore.reconnectAttemptsToday || 0) + 1
        : 1;

    updateHealth({ reconnectDay: today, reconnectAttemptsToday: nextCount });
    return nextCount;
}

function getCurrentWibClock() {
    const formatter = new Intl.DateTimeFormat('en-GB', {
        timeZone: DISPLAY_TIME_ZONE,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false
    });

    const parts = formatter.formatToParts(new Date());
    const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    return {
        dayKey: `${map.year}-${map.month}-${map.day}`,
        hour: Number(map.hour || 0),
        minute: Number(map.minute || 0),
        second: Number(map.second || 0)
    };
}

function ensureDirectory(dirPath) {
    fs.mkdirSync(dirPath, { recursive: true });
}

function createSessionBackup(reason = 'manual') {
    try {
        if (!fs.existsSync(AUTH_FOLDER)) {
            return false;
        }

        ensureDirectory(SESSION_BACKUP_DIR);
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const backupPath = path.join(SESSION_BACKUP_DIR, timestamp);
        const latestPath = path.join(SESSION_BACKUP_DIR, 'latest');

        fs.cpSync(AUTH_FOLDER, backupPath, { recursive: true });
        if (fs.existsSync(latestPath)) {
            fs.rmSync(latestPath, { recursive: true, force: true });
        }
        fs.cpSync(AUTH_FOLDER, latestPath, { recursive: true });

        const backups = fs.readdirSync(SESSION_BACKUP_DIR)
            .filter((name) => name !== 'latest')
            .sort();

        while (backups.length > MAX_SESSION_BACKUPS) {
            const oldest = backups.shift();
            if (oldest) {
                fs.rmSync(path.join(SESSION_BACKUP_DIR, oldest), { recursive: true, force: true });
            }
        }

        recordAudit('session_backup_created', { reason, backupPath }, 'info');
        return true;
    } catch (error) {
        recordFailedJob('session_backup', { reason }, error?.message || String(error));
        updateHealth({ lastErrorAt: new Date().toISOString(), lastErrorMessage: `session_backup:${error?.message || error}` });
        return false;
    }
}

function restoreAuthFromBackupIfNeeded() {
    try {
        if (fs.existsSync(AUTH_FOLDER)) {
            return false;
        }

        const latestPath = path.join(SESSION_BACKUP_DIR, 'latest');
        if (!fs.existsSync(latestPath)) {
            return false;
        }

        fs.cpSync(latestPath, AUTH_FOLDER, { recursive: true });
        recordAudit('session_restored_from_backup', { latestPath }, 'warn');
        return true;
    } catch (error) {
        recordFailedJob('session_restore', {}, error?.message || String(error));
        updateHealth({ lastErrorAt: new Date().toISOString(), lastErrorMessage: `session_restore:${error?.message || error}` });
        return false;
    }
}

function startSessionBackupLoop() {
    if (sessionBackupInterval) {
        clearInterval(sessionBackupInterval);
        sessionBackupInterval = null;
    }

    sessionBackupInterval = setInterval(() => {
        createSessionBackup('scheduled');
    }, SESSION_BACKUP_INTERVAL_MS);
}

function stopSessionBackupLoop() {
    if (sessionBackupInterval) {
        clearInterval(sessionBackupInterval);
        sessionBackupInterval = null;
    }
}

function incrementMetric(key, amount = 1) {
    metricsStore[key] = Number(metricsStore[key] || 0) + amount;
    saveMetricsStore();
}

function recordAudit(reason, meta = {}, level = 'info') {
    const entry = { time: new Date().toISOString(), level, reason, meta };
    auditStore.entries.push(entry);
    if (auditStore.entries.length > MAX_AUDIT_ENTRIES) {
        auditStore.entries.splice(0, auditStore.entries.length - MAX_AUDIT_ENTRIES);
    }
    saveAuditStore();
}

function recordFailedJob(stage, payload = {}, error = '') {
    const entry = { time: new Date().toISOString(), stage, payload, error: String(error || '') };
    failedJobStore.jobs.push(entry);
    if (failedJobStore.jobs.length > MAX_FAILED_JOBS) {
        failedJobStore.jobs.splice(0, failedJobStore.jobs.length - MAX_FAILED_JOBS);
    }
    saveFailedJobStore();
}

function maybeRunScheduledDatabaseReset(reason = 'scheduled') {
    const clock = getCurrentWibClock();
    const alreadyResetToday = healthStore.lastDatabaseResetDay === clock.dayKey;
    const passedResetMoment = clock.hour > DATABASE_RESET_HOUR_WIB || (clock.hour === DATABASE_RESET_HOUR_WIB && clock.minute >= 0);

    if (!passedResetMoment || alreadyResetToday) {
        return false;
    }

    runDailyDatabaseReset(reason, clock.dayKey);
    return true;
}

function runSqliteIntegrityCheck(reason = 'interval_10m') {
    if (!hasAntiSpamSqlite()) {
        return;
    }

    const now = Date.now();
    if (lastDatabaseIntegrityCheckAt && (now - lastDatabaseIntegrityCheckAt) < DATABASE_INTEGRITY_CHECK_INTERVAL_MS) {
        return;
    }
    lastDatabaseIntegrityCheckAt = now;

    try {
        const quickCheckResult = antiSpamDb.pragma('quick_check', { simple: true });
        const fingerprintRows = antiSpamStatements.selectIntegrityRows.all();
        const statusRows = antiSpamStatements.selectIntegrityStatusRows.all();
        let updatedRows = 0;
        let deletedRows = 0;

        for (const row of fingerprintRows) {
            const normalizedParticipant = normalizeStorageIdentity(row.participant || '').value;
            const normalizedType = normalizeStorageString(row.type || '', 50);
            const normalizedMessageId = normalizeStorageString(row.message_id || '', 255);
            const normalizedDisplayName = normalizeStorageString(row.display_name || '', 255);

            if (!row.fingerprint || (!normalizedParticipant && !normalizedMessageId)) {
                antiSpamStatements.deleteFingerprintRow.run(row.rowid);
                deletedRows += 1;
                continue;
            }

            if (
                normalizedParticipant !== String(row.participant || '')
                || normalizedType !== String(row.type || '')
                || normalizedMessageId !== String(row.message_id || '')
                || normalizedDisplayName !== String(row.display_name || '')
            ) {
                antiSpamStatements.updateFingerprintRow.run(
                    normalizedParticipant,
                    normalizedType,
                    normalizedMessageId,
                    normalizedDisplayName,
                    row.rowid
                );
                updatedRows += 1;
            }
        }

        const seenStatusCompositeKeys = new Set();
        for (const row of statusRows) {
            const normalizedPrimaryKey = normalizeStorageString(row.status_primary_key || '', 255);
            const normalizedParticipant = normalizeStorageIdentity(row.participant || '').value;
            const normalizedRemoteJid = normalizeStorageIdentity(row.remote_jid || '').value;
            const normalizedChatScope = normalizeStorageString(row.chat_scope || '', 50);
            const normalizedSourceType = normalizeStorageString(row.source_type || '', 50);
            const normalizedMediaType = normalizeStorageString(row.media_type || '', 50);
            const normalizedMessageId = normalizeStorageString(row.message_id || '', 255);
            const normalizedContentSignature = normalizeStorageString(row.content_signature || '', 255);
            const normalizedDisplayName = normalizeStorageString(row.display_name || '', 255);

            if (!normalizedPrimaryKey || (!normalizedParticipant && !normalizedMessageId && !normalizedRemoteJid && !normalizedContentSignature)) {
                antiSpamStatements.deleteStatusRecordRow.run(row.rowid);
                deletedRows += 1;
                continue;
            }

            const statusCompositeKey = normalizedMessageId
                ? `${normalizedRemoteJid}|${normalizedParticipant}|${normalizedMediaType}|${normalizedMessageId}`
                : (normalizedContentSignature || normalizedPrimaryKey);

            if (seenStatusCompositeKeys.has(statusCompositeKey)) {
                antiSpamStatements.deleteStatusRecordRow.run(row.rowid);
                deletedRows += 1;
                continue;
            }
            seenStatusCompositeKeys.add(statusCompositeKey);

            if (
                normalizedParticipant !== String(row.participant || '')
                || normalizedRemoteJid !== String(row.remote_jid || '')
                || normalizedChatScope !== String(row.chat_scope || '')
                || normalizedSourceType !== String(row.source_type || '')
                || normalizedMediaType !== String(row.media_type || '')
                || normalizedMessageId !== String(row.message_id || '')
                || normalizedContentSignature !== String(row.content_signature || '')
                || normalizedDisplayName !== String(row.display_name || '')
            ) {
                antiSpamStatements.updateStatusRecordRow.run(
                    normalizedParticipant,
                    normalizedRemoteJid,
                    normalizedChatScope,
                    normalizedSourceType,
                    normalizedMediaType,
                    normalizedMessageId,
                    normalizedContentSignature,
                    normalizedDisplayName,
                    row.rowid
                );
                updatedRows += 1;
            }
        }

        const status = quickCheckResult === 'ok' ? 'OK' : 'WARNING';
        if (quickCheckResult !== 'ok') {
            recordAudit('sqlite_integrity_warning', { reason, quickCheckResult }, 'warn');
            void sendOperationalAlert('database_warning', `quick_check=${quickCheckResult}`, { sendTelegram: true, sendWhatsapp: true });
        }
        if (updatedRows > 0 || deletedRows > 0) {
            recordAudit('sqlite_integrity_repaired', { reason, updatedRows, deletedRows }, 'info');
        }
        if (!ULTRA_MINIMAL_CONSOLE) {
            const statusRecordRowsCount = Number(antiSpamStatements.countStatusRecords.get()?.total || 0);
            const fingerprintRowsCount = Number(antiSpamStatements.countFingerprints.get()?.total || 0);
            const documentRowsCount = Number(antiSpamStatements.countDocuments.get()?.total || 0);
            logDatabaseCheck({
                status,
                quickCheck: quickCheckResult,
                scannedRows: fingerprintRows.length + statusRows.length,
                updatedRows,
                deletedRows,
                statusRecordRows: statusRecordRowsCount,
                fingerprintRows: fingerprintRowsCount,
                documentRows: documentRowsCount,
                lastResetAt: healthStore.lastDatabaseResetAt ? formatLastSignalAt(healthStore.lastDatabaseResetAt) : 'belum ada',
                reason
            });
        }
    } catch (error) {
        const message = error?.message || String(error);
        warnAntiSpamStorage(message || 'sqlite_integrity_check_failed');
        recordFailedJob('sqlite_integrity_check', { reason }, message);
        void sendOperationalAlert('database_rusak', message, { sendTelegram: true, sendWhatsapp: true });
    }
}

function getDelayUntilNextWibMidnightMs() {
    const now = Date.now();
    const wibOffsetMs = 7 * 60 * 60 * 1000;
    const shiftedNow = new Date(now + wibOffsetMs);
    shiftedNow.setUTCHours(24, 0, 0, 0);
    return Math.max(1000, shiftedNow.getTime() - (now + wibOffsetMs));
}

function scheduleNextDailyDatabaseReset() {
    if (databaseResetTimeout) {
        clearTimeout(databaseResetTimeout);
        databaseResetTimeout = null;
    }

    databaseResetTimeout = setTimeout(() => {
        const resetDone = maybeRunScheduledDatabaseReset('jadwal_harian_12_malam_wib');
        if (!resetDone) {
            maybeRunScheduledDatabaseReset('jadwal_harian_12_malam_wib_retry');
        }
        scheduleNextDailyDatabaseReset();
    }, getDelayUntilNextWibMidnightMs());
}

function startStorePruneLoop() {
    if (storePruneInterval) {
        clearInterval(storePruneInterval);
        storePruneInterval = null;
    }

    if (!lastDatabaseIntegrityCheckAt) {
        lastDatabaseIntegrityCheckAt = Date.now();
    }

    maybeRunScheduledDatabaseReset('startup_catchup');
    scheduleNextDailyDatabaseReset();

    storePruneInterval = setInterval(() => {
        runSqliteIntegrityCheck('interval_10_menit');
    }, DATABASE_INTEGRITY_CHECK_INTERVAL_MS);
}

function startSignalAuditLoop() {
    if (signalAuditInterval) {
        clearInterval(signalAuditInterval);
        signalAuditInterval = null;
    }

    signalAuditInterval = setInterval(() => {
        emitSignalAuditBox();
    }, SIGNAL_AUDIT_INTERVAL_MS);
}

function stopSignalAuditLoop() {
    if (signalAuditInterval) {
        clearInterval(signalAuditInterval);
        signalAuditInterval = null;
    }
}

function stopStorePruneLoop() {
    if (storePruneInterval) {
        clearInterval(storePruneInterval);
        storePruneInterval = null;
    }
    if (databaseResetTimeout) {
        clearTimeout(databaseResetTimeout);
        databaseResetTimeout = null;
    }
    clearQueueRetryTimers();
}

function persistOperationalSnapshot(reason = 'manual') {
    saveHealthStore();
    saveMetricsStore();
    saveAuditStore();
    saveFailedJobStore();
    saveRuntimeState();
    saveStatusReferenceStore();
    saveBlockedCallStore();
    incrementMetric('operationalSnapshots', 1);
    recordAudit('operational_snapshot', { reason }, 'info');
    flushPendingSqliteDocumentWrites();
}

function sanitizeName(value) {
    const text = String(value || '').trim();
    if (!text) return '';
    return text.replace(/\s+/g, ' ');
}

function extractUserSavedContactName(contact) {
    return sanitizeName(contact?.name || contact?.fullName || contact?.short || '');
}

function extractProfileContactName(contact) {
    return sanitizeName(contact?.notify || contact?.verifiedName || '');
}

function rebuildContactIndexes() {
    contactIndexByNumber.clear();
    contactIndexByName.clear();

    for (const record of Object.values(contactStore.contacts || {})) {
        if (!record) continue;
        if (record.number) {
            contactIndexByNumber.set(record.number, record);
        }
        const names = [record.savedName, record.name, record.profileName]
            .map((value) => sanitizeName(value).toLowerCase())
            .filter(Boolean);
        for (const name of names) {
            if (!contactIndexByName.has(name)) {
                contactIndexByName.set(name, record);
            }
        }
    }
}

function upsertContacts(entries = []) {
    if (!Array.isArray(entries) || entries.length === 0) return;
    let changed = false;
    for (const entry of entries) {
        const jid = normalizeJid(entry?.id || entry?.jid || entry?.contactId || '');
        if (!jid) continue;
        const existing = contactStore.contacts[jid] || {};
        const savedName = extractUserSavedContactName(entry) || existing.savedName || existing.name || '';
        const profileName = extractProfileContactName(entry) || existing.profileName || '';
        const nextRecord = { jid, number: getNumberFromJid(jid), savedName, profileName, updatedAt: new Date().toISOString() };
        if (JSON.stringify(existing) !== JSON.stringify(nextRecord)) {
            contactStore.contacts[jid] = nextRecord;
            changed = true;
        }
    }
    if (changed) {
        rebuildContactIndexes();
        saveContactStore();
    }
}

function findStoredContact(jid, number) {
    if (jid && contactStore.contacts[jid]) return contactStore.contacts[jid];
    if (!number) return {};
    return contactIndexByNumber.get(number) || {};
}

function findStoredContactByName(name) {
    const target = sanitizeName(name).toLowerCase();
    if (!target) return {};
    return contactIndexByName.get(target) || {};
}

function getJidDomain(jid) {
    const normalized = normalizeJid(jid);
    return normalized.includes('@') ? normalized.split('@')[1] : '';
}

function getPhoneNumberFromPhoneJid(jid) {
    const normalized = normalizeJid(jid);
    const domain = getJidDomain(normalized);
    if (!normalized || domain !== 's.whatsapp.net') return '';
    const number = getNumberFromJid(normalized);
    return /^\d{10,15}$/.test(number) ? number : '';
}

function getCanonicalStatusOwnerToken(msg, participant = '', mediaInfo = null) {
    const candidates = [
        participant,
        msg?.key?.participantPn,
        msg?.participantPn,
        msg?.senderPn,
        msg?.key?.participant,
        msg?.participant,
        mediaInfo?.authorJid,
        (msg?.key?.remoteJid && msg.key.remoteJid !== 'status@broadcast' ? msg.key.remoteJid : '')
    ].map(normalizeJid).filter(Boolean);

    for (const candidate of candidates) {
        const phoneNumber = getPhoneNumberFromPhoneJid(candidate);
        if (phoneNumber) {
            return `pn:${phoneNumber}`;
        }

        const numericLeft = getNumberFromJid(candidate);
        if (/^\d{5,20}$/.test(numericLeft)) {
            return `id:${numericLeft}`;
        }
    }

    return candidates[0] ? `jid:${candidates[0]}` : 'jid:unknown';
}

function getPreferredIdentityJid(participant, msg) {
    const prioritized = STATUS_PARTICIPANT_PN_PRIORITY
        ? [msg?.key?.participantPn, msg?.participantPn, msg?.senderPn, participant]
        : [participant, msg?.key?.participantPn, msg?.participantPn, msg?.senderPn];
    return normalizeJid(prioritized.find(Boolean) || '');
}

function resolveContactIdentity(participant, msg) {
    const jid = normalizeJid(participant);
    const preferredJid = getPreferredIdentityJid(participant, msg);
    const pushName = sanitizeName(msg?.pushName || msg?.verifiedBizName || '');

    const candidateJids = [msg?.key?.participantPn, msg?.participantPn, msg?.senderPn, preferredJid, jid]
        .map(normalizeJid)
        .filter(Boolean);
    const uniqueCandidateJids = [...new Set(candidateJids)];
    const candidateNumbers = uniqueCandidateJids.map(getPhoneNumberFromPhoneJid).filter(Boolean);

    let stored = {};
    for (const candidateJid of uniqueCandidateJids) {
        const found = findStoredContact(candidateJid, getPhoneNumberFromPhoneJid(candidateJid));
        if (found && (found.jid || found.number)) { stored = found; break; }
    }

    if ((!stored || !stored.number) && candidateNumbers.length > 0) {
        for (const number of candidateNumbers) {
            const found = findStoredContact('', number);
            if (found && (found.jid || found.number)) { stored = found; break; }
        }
    }

    if ((!stored || !stored.number) && pushName) {
        const foundByName = findStoredContactByName(pushName);
        if (foundByName && (foundByName.jid || foundByName.number)) stored = foundByName;
    }

    const savedName = sanitizeName(stored.savedName || stored.name || '');
    const profileName = sanitizeName(stored.profileName || '');
    const hasStoredContactRecord = Boolean(stored?.jid || stored?.number);
    const number = stored.number || candidateNumbers[0] || '';
    const displayName = savedName || pushName || profileName || number || getNumberFromJid(jid);
    const isUserSaved = Boolean(savedName || (hasStoredContactRecord && (profileName || pushName)));

    return {
        jid,
        preferredJid,
        number: number || getNumberFromJid(jid),
        savedName,
        profileName,
        pushName,
        isSaved: isUserSaved,
        isUserSaved,
        isUnsavedByUser: !isUserSaved,
        hasStoredContactRecord,
        displayName
    };
}

function recordBlockedCaller(identity, call, actions) {
    const key = identity.jid || identity.preferredJid || identity.number || `unknown-${Date.now()}`;
    const existing = blockedCallStore.callers[key] || {
        jid: identity.jid,
        preferredJid: identity.preferredJid || '',
        number: identity.number || '',
        displayName: identity.displayName || '',
        savedName: identity.savedName || '',
        profileName: identity.profileName || '',
        isUserSaved: identity.isUserSaved === true,
        totalBlocks: 0,
        firstBlockedAt: '',
        lastBlockedAt: '',
        lastBlockedAtWib: '',
        lastCallType: '',
        lastCallStatus: '',
        lastActions: []
    };
    const timestampIso = new Date().toISOString();
    blockedCallStore.callers[key] = {
        ...existing,
        jid: identity.jid,
        preferredJid: identity.preferredJid || '',
        number: identity.number || '',
        displayName: identity.displayName || '',
        savedName: identity.savedName || '',
        profileName: identity.profileName || '',
        isUserSaved: identity.isUserSaved === true,
        totalBlocks: Number(existing.totalBlocks || 0) + 1,
        firstBlockedAt: existing.firstBlockedAt || timestampIso,
        lastBlockedAt: timestampIso,
        lastBlockedAtWib: formatDisplayDateTime(),
        lastCallType: call?.isVideo ? 'VIDEO' : 'VOICE',
        lastCallStatus: String(call?.status || 'unknown').toUpperCase(),
        lastActions: Array.isArray(actions) ? actions : []
    };
    saveBlockedCallStore();
}

function buildReferenceStoreKey(key) {
    if (!key) return '';
    const remote = key.remoteJid || 'status@broadcast';
    const participant = key.participant || key.participantPn || '-';
    const id = key.id || '-';
    return `${remote}|${participant}|${id}`;
}

function getTelegramDisplayId(identity, mediaInfo = null, msg = null) {
    const candidates = [
        mediaInfo?.sourceJid,
        mediaInfo?.authorJid,
        msg?.key?.participantPn,
        msg?.participantPn,
        msg?.senderPn,
        identity?.preferredJid,
        identity?.jid,
        msg?.key?.participant,
        msg?.participant,
        msg?.key?.remoteJid
    ].map(normalizeJid).filter(Boolean);
    return candidates[0] || 'Tidak tersedia';
}

function getReferenceDisplayId(referenceMeta) {
    const candidates = [referenceMeta.sourceJid, referenceMeta.referencedParticipant, referenceMeta.referencedRemoteJid]
        .map(normalizeJid)
        .filter(Boolean);
    return candidates[0] || 'Tidak tersedia';
}

function buildStatusReferenceNotification(referenceMeta, resolved = false, mediaInfo = null) {
    const modeLabel = resolved ? 'Referensi status berhasil dicocokkan' : 'Referensi status terdeteksi';
    const displayId = getReferenceDisplayId(referenceMeta);
    const lines = [
        modeLabel,
        `Dari: ${referenceMeta.displayName || displayId || 'Tidak diketahui'}`,
        `ID: ${displayId}`,
        `Kategori: ${referenceMeta.statusCategory || '-'}`,
        `Ref ID: ${referenceMeta.referenceId || '-'}`,
        `Waktu: ${formatDisplayDateTime()}`
    ];
    const sourceLabel = referenceMeta.sourceName || referenceMeta.sourceJid || referenceMeta.sourceType || '';
    if (sourceLabel) lines.push(`Sumber: ${sourceLabel}`);
    if (resolved && mediaInfo) lines.push(`Media cocok: ${String(mediaInfo.type || '-').toUpperCase()}`);
    return lines.join('\n');
}

async function captureStatusReference(mediaInfo, identity, msg) {
    if (mediaInfo.type !== 'status-notification') return;
    const referenceKey = buildReferenceStoreKey(mediaInfo.referencedKey);
    if (!referenceKey) return;
    const existingResolved = statusReferenceStore.resolvedRefs?.[referenceKey];
    if (existingResolved) return;

    const existingPending = statusReferenceStore.pendingRefs?.[referenceKey];
    const meta = {
        referenceKey,
        referenceId: mediaInfo.referencedKey?.id || '',
        referencedRemoteJid: mediaInfo.referencedKey?.remoteJid || '',
        referencedParticipant: mediaInfo.referencedKey?.participant || '',
        statusCategory: mediaInfo.statusCategory,
        sourceType: mediaInfo.sourceType || '',
        sourceJid: mediaInfo.sourceJid || '',
        sourceName: mediaInfo.sourceName || '',
        displayName: identity.displayName,
        number: identity.number,
        isUserSaved: identity.isUserSaved === true,
        detectedAt: existingPending?.detectedAt || new Date().toISOString(),
        updatedAt: new Date().toISOString()
    };
    statusReferenceStore.pendingRefs[referenceKey] = meta;
    saveStatusReferenceStore();
    incrementMetric('statusReferencesCaptured', 1);
    recordAudit('status_reference_captured', meta, 'info');
    if (NOTIFY_STATUS_REFERENCES && !existingPending) {
        try {
            await sendTelegramText(buildStatusReferenceNotification(meta, false));
        } catch (error) {
            recordFailedJob('status_reference_notify', meta, error?.message || String(error));
            updateHealth({ lastErrorAt: new Date().toISOString(), lastErrorMessage: `status_reference_notify:${error?.message || error}` });
        }
    }
}

async function resolveStatusReference(mediaInfo, identity, msg) {
    if (mediaInfo.type === 'status-notification' || mediaInfo.type === 'unknown') return;
    const currentKey = buildReferenceStoreKey(msg?.key);
    if (!currentKey) return;
    const pending = statusReferenceStore.pendingRefs?.[currentKey];
    if (!pending) return;

    const resolvedMeta = {
        ...pending,
        updatedAt: new Date().toISOString(),
        resolvedAt: new Date().toISOString(),
        resolvedMediaType: mediaInfo.type
    };
    delete statusReferenceStore.pendingRefs[currentKey];
    statusReferenceStore.resolvedRefs[currentKey] = resolvedMeta;
    saveStatusReferenceStore();
    incrementMetric('statusReferencesResolved', 1);
    recordAudit('status_reference_resolved', resolvedMeta, 'info');
    if (NOTIFY_STATUS_REFERENCES) {
        try {
            await sendTelegramText(buildStatusReferenceNotification({
                ...resolvedMeta,
                displayName: identity.displayName || pending.displayName,
                number: identity.number || pending.number,
                isUserSaved: identity.isUserSaved === true || pending.isUserSaved === true,
                sourceType: mediaInfo.sourceType || pending.sourceType || '',
                sourceJid: mediaInfo.sourceJid || pending.sourceJid || '',
                sourceName: mediaInfo.sourceName || pending.sourceName || ''
            }, true, mediaInfo));
        } catch (error) {
            recordFailedJob('status_reference_resolve_notify', resolvedMeta, error?.message || String(error));
            updateHealth({ lastErrorAt: new Date().toISOString(), lastErrorMessage: `status_reference_resolve_notify:${error?.message || error}` });
        }
    }
}

function validateConfig() {
    if (antiSpamStorageFatalError) {
        throw new Error(`Storage SQLite gagal: ${antiSpamStorageFatalError}`);
    }
    if (!PAIRING_PHONE_NUMBER) throw new Error('Nomor WhatsApp belum diisi di config.js pada whatsapp.phoneNumber');
    if (!isValidPairingPhoneNumber(PAIRING_PHONE_NUMBER)) {
        throw new Error('Format whatsapp.phoneNumber tidak valid. Gunakan nomor internasional 10-15 digit, contoh: 628123456789');
    }
    if (!TELEGRAM_BOT_TOKEN || TELEGRAM_BOT_TOKEN === 'ISI_BOT_TOKEN_TELEGRAM') throw new Error('Bot token Telegram belum diisi di config.js pada telegram.botToken');
    if (!TELEGRAM_CHAT_ID || TELEGRAM_CHAT_ID === 'ISI_CHAT_ID_TELEGRAM') throw new Error('Chat ID Telegram belum diisi di config.js pada telegram.chatId');
    if (MAX_QUEUE_SIZE < MAX_URGENT_QUEUE_SIZE) throw new Error('Config queue tidak valid: maxQueueSize harus >= maxUrgentQueueSize');
    if (MAX_HISTORY_ENQUEUE_PER_SYNC > MAX_QUEUE_SIZE) throw new Error('Config queue tidak valid: maxHistoryEnqueuePerSync terlalu besar');
}

function showStartupBanner() {
    if (startupBannerShown) {
        return;
    }

    startupBannerShown = true;
    console.log(paint(STARTUP_ASCII, ANSI.cyan));
    logBoot(`WA ${PAIRING_PHONE_NUMBER} | TG ${TELEGRAM_CHAT_ID}`);
}

function stopPairingReminder() {
    if (pairingReminderInterval) {
        clearInterval(pairingReminderInterval);
        pairingReminderInterval = null;
    }
}

function stopPresenceKeepAlive() {
    if (presenceKeepAliveInterval) {
        clearInterval(presenceKeepAliveInterval);
        presenceKeepAliveInterval = null;
    }
}

function clearReconnectTimer() {
    if (reconnectTimeout) {
        clearTimeout(reconnectTimeout);
        reconnectTimeout = null;
    }
}

function startPresenceKeepAlive(sock) {
    stopPresenceKeepAlive();
    if (!KEEP_ONLINE_ENABLED) return;
    const sendAvailablePresence = async () => {
        try {
            await sock.sendPresenceUpdate('available');
        } catch (error) {
            logError('Presence', error.message);
        }
    };
    sendAvailablePresence();
    presenceKeepAliveInterval = setInterval(sendAvailablePresence, KEEP_ALIVE_INTERVAL_MS);
}

function scheduleReconnect() {
    if (reconnectTimeout) return;

    const nextCount = recordReconnectAttempt();
    logError('Reconnect', `${Math.ceil(RECONNECT_DELAY_MS / 1000)} detik lagi | percobaan hari ini: ${nextCount}`);
    reconnectTimeout = setTimeout(() => {
        reconnectTimeout = null;
        connectToWhatsApp().catch((error) => {
            logError('Reconnect gagal', error.message);
            scheduleReconnect();
        });
    }, RECONNECT_DELAY_MS);
}

function startPairingReminder(phoneNumber) {
    stopPairingReminder();
    pairingReminderInterval = setInterval(() => {
        if (!MINIMAL_CONSOLE) logWait(phoneNumber);
    }, 15000);
}

function showPairingInstructions(phoneNumber, code) {
    console.log('\x07');
    if (!ULTRA_MINIMAL_CONSOLE) {
        logPairInfo(phoneNumber, 'Masukkan kode pairing di WhatsApp');
    }
    logCode(code);
}

async function requestPairingCode(sock, phoneNumber) {
    lastPhoneNumber = phoneNumber;
    logVerbose(`[PAIR] Request ${phoneNumber}`);
    await delay(3000);
    const code = await sock.requestPairingCode(phoneNumber);
    showPairingInstructions(phoneNumber, code);
    startPairingReminder(phoneNumber);
}

function isTelegramConfigured() {
    return Boolean(TELEGRAM_BOT_TOKEN && TELEGRAM_CHAT_ID);
}

function normalizeOwnerNumber(value) {
    const raw = String(value || '').replace(/\D/g, '');
    if (!raw) return '';
    if (raw.startsWith('0')) return `62${raw.slice(1)}`;
    return raw;
}

function getOwnerAlertJids() {
    const ownerNumbers = Array.isArray(config?.owner?.allowedNumbers) ? config.owner.allowedNumbers : [];
    return [...new Set(ownerNumbers.map(normalizeOwnerNumber).filter(Boolean))].map((number) => `${number}@s.whatsapp.net`);
}

async function sendTelegramAlertText(text) {
    if (!isTelegramConfigured()) return false;
    const response = await fetchTelegram('sendMessage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text: String(text || '').slice(0, 4000) })
    });
    const result = await response.json().catch(() => ({ ok: false, description: `Telegram API error ${response.status}` }));
    return Boolean(response.ok && result.ok);
}

async function sendWhatsappAlertToOwners(text) {
    if (!activeSocket || !waConnectionReady) return false;
    const ownerJids = getOwnerAlertJids();
    if (ownerJids.length === 0) return false;

    let sent = false;
    for (const jid of ownerJids) {
        try {
            await activeSocket.sendMessage(jid, { text: String(text || '').slice(0, 4000) });
            sent = true;
        } catch {
            // ignore owner alert failure per jid
        }
    }
    return sent;
}

async function sendOperationalAlert(kind, message, options = {}) {
    const alertText = [
        'Alert bot',
        `Jenis: ${kind}`,
        `Info: ${message}`,
        `Waktu: ${formatDisplayDateTime()}`
    ].join('\n');

    if (options.sendWhatsapp !== false) {
        try {
            await sendWhatsappAlertToOwners(alertText);
        } catch {
            // ignore alert dispatch error
        }
    }

    if (options.sendTelegram !== false) {
        try {
            await sendTelegramAlertText(alertText);
        } catch {
            // ignore alert dispatch error
        }
    }
}

function warnTelegramConfig() {
    if (telegramConfigWarned) return;
    telegramConfigWarned = true;
    logError('Config', 'Telegram belum dikonfigurasi dengan benar di config.js');
}

function getActiveMessageKeys(message) {
    if (!message || typeof message !== 'object') return [];
    return Object.keys(message).filter((key) => message[key] != null);
}

function inspectStatusEnvelope(message, wrappers = []) {
    if (!message) return { content: null, wrappers, topLevelKeys: [] };

    const wrapperCandidates = [
        ['ephemeralMessage', message.ephemeralMessage?.message],
        ['deviceSentMessage', message.deviceSentMessage?.message],
        ['editedMessage', message.editedMessage?.message],
        ['keepInChatMessage', message.keepInChatMessage?.message],
        ['documentWithCaptionMessage', message.documentWithCaptionMessage?.message],
        ['statusMentionMessage', message.statusMentionMessage?.message],
        ['groupStatusMentionMessage', message.groupStatusMentionMessage?.message],
        ['groupStatusMessage', message.groupStatusMessage?.message],
        ['groupStatusMessageV2', message.groupStatusMessageV2?.message]
    ];

    for (const [wrapperName, nestedMessage] of wrapperCandidates) {
        if (nestedMessage) return inspectStatusEnvelope(nestedMessage, [...wrappers, wrapperName]);
    }

    return { content: message, wrappers, topLevelKeys: getActiveMessageKeys(message) };
}

function detectStatusCategory(msg, envelope) {
    const wrapperSet = new Set(envelope?.wrappers || []);
    if (wrapperSet.has('groupStatusMentionMessage')) return 'group_status_mention';
    if (wrapperSet.has('statusMentionMessage')) return 'status_mention';
    if (wrapperSet.has('groupStatusMessageV2')) return 'group_status_v2';
    if (wrapperSet.has('groupStatusMessage')) return 'group_status';
    if (msg?.key?.remoteJid === 'status@broadcast') return 'status_broadcast';
    return 'status_unknown';
}

function isStatusLikeMessage(msg) {
    if (!msg?.message) return false;
    if (msg.key?.remoteJid === 'status@broadcast') return true;
    const topLevelKeys = getActiveMessageKeys(msg.message);
    return topLevelKeys.some((key) => [
        'statusMentionMessage',
        'groupStatusMentionMessage',
        'groupStatusMessage',
        'groupStatusMessageV2'
    ].includes(key));
}

function getStatusMessageContextInfo(content) {
    const contexts = [
        content?.imageMessage?.contextInfo,
        content?.videoMessage?.contextInfo,
        content?.audioMessage?.contextInfo,
        content?.documentMessage?.contextInfo,
        content?.stickerMessage?.contextInfo,
        content?.extendedTextMessage?.contextInfo
    ];
    return contexts.find(Boolean) || {};
}

function extractStatusOriginInfo(content) {
    const contextInfo = getStatusMessageContextInfo(content);
    const statusAttribution = contextInfo?.statusAttribution || {};
    const forwardedNewsletter = contextInfo?.forwardedNewsletterMessageInfo || {};

    if (forwardedNewsletter.newsletterJid || forwardedNewsletter.newsletterName) {
        return {
            sourceType: 'newsletter',
            sourceJid: normalizeJid(forwardedNewsletter.newsletterJid || ''),
            sourceName: forwardedNewsletter.newsletterName || 'Saluran'
        };
    }

    if (statusAttribution?.groupStatus?.authorJid) {
        return {
            sourceType: 'group_status',
            sourceJid: normalizeJid(statusAttribution.groupStatus.authorJid || ''),
            sourceName: ''
        };
    }

    if (statusAttribution?.statusReshare?.originalMessageKey?.remoteJid) {
        return {
            sourceType: 'status_reshare',
            sourceJid: normalizeJid(statusAttribution.statusReshare.originalMessageKey.remoteJid || ''),
            sourceName: ''
        };
    }

    if (statusAttribution?.externalShare) {
        return {
            sourceType: 'external_share',
            sourceJid: '',
            sourceName: 'External Share'
        };
    }

    return { sourceType: '', sourceJid: '', sourceName: '' };
}

function isPhoneJid(jid) {
    const normalized = normalizeJid(jid);
    return normalized.endsWith('@s.whatsapp.net');
}

function getStatusAttributionAuthorJid(content) {
    const candidates = [
        content?.imageMessage?.contextInfo?.statusAttribution?.groupStatus?.authorJid,
        content?.videoMessage?.contextInfo?.statusAttribution?.groupStatus?.authorJid,
        content?.audioMessage?.contextInfo?.statusAttribution?.groupStatus?.authorJid,
        content?.documentMessage?.contextInfo?.statusAttribution?.groupStatus?.authorJid,
        content?.stickerMessage?.contextInfo?.statusAttribution?.groupStatus?.authorJid,
        content?.extendedTextMessage?.contextInfo?.statusAttribution?.groupStatus?.authorJid
    ].map(normalizeJid).filter(Boolean);
    return candidates.find(isPhoneJid) || candidates[0] || '';
}

function getStatusSourceParticipant(msg, mediaInfo) {
    const orderedCandidates = STATUS_PARTICIPANT_PN_PRIORITY
        ? [
            msg?.key?.participantPn,
            msg?.participantPn,
            msg?.senderPn,
            mediaInfo?.authorJid,
            msg?.key?.participant,
            msg?.participant,
            (msg?.key?.remoteJid && msg.key.remoteJid !== 'status@broadcast' ? msg.key.remoteJid : '')
        ]
        : [
            mediaInfo?.authorJid,
            msg?.key?.participant,
            msg?.participant,
            msg?.key?.participantPn,
            msg?.participantPn,
            msg?.senderPn,
            (msg?.key?.remoteJid && msg.key.remoteJid !== 'status@broadcast' ? msg.key.remoteJid : '')
        ];
    const candidates = orderedCandidates.map(normalizeJid).filter(Boolean);
    const phoneCandidate = candidates.find(isPhoneJid);
    return phoneCandidate || candidates[0] || '';
}

function logStatusDetection(msg, mediaInfo) {
    if (!DEBUG_STATUS_TYPE_DETECTION || !mediaInfo) return;
    const wrapperTrail = mediaInfo.envelope?.wrappers?.length ? mediaInfo.envelope.wrappers.join(' > ') : 'direct';
    const innerType = mediaInfo.innerType || 'unknown';
    if (!MINIMAL_CONSOLE) {
        logDebug(
            `category=${mediaInfo.statusCategory} type=${mediaInfo.type}`,
            `wrapper=${wrapperTrail} | inner=${innerType} | remote=${msg?.key?.remoteJid || '-'}`
        );
    }
}

function extractStatusMediaInfo(message, msg = null) {
    const envelope = inspectStatusEnvelope(message);
    const content = envelope.content;
    if (!content) return null;
    const statusCategory = detectStatusCategory(msg, envelope);
    const originInfo = extractStatusOriginInfo(content);
    const baseInfo = {
        envelope,
        statusCategory,
        innerType: envelope.topLevelKeys[0] || 'unknown',
        authorJid: getStatusAttributionAuthorJid(content),
        ...originInfo
    };

    if (content.imageMessage) return { ...baseInfo, type: 'image', mimetype: content.imageMessage.mimetype || 'image/jpeg', caption: content.imageMessage.caption || '', fileName: '', raw: content.imageMessage };
    if (content.videoMessage) return { ...baseInfo, type: 'video', mimetype: content.videoMessage.mimetype || 'video/mp4', caption: content.videoMessage.caption || '', fileName: '', raw: content.videoMessage };
    if (content.audioMessage) return { ...baseInfo, type: 'audio', mimetype: content.audioMessage.mimetype || 'audio/ogg', caption: '', fileName: '', raw: content.audioMessage };
    if (content.documentMessage) return { ...baseInfo, type: 'document', mimetype: content.documentMessage.mimetype || 'application/octet-stream', caption: content.documentMessage.caption || '', fileName: content.documentMessage.fileName || '', raw: content.documentMessage };
    if (content.stickerMessage) return { ...baseInfo, type: 'sticker', mimetype: content.stickerMessage.mimetype || 'image/webp', caption: '', fileName: '', raw: content.stickerMessage };
    if (content.extendedTextMessage || content.conversation) return { ...baseInfo, type: 'text', mimetype: 'text/plain', caption: content.extendedTextMessage?.text || content.conversation || '', fileName: '', raw: content.extendedTextMessage || { text: content.conversation || '' } };
    if (content.protocolMessage) return { ...baseInfo, type: 'status-notification', mimetype: 'application/x-status-notification', caption: '', fileName: '', raw: content.protocolMessage, referencedKey: content.protocolMessage.key || null, protocolType: content.protocolMessage.type || '' };
    return { ...baseInfo, type: 'unknown', mimetype: '', caption: '', fileName: '', raw: content };
}

function getExtensionFromMime(mimetype = '') {
    const cleanMime = mimetype.split(';')[0].trim().toLowerCase();
    const map = {
        'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/png': 'png', 'image/webp': 'webp',
        'video/mp4': 'mp4', 'video/3gpp': '3gp', 'audio/ogg': 'ogg', 'audio/mpeg': 'mp3',
        'audio/mp4': 'm4a', 'application/pdf': 'pdf'
    };
    if (map[cleanMime]) return map[cleanMime];
    if (cleanMime.includes('/')) return cleanMime.split('/')[1] || 'bin';
    return 'bin';
}

function getTelegramSendMethod(mediaType) {
    switch (mediaType) {
        case 'image': return { method: 'sendPhoto', field: 'photo' };
        case 'video': return { method: 'sendVideo', field: 'video' };
        case 'audio': return { method: 'sendAudio', field: 'audio' };
        default: return { method: 'sendDocument', field: 'document' };
    }
}

function isRuntimeBusy() {
    return getPendingQueueSize() >= RUNTIME_BUSY_QUEUE_THRESHOLD;
}

function getNaturalViewDelayMs(mediaInfo, msg) {
    if (!NATURAL_VIEW_MODE) return 0;
    const isFresh = isFreshStatusMessage(msg);
    const seconds = Number(mediaInfo?.raw?.seconds || 0);
    let baseDelay = 3000;

    switch (mediaInfo.type) {
        case 'image':
            baseDelay = isFresh ? FRESH_IMAGE_VIEW_MS : IMAGE_VIEW_MS;
            break;
        case 'video': {
            if (seconds > 0) {
                baseDelay = Math.round(seconds * 0.8 * 1000);
                const minVideo = isFresh ? FRESH_VIDEO_MIN_VIEW_MS : MIN_VIDEO_VIEW_MS;
                const maxVideo = isFresh ? FRESH_VIDEO_MAX_VIEW_MS : MAX_VIDEO_VIEW_MS;
                baseDelay = Math.min(maxVideo, Math.max(minVideo, baseDelay));
            } else {
                baseDelay = isFresh ? FRESH_VIDEO_MIN_VIEW_MS : MIN_VIDEO_VIEW_MS;
            }
            break;
        }
        case 'audio':
            baseDelay = isFresh ? FRESH_OTHER_VIEW_MS : (seconds > 0 ? Math.max(AUDIO_VIEW_MS, Math.min(MAX_VIDEO_VIEW_MS, seconds * 1000)) : AUDIO_VIEW_MS);
            break;
        case 'document':
            baseDelay = isFresh ? FRESH_OTHER_VIEW_MS : DOCUMENT_VIEW_MS;
            break;
        case 'sticker':
            baseDelay = isFresh ? FRESH_OTHER_VIEW_MS : STICKER_VIEW_MS;
            break;
        case 'text':
            baseDelay = isFresh ? FRESH_OTHER_VIEW_MS : IMAGE_VIEW_MS;
            break;
        default:
            baseDelay = 1000;
    }
    const jitterBase = isFresh ? Math.min(1000, VIEW_JITTER_MS) : VIEW_JITTER_MS;
    const jitter = jitterBase > 0 ? randomBetween(-jitterBase, jitterBase) : 0;
    let finalDelay = Math.max(800, baseDelay + jitter);
    if (isRuntimeBusy()) {
        finalDelay = Math.min(finalDelay, RUNTIME_BUSY_MAX_VIEW_DELAY_MS);
    }
    return finalDelay;
}

async function simulateNaturalStatusView(sock, msg, mediaInfo, identity) {
    const waitMs = getNaturalViewDelayMs(mediaInfo, msg);
    const freshLabel = isFreshStatusMessage(msg) ? 'fresh' : 'normal';
    if (waitMs > 0) {
        if (DEBUG_STATUS_TYPE_DETECTION && !MINIMAL_CONSOLE) {
            logDebug(
                `read ${mediaInfo.type} ${identity.displayName}`,
                `${Math.ceil(waitMs / 1000)} detik | ${freshLabel}`
            );
        }
        await delay(waitMs);
    }
    await sock.readMessages([msg.key]);
    const postReadDelayMs = isRuntimeBusy() ? RUNTIME_BUSY_POST_READ_DELAY_MS : POST_READ_FORWARD_DELAY_MS;
    if (postReadDelayMs > 0) await delay(postReadDelayMs);
}

function normalizeTelegramCaptionText(value, maxLength = CAPTION_MAX_LENGTH) {
    const text = String(value || '')
        .replace(/\r\n?/g, '\n')
        .replace(/[ \t]+/g, ' ')
        .split('\n')
        .map((line) => line.trim())
        .join('\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
    return text ? truncateText(text, maxLength) : '';
}

function formatTelegramStatusType(value) {
    const label = String(value || '-').replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
    return label ? label.toUpperCase() : '-';
}

function formatTelegramStatusTimestamp(msg) {
    const timestampSeconds = parseTimestampSeconds(msg?.messageTimestamp);
    if (!Number.isFinite(timestampSeconds) || timestampSeconds <= 0) {
        return formatDisplayDateTime();
    }

    return `${new Date(timestampSeconds * 1000).toLocaleString('id-ID', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        timeZone: DISPLAY_TIME_ZONE
    })} WIB`;
}

function buildTelegramCaption(participant, mediaInfo, msg, maxLength = TELEGRAM_TEXT_LIMIT) {
    const identity = resolveContactIdentity(participant, msg);
    const displayName = normalizeTelegramCaptionText(identity.displayName || 'Tidak diketahui', DETAIL_MAX_LENGTH);
    const displayId = normalizeTelegramCaptionText(getTelegramDisplayId(identity, mediaInfo, msg) || '-', DETAIL_MAX_LENGTH);
    const mediaType = formatTelegramStatusType(mediaInfo.type);
    const statusCategory = formatTelegramStatusType(mediaInfo.statusCategory);
    const statusTime = formatTelegramStatusTimestamp(msg);
    const sourceLabel = normalizeTelegramCaptionText(formatTelegramSourceLabel(mediaInfo, msg), SOURCE_LABEL_MAX_LENGTH);
    const cleanCaption = normalizeTelegramCaptionText(mediaInfo.caption || '', CAPTION_MAX_LENGTH);
    const footer = normalizeTelegramCaptionText(TELEGRAM_FOOTER_TEXT, DETAIL_MAX_LENGTH);

    const metadataLines = [
        'STATUS WHATSAPP BARU',
        '',
        `Pengirim : ${displayName || 'Tidak diketahui'}`,
        `ID       : ${displayId || '-'}`,
        `Jenis    : ${mediaType}`,
        `Kategori : ${statusCategory}`,
        `Waktu    : ${statusTime}`
    ];

    if (sourceLabel) {
        metadataLines.push(`Sumber   : ${sourceLabel}`);
    }

    const build = (captionText) => {
        const lines = [...metadataLines];
        if (captionText) {
            lines.push('', 'ISI STATUS', '───────────', captionText);
        }
        if (footer) {
            lines.push('', '───────────', footer);
        }
        return lines.join('\n');
    };

    let result = build(cleanCaption);
    if (result.length <= maxLength) return result;

    const withoutCaption = build('');
    if (withoutCaption.length >= maxLength) {
        return truncateText(withoutCaption, maxLength);
    }

    const captionBudget = Math.max(0, maxLength - withoutCaption.length - 15);
    result = build(normalizeTelegramCaptionText(cleanCaption, captionBudget));
    return truncateText(result, maxLength);
}

function toBase64Safe(value) {
    try {
        if (!value) return '';
        return Buffer.from(value).toString('base64');
    } catch {
        return '';
    }
}

function buildStatusContentSignature(msg, participant, mediaInfo) {
    const raw = mediaInfo.raw || {};
    const ownerToken = getCanonicalStatusOwnerToken(msg, participant, mediaInfo);
    const remote = normalizeJid(msg?.key?.remoteJid || 'status@broadcast') || 'status@broadcast';
    const fileSha256 = toBase64Safe(raw.fileSha256);
    const fileEncSha256 = toBase64Safe(raw.fileEncSha256);
    const mediaKey = toBase64Safe(raw.mediaKey);
    const directPath = raw.directPath || '';
    const fileLength = String(raw.fileLength || raw.fileLengthLow || '');
    const digest = crypto
        .createHash('sha256')
        .update([
            remote,
            ownerToken,
            mediaInfo.type || '',
            fileSha256,
            fileEncSha256,
            mediaKey,
            directPath,
            fileLength,
            mediaInfo.mimetype || ''
        ].join('|'))
        .digest('hex');
    return `content:${digest}`;
}

function buildStatusPrimaryKey(msg, participant, mediaInfo) {
    const raw = mediaInfo.raw || {};
    const ownerToken = getCanonicalStatusOwnerToken(msg, participant, mediaInfo);
    const remote = normalizeJid(msg?.key?.remoteJid || 'status@broadcast') || 'status@broadcast';
    const messageId = normalizeStorageString(msg.key?.id || '', 255);
    const fileSha256 = toBase64Safe(raw.fileSha256);
    const fileEncSha256 = toBase64Safe(raw.fileEncSha256);
    const mediaKey = toBase64Safe(raw.mediaKey);
    const directPath = raw.directPath || '';
    const contentSignature = buildStatusContentSignature(msg, participant, mediaInfo);

    if (messageId) return `status:${remote}:${messageId}`;
    if (fileSha256) return `status:${ownerToken}:${mediaInfo.type}:sha:${fileSha256}`;
    if (fileEncSha256) return `status:${ownerToken}:${mediaInfo.type}:enc:${fileEncSha256}`;
    if (directPath) return `status:${ownerToken}:${mediaInfo.type}:path:${directPath}`;
    if (mediaKey) return `status:${ownerToken}:${mediaInfo.type}:media:${mediaKey}`;
    return `status:${ownerToken}:${mediaInfo.type}:${contentSignature}`;
}

function buildStatusFingerprints(msg, participant, mediaInfo) {
    const raw = mediaInfo.raw || {};
    const fileSha256 = toBase64Safe(raw.fileSha256);
    const fileEncSha256 = toBase64Safe(raw.fileEncSha256);
    const mediaKey = toBase64Safe(raw.mediaKey);
    const directPath = raw.directPath || '';
    const ownerToken = getCanonicalStatusOwnerToken(msg, participant, mediaInfo);
    const remote = normalizeJid(msg?.key?.remoteJid || 'status@broadcast') || 'status@broadcast';
    const messageId = normalizeStorageString(msg.key?.id || '', 255);
    const contentSignature = buildStatusContentSignature(msg, participant, mediaInfo);

    return [...new Set([
        messageId && `remote-msgid:${remote}:${messageId}`,
        messageId && `owner-msgid:${ownerToken}:${messageId}`,
        fileSha256 && `sha256:${ownerToken}:${mediaInfo.type}:${fileSha256}`,
        fileEncSha256 && `encsha:${ownerToken}:${mediaInfo.type}:${fileEncSha256}`,
        mediaKey && `mediakey:${ownerToken}:${mediaInfo.type}:${mediaKey}`,
        directPath && `path:${ownerToken}:${mediaInfo.type}:${directPath}`,
        contentSignature
    ].filter(Boolean))];
}

function buildBufferFingerprint(buffer, participant, mediaInfo, msg = null) {
    const digest = crypto.createHash('sha256').update(buffer).digest('hex');
    const ownerToken = getCanonicalStatusOwnerToken(msg, participant, mediaInfo);
    return `buffer:${ownerToken}:${mediaInfo.type}:${digest}`;
}

async function isProcessedFingerprint(fingerprint) {
    if (!fingerprint) return false;
    return (await analyzeAiAntiSpam([fingerprint])).exists;
}

async function reserveFingerprints(statusPrimaryKey, fingerprints, probe = null) {
    const keysToCheck = [statusPrimaryKey, ...(Array.isArray(fingerprints) ? fingerprints : [])].filter(Boolean);
    const analysis = await analyzeAiAntiSpam(keysToCheck);
    if (analysis.exists) {
        return false;
    }

    const existingRecord = findExistingStatusRecord(statusPrimaryKey, probe || {});
    if (existingRecord) {
        return false;
    }

    if (statusPrimaryKey) processingStatusKeys.add(statusPrimaryKey);
    fingerprints.forEach((fingerprint) => processingFingerprints.add(fingerprint));
    return true;
}

function releaseFingerprints(statusPrimaryKey, fingerprints) {
    if (statusPrimaryKey) processingStatusKeys.delete(statusPrimaryKey);
    fingerprints.forEach((fingerprint) => processingFingerprints.delete(fingerprint));
}

async function markFingerprintsProcessed(statusPrimaryKey, fingerprints, meta) {
    const processedAtIso = new Date().toISOString();
    const processedAtMs = new Date(processedAtIso).getTime();
    const normalizedParticipant = normalizeStorageIdentity(meta.participant || '').value;
    const normalizedRemoteJid = normalizeStorageIdentity(meta.remoteJid || '').value;
    const normalizedChatScope = normalizeStorageString(meta.chatScope || '', 50);
    const normalizedSourceType = normalizeStorageString(meta.sourceType || '', 50);
    const normalizedType = normalizeStorageString(meta.type || '', 50);
    const normalizedMessageId = normalizeStorageString(meta.messageId || '', 255);
    const normalizedDisplayName = normalizeStorageString(meta.displayName || '', 255);
    const normalizedContentSignature = normalizeStorageString(meta.contentSignature || '', 255);
    const fingerprintRows = [statusPrimaryKey, normalizedContentSignature].filter(Boolean).map((fingerprint) => ({
        fingerprint,
        processedAt: processedAtMs,
        participant: normalizedParticipant,
        type: normalizedType,
        messageId: normalizedMessageId,
        displayName: normalizedDisplayName
    }));

    if (hasAntiSpamSqlite() && statusPrimaryKey) {
        try {
            await withRetries(async () => {
                antiSpamStatements.writeStatusPacket({
                    statusPrimaryKey,
                    processedAt: processedAtMs,
                    participant: normalizedParticipant,
                    remoteJid: normalizedRemoteJid,
                    chatScope: normalizedChatScope,
                    sourceType: normalizedSourceType,
                    mediaType: normalizedType,
                    messageId: normalizedMessageId,
                    contentSignature: normalizedContentSignature,
                    displayName: normalizedDisplayName
                }, fingerprintRows);

                const verifyRecord = antiSpamStatements.getStatusRecord.get(statusPrimaryKey)
                    || (normalizedContentSignature ? antiSpamStatements.findStatusRecordByContentSignature.get(normalizedContentSignature) : null);
                if (!verifyRecord?.status_primary_key) {
                    throw new Error('sqlite_status_record_verify_failed');
                }
                if (!antiSpamStatements.hasFingerprint.get(statusPrimaryKey)) {
                    throw new Error('sqlite_fingerprint_verify_failed');
                }
            }, Number(OPERATIONS.databaseWriteRetryAttempts || 2), {
                auditReason: 'sqlite_status_write_retry',
                meta: {
                    statusPrimaryKey,
                    participant: normalizedParticipant,
                    remoteJid: normalizedRemoteJid,
                    chatScope: normalizedChatScope,
                    sourceType: normalizedSourceType,
                    mediaType: normalizedType,
                    messageId: normalizedMessageId,
                    contentSignature: normalizedContentSignature
                }
            });
        } catch (error) {
            warnAntiSpamStorage(error?.message || 'sqlite_insert_failed');
            recordFailedJob('sqlite_status_write', {
                statusPrimaryKey,
                participant: normalizedParticipant,
                remoteJid: normalizedRemoteJid,
                chatScope: normalizedChatScope,
                sourceType: normalizedSourceType,
                mediaType: normalizedType,
                messageId: normalizedMessageId,
                contentSignature: normalizedContentSignature
            }, error?.message || String(error));
        }
    }

    if (statusPrimaryKey) {
        processedStatusCache.set(statusPrimaryKey, true, DUPLICATE_RETENTION_SECONDS);
        processingStatusKeys.delete(statusPrimaryKey);
    }

    fingerprints.forEach((fingerprint) => {
        processedStatusCache.set(fingerprint, true, DUPLICATE_RETENTION_SECONDS);
        processingFingerprints.delete(fingerprint);
    });
}

function getMediaSizeBytes(mediaInfo) {
    const raw = mediaInfo.raw || {};
    const fileLength = Number(raw.fileLength || raw.fileLengthLow || 0);
    return Number.isFinite(fileLength) ? fileLength : 0;
}

function isStatusTooOld(msg) {
    if (!SKIP_STATUSES_OLDER_THAN_MINUTES) return false;
    const timestampSeconds = parseTimestampSeconds(msg.messageTimestamp);
    if (!timestampSeconds) return false;
    const ageMs = Date.now() - (timestampSeconds * 1000);
    return ageMs > (SKIP_STATUSES_OLDER_THAN_MINUTES * 60 * 1000);
}

function isHistoryStatusExpired(msg) {
    const timestampSeconds = parseTimestampSeconds(msg?.messageTimestamp);
    if (!timestampSeconds) return false;
    const ageMs = Date.now() - (timestampSeconds * 1000);
    return ageMs > HISTORY_STATUS_MAX_AGE_MS;
}

function isMediaTooLarge(mediaInfo) {
    const sizeBytes = getMediaSizeBytes(mediaInfo);
    if (!sizeBytes) return false;
    return sizeBytes > (MAX_MEDIA_SIZE_MB * 1024 * 1024);
}

function getCacheCount(cache, key) {
    return Number(cache.get(key) || 0);
}

function getPendingQueueSize() {
    return urgentStatusQueue.length + normalStatusQueue.length;
}

function getMessageSnapshotKey(key = {}) {
    const remoteJid = normalizeJid(key?.remoteJid || '');
    const messageId = String(key?.id || '').trim();
    return remoteJid && messageId ? `${remoteJid}:${messageId}` : '';
}

function pruneMessageSnapshotCache() {
    while (messageSnapshotCache.size > STATUS_MESSAGE_CACHE_LIMIT) {
        const oldestKey = messageSnapshotCache.keys().next().value;
        if (!oldestKey) break;
        messageSnapshotCache.delete(oldestKey);
    }
}

function cacheMessageSnapshot(msg) {
    const snapshotKey = getMessageSnapshotKey(msg?.key);
    if (!snapshotKey || !msg?.message) return;
    messageSnapshotCache.delete(snapshotKey);
    messageSnapshotCache.set(snapshotKey, msg);
    pruneMessageSnapshotCache();
}

function getMessageSnapshot(key) {
    const snapshotKey = getMessageSnapshotKey(key);
    if (!snapshotKey) return null;
    const snapshot = messageSnapshotCache.get(snapshotKey) || null;
    if (snapshot) {
        messageSnapshotCache.delete(snapshotKey);
        messageSnapshotCache.set(snapshotKey, snapshot);
    }
    return snapshot;
}

function cacheMessageUpdate(entry) {
    if (!entry || typeof entry !== 'object') return null;
    const key = entry.key || entry.update?.key;
    if (!key) return null;
    const previous = getMessageSnapshot(key) || {};
    const message = entry.update?.message || entry.message || previous.message;
    if (!message) return previous;
    const snapshot = {
        ...previous,
        ...entry,
        key,
        message,
        messageTimestamp: entry.update?.messageTimestamp || entry.messageTimestamp || previous.messageTimestamp || Math.floor(Date.now() / 1000),
        pushName: entry.update?.pushName || entry.pushName || previous.pushName || '',
        participant: entry.update?.participant || entry.participant || previous.participant || key.participant,
        participantPn: entry.update?.participantPn || entry.participantPn || previous.participantPn || key.participantPn,
        senderPn: entry.update?.senderPn || entry.senderPn || previous.senderPn || ''
    };
    cacheMessageSnapshot(snapshot);
    return snapshot;
}

function getQueueMessageKey(msg, mediaInfo = null) {
    const remote = normalizeJid(msg?.key?.remoteJid || 'status@broadcast') || 'status@broadcast';
    const id = msg?.key?.id || mediaInfo?.referencedKey?.id || '';
    if (id) {
        return `${remote}|${id}`;
    }
    const ownerToken = getCanonicalStatusOwnerToken(msg, '', mediaInfo);
    return `${remote}|${ownerToken}|-`;
}

function buildMessageMeta(msg, mediaInfo = null, identity = null) {
    return {
        messageId: msg?.key?.id || '',
        remoteJid: msg?.key?.remoteJid || '',
        participant: msg?.key?.participant || msg?.participant || '',
        participantPn: msg?.key?.participantPn || msg?.participantPn || msg?.senderPn || '',
        mediaType: mediaInfo?.type || '',
        statusCategory: mediaInfo?.statusCategory || '',
        displayName: identity?.displayName || '',
        identityId: identity?.preferredJid || identity?.jid || ''
    };
}

function isOwnStatusMessage(msg, participant, mediaInfo) {
    const candidates = [
        participant,
        mediaInfo?.authorJid,
        msg?.key?.participantPn,
        msg?.participantPn,
        msg?.senderPn,
        msg?.key?.participant,
        msg?.participant,
        msg?.key?.remoteJid
    ].map(normalizeJid).filter(Boolean);

    if (msg?.key?.fromMe === true) return true;
    return candidates.some((candidate) => isSelfJid(candidate));
}

function incrementCacheCount(cache, key) {
    const current = getCacheCount(cache, key) + 1;
    cache.set(key, current, 3600);
    return current;
}

function isRateLimited(identity) {
    const totalCount = getCacheCount(totalForwardRateCache, 'global');
    if (totalCount >= MAX_TOTAL_FORWARDS_PER_HOUR) return { limited: true, reason: 'batas total per jam' };
    const contactCount = getCacheCount(contactForwardRateCache, identity.jid || identity.preferredJid || identity.number || 'unknown');
    if (contactCount >= MAX_CONTACT_FORWARDS_PER_HOUR) return { limited: true, reason: `batas per kontak per jam (${identity.displayName})` };
    return { limited: false, reason: '' };
}

function markForwardCount(identity) {
    incrementCacheCount(totalForwardRateCache, 'global');
    incrementCacheCount(contactForwardRateCache, identity.jid || identity.preferredJid || identity.number || 'unknown');
}

function detectMessageScope(msg) {
    const remoteJid = normalizeJid(msg?.key?.remoteJid || '');
    if (!remoteJid) return 'unknown';
    if (remoteJid === 'status@broadcast') return 'status';
    const domain = getJidDomain(remoteJid);
    if (domain === 'g.us') return 'group';
    if (domain === 'newsletter') return 'newsletter';
    if (domain === 'broadcast') return 'broadcast';
    if (domain === 's.whatsapp.net') return 'private';
    return domain || 'unknown';
}

function isLikelyOwnBroadcastStatus(msg, mediaInfo = null) {
    const remoteJid = normalizeJid(msg?.key?.remoteJid || '');
    if (remoteJid !== 'status@broadcast') return false;

    const rawCandidates = [
        msg?.key?.participantPn,
        msg?.participantPn,
        msg?.senderPn,
        msg?.key?.participant,
        msg?.participant,
        mediaInfo?.authorJid
    ].map(normalizeJid).filter(Boolean);

    if (rawCandidates.some((candidate) => isSelfJid(candidate) || (PAIRING_PHONE_JID && candidate === PAIRING_PHONE_JID))) {
        return true;
    }

    return rawCandidates.length === 0;
}

function isOwnStatusLikeMessage(msg) {
    if (!msg?.message || !isStatusLikeMessage(msg)) return false;
    if (msg?.key?.fromMe === true) return true;

    const mediaInfo = extractStatusMediaInfo(msg.message, msg);
    if (!mediaInfo) return false;
    if (isLikelyOwnBroadcastStatus(msg, mediaInfo)) return true;

    const participant = getStatusSourceParticipant(msg, mediaInfo)
        || normalizeJid(msg?.key?.participantPn || msg?.participantPn || msg?.senderPn || msg?.key?.participant || msg?.participant || '');

    if (participant && isSelfJid(participant)) return true;
    if (mediaInfo?.authorJid && isSelfJid(mediaInfo.authorJid)) return true;
    if (PAIRING_PHONE_JID && [participant, mediaInfo?.authorJid].map(normalizeJid).includes(PAIRING_PHONE_JID)) return true;

    return false;
}

async function fetchTelegram(endpoint, options) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TELEGRAM_REQUEST_TIMEOUT_MS);
    try {
        return await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/${endpoint}`, { ...options, signal: controller.signal });
    } finally {
        clearTimeout(timeout);
    }
}

async function withRetries(task, retries, options = {}) {
    let lastError;
    for (let attempt = 0; attempt <= retries; attempt += 1) {
        try {
            return await task(attempt + 1);
        } catch (error) {
            lastError = error;
            if (attempt < retries) {
                const nextAttempt = attempt + 2;
                const waitMs = Math.min(RETRY_MAX_DELAY_MS, RETRY_BASE_DELAY_MS * (attempt + 1));
                if (options.metricKey) incrementMetric(options.metricKey, 1);
                if (options.auditReason) {
                    recordAudit(options.auditReason, {
                        attempt: nextAttempt,
                        waitMs,
                        error: error?.message || String(error),
                        ...(options.meta || {})
                    }, 'warn');
                }
                await delay(waitMs);
            }
        }
    }
    throw lastError;
}

async function sendTelegramText(text) {
    try {
        const result = await withRetries(async () => {
            const response = await fetchTelegram('sendMessage', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text: String(text || '').slice(0, TELEGRAM_TEXT_LIMIT) })
            });
            const result = await response.json();
            if (!response.ok || !result.ok) throw new Error(result.description || `Telegram API error ${response.status}`);
            return result;
        }, TELEGRAM_MAX_RETRIES, { metricKey: 'telegramRetried', auditReason: 'telegram_retry_send_text' });
        incrementMetric('telegramSent', 1);
        updateHealth({ lastTelegramSuccessAt: new Date().toISOString() });
        return result;
    } catch (error) {
        void sendOperationalAlert('telegram_gagal_kirim', error?.message || String(error), { sendTelegram: false, sendWhatsapp: true });
        throw error;
    }
}

async function sendToTelegram(buffer, mediaInfo, participant, msg) {
    if (mediaInfo.type === 'text') {
        const caption = buildTelegramCaption(participant, mediaInfo, msg, TELEGRAM_TEXT_LIMIT);
        return sendTelegramText(caption);
    }

    const { method, field } = getTelegramSendMethod(mediaInfo.type);
    const ext = getExtensionFromMime(mediaInfo.mimetype);
    const fileName = mediaInfo.fileName || `status_${mediaInfo.type}_${Date.now()}.${ext}`;
    const caption = buildTelegramCaption(participant, mediaInfo, msg, TELEGRAM_MEDIA_CAPTION_LIMIT);

    try {
        const result = await withRetries(async () => {
            const formData = new FormData();
            formData.append('chat_id', TELEGRAM_CHAT_ID);
            formData.append('caption', caption);
            formData.append(field, new Blob([buffer], { type: mediaInfo.mimetype || 'application/octet-stream' }), fileName);
            const response = await fetchTelegram(method, { method: 'POST', body: formData });
            const result = await response.json();
            if (!response.ok || !result.ok) throw new Error(result.description || `Telegram API error ${response.status}`);
            return result;
        }, TELEGRAM_MAX_RETRIES, { metricKey: 'telegramRetried', auditReason: 'telegram_retry_send_media', meta: { method, mediaType: mediaInfo.type } });

        incrementMetric('telegramSent', 1);
        updateHealth({ lastTelegramSuccessAt: new Date().toISOString() });
        return result;
    } catch (error) {
        void sendOperationalAlert('telegram_gagal_kirim_media', `${mediaInfo.type || 'media'} | ${error?.message || String(error)}`, { sendTelegram: false, sendWhatsapp: true });
        throw error;
    }
}

function getStatusLikeTargetJid(msg) {
    if (msg?.key?.remoteJid === 'status@broadcast') return 'status@broadcast';
    if (msg?.key?.remoteJid) return msg.key.remoteJid;
    return 'status@broadcast';
}

function getStatusLikeParticipants(msg, participant, mediaInfo, identity) {
    const candidates = [
        participant,
        msg?.key?.participantPn,
        msg?.participantPn,
        msg?.senderPn,
        mediaInfo?.authorJid,
        identity?.preferredJid,
        identity?.jid,
        msg?.key?.participant,
        msg?.participant
    ].map(normalizeJid).filter(Boolean);

    return [...new Set(candidates)].slice(0, STATUS_LIKE_PARTICIPANT_FALLBACKS);
}

function getStatusLikeFallbackTargets(msg, participant, mediaInfo, identity) {
    const candidates = [
        getStatusLikeTargetJid(msg),
        participant,
        mediaInfo?.authorJid,
        identity?.preferredJid,
        identity?.jid,
        msg?.key?.participant,
        msg?.participant,
        msg?.key?.remoteJid
    ].map(normalizeJid).filter(Boolean);

    return [...new Set(candidates)].filter((jid) => jid !== 'status@broadcast');
}

async function sendStatusLike(sock, msg, participant, mediaInfo, identity) {
    if (runtimeState.pauseLike) {
        recordAudit('status_like_paused', buildMessageMeta(msg, mediaInfo, identity), 'info');
        return;
    }
    if (!AUTO_LIKE_STATUS || !msg?.key?.id) return;
    if (mediaInfo.type === 'status-notification' || mediaInfo.type === 'unknown' || mediaInfo.isViewOnce) return;
    const statusParticipants = getStatusLikeParticipants(msg, participant, mediaInfo, identity);
    let lastPrimaryError = null;

    for (const statusParticipant of statusParticipants) {
        try {
            await withRetries(
                async () => {
                    await sock.sendMessage('status@broadcast', { react: { text: AUTO_LIKE_EMOJI, key: msg.key } }, { statusJidList: [statusParticipant] });
                },
                LIKE_RETRIES,
                {
                    metricKey: 'likeRetried',
                    auditReason: 'status_like_retry_primary',
                    meta: { ...buildMessageMeta(msg, mediaInfo, identity), statusParticipant }
                }
            );
            incrementMetric('statusLiked', 1);
            recordAudit('status_liked', { ...buildMessageMeta(msg, mediaInfo, identity), statusParticipant }, 'info');
            logLike(identity, mediaInfo);
            return;
        } catch (error) {
            lastPrimaryError = error;
        }
    }

    if (STATUS_LIKE_FALLBACK_ENABLED) {
        const fallbackTargets = getStatusLikeFallbackTargets(msg, participant, mediaInfo, identity);
        for (const fallbackTarget of fallbackTargets) {
            try {
                await withRetries(
                    async () => {
                        await sock.sendMessage(fallbackTarget, { react: { text: AUTO_LIKE_EMOJI, key: msg.key } });
                    },
                    LIKE_RETRIES,
                    {
                        metricKey: 'likeRetried',
                        auditReason: 'status_like_retry_fallback',
                        meta: { ...buildMessageMeta(msg, mediaInfo, identity), fallbackTarget }
                    }
                );
                incrementMetric('statusLiked', 1);
                incrementMetric('likeFallbackUsed', 1);
                recordAudit('status_like_fallback_success', { ...buildMessageMeta(msg, mediaInfo, identity), fallbackTarget }, 'warn');
                logLike(identity, mediaInfo);
                return;
            } catch (fallbackError) {
                lastPrimaryError = fallbackError;
            }
        }
    }

    incrementMetric('likeFailed', 1);
    recordFailedJob('status_like', buildMessageMeta(msg, mediaInfo, identity), lastPrimaryError?.message || 'auto_like_failed');
    updateHealth({ lastErrorAt: new Date().toISOString(), lastErrorMessage: `status_like:${lastPrimaryError?.message || 'failed'}` });
    recordAudit('status_like_failed', { ...buildMessageMeta(msg, mediaInfo, identity), error: lastPrimaryError?.message || 'failed' }, 'warn');
    logError('Auto like', lastPrimaryError?.message || 'gagal');
}

async function applyAntiCallPrivacy(sock) {
    if (PRIVACY_HARDENING_ENABLED) {
        const hardeningSteps = [
            ['updateLastSeenPrivacy', PRIVACY_LAST_SEEN, 'last seen privacy'],
            ['updateOnlinePrivacy', PRIVACY_ONLINE, 'online privacy'],
            ['updateProfilePicturePrivacy', PRIVACY_PROFILE_PHOTO, 'profile photo privacy'],
            ['updateStatusPrivacy', PRIVACY_STATUS, 'status privacy'],
            ['updateGroupsAddPrivacy', PRIVACY_GROUP_ADD, 'group add privacy'],
            ['updateReadReceiptsPrivacy', PRIVACY_READ_RECEIPTS, 'read receipts privacy']
        ];

        for (const [methodName, value, label] of hardeningSteps) {
            if (typeof sock[methodName] !== 'function') continue;
            try {
                await sock[methodName](value);
            } catch (error) {
                logError(label, error.message);
            }
        }
    }

    if (!ANTI_CALL_ENABLED || !ANTI_CALL_SET_PRIVACY) return;
    if (typeof sock.updateCallPrivacy !== 'function') return;
    try {
        await sock.updateCallPrivacy(ANTI_CALL_PRIVACY_MODE);
    } catch (error) {
        logError('Call privacy', error.message);
    }
}

function buildCallNotification(identity, call, actions) {
    const displayId = getTelegramDisplayId(identity, null, { key: { remoteJid: call?.from || call?.chatId || '' } });
    const lines = [
        'Panggilan WhatsApp diblokir',
        `Dari: ${identity.displayName}`,
        `ID: ${displayId}`,
        `Jenis: ${call?.isVideo ? 'VIDEO' : 'VOICE'}`,
        `Status: ${String(call?.status || 'unknown').toUpperCase()}`,
        `Aksi: ${actions.join(' + ')}`,
        `Waktu: ${formatDisplayDateTime()}`
    ];
    return lines.join('\n');
}

function getAntiCallMessage(call) {
    return call?.isVideo ? ANTI_CALL_BUSY_MESSAGE_VIDEO : ANTI_CALL_BUSY_MESSAGE_VOICE;
}

async function sendAntiCallMessage(sock, identity, call) {
    const targets = [
        identity?.preferredJid,
        identity?.jid,
        normalizeJid(call?.from || ''),
        normalizeJid(call?.chatId || '')
    ].filter(Boolean);

    const uniqueTargets = [...new Set(targets)];
    const busyMessage = getAntiCallMessage(call);
    let lastError = null;

    for (const target of uniqueTargets) {
        try {
            await withRetries(async () => {
                await sock.sendMessage(target, { text: busyMessage });
            }, 1);
            return { target, busyMessage };
        } catch (error) {
            lastError = error;
        }
    }

    if (lastError) {
        throw lastError;
    }

    throw new Error('anti_call_message_target_not_found');
}

async function handleIncomingCalls(sock, calls = []) {
    if (runtimeState.pauseAntiCall) {
        recordAudit('anti_call_paused', { count: Array.isArray(calls) ? calls.length : 0 }, 'info');
        return;
    }
    if (!ANTI_CALL_ENABLED || !Array.isArray(calls) || calls.length === 0) return;
    for (const call of calls) {
        try {
            if (!call) continue;
            const callerJid = normalizeJid(call.from || call.chatId || '');
            if (!callerJid) continue;

            const isGroupCall = call.isGroup === true || getJidDomain(callerJid) === 'g.us';
            const identity = isGroupCall
                ? {
                    jid: callerJid,
                    preferredJid: callerJid,
                    number: getNumberFromJid(callerJid),
                    savedName: '',
                    profileName: '',
                    pushName: sanitizeName(call.name || ''),
                    isSaved: false,
                    isUserSaved: false,
                    isUnsavedByUser: true,
                    hasStoredContactRecord: false,
                    displayName: sanitizeName(call.name || 'Group Call') || callerJid
                }
                : resolveContactIdentity(callerJid, { pushName: call.name || '' });

            if (String(call.status || '').toLowerCase() === 'offer') {
                const actions = [];
                if (ANTI_CALL_REJECT_DELAY_MS > 0) await delay(ANTI_CALL_REJECT_DELAY_MS);

                if (ANTI_CALL_REJECT_INCOMING && typeof sock.rejectCall === 'function') {
                    await sock.rejectCall(call.id, call.from || call.chatId);
                    actions.push('REJECT');
                    incrementMetric('callsRejected', 1);
                    touchSignalHealth('antiCall', isGroupCall ? `group_${call?.isVideo ? 'video' : 'voice'}` : (call?.isVideo ? 'video' : 'voice'));
                    recordAudit('call_rejected', {
                        from: call.from || '',
                        chatId: call.chatId || '',
                        status: call.status || '',
                        isVideo: call.isVideo === true,
                        isGroup: isGroupCall
                    }, 'warn');
                    logCall(call, identity, 'REJECT');
                }

                if (isGroupCall) {
                    recordAudit('group_call_rejected_without_message', {
                        from: call.from || '',
                        chatId: call.chatId || '',
                        isVideo: call.isVideo === true,
                        actions
                    }, 'info');
                    continue;
                }

                if (ANTI_CALL_SEND_BUSY_MESSAGE) {
                    try {
                        const sent = await sendAntiCallMessage(sock, identity, call);
                        actions.push('MESSAGE');
                        recordAudit('call_busy_message_sent', { to: sent.target, from: call.from || '', message: sent.busyMessage }, 'info');
                    } catch (error) {
                        recordFailedJob('call_busy_message', { from: call?.from || '', callId: call?.id || '', isVideo: call?.isVideo === true }, error?.message || String(error));
                        recordAudit('call_busy_message_failed', { from: call.from || '', error: error?.message || String(error), isVideo: call?.isVideo === true }, 'warn');
                    }
                }
                if (ANTI_CALL_AUTO_BLOCK_CALLER && typeof sock.updateBlockStatus === 'function') {
                    if (ANTI_CALL_BLOCK_DELAY_MS > 0) await delay(ANTI_CALL_BLOCK_DELAY_MS);
                    const blockTarget = call.from || callerJid;
                    await sock.updateBlockStatus(blockTarget, 'block');
                    actions.push('BLOCK');
                    incrementMetric('callsBlocked', 1);
                    touchSignalHealth('autoBlock', call?.isVideo ? 'video' : 'voice');
                    recordAudit('call_blocked', { from: blockTarget, status: call.status || '', isVideo: call.isVideo === true }, 'warn');
                    logCall(call, identity, 'BLOCK');
                }
                if (actions.includes('BLOCK')) recordBlockedCaller(identity, call, actions);
                if (ANTI_CALL_NOTIFY_TELEGRAM && actions.length > 0) await sendTelegramText(buildCallNotification(identity, call, actions));
            }
        } catch (error) {
            recordFailedJob('call_handler', { from: call?.from || '', callId: call?.id || '' }, error?.message || String(error));
            updateHealth({ lastErrorAt: new Date().toISOString(), lastErrorMessage: `call_handler:${error?.message || error}` });
            logError('Call handler', error.message);
        }
    }
}

async function drainStatusQueue() {
    if (queueActive) return;
    queueActive = true;
    while (urgentStatusQueue.length > 0 || normalStatusQueue.length > 0) {
        const current = urgentStatusQueue.shift() || normalStatusQueue.shift();
        if (!current) break;
        syncQueueHealth();

        if (current.socketGeneration && current.socketGeneration !== activeSocketGeneration) {
            rememberStatusTaskForReconnect(current);
            if (current.queueKey) queuedStatusKeys.delete(current.queueKey);
            recordAudit('queue_task_stale_socket_skip', {
                queueKey: current.queueKey || '',
                socketGeneration: current.socketGeneration,
                activeSocketGeneration
            }, 'warn');
            continue;
        }

        if (QUEUE_STALE_TASK_MS > 0 && current.createdAt && (Date.now() - current.createdAt) > QUEUE_STALE_TASK_MS) {
            if (current.queueKey) queuedStatusKeys.delete(current.queueKey);
            incrementMetric('statusSkipped', 1);
            incrementMetric('statusQueueStaleSkipped', 1);
            recordAudit('queue_task_stale_skip', {
                queueKey: current.queueKey || '',
                ageMs: Date.now() - current.createdAt,
                attempt: current.attempt || 1
            }, 'warn');
            continue;
        }

        const fastCapture = current.urgent === true && CAPTURE_FRESH_STATUSES_FAST;
        const minGap = fastCapture ? 0 : (current.urgent ? URGENT_TASK_GAP_MS : MIN_TASK_GAP_MS);
        const maxGap = fastCapture ? Math.min(120, URGENT_TASK_GAP_MAX_MS) : (current.urgent ? URGENT_TASK_GAP_MAX_MS : MAX_TASK_GAP_MS);
        if (maxGap > 0) {
            const gap = randomBetween(minGap, maxGap);
            if (gap > 0) await delay(gap);
        }
        try {
            await current.taskFactory();
            if (current.queueKey) queuedStatusKeys.delete(current.queueKey);
        } catch (error) {
            const attempt = Number(current.attempt || 1);
            const maxAttempts = Number(current.maxAttempts || 1);
            const canRetry = attempt < maxAttempts && isTransientError(error);
            if (canRetry) {
                incrementMetric('statusRetried', 1);
                recordAudit('queue_task_retry', {
                    queueKey: current.queueKey || '',
                    attempt,
                    nextAttempt: attempt + 1,
                    maxAttempts,
                    error: error?.message || String(error)
                }, 'warn');
                if (current.queueKey) queuedStatusKeys.delete(current.queueKey);
                const retryTimer = setTimeout(() => {
                    pendingQueueRetryTimers.delete(retryTimer);
                    enqueueStatusTask(current.taskFactory, {
                        urgent: current.urgent === true,
                        queueKey: current.queueKey,
                        attempt: attempt + 1,
                        maxAttempts,
                        createdAt: current.createdAt,
                        message: current.message,
                        socketGeneration: current.socketGeneration || 0
                    });
                }, STATUS_TASK_RETRY_DELAY_MS);
                pendingQueueRetryTimers.add(retryTimer);
            } else {
                if (current.queueKey) queuedStatusKeys.delete(current.queueKey);
                logError('Queue', error.message);
            }
        }
    }
    queueActive = false;
    syncQueueHealth();
}

function trimQueueIfNeeded(isUrgent) {
    if (isUrgent) {
        while (urgentStatusQueue.length > MAX_URGENT_QUEUE_SIZE) {
            const removed = urgentStatusQueue.shift();
            if (removed?.queueKey) queuedStatusKeys.delete(removed.queueKey);
            incrementMetric('queueDrops', 1);
            recordAudit('queue_drop_urgent', { queueKey: removed?.queueKey || '' }, 'warn');
        }
    }
    while (getPendingQueueSize() > MAX_QUEUE_SIZE) {
        const removed = normalStatusQueue.shift() || urgentStatusQueue.shift();
        if (!removed) break;
        if (removed.queueKey) queuedStatusKeys.delete(removed.queueKey);
        incrementMetric('queueDrops', 1);
        recordAudit('queue_drop_total', { queueKey: removed?.queueKey || '' }, 'warn');
    }
    syncQueueHealth();
}

function rememberStatusTaskForReconnect(task) {
    if (!task?.message || !task.queueKey) return;
    const createdAt = Number(task.createdAt || Date.now());
    if (Date.now() - createdAt > RECONNECT_QUEUE_RETENTION_MS) return;
    if (pendingReconnectStatusTasks.some((pending) => pending.queueKey === task.queueKey)) return;
    pendingReconnectStatusTasks.push({
        message: task.message,
        urgent: task.urgent === true,
        queueKey: task.queueKey,
        attempt: task.attempt,
        maxAttempts: task.maxAttempts,
        createdAt
    });
    while (pendingReconnectStatusTasks.length > MAX_QUEUE_SIZE) {
        pendingReconnectStatusTasks.shift();
        incrementMetric('queueDrops', 1);
    }
}

function preserveQueueForReconnect() {
    const queuedTasks = [...urgentStatusQueue, ...normalStatusQueue];
    for (const task of queuedTasks) {
        rememberStatusTaskForReconnect(task);
    }
}

function flushReconnectStatusTasks(sock) {
    if (!sock || pendingReconnectStatusTasks.length === 0) return;
    const tasks = pendingReconnectStatusTasks.splice(0, pendingReconnectStatusTasks.length);
    const now = Date.now();
    for (const task of tasks) {
        if (!task?.message || now - Number(task.createdAt || now) > RECONNECT_QUEUE_RETENTION_MS) continue;
        incrementMetric('statusReconnectRequeued', 1);
        enqueueStatusTask(() => forwardStatusMedia(sock, task.message), {
            urgent: task.urgent,
            queueKey: task.queueKey,
            attempt: task.attempt,
            maxAttempts: task.maxAttempts,
            createdAt: task.createdAt,
            message: task.message,
            socketGeneration: activeSocket === sock ? activeSocketGeneration : 0
        });
    }
}

function clearQueuedStatusTasks(reason = 'manual') {
    if (reason === 'connection_close') {
        preserveQueueForReconnect();
    } else {
        pendingPreConnectHistoryMessages.length = 0;
        pendingPreConnectLiveMessages.length = 0;
        pendingPreConnectUpdates.length = 0;
        pendingReconnectStatusTasks.length = 0;
    }
    urgentStatusQueue.length = 0;
    normalStatusQueue.length = 0;
    queuedStatusKeys.clear();
    clearQueueRetryTimers();
    syncQueueHealth();
    recordAudit('queue_cleared', { reason }, 'info');
}

function enqueueStatusTask(taskFactory, options = {}) {
    const queueKey = options.queueKey || '';
    if (queueKey && DE_DUPLICATE_PENDING_QUEUE && queuedStatusKeys.has(queueKey)) {
        recordAudit('queue_duplicate_skip', { queueKey }, 'debug');
        return;
    }
    const task = {
        taskFactory,
        message: options.message || null,
        urgent: options.urgent === true,
        queueKey,
        attempt: Math.max(1, Number(options.attempt || 1)),
        maxAttempts: Math.max(1, Number(options.maxAttempts || (STATUS_TASK_RETRY_ATTEMPTS + 1))),
        createdAt: Number(options.createdAt || Date.now()),
        socketGeneration: Number(options.socketGeneration || activeSocketGeneration || 0)
    };
    if (queueKey && DE_DUPLICATE_PENDING_QUEUE) queuedStatusKeys.add(queueKey);
    if (task.urgent) urgentStatusQueue.push(task); else normalStatusQueue.push(task);
    syncQueueHealth();
    trimQueueIfNeeded(task.urgent);
    void drainStatusQueue();
}

function enqueueIncomingStatuses(sock, messages = [], source = 'live') {
    if (!Array.isArray(messages) || messages.length === 0) return;
    let detectedCount = 0;
    let historyAccepted = 0;
    for (const msg of messages) {
        cacheMessageSnapshot(msg);
        if (!isStatusLikeMessage(msg)) continue;
        if (SKIP_FROM_ME_STATUSES && isOwnStatusLikeMessage(msg)) {
            incrementMetric('statusFromMeSkipped', 1);
            continue;
        }
        if (source === 'history' && isHistoryStatusExpired(msg)) {
            incrementMetric('statusHistorySkippedOld', 1);
            continue;
        }
        if (source === 'history' && historyAccepted >= MAX_HISTORY_ENQUEUE_PER_SYNC) {
            recordAudit('history_sync_limit_reached', { limit: MAX_HISTORY_ENQUEUE_PER_SYNC }, 'warn');
            break;
        }
        detectedCount += 1;
        incrementMetric('statusDetected', 1);
        updateHealth({ lastStatusReceivedAt: new Date().toISOString() });
        const isFresh = source === 'live' ? isFreshStatusMessage(msg) : false;
        const queueKey = getQueueMessageKey(msg);
        enqueueStatusTask(() => forwardStatusMedia(sock, msg), {
            urgent: isFresh,
            queueKey,
            message: msg,
            socketGeneration: activeSocket === sock ? activeSocketGeneration : 0
        });
        if (source === 'history') historyAccepted += 1;
    }
    if (source === 'history' && detectedCount > 0 && DEBUG_STATUS_TYPE_DETECTION && !ULTRA_MINIMAL_CONSOLE) {
        logHistory(`${detectedCount} status dari sinkronisasi riwayat`);
    }
}

function bufferPreConnectMessages(targetBuffer, messages = [], limit = Math.max(50, MAX_HISTORY_ENQUEUE_PER_SYNC)) {
    if (!Array.isArray(messages) || messages.length === 0) return;
    targetBuffer.push(...messages);
    while (targetBuffer.length > limit) {
        targetBuffer.shift();
    }
}

function flushPreConnectEventBuffers(sock) {
    if (!waConnectionReady) return;

    if (pendingPreConnectHistoryMessages.length > 0) {
        const historyBatch = pendingPreConnectHistoryMessages.splice(0, pendingPreConnectHistoryMessages.length);
        if (HISTORY_CAPTURE_ENABLED) enqueueIncomingStatuses(sock, historyBatch, 'history');
    }

    if (pendingPreConnectLiveMessages.length > 0) {
        const liveBatch = pendingPreConnectLiveMessages.splice(0, pendingPreConnectLiveMessages.length);
        enqueueIncomingStatuses(sock, liveBatch, 'live');
    }

    if (pendingPreConnectUpdates.length > 0) {
        const updateBatch = pendingPreConnectUpdates.splice(0, pendingPreConnectUpdates.length);
        enqueueUpdatedStatuses(sock, updateBatch);
    }

    flushReconnectStatusTasks(sock);
}

function clearPendingNotificationsTimeout() {
    if (pendingNotificationsTimeout) {
        clearTimeout(pendingNotificationsTimeout);
        pendingNotificationsTimeout = null;
    }
}

function markWhatsAppReady(sock, reason = 'received_pending_notifications') {
    if (!sock || activeSocket !== sock || !waConnectionOpen || waConnectionReady) return;
    waConnectionReady = true;
    clearPendingNotificationsTimeout();
    updateHealth({
        status: 'CONNECTED',
        connectionCatchUpReason: reason,
        reconnectAttempts: 0
    });
    recordAudit('connection_caught_up', { reason }, 'info');
    flushPostConnectSystemMessages();
    flushPreConnectEventBuffers(sock);
}

function schedulePendingNotificationsFallback(sock, socketGeneration) {
    clearPendingNotificationsTimeout();
    pendingNotificationsTimeout = setTimeout(() => {
        pendingNotificationsTimeout = null;
        if (activeSocket !== sock || socketGeneration !== activeSocketGeneration || !waConnectionOpen || waConnectionReady) return;
        markWhatsAppReady(sock, 'pending_notifications_timeout');
    }, PENDING_NOTIFICATIONS_TIMEOUT_MS);
}

function buildMessageFromUpdate(updateEntry) {
    if (!updateEntry || typeof updateEntry !== 'object') return null;
    const key = updateEntry.key || updateEntry.update?.key;
    const snapshot = cacheMessageUpdate(updateEntry) || getMessageSnapshot(key);
    if (!snapshot?.key || !snapshot.message) return null;
    return snapshot;
}

function enqueueUpdatedStatuses(sock, updates = []) {
    if (!MESSAGE_UPDATE_FALLBACK || !Array.isArray(updates) || updates.length === 0) return;
    for (const entry of updates) {
        const hasInlineMessage = Boolean(entry?.update?.message || entry?.message);
        const msg = buildMessageFromUpdate(entry);
        if (!msg || !isStatusLikeMessage(msg)) continue;
        if (!hasInlineMessage) incrementMetric('statusSignalUpdatesRecovered', 1);
        if (SKIP_FROM_ME_STATUSES && isOwnStatusLikeMessage(msg)) {
            incrementMetric('statusFromMeSkipped', 1);
            continue;
        }
        incrementMetric('statusDetected', 1);
        updateHealth({ lastStatusReceivedAt: new Date().toISOString() });
        enqueueStatusTask(() => forwardStatusMedia(sock, msg), {
            urgent: isFreshStatusMessage(msg),
            queueKey: getQueueMessageKey(msg),
            message: msg,
            socketGeneration: activeSocket === sock ? activeSocketGeneration : 0
        });
    }
}

async function forwardStatusMedia(sock, msg) {
    if (runtimeState.pauseForward) {
        recordAudit('forward_paused', buildMessageMeta(msg), 'info');
        return;
    }
    if (!msg?.message || !isStatusLikeMessage(msg)) return;

    const mediaInfo = extractStatusMediaInfo(msg.message, msg);
    if (!mediaInfo) {
        recordAudit('status_extract_failed', buildMessageMeta(msg), 'warn');
        return;
    }

    logStatusDetection(msg, mediaInfo);
    const participant = getStatusSourceParticipant(msg, mediaInfo);
    if (!participant) {
        recordAudit('status_missing_participant', buildMessageMeta(msg, mediaInfo), 'warn');
        if (DEBUG_STATUS_TYPE_DETECTION && !ULTRA_MINIMAL_CONSOLE) {
            logDebug('Status terdeteksi tetapi participant belum bisa dipetakan');
        }
        return;
    }

    const identity = resolveContactIdentity(participant, msg);

            if (SKIP_FROM_ME_STATUSES && isOwnStatusMessage(msg, participant, mediaInfo)) {

        incrementMetric('statusSkipped', 1);
        incrementMetric('statusFromMeSkipped', 1);
        recordAudit('status_skip_from_me', buildMessageMeta(msg, mediaInfo, identity), 'info');
        return;
    }

    if (mediaInfo.type === 'status-notification') {
        await captureStatusReference(mediaInfo, identity, msg);
        recordAudit('status_reference_only', buildMessageMeta(msg, mediaInfo, identity), 'info');
        if (DEBUG_STATUS_TYPE_DETECTION && !ULTRA_MINIMAL_CONSOLE) {
            logDebug(`${mediaInfo.statusCategory} | ${identity.displayName}`, 'notifikasi referensi');
        }
        return;
    }

    if (mediaInfo.isViewOnce) {
        incrementMetric('statusSkipped', 1);
        recordAudit('status_skip_view_once_disabled', buildMessageMeta(msg, mediaInfo, identity), 'info');
        return;
    }

    if (mediaInfo.type === 'unknown') {
        incrementMetric('statusSkipped', 1);
        recordAudit('status_unknown_type', buildMessageMeta(msg, mediaInfo, identity), 'warn');
        if (DEBUG_STATUS_TYPE_DETECTION && !ULTRA_MINIMAL_CONSOLE) {
            logDebug(`Unknown status | ${identity.displayName}`, mediaInfo.innerType);
        }
        return;
    }

    const supportedTypes = [...ALLOWED_MEDIA_TYPES, 'text'];
    if (!supportedTypes.includes(mediaInfo.type)) {
        incrementMetric('statusSkipped', 1);
        recordAudit('status_unsupported_type', buildMessageMeta(msg, mediaInfo, identity), 'warn');
        if (DEBUG_STATUS_TYPE_DETECTION && !ULTRA_MINIMAL_CONSOLE) {
            logDebug(`Tipe belum aktif | ${mediaInfo.type}`, identity.displayName);
        }
        return;
    }

    await resolveStatusReference(mediaInfo, identity, msg);

    if (PROCESS_SAVED_CONTACTS_ONLY && !identity.isSaved) {
        incrementMetric('statusSkipped', 1);
        recordAudit('status_skip_unsaved_contact', buildMessageMeta(msg, mediaInfo, identity), 'info');
        return;
    }
    if (isStatusTooOld(msg)) {
        incrementMetric('statusSkipped', 1);
        recordAudit('status_skip_old', buildMessageMeta(msg, mediaInfo, identity), 'info');
        return;
    }
    if (isMediaTooLarge(mediaInfo)) {
        incrementMetric('statusSkipped', 1);
        recordAudit('status_skip_media_too_large', buildMessageMeta(msg, mediaInfo, identity), 'info');
        return;
    }

    const rateState = isRateLimited(identity);
    if (rateState.limited) {
        incrementMetric('statusSkipped', 1);
        recordAudit('status_skip_rate_limited', { ...buildMessageMeta(msg, mediaInfo, identity), reason: rateState.reason }, 'warn');
        return;
    }

    if (!isTelegramConfigured()) {
        warnTelegramConfig();
        recordAudit('telegram_not_configured', buildMessageMeta(msg, mediaInfo, identity), 'error');
        return;
    }

    const statusPrimaryKey = buildStatusPrimaryKey(msg, participant, mediaInfo);
    const activeFingerprints = buildStatusFingerprints(msg, participant, mediaInfo);
    const statusProbe = buildStatusRecordProbe(msg, participant, mediaInfo, identity);
    if (!(await reserveFingerprints(statusPrimaryKey, activeFingerprints, statusProbe))) {
        incrementMetric('statusSkipped', 1);
        incrementMetric('statusDuplicateSkipped', 1);
        recordAudit('status_skip_duplicate_precheck', { ...buildMessageMeta(msg, mediaInfo, identity), statusPrimaryKey }, 'info');
        if (!ULTRA_MINIMAL_CONSOLE) {
            logDuplicateSkip(identity, mediaInfo, 'precheck duplicate', statusPrimaryKey);
        }
        return;
    }

    try {
        await simulateNaturalStatusView(sock, msg, mediaInfo, identity);
        if (POST_READ_LIKE_DELAY_MS > 0) {
            await delay(POST_READ_LIKE_DELAY_MS);
        }
        await sendStatusLike(sock, msg, participant, mediaInfo, identity);

        let buffer = null;
        if (mediaInfo.type !== 'text') {
            buffer = await withRetries(
                () => downloadMediaMessage(msg, 'buffer', {}, { logger, reuploadRequest: sock.updateMediaMessage }),
                DOWNLOAD_RETRIES,
                { metricKey: 'downloadRetried', auditReason: 'status_download_retry', meta: buildMessageMeta(msg, mediaInfo, identity) }
            );

            if (STRICT_BUFFER_HASH) {
                const bufferFingerprint = buildBufferFingerprint(buffer, participant, mediaInfo, msg);
                if (await isProcessedFingerprint(bufferFingerprint)) {
                    releaseFingerprints(statusPrimaryKey, activeFingerprints);
                    incrementMetric('statusSkipped', 1);
                    incrementMetric('statusDuplicateSkipped', 1);
                    recordAudit('status_skip_duplicate_buffer', { ...buildMessageMeta(msg, mediaInfo, identity), statusPrimaryKey }, 'info');
                    if (!ULTRA_MINIMAL_CONSOLE) {
                        logDuplicateSkip(identity, mediaInfo, 'buffer duplicate', statusPrimaryKey);
                    }
                    return;
                }
                processingFingerprints.add(bufferFingerprint);
                activeFingerprints.push(bufferFingerprint);
            }
        }

        await sendToTelegram(buffer, mediaInfo, participant, msg);
        markForwardCount(identity);
        trackDailyStatusSuccess(identity, mediaInfo);
        await markFingerprintsProcessed(statusPrimaryKey, activeFingerprints, {
            participant,
            remoteJid: msg?.key?.remoteJid || '',
            chatScope: detectMessageScope(msg),
            sourceType: mediaInfo.sourceType || '',
            type: mediaInfo.type,
            messageId: msg.key?.id || '',
            contentSignature: statusProbe.contentSignature,
            displayName: identity.displayName
        });
        incrementMetric('statusForwarded', 1);
        updateHealth({ lastStatusForwardedAt: new Date().toISOString() });
        recordAudit('status_forward_success', buildMessageMeta(msg, mediaInfo, identity), 'info');
        logSend(mediaInfo, identity, mediaInfo.statusCategory);
    } catch (error) {
        releaseFingerprints(statusPrimaryKey, activeFingerprints);
        trackDailyStatusFailure(identity, mediaInfo, msg, error);
        recordFailedJob('forward_status', { ...buildMessageMeta(msg, mediaInfo, identity), statusPrimaryKey }, error?.message || String(error));
        updateHealth({ lastErrorAt: new Date().toISOString(), lastErrorMessage: `forward_status:${error?.message || error}` });
        throw error;
    }
}

async function connectToWhatsApp() {
    if (connectJob) {
        return connectJob;
    }

    connectJob = (async () => {
        await loadBaileys();
        validateConfig();
        restoreAuthFromBackupIfNeeded();
        showStartupBanner();
        startStorePruneLoop();
        startSignalAuditLoop();

        const { state, saveCreds } = await useMultiFileAuthState(AUTH_FOLDER);
        registerSelfIdentity(PAIRING_PHONE_JID);
        registerSelfIdentity(state?.creds?.me?.id || '');
        const { version } = await fetchLatestBaileysVersion();
        const pairingState = { phoneNumber: PAIRING_PHONE_NUMBER, requested: false };

        const sock = makeWASocket({
            version,
            logger,
            printQRInTerminal: false,
            auth: {
                creds: state.creds,
                keys: makeCacheableSignalKeyStore(state.keys, logger)
            },
            getMessage: async (key) => getMessageSnapshot(key)?.message,
            msgRetryCounterCache,
            generateHighQualityLinkPreview: false,
            syncFullHistory: SYNC_FULL_HISTORY_ON_CONNECT,
            shouldSyncHistoryMessage: () => SYNC_FULL_HISTORY_ON_CONNECT,
            markOnlineOnConnect: KEEP_ONLINE_ENABLED,
            browser: Browsers?.ubuntu ? Browsers.ubuntu('Chrome') : ['Ubuntu', 'Chrome', '22.04']
        });

        activeSocket = sock;
        const socketGeneration = ++activeSocketGeneration;

        if (state.creds.registered && !ULTRA_MINIMAL_CONSOLE) logVerbose('[SESSION] restore');

        const isStaleSocket = () => activeSocket !== sock || socketGeneration !== activeSocketGeneration;

        sock.ev.on('creds.update', saveCreds);
        sock.ev.on('contacts.upsert', (contacts) => {
            if (isStaleSocket()) return;
            upsertContacts(contacts);
        });
        sock.ev.on('contacts.update', (contacts) => {
            if (isStaleSocket()) return;
            upsertContacts(contacts);
        });
        sock.ev.on('messaging-history.set', ({ contacts, messages }) => {
            if (isStaleSocket()) return;
            const historyMessages = Array.isArray(messages) ? messages : [];
            upsertContacts(contacts || []);
            historyMessages.forEach(cacheMessageSnapshot);
            if (!waConnectionReady) {
                bufferPreConnectMessages(pendingPreConnectHistoryMessages, historyMessages, Math.max(MAX_HISTORY_ENQUEUE_PER_SYNC, 1000));
                return;
            }
            if (HISTORY_CAPTURE_ENABLED) enqueueIncomingStatuses(sock, historyMessages, 'history');
        });

        sock.ev.on('connection.update', async (update) => {
            if (isStaleSocket()) return;
            const { connection, lastDisconnect, qr } = update;

            if (connection === 'connecting') {
                waConnectionOpen = false;
                waConnectionReady = false;
                clearPendingNotificationsTimeout();
                updateHealth({ status: 'CONNECTING' });
                if (!ULTRA_MINIMAL_CONSOLE) logWaConnecting();
            }

            if (qr && pairingState.phoneNumber && !pairingState.requested) {
                pairingState.requested = true;
                try {
                    await requestPairingCode(sock, pairingState.phoneNumber);
                } catch (error) {
                    pairingState.requested = false;
                    logError('Pairing', error.message);
                    void sendOperationalAlert('pairing_gagal', error?.message || String(error), { sendTelegram: true, sendWhatsapp: false });
                }
            }

            if (connection === 'open') {
                if (isStaleSocket()) return;
                clearReconnectTimer();
                stopPairingReminder();
                registerSelfIdentity(PAIRING_PHONE_JID);
                registerSelfIdentity(sock?.user?.id || '');
                startPresenceKeepAlive(sock);
                startSessionBackupLoop();
                startStorePruneLoop();
                createSessionBackup('connection_open');
                if (SNAPSHOT_ON_CONNECT) {
                    persistOperationalSnapshot('connection_open');
                }
                await applyAntiCallPrivacy(sock);
                waConnectionOpen = true;
                waConnectionReady = false;
                updateHealth({ status: 'CONNECTED', catchUp: 'pending' });
                recordAudit('connection_open', { phone: PAIRING_PHONE_NUMBER, catchUp: 'pending' }, 'info');
                waConnectedOnce = true;
                logWaConnected();
                schedulePendingNotificationsFallback(sock, socketGeneration);
            }

            if (update.receivedPendingNotifications === true) {
                markWhatsAppReady(sock, 'received_pending_notifications');
            }

            if (connection === 'close') {
                if (isStaleSocket()) return;
                clearPendingNotificationsTimeout();
                waConnectionOpen = false;
                waConnectionReady = false;
                activeSocketGeneration += 1;
                if (activeSocket === sock) {
                    activeSocket = null;
                }
                stopPairingReminder();
                stopPresenceKeepAlive();
                stopSessionBackupLoop();
                stopStorePruneLoop();
                clearQueuedStatusTasks('connection_close');
                persistOperationalSnapshot('connection_close');
                const statusCode = (lastDisconnect?.error instanceof Boom)
                    ? lastDisconnect.error.output?.statusCode
                    : lastDisconnect?.error?.output?.statusCode;
                const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
                updateHealth({
                    status: shouldReconnect ? 'RECONNECTING' : 'DISCONNECTED',
                    lastErrorAt: new Date().toISOString(),
                    lastErrorMessage: `wa_disconnected:${statusCode || 'unknown'}`,
                    reconnectAttempts: Number(healthStore.reconnectAttempts || 0) + (shouldReconnect ? 1 : 0)
                });
                recordAudit('connection_close', { statusCode, shouldReconnect }, shouldReconnect ? 'warn' : 'error');
                if (shouldReconnect) incrementMetric('reconnects', 1);
                logError('WA disconnected', `reconnect=${shouldReconnect}`);
                if (shouldReconnect) {
                    scheduleReconnect();
                } else {
                    logError('WA session logout');
                    void sendOperationalAlert('sesi_logout', `statusCode=${statusCode || 'unknown'}`, { sendTelegram: true, sendWhatsapp: false });
                    if (!ULTRA_MINIMAL_CONSOLE && lastPhoneNumber) {
                        logPairInfo(lastPhoneNumber, 'Gunakan nomor ini untuk pairing ulang');
                    }
                }
            }
        });

        sock.ev.on('messages.upsert', ({ messages, type }) => {
            if (isStaleSocket()) return;
            if (type !== 'notify' && type !== 'append') return;
            const incomingMessages = Array.isArray(messages) ? messages : [];
            const source = type === 'append' ? 'history' : 'live';
            incomingMessages.forEach(cacheMessageSnapshot);
            if (!waConnectionReady) {
                const targetBuffer = source === 'history' ? pendingPreConnectHistoryMessages : pendingPreConnectLiveMessages;
                bufferPreConnectMessages(targetBuffer, incomingMessages, Math.max(MAX_HISTORY_ENQUEUE_PER_SYNC, 1000));
                return;
            }
            if (source === 'history' && !HISTORY_CAPTURE_ENABLED) return;
            enqueueIncomingStatuses(sock, incomingMessages, source);
        });

        sock.ev.on('messages.update', (updates) => {
            if (isStaleSocket()) return;
            const incomingUpdates = Array.isArray(updates) ? updates : [];
            incomingUpdates.forEach(cacheMessageUpdate);
            if (!waConnectionReady) {
                bufferPreConnectMessages(pendingPreConnectUpdates, incomingUpdates, Math.max(MAX_HISTORY_ENQUEUE_PER_SYNC, 1000));
                return;
            }
            enqueueUpdatedStatuses(sock, incomingUpdates);
        });

        sock.ev.on('call', (calls) => {
            if (isStaleSocket()) return;
            void handleIncomingCalls(sock, calls);
        });

        return sock;
    })();

    try {
        return await connectJob;
    } finally {
        connectJob = null;
    }
}

function gracefulShutdown(signal) {
    if (!ULTRA_MINIMAL_CONSOLE) logSystem('Shutdown diminta', signal, 'SYSTEM', ANSI.blue);
    stopPairingReminder();
    stopPresenceKeepAlive();
    stopSessionBackupLoop();
    stopStorePruneLoop();
    stopSignalAuditLoop();
    clearReconnectTimer();
    persistOperationalSnapshot(`shutdown:${signal}`);
    closeAntiSpamStorage();
    process.exit(0);
}

process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

process.on('uncaughtException', (error) => {
    const message = error?.message || String(error);
    logError('uncaughtException', message);
    updateHealth({ lastErrorAt: new Date().toISOString(), lastErrorMessage: `uncaughtException:${message}` });
    recordFailedJob('uncaughtException', {}, message);
    void sendOperationalAlert('runtime_error', message, { sendTelegram: true, sendWhatsapp: true });
    stopPairingReminder();
    stopPresenceKeepAlive();
    stopSessionBackupLoop();
    stopStorePruneLoop();
    stopSignalAuditLoop();
    clearReconnectTimer();
    persistOperationalSnapshot('uncaughtException');
    closeAntiSpamStorage();
    process.exit(1);
});

process.on('unhandledRejection', (reason) => {
    const message = reason?.message || String(reason);
    logError('unhandledRejection', message);
    updateHealth({ lastErrorAt: new Date().toISOString(), lastErrorMessage: `unhandledRejection:${message}` });
    recordFailedJob('unhandledRejection', {}, message);
    stopPairingReminder();
    stopPresenceKeepAlive();
    stopSessionBackupLoop();
    stopStorePruneLoop();
    stopSignalAuditLoop();
    clearReconnectTimer();
    persistOperationalSnapshot('unhandledRejection');
    closeAntiSpamStorage();
    process.exit(1);
});

connectToWhatsApp().catch((error) => {
    const message = error?.message || String(error);
    logError('Startup', message);
    updateHealth({ lastErrorAt: new Date().toISOString(), lastErrorMessage: `startup:${message}` });
    recordFailedJob('startup', {}, message);
    void sendOperationalAlert('startup_gagal', message, { sendTelegram: true, sendWhatsapp: false });
    stopStorePruneLoop();
    stopSignalAuditLoop();
    persistOperationalSnapshot('startup_failure');
    closeAntiSpamStorage();

    if (message.includes('Storage SQLite gagal')) {
        process.exit(EXIT_CODE_FATAL_STORAGE);
        return;
    }
    if (
        message.includes('whatsapp.phoneNumber')
        || message.includes('telegram.botToken')
        || message.includes('telegram.chatId')
        || message.includes('Config queue tidak valid')
        || message.includes('Format whatsapp.phoneNumber tidak valid')
    ) {
        process.exit(EXIT_CODE_FATAL_CONFIG);
        return;
    }

    process.exit(1);
});
