const ACTIVE_PRESET = 'normal';
// Edit satu nilai ini untuk mengganti emoji auto-like pada semua preset.
const AUTO_LIKE_EMOJI = '💚';

const PRESETS = {
    // NORMAL
    // Kelebihan:
    // - paling seimbang untuk pemakaian harian
    // - relatif aman dan stabil
    // - resource tidak seberat mode agresif
    // Kekurangan:
    // - tidak secepat mode agresif menangkap status baru
    normal: {
        connection: {
            keepOnline: true,
            keepAliveIntervalSeconds: 60,
            reconnectDelaySeconds: 3,
            syncFullHistoryOnConnect: true,
            privacy: {
                enabled: true,
                lastSeen: 'none',
                online: 'match_last_seen',
                profilePhoto: 'none',
                status: 'none',
                groupAdd: 'contacts'
            },
            antiCall: {
                enabled: true,
                setPrivacy: true,
                privacyMode: 'none',
                rejectIncoming: true,
                rejectDelayMs: 0,
                autoBlockCaller: true,
                blockDelayMs: 0,
                notifyTelegram: false,
                blockedCallStoreFile: 'blocked-callers.json',
                sendBusyMessage: true,
                busyMessageVoice: 'Mohon maaf, panggilan suara WhatsApp otomatis ditolak karena bot sedang tidak menerima panggilan. Silakan kirim pesan chat jika membutuhkan bantuan.',
                busyMessageVideo: 'Mohon maaf, panggilan video WhatsApp otomatis ditolak karena bot sedang tidak menerima panggilan. Silakan kirim pesan chat jika membutuhkan bantuan.',
                busyMessage: 'Mohon maaf, panggilan WhatsApp otomatis ditolak karena bot sedang tidak menerima panggilan. Silakan kirim pesan chat jika membutuhkan bantuan.'
            }
        },
        console: {
            mode: 'minimal',
            minimal: true,
            showSendLogs: true,
            showLikeLogs: true,
            showCallLogs: true,
            colorize: true
        },
        statusForwarder: {
            allowedMediaTypes: ['image', 'video', 'audio', 'document', 'sticker'],
            autoLikeStatus: true,
            autoLikeEmoji: AUTO_LIKE_EMOJI,
            likeRetries: 1,
            likeVerificationEnabled: true,
            likeVerificationTimeoutSeconds: 8,
            postReadLikeDelaySeconds: 10,
            duplicateRetentionHours: 72,
            contactStoreFile: 'contact-store.json',
            statusReferenceStoreFile: 'status-reference-store.json',
            notifyStatusReferences: false,
            strictBufferHash: true,
            naturalViewMode: true,
            imageViewSeconds: 3,
            stickerViewSeconds: 2,
            documentViewSeconds: 3,
            audioViewSeconds: 4,
            minVideoViewSeconds: 4,
            maxVideoViewSeconds: 10,
            viewJitterSeconds: 1,
            postReadForwardDelayMs: 500,
            minTaskGapMs: 200,
            maxTaskGapMs: 900,
            maxTotalForwardsPerHour: 500,
            maxForwardsPerContactPerHour: 100,
            skipStatusesOlderThanMinutes: 0,
            processSavedContactsOnly: false,
            maxMediaSizeMB: 32,
            debugStatusTypeDetection: false,
            prioritizeFreshStatuses: true,
            freshStatusWindowSeconds: 900,
            urgentTaskGapMs: 0,
            urgentTaskGapMaxMs: 100,
            freshImageViewSeconds: 2,
            freshVideoMinViewSeconds: 3,
            freshVideoMaxViewSeconds: 8,
            freshOtherViewSeconds: 2,
            captureFreshStatusesFast: true,
            historyCaptureEnabled: true,
            historyStatusMaxAgeHours: 24,
            messageCacheLimit: 5000,
            reconnectQueueRetentionMinutes: 30,
            pendingNotificationsTimeoutSeconds: 20,
            messageUpdateFallback: true,
            forwardedChannelMediaEnabled: true,
            forwardedChannelMediaOwnerOnly: false,
            statusParticipantPnPriority: true,
            statusLikeFallbackEnabled: true,
            statusLikeParticipantFallbacks: 4,
            downloadRetries: 3,
            maxQueueSize: 2500,
            maxUrgentQueueSize: 700,
            maxHistoryEnqueuePerSync: 500,
            deDuplicatePendingQueue: true,
            skipFromMeStatuses: true,
            captionMaxLength: 1200,
            detailMaxLength: 240,
            sourceLabelMaxLength: 120,
            statusTaskRetryAttempts: 2,
            statusTaskRetryDelayMs: 1200,
            queueStaleTaskMinutes: 20,
            runtimeBusyQueueThreshold: 25,
            runtimeBusyMaxViewDelayMs: 1200,
            runtimeBusyPostReadDelayMs: 0,
            antiSpamMode: 'ai-analyzer',
            useSqliteStore: true,
            databaseFile: 'status-antispam.db',
            databaseWalMode: true,
            databaseWarmCacheLimit: 5000
        }
    },

    // AGRESIF
    // Kelebihan:
    // - lebih cepat menangkap status baru
    // - lebih cocok untuk volume status tinggi
    // - retry dan queue lebih besar
    // Kekurangan:
    // - lebih berat di resource
    // - lebih aktif dan lebih sensitif terhadap server yang tidak stabil
    agresif: {
        connection: {
            keepOnline: true,
            keepAliveIntervalSeconds: 45,
            reconnectDelaySeconds: 2,
            syncFullHistoryOnConnect: true,
            privacy: {
                enabled: true,
                lastSeen: 'none',
                online: 'match_last_seen',
                profilePhoto: 'none',
                status: 'none',
                groupAdd: 'contacts'
            },
            antiCall: {
                enabled: true,
                setPrivacy: true,
                privacyMode: 'none',
                rejectIncoming: true,
                rejectDelayMs: 0,
                autoBlockCaller: true,
                blockDelayMs: 0,
                notifyTelegram: false,
                blockedCallStoreFile: 'blocked-callers.json',
                sendBusyMessage: true,
                busyMessageVoice: 'Mohon maaf, panggilan suara WhatsApp otomatis ditolak karena bot sedang tidak menerima panggilan. Silakan kirim pesan chat jika membutuhkan bantuan.',
                busyMessageVideo: 'Mohon maaf, panggilan video WhatsApp otomatis ditolak karena bot sedang tidak menerima panggilan. Silakan kirim pesan chat jika membutuhkan bantuan.',
                busyMessage: 'Mohon maaf, panggilan WhatsApp otomatis ditolak karena bot sedang tidak menerima panggilan. Silakan kirim pesan chat jika membutuhkan bantuan.'
            }
        },
        console: {
            mode: 'minimal',
            minimal: true,
            showSendLogs: true,
            showLikeLogs: true,
            showCallLogs: true,
            colorize: true
        },
        statusForwarder: {
            allowedMediaTypes: ['image', 'video', 'audio', 'document', 'sticker'],
            autoLikeStatus: true,
            autoLikeEmoji: AUTO_LIKE_EMOJI,
            likeRetries: 1,
            likeVerificationEnabled: true,
            likeVerificationTimeoutSeconds: 8,
            postReadLikeDelaySeconds: 10,
            duplicateRetentionHours: 48,
            contactStoreFile: 'contact-store.json',
            statusReferenceStoreFile: 'status-reference-store.json',
            notifyStatusReferences: false,
            strictBufferHash: true,
            naturalViewMode: true,
            imageViewSeconds: 2,
            stickerViewSeconds: 1,
            documentViewSeconds: 2,
            audioViewSeconds: 3,
            minVideoViewSeconds: 3,
            maxVideoViewSeconds: 7,
            viewJitterSeconds: 1,
            postReadForwardDelayMs: 250,
            minTaskGapMs: 50,
            maxTaskGapMs: 300,
            maxTotalForwardsPerHour: 1200,
            maxForwardsPerContactPerHour: 300,
            skipStatusesOlderThanMinutes: 0,
            processSavedContactsOnly: false,
            maxMediaSizeMB: 48,
            debugStatusTypeDetection: false,
            prioritizeFreshStatuses: true,
            freshStatusWindowSeconds: 1200,
            urgentTaskGapMs: 0,
            urgentTaskGapMaxMs: 50,
            freshImageViewSeconds: 1,
            freshVideoMinViewSeconds: 2,
            freshVideoMaxViewSeconds: 6,
            freshOtherViewSeconds: 1,
            captureFreshStatusesFast: true,
            historyCaptureEnabled: true,
            historyStatusMaxAgeHours: 24,
            messageCacheLimit: 5000,
            reconnectQueueRetentionMinutes: 30,
            pendingNotificationsTimeoutSeconds: 20,
            messageUpdateFallback: true,
            forwardedChannelMediaEnabled: true,
            forwardedChannelMediaOwnerOnly: false,
            statusParticipantPnPriority: true,
            statusLikeFallbackEnabled: true,
            statusLikeParticipantFallbacks: 5,
            downloadRetries: 3,
            maxQueueSize: 5000,
            maxUrgentQueueSize: 1500,
            maxHistoryEnqueuePerSync: 800,
            deDuplicatePendingQueue: true,
            skipFromMeStatuses: true,
            captionMaxLength: 1200,
            detailMaxLength: 240,
            sourceLabelMaxLength: 120,
            statusTaskRetryAttempts: 3,
            statusTaskRetryDelayMs: 700,
            queueStaleTaskMinutes: 15,
            runtimeBusyQueueThreshold: 40,
            runtimeBusyMaxViewDelayMs: 800,
            runtimeBusyPostReadDelayMs: 0,
            antiSpamMode: 'ai-analyzer',
            useSqliteStore: true,
            databaseFile: 'status-antispam.db',
            databaseWalMode: true,
            databaseWarmCacheLimit: 8000
        }
    }
};

