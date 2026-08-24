/**
 * Owner Mark: © By John
 * Bot ini milik John.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DB_DIR = path.join(__dirname, 'kv_database');
if (!fs.existsSync(DB_DIR)) {
    fs.mkdirSync(DB_DIR, { recursive: true });
}

// Helper for atomic file write
function forceSave(filename, data) {
    const filePath = path.join(DB_DIR, filename);
    const tempPath = filePath + '.tmp';
    fs.writeFileSync(tempPath, JSON.stringify(data, null, 2), 'utf8');
    fs.renameSync(tempPath, filePath);
}

function forceRead(filename, defaultValue = []) {
    const filePath = path.join(DB_DIR, filename);
    if (!fs.existsSync(filePath)) {
        forceSave(filename, defaultValue);
        return defaultValue;
    }
    try {
        const content = fs.readFileSync(filePath, 'utf8');
        return JSON.parse(content);
    } catch (e) {
        console.error(`Error reading ${filename}, recovering...`, e.message);
        return defaultValue;
    }
}

// User Password Hashing
function hashPassword(password) {
    const salt = crypto.randomBytes(16).toString('hex');
    const derivedKey = crypto.scryptSync(String(password || ''), salt, 64).toString('hex');
    return `scrypt$${salt}$${derivedKey}`;
}

function verifyPassword(password, storedHash) {
    const candidate = String(password || '');
    const saved = String(storedHash || '');

    if (saved.startsWith('scrypt$')) {
        const parts = saved.split('$');
        if (parts.length !== 3) return false;
        const [, salt, expectedHex] = parts;
        const actualHex = crypto.scryptSync(candidate, salt, 64).toString('hex');
        try {
            return crypto.timingSafeEqual(Buffer.from(actualHex, 'hex'), Buffer.from(expectedHex, 'hex'));
        } catch {
            return false;
        }
    }

    const legacyHash = crypto.createHash('sha256').update(candidate).digest('hex');
    return legacyHash === saved;
}

function sanitizeSessionId(sessionId) {
    const value = String(sessionId || '').trim();
    const sanitized = value.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 120);
    if (!sanitized) {
        throw new Error('sessionId tidak valid');
    }
    return sanitized;
}

module.exports = {
    // AUTHENTICATION DB
    registerUser(username, password) {
        const users = forceRead('users.json');
        const cleanUsername = username.trim().toLowerCase();
        if (users.some(u => u.username === cleanUsername)) {
            return { success: false, message: 'Username sudah terdaftar!' };
        }
        const newUser = {
            id: 'usr_' + crypto.randomBytes(8).toString('hex'),
            username: cleanUsername,
            passwordHash: hashPassword(password),
            createdAt: new Date().toISOString()
        };
        users.push(newUser);
        forceSave('users.json', users);
        return { success: true, user: { id: newUser.id, username: newUser.username } };
    },

    authenticateUser(username, password) {
        const users = forceRead('users.json');
        const cleanUsername = username.trim().toLowerCase();
        const user = users.find(u => u.username === cleanUsername);
        if (!user || !verifyPassword(password, user.passwordHash)) {
            return { success: false, message: 'Username atau password salah!' };
        }
        return { success: true, user: { id: user.id, username: user.username } };
    },

    // SESSION DB
    getSessions(userId) {
        const list = forceRead('sessions.json');
        return list.filter(s => s.userId === userId);
    },

    getAllSessions() {
        return forceRead('sessions.json');
    },

    saveOrUpdateSession(userId, sessionId, name, phone, status = 'DISCONNECTED') {
        const safeSessionId = sanitizeSessionId(sessionId);
        const list = forceRead('sessions.json');
        const idx = list.findIndex(s => s.sessionId === safeSessionId);
        const sessionData = {
            userId,
            sessionId: safeSessionId,
            name: name || 'Device',
            phone: phone || '',
            status,
            qrCode: null,
            pairingCode: null,
            lastUpdated: new Date().toISOString()
        };

        if (idx >= 0) {
            // Update
            list[idx] = { ...list[idx], ...sessionData };
        } else {
            // Insert
            list.push(sessionData);
        }
        forceSave('sessions.json', list);
    },

    updateSessionStatus(sessionId, status, qr = null, pairingCode = null, phone = null) {
        const safeSessionId = sanitizeSessionId(sessionId);
        const list = forceRead('sessions.json');
        const idx = list.findIndex(s => s.sessionId === safeSessionId);
        if (idx >= 0) {
            list[idx].status = status;
            list[idx].qrCode = qr;
            list[idx].pairingCode = pairingCode;
            if (phone) list[idx].phone = phone;
            list[idx].lastUpdated = new Date().toISOString();
            forceSave('sessions.json', list);
        }
    },

    deleteSession(sessionId) {
        const safeSessionId = sanitizeSessionId(sessionId);
        const list = forceRead('sessions.json');
        const filtered = list.filter(s => s.sessionId !== safeSessionId);
        forceSave('sessions.json', filtered);
        
        // Delete rules and config files associated with this session
        try {
            const rPath = path.join(DB_DIR, `rules_${safeSessionId}.json`);
            if (fs.existsSync(rPath)) fs.unlinkSync(rPath);
            const cPath = path.join(DB_DIR, `config_${safeSessionId}.json`);
            if (fs.existsSync(cPath)) fs.unlinkSync(cPath);
        } catch (e) {
            console.error('Error deleting session rule files:', e.message);
        }
    },

    // CUSTOM PER-SESSION CHATBOT RULES DB
    getRules(sessionId) {
        const safeSessionId = sanitizeSessionId(sessionId);
        return forceRead(`rules_${safeSessionId}.json`, []);
    },

    saveRules(sessionId, rules) {
        if (!Array.isArray(rules)) return false;
        const safeSessionId = sanitizeSessionId(sessionId);
        forceSave(`rules_${safeSessionId}.json`, rules);
        return true;
    },

    // CUSTOM PER-SESSION CHATBOT CONFIG DB
    getChatbotConfig(sessionId) {
        const safeSessionId = sanitizeSessionId(sessionId);
        return forceRead(`config_${safeSessionId}.json`, { isActive: false, aiPrompt: "", geminiApiKey: "" });
    },

    saveChatbotConfig(sessionId, config) {
        const safeSessionId = sanitizeSessionId(sessionId);
        const current = this.getChatbotConfig(safeSessionId);
        const updated = { ...current, ...config };
        forceSave(`config_${safeSessionId}.json`, updated);
        return true;
    }
};