const selectedPreset = PRESETS[ACTIVE_PRESET] || PRESETS.normal;

module.exports = {
    activePreset: ACTIVE_PRESET,
    availablePresets: Object.keys(PRESETS),
    whatsapp: {
        phoneNumber: '628123456789',
        authFolder: 'auth_info_baileys'
    },
    owner: {
        allowedNumbers: ['628123456789']
    },
    telegram: {
        botToken: 'ISI_BOT_TOKEN_TELEGRAM',
        chatId: 'ISI_CHAT_ID_TELEGRAM',
        requestTimeoutMs: 45000,
        maxRetries: 2,
        footerText: '© joo.exe'
    },
    operations: {
        healthStoreFile: 'healthcheck.json',
        metricsStoreFile: 'metrics.json',
        auditStoreFile: 'audit-log.json',
        failedJobStoreFile: 'failed-jobs.json',
        runtimeStateFile: 'runtime-state.json',
        sessionBackupDir: 'auth_backups',
        sessionBackupIntervalMinutes: 60,
        databaseResetHourWib: 0,
        databaseIntegrityCheckMinutes: 30,
        signalAuditIntervalMinutes: 10,
        healthCheckIntervalMinutes: 15,
        operationalCleanupIntervalMinutes: 60,
        operationalRetentionDays: 14,
        temporaryFileRetentionMinutes: 60,
        capacityCheckIntervalMinutes: 15,
        diskWarningFreePercent: 10,
        diskCriticalFreePercent: 5,
        databaseWarningSizeMB: 512,
        adaptiveRetryEnabled: true,
        retryMaxJitterMs: 800,
        diagnosticModeEnabled: false,
        diagnosticModeMinutes: 30,
        operationalBackupIntervalMinutes: 360,
        operationalBackupDir: 'operational_backups',
        maxOperationalBackups: 5,
        sqliteDocumentWriteDebounceMs: 750,
        dailySummaryRetentionDays: 30,
        dailySummaryMaxFailures: 50,
        databaseWriteRetryAttempts: 2,
        retryBaseDelayMs: 500,
        retryMaxDelayMs: 2500,
        snapshotOnConnect: true,
        maxSessionBackups: 5,
        maxAuditEntries: 300,
        maxFailedJobs: 200
    },
    storage: {
        sqlite: {
            file: 'status-antispam.db'
        }
    },
    connection: selectedPreset.connection,
    console: selectedPreset.console,
    statusForwarder: selectedPreset.statusForwarder
};
