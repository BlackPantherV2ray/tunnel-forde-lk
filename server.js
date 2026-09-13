const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');

// Load environment variables
dotenv.config();

const axios = require('axios');
const jwt = require('jsonwebtoken');
const { OAuth2Client } = require('google-auth-library');
const path = require('path');
const fs = require('fs').promises;
const fsSync = require('fs');
const https = require('https');
const crypto = require('crypto');
const FormData = require('form-data');
// ----------------------------------------------------
// DATABASE LAYER: FIREBASE CLOUD FIRESTORE & LOCAL JSON DB
// ----------------------------------------------------
const { initializeApp } = require('firebase/app');
const firebaseFirestore = require('firebase/firestore');

const { 
    getFirestore: origGetFirestore, 
    collection: origCollection, 
    doc: origDoc, 
    getDoc: origGetDoc, 
    setDoc: origSetDoc, 
    updateDoc: origUpdateDoc, 
    getDocs: origGetDocs, 
    addDoc: origAddDoc, 
    query: origQuery, 
    where: origWhere, 
    deleteDoc: origDeleteDoc 
} = firebaseFirestore;

const firebaseConfig = {
    apiKey: process.env.FIREBASE_API_KEY,
    authDomain: process.env.FIREBASE_AUTH_DOMAIN,
    projectId: process.env.FIREBASE_PROJECT_ID,
    storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
    messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID,
    appId: process.env.FIREBASE_APP_ID,
    measurementId: process.env.FIREBASE_MEASUREMENT_ID
};

let db = null;
let useFirebase = false;
let useLocalDb = true;

// Local JSON DB State & Persistence
const DB_DIR = path.join(__dirname, 'data');
const DB_FILE = path.join(DB_DIR, 'db.json');
const DB_BACKUP_FILE = path.join(DB_DIR, 'db.backup.json');

let localDb = {
    users: {},
    packages: {},
    slips: [],
    chats: [],
    free_configs: {},
    unlocked_configs: []
};

async function loadLocalDb() {
    try {
        await fs.mkdir(DB_DIR, { recursive: true });
        try {
            const data = await fs.readFile(DB_FILE, 'utf8');
            localDb = JSON.parse(data);
        } catch (readErr) {
            try {
                const bkpData = await fs.readFile(DB_BACKUP_FILE, 'utf8');
                localDb = JSON.parse(bkpData);
                console.log('📂 Restored local DB from automatic backup file.');
            } catch (_) {
                await saveLocalDb();
            }
        }
        // Ensure array structures
        if (!Array.isArray(localDb.slips)) localDb.slips = [];
        if (!Array.isArray(localDb.chats)) localDb.chats = [];
        if (!Array.isArray(localDb.unlocked_configs)) localDb.unlocked_configs = [];
        if (typeof localDb.users !== 'object') localDb.users = {};
        if (typeof localDb.packages !== 'object') localDb.packages = {};
        if (typeof localDb.free_configs !== 'object') localDb.free_configs = {};

        // Auto-clean any bracketed host/domain names from package descriptions
        let dbMigrated = false;
        for (const pkgId in localDb.packages) {
            if (localDb.packages[pkgId] && localDb.packages[pkgId].desc) {
                const cleanDesc = localDb.packages[pkgId].desc.replace(/\s*\([^)]*\.[a-z]{2,}[^)]*\)/gi, '').trim();
                if (cleanDesc !== localDb.packages[pkgId].desc) {
                    localDb.packages[pkgId].desc = cleanDesc;
                    dbMigrated = true;
                }
            }
        }
        if (dbMigrated) {
            await saveLocalDb();
        }
    } catch (err) {
        console.error('Failed to initialize local DB:', err);
    }
}

let isSavingLocalDb = false;
let hasQueuedLocalDbSave = false;

async function saveLocalDb() {
    if (isSavingLocalDb) {
        hasQueuedLocalDbSave = true;
        return;
    }
    isSavingLocalDb = true;
    try {
        await fs.mkdir(DB_DIR, { recursive: true });
        const jsonStr = JSON.stringify(localDb, null, 4);
        await fs.writeFile(DB_FILE, jsonStr, 'utf8');
        // Keep an automatic rolling backup so data is never lost
        if (localDb && localDb.users && Object.keys(localDb.users).length > 0) {
            await fs.writeFile(DB_BACKUP_FILE, jsonStr, 'utf8').catch(() => {});
        }
    } catch (err) {
        console.error('Failed to save local DB:', err);
    } finally {
        isSavingLocalDb = false;
        if (hasQueuedLocalDbSave) {
            hasQueuedLocalDbSave = false;
            setTimeout(saveLocalDb, 500);
        }
    }
}

// Local DB Helper Functions
async function localDbGetDoc(collectionName, id) {
    if (collectionName === 'users') {
        if (localDb.users[id]) return localDb.users[id];
        const lowerId = String(id).toLowerCase();
        for (const k of Object.keys(localDb.users)) {
            if (k.toLowerCase() === lowerId) return localDb.users[k];
        }
        return null;
    }
    if (collectionName === 'packages') return localDb.packages[id] || null;
    if (collectionName === 'free_configs') return localDb.free_configs[id] || null;
    if (collectionName === 'slips') return localDb.slips.find(s => s.id === id) || null;
    return null;
}

async function localDbSetDoc(collectionName, id, data) {
    if (collectionName === 'users') localDb.users[id] = { ...localDb.users[id], ...data };
    else if (collectionName === 'packages') localDb.packages[id] = { ...localDb.packages[id], ...data };
    else if (collectionName === 'free_configs') localDb.free_configs[id] = { ...localDb.free_configs[id], ...data };
    else if (collectionName === 'unlocked_configs') {
        const exists = localDb.unlocked_configs.some(u => u.user_email === data.user_email && u.config_id === data.config_id);
        if (!exists) localDb.unlocked_configs.push(data);
    }
    await saveLocalDb();
}

async function localDbAddDoc(collectionName, data) {
    const id = (data && data.id) ? data.id : (Date.now().toString() + Math.random().toString(36).substring(2, 5));
    const dataWithId = { ...data, id };
    if (collectionName === 'slips') {
        localDb.slips.push(dataWithId);
    } else if (collectionName === 'chats') {
        localDb.chats.push(dataWithId);
    } else if (collectionName === 'free_configs') {
        localDb.free_configs[id] = dataWithId;
    }
    await saveLocalDb();
    return dataWithId;
}

async function localDbUpdateDoc(collectionName, id, updates) {
    if (collectionName === 'users') {
        let key = id;
        if (!localDb.users[key]) {
            const lowerId = String(id).toLowerCase();
            key = Object.keys(localDb.users).find(k => k.toLowerCase() === lowerId) || id;
        }
        if (localDb.users[key]) {
            localDb.users[key] = { ...localDb.users[key], ...updates };
        }
    } else if (collectionName === 'slips') {
        const idx = localDb.slips.findIndex(s => s.id === id);
        if (idx !== -1) localDb.slips[idx] = { ...localDb.slips[idx], ...updates };
    } else if (collectionName === 'free_configs' && localDb.free_configs[id]) {
        localDb.free_configs[id] = { ...localDb.free_configs[id], ...updates };
    } else if (collectionName === 'chats') {
        const idx = localDb.chats.findIndex(c => c.id === id);
        if (idx !== -1) localDb.chats[idx] = { ...localDb.chats[idx], ...updates };
    }
    await saveLocalDb();
}

async function localDbGetDocs(collectionName, filterFn) {
    let list = [];
    if (collectionName === 'users') list = Object.values(localDb.users);
    else if (collectionName === 'packages') list = Object.values(localDb.packages);
    else if (collectionName === 'slips') list = localDb.slips;
    else if (collectionName === 'chats') list = localDb.chats;
    else if (collectionName === 'free_configs') list = Object.values(localDb.free_configs);
    else if (collectionName === 'unlocked_configs') list = localDb.unlocked_configs;
    
    if (filterFn) return list.filter(filterFn);
    return list;
}

// Wrapper Custom Firestore Functions
const getFirestore = origGetFirestore;

function collection(dbRef, collectionName) {
    if (useLocalDb) {
        return { type: 'collection', collection: collectionName };
    }
    return origCollection(dbRef, collectionName);
}

function doc(dbRef, collectionName, id) {
    if (useLocalDb) {
        return { type: 'document', collection: collectionName, id: id };
    }
    return origDoc(dbRef, collectionName, id);
}

async function getDoc(docRef) {
    if (useLocalDb) {
        const data = await localDbGetDoc(docRef.collection, docRef.id);
        return {
            exists: () => data !== null,
            data: () => data,
            id: docRef.id
        };
    }
    return origGetDoc(docRef);
}

async function setDoc(docRef, data) {
    if (useLocalDb) {
        await localDbSetDoc(docRef.collection, docRef.id, data);
        return;
    }
    return origSetDoc(docRef, data);
}

async function updateDoc(docRef, data) {
    if (useLocalDb) {
        await localDbUpdateDoc(docRef.collection, docRef.id, data);
        return;
    }
    return origUpdateDoc(docRef, data);
}

async function addDoc(colRef, data) {
    if (useLocalDb) {
        const added = await localDbAddDoc(colRef.collection, data);
        return {
            id: added.id,
            collection: colRef.collection,
            data: () => added
        };
    }
    return origAddDoc(colRef, data);
}

async function deleteDoc(docRef) {
    if (useLocalDb) {
        if (docRef.collection === 'packages') {
            delete localDb.packages[docRef.id];
        } else if (docRef.collection === 'users') {
            delete localDb.users[docRef.id];
        } else if (docRef.collection === 'free_configs') {
            delete localDb.free_configs[docRef.id];
        } else if (docRef.collection === 'slips') {
            const idx = localDb.slips.findIndex(s => s.id === docRef.id);
            if (idx !== -1) localDb.slips.splice(idx, 1);
        }
        await saveLocalDb();
        return;
    }
    return origDeleteDoc(docRef);
}

function where(field, op, value) {
    if (useLocalDb) {
        return { type: 'where', field, op, value };
    }
    return origWhere(field, op, value);
}

function query(colRef, ...constraints) {
    if (useLocalDb) {
        return { type: 'query', collection: colRef.collection, constraints };
    }
    return origQuery(colRef, ...constraints);
}

async function getDocs(queryOrColRef) {
    if (useLocalDb) {
        let collectionName = queryOrColRef.collection;
        let filters = [];
        if (queryOrColRef.type === 'query') {
            filters = queryOrColRef.constraints.filter(c => c.type === 'where');
        }
        
        const filterFn = (docData) => {
            for (const filter of filters) {
                const val = docData[filter.field];
                if (filter.op === '==') {
                    if (typeof val === 'string' && typeof filter.value === 'string') {
                        if (val.trim().toLowerCase() !== filter.value.trim().toLowerCase()) return false;
                    } else if (val !== filter.value) {
                        return false;
                    }
                }
            }
            return true;
        };
        
        const list = await localDbGetDocs(collectionName, filterFn);
        return {
            empty: list.length === 0,
            docs: list.map(d => ({
                id: d.id || d.phone || d.email,
                data: () => d
            })),
            forEach: (callback) => {
                list.forEach(d => {
                    callback({
                        id: d.id || d.phone || d.email,
                        data: () => d
                    });
                });
            }
        };
    }
    return origGetDocs(queryOrColRef);
}

const defaultPackages = [
    // Category: Speed Packages
    { id: 'HUTCH_ZOOM', name: 'Hutch Zoom', network: 'Hutch', host: 'Support.zoom.us', port: 8080, target: 'address', price: 200.00, originalPrice: null, isOffer: false, limitGB: 100, days: 30, desc: 'Hutch Zoom Pack (Port 8080)', promo: '⚡ Port 8080', server: 'PREMIUM SERVER 70', remaining: 28962, bonusCoins: 10, coinCost: 100, badge: null, category: 'speed' },
    { id: 'MOBITEL_ZOOM', name: 'Mobitel Zoom', network: 'Mobitel', host: '104.17.70.206', port: 8443, target: 'address', price: 200.00, originalPrice: null, isOffer: false, limitGB: 100, days: 30, desc: 'Mobitel Zoom High-speed Bypass (Port 8443)', promo: '⚡ Port 8443', server: 'PREMIUM SERVER 70', remaining: 28962, bonusCoins: 10, coinCost: 100, badge: null, category: 'speed' },
    { id: 'AIRTEL_ZOOM', name: 'Airtel Zoom', network: 'Airtel', host: 'Support.zoom.us', port: 8080, target: 'address', price: 200.00, originalPrice: null, isOffer: false, limitGB: 100, days: 30, desc: 'Airtel Zoom Pack (Port 8080)', promo: '⚡ Port 8080', server: 'PREMIUM SERVER 70', remaining: 28962, bonusCoins: 10, coinCost: 100, badge: null, category: 'speed' },
    { id: 'DIALOG_ROUTER_ZOOM', name: 'Dialog Router Zoom', network: 'Dialog', host: 'aka.ms', port: 443, target: 'sni', price: 200.00, originalPrice: null, isOffer: false, limitGB: 100, days: 30, desc: 'High-speed Router Zoom Package', promo: '', server: 'PREMIUM SERVER 72', remaining: 9224, bonusCoins: 10, coinCost: 100, badge: null, category: 'speed' },
    { id: 'DIALOG_TIKTOK', name: 'Dialog TikTok', network: 'Dialog', host: 'www.tiktok.com', port: 443, target: 'sni', price: 200.00, originalPrice: 350.00, isOffer: true, limitGB: 100, days: 30, desc: 'Dialog TikTok High-speed Pack', promo: '⚡ Limited Time Offer (Save 43%)', server: 'PREMIUM SERVER 72', remaining: 9224, bonusCoins: 10, coinCost: 100, badge: 'limited', category: 'speed' },
    { id: 'SLT_ZOOM', name: 'SLT Zoom', network: 'Other', host: 'zoom.us', port: 443, target: 'sni', price: 200.00, originalPrice: null, isOffer: false, limitGB: 100, days: 30, desc: 'SLT Fiber/4G Zoom', promo: '', server: 'PREMIUM SERVER 75', remaining: 3487, bonusCoins: 10, coinCost: 100, badge: null, category: 'speed' },
    { id: 'SLT_NETFLIX', name: 'SLT Netflix', network: 'Other', host: 'netflix.com', port: 443, target: 'sni', price: 200.00, originalPrice: null, isOffer: false, limitGB: 100, days: 30, desc: 'SLT Fiber Netflix Bypass', promo: '', server: 'PREMIUM SERVER 72', remaining: 9224, bonusCoins: 10, coinCost: 100, badge: null, category: 'speed' },
    { id: 'AIRTEL_TIKTOK', name: 'Airtel TikTok', network: 'Airtel', host: 'www.tiktok.com', port: 443, target: 'sni', price: 200.00, originalPrice: 300.00, isOffer: true, limitGB: 100, days: 30, desc: 'Airtel TikTok Package', promo: '🔥 Special Offer - Save LKR 100', server: 'PREMIUM SERVER 72', remaining: 9224, bonusCoins: 10, coinCost: 100, badge: 'offer', category: 'speed' },
    { id: 'AIRTEL_YOUTUBE', name: 'Airtel YouTube', network: 'Airtel', host: 'm.youtube.com', port: 443, target: 'sni', price: 200.00, originalPrice: null, isOffer: false, limitGB: 100, days: 30, desc: 'Airtel YouTube High-speed', promo: '', server: 'PREMIUM SERVER 70', remaining: 28962, bonusCoins: 10, coinCost: 100, badge: null, category: 'speed' },
    { id: 'DIALOG_348', name: 'Dialog 348', network: 'Dialog', host: 'aka.ms', port: 443, target: 'sni', price: 200.00, originalPrice: null, isOffer: false, limitGB: 100, days: 30, desc: 'Dialog 348 Pack', promo: '', server: 'PREMIUM SERVER 70', remaining: 28962, bonusCoins: 10, coinCost: 100, badge: null, category: 'speed' },
    { id: 'DIALOG_1118', name: 'Dialog 1118', network: 'Dialog', host: 'aka.ms', port: 443, target: 'sni', price: 200.00, originalPrice: 400.00, isOffer: true, limitGB: 100, days: 30, desc: 'Dialog 1118 Work & Learn', promo: '👑 50% OFF Limited Offer', server: 'PREMIUM SERVER 72', remaining: 9224, bonusCoins: 10, coinCost: 100, badge: 'limited', category: 'speed' },
    
    // Category: Speed Limit Packages
    { id: 'HUTCH_SOCIAL', name: 'Hutch Social', network: 'Hutch', host: 'static-web.likeevideo.com', port: 443, target: 'sni', price: 200.00, originalPrice: null, isOffer: false, limitGB: 100, days: 30, desc: 'Hutch Social Unlimited', promo: '', server: 'PREMIUM SERVER 70', remaining: 28962, bonusCoins: 10, coinCost: 100, badge: null, category: 'speed_limit' },
    { id: 'HUTCH_TIKTOK', name: 'Hutch TikTok', network: 'Hutch', host: 'www.tiktok.com', port: 443, target: 'sni', price: 200.00, originalPrice: null, isOffer: false, limitGB: 100, days: 30, desc: 'Hutch TikTok Unlimited', promo: '', server: 'PREMIUM SERVER 70', remaining: 28962, bonusCoins: 10, coinCost: 100, badge: null, category: 'speed_limit' },
    { id: 'DIALOG_SOCIAL', name: 'Dialog Social', network: 'Dialog', host: 'web.whatsapp.com', port: 443, target: 'sni', price: 200.00, originalPrice: null, isOffer: false, limitGB: 100, days: 30, desc: 'Dialog Social Unlimited Bypass', promo: '', server: 'PREMIUM SERVER 70', remaining: 28962, bonusCoins: 10, coinCost: 100, badge: null, category: 'speed_limit' },
    { id: 'AIRTEL_SOCIAL', name: 'Airtel Social', network: 'Airtel', host: 'www.googleapis.cn', port: 443, target: 'sni', price: 200.00, originalPrice: null, isOffer: false, limitGB: 100, days: 30, desc: 'Airtel Social Pack', promo: '', server: 'PREMIUM SERVER 70', remaining: 28962, bonusCoins: 10, coinCost: 100, badge: null, category: 'speed_limit' },
    { id: 'DIALOG_YOUTUBE', name: 'Dialog Youtube', network: 'Dialog', host: 'm.youtube.com', port: 443, target: 'sni', price: 200.00, originalPrice: null, isOffer: false, limitGB: 100, days: 30, desc: 'Dialog Youtube Pack', promo: '', server: 'PREMIUM SERVER 70', remaining: 28962, bonusCoins: 10, coinCost: 100, badge: null, category: 'speed_limit' },
    { id: 'DIALOG_SIM_ZOOM', name: 'Dialog Sim Zoom', network: 'Dialog', host: 'aka.ms', port: 443, target: 'sni', price: 200.00, originalPrice: null, isOffer: false, limitGB: 100, days: 30, desc: 'Dialog Zoom Non-Router', promo: '', server: 'PREMIUM SERVER 70', remaining: 28962, bonusCoins: 10, coinCost: 100, badge: null, category: 'speed_limit' },
    { id: 'AIRTEL_260', name: 'Airtel 260', network: 'Airtel', host: 'www.googleapis.cn', port: 443, target: 'sni', price: 200.00, originalPrice: null, isOffer: false, limitGB: 100, days: 30, desc: 'Airtel 260 Special SIM', promo: '', server: 'PREMIUM SERVER 70', remaining: 28962, bonusCoins: 10, coinCost: 100, badge: null, category: 'speed_limit' },
    { id: 'AIRTEL_135', name: 'Airtel 135', network: 'Airtel', host: 'www.googleapis.cn', port: 443, target: 'sni', price: 200.00, originalPrice: null, isOffer: false, limitGB: 100, days: 30, desc: 'Airtel 135 Social Pack', promo: '', server: 'PREMIUM SERVER 75', remaining: 3487, bonusCoins: 10, coinCost: 100, badge: null, category: 'speed_limit' },
    { id: 'MOBITEL_SOCIAL', name: 'Mobitel Social', network: 'Mobitel', host: 'web.whatsapp.com', port: 443, target: 'sni', price: 200.00, originalPrice: null, isOffer: false, limitGB: 100, days: 30, desc: 'Mobitel Social Unlimited', promo: '', server: 'PREMIUM SERVER 70', remaining: 28962, bonusCoins: 10, coinCost: 100, badge: null, category: 'speed_limit' }
];

const app = express();
const PORT = process.env.PORT || 3000;

// Enable CORS and parsing of request bodies
app.use(cors());
app.use(express.json({ limit: '50mb' })); // support large base64 uploads

// Safety timeout: prevent any request from hanging longer than 25s to avoid Nginx 60s 504
app.use((req, res, next) => {
    res.setTimeout(25000, () => {
        if (!res.headersSent) {
            console.warn(`[Timeout Guard] Request ${req.method} ${req.originalUrl || req.url} timed out after 25s`);
            res.status(504).json({ success: false, message: 'Request Timeout' });
        }
    });
    next();
});

// Automatically normalize API routes if Nginx proxy_pass stripped '/api' (e.g. proxy_pass http://127.0.0.1:3000/)
app.use((req, res, next) => {
    if (!req.url.startsWith('/api') && (
        req.url.startsWith('/auth') ||
        req.url.startsWith('/packages') ||
        req.url.startsWith('/user') ||
        req.url.startsWith('/slips') ||
        req.url.startsWith('/configs') ||
        req.url.startsWith('/chats') ||
        req.url.startsWith('/admin') ||
        req.url.startsWith('/public') ||
        req.url.startsWith('/health')
    )) {
        req.url = '/api' + req.url;
    }
    next();
});

// ----------------------------------------------------
// SECURITY MIDDLEWARE: Block direct access to configuration/backend files
// ----------------------------------------------------
app.use((req, res, next) => {
    const forbidden = [
        /\.env$/, 
        /server\.js$/, 
        /package\.json$/, 
        /package-lock\.json$/, 
        /^\/\.git/, 
        /db\.php$/, 
        /admin\/config\.php$/
    ];
    if (forbidden.some(pattern => pattern.test(req.path))) {
        return res.status(403).send('Access Denied');
    }
    next();
});

// Serve static frontend files and uploads from project root
app.use(express.static(path.join(__dirname)));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

async function connectDb() {
    const dbType = process.env.DATABASE_TYPE || 'local';
    
    if (dbType === 'local') {
        useLocalDb = true;
        console.log(`=========================================`);
        console.log(`📂 Using Local JSON Database (data/db.json)`);
        console.log(`=========================================`);
        await loadLocalDb();
        await initializeDatabase();
    } else if (firebaseConfig.apiKey && firebaseConfig.projectId) {
        try {
            const firebaseApp = initializeApp(firebaseConfig);
            db = getFirestore(firebaseApp);
            useFirebase = true;
            console.log(`=========================================`);
            console.log(`🔥 Connected to Firebase Firestore: ${firebaseConfig.projectId}`);
            console.log(`=========================================`);
            await initializeDatabase();
        } catch (error) {
            console.error('Firebase initialization failed:', error.message);
            // Fallback to local DB if firebase fails
            useLocalDb = true;
            console.log(`=========================================`);
            console.log(`📂 Falling back to Local JSON Database (data/db.json)`);
            console.log(`=========================================`);
            await loadLocalDb();
            await initializeDatabase();
        }
    } else {
        useLocalDb = true;
        console.log(`=========================================`);
        console.log(`📂 No database set, using Local JSON Database (data/db.json)`);
        console.log(`=========================================`);
        await loadLocalDb();
        await initializeDatabase();
    }
}

async function initializeDatabase() {
    try {
        if (useLocalDb) {
            // Check if packages are seeded
            const count = Object.keys(localDb.packages).length;
            if (count === 0) {
                console.log('Seeding default packages to local database...');
                for (const pkg of defaultPackages) {
                    localDb.packages[pkg.id] = pkg;
                }
                await saveLocalDb();
            }
            console.log('✓ Local DB Seeding complete.');
            return;
        }

        const packagesCol = collection(db, 'packages');
        const snapshot = await getDocs(packagesCol);
        
        // Clear existing packages to update to the new lists
        if (!snapshot.empty) {
            console.log('Clearing old packages from database...');
            for (const docSnap of snapshot.docs) {
                await deleteDoc(doc(db, 'packages', docSnap.id));
            }
        }
        
        console.log('Seeding new Speed and Speed Limit Packages to Firestore...');
        for (const pkg of defaultPackages) {
            await setDoc(doc(db, 'packages', pkg.id), pkg);
        }
        console.log('✓ Seeding complete.');
    } catch (error) {
        console.error('Database Initialization failed:', error.message);
    }
}

// ----------------------------------------------------
// X-UI PANEL & AUTO CONFIG GENERATION SERVICE
// ----------------------------------------------------
// DUAL 3X-UI PANEL LOAD BALANCER & CONFIG SERVICE
// ----------------------------------------------------
const httpsAgent = new https.Agent({ rejectUnauthorized: false });

let roundRobinCounter = 0;

function getPanels() {
    const panels = [];
    
    // Panel 1 (Primary)
    const p1Url = (process.env.PANEL_1_URL || process.env.XUI_URL || '').trim().replace(/\/+$/, '');
    if (p1Url) {
        panels.push({
            id: 1,
            name: 'Node 01 (Panther)',
            url: p1Url,
            ip: '139.162.13.244',
            username: process.env.PANEL_1_USERNAME || process.env.XUI_USERNAME || 'yasi',
            password: process.env.PANEL_1_PASSWORD || process.env.XUI_PASSWORD || 'yasi',
            domain: process.env.PANEL_1_DOMAIN || process.env.SERVER_DOMAIN || 'panther.tunnelfordelk.online',
            port: parseInt(process.env.PANEL_1_PORT || process.env.SERVER_PORT || 443),
            inboundId: parseInt(process.env.PANEL_1_INBOUND_ID || process.env.XUI_INBOUND_ID || 1),
            pbk: process.env.PANEL_1_PBK || process.env.REALITY_PBK || '',
            sid: process.env.PANEL_1_SID || process.env.REALITY_SID || '6ba85179'
        });
    }

    // Panel 2 (Secondary - 50/50 Balance)
    const p2Url = (process.env.PANEL_2_URL || '').trim().replace(/\/+$/, '');
    if (p2Url) {
        panels.push({
            id: 2,
            name: 'Node 02 (Site)',
            url: p2Url,
            ip: '139.162.36.104',
            username: process.env.PANEL_2_USERNAME || 'site',
            password: process.env.PANEL_2_PASSWORD || 'site',
            domain: process.env.PANEL_2_DOMAIN || 'site.tunnelfordelk.online',
            port: parseInt(process.env.PANEL_2_PORT || 443),
            inboundId: parseInt(process.env.PANEL_2_INBOUND_ID || 1),
            pbk: process.env.PANEL_2_PBK || '',
            sid: process.env.PANEL_2_SID || '6ba85179'
        });
    }

    // Fallback if none configured
    if (panels.length === 0) {
        panels.push({
            id: 1,
            name: 'Node 01 (Default)',
            url: '',
            ip: '139.162.13.244',
            username: 'yasi',
            password: 'yasi',
            domain: 'panther.tunnelfordelk.online',
            port: 443,
            inboundId: 1,
            pbk: '',
            sid: '6ba85179'
        });
    }
    return panels;
}

function getPanelBaseUrl(panel) {
    const raw = (panel.url || '').trim().replace(/\/+$/, '');
    if (!raw) return '';
    if (panel.ip && raw.includes(':2025')) {
        const afterPort = raw.substring(raw.indexOf(':2025') + 5);
        return `https://${panel.ip}:2025${afterPort}`;
    }
    return raw;
}

// Memory cache for session cookies & CSRF tokens per panel
const panelSessions = {
    1: { cookie: '', csrf: '', expiry: 0 },
    2: { cookie: '', csrf: '', expiry: 0 }
};

const panelInboundCache = {
    1: { inbounds: null, expiry: 0 },
    2: { inbounds: null, expiry: 0 }
};

// In-memory cache for panel traffic stats (15 seconds TTL)
const clientTrafficCache = {};

async function loginToPanel(panel) {
    if (!panel.url) {
        throw new Error(`Panel ${panel.id} URL is not configured.`);
    }
    const cleanUrl = getPanelBaseUrl(panel);
    try {
        // Step 1: GET panel home to retrieve initial cookie and CSRF token
        const getRes = await axios.get(`${cleanUrl}/`, {
            headers: {
                'Host': panel.domain,
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'
            },
            httpsAgent: httpsAgent,
            timeout: 10000
        });

        const initialCookies = getRes.headers['set-cookie'] || [];
        const csrfMatch = (getRes.data || '').match(/name="csrf-token"\s+content="([^"]+)"/);
        const csrfToken = csrfMatch ? csrfMatch[1] : '';
        const cookieHeader = initialCookies.map(c => c.split(';')[0]).join('; ');

        // Step 2: POST JSON login payload with CSRF header
        const postRes = await axios.post(`${cleanUrl}/login`, {
            username: panel.username,
            password: panel.password
        }, {
            headers: {
                'Host': panel.domain,
                'Content-Type': 'application/json',
                'Cookie': cookieHeader,
                'x-csrf-token': csrfToken,
                'Referer': `${cleanUrl}/`
            },
            httpsAgent: httpsAgent,
            timeout: 10000
        });

        const authCookies = postRes.headers['set-cookie'] || initialCookies;
        const authCookie = authCookies.map(c => c.split(';')[0]).join('; ');

        panelSessions[panel.id] = {
            cookie: authCookie,
            csrf: csrfToken,
            expiry: Date.now() + 10 * 60 * 1000 // 10 mins cache
        };

        console.log(`[3x-ui] Logged in to Panel ${panel.id} (${panel.domain}) successfully!`);
        return panelSessions[panel.id];
    } catch (error) {
        console.error(`[3x-ui Panel ${panel.id}] Login failed:`, error.message);
        throw error;
    }
}

async function getPanelSession(panel) {
    const cached = panelSessions[panel.id];
    if (!cached || !cached.cookie || Date.now() > cached.expiry) {
        return await loginToPanel(panel);
    }
    return cached;
}

// Legacy helper for cookie
async function getPanelCookie(panel) {
    const session = await getPanelSession(panel);
    return session.cookie;
}

// 50/50 Round Robin Panel Selector
function getNextPanel() {
    const panels = getPanels();
    if (panels.length === 1) return panels[0];
    
    // Balance equally (Round-Robin alternating)
    const selected = panels[roundRobinCounter % panels.length];
    roundRobinCounter = (roundRobinCounter + 1) % 10000;
    console.log(`[Load Balancer] 50/50 Balanced -> Selected Panel ${selected.id} (${selected.name}: ${selected.domain}) for next client`);
    return selected;
}

function getPanelById(id) {
    const panels = getPanels();
    const found = panels.find(p => p.id === parseInt(id));
    return found || panels[0];
}

// Rule dictionary mapping planId -> { host, port, target: 'address' | 'sni' }
const PACKAGE_RULES = {
    // Port 8080 (Airtel Zoom & Hutch Zoom) -> Host goes to address
    'HUTCH_ZOOM': { host: 'Support.zoom.us', port: 8080, target: 'address' },
    'AIRTEL_ZOOM': { host: 'Support.zoom.us', port: 8080, target: 'address' },

    // Port 8443 (Mobitel Zoom) -> Host goes to address
    'MOBITEL_ZOOM': { host: '104.17.70.206', port: 8443, target: 'address' },

    // Port 443 (All other packages) -> Host goes to SNI
    'DIALOG_ROUTER_ZOOM': { host: 'aka.ms', port: 443, target: 'sni' },
    'DIALOG_TIKTOK': { host: 'www.tiktok.com', port: 443, target: 'sni' },
    'SLT_ZOOM': { host: 'zoom.us', port: 443, target: 'sni' },
    'SLT_NETFLIX': { host: 'netflix.com', port: 443, target: 'sni' },
    'AIRTEL_TIKTOK': { host: 'www.tiktok.com', port: 443, target: 'sni' },
    'AIRTEL_YOUTUBE': { host: 'm.youtube.com', port: 443, target: 'sni' },
    'HUTCH_SOCIAL': { host: 'static-web.likeevideo.com', port: 443, target: 'sni' },
    'HUTCH_TIKTOK': { host: 'www.tiktok.com', port: 443, target: 'sni' },
    'DIALOG_SOCIAL': { host: 'web.whatsapp.com', port: 443, target: 'sni' },
    'AIRTEL_SOCIAL': { host: 'www.googleapis.cn', port: 443, target: 'sni' },
    'MOBITEL_SOCIAL': { host: 'web.whatsapp.com', port: 443, target: 'sni' },
    'DIALOG_YOUTUBE': { host: 'm.youtube.com', port: 443, target: 'sni' },
    'DIALOG_348': { host: 'aka.ms', port: 443, target: 'sni' },
    'DIALOG_1118': { host: 'aka.ms', port: 443, target: 'sni' },
    'DIALOG_SIM_ZOOM': { host: 'aka.ms', port: 443, target: 'sni' },
    'AIRTEL_260': { host: 'www.googleapis.cn', port: 443, target: 'sni' },
    'AIRTEL_135': { host: 'www.googleapis.cn', port: 443, target: 'sni' }
};

function resolvePackageRule(planId = '', planName = '') {
    const key = (planId || '').toUpperCase().trim();
    if (key && PACKAGE_RULES[key]) {
        return PACKAGE_RULES[key];
    }
    
    // Look up package in defaultPackages
    const foundPkg = defaultPackages.find(p => p.id === planId || (planName && p.name.toLowerCase() === planName.toLowerCase()));
    if (foundPkg && foundPkg.host) {
        return {
            host: foundPkg.host,
            port: foundPkg.port || 443,
            target: foundPkg.target || (foundPkg.port === 8080 || foundPkg.port === 8443 ? 'address' : 'sni')
        };
    }

    // Keyword heuristics
    const text = `${planId} ${planName}`.toLowerCase();
    if (text.includes('hutch') && text.includes('zoom')) {
        return { host: 'Support.zoom.us', port: 8080, target: 'address' };
    }
    if (text.includes('airtel') && text.includes('zoom')) {
        return { host: 'Support.zoom.us', port: 8080, target: 'address' };
    }
    if (text.includes('mobitel') && text.includes('zoom')) {
        return { host: '104.17.70.206', port: 8443, target: 'address' };
    }
    if (text.includes('dialog') && (text.includes('router') || text.includes('348') || text.includes('1118'))) {
        return { host: 'aka.ms', port: 443, target: 'sni' };
    }
    if (text.includes('tiktok')) {
        return { host: 'www.tiktok.com', port: 443, target: 'sni' };
    }
    if (text.includes('youtube')) {
        return { host: 'm.youtube.com', port: 443, target: 'sni' };
    }
    if (text.includes('netflix')) {
        return { host: 'netflix.com', port: 443, target: 'sni' };
    }
    if (text.includes('hutch') && text.includes('social')) {
        return { host: 'static-web.likeevideo.com', port: 443, target: 'sni' };
    }
    if (text.includes('airtel') && text.includes('social')) {
        return { host: 'www.googleapis.cn', port: 443, target: 'sni' };
    }
    if (text.includes('dialog') && text.includes('social')) {
        return { host: 'web.whatsapp.com', port: 443, target: 'sni' };
    }
    if (text.includes('mobitel') && text.includes('social')) {
        return { host: 'web.whatsapp.com', port: 443, target: 'sni' };
    }
    if (text.includes('zoom')) {
        return { host: 'zoom.us', port: 443, target: 'sni' };
    }

    // Default fallback
    return {
        host: process.env.DEFAULT_SNI || 'aka.ms',
        port: 443,
        target: 'sni'
    };
}

// Retrieve inbound stream settings for a specific panel (Reality Public Key, Port, Network)
// Retrieve inbound list for a specific panel with caching
async function fetchPanelInbounds(panel, forceFresh = false) {
    const cached = panelInboundCache[panel.id];
    if (!forceFresh && cached && cached.inbounds && Date.now() < cached.expiry) {
        return cached.inbounds;
    }
    if (!panel.url) return [];

    try {
        const cleanUrl = getPanelBaseUrl(panel);
        const session = await getPanelSession(panel);
        const res = await axios.get(`${cleanUrl}/panel/api/inbounds/list`, {
            headers: {
                'Host': panel.domain,
                'Cookie': session.cookie,
                'x-csrf-token': session.csrf,
                'Referer': `${cleanUrl}/panel/`
            },
            httpsAgent: httpsAgent,
            timeout: 10000
        });

        if (res.data && res.data.success && res.data.obj) {
            const inbounds = res.data.obj;
            panelInboundCache[panel.id] = {
                inbounds: inbounds,
                expiry: Date.now() + (30 * 1000) // 30s cache for fast responsiveness and fresh client counts
            };
            return inbounds;
        }
    } catch (err) {
        console.warn(`[3x-ui Panel ${panel.id}] Could not fetch inbounds list:`, err.message);
    }
    return cached && cached.inbounds ? cached.inbounds : [];
}

// Calculate total unique clients on a specific panel
async function getPanelClientCount(panel, forceFresh = false) {
    if (!panel || !panel.url) {
        return { count: Infinity, online: false, panel, error: 'No URL configured' };
    }
    try {
        const inbounds = await fetchPanelInbounds(panel, forceFresh);
        if (!Array.isArray(inbounds) || inbounds.length === 0) {
            return { count: 0, online: inbounds !== null, panel };
        }

        const uniqueClients = new Set();
        let fallbackClientTotal = 0;

        for (const inb of inbounds) {
            // Check inb.clientStats
            if (Array.isArray(inb.clientStats) && inb.clientStats.length > 0) {
                for (const s of inb.clientStats) {
                    const tag = s.email || s.uuid || s.id;
                    if (tag) uniqueClients.add(tag);
                    else fallbackClientTotal++;
                }
            } else if (inb.settings) {
                // Check inb.settings JSON
                try {
                    const parsed = typeof inb.settings === 'string' ? JSON.parse(inb.settings) : inb.settings;
                    if (parsed && Array.isArray(parsed.clients)) {
                        for (const c of parsed.clients) {
                            const tag = c.email || c.id;
                            if (tag) uniqueClients.add(tag);
                            else fallbackClientTotal++;
                        }
                    }
                } catch (_) {}
            }
        }

        const totalClients = uniqueClients.size + fallbackClientTotal;
        return { count: totalClients, online: true, panel };
    } catch (err) {
        console.warn(`[Load Balancer] Failed to get client count for Panel ${panel.id}:`, err.message);
        return { count: Infinity, online: false, panel, error: err.message };
    }
}

// Select the panel with the lowest number of clients (Least-Loaded Load Balancer)
async function getLeastLoadedPanel(requiredPort = null) {
    const panels = getPanels();
    if (panels.length <= 1) return panels[0] || null;

    try {
        // Query client counts for all panels concurrently
        const results = await Promise.all(panels.map(p => getPanelClientCount(p, false)));
        const onlinePanels = results.filter(r => r.online);

        if (onlinePanels.length === 0) {
            console.warn('[Load Balancer] Both panels unreachable for client count. Falling back to Round-Robin.');
            return getNextPanel();
        }

        if (onlinePanels.length === 1) {
            const single = onlinePanels[0].panel;
            console.log(`[Load Balancer] Only Panel ${single.id} (${single.name}) is online with ${onlinePanels[0].count} clients.`);
            return single;
        }

        // Sort ascending by client count
        onlinePanels.sort((a, b) => a.count - b.count);

        const best = onlinePanels[0];
        const second = onlinePanels[1];

        console.log(`[Load Balancer] Live Client Counts -> Panel ${best.panel.id} (${best.panel.name}): ${best.count} clients | Panel ${second.panel.id} (${second.panel.name}): ${second.count} clients`);

        if (best.count === second.count) {
            // If tied, use round-robin
            return getNextPanel();
        }

        console.log(`[Load Balancer] -> Selected Panel ${best.panel.id} (${best.panel.name}) because it has FEWEST clients (${best.count} vs ${second.count})`);
        return best.panel;
    } catch (err) {
        console.error('[Load Balancer] Error in getLeastLoadedPanel:', err.message);
        return getNextPanel();
    }
}

// ----------------------------------------------------
// CORE AUTO CONFIG GENERATOR FOR PACKAGES & USERS
// ----------------------------------------------------
async function create3xuiClient({ email, planId = '', planName = '', selectedGb = '100', days = 30, panelId = null, inboundId = null }) {
    const clientUuid = crypto.randomUUID();
    const subId = crypto.randomUUID().replace(/-/g, '').substring(0, 16);
    const rule = resolvePackageRule(planId, planName);
    
    // Choose panel: specific panel requested or balanced by lowest client count (least loaded)
    const panel = panelId ? getPanelById(panelId) : await getLeastLoadedPanel(rule?.port);
    
    const totalBytes = (selectedGb === 'Unlimited' || selectedGb === 'unlimited') ? 0 : (parseInt(selectedGb) || 100) * 1024 * 1024 * 1024;
    const expiryTime = Date.now() + (parseInt(days) || 30) * 24 * 3600 * 1000;
    
    const serverDomain = panel.domain;
    const cleanUserTag = (email.split('@')[0] || email).replace(/[^a-zA-Z0-9_-]/g, '');
    const cleanPlanTag = (planId || 'vip').replace(/[^a-zA-Z0-9_-]/g, '_').toLowerCase();
    // Unique client identifier in 3x-ui combining user prefix, package name, and subId token
    const clientEmailTag = `${cleanUserTag}_${cleanPlanTag}_${subId.substring(0, 4)}`;
    const remark = `TFL-P${panel.id}-${(planId || 'VIP').replace(/_/g, '-')}-${cleanUserTag}`;

    let addedToXui = false;
    let configLink = '';
    const cleanUrl = getPanelBaseUrl(panel);

    // 1. Fetch live inbounds from panel and match by rule port (8080, 8443, 443, etc.)
    let targetInbound = null;
    let inbounds = [];
    try {
        inbounds = await fetchPanelInbounds(panel);
        if (inboundId) {
            targetInbound = inbounds.find(ib => ib.id === parseInt(inboundId));
        }
        if (!targetInbound) {
            targetInbound = inbounds.find(ib => ib.port === rule.port) || inbounds[0];
        }
    } catch (e) {
        console.warn(`[3x-ui Panel ${panel.id}] Could not list inbounds:`, e.message);
    }

    const targetInboundId = targetInbound ? targetInbound.id : (panel.inboundId || 1);

    // 2. Attempt live addition to chosen 3x-ui Panel via official /panel/api/clients/add
    if (panel.url) {
        try {
            const session = await getPanelSession(panel);
            
            // Delete only if this exact client tag already exists to prevent duplicate error
            try {
                await axios.post(`${cleanUrl}/panel/api/clients/del/${encodeURIComponent(clientEmailTag)}`, {}, {
                    headers: {
                        'Host': panel.domain,
                        'Cookie': session.cookie,
                        'x-csrf-token': session.csrf,
                        'Referer': `${cleanUrl}/panel/`
                    },
                    httpsAgent: httpsAgent,
                    timeout: 6000
                });
            } catch (_) {}

            const clientPayload = {
                id: clientUuid,
                email: clientEmailTag,
                limitIp: 2,
                totalGB: totalBytes,
                expiryTime: expiryTime,
                enable: true,
                subId: subId,
                flow: (rule.port === 443) ? "xtls-rprx-vision" : ""
            };

            const response = await axios.post(`${cleanUrl}/panel/api/clients/add`, {
                client: clientPayload,
                inboundIds: [ targetInboundId ]
            }, {
                headers: {
                    'Host': panel.domain,
                    'Cookie': session.cookie,
                    'Content-Type': 'application/json',
                    'x-csrf-token': session.csrf,
                    'Referer': `${cleanUrl}/panel/`
                },
                httpsAgent: httpsAgent,
                timeout: 10000
            });

            if (response.data && response.data.success) {
                console.log(`[3x-ui Panel ${panel.id} (${panel.domain})] Client ${clientEmailTag} successfully ADDED to inbound ${targetInboundId} (Port: ${rule.port})!`);
                addedToXui = true;

                // 3. Fetch real connection links generated directly by 3x-ui panel!
                try {
                    const linksRes = await axios.get(`${cleanUrl}/panel/api/clients/links/${encodeURIComponent(clientEmailTag)}`, {
                        headers: {
                            'Host': panel.domain,
                            'Cookie': session.cookie,
                            'x-csrf-token': session.csrf,
                            'Referer': `${cleanUrl}/panel/`
                        },
                        httpsAgent: httpsAgent,
                        timeout: 8000
                    });

                    if (linksRes.data && linksRes.data.obj && linksRes.data.obj.length > 0) {
                        const rawLink = linksRes.data.obj[0];
                        // Adapt rawLink for bug host / SNI placement rules:
                        if (rule.target === 'address') {
                            // Replace @domain:port with @rule.host:rule.port
                            configLink = rawLink.replace(/@([^:]+):(\d+)/, `@${rule.host}:${rule.port}`);
                        } else {
                            // Port 443: ensure sni=rule.host
                            if (rawLink.includes('sni=')) {
                                configLink = rawLink.replace(/sni=[^&]+/, `sni=${encodeURIComponent(rule.host)}`);
                            } else {
                                configLink = rawLink.replace('?', `?sni=${encodeURIComponent(rule.host)}&`);
                            }
                        }
                        // Update hash tag / remark
                        configLink = configLink.replace(/#[^#]*$/, `#${encodeURIComponent(remark)}`);
                        console.log(`[3x-ui Panel ${panel.id}] Generated REAL link directly from panel:`, configLink);
                    }
                } catch (linkErr) {
                    console.warn(`[3x-ui Panel ${panel.id}] Could not fetch links via API:`, linkErr.message);
                }
            } else {
                console.warn(`[3x-ui Panel ${panel.id}] addClient response:`, response.data);
            }
        } catch (apiErr) {
            console.error(`[3x-ui Panel ${panel.id}] Failed to create client on 3x-ui VPS (${apiErr.message}).`);
        }
    }

    // Fallback link generation if panel link was not returned
    if (!configLink) {
        if (rule.target === 'address') {
            if (rule.port === 8080) {
                configLink = `vless://${clientUuid}@${rule.host}:8080?type=ws&security=none&path=%2F&host=${serverDomain}#${encodeURIComponent(remark)}`;
            } else if (rule.port === 8443) {
                configLink = `vless://${clientUuid}@${rule.host}:8443?type=ws&security=tls&sni=${serverDomain}&host=${serverDomain}&path=%2F#${encodeURIComponent(remark)}`;
            } else {
                configLink = `vless://${clientUuid}@${rule.host}:${rule.port}?type=ws&security=none&path=%2F&host=${serverDomain}#${encodeURIComponent(remark)}`;
            }
        } else {
            configLink = `vless://${clientUuid}@${serverDomain}:443?security=reality&encryption=none&headerType=none&fp=chrome&spx=%2F&type=tcp&flow=xtls-rprx-vision&sni=${rule.host}&sid=6ba85179#${encodeURIComponent(remark)}`;
        }
    }

    // Build Subscription Link using selected panel
    const subLink = panel.url ? `${panel.url}/sub/${subId}` : `https://${serverDomain}/sub/${subId}`;

    return {
        success: true,
        addedToXui: addedToXui,
        panelId: panel.id,
        panelDomain: panel.domain,
        panelName: panel.name,
        uuid: clientUuid,
        subId: subId,
        email: email,
        host: rule.host,
        port: rule.port,
        target: rule.target,
        sni: rule.target === 'sni' ? rule.host : serverDomain,
        address: rule.target === 'address' ? rule.host : serverDomain,
        planId: planId,
        configLink: configLink,
        subLink: subLink,
        totalGB: selectedGb,
        expiryTime: expiryTime
    };
}

// Helper to update client totalGB and expiryTime across 3x-ui panels (Panel 1 & Panel 2) during renewal
async function update3xuiClientStats(preferredPanelId, clientUuid, { totalGb, addGb, expiryTime, days, userEmail, clientEmail }) {
    if (!clientUuid && !clientEmail && !userEmail) return false;
    
    // Build panel search order (preferred panel first, then all other panels)
    const allPanels = getPanels();
    const panelsToTry = [];
    if (preferredPanelId) {
        const preferred = getPanelById(preferredPanelId);
        if (preferred) panelsToTry.push(preferred);
    }
    for (const p of allPanels) {
        if (!panelsToTry.some(x => x.id === p.id)) panelsToTry.push(p);
    }

    for (const panel of panelsToTry) {
        if (!panel || !panel.url) continue;
        try {
            const session = await getPanelSession(panel);
            const cleanUrl = getPanelBaseUrl(panel);
            const inbRes = await axios.get(`${cleanUrl}/panel/api/inbounds/list`, {
                headers: {
                    'Host': panel.domain,
                    'Cookie': session.cookie,
                    'x-csrf-token': session.csrf,
                    'Referer': `${cleanUrl}/panel/`
                },
                httpsAgent: httpsAgent,
                timeout: 8000
            });

            if (!inbRes.data || !inbRes.data.success || !Array.isArray(inbRes.data.obj)) {
                continue;
            }

            let foundClient = null;
            let foundInboundId = null;

            for (const inb of inbRes.data.obj) {
                let settings = {};
                try {
                    settings = typeof inb.settings === 'string' ? JSON.parse(inb.settings) : inb.settings;
                } catch (_) {}

                if (settings && Array.isArray(settings.clients)) {
                    // Find client matching uuid, numeric id, client email, or user email prefix
                    const client = settings.clients.find(c => 
                        (clientUuid && (c.uuid === clientUuid || c.id === clientUuid || String(c.id) === String(clientUuid))) ||
                        (clientEmail && c.email && c.email.toLowerCase() === clientEmail.toLowerCase()) ||
                        (userEmail && c.email && c.email.toLowerCase().includes(userEmail.split('@')[0].toLowerCase()))
                    );

                    if (client) {
                        foundClient = client;
                        foundInboundId = inb.id;
                        break;
                    }
                }
            }

            if (!foundClient) continue;

            console.log(`[3x-ui Panel ${panel.id} (${panel.name})] Found client ${foundClient.email} (${foundClient.uuid || foundClient.id}) in inbound ${foundInboundId}`);

            // Fetch fresh client record from /panel/api/clients/get/:email
            let fullClient = foundClient;
            let usedBytes = 0;
            try {
                const getClientRes = await axios.get(`${cleanUrl}/panel/api/clients/get/${encodeURIComponent(foundClient.email)}`, {
                    headers: {
                        'Host': panel.domain,
                        'Cookie': session.cookie,
                        'x-csrf-token': session.csrf
                    },
                    httpsAgent: httpsAgent,
                    timeout: 6000
                });
                if (getClientRes.data && getClientRes.data.success && getClientRes.data.obj && getClientRes.data.obj.client) {
                    fullClient = getClientRes.data.obj.client;
                    usedBytes = Number(getClientRes.data.obj.usedTraffic) || 0;
                }
            } catch (errGet) {
                console.warn(`[3x-ui Panel ${panel.id}] Could not fetch client details via /get, using inbound record:`, errGet.message);
            }

            // Calculate total bytes (with cumulative rollover: never allow totalGB <= usedTraffic for active renewals)
            let totalBytes = 0;
            if (totalGb === 'Unlimited' || totalGb === 'unlimited') {
                totalBytes = 0;
            } else {
                const nominalBytes = (parseInt(totalGb) || 100) * 1024 * 1024 * 1024;
                const additionalBytes = (parseInt(addGb) || 50) * 1024 * 1024 * 1024;
                totalBytes = Math.max(nominalBytes, usedBytes + additionalBytes);
            }

            // Calculate expiration time (extend from current expiry if not yet expired)
            let newExpiry = expiryTime;
            const maxReasonableExpiry = Date.now() + 65 * 86400000;
            if (!newExpiry || newExpiry > maxReasonableExpiry) {
                const currentExpiry = Number(fullClient.expiryTime) || 0;
                const baseExpiry = (currentExpiry > Date.now() && currentExpiry <= Date.now() + 35 * 86400000) ? currentExpiry : Date.now();
                newExpiry = baseExpiry + (parseInt(days) || 30) * 86400000;
            }

            const uuidString = fullClient.uuid || fullClient.id || clientUuid;
            const clientPayload = {
                id: uuidString, // Must be UUID string
                email: fullClient.email,
                subId: fullClient.subId || '',
                password: fullClient.password || '',
                auth: fullClient.auth || '',
                flow: fullClient.flow || '',
                security: fullClient.security || 'auto',
                totalGB: totalBytes,
                expiryTime: newExpiry,
                reset: Number(fullClient.reset) || 0,
                resetDay: Number(fullClient.resetDay) || 0,
                resetMax: Number(fullClient.resetMax) || 0,
                trafficReset: fullClient.trafficReset || 'never',
                trafficResetDay: Number(fullClient.trafficResetDay) || 1,
                limitIp: Number(fullClient.limitIp) || 0,
                limitHwid: Number(fullClient.limitHwid) || 0,
                tgId: Number(fullClient.tgId) || 0,
                group: fullClient.group || '',
                comment: fullClient.comment || '',
                enable: true
            };
            if (fullClient.reverse && fullClient.reverse.tag) {
                clientPayload.reverse = { tag: fullClient.reverse.tag };
            }

            // Send primary update to /panel/api/clients/update/:email
            let updated = false;
            try {
                const updateRes = await axios.post(`${cleanUrl}/panel/api/clients/update/${encodeURIComponent(fullClient.email)}`, clientPayload, {
                    headers: {
                        'Host': panel.domain,
                        'Cookie': session.cookie,
                        'Content-Type': 'application/json',
                        'x-csrf-token': session.csrf,
                        'Referer': `${cleanUrl}/panel/`
                    },
                    httpsAgent: httpsAgent,
                    timeout: 8000
                });
                if (updateRes.data && updateRes.data.success) {
                    updated = true;
                }
            } catch (err1) {
                console.warn(`[3x-ui Panel ${panel.id}] Primary update failed:`, err1.message);
            }

            // Guarantee client is active and enabled in Xray core
            try {
                await axios.post(`${cleanUrl}/panel/api/clients/bulkEnable`, {
                    emails: [ fullClient.email ]
                }, {
                    headers: {
                        'Host': panel.domain,
                        'Cookie': session.cookie,
                        'Content-Type': 'application/json',
                        'x-csrf-token': session.csrf,
                        'Referer': `${cleanUrl}/panel/`
                    },
                    httpsAgent: httpsAgent,
                    timeout: 6000
                });
            } catch (enableErr) {
                console.warn(`[3x-ui Panel ${panel.id}] bulkEnable warning:`, enableErr.message);
            }

            console.log(`[3x-ui Panel ${panel.id} (${panel.name})] Client ${fullClient.email} updated: success=${updated} (Total Limit: ${totalBytes === 0 ? 'Unlimited' : Math.round(totalBytes/(1024*1024*1024)) + ' GB'}, Expiry: ${new Date(newExpiry).toISOString()})`);

            // Clear traffic cache for this client so stats fetch is live
            for (const k of Object.keys(clientTrafficCache)) {
                if ((fullClient.uuid && k.includes(fullClient.uuid)) || k.includes(String(fullClient.id)) || k.includes(fullClient.email.toLowerCase())) {
                    delete clientTrafficCache[k];
                }
            }
            return true;
        } catch (err) {
            console.warn(`[3x-ui Panel ${panel.id}] Error while updating client:`, err.message);
        }
    }
    console.warn(`[3x-ui] Client ${clientUuid || clientEmail || userEmail} was not found on any active panel.`);
    return false;
}

const mockTrafficData = {
    'demo@gmail.com': {
        email: 'demo@gmail.com',
        up: 42949672960, down: 53687091200, total: 107374182400,
        expiryTime: Date.now() + 15 * 24 * 60 * 60 * 1000,
        configLink: 'vless://demo-config-uuid@site.unlimiteddat.shop:443?type=tcp&security=tls#TunnelFordeLK-Premium-Demo'
    }
};

const SYSTEM_ADMIN_EMAILS = [
    'yasindulakshan2006@gmail.com',
    'lakshanyasindu575@gmail.com',
    'fordeltunnel@gmail.com'
];

function isSystemAdminEmail(email) {
    if (!email || typeof email !== 'string') return false;
    const normalized = email.toLowerCase().trim();
    return SYSTEM_ADMIN_EMAILS.includes(normalized);
}

// In-Memory Presence Registry (Tracks online/offline status in real time)
const activePresence = new Map();

function recordPresence(email, role, name) {
    if (!email) return;
    const cleanEmail = email.toLowerCase().trim();
    const effectiveRole = (isSystemAdminEmail(cleanEmail) || role === 'admin') ? 'admin' : 'user';
    activePresence.set(cleanEmail, {
        lastSeen: Date.now(),
        role: effectiveRole,
        name: name || ''
    });
}

function isUserCurrentlyOnline(email) {
    if (!email) return false;
    const entry = activePresence.get(email.toLowerCase().trim());
    if (!entry) return false;
    return (Date.now() - entry.lastSeen) < 45000; // 45 seconds heartbeat window
}

function isAnyAdminOnline() {
    const now = Date.now();
    for (const [email, data] of activePresence.entries()) {
        if ((data.role === 'admin' || isSystemAdminEmail(email)) && (now - data.lastSeen < 45000)) {
            return true;
        }
    }
    return false;
}

function authenticateToken(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    
    if (!token) {
        return res.status(401).json({ success: false, message: 'Session token required.' });
    }
    
    jwt.verify(token, process.env.JWT_SECRET || 'jwt-secret-key-unlimiteddat', (err, user) => {
        if (err) {
            return res.status(403).json({ success: false, message: 'Invalid or expired session. Please login again.' });
        }
        req.user = user;
        // Strictly allow admin role for registered system admins or verified admin accounts
        if (isSystemAdminEmail(req.user.email) || req.user.role === 'admin') {
            req.user.role = 'admin';
        } else {
            req.user.role = 'user';
        }
        recordPresence(req.user.email, req.user.role, req.user.name);
        next();
    });
}

// Presence Heartbeat API (Keeps user/admin online and syncs presence)
app.post('/api/presence/heartbeat', authenticateToken, (req, res) => {
    recordPresence(req.user.email, req.user.role, req.user.name);
    res.json({
        success: true,
        isAdminOnline: isAnyAdminOnline(),
        isSelfOnline: true,
        timestamp: Date.now()
    });
});

app.post('/api/presence/offline', authenticateToken, (req, res) => {
    if (req.user && req.user.email) {
        activePresence.delete(req.user.email.toLowerCase().trim());
    }
    res.json({ success: true, isAdminOnline: isAnyAdminOnline() });
});

// ----------------------------------------------------
// API ENDPOINTS
// ----------------------------------------------------

// Google OAuth2 Client
let googleOAuthClient = null;
if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_ID !== 'your-google-client-id') {
    try {
        googleOAuthClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);
    } catch (e) {
        console.warn('Could not initialize Google OAuth2Client:', e.message);
    }
}

// ----------------------------------------------------
// REFERRAL PROGRAM HELPERS
// ----------------------------------------------------
function generateReferralCode(name, id) {
    const cleanName = (name || '').replace(/[^a-zA-Z0-9]/g, '').toUpperCase().slice(0, 4);
    const randSuffix = Math.random().toString(36).substring(2, 6).toUpperCase();
    return cleanName ? `TF-${cleanName}${randSuffix.slice(0, 2)}` : `TF-${randSuffix}`;
}

// Endpoint: Verify Google Sign-In ID Token & Issue JWT
app.post('/api/auth/google', async (req, res) => {
    const { token, demoUser, referralCode } = req.body;
    
    try {
        let email = '';
        let name = '';
        let picture = 'https://lh3.googleusercontent.com/a/default-user=s96-c';
        
        // Demo bypass or live token verification
        if (demoUser || !token || !googleOAuthClient) {
            email = demoUser ? demoUser.email : (req.body.email || 'demo@gmail.com');
            name = demoUser ? demoUser.name : (req.body.name || 'Demo Google User');
            picture = (demoUser && demoUser.picture) ? demoUser.picture : picture;
        } else {
            let payload = null;
            try {
                // Try fast verification with 3.5s timeout
                const ticket = await Promise.race([
                    googleOAuthClient.verifyIdToken({
                        idToken: token,
                        audience: process.env.GOOGLE_CLIENT_ID
                    }),
                    new Promise((_, reject) => setTimeout(() => reject(new Error('Google verify timeout')), 3500))
                ]);
                payload = ticket.getPayload();
            } catch (vErr) {
                console.warn('[Google Auth] Fast fallback to decoded token payload:', vErr.message);
                // Instant fallback: decode Google JWT directly if cert server is slow
                const decoded = jwt.decode(token);
                if (decoded && decoded.email && (decoded.iss === 'https://accounts.google.com' || decoded.iss === 'accounts.google.com')) {
                    payload = decoded;
                } else {
                    throw vErr;
                }
            }
            email = payload.email;
            name = payload.name || payload.email.split('@')[0];
            picture = payload.picture || picture;
        }

        if (!email) {
            return res.status(400).json({ success: false, message: 'Valid Google email is required.' });
        }

        // Database user record synchronization (keyed by Google email)
        let userRole = isSystemAdminEmail(email) ? 'admin' : 'user';

        if (useFirebase || useLocalDb) {
            const userDocRef = doc(db, 'users', email);
            const userSnap = await getDoc(userDocRef);
            
            if (userSnap.exists()) {
                const existing = userSnap.data();
                userRole = isSystemAdminEmail(email) ? 'admin' : 'user';
                const updates = {
                    name: name || existing.name,
                    picture: picture,
                    role: userRole,
                    last_login: Date.now()
                };
                if (!existing.referral_code) {
                    updates.referral_code = generateReferralCode(existing.name || name, email);
                }
                await updateDoc(userDocRef, updates);
            } else {
                userRole = isSystemAdminEmail(email) ? 'admin' : 'user';
                const refCode = generateReferralCode(name, email);
                const cleanReferredBy = (referralCode && typeof referralCode === 'string' && referralCode.trim().toUpperCase() !== refCode) ? referralCode.trim().toUpperCase() : null;

                const newUserData = {
                    email: email,
                    name: name,
                    picture: picture,
                    coins: 10,
                    referral_code: refCode,
                    referred_by: cleanReferredBy,
                    referral_rewarded: false,
                    referral_earnings: 0,
                    referral_successful_count: 0,
                    status: 'inactive',
                    role: userRole,
                    plan: 'None',
                    expiry_time: 0,
                    panel_id: 1,
                    config_link: '',
                    sub_link: '',
                    client_uuid: '',
                    packages: [],
                    created_at: Date.now(),
                    last_login: Date.now()
                };

                await setDoc(userDocRef, newUserData);
            }
        }

        const userToken = jwt.sign(
            { email, name, picture, role: userRole },
            process.env.JWT_SECRET || 'jwt-secret-key-unlimiteddat',
            { expiresIn: '7d' }
        );

        if (isSystemAdminEmail(email)) {
            userRole = 'admin';
        }
        
        res.json({
            success: true,
            token: userToken,
            user: { email, name, picture, role: userRole }
        });
    } catch (error) {
        console.error('Google Sign-In Error:', error.message);
        res.status(401).json({ success: false, message: 'Google authentication failed: ' + error.message });
    }
});

// User Registration
app.post('/api/auth/register', async (req, res) => {
    const { phone, name, password, referralCode } = req.body;
    if (!phone || !name || !password) {
        return res.status(400).json({ success: false, message: 'All fields are required.' });
    }
    
    try {
        if ((!useFirebase && !useLocalDb)) {
            return res.status(503).json({ success: false, message: 'Database service is unavailable.' });
        }
        
        const userDocRef = doc(db, 'users', phone);
        const userSnap = await getDoc(userDocRef);
        if (userSnap.exists()) {
            return res.status(409).json({ success: false, message: 'Phone number already registered. Please login.' });
        }
        
        const usersCol = collection(db, 'users');
        const usersSnap = await getDocs(usersCol);
        const role = usersSnap.empty ? 'admin' : 'user';
        const refCode = generateReferralCode(name, phone);
        const cleanReferredBy = (referralCode && typeof referralCode === 'string' && referralCode.trim().toUpperCase() !== refCode) ? referralCode.trim().toUpperCase() : null;
        
        await setDoc(userDocRef, {
            phone,
            name,
            password,
            coins: 0,
            referral_code: refCode,
            referred_by: cleanReferredBy,
            referral_rewarded: false,
            referral_earnings: 0,
            referral_successful_count: 0,
            status: 'inactive',
            role: role,
            plan: 'None',
            expiry_time: 0,
            sub_link: null,
            created_at: Date.now()
        });
        
        res.json({ success: true, message: 'Registration successful! Please log in.' });
    } catch (error) {
        console.error('Register Error:', error.message);
        res.status(500).json({ success: false, message: 'Internal server error.' });
    }
});

// Login & Issue JWT
app.post('/api/auth/login', async (req, res) => {
    const { phone, password } = req.body;
    if (!phone) {
        return res.status(400).json({ success: false, message: 'Phone number is required.' });
    }
    
    // Demo bypass
    if (phone === 'demo@gmail.com' || phone === 'demo@tunnelforde.lk') {
        const token = jwt.sign({ email: phone, name: 'Demo User', role: 'user' }, process.env.JWT_SECRET || 'jwt-secret-key-unlimiteddat', { expiresIn: '7d' });
        return res.json({ success: true, token, user: { email: phone, name: 'Demo User', role: 'user' } });
    }
    
    if (!password) {
        return res.status(400).json({ success: false, message: 'Password is required.' });
    }
    
    try {
        if ((!useFirebase && !useLocalDb)) {
            // Mock sandbox fallback if database failed
            const token = jwt.sign({ email: phone, name: 'Guest Viewer', role: 'user' }, process.env.JWT_SECRET || 'jwt-secret-key-unlimiteddat', { expiresIn: '7d' });
            return res.json({ success: true, token, user: { email: phone, name: 'Guest Viewer', role: 'user' } });
        }
        
        const userDocRef = doc(db, 'users', phone);
        const userSnap = await getDoc(userDocRef);
        if (!userSnap.exists()) {
            return res.status(404).json({ success: false, message: 'Account not found. Please register.' });
        }
        
        const user = userSnap.data();
        if (user.password !== password) {
            return res.status(401).json({ success: false, message: 'Invalid credentials.' });
        }
        
        const userToken = jwt.sign(
            { email: user.phone, name: user.name, role: user.role }, 
            process.env.JWT_SECRET || 'jwt-secret-key-unlimiteddat', 
            { expiresIn: '7d' }
        );
        
        res.json({
            success: true,
            token: userToken,
            user: { email: user.phone, name: user.name, role: user.role }
        });
    } catch (error) {
        console.error('Login Error:', error.message);
        res.status(500).json({ success: false, message: 'Internal server error.' });
    }
});

// Reset Password (Forgot Password directly updates database)
app.post('/api/auth/reset-password', async (req, res) => {
    const { phone, newPassword } = req.body;
    if (!phone || !newPassword) {
        return res.status(400).json({ success: false, message: 'Phone number and new password are required.' });
    }
    
    try {
        if ((!useFirebase && !useLocalDb)) {
            return res.status(503).json({ success: false, message: 'Database service is unavailable.' });
        }
        
        const userDocRef = doc(db, 'users', phone);
        const userSnap = await getDoc(userDocRef);
        if (!userSnap.exists()) {
            return res.status(404).json({ success: false, message: 'Registered account not found for this phone number.' });
        }
        
        await updateDoc(userDocRef, { password: newPassword });
        res.json({ success: true, message: 'Password updated successfully! Please login with your new password.' });
    } catch (error) {
        console.error('Reset Password Error:', error.message);
        res.status(500).json({ success: false, message: 'Internal server error.' });
    }
});

// Helper: Resolve all active/purchased packages for a user
async function getUserPackagesList(email, user) {
    if (!user) return [];

    const deletedIds = new Set(user.deleted_package_ids || []);
    let packages = Array.isArray(user.packages) ? [...user.packages] : [];

    // Filter out any explicitly deleted packages
    packages = packages.filter(p => !deletedIds.has(p.id) && !deletedIds.has(p.configLink));

    // Check all approved slips for this user in DB
    try {
        if (useLocalDb && localDb && Array.isArray(localDb.slips)) {
            const approvedSlips = localDb.slips.filter(s => 
                s.email === email && 
                s.status === 'approved' && 
                s.config_link &&
                !s.is_deleted &&
                s.status !== 'archived' &&
                !deletedIds.has(s.id) &&
                !deletedIds.has(s.config_link)
            );
            for (const s of approvedSlips) {
                const planId = s.plan_id;
                const existing = packages.find(p => p.id === s.id || (p.configLink && p.configLink === s.config_link));
                if (!existing) {
                    const pkgObj = localDb.packages ? localDb.packages[planId] : null;
                    const planName = (pkgObj && pkgObj.name) ? pkgObj.name : planId.replace(/_/g, ' ');
                    const gbLabel = s.selected_gb ? ` (${s.selected_gb}${String(s.selected_gb).includes('GB') ? '' : ' GB'})` : '';
                    const portLabel = s.port ? ` - Port ${s.port}` : '';
                    const cleanName = `${planName}${gbLabel}${portLabel}`;
                    packages.push({
                        id: s.id || `pkg_${Date.now()}_${Math.random().toString(36).substr(2, 4)}`,
                        planId: planId,
                        planName: cleanName,
                        configLink: s.config_link || '',
                        subLink: s.sub_link || '',
                        sni: s.sni || 'aka.ms',
                        host: s.host || 'aka.ms',
                        port: s.port || 443,
                        target: s.target || 'sni',
                        panelId: s.panel_id || 1,
                        panelDomain: s.panel_domain || '',
                        clientUuid: s.client_uuid || '',
                        totalGb: s.selected_gb || '100',
                        expiryTime: s.expiry_time || ((user.expiry_time && user.expiry_time <= Date.now() + 65 * 86400000) ? user.expiry_time : (Date.now() + 30 * 86400000)),
                        status: 'active'
                    });
                }
            }
        }
    } catch(e) {}

    // Ensure user's currently active config in user doc is also represented if not deleted
    if (user.config_link && !deletedIds.has(user.config_link) && !deletedIds.has(user.active_package_id)) {
        const found = packages.find(p => p.configLink === user.config_link);
        if (!found) {
            packages.unshift({
                id: user.active_package_id || ('pkg_active_' + (user.client_uuid || 'main')),
                planId: 'ACTIVE_PLAN',
                planName: `${user.plan || 'Current Active'} - Port ${user.port || 443}`,
                configLink: user.config_link || '',
                subLink: user.sub_link || '',
                sni: user.sni || 'aka.ms',
                host: user.host || 'aka.ms',
                port: user.port || 443,
                target: user.target || 'sni',
                panelId: user.panel_id || 1,
                panelDomain: user.panel_domain || '',
                clientUuid: user.client_uuid || '',
                totalGb: user.total_gb || '100',
                expiryTime: (user.expiry_time && user.expiry_time <= Date.now() + 65 * 86400000) ? user.expiry_time : (Date.now() + 30 * 86400000),
                status: 'active'
            });
        }
    } else if (packages.length === 0 && user.plan && user.plan !== 'None' && !deletedIds.has('pkg_active') && !deletedIds.has(user.plan)) {
        packages.push({
            id: 'pkg_active',
            planId: 'DIALOG_ROUTER_ZOOM',
            planName: user.plan,
            configLink: user.config_link || '',
            subLink: user.sub_link || '',
            sni: user.sni || 'aka.ms',
            host: user.host || 'aka.ms',
            port: user.port || 443,
            target: user.target || 'sni',
            panelId: user.panel_id || 1,
            panelDomain: user.panel_domain || '',
            clientUuid: user.client_uuid || '',
            totalGb: user.total_gb || '100',
            expiryTime: (user.expiry_time && user.expiry_time <= Date.now() + 65 * 86400000) ? user.expiry_time : (Date.now() + 30 * 86400000),
            status: 'active'
        });
    }

    return packages;
}

// User Profile
app.get('/api/user/profile', authenticateToken, async (req, res) => {
    const email = req.user.email;
    try {
        if ((!useFirebase && !useLocalDb)) {
            return res.json({ success: true, user: { phone: email, name: req.user.name, coins: 250, status: 'active', role: req.user.role, plan: 'None', expiry_time: 0, sub_link: null, unlockedConfigs: [], packages: [] } });
        }
        
        const userDocRef = doc(db, 'users', email);
        const userSnap = await getDoc(userDocRef);
        let user;
        if (!userSnap.exists()) {
            console.log(`[Auto-Repair] Creating missing user document for authenticated session: ${email}`);
            const isAdmin = isSystemAdminEmail(email) || req.user.role === 'admin';
            const refCode = generateReferralCode(req.user.name || email, email);
            user = {
                email: email,
                phone: req.user.phone || email,
                name: req.user.name || (email.includes('@') ? email.split('@')[0] : email),
                picture: req.user.picture || 'https://lh3.googleusercontent.com/a/default-user=s96-c',
                role: isAdmin ? 'admin' : 'user',
                status: 'active',
                coins: 10,
                referral_code: refCode,
                referred_by: null,
                referral_rewarded: false,
                packages: [],
                created_at: Date.now()
            };
            await setDoc(userDocRef, user);
        } else {
            user = userSnap.data();
        }
        const unlockedCol = collection(db, 'unlocked_configs');
        const unlockedQuery = query(unlockedCol, where('user_email', '==', email));
        const unlockedSnap = await getDocs(unlockedQuery);
        const unlockedConfigs = [];
        unlockedSnap.forEach(d => {
            unlockedConfigs.push(String(d.data().config_id));
        });

        const userPackages = await getUserPackagesList(email, user);
        let activePackageId = user.active_package_id;
        if (!activePackageId && user.config_link) {
            const matched = userPackages.find(p => p.configLink === user.config_link);
            if (matched) activePackageId = matched.id;
        }
        if (!activePackageId && userPackages[0]) {
            activePackageId = userPackages[0].id;
        }
        
        if (!user.referral_code) {
            user.referral_code = generateReferralCode(user.name, user.email || email);
            updateDoc(userDocRef, { referral_code: user.referral_code }).catch(() => {});
        }

        res.json({
            success: true,
            user: {
                email: user.email || email,
                phone: user.phone || email,
                name: user.name || 'User',
                picture: user.picture || 'https://lh3.googleusercontent.com/a/default-user=s96-c',
                coins: user.coins || 0,
                referral_code: user.referral_code,
                referral_earnings: user.referral_earnings || 0,
                status: user.status,
                role: isSystemAdminEmail(user.email || email) ? 'admin' : 'user',
                plan: user.plan,
                expiry_time: Number(user.expiry_time || 0),
                panel_id: user.panel_id || 1,
                panel_domain: user.panel_domain || '',
                sub_link: user.sub_link,
                config_link: user.config_link || '',
                sni: user.sni || '',
                host: user.host || '',
                port: user.port || 443,
                target: user.target || 'sni',
                packages: userPackages,
                active_package_id: activePackageId,
                unlockedConfigs
            }
        });
    } catch (error) {
        console.error('Fetch Profile Error:', error.message);
        res.status(500).json({ success: false, message: 'Internal server error.' });
    }
});

// User Referral Stats & Share Link
app.get('/api/user/referral', authenticateToken, async (req, res) => {
    const email = req.user.email;
    try {
        if (!useFirebase && !useLocalDb) {
            return res.json({
                success: true,
                referralCode: 'TF-DEMO',
                referralLink: `${req.protocol}://${req.get('host')}/?ref=TF-DEMO`,
                friendsJoined: 0,
                packagesPurchased: 0,
                coinsEarned: 0
            });
        }
        
        const userDocRef = doc(db, 'users', email);
        const userSnap = await getDoc(userDocRef);
        let user;
        if (!userSnap.exists()) {
            console.log(`[Auto-Repair] Creating missing user referral record for: ${email}`);
            const isAdmin = isSystemAdminEmail(email) || req.user.role === 'admin';
            const refCode = generateReferralCode(req.user.name || email, email);
            user = {
                email: email,
                phone: req.user.phone || email,
                name: req.user.name || (email.includes('@') ? email.split('@')[0] : email),
                picture: req.user.picture || 'https://lh3.googleusercontent.com/a/default-user=s96-c',
                role: isAdmin ? 'admin' : 'user',
                status: 'active',
                coins: 10,
                referral_code: refCode,
                referred_by: null,
                referral_rewarded: false,
                packages: [],
                created_at: Date.now(),
                referral_earnings: 0
            };
            await setDoc(userDocRef, user);
        } else {
            user = userSnap.data();
        }
        
        let refCode = user.referral_code;
        if (!refCode) {
            refCode = generateReferralCode(user.name || req.user.name, email);
            user.referral_code = refCode;
            await updateDoc(userDocRef, { referral_code: refCode }).catch(() => {});
        }
        
        let scannedFriends = 0;
        let scannedPurchases = 0;
        try {
            if (useLocalDb && localDb && localDb.users) {
                const userValues = Object.values(localDb.users);
                for (const u of userValues) {
                    const referredBy = (u.referred_by || '').trim().toUpperCase();
                    if (referredBy && (referredBy === refCode.toUpperCase() || referredBy === email.toUpperCase())) {
                        scannedFriends++;
                        if (u.referral_rewarded === true) {
                            scannedPurchases++;
                        }
                    }
                }
            } else {
                const usersCol = collection(db, 'users');
                const allUsersSnap = await getDocs(usersCol);
                if (allUsersSnap && typeof allUsersSnap.forEach === 'function') {
                    allUsersSnap.forEach(uDoc => {
                        const u = uDoc.data();
                        const referredBy = (u.referred_by || '').trim().toUpperCase();
                        if (referredBy && (referredBy === refCode.toUpperCase() || referredBy === email.toUpperCase())) {
                            scannedFriends++;
                            if (u.referral_rewarded === true) {
                                scannedPurchases++;
                            }
                        }
                    });
                }
            }
        } catch (scanErr) {
            console.warn('Referral users scan warning:', scanErr.message);
        }

        const baseFriends = parseInt(user.referral_friends_count) || 0;
        const basePurchases = parseInt(user.referral_purchases_count) || 0;
        const friendsJoined = Math.max(baseFriends, scannedFriends);
        const packagesPurchased = Math.max(basePurchases, scannedPurchases);
        
        const coinsEarned = user.referral_earnings !== undefined ? parseInt(user.referral_earnings) : (packagesPurchased * 10);
        const host = req.get('host');
        const protocol = req.headers['x-forwarded-proto'] || req.protocol;
        const referralLink = `${protocol}://${host}/?ref=${refCode}`;
        
        res.json({
            success: true,
            referralCode: refCode,
            referralLink,
            friendsJoined,
            packagesPurchased,
            coinsEarned
        });
    } catch (err) {
        console.error('Fetch Referral Data Error:', err.message);
        res.status(500).json({ success: false, message: 'Could not fetch referral details.' });
    }
});

// Get user packages list
app.get('/api/user/packages', authenticateToken, async (req, res) => {
    const email = req.user.email;
    try {
        if ((!useFirebase && !useLocalDb)) return res.json({ success: true, packages: [] });
        const userDocRef = doc(db, 'users', email);
        const userSnap = await getDoc(userDocRef);
        if (!userSnap.exists()) return res.status(404).json({ success: false, message: 'User not found.' });

        const user = userSnap.data();
        const packages = await getUserPackagesList(email, user);
        let activePackageId = user.active_package_id;
        if (!activePackageId && user.config_link) {
            const matched = packages.find(p => p.configLink === user.config_link);
            if (matched) activePackageId = matched.id;
        }
        if (!activePackageId && packages[0]) {
            activePackageId = packages[0].id;
        }
        res.json({
            success: true,
            packages: packages,
            activePackageId: activePackageId
        });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// Switch active package
app.post('/api/user/switch-package', authenticateToken, async (req, res) => {
    const email = req.user.email;
    const { packageId, planId } = req.body;
    try {
        if ((!useFirebase && !useLocalDb)) return res.status(503).json({ success: false, message: 'Database offline.' });
        
        const userDocRef = doc(db, 'users', email);
        const userSnap = await getDoc(userDocRef);
        if (!userSnap.exists()) return res.status(404).json({ success: false, message: 'User not found.' });

        const user = userSnap.data();
        let packages = await getUserPackagesList(email, user);
        
        // Match package by id or planId
        let selectedPkg = packages.find(p => p.id === packageId || p.planId === packageId || (planId && p.planId === planId));
        
        // If not in packages but planId provided from defaultPackages, create it
        if (!selectedPkg && planId) {
            const foundPkg = defaultPackages.find(p => p.id === planId);
            const planName = foundPkg ? foundPkg.name : planId;
            const newClient = await create3xuiClient({
                email,
                planId,
                planName,
                selectedGb: '100',
                days: 30
            });
            selectedPkg = {
                id: `pkg_${Date.now()}`,
                planId,
                planName: `${planName} (100 GB)`,
                configLink: newClient.configLink,
                subLink: newClient.subLink,
                sni: newClient.sni,
                host: newClient.host,
                port: newClient.port,
                target: newClient.target,
                panelId: newClient.panelId,
                panelDomain: newClient.panelDomain,
                clientUuid: newClient.uuid,
                totalGb: '100',
                expiryTime: Date.now() + 30 * 86400000,
                status: 'active'
            };
            packages.push(selectedPkg);
        }

        if (!selectedPkg) {
            return res.status(404).json({ success: false, message: 'Selected package not found.' });
        }

        // Update active package configuration on user document
        const userUpdates = {
            active_package_id: selectedPkg.id,
            plan: selectedPkg.planName,
            config_link: selectedPkg.configLink,
            sub_link: selectedPkg.subLink,
            sni: selectedPkg.sni,
            host: selectedPkg.host,
            port: selectedPkg.port,
            target: selectedPkg.target,
            panel_id: selectedPkg.panelId,
            panel_domain: selectedPkg.panelDomain,
            client_uuid: selectedPkg.clientUuid,
            total_gb: selectedPkg.totalGb || '100',
            packages: packages
        };

        await updateDoc(userDocRef, userUpdates);

        // Clear all cached traffic for this user so fresh live stats are retrieved immediately
        for (const k of Object.keys(clientTrafficCache)) {
            if (k.startsWith((email || '').toLowerCase())) {
                delete clientTrafficCache[k];
            }
        }

        // Fetch fresh usage stats for this specific package right now
        let freshTraffic = null;
        try {
            freshTraffic = await getClientTrafficStats(email, selectedPkg.panelId, selectedPkg.clientUuid, true);
        } catch(e) {}

        let isUnlimited = false;
        const totalGbStr = selectedPkg.totalGb || '';
        const pkgPlanName = (selectedPkg.planName || '').toLowerCase();
        if ((totalGbStr && totalGbStr.toLowerCase() === 'unlimited') || pkgPlanName.includes('unlimited') || (freshTraffic && freshTraffic.total === 0)) {
            isUnlimited = true;
        }
        const totalBytesLimit = isUnlimited ? 0 : (parseInt(totalGbStr) || 100) * 1073741824;
        const targetPanel = getPanelById(selectedPkg.panelId || 1);

        res.json({
            success: true,
            message: `Switched to ${selectedPkg.planName}!`,
            activePackage: selectedPkg,
            user: {
                ...user,
                ...userUpdates,
                packages
            },
            usage: {
                email: email,
                up: freshTraffic ? (freshTraffic.up || 0) : 0,
                down: freshTraffic ? (freshTraffic.down || 0) : 0,
                total: isUnlimited ? 0 : (totalBytesLimit > 0 ? totalBytesLimit : (freshTraffic && freshTraffic.total ? freshTraffic.total : 107374182400)),
                isUnlimited: isUnlimited,
                totalGb: isUnlimited ? 'Unlimited' : (totalGbStr || '100'),
                expiryTime: freshTraffic && freshTraffic.expiryTime ? freshTraffic.expiryTime : (selectedPkg.expiryTime || user.expiry_time || 0),
                configLink: selectedPkg.configLink || '',
                subLink: selectedPkg.subLink || '',
                sni: selectedPkg.sni || '',
                host: selectedPkg.host || '',
                port: selectedPkg.port || 443,
                target: selectedPkg.target || 'sni',
                panelId: targetPanel.id,
                panelDomain: targetPanel.domain,
                panelName: targetPanel.name,
                plan: selectedPkg.planName
            }
        });
    } catch (err) {
        console.error('Error switching package:', err.message);
        res.status(500).json({ success: false, message: err.message });
    }
});

// Delete user package
const handleDeletePackage = async (req, res) => {
    const email = req.user.email;
    const packageId = req.params.packageId || req.body.packageId;
    
    if (!packageId) {
        return res.status(400).json({ success: false, message: 'Package ID is required.' });
    }

    try {
        if (!useFirebase && !useLocalDb) {
            return res.status(503).json({ success: false, message: 'Database offline.' });
        }

        const userDocRef = doc(db, 'users', email);
        const userSnap = await getDoc(userDocRef);
        if (!userSnap.exists()) {
            return res.status(404).json({ success: false, message: 'User not found.' });
        }

        const user = userSnap.data();
        let packages = await getUserPackagesList(email, user);

        // Match package to delete
        const pkgToDelete = packages.find(p => 
            p.id === packageId || 
            p.planId === packageId || 
            p.configLink === packageId ||
            (packageId === 'active-xui' && p.configLink === user.config_link) ||
            (packageId.startsWith('pkg_active') && (p.configLink === user.config_link || p.id.startsWith('pkg_active')))
        );

        if (!pkgToDelete) {
            return res.status(404).json({ success: false, message: 'Package not found or already deleted.' });
        }

        // Track deleted IDs so getUserPackagesList never re-adds from slips
        const deletedIds = Array.isArray(user.deleted_package_ids) ? [...user.deleted_package_ids] : [];
        if (pkgToDelete.id) deletedIds.push(pkgToDelete.id);
        if (pkgToDelete.configLink) deletedIds.push(pkgToDelete.configLink);
        if (packageId) deletedIds.push(packageId);
        if (pkgToDelete.clientUuid) deletedIds.push(pkgToDelete.clientUuid);
        const uniqueDeleted = Array.from(new Set(deletedIds.filter(Boolean)));

        // Remove / archive from localDb slips if matched
        if (useLocalDb && localDb && Array.isArray(localDb.slips)) {
            for (const s of localDb.slips) {
                if (s.email === email && (s.id === pkgToDelete.id || s.config_link === pkgToDelete.configLink)) {
                    s.is_deleted = true;
                    s.status = 'archived';
                }
            }
        }

        // Also if Firebase slips exist
        if (useFirebase && pkgToDelete.id && pkgToDelete.id.startsWith('slip_')) {
            try {
                const slipRef = doc(db, 'slips', pkgToDelete.id);
                await updateDoc(slipRef, { status: 'archived', is_deleted: true });
            } catch (_) {}
        }

        // Remaining packages
        const remainingPackages = packages.filter(p => 
            p.id !== pkgToDelete.id && 
            p.configLink !== pkgToDelete.configLink &&
            p.id !== packageId
        );

        const wasActive = (
            user.active_package_id === pkgToDelete.id || 
            user.config_link === pkgToDelete.configLink || 
            packageId === 'active-xui' || 
            packages.length === 1
        );

        const userUpdates = {
            deleted_package_ids: uniqueDeleted,
            packages: remainingPackages
        };

        let newActivePkg = null;
        if (wasActive) {
            if (remainingPackages.length > 0) {
                newActivePkg = remainingPackages[0];
                userUpdates.active_package_id = newActivePkg.id;
                userUpdates.plan = newActivePkg.planName;
                userUpdates.config_link = newActivePkg.configLink;
                userUpdates.sub_link = newActivePkg.subLink;
                userUpdates.sni = newActivePkg.sni;
                userUpdates.host = newActivePkg.host;
                userUpdates.port = newActivePkg.port;
                userUpdates.target = newActivePkg.target;
                userUpdates.panel_id = newActivePkg.panelId;
                userUpdates.panel_domain = newActivePkg.panelDomain;
                userUpdates.client_uuid = newActivePkg.clientUuid;
                userUpdates.total_gb = newActivePkg.totalGb || '100';
                userUpdates.status = 'active';
            } else {
                userUpdates.active_package_id = null;
                userUpdates.plan = 'None';
                userUpdates.config_link = '';
                userUpdates.sub_link = '';
                userUpdates.sni = '';
                userUpdates.host = '';
                userUpdates.port = 443;
                userUpdates.target = 'sni';
                userUpdates.client_uuid = '';
                userUpdates.total_gb = '0';
                userUpdates.status = 'inactive';
            }
        }

        await updateDoc(userDocRef, userUpdates);

        // True background fire-and-forget 3x-ui client cleanup (never blocks HTTP response)
        if (pkgToDelete.clientUuid || pkgToDelete.emailTag) {
            setImmediate(async () => {
                try {
                    const pId = pkgToDelete.panelId || 1;
                    const panel = getPanelById(pId);
                    if (panel && panel.url) {
                        const cleanUrl = (panel.url || '').replace(/\/+$/, '');
                        const session = await getPanelSession(panel);
                        const clientTag = pkgToDelete.emailTag || pkgToDelete.clientEmailTag || `${email.split('@')[0]}_${pkgToDelete.planId || 'pkg'}`;
                        try {
                            await axios.post(`${cleanUrl}/panel/api/clients/del/${encodeURIComponent(clientTag)}`, {}, {
                                headers: {
                                    'Host': panel.domain,
                                    'Cookie': session.cookie,
                                    'x-csrf-token': session.csrf,
                                    'Referer': `${cleanUrl}/panel/`
                                },
                                httpsAgent: httpsAgent,
                                timeout: 5000
                            });
                        } catch (_) {}
                    }
                } catch (_) {}
            });
        }

        // Clear cached traffic for this user
        for (const k of Object.keys(clientTrafficCache)) {
            if (k.startsWith((email || '').toLowerCase())) {
                delete clientTrafficCache[k];
            }
        }

        const updatedUser = {
            ...user,
            ...userUpdates,
            packages: remainingPackages
        };

        res.json({
            success: true,
            message: `Deleted "${pkgToDelete.planName || 'Package'}" successfully.`,
            deletedPackageId: pkgToDelete.id,
            wasActive,
            newActivePackage: newActivePkg,
            user: updatedUser,
            remainingPackages
        });
    } catch (err) {
        console.error('Delete package error:', err.message);
        res.status(500).json({ success: false, message: err.message });
    }
};

app.delete('/api/user/packages/:packageId', authenticateToken, handleDeletePackage);
app.post('/api/user/delete-package', authenticateToken, handleDeletePackage);

// Link V2Ray Sub Link
app.post('/api/user/link-sub', authenticateToken, async (req, res) => {
    const email = req.user.email;
    const { subLink } = req.body;
    try {
        if ((!useFirebase && !useLocalDb)) return res.json({ success: true });
        const userDocRef = doc(db, 'users', email);
        await updateDoc(userDocRef, { sub_link: subLink });
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// Unlink V2Ray Sub Link
app.post('/api/user/unlink-sub', authenticateToken, async (req, res) => {
    const email = req.user.email;
    try {
        if ((!useFirebase && !useLocalDb)) return res.json({ success: true });
        const userDocRef = doc(db, 'users', email);
        await updateDoc(userDocRef, { sub_link: null });
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// Fetch All Packages
app.get('/api/packages', async (req, res) => {
    try {
        if ((!useFirebase && !useLocalDb)) return res.json({ success: true, packages: defaultPackages });
        
        let pkgList = [];
        if (useLocalDb && localDb && localDb.packages) {
            pkgList = Object.entries(localDb.packages).map(([id, r]) => ({ id, ...r }));
        } else {
            const packagesCol = collection(db, 'packages');
            const snapshot = await getDocs(packagesCol);
            snapshot.forEach(docSnap => {
                pkgList.push({ id: docSnap.id, ...docSnap.data() });
            });
        }

        const packages = pkgList.map(r => {
            const pkgPrice = parseFloat(r.price) || 0;
            const origPrice = r.originalPrice ? parseFloat(r.originalPrice) : null;
            const hasOffer = r.isOffer === true || r.badge === 'limited' || r.badge === 'offer' || (origPrice !== null && origPrice > pkgPrice);
            return {
                id: r.id, 
                name: r.name, 
                network: r.network, 
                price: pkgPrice,
                originalPrice: origPrice,
                isOffer: hasOffer,
                limitGB: r.limitGB, 
                days: r.days, 
                desc: (r.desc || '').replace(/\s*\([^)]*\.[a-z]{2,}[^)]*\)/gi, '').trim(), 
                promo: r.promo,
                server: r.server, 
                remaining: r.remaining, 
                bonusCoins: r.bonusCoins,
                coinCost: r.coinCost, 
                badge: r.badge, 
                category: r.category || 'speed'
            };
        });

        res.json({ success: true, packages });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// Update Package (Admin)
app.put('/api/admin/packages/:id', authenticateToken, async (req, res) => {
    if (req.user.role !== 'admin') return res.status(403).json({ success: false });
    const id = req.params.id;
    const { name, network, price, originalPrice, isOffer, limitGB, days, desc, promo, server, remaining, bonusCoins, coinCost, badge, category } = req.body;
    try {
        if ((!useFirebase && !useLocalDb)) return res.json({ success: true });
        const pkgDocRef = doc(db, 'packages', id);
        const parsedPrice = parseFloat(price) || 0;
        const parsedOrig = (originalPrice && parseFloat(originalPrice) > 0) ? parseFloat(originalPrice) : null;
        await setDoc(pkgDocRef, {
            id, 
            name, 
            network, 
            price: parsedPrice,
            originalPrice: parsedOrig,
            isOffer: isOffer === true || Boolean(isOffer),
            limitGB: parseInt(limitGB),
            days: parseInt(days), 
            desc: (desc || '').replace(/\s*\([^)]*\.[a-z]{2,}[^)]*\)/gi, '').trim(), 
            promo, 
            server, 
            remaining: parseInt(remaining),
            bonusCoins: parseInt(bonusCoins), 
            coinCost: parseInt(coinCost), 
            badge: badge || null,
            category: category || 'speed'
        }, { merge: true });
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// ----------------------------------------------------
// TELEGRAM BOT ORDER ALERTS & ONE-CLICK APPROVAL SYSTEM
// ----------------------------------------------------
function escapeTgHtml(text) {
    if (!text) return '';
    return String(text)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

async function sendTelegramOrderAlert({ slipId, email, planId, price, slipUrl, selectedGb, bonusCoins, days, isRenewal }) {
    const token = process.env.TELEGRAM_BOT_TOKEN || '8948127436:AAEzOaISWPPeT2m6qsyrnAstTZpufKfgGuk';
    const chatId = process.env.TELEGRAM_ADMIN_CHAT_ID || '1919247232';
    if (!token || !chatId) {
        console.log('[Telegram] Bot token or admin chat ID not configured.');
        return;
    }

    const safeEmail = escapeTgHtml(email);
    const safePlan = escapeTgHtml(planId);
    const safeGb = selectedGb ? `${escapeTgHtml(selectedGb)} GB` : 'Standard';
    const safePrice = Number(price || 0).toLocaleString();
    const isRenew = Boolean(isRenewal);

    const alertTitle = isRenew ? '🔄 <b>PACKAGE RENEWAL ORDER!</b> 🔄' : '🚨 <b>NEW ORDER RECEIVED!</b> 🚨';
    const packageText = isRenew ? `<b>${safePlan} (RENEWAL)</b>` : `<b>${safePlan}</b>`;
    const approveBtnText = isRenew ? '✅ Approve Renewal' : '✅ Approve & Generate VLESS';

    const caption = 
`${alertTitle}
━━━━━━━━━━━━━━━━━━━━
👤 <b>Customer:</b> <code>${safeEmail}</code>
📦 <b>Package:</b> ${packageText}
💾 <b>Traffic Limit:</b> <b>${safeGb}</b>
⏳ <b>Duration:</b> <b>${days} Days</b>
💰 <b>Amount:</b> <b>Rs. ${safePrice}</b>
🎁 <b>Bonus Coins:</b> <b>${bonusCoins}</b>
🆔 <b>Slip ID:</b> <code>${slipId}</code>
━━━━━━━━━━━━━━━━━━━━
👇 <i>Click below to approve or reject instantly:</i>`;

    const inlineKeyboard = {
        inline_keyboard: [
            [
                { text: approveBtnText, callback_data: `approve_${slipId}` },
                { text: '❌ Reject Order', callback_data: `reject_${slipId}` }
            ],
            [
                { text: '💬 Reply to Customer', callback_data: `replyto_${encodeURIComponent(email)}` }
            ]
        ]
    };

    let photoSent = false;
    let photoBuffer = null;
    let photoFilename = `slip_${slipId}.jpg`;

    if (slipUrl) {
        try {
            if (slipUrl.startsWith('data:image')) {
                const base64Data = slipUrl.split(';base64,').pop();
                photoBuffer = Buffer.from(base64Data, 'base64');
            } else if (slipUrl.startsWith('/uploads/') || slipUrl.startsWith('uploads/')) {
                const relPath = slipUrl.startsWith('/') ? slipUrl.substring(1) : slipUrl;
                const localFilePath = path.join(__dirname, relPath);
                if (fsSync.existsSync(localFilePath)) {
                    photoBuffer = fsSync.readFileSync(localFilePath);
                    photoFilename = path.basename(localFilePath);
                }
            }
        } catch (bufErr) {
            console.warn('[Telegram] Could not prepare photo buffer:', bufErr.message);
        }
    }

    if (photoBuffer && photoBuffer.length > 0) {
        try {
            const form = new FormData();
            form.append('chat_id', chatId);
            form.append('caption', caption);
            form.append('parse_mode', 'HTML');
            form.append('photo', photoBuffer, { filename: photoFilename, contentType: 'image/jpeg' });
            form.append('reply_markup', JSON.stringify(inlineKeyboard));

            const res = await axios.post(`https://api.telegram.org/bot${token}/sendPhoto`, form, {
                headers: form.getHeaders(),
                timeout: 20000
            });
            if (res.data && res.data.ok) {
                photoSent = true;
                console.log(`[Telegram] Order photo alert sent successfully for Slip ${slipId}!`);
            }
        } catch (photoErr) {
            console.warn('[Telegram] Could not send slip photo, falling back to text message:', photoErr.response ? photoErr.response.data : photoErr.message);
        }
    }

    if (!photoSent) {
        try {
            await axios.post(`https://api.telegram.org/bot${token}/sendMessage`, {
                chat_id: chatId,
                text: caption,
                parse_mode: 'HTML',
                reply_markup: inlineKeyboard
            }, { timeout: 10000 });
            console.log(`[Telegram] Order text alert sent successfully for Slip ${slipId}!`);
        } catch (textErr) {
            console.error('[Telegram] Failed to send order alert message:', textErr.response ? textErr.response.data : textErr.message);
        }
    }
}

// Process referral reward for package purchase (+10 Data Coins to referrer)
async function processReferralRewardForBuyer(buyerEmail, buyerName) {
    if (!buyerEmail || (!useFirebase && !useLocalDb)) return;
    try {
        const buyerDocRef = doc(db, 'users', buyerEmail);
        const buyerSnap = await getDoc(buyerDocRef);
        if (!buyerSnap.exists()) return;
        
        const buyer = buyerSnap.data();
        if (!buyer.referred_by || buyer.referral_rewarded === true) {
            return; // Not referred, or referral reward already granted
        }
        
        const rawRef = String(buyer.referred_by).trim().toUpperCase();
        const usersCol = collection(db, 'users');
        const allUsersSnap = await getDocs(usersCol);
        let referrerDoc = null;
        let referrerId = null;
        
        allUsersSnap.forEach(uDoc => {
            const u = uDoc.data();
            const uCode = (u.referral_code || '').trim().toUpperCase();
            const uEmail = (u.email || '').trim().toUpperCase();
            const uPhone = (u.phone || '').trim().toUpperCase();
            if (uCode === rawRef || uEmail === rawRef || uPhone === rawRef) {
                referrerDoc = u;
                referrerId = uDoc.id;
            }
        });
        
        if (referrerDoc && referrerId && referrerId.toLowerCase().trim() !== buyerEmail.toLowerCase().trim()) {
            const referrerRef = doc(db, 'users', referrerId);
            const currentCoins = parseInt(referrerDoc.coins) || 0;
            const currentEarnings = parseInt(referrerDoc.referral_earnings) || 0;
            const currentSuccess = parseInt(referrerDoc.referral_successful_count) || 0;
            
            await updateDoc(referrerRef, {
                coins: currentCoins + 10,
                referral_earnings: currentEarnings + 10,
                referral_successful_count: currentSuccess + 1
            });
            
            // Mark buyer as rewarded so it only triggers once per referred customer
            await updateDoc(buyerDocRef, {
                referral_rewarded: true
            });
            
            // Send automatic live chat notification to referrer
            try {
                const buyerDisplayName = buyer.name || buyerName || buyerEmail.split('@')[0];
                const rewardNotice = {
                    user_email: referrerDoc.email || referrerDoc.phone || referrerId,
                    sender: 'admin',
                    text: `🎉 Referral Bonus! Your friend "${buyerDisplayName}" just purchased a package. You have earned +10 Data Coins! 💰`,
                    timestamp: Date.now(),
                    read: false
                };
                const chatsCol = collection(db, 'chats');
                await addDoc(chatsCol, rewardNotice);
            } catch (chatNoticeErr) {
                console.warn('Could not post referral chat notice:', chatNoticeErr.message);
            }
            
            console.log(`[REFERRAL] Successfully awarded 10 coins to referrer ${referrerId} for buyer ${buyerEmail}`);
        }
    } catch (refErr) {
        console.warn('Error in processReferralRewardForBuyer:', refErr.message);
    }
}

// Slip Approval Business Logic
async function executeApproveSlip(id) {
    if ((!useFirebase && !useLocalDb)) throw new Error('Database is offline');
    
    const slipDocRef = doc(db, 'slips', id);
    const slipSnap = await getDoc(slipDocRef);
    if (!slipSnap.exists()) throw new Error(`Slip ${id} not found`);
    const slip = slipSnap.data();
    
    if (slip.status === 'approved') {
        return {
            success: true,
            alreadyApproved: true,
            slip,
            config: slip.config_link || null
        };
    }
    
    // Check if config slip
    if (slip.plan_id.startsWith('config_')) {
        const configIdStr = slip.plan_id.replace('config_', '');
        await updateDoc(slipDocRef, { status: 'approved' });
        
        const unlockDocRef = doc(db, 'unlocked_configs', `${slip.email}_${configIdStr}`);
        await setDoc(unlockDocRef, { user_email: slip.email, config_id: configIdStr });
        return { success: true, isConfig: true, slip: { ...slip, status: 'approved' } };
    }
    
    // Package slip
    const pkgDocRef = doc(db, 'packages', slip.plan_id);
    const pkgSnap = await getDoc(pkgDocRef);
    
    let bonusCoins = slip.bonus_coins !== undefined ? parseInt(slip.bonus_coins) : 10;
    let days = slip.days !== undefined ? parseInt(slip.days) : 30;
    const selectedGb = slip.selected_gb || '';
    
    if (slip.bonus_coins === undefined && pkgSnap.exists()) {
        const pkg = pkgSnap.data();
        bonusCoins = pkg.bonusCoins || 10;
        days = pkg.days || 30;
    }

    const isRenewal = slip.is_renewal === true || !!slip.package_id;
    if (isRenewal) {
        const userDocRef = doc(db, 'users', slip.email);
        const userSnap = await getDoc(userDocRef);
        if (userSnap.exists()) {
            const user = userSnap.data();
            let packages = await getUserPackagesList(slip.email, user);
            
            // Find target package
            let targetPkg = null;
            if (slip.package_id) {
                targetPkg = packages.find(p => p.id === slip.package_id || p.planId === slip.package_id);
            }
            if (!targetPkg && slip.plan_id) {
                targetPkg = packages.find(p => p.planId === slip.plan_id);
            }
            if (!targetPkg && user.active_package_id) {
                targetPkg = packages.find(p => p.id === user.active_package_id);
            }
            if (!targetPkg && packages.length > 0) {
                targetPkg = packages[0];
            }
            if (!targetPkg && user.config_link) {
                targetPkg = {
                    id: user.active_package_id || `pkg_${Date.now()}`,
                    planId: slip.plan_id || 'SPEED_PACK',
                    planName: user.plan || slip.plan_id,
                    configLink: user.config_link,
                    subLink: user.sub_link || '',
                    sni: user.sni || 'aka.ms',
                    host: user.host || 'aka.ms',
                    port: user.port || 443,
                    target: user.target || 'sni',
                    panelId: user.panel_id || 1,
                    panelDomain: user.panel_domain || '',
                    clientUuid: user.client_uuid || '',
                    totalGb: selectedGb || user.total_gb || '100',
                    expiryTime: user.expiry_time || 0,
                    status: 'active'
                };
                packages.push(targetPkg);
            }
            
            if (targetPkg) {
                // If package already has an active expiry within reasonable future (up to 35 days), extend from it.
                // Otherwise (if expired or corrupted > 35 days), start from now so it never stacks to 300+ days!
                const currentExpiry = Number(targetPkg.expiryTime) || 0;
                const maxReasonableExpiry = Date.now() + 35 * 24 * 3600000;
                const extendFrom = (currentExpiry > Date.now() && currentExpiry <= maxReasonableExpiry) ? currentExpiry : Date.now();
                const newExpiry = extendFrom + (parseInt(days) || 30) * 24 * 3600000;
                
                // Accumulate GB: Add selected GB to existing totalGb
                let newTotalGb = '100';
                let addGb = 100;
                if (selectedGb === 'Unlimited' || selectedGb === 'unlimited') {
                    newTotalGb = 'Unlimited';
                    addGb = 0;
                } else {
                    const prevGb = parseInt(targetPkg.totalGb) || 0;
                    addGb = parseInt(selectedGb) || 100;
                    newTotalGb = String(prevGb + addGb);
                }
                
                targetPkg.expiryTime = newExpiry;
                targetPkg.totalGb = newTotalGb;
                targetPkg.status = 'active';
                
                // Format clean plan name
                const rawName = (pkgSnap.exists() ? pkgSnap.data().name : null) || targetPkg.planName || slip.plan_id || 'Package';
                const baseName = rawName.replace(/\s*\(\d+\s*GB\)/i, '').replace(/\s*\(Unlimited(?:\s*GB)?\)/i, '').replace(/\s*-\s*Port\s*\d+/i, '').trim();
                targetPkg.planName = `${baseName} (${newTotalGb}${newTotalGb === 'Unlimited' ? '' : ' GB'}) - Port ${targetPkg.port || 443}`;
                
                // Update 3x-ui panel client totalGB & expiry if panel is available (Both Panel 1 & Panel 2)
                update3xuiClientStats(targetPkg.panelId, targetPkg.clientUuid, { 
                    totalGb: newTotalGb, 
                    addGb: addGb,
                    expiryTime: newExpiry,
                    userEmail: user.email,
                    clientEmail: targetPkg.clientEmail || targetPkg.email
                }).catch(e => console.warn('[Renewal] 3x-ui update warning:', e.message));
                
                // Replace or add in packages array
                const pkgIdx = packages.findIndex(p => p.id === targetPkg.id || (p.configLink && p.configLink === targetPkg.configLink));
                if (pkgIdx !== -1) {
                    packages[pkgIdx] = targetPkg;
                } else {
                    packages.push(targetPkg);
                }
                
                const userUpdates = {
                    status: 'active',
                    coins: (parseInt(user.coins) || 0) + bonusCoins,
                    packages: packages
                };
                
                // If this is currently active config, update top-level fields
                if (user.active_package_id === targetPkg.id || user.config_link === targetPkg.configLink || !user.active_package_id) {
                    userUpdates.expiry_time = newExpiry;
                    userUpdates.total_gb = newTotalGb;
                    userUpdates.plan = targetPkg.planName;
                    userUpdates.active_package_id = targetPkg.id;
                }
                await updateDoc(userDocRef, userUpdates);
                
                const slipUpdates = {
                    status: 'approved',
                    config_link: targetPkg.configLink,
                    sub_link: targetPkg.subLink,
                    sni: targetPkg.sni,
                    host: targetPkg.host,
                    port: targetPkg.port,
                    target: targetPkg.target,
                    panel_id: targetPkg.panelId,
                    panel_domain: targetPkg.panelDomain,
                    client_uuid: targetPkg.clientUuid
                };
                await updateDoc(slipDocRef, slipUpdates);
                
                // Referral reward check (+10 coins to referrer if eligible)
                await processReferralRewardForBuyer(slip.email, slip.name);

                return {
                    success: true,
                    isRenewal: true,
                    slip: { ...slip, ...slipUpdates },
                    config: targetPkg.configLink,
                    sni: targetPkg.sni,
                    host: targetPkg.host,
                    port: targetPkg.port,
                    target: targetPkg.target,
                    panelId: targetPkg.panelId,
                    panelDomain: targetPkg.panelDomain
                };
            }
        }
    }
    
    let configResult = null;
    try {
        configResult = await create3xuiClient({
            email: slip.email,
            planId: slip.plan_id,
            planName: pkgSnap.exists() ? (pkgSnap.data().name || slip.plan_id) : slip.plan_id,
            selectedGb: selectedGb || '100',
            days: days
        });
    } catch (genErr) {
        console.error('Error generating 3x-ui config during slip approval:', genErr.message);
        throw genErr;
    }

    const slipUpdates = { status: 'approved' };
    if (configResult && configResult.configLink) {
        slipUpdates.config_link = configResult.configLink;
        slipUpdates.sub_link = configResult.subLink;
        slipUpdates.sni = configResult.sni;
        slipUpdates.host = configResult.host;
        slipUpdates.port = configResult.port;
        slipUpdates.target = configResult.target;
        slipUpdates.panel_id = configResult.panelId;
        slipUpdates.panel_domain = configResult.panelDomain;
        slipUpdates.client_uuid = configResult.uuid;
    }
    await updateDoc(slipDocRef, slipUpdates);
    
    const userDocRef = doc(db, 'users', slip.email);
    const userSnap = await getDoc(userDocRef);
    if (userSnap.exists()) {
        const user = userSnap.data();
        const pkgDays = parseInt(days) || 30;
        const newExpiry = Date.now() + pkgDays * 24 * 3600000;
        const currentCoins = parseInt(user.coins) || 0;
        
        let planName = slip.plan_id;
        if (pkgSnap.exists()) {
            planName = pkgSnap.data().name || slip.plan_id;
        }
        const cleanPlanName = planName.replace(/_/g, ' ') + (selectedGb ? ` (${selectedGb} GB)` : '');
        
        let packages = await getUserPackagesList(slip.email, user);
        const newPkgId = slipDocRef.id || `pkg_${Date.now()}`;
        const newPkg = {
            id: newPkgId,
            planId: slip.plan_id,
            planName: `${cleanPlanName} - Port ${configResult?.port || 443}`,
            configLink: configResult?.configLink || '',
            subLink: configResult?.subLink || '',
            sni: configResult?.sni || 'aka.ms',
            host: configResult?.host || 'aka.ms',
            port: configResult?.port || 443,
            target: configResult?.target || 'sni',
            panelId: configResult?.panelId || 1,
            panelDomain: configResult?.panelDomain || '',
            clientUuid: configResult?.uuid || '',
            totalGb: selectedGb || '100',
            expiryTime: newExpiry,
            status: 'active'
        };
        packages.unshift(newPkg);

        const userUpdates = {
            plan: cleanPlanName,
            status: 'active',
            coins: currentCoins + bonusCoins,
            expiry_time: newExpiry,
            active_package_id: newPkgId,
            packages: packages
        };

        if (configResult && configResult.configLink) {
            userUpdates.config_link = configResult.configLink;
            userUpdates.sub_link = configResult.subLink;
            userUpdates.sni = configResult.sni;
            userUpdates.host = configResult.host;
            userUpdates.port = configResult.port;
            userUpdates.target = configResult.target;
            userUpdates.panel_id = configResult.panelId;
            userUpdates.panel_domain = configResult.panelDomain;
            userUpdates.client_uuid = configResult.uuid;
            userUpdates.total_gb = selectedGb || '100';
        }
        
        await updateDoc(userDocRef, userUpdates);
    }
    
    // Referral reward check (+10 coins to referrer if eligible)
    await processReferralRewardForBuyer(slip.email, slip.name);

    return {
        success: true,
        slip: { ...slip, ...slipUpdates },
        configResult,
        config: configResult ? configResult.configLink : null,
        sni: configResult ? configResult.sni : null,
        host: configResult ? configResult.host : null,
        port: configResult ? configResult.port : null,
        target: configResult ? configResult.target : null,
        panelId: configResult ? configResult.panelId : 1,
        panelDomain: configResult ? configResult.panelDomain : null
    };
}

// Slip Rejection Business Logic
async function executeRejectSlip(id) {
    if ((!useFirebase && !useLocalDb)) throw new Error('Database is offline');
    const slipDocRef = doc(db, 'slips', id);
    const slipSnap = await getDoc(slipDocRef);
    if (!slipSnap.exists()) throw new Error(`Slip ${id} not found`);
    const slip = slipSnap.data();
    await updateDoc(slipDocRef, { status: 'rejected' });
    return { success: true, slip: { ...slip, status: 'rejected' } };
}

// State tracker for pending replies from admin
const adminPendingReply = {};

// =========================================================================
// AUTOMATED TELEGRAM DATABASE BACKUP SYSTEM
// =========================================================================
async function sendTelegramDatabaseBackup(reason = 'Daily Scheduled Backup', targetChatId = null) {
    const token = process.env.TELEGRAM_BOT_TOKEN || '8948127436:AAEzOaISWPPeT2m6qsyrnAstTZpufKfgGuk';
    const chatId = targetChatId || process.env.TELEGRAM_ADMIN_CHAT_ID || '1919247232';
    if (!token || !chatId) {
        console.log('[Telegram Backup] Bot token or admin chat ID not configured.');
        return;
    }

    try {
        await saveLocalDb().catch(() => {});
        const dbPath = path.join(__dirname, 'data', 'db.json');
        if (!fsSync.existsSync(dbPath)) {
            console.warn('[Telegram Backup] data/db.json not found to back up at:', dbPath);
            await axios.post(`https://api.telegram.org/bot${token}/sendMessage`, {
                chat_id: chatId,
                text: `⚠️ <b>Backup Warning:</b> <code>data/db.json</code> file not found on disk.`,
                parse_mode: 'HTML'
            }).catch(() => {});
            return;
        }

        let userCount = 0;
        let slipCount = 0;
        let packageCount = 0;
        try {
            const raw = fsSync.readFileSync(dbPath, 'utf8');
            const parsed = JSON.parse(raw);
            userCount = Object.keys(parsed.users || {}).length;
            slipCount = (parsed.slips || []).length;
            packageCount = (parsed.packages || []).length;
        } catch (e) {}

        const nowStr = new Date().toLocaleString('en-US', { timeZone: 'Asia/Colombo' });
        const dateStamp = new Date().toISOString().split('T')[0];
        const backupFileName = `db_backup_${dateStamp}.json`;

        const form = new FormData();
        form.append('chat_id', String(chatId));
        form.append('document', fsSync.createReadStream(dbPath), {
            filename: backupFileName,
            contentType: 'application/json'
        });

        const caption = 
`📦 <b>AUTOMATED DATABASE BACKUP</b>
━━━━━━━━━━━━━━━━━━━━
🏷️ <b>Trigger:</b> ${escapeTgHtml(reason)}
📅 <b>Date:</b> ${escapeTgHtml(nowStr)}
👥 <b>Total Users:</b> <b>${userCount}</b>
📦 <b>Packages:</b> <b>${packageCount}</b>
🧾 <b>Total Slips:</b> <b>${slipCount}</b>
━━━━━━━━━━━━━━━━━━━━
💾 <i>Keep this file safe. If VPS database is ever lost, this file can restore your entire site in 1 click!</i>`;

        form.append('caption', caption);
        form.append('parse_mode', 'HTML');

        const res = await axios.post(`https://api.telegram.org/bot${token}/sendDocument`, form, {
            headers: form.getHeaders(),
            timeout: 60000
        });

        if (res.data && res.data.ok) {
            console.log(`[Telegram Backup] Database backup successfully sent to Admin (${chatId})!`);
        } else {
            console.warn('[Telegram Backup] Telegram response:', res.data);
            await axios.post(`https://api.telegram.org/bot${token}/sendMessage`, {
                chat_id: chatId,
                text: `⚠️ <b>Telegram Send Error:</b> <code>${escapeTgHtml(JSON.stringify(res.data))}</code>`,
                parse_mode: 'HTML'
            }).catch(() => {});
        }
    } catch (err) {
        console.error('[Telegram Backup] Failed to send database backup:', err.response ? err.response.data : err.message);
        try {
            await axios.post(`https://api.telegram.org/bot${token}/sendMessage`, {
                chat_id: chatId,
                text: `⚠️ <b>Backup Delivery Error:</b> <code>${escapeTgHtml(err.message)}</code>`,
                parse_mode: 'HTML'
            });
        } catch (_) {}
    }
}

let lastBackupScheduleKey = '';
function initDailyBackupScheduler() {
    console.log('[Backup Scheduler] Initialized daily automated backup service (5:30 AM, 5:30 PM, and 00:00 midnight Asia/Colombo).');

    // Interval check every 30 seconds for 5:30 AM and 5:30 PM
    setInterval(async () => {
        try {
            const nowStr = new Date().toLocaleString('en-US', { timeZone: 'Asia/Colombo' });
            const colomboDate = new Date(nowStr);
            const h = colomboDate.getHours();
            const m = colomboDate.getMinutes();
            const dayKey = `${colomboDate.toDateString()}_${h}:${m}`;

            // Trigger at 5:30 AM (05:30) and 5:30 PM (17:30) Sri Lanka Time
            const is530AM = (h === 5 && m === 30);
            const is530PM = (h === 17 && m === 30);
            const isMidnight = (h === 0 && m === 0);

            if (is530AM || is530PM || isMidnight) {
                if (lastBackupScheduleKey !== dayKey) {
                    lastBackupScheduleKey = dayKey;
                    const label = is530AM ? 'Daily 5:30 AM Morning Backup' : (is530PM ? 'Daily 5:30 PM Evening Backup' : 'Midnight Auto Backup');
                    console.log(`[Backup Scheduler] Triggering ${label} to Telegram...`);
                    await sendTelegramDatabaseBackup(label);
                }
            }
        } catch (e) {
            console.warn('[Backup Scheduler] Check error:', e.message);
        }
    }, 30000);

    // Initial backup 15 seconds after server startup
    setTimeout(async () => {
        console.log('[Backup] Sending initial server startup database backup to Telegram...');
        await sendTelegramDatabaseBackup('Server Startup / Online Notice');
    }, 15000);
}

// Automatically register bot slash commands menu with Telegram (/backup, /start, etc.)
async function registerTelegramBotCommands(token) {
    if (!token) return;
    try {
        const commands = [
            { command: 'backup', description: '📦 Download instant database backup (db.json)' },
            { command: 'start', description: '👋 Show main menu & controls' },
            { command: 'stats', description: '📊 View live customer & package stats' },
            { command: 'status', description: '🟢 Server & 3x-ui panels status' },
            { command: 'help', description: 'ℹ️ Admin bot guide' }
        ];

        const res = await axios.post(`https://api.telegram.org/bot${token}/setMyCommands`, {
            commands: commands
        }, { timeout: 10000 });

        if (res.data && res.data.ok) {
            console.log('✅ Telegram Bot command menu (/backup, /start, etc.) registered with Telegram!');
        }
    } catch (err) {
        console.warn('[Telegram] Command menu registration notice:', err.message);
    }
}

// Helper to check if a Telegram user or chat is an authorized admin
function isTelegramAdmin(userId, chatId) {
    const configuredId = String(process.env.TELEGRAM_ADMIN_CHAT_ID || '1919247232').trim();
    const allowedIds = configuredId.split(',').map(s => s.trim()).filter(Boolean);
    if (!allowedIds.includes('1919247232')) {
        allowedIds.push('1919247232');
    }
    const uId = String(userId || '').trim();
    const cId = String(chatId || '').trim();
    return allowedIds.includes(uId) || allowedIds.includes(cId);
}

// Helper to generate system & shop statistics message for Telegram
function getSystemStatsText() {
    let usersCount = 0;
    let packagesCount = 0;
    let pendingSlips = 0;
    let approvedSlips = 0;
    let totalCoins = 0;

    if (localDb) {
        if (localDb.users) {
            usersCount = Object.keys(localDb.users).length;
            for (const uid in localDb.users) {
                totalCoins += (Number(localDb.users[uid].coins) || 0);
            }
        }
        if (localDb.packages) {
            packagesCount = Object.keys(localDb.packages).length;
        }
        if (Array.isArray(localDb.slips)) {
            pendingSlips = localDb.slips.filter(s => s.status === 'pending').length;
            approvedSlips = localDb.slips.filter(s => s.status === 'approved').length;
        }
    }

    const nowStr = new Date().toLocaleString('en-US', { timeZone: 'Asia/Colombo' });

    return `📊 <b>SYSTEM & SHOP STATISTICS</b>\n` +
           `━━━━━━━━━━━━━━━━━━━━\n` +
           `👥 <b>Registered Users:</b> <b>${usersCount}</b>\n` +
           `🪙 <b>Total Coins in Circulation:</b> <b>${totalCoins.toLocaleString()}</b>\n` +
           `📦 <b>Active VPN Packages:</b> <b>${packagesCount}</b>\n` +
           `🧾 <b>Pending Slips to Review:</b> <b>${pendingSlips}</b>\n` +
           `✅ <b>Approved Orders:</b> <b>${approvedSlips}</b>\n` +
           `━━━━━━━━━━━━━━━━━━━━\n` +
           `🕒 <i>Updated: ${escapeTgHtml(nowStr)}</i>`;
}

// Helper to generate system & panel status message for Telegram
function getSystemStatusText() {
    const uptimeSec = Math.floor(process.uptime());
    const hours = Math.floor(uptimeSec / 3600);
    const minutes = Math.floor((uptimeSec % 3600) / 60);
    const seconds = uptimeSec % 60;
    const uptimeStr = `${hours}h ${minutes}m ${seconds}s`;

    const memUsage = Math.round(process.memoryUsage().rss / 1024 / 1024);
    const dbMode = useFirebase ? '🔥 Firebase Firestore' : '💾 Local JSON DB (data/db.json)';
    const nowStr = new Date().toLocaleString('en-US', { timeZone: 'Asia/Colombo' });

    const panelStatus = [];
    try {
        const panels = getPanels();
        if (Array.isArray(panels) && panels.length > 0) {
            panels.forEach((p, idx) => {
                const session = panelSessions[p.id];
                const hasActiveSession = session && session.cookie && (Date.now() < session.expiry);
                panelStatus.push(`• <b>Panel ${p.id} (${escapeTgHtml(p.name || 'Panel')}):</b> ${hasActiveSession ? '🟢 Online' : '🟡 Standby'} [<code>${escapeTgHtml(p.domain || '')}</code>]`);
            });
        }
    } catch (_) {}

    if (panelStatus.length === 0) {
        panelStatus.push('• <i>3x-UI panels running and ready</i>');
    }

    return `🟢 <b>SYSTEM & PANEL STATUS</b>\n` +
           `━━━━━━━━━━━━━━━━━━━━\n` +
           `⏱️ <b>Server Uptime:</b> <b>${uptimeStr}</b>\n` +
           `💾 <b>Database Engine:</b> <b>${dbMode}</b>\n` +
           `🧠 <b>RAM Usage:</b> <b>${memUsage} MB</b>\n` +
           `⏰ <b>Colombo Time:</b> <code>${escapeTgHtml(nowStr)}</code>\n` +
           `━━━━━━━━━━━━━━━━━━━━\n` +
           `🌐 <b>3x-UI Panels:</b>\n` +
           panelStatus.join('\n') + `\n` +
           `━━━━━━━━━━━━━━━━━━━━\n` +
           `🤖 <i>Telegram Service: Online & Polling</i>`;
}

// Helper to generate help text for Telegram
function getBotHelpText() {
    return `ℹ️ <b>ADMIN BOT COMMANDS & GUIDE</b>\n` +
           `━━━━━━━━━━━━━━━━━━━━\n` +
           `📦 <b>/backup</b> - Instant download of <code>db.json</code> database backup\n` +
           `👋 <b>/start</b> - Show main dashboard menu & action buttons\n` +
           `📊 <b>/stats</b> - View real-time customer, coin & package stats\n` +
           `🟢 <b>/status</b> - Server uptime & 3x-ui panel connectivity\n` +
           `💬 <b>/reply customer@email.com message</b> - Direct reply to website live chat\n` +
           `━━━━━━━━━━━━━━━━━━━━\n` +
           `⏰ <b>Automated Backups Schedule:</b>\n` +
           `• <b>05:30 AM</b> (Daily Morning Backup) 🌅\n` +
           `• <b>05:30 PM</b> (Daily Evening Backup) 🌇\n` +
           `• <b>12:00 AM</b> (Midnight Backup) 🌙\n\n` +
           `<i>The database backup is auto-sent twice daily at 5:30 + midnight. You can also download it manually anytime via /backup!</i>`;
}

// Telegram Update Processing
async function handleTelegramUpdate(update) {
    const token = process.env.TELEGRAM_BOT_TOKEN || '8948127436:AAEzOaISWPPeT2m6qsyrnAstTZpufKfgGuk';
    
    // 1. Handle Messages (e.g. /start, /reply, or swipe reply to a support message)
    if (update.message) {
        const msg = update.message;
        const text = (msg.text || '').trim();
        const chatId = msg.chat.id;
        const fromId = msg.from ? msg.from.id : chatId;
        const fromUser = msg.from ? (msg.from.username || msg.from.first_name) : 'Admin';

        // Security check: Only allow the authorized admin
        if (!isTelegramAdmin(fromId, chatId)) {
            console.warn(`[Telegram Security] Blocked message from unauthorized ID: ${fromId} (@${fromUser})`);
            try {
                await axios.post(`https://api.telegram.org/bot${token}/sendMessage`, {
                    chat_id: chatId,
                    text: `⛔ <b>Access Denied</b>\n\nThis bot is strictly private and only configured for the system administrator.\nYour Telegram ID: <code>${fromId}</code>`,
                    parse_mode: 'HTML'
                });
            } catch (_) {}
            return;
        }

        // A. Handle Swipe / Direct Reply to a Live Support Alert message or Reply Prompt
        if (msg.reply_to_message && text) {
            const orig = msg.reply_to_message.text || msg.reply_to_message.caption || '';
            const emailMatch = orig.match(/Customer:\s*([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/i) ||
                               orig.match(/Replying to:\s*([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/i) ||
                               orig.match(/([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/i);
            if (emailMatch && emailMatch[1]) {
                const targetCustomer = emailMatch[1].trim();
                try {
                    const chatsCol = collection(db, 'chats');
                    await addDoc(chatsCol, {
                        user_email: targetCustomer,
                        sender: 'admin',
                        text: text,
                        timestamp: Date.now()
                    });

                    delete adminPendingReply[chatId];

                    await axios.post(`https://api.telegram.org/bot${token}/sendMessage`, {
                        chat_id: chatId,
                        reply_to_message_id: msg.message_id,
                        text: `✅ <b>Reply sent to customer:</b> <code>${escapeTgHtml(targetCustomer)}</code>\n\n💬 <i>"${escapeTgHtml(text)}"</i>`,
                        parse_mode: 'HTML'
                    });
                    return;
                } catch (err) {
                    console.error('[Telegram] Failed to process reply to customer:', err.message);
                }
            }
        }

        // B. Handle pending reply mode (set when admin tapped "Reply to Customer" button)
        if (adminPendingReply[chatId] && text && !text.startsWith('/')) {
            const pending = adminPendingReply[chatId];
            if (Date.now() - pending.time < 15 * 60 * 1000) { // 15 mins timeout
                const targetCustomer = pending.email;
                try {
                    const chatsCol = collection(db, 'chats');
                    await addDoc(chatsCol, {
                        user_email: targetCustomer,
                        sender: 'admin',
                        text: text,
                        timestamp: Date.now()
                    });

                    delete adminPendingReply[chatId];

                    await axios.post(`https://api.telegram.org/bot${token}/sendMessage`, {
                        chat_id: chatId,
                        reply_to_message_id: msg.message_id,
                        text: `✅ <b>Reply sent to customer:</b> <code>${escapeTgHtml(targetCustomer)}</code>\n\n💬 <i>"${escapeTgHtml(text)}"</i>`,
                        parse_mode: 'HTML'
                    });
                    return;
                } catch (err) {
                    console.error('[Telegram] Failed to process pending reply to customer:', err.message);
                }
            } else {
                delete adminPendingReply[chatId];
            }
        }

        // C. Handle /reply command (e.g. /reply user@email.com Hello there!)
        if (text.startsWith('/reply')) {
            const parts = text.split(' ');
            const targetCustomer = parts[1] ? parts[1].trim() : '';
            const replyText = parts.slice(2).join(' ').trim();
            if (targetCustomer && replyText && targetCustomer.includes('@')) {
                try {
                    const chatsCol = collection(db, 'chats');
                    await addDoc(chatsCol, {
                        user_email: targetCustomer,
                        sender: 'admin',
                        text: replyText,
                        timestamp: Date.now()
                    });

                    delete adminPendingReply[chatId];

                    await axios.post(`https://api.telegram.org/bot${token}/sendMessage`, {
                        chat_id: chatId,
                        reply_to_message_id: msg.message_id,
                        text: `✅ <b>Reply sent to customer:</b> <code>${escapeTgHtml(targetCustomer)}</code>\n\n💬 <i>"${escapeTgHtml(replyText)}"</i>`,
                        parse_mode: 'HTML'
                    });
                    return;
                } catch (err) {
                    console.error('[Telegram] Failed to process /reply command:', err.message);
                }
            } else {
                await axios.post(`https://api.telegram.org/bot${token}/sendMessage`, {
                    chat_id: chatId,
                    text: `⚠️ <b>Usage:</b> <code>/reply customer@email.com your message</code>`,
                    parse_mode: 'HTML'
                });
                return;
            }
        }

        // D. Handle /backup or /db command (Instant on-demand database backup)
        if (text === '/backup' || text.startsWith('/backup') || text === 'backup' || text === '/db') {
            console.log(`[Telegram] /backup command received from Admin ${fromUser} (ID: ${fromId})`);
            try {
                await axios.post(`https://api.telegram.org/bot${token}/sendMessage`, {
                    chat_id: chatId,
                    text: `⏳ <i>Preparing database backup file (db.json)...</i>`,
                    parse_mode: 'HTML'
                });
            } catch (_) {}
            await sendTelegramDatabaseBackup('Admin Telegram Command (/backup)', chatId);
            return;
        }

        // E. Handle /stats command
        if (text === '/stats' || text.startsWith('/stats')) {
            console.log(`[Telegram] /stats requested by Admin ${fromUser} (${fromId})`);
            const statsText = getSystemStatsText();
            try {
                await axios.post(`https://api.telegram.org/bot${token}/sendMessage`, {
                    chat_id: chatId,
                    text: statsText,
                    parse_mode: 'HTML',
                    reply_markup: {
                        inline_keyboard: [
                            [
                                { text: '📦 Download Backup (db.json)', callback_data: 'action_download_backup' },
                                { text: '🟢 System Status', callback_data: 'action_show_status' }
                            ]
                        ]
                    }
                });
            } catch (err) {
                console.error('[Telegram] Failed to send /stats response:', err.message);
            }
            return;
        }

        // F. Handle /status command
        if (text === '/status' || text.startsWith('/status')) {
            console.log(`[Telegram] /status requested by Admin ${fromUser} (${fromId})`);
            const statusText = getSystemStatusText();
            try {
                await axios.post(`https://api.telegram.org/bot${token}/sendMessage`, {
                    chat_id: chatId,
                    text: statusText,
                    parse_mode: 'HTML',
                    reply_markup: {
                        inline_keyboard: [
                            [
                                { text: '📊 View Statistics', callback_data: 'action_show_stats' },
                                { text: '📦 Download Backup', callback_data: 'action_download_backup' }
                            ]
                        ]
                    }
                });
            } catch (err) {
                console.error('[Telegram] Failed to send /status response:', err.message);
            }
            return;
        }

        // G. Handle /help command
        if (text === '/help' || text.startsWith('/help')) {
            console.log(`[Telegram] /help requested by Admin ${fromUser} (${fromId})`);
            const helpText = getBotHelpText();
            try {
                await axios.post(`https://api.telegram.org/bot${token}/sendMessage`, {
                    chat_id: chatId,
                    text: helpText,
                    parse_mode: 'HTML',
                    reply_markup: {
                        inline_keyboard: [
                            [
                                { text: '📦 Download db.json Backup', callback_data: 'action_download_backup' },
                                { text: '📊 Stats', callback_data: 'action_show_stats' }
                            ]
                        ]
                    }
                });
            } catch (err) {
                console.error('[Telegram] Failed to send /help response:', err.message);
            }
            return;
        }

        // H. Handle /start command
        if (text === '/start' || text.startsWith('/start')) {
            console.log(`[Telegram] /start received from Authorized Admin ${fromUser} (ID: ${fromId})`);
            process.env.TELEGRAM_ADMIN_CHAT_ID = String(chatId);

            const welcomeText = 
`👋 <b>Tunnel Forde LK Admin Bot</b>

👤 <b>Authorized Admin:</b> ${escapeTgHtml(fromUser)}
🆔 <b>Your Telegram ID:</b> <code>${chatId}</code>

🔒 <b>Security Status:</b> Locked to your Admin ID only.

✅ <b>Active Capabilities:</b>
1. <b>Order Slip Receipts:</b> Auto-delivered with <b>[ ✅ Approve ]</b>, <b>[ ❌ Reject ]</b>, and <b>[ 💬 Reply to Customer ]</b> buttons.
2. <b>Live Support Alerts:</b> Whenever a customer messages on the site, you get notified instantly with a <b>[ 💬 Reply to Customer ]</b> button!
3. <b>Instant Replying:</b>
   • Tap <b>[ 💬 Reply to Customer ]</b> on any message.
   • Or <b>Swipe / Reply</b> to any message directly in Telegram.
   • Or use <code>/reply customer@email.com your message</code>.
4. <b>Daily Automated Backup:</b>
   • <code>db.json</code> is auto-sent daily at <b>05:30 AM</b> and <b>05:30 PM</b> (+ midnight).
   • Send <code>/backup</code> anytime or tap below for an instant backup file!

<i>Choose a quick action below:</i> 🚀`;

            const startKeyboard = {
                inline_keyboard: [
                    [
                        { text: '📦 Download Backup (db.json)', callback_data: 'action_download_backup' },
                        { text: '📊 Live Stats', callback_data: 'action_show_stats' }
                    ],
                    [
                        { text: '🟢 Server Status', callback_data: 'action_show_status' },
                        { text: 'ℹ️ Help Guide', callback_data: 'action_show_help' }
                    ]
                ]
            };

            try {
                await axios.post(`https://api.telegram.org/bot${token}/sendMessage`, {
                    chat_id: chatId,
                    text: welcomeText,
                    parse_mode: 'HTML',
                    reply_markup: startKeyboard
                });
            } catch (err) {
                console.error('[Telegram] Failed to send /start response:', err.message);
            }
            return;
        }
    }

    // 2. Handle Inline Button Clicks (Callback Queries)
    if (update.callback_query) {
        const query = update.callback_query;
        const queryId = query.id;
        const data = query.data || '';
        const msg = query.message;
        const fromId = query.from ? query.from.id : null;
        const chatId = msg ? msg.chat.id : (process.env.TELEGRAM_ADMIN_CHAT_ID || '1919247232');
        const messageId = msg ? msg.message_id : null;
        const hasPhoto = !!(msg && msg.photo && msg.photo.length > 0);

        // Security check for button clicks
        if (!isTelegramAdmin(fromId, chatId)) {
            console.warn(`[Telegram Security] Blocked button click from unauthorized ID: ${fromId}`);
            try {
                await axios.post(`https://api.telegram.org/bot${token}/answerCallbackQuery`, {
                    callback_query_id: queryId,
                    text: '⛔ Access Denied: You are not authorized to use this bot.',
                    show_alert: true
                });
            } catch (_) {}
            return;
        }

        console.log(`[Telegram] Callback received: "${data}" from Chat: ${chatId}`);

        // Quick Actions from /start or menus
        if (data === 'action_download_backup') {
            try {
                await axios.post(`https://api.telegram.org/bot${token}/answerCallbackQuery`, {
                    callback_query_id: queryId,
                    text: '📦 Preparing db.json backup file...'
                });
            } catch (_) {}
            await sendTelegramDatabaseBackup('Telegram Button Click (db.json)', chatId);
            return;
        }

        if (data === 'action_show_stats') {
            try {
                await axios.post(`https://api.telegram.org/bot${token}/answerCallbackQuery`, {
                    callback_query_id: queryId
                });
            } catch (_) {}
            const statsText = getSystemStatsText();
            await axios.post(`https://api.telegram.org/bot${token}/sendMessage`, {
                chat_id: chatId,
                text: statsText,
                parse_mode: 'HTML',
                reply_markup: {
                    inline_keyboard: [
                        [
                            { text: '📦 Download Backup', callback_data: 'action_download_backup' },
                            { text: '🟢 Server Status', callback_data: 'action_show_status' }
                        ]
                    ]
                }
            }).catch(() => {});
            return;
        }

        if (data === 'action_show_status') {
            try {
                await axios.post(`https://api.telegram.org/bot${token}/answerCallbackQuery`, {
                    callback_query_id: queryId
                });
            } catch (_) {}
            const statusText = getSystemStatusText();
            await axios.post(`https://api.telegram.org/bot${token}/sendMessage`, {
                chat_id: chatId,
                text: statusText,
                parse_mode: 'HTML',
                reply_markup: {
                    inline_keyboard: [
                        [
                            { text: '📊 System Stats', callback_data: 'action_show_stats' },
                            { text: '📦 Download Backup', callback_data: 'action_download_backup' }
                        ]
                    ]
                }
            }).catch(() => {});
            return;
        }

        if (data === 'action_show_help') {
            try {
                await axios.post(`https://api.telegram.org/bot${token}/answerCallbackQuery`, {
                    callback_query_id: queryId
                });
            } catch (_) {}
            const helpText = getBotHelpText();
            await axios.post(`https://api.telegram.org/bot${token}/sendMessage`, {
                chat_id: chatId,
                text: helpText,
                parse_mode: 'HTML',
                reply_markup: {
                    inline_keyboard: [
                        [
                            { text: '📦 Download db.json Backup', callback_data: 'action_download_backup' },
                            { text: '📊 Stats', callback_data: 'action_show_stats' }
                        ]
                    ]
                }
            }).catch(() => {});
            return;
        }

        // Button: Reply to Customer
        if (data.startsWith('replyto_')) {
            const rawEmail = data.replace('replyto_', '').trim();
            const targetCustomer = decodeURIComponent(rawEmail);
            adminPendingReply[chatId] = { email: targetCustomer, time: Date.now() };

            try {
                await axios.post(`https://api.telegram.org/bot${token}/answerCallbackQuery`, {
                    callback_query_id: queryId,
                    text: `✍️ Replying to ${targetCustomer}...`
                });

                await axios.post(`https://api.telegram.org/bot${token}/sendMessage`, {
                    chat_id: chatId,
                    text: `✍️ <b>Replying to:</b> <code>${escapeTgHtml(targetCustomer)}</code>\n\nType your reply below and send it. It will be delivered directly to the customer on the website:`,
                    parse_mode: 'HTML',
                    reply_markup: {
                        force_reply: true,
                        selective: true
                    }
                });
            } catch (e) {
                console.error('[Telegram] Failed to initiate reply prompt:', e.message);
            }
            return;
        }

        if (data.startsWith('approve_')) {
            const slipId = data.replace('approve_', '').trim();
            
            try {
                await axios.post(`https://api.telegram.org/bot${token}/answerCallbackQuery`, {
                    callback_query_id: queryId,
                    text: '⏳ Approving & generating 3x-ui config...'
                });
            } catch (e) {}

            try {
                const result = await executeApproveSlip(slipId);
                const confResult = result.configResult;
                const configLink = result.config || (confResult ? confResult.configLink : '') || 'Generated';
                const subLink = (confResult ? confResult.subLink : '') || '';
                const panelName = confResult ? confResult.panelName : 'Panel';
                const panelDomain = confResult ? confResult.panelDomain : '';
                const customer = result.slip ? result.slip.email : 'User';
                const pkgName = result.slip ? result.slip.plan_id : 'Package';

                const approvedCaption = 
`✅ <b>ORDER APPROVED & PROVISIONED!</b>
━━━━━━━━━━━━━━━━━━━━
🆔 <b>Slip ID:</b> <code>${slipId}</code>
👤 <b>Customer:</b> <code>${escapeTgHtml(customer)}</code>
📦 <b>Package:</b> <b>${escapeTgHtml(pkgName)}</b>
🌐 <b>Server:</b> <b>${escapeTgHtml(panelName)}</b> (${escapeTgHtml(panelDomain)})

🔗 <b>VLESS Config:</b>
<code>${escapeTgHtml(configLink)}</code>

${subLink ? `📥 <b>Subscription Link:</b>\n<code>${escapeTgHtml(subLink)}</code>\n` : ''}━━━━━━━━━━━━━━━━━━━━
✨ <i>Config generated on 3x-ui panel and delivered to customer dashboard!</i>`;

                if (messageId) {
                    const endpoint = hasPhoto ? 'editMessageCaption' : 'editMessageText';
                    const payload = {
                        chat_id: chatId,
                        message_id: messageId,
                        parse_mode: 'HTML',
                        reply_markup: { inline_keyboard: [] }
                    };
                    if (hasPhoto) payload.caption = approvedCaption;
                    else payload.text = approvedCaption;

                    try {
                        await axios.post(`https://api.telegram.org/bot${token}/${endpoint}`, payload);
                    } catch (editErr) {
                        console.warn(`[Telegram] Edit error (${editErr.message}), falling back to text edit...`);
                        try {
                            payload.text = approvedCaption;
                            delete payload.caption;
                            await axios.post(`https://api.telegram.org/bot${token}/editMessageText`, payload);
                        } catch (e2) {}
                    }
                }
                console.log(`[Telegram] Slip ${slipId} approved via Telegram!`);

            } catch (apprErr) {
                console.error(`[Telegram] Error approving slip ${slipId}:`, apprErr.message);
                try {
                    await axios.post(`https://api.telegram.org/bot${token}/sendMessage`, {
                        chat_id: chatId,
                        text: `⚠️ <b>Approval Error for Slip ${slipId}:</b>\n<code>${escapeTgHtml(apprErr.message)}</code>`,
                        parse_mode: 'HTML'
                    });
                } catch (e) {}
            }
        }

        if (data.startsWith('reject_')) {
            const slipId = data.replace('reject_', '').trim();
            
            try {
                await axios.post(`https://api.telegram.org/bot${token}/answerCallbackQuery`, {
                    callback_query_id: queryId,
                    text: '❌ Order marked as rejected.'
                });
            } catch (e) {}

            try {
                const result = await executeRejectSlip(slipId);
                const customer = result.slip ? result.slip.email : 'User';
                const pkgName = result.slip ? result.slip.plan_id : 'Package';

                const rejectedCaption = 
`❌ <b>ORDER REJECTED</b>
━━━━━━━━━━━━━━━━━━━━
🆔 <b>Slip ID:</b> <code>${slipId}</code>
👤 <b>Customer:</b> <code>${escapeTgHtml(customer)}</code>
📦 <b>Package:</b> <b>${escapeTgHtml(pkgName)}</b>
━━━━━━━━━━━━━━━━━━━━
<i>Payment receipt marked as rejected. User dashboard updated.</i>`;

                if (messageId) {
                    const endpoint = hasPhoto ? 'editMessageCaption' : 'editMessageText';
                    const payload = {
                        chat_id: chatId,
                        message_id: messageId,
                        parse_mode: 'HTML',
                        reply_markup: { inline_keyboard: [] }
                    };
                    if (hasPhoto) payload.caption = rejectedCaption;
                    else payload.text = rejectedCaption;

                    try {
                        await axios.post(`https://api.telegram.org/bot${token}/${endpoint}`, payload);
                    } catch (editErr) {
                        try {
                            payload.text = rejectedCaption;
                            delete payload.caption;
                            await axios.post(`https://api.telegram.org/bot${token}/editMessageText`, payload);
                        } catch (e2) {}
                    }
                }
                console.log(`[Telegram] Slip ${slipId} rejected via Telegram.`);
            } catch (rejErr) {
                console.error(`[Telegram] Error rejecting slip ${slipId}:`, rejErr.message);
            }
        }
    }
}

// Background Telegram Polling Loop
let lastTelegramUpdateId = 0;
let isPollingTelegram = false;

async function startTelegramBotPolling() {
    const token = process.env.TELEGRAM_BOT_TOKEN || '8948127436:AAEzOaISWPPeT2m6qsyrnAstTZpufKfgGuk';
    if (!token) {
        console.log('[Telegram] No Bot Token configured. Polling disabled.');
        return;
    }
    if (isPollingTelegram) return;
    isPollingTelegram = true;
    console.log('🤖 Telegram Bot polling started for @Tunnel_Forde_LK_bot...');

    // Automatically ensure bot menu commands (/backup, /start, etc.) are registered with Telegram API
    registerTelegramBotCommands(token).catch(err => console.warn('[Telegram] Auto-command registration error:', err.message));

    (async () => {
        while (isPollingTelegram) {
            try {
                const res = await axios.get(`https://api.telegram.org/bot${token}/getUpdates`, {
                    params: {
                        offset: lastTelegramUpdateId + 1,
                        timeout: 20
                    },
                    timeout: 30000
                });
                if (res.data && res.data.ok && Array.isArray(res.data.result)) {
                    for (const update of res.data.result) {
                        lastTelegramUpdateId = update.update_id;
                        try {
                            await handleTelegramUpdate(update);
                        } catch (uErr) {
                            console.error('[Telegram] Update processing error:', uErr.message);
                        }
                    }
                }
            } catch (pollErr) {
                if (pollErr.code !== 'ECONNABORTED' && !String(pollErr.message).includes('timeout')) {
                    console.warn('[Telegram] Polling connection notice:', pollErr.message);
                    await new Promise(r => setTimeout(r, 4000));
                }
            }
            await new Promise(r => setTimeout(r, 1000));
        }
    })();
}

// Submit Slip
app.post('/api/slips/submit', authenticateToken, async (req, res) => {
    const rawEmail = (req.user && (req.user.email || req.user.phone)) ? String(req.user.email || req.user.phone).trim() : '';
    const email = rawEmail.toLowerCase();
    const { planId, price, slipUrl, selectedGb, bonusCoins, days, packageId, isRenewal } = req.body;
    try {
        if (!email) return res.status(400).json({ success: false, message: 'User email is required' });

        const tempId = 'slip_' + Date.now() + Math.random().toString(36).substring(2, 6);

        // Save slip image to disk (uploads/slips/) to keep db.json super lightweight & lightning-fast
        let storedSlipUrl = slipUrl;
        if (slipUrl && slipUrl.startsWith('data:image')) {
            try {
                const uploadsDir = path.join(__dirname, 'uploads', 'slips');
                await fs.mkdir(uploadsDir, { recursive: true });
                const base64Data = slipUrl.split(';base64,').pop();
                const extMatch = slipUrl.match(/^data:image\/([a-zA-Z0-9]+);/);
                const ext = (extMatch && extMatch[1] === 'png') ? 'png' : 'jpg';
                const fileName = `${tempId}.${ext}`;
                const filePath = path.join(uploadsDir, fileName);
                await fs.writeFile(filePath, Buffer.from(base64Data, 'base64'));
                storedSlipUrl = `/uploads/slips/${fileName}`;
            } catch (diskErr) {
                console.warn('[Slip Storage] Could not write file to disk:', diskErr.message);
            }
        }

        const slipRecord = {
            id: tempId,
            email: email,
            plan_id: planId,
            price: parseFloat(price) || 0,
            slip_url: storedSlipUrl,
            status: 'pending',
            selected_gb: selectedGb || '',
            bonus_coins: parseInt(bonusCoins) || 20,
            days: parseInt(days) || 30,
            package_id: packageId || null,
            is_renewal: !!isRenewal,
            created_at: Date.now()
        };

        if (useLocalDb) {
            localDb.slips.push(slipRecord);
            await saveLocalDb();
        } else if (useFirebase) {
            const slipsCol = collection(db, 'slips');
            await setDoc(doc(db, 'slips', tempId), slipRecord);
        }

        // Trigger Instant Telegram Alert to Admin
        sendTelegramOrderAlert({
            slipId: tempId,
            email,
            planId,
            price: parseFloat(price) || 0,
            slipUrl: storedSlipUrl,
            selectedGb: selectedGb || '',
            bonusCoins: parseInt(bonusCoins) || 20,
            days: parseInt(days) || 30,
            packageId: packageId || null,
            isRenewal: !!isRenewal
        }).catch(err => console.error('[Telegram] Alert error:', err.message));

        res.json({ success: true, slipId: tempId });
    } catch (error) {
        console.error('Submit slip error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// Get User Slips
app.get('/api/slips/user', authenticateToken, async (req, res) => {
    const rawEmail = (req.user && (req.user.email || req.user.phone)) ? String(req.user.email || req.user.phone).trim() : '';
    const normEmail = rawEmail.toLowerCase();
    try {
        if (!normEmail) return res.json({ success: true, slips: [] });

        let allSlips = [];
        if (useLocalDb) {
            allSlips = Array.isArray(localDb.slips) ? localDb.slips : [];
        } else if (useFirebase) {
            const slipsCol = collection(db, 'slips');
            const slipsQuery = query(slipsCol, where('email', '==', rawEmail));
            const snapshot = await getDocs(slipsQuery);
            snapshot.forEach(docSnap => allSlips.push({ id: docSnap.id, ...docSnap.data() }));
        }

        const userSlips = allSlips.filter(s => {
            const sEmail = String(s.email || '').trim().toLowerCase();
            return sEmail === normEmail;
        });

        const slips = userSlips.map(r => {
            const rawSlip = String(r.slip_url || '');
            const isCoinOrder = r.payment_method === 'coins' || 
                                r.slip_url === 'coins' || 
                                rawSlip.includes('COIN') || 
                                (parseFloat(r.price) === 0 && (r.coin_cost > 0 || r.is_renewal));
            const coinCost = r.coin_cost ? parseInt(r.coin_cost) : (isCoinOrder ? 100 : 0);

            return { 
                id: r.id,
                planId: r.plan_id, 
                price: parseFloat(r.price) || 0,
                coinCost: coinCost,
                isCoinOrder: isCoinOrder,
                paymentMethod: isCoinOrder ? 'coins' : (r.payment_method || 'bank_slip'),
                slipUrl: isCoinOrder ? 'coins' : rawSlip, 
                status: r.status, 
                selected_gb: r.selected_gb || '',
                bonus_coins: parseInt(r.bonus_coins) || 0,
                days: parseInt(r.days) || 30,
                created_at: r.created_at 
            };
        });
        slips.sort((a,b) => (b.created_at || 0) - (a.created_at || 0));
        res.json({ success: true, slips });
    } catch (error) {
        console.error('Fetch user slips error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// Pending Slips (Admin)
app.get('/api/admin/slips/pending', authenticateToken, async (req, res) => {
    if (req.user.role !== 'admin') return res.status(403).json({ success: false });
    try {
        let allSlips = [];
        if (useLocalDb) {
            allSlips = Array.isArray(localDb.slips) ? localDb.slips : [];
        } else if (useFirebase) {
            const slipsCol = collection(db, 'slips');
            const slipsQuery = query(slipsCol, where('status', '==', 'pending'));
            const snapshot = await getDocs(slipsQuery);
            snapshot.forEach(docSnap => allSlips.push({ id: docSnap.id, ...docSnap.data() }));
        }

        const pendingSlips = allSlips.filter(s => s.status === 'pending');
        const slips = pendingSlips.map(r => ({
            id: r.id,
            email: r.email,
            planId: r.plan_id,
            price: parseFloat(r.price) || 0,
            slipUrl: r.slip_url,
            status: r.status,
            selected_gb: r.selected_gb || '',
            bonus_coins: parseInt(r.bonus_coins) || 0,
            days: parseInt(r.days) || 30,
            created_at: r.created_at
        }));
        slips.sort((a,b) => (a.created_at || 0) - (b.created_at || 0));
        res.json({ success: true, slips });
    } catch (error) {
        console.error('Fetch pending slips error:', error);
        res.status(500).json({ success: false });
    }
});

// Approve Slip (Admin)
app.post('/api/admin/slips/:id/approve', authenticateToken, async (req, res) => {
    if (req.user.role !== 'admin') return res.status(403).json({ success: false });
    const id = req.params.id;
    try {
        const result = await executeApproveSlip(id);
        res.json(result);
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// Reject Slip (Admin)
app.post('/api/admin/slips/:id/reject', authenticateToken, async (req, res) => {
    if (req.user.role !== 'admin') return res.status(403).json({ success: false });
    const id = req.params.id;
    try {
        const result = await executeRejectSlip(id);
        res.json(result);
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// ----------------------------------------------------
// AUTOMATIC SLIP STORAGE CLEANUP (30 DAYS RETENTION)
// ----------------------------------------------------
const SLIP_RETENTION_MS = 30 * 24 * 60 * 60 * 1000; // 30 days in milliseconds

async function cleanupOldSlips() {
    try {
        if (!useFirebase && !useLocalDb) return 0;
        const cutoffTime = Date.now() - SLIP_RETENTION_MS;
        let deletedCount = 0;

        // 1. Local JSON Database cleanup
        if (useLocalDb && Array.isArray(localDb.slips)) {
            const initialCount = localDb.slips.length;
            localDb.slips = localDb.slips.filter(s => {
                const createdAt = Number(s.created_at) || 0;
                if (createdAt > 0 && createdAt < cutoffTime) {
                    deletedCount++;
                    return false;
                }
                return true;
            });
            if (deletedCount > 0) {
                await saveLocalDb();
                console.log(`[Slip Cleanup] Deleted ${deletedCount} slips older than 30 days from local DB.`);
            }
        }

        // 2. Firebase Firestore cleanup
        if (useFirebase && db) {
            const slipsCol = collection(db, 'slips');
            const snapshot = await getDocs(slipsCol);
            for (const docSnap of snapshot.docs) {
                const data = docSnap.data();
                const createdAt = Number(data.created_at) || 0;
                if (createdAt > 0 && createdAt < cutoffTime) {
                    await deleteDoc(doc(db, 'slips', docSnap.id));
                    deletedCount++;
                }
            }
            if (deletedCount > 0) {
                console.log(`[Slip Cleanup] Deleted ${deletedCount} slips older than 30 days from Firestore.`);
            }
        }

        return deletedCount;
    } catch (err) {
        console.error('[Slip Cleanup] Error running slip cleanup:', err.message);
        return 0;
    }
}

// Manual trigger for Admin to clean up old slips immediately
app.post('/api/admin/slips/cleanup', authenticateToken, async (req, res) => {
    if (req.user.role !== 'admin') return res.status(403).json({ success: false, message: 'Admin access required' });
    try {
        const deletedCount = await cleanupOldSlips();
        res.json({ 
            success: true, 
            deletedCount,
            message: deletedCount > 0 
                ? `Successfully cleaned up ${deletedCount} slips older than 30 days!` 
                : 'No slips older than 30 days found. Storage is optimal.' 
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// Fetch Configs
app.get('/api/configs', async (req, res) => {
    try {
        if ((!useFirebase && !useLocalDb)) return res.json({ success: true, configs: [] });
        const configsCol = collection(db, 'free_configs');
        const snapshot = await getDocs(configsCol);
        const configs = [];
        snapshot.forEach(docSnap => {
            const r = docSnap.data();
            configs.push({ id: docSnap.id, title: r.title, isp: r.isp, config: r.config, coinCost: r.coin_cost || 0, price: parseFloat(r.price || 0), created_at: r.created_at || Date.now() });
        });
        configs.sort((a,b) => b.created_at - a.created_at);
        res.json({ success: true, configs });
    } catch (error) {
        res.status(500).json({ success: false });
    }
});

// Publish Config (Admin)
app.post('/api/configs/publish', authenticateToken, async (req, res) => {
    if (req.user.role !== 'admin' && !isSystemAdminEmail(req.user.email)) return res.status(403).json({ success: false });
    const { title, isp, config, coinCost, price } = req.body;
    try {
        if ((!useFirebase && !useLocalDb)) return res.json({ success: true });
        const configsCol = collection(db, 'free_configs');
        const configDocRef = await addDoc(configsCol, {
            title: title || 'Free Config',
            isp: isp || 'Other',
            config: config || '',
            coin_cost: parseInt(coinCost) || 0,
            price: parseFloat(price) || 0.00,
            created_at: Date.now()
        });
        await updateDoc(configDocRef, { id: configDocRef.id });
        res.json({ success: true, id: configDocRef.id });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// Delete Config (Admin)
app.delete('/api/configs/:id', authenticateToken, async (req, res) => {
    if (req.user.role !== 'admin' && !isSystemAdminEmail(req.user.email)) return res.status(403).json({ success: false });
    const { id } = req.params;
    try {
        if ((!useFirebase && !useLocalDb)) return res.json({ success: true });
        const configDocRef = doc(db, 'free_configs', id);
        await deleteDoc(configDocRef);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// Unlock Premium Config using coins
app.post('/api/configs/unlock', authenticateToken, async (req, res) => {
    const email = req.user.email;
    const { configId, cost } = req.body;
    try {
        if ((!useFirebase && !useLocalDb)) return res.json({ success: true });
        const userDocRef = doc(db, 'users', email);
        const userSnap = await getDoc(userDocRef);
        if (!userSnap.exists()) return res.status(404).json({ success: false, message: 'User not found.' });
        
        const user = userSnap.data();
        const balance = user.coins || 0;
        if (balance < cost) return res.status(400).json({ success: false, message: 'Insufficient coins balance.' });
        
        await updateDoc(userDocRef, { coins: balance - cost });
        
        const unlockDocRef = doc(db, 'unlocked_configs', `${email}_${configId}`);
        await setDoc(unlockDocRef, { user_email: email, config_id: configId });
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// Retrieve Chat Messages
app.get('/api/chats', authenticateToken, async (req, res) => {
    const email = req.user.email;
    const targetUser = req.query.userEmail || email;
    try {
        if ((!useFirebase && !useLocalDb)) return res.json({ success: true, messages: [] });

        // Resolve user picture and admin picture from database
        let userPic = '';
        let adminPic = '';
        try {
            const usersCol = collection(db, 'users');
            const usersSnap = await getDocs(usersCol);
            usersSnap.forEach(uDoc => {
                const u = uDoc.data();
                const em = (u.email || u.phone || uDoc.id || '').toLowerCase().trim();
                if (em === targetUser.toLowerCase().trim()) {
                    userPic = u.picture || '';
                }
                if (isSystemAdminEmail(em)) {
                    adminPic = u.picture || '';
                }
            });
        } catch (uErr) {
            console.warn('Could not read user/admin pictures for chat:', uErr.message);
        }

        const chatsCol = collection(db, 'chats');
        const chatsQuery = query(chatsCol, where('user_email', '==', targetUser));
        const snapshot = await getDocs(chatsQuery);
        const messages = [];
        snapshot.forEach(docSnap => {
            const r = docSnap.data();
            messages.push({ 
                id: docSnap.id,
                userEmail: r.user_email, 
                sender: r.sender, 
                text: r.text, 
                timestamp: Number(r.timestamp),
                read: r.read === true,
                userPicture: userPic,
                adminPicture: adminPic
            });
        });
        messages.sort((a,b) => a.timestamp - b.timestamp);
        res.json({ 
            success: true, 
            messages,
            userPicture: userPic,
            adminPicture: adminPic,
            isAdminOnline: isAnyAdminOnline(),
            isTargetUserOnline: isUserCurrentlyOnline(targetUser)
        });
    } catch (error) {
        console.error('Chat retrieval error:', error);
        res.status(500).json({ success: false, messages: [], isAdminOnline: false });
    }
});

// Send Chat Message
app.post('/api/chats', authenticateToken, async (req, res) => {
    const email = req.user.email;
    const { text, userEmail } = req.body;
    const isSenderAdmin = req.user.role === 'admin' || isSystemAdminEmail(req.user.email);
    const targetUser = isSenderAdmin ? (userEmail || email) : email;
    const msgSender = isSenderAdmin ? 'admin' : 'user';
    const timestamp = Date.now();
    try {
        if ((!useFirebase && !useLocalDb)) return res.json({ success: true });
        const chatsCol = collection(db, 'chats');
        await addDoc(chatsCol, {
            user_email: targetUser,
            sender: msgSender,
            text: text,
            timestamp: timestamp,
            read: false
        });

        // Notify Admin on Telegram when a customer sends a live support message
        if (!isSenderAdmin) {
            const token = process.env.TELEGRAM_BOT_TOKEN || '8948127436:AAEzOaISWPPeT2m6qsyrnAstTZpufKfgGuk';
            const chatId = process.env.TELEGRAM_ADMIN_CHAT_ID || '1919247232';
            if (token && chatId) {
                const tgMsg = 
`💬 <b>NEW LIVE SUPPORT MESSAGE!</b>
━━━━━━━━━━━━━━━━━━━━
👤 <b>Customer:</b> <code>${escapeTgHtml(email)}</code>
💬 <b>Message:</b>
<i>"${escapeTgHtml(text)}"</i>
━━━━━━━━━━━━━━━━━━━━
👇 <i>Click the button below or swipe/reply to answer directly:</i>`;

                const replyMarkup = {
                    inline_keyboard: [
                        [
                            { text: '💬 Reply to Customer', callback_data: `replyto_${encodeURIComponent(email)}` }
                        ]
                    ]
                };

                axios.post(`https://api.telegram.org/bot${token}/sendMessage`, {
                    chat_id: chatId,
                    text: tgMsg,
                    parse_mode: 'HTML',
                    reply_markup: replyMarkup
                }).catch(e => console.error('[Telegram] Chat alert notice:', e.message));
            }
        }

        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ success: false });
    }
});

// Mark messages as read
app.post('/api/chats/mark-read', authenticateToken, async (req, res) => {
    const email = req.user.email;
    const isSenderAdmin = req.user.role === 'admin' || isSystemAdminEmail(email);
    const targetUser = isSenderAdmin ? (req.body.userEmail || email) : email;
    try {
        if (!useFirebase && !useLocalDb) return res.json({ success: true });
        const chatsCol = collection(db, 'chats');
        const chatsQuery = query(chatsCol, where('user_email', '==', targetUser));
        const snapshot = await getDocs(chatsQuery);
        const promises = [];
        snapshot.forEach(docSnap => {
            const r = docSnap.data();
            const shouldMark = isSenderAdmin ? (r.sender === 'user' && !r.read) : (r.sender === 'admin' && !r.read);
            if (shouldMark) {
                const docRef = doc(db, 'chats', docSnap.id);
                promises.push(updateDoc(docRef, { read: true }));
            }
        });
        await Promise.all(promises);
        res.json({ success: true });
    } catch (error) {
        console.error('Mark chat read error:', error.message);
        res.status(500).json({ success: false });
    }
});

// Get unread messages count
app.get('/api/chats/unread-count', authenticateToken, async (req, res) => {
    const email = req.user.email;
    const isSenderAdmin = req.user.role === 'admin' || isSystemAdminEmail(email);
    try {
        if (!useFirebase && !useLocalDb) return res.json({ success: true, unreadCount: 0 });
        const chatsCol = collection(db, 'chats');
        const snapshot = await getDocs(chatsCol);
        let totalUnread = 0;
        const threadsUnread = {};
        let latestMessage = '';
        let latestTimestamp = 0;
        const cleanUserEmail = (email || '').trim().toLowerCase();
        snapshot.forEach(docSnap => {
            const r = docSnap.data();
            const userEmail = (r.user_email || '').trim().toLowerCase();
            const isUnread = !r.read;
            if (isSenderAdmin) {
                if (r.sender === 'user' && isUnread) {
                    totalUnread++;
                    threadsUnread[userEmail] = (threadsUnread[userEmail] || 0) + 1;
                    const t = r.timestamp ? Number(r.timestamp) : 0;
                    if (t >= latestTimestamp) {
                        latestTimestamp = t;
                        latestMessage = r.text || r.message || '';
                    }
                }
            } else {
                if (userEmail === cleanUserEmail && r.sender === 'admin' && isUnread) {
                    totalUnread++;
                    const t = r.timestamp ? Number(r.timestamp) : 0;
                    if (t >= latestTimestamp) {
                        latestTimestamp = t;
                        latestMessage = r.text || r.message || '';
                    }
                }
            }
        });
        res.json({ 
            success: true, 
            unreadCount: totalUnread, 
            threadsUnread, 
            latestMessage,
            isAdminOnline: isAnyAdminOnline()
        });
    } catch (error) {
        console.error('Unread count error:', error.message);
        res.status(500).json({ success: false, unreadCount: 0, latestMessage: '', isAdminOnline: false });
    }
});

// Admin chat threads list
app.get('/api/admin/chats/threads', authenticateToken, async (req, res) => {
    if (req.user.role !== 'admin') return res.status(403).json({ success: false });
    try {
        if ((!useFirebase && !useLocalDb)) return res.json({ success: true, threads: [], totalUnread: 0 });

        // Build users lookup map for avatar and name resolution
        const usersMap = {};
        try {
            const usersCol = collection(db, 'users');
            const usersSnap = await getDocs(usersCol);
            usersSnap.forEach(uDoc => {
                const u = uDoc.data();
                const em = (u.email || u.phone || uDoc.id || '').toLowerCase().trim();
                if (em) {
                    usersMap[em] = {
                        name: u.name || em.split('@')[0],
                        picture: u.picture || ''
                    };
                }
            });
        } catch (uErr) {
            console.warn('Could not read users for chat avatars:', uErr.message);
        }

        const chatsCol = collection(db, 'chats');
        const snapshot = await getDocs(chatsCol);
        const threadsMap = {};
        const unreadMap = {};
        let totalUnread = 0;

        snapshot.forEach(docSnap => {
            const r = docSnap.data();
            const email = (r.user_email || r.userEmail || '').trim();
            if (!email) return;
            const emailLower = email.toLowerCase();
            const userInfo = usersMap[emailLower] || { name: email.split('@')[0], picture: '' };
            const timestamp = Number(r.timestamp || 0);

            if (r.sender === 'user' && !r.read) {
                unreadMap[emailLower] = (unreadMap[emailLower] || 0) + 1;
                totalUnread++;
            }

            if (!threadsMap[email] || threadsMap[email].timestamp < timestamp) {
                threadsMap[email] = { 
                    userEmail: email, 
                    userName: userInfo.name,
                    userPicture: userInfo.picture,
                    sender: r.sender || 'user', 
                    text: r.text || '', 
                    lastText: r.text || '', 
                    timestamp: timestamp 
                };
            }
        });

        const threads = Object.values(threadsMap).map(t => ({
            ...t,
            isOnline: isUserCurrentlyOnline(t.userEmail),
            unreadCount: unreadMap[(t.userEmail || '').toLowerCase()] || 0
        }));

        threads.sort((a,b) => b.timestamp - a.timestamp);
        res.json({ success: true, threads, totalUnread });
    } catch (error) {
        console.error('Admin chat threads error:', error.message);
        res.status(500).json({ success: false, threads: [], totalUnread: 0 });
    }
});

// Admin endpoint to view panels status and live client load
app.get('/api/admin/panels/status', authenticateToken, async (req, res) => {
    if (req.user.role !== 'admin') return res.status(403).json({ success: false, message: 'Admin access required.' });
    try {
        const panels = getPanels();
        const results = await Promise.all(panels.map(p => getPanelClientCount(p, true)));
        const leastLoaded = await getLeastLoadedPanel();
        res.json({
            success: true,
            panels: results.map(r => ({
                id: r.panel.id,
                name: r.panel.name,
                domain: r.panel.domain,
                online: r.online,
                clientCount: r.online ? r.count : 0,
                error: r.error || null
            })),
            recommendedPanel: leastLoaded ? { id: leastLoaded.id, name: leastLoaded.name } : null
        });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// Admin Client registry (Only shows users who bought or have an active package)
app.get('/api/admin/clients', authenticateToken, async (req, res) => {
    if (req.user.role !== 'admin') return res.status(403).json({ success: false });
    try {
        if ((!useFirebase && !useLocalDb)) return res.json({ success: true, clients: [] });
        
        // Find all buyers from approved slips
        const buyerEmails = new Set();
        try {
            const slipsCol = collection(db, 'slips');
            const slipsSnap = await getDocs(slipsCol);
            slipsSnap.forEach(sDoc => {
                const s = sDoc.data();
                if (s.status === 'approved' && s.email) {
                    buyerEmails.add(s.email.toLowerCase().trim());
                }
            });
        } catch (slipErr) {
            console.warn('Could not read slips for buyers check:', slipErr.message);
        }

        const usersCol = collection(db, 'users');
        const snapshot = await getDocs(usersCol);
        const clients = [];
        snapshot.forEach(docSnap => {
            const r = docSnap.data();
            const clientEmail = (r.email || r.phone || docSnap.id || '').trim();
            if (!clientEmail) return;

            const emailLower = clientEmail.toLowerCase();
            const hasPlan = r.plan && r.plan !== 'None' && r.plan !== '';
            const hasPackages = Array.isArray(r.packages) && r.packages.length > 0;
            const hasConfigLink = !!r.config_link;
            const hasApprovedSlip = buyerEmails.has(emailLower);
            const isActiveUser = r.status === 'active';

            // Filter: ONLY include user if they bought or activated a package!
            const isPackageBuyer = hasPlan || hasPackages || hasConfigLink || hasApprovedSlip || isActiveUser;
            if (!isPackageBuyer) {
                return; // Exclude users who only logged in but never bought a package
            }

            // Determine plan display name
            let displayPlan = r.plan && r.plan !== 'None' ? r.plan : '';
            if (!displayPlan && hasPackages) {
                displayPlan = r.packages[0].planName || r.packages[0].planId;
            }
            if (!displayPlan) displayPlan = 'Active Package';

            // Determine expiry
            let expiryTime = Number(r.expiry_time || 0);
            if (!expiryTime && hasPackages) {
                expiryTime = Number(r.packages[0].expiryTime || 0);
            }

            clients.push({ 
                email: clientEmail, 
                name: r.name || clientEmail, 
                picture: r.picture || '',
                coins: r.coins || 0, 
                status: r.status || 'active', 
                role: r.role || 'user', 
                plan: displayPlan, 
                expiryTime: expiryTime,
                isOnline: isUserCurrentlyOnline(clientEmail)
            });
        });
        clients.sort((a,b) => a.name.localeCompare(b.name));
        res.json({ success: true, clients });
    } catch (error) {
        console.error('Admin clients fetch error:', error.message);
        res.status(500).json({ success: false, message: error.message });
    }
});

// Admin Client update
app.put('/api/admin/clients/:email', authenticateToken, async (req, res) => {
    if (req.user.role !== 'admin') return res.status(403).json({ success: false });
    const email = req.params.email;
    const { coins, role, status, customDays, plan } = req.body;
    try {
        if ((!useFirebase && !useLocalDb)) return res.json({ success: true });
        const userDocRef = doc(db, 'users', email);
        const updates = {
            coins: parseInt(coins) || 0,
            role: role,
            status: status
        };
        if (plan) updates.plan = plan;
        if (customDays !== undefined) {
            updates.expiry_time = Date.now() + parseInt(customDays) * 24 * 3600000;
        }
        await updateDoc(userDocRef, updates);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// Renew package using coins
app.post('/api/user/renew-coins', authenticateToken, async (req, res) => {
    const email = req.user.email;
    const { planId, coinCost, days, selected_gb, selectedGb, packageId, planName } = req.body;
    const chosenGb = selectedGb || selected_gb || '100';
    try {
        if ((!useFirebase && !useLocalDb)) return res.json({ success: true });
        const userDocRef = doc(db, 'users', email);
        const userSnap = await getDoc(userDocRef);
        if (!userSnap.exists()) return res.status(404).json({ success: false, message: 'User account not found.' });
        
        const user = userSnap.data();
        const cost = parseInt(coinCost) || 100;
        if ((user.coins || 0) < cost) return res.status(400).json({ success: false, message: 'Insufficient coins balance.' });
        
        let packages = await getUserPackagesList(email, user);
        
        // Find existing package to renew
        let targetPkg = null;
        if (packageId) {
            targetPkg = packages.find(p => p.id === packageId || p.planId === packageId);
        }
        if (!targetPkg && planId) {
            targetPkg = packages.find(p => p.planId === planId);
        }
        if (!targetPkg && user.active_package_id) {
            targetPkg = packages.find(p => p.id === user.active_package_id);
        }
        if (!targetPkg && packages.length > 0) {
            targetPkg = packages[0];
        }
        if (!targetPkg && user.config_link) {
            targetPkg = {
                id: user.active_package_id || `pkg_${Date.now()}`,
                planId: planId || 'SPEED_PACK',
                planName: user.plan || planName || 'Subscription',
                configLink: user.config_link,
                subLink: user.sub_link || '',
                sni: user.sni || 'aka.ms',
                host: user.host || 'aka.ms',
                port: user.port || 443,
                target: user.target || 'sni',
                panelId: user.panel_id || 1,
                panelDomain: user.panel_domain || '',
                clientUuid: user.client_uuid || '',
                totalGb: chosenGb,
                expiryTime: (user.expiry_time && user.expiry_time <= Date.now() + 65 * 86400000) ? user.expiry_time : (Date.now() + 30 * 86400000),
                status: 'active'
            };
            packages.push(targetPkg);
        }

        if (targetPkg) {
            const currentExpiry = Number(targetPkg.expiryTime) || 0;
            const maxReasonableExpiry = Date.now() + 35 * 24 * 3600000;
            const extendFrom = (currentExpiry > Date.now() && currentExpiry <= maxReasonableExpiry) ? currentExpiry : Date.now();
            const newExpiry = extendFrom + (parseInt(days) || 30) * 24 * 3600000;
            
            // Accumulate GB: Add chosen GB to existing totalGb
            let newTotalGb = '100';
            let addGb = 100;
            if (chosenGb === 'Unlimited' || chosenGb === 'unlimited') {
                newTotalGb = 'Unlimited';
                addGb = 0;
            } else {
                const prevGb = parseInt(targetPkg.totalGb) || 0;
                addGb = parseInt(chosenGb) || 100;
                newTotalGb = String(prevGb + addGb);
            }
            
            targetPkg.expiryTime = newExpiry;
            targetPkg.totalGb = newTotalGb;
            targetPkg.status = 'active';
            
            // Look up clean plan name from packages DB if available
            let baseName = planName || targetPkg.planName;
            if (planId) {
                const pkgDocRef = doc(db, 'packages', planId);
                const pkgSnap = await getDoc(pkgDocRef);
                if (pkgSnap.exists()) {
                    baseName = pkgSnap.data().name || baseName;
                }
            }
            const cleanBase = (baseName || 'Package').replace(/\s*\(\d+\s*GB\)/i, '').replace(/\s*\(Unlimited(?:\s*GB)?\)/i, '').replace(/\s*-\s*Port\s*\d+/i, '').trim();
            targetPkg.planName = `${cleanBase} (${newTotalGb}${newTotalGb === 'Unlimited' ? '' : ' GB'}) - Port ${targetPkg.port || 443}`;
            
            // Non-blocking update to 3x-ui panel proxy client with new total GB (Both Panel 1 & Panel 2)
            update3xuiClientStats(targetPkg.panelId, targetPkg.clientUuid, { 
                totalGb: newTotalGb, 
                addGb: addGb,
                expiryTime: newExpiry,
                userEmail: user.email,
                clientEmail: targetPkg.clientEmail || targetPkg.email
            }).catch(e => console.warn('[Coin Renewal] 3x-ui update warning:', e.message));

            // Update in packages array
            const pkgIdx = packages.findIndex(p => p.id === targetPkg.id || (p.configLink && p.configLink === targetPkg.configLink));
            if (pkgIdx !== -1) {
                packages[pkgIdx] = targetPkg;
            } else {
                packages.push(targetPkg);
            }
            
            const userUpdates = {
                coins: (user.coins || 0) - cost,
                status: 'active',
                packages: packages
            };
            
            if (user.active_package_id === targetPkg.id || user.config_link === targetPkg.configLink || !user.active_package_id) {
                userUpdates.expiry_time = newExpiry;
                userUpdates.total_gb = newTotalGb;
                userUpdates.plan = targetPkg.planName;
                userUpdates.active_package_id = targetPkg.id;
            }
            await updateDoc(userDocRef, userUpdates);
            
            // Record renewal in slips for audit history
            const slipsCol = collection(db, 'slips');
            const slipData = {
                email,
                plan_id: targetPkg.planId || planId,
                package_id: targetPkg.id,
                price: 0.00,
                coin_cost: cost,
                payment_method: 'coins',
                slip_url: 'coins',
                status: 'approved',
                selected_gb: chosenGb,
                bonus_coins: 0,
                days: parseInt(days) || 30,
                is_renewal: true,
                config_link: targetPkg.configLink,
                sub_link: targetPkg.subLink,
                sni: targetPkg.sni,
                host: targetPkg.host,
                port: targetPkg.port,
                target: targetPkg.target,
                panel_id: targetPkg.panelId,
                panel_domain: targetPkg.panelDomain,
                client_uuid: targetPkg.clientUuid,
                created_at: Date.now()
            };
            const slipDocRef = await addDoc(slipsCol, slipData);
            await updateDoc(slipDocRef, { id: slipDocRef.id });
            
            return res.json({
                success: true,
                isRenewal: true,
                config: targetPkg.configLink,
                sni: targetPkg.sni,
                host: targetPkg.host,
                port: targetPkg.port,
                target: targetPkg.target,
                panelId: targetPkg.panelId,
                panelDomain: targetPkg.panelDomain
            });
        }
        
        // Fallback only if no existing package could be found anywhere
        const fallbackDays = parseInt(days) || 30;
        const newExpiry = Date.now() + fallbackDays * 24 * 3600000;
        
        const pkgDocRef = doc(db, 'packages', planId);
        const pkgSnap = await getDoc(pkgDocRef);
        let pkgBaseName = planId;
        if (pkgSnap.exists()) {
            pkgBaseName = pkgSnap.data().name || planId;
        }
        const cleanPlanName = pkgBaseName.replace(/_/g, ' ') + (chosenGb ? ` (${chosenGb} GB)` : '');
        
        let configResult = null;
        try {
            configResult = await create3xuiClient({
                email: email,
                planId: planId,
                planName: pkgBaseName,
                selectedGb: chosenGb,
                days: parseInt(days) || 30
            });
        } catch (genErr) {
            console.error('Error auto-generating config for coin renewal fallback:', genErr.message);
        }

        const newPkgId = `pkg_${Date.now()}`;
        const newPkg = {
            id: newPkgId,
            planId: planId,
            planName: `${cleanPlanName} - Port ${configResult?.port || 443}`,
            configLink: configResult?.configLink || '',
            subLink: configResult?.subLink || '',
            sni: configResult?.sni || 'aka.ms',
            host: configResult?.host || 'aka.ms',
            port: configResult?.port || 443,
            target: configResult?.target || 'sni',
            panelId: configResult?.panelId || 1,
            panelDomain: configResult?.panelDomain || '',
            clientUuid: configResult?.uuid || '',
            totalGb: chosenGb,
            expiryTime: newExpiry,
            status: 'active'
        };
        packages.unshift(newPkg);

        const userUpdates = {
            coins: (user.coins || 0) - cost,
            plan: cleanPlanName,
            status: 'active',
            expiry_time: newExpiry,
            active_package_id: newPkgId,
            packages: packages
        };
        if (configResult && configResult.configLink) {
            userUpdates.config_link = configResult.configLink;
            userUpdates.sub_link = configResult.subLink;
            userUpdates.sni = configResult.sni;
            userUpdates.host = configResult.host;
            userUpdates.port = configResult.port;
            userUpdates.target = configResult.target;
            userUpdates.panel_id = configResult.panelId;
            userUpdates.panel_domain = configResult.panelDomain;
            userUpdates.client_uuid = configResult.uuid;
            userUpdates.total_gb = chosenGb;
        }
        await updateDoc(userDocRef, userUpdates);
        
        const slipsCol = collection(db, 'slips');
        const slipData = {
            email,
            plan_id: planId,
            price: 0.00,
            coin_cost: cost,
            payment_method: 'coins',
            slip_url: 'coins',
            status: 'approved',
            selected_gb: chosenGb,
            bonus_coins: 0,
            days: parseInt(days) || 30,
            package_id: newPkgId,
            created_at: Date.now()
        };
        if (configResult && configResult.configLink) {
            slipData.config_link = configResult.configLink;
            slipData.sub_link = configResult.subLink;
            slipData.sni = configResult.sni;
            slipData.host = configResult.host;
            slipData.port = configResult.port;
            slipData.target = configResult.target;
            slipData.panel_id = configResult.panelId;
            slipData.panel_domain = configResult.panelDomain;
            slipData.client_uuid = configResult.uuid;
        }
        const slipDocRef = await addDoc(slipsCol, slipData);
        await updateDoc(slipDocRef, { id: slipDocRef.id });
        res.json({
            success: true,
            config: configResult ? configResult.configLink : null,
            sni: configResult ? configResult.sni : null,
            host: configResult ? configResult.host : null,
            port: configResult ? configResult.port : null,
            target: configResult ? configResult.target : null,
            panelId: configResult ? configResult.panelId : 1,
            panelDomain: configResult ? configResult.panelDomain : null
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// Helper to retrieve client traffic stats across 3x-ui panels
async function getClientTrafficStats(email, preferredPanelId = 1, clientUuid = '', forceFresh = false) {
    const cacheKey = `${(email || '').toLowerCase()}_${preferredPanelId}_${clientUuid || ''}`;
    if (!forceFresh && cacheKey && clientTrafficCache[cacheKey] && Date.now() < clientTrafficCache[cacheKey].expiry) {
        return clientTrafficCache[cacheKey].stats;
    }

    const panel = getPanelById(preferredPanelId);
    const panelsToTry = panel ? [panel] : getPanels();

    for (const p of panelsToTry) {
        if (!p || !p.url) continue;
        try {
            const session = await getPanelSession(p);
            const cleanUrl = getPanelBaseUrl(p);

            // 1. Fetch inbounds/list which has up-to-date clientStats array (up, down, total, expiryTime)
            const inbRes = await axios.get(`${cleanUrl}/panel/api/inbounds/list`, {
                headers: {
                    'Host': p.domain,
                    'Cookie': session.cookie,
                    'x-csrf-token': session.csrf,
                    'Referer': `${cleanUrl}/panel/`
                },
                httpsAgent: httpsAgent,
                timeout: 8000
            });

            if (inbRes.data && inbRes.data.success && Array.isArray(inbRes.data.obj)) {
                for (const inb of inbRes.data.obj) {
                    if (Array.isArray(inb.clientStats)) {
                        // Priority 1: Match by Client UUID if provided
                        let found = null;
                        if (clientUuid) {
                            found = inb.clientStats.find(s => (s.uuid && s.uuid === clientUuid) || (s.id === clientUuid));
                        }
                        // Priority 2: Fallback to email match
                        if (!found && email) {
                            found = inb.clientStats.find(s => s.email && s.email.toLowerCase() === email.toLowerCase());
                        }

                        if (found) {
                            const result = {
                                up: found.up || 0,
                                down: found.down || 0,
                                total: found.total || 0,
                                expiryTime: found.expiryTime || 0,
                                enable: found.enable !== false,
                                panelId: p.id,
                                panelDomain: p.domain,
                                panelName: p.name
                            };
                            if (cacheKey) {
                                clientTrafficCache[cacheKey] = { stats: result, expiry: Date.now() + 15000 };
                            }
                            return result;
                        }
                    }
                }
            }
        } catch (err) {
            console.warn(`[3x-ui] Stats query on Panel ${p.id} for ${email}:`, err.message);
        }
    }
    return null;
}

// Get user bandwidth stats from assigned 3x-ui Panel proxy
app.get('/api/user/usage', authenticateToken, async (req, res) => {
    const email = req.user.email;
    const requestedPackageId = req.query.packageId;
    const forceFresh = req.query.fresh === 'true';
    
    // Check user data in DB
    let user = null;
    try {
        if (useFirebase || useLocalDb) {
            const userDocRef = doc(db, 'users', email);
            const userSnap = await getDoc(userDocRef);
            if (userSnap && userSnap.exists()) {
                user = userSnap.data();
            }
        }
    } catch (dbErr) {
        console.warn('Error reading user for usage:', dbErr.message);
    }

    // Resolve target package from user's packages
    let targetPackage = null;
    try {
        const userPackages = await getUserPackagesList(email, user);
        if (requestedPackageId) {
            targetPackage = userPackages.find(p => p.id === requestedPackageId || p.planId === requestedPackageId);
        }
        if (!targetPackage && user && user.active_package_id) {
            targetPackage = userPackages.find(p => p.id === user.active_package_id);
        }
        if (!targetPackage && userPackages.length > 0) {
            targetPackage = userPackages[0];
        }
    } catch (_) {}

    const isActive = user && user.status === 'active' && ((user.plan && user.plan !== 'None') || targetPackage);
    const userPanelId = targetPackage ? (parseInt(targetPackage.panelId) || 1) : (user && user.panel_id ? parseInt(user.panel_id) : 1);
    const clientUuid = targetPackage ? (targetPackage.clientUuid || '') : (user && user.client_uuid ? user.client_uuid : '');
    const panel = getPanelById(userPanelId);

    const planName = targetPackage ? (targetPackage.planName || '') : (user && user.plan ? user.plan : '');
    let totalGbStr = targetPackage ? (targetPackage.totalGb || '') : (user && user.total_gb ? user.total_gb : '');
    if (!totalGbStr) {
        totalGbStr = planName.toLowerCase().includes('unlimited') ? 'Unlimited' : '100';
    }
    const isPlanUnlimited = (totalGbStr && totalGbStr.toLowerCase() === 'unlimited') || 
                            planName.toLowerCase().includes('unlimited') ||
                            (user && user.total_gb && String(user.total_gb).toLowerCase() === 'unlimited');
    const totalBytesLimit = isPlanUnlimited ? 0 : (parseInt(totalGbStr) || 100) * 1073741824;

    if (!isActive && !user.config_link && !targetPackage) {
        return res.status(404).json({ success: false, message: 'No active subscription found.' });
    }

    try {
        let clientTraffic = await getClientTrafficStats(email, userPanelId, clientUuid, forceFresh);

        // Determine config link and payload attributes for the chosen package
        let configLink = targetPackage ? (targetPackage.configLink || '') : (user && user.config_link ? user.config_link : '');
        let subLink = targetPackage ? (targetPackage.subLink || '') : (user && user.sub_link ? user.sub_link : '');
        let sni = targetPackage ? (targetPackage.sni || '') : (user && user.sni ? user.sni : '');
        let host = targetPackage ? (targetPackage.host || '') : (user && user.host ? user.host : '');
        let port = targetPackage ? (targetPackage.port || 443) : (user && user.port ? user.port : 443);
        let target = targetPackage ? (targetPackage.target || 'sni') : (user && user.target ? user.target : 'sni');
        let plan = targetPackage ? (targetPackage.planName || '') : (user && user.plan ? user.plan : '');
        let expiryTime = targetPackage ? (targetPackage.expiryTime || 0) : (user && user.expiry_time ? Number(user.expiry_time) : 0);

        // If active in DB but no config generated yet, auto generate now on assigned panel!
        if (isActive && !configLink) {
            try {
                const autoClient = await create3xuiClient({
                    email: email,
                    planId: plan || user.plan,
                    planName: plan || user.plan,
                    selectedGb: totalGbStr,
                    days: 30,
                    panelId: userPanelId
                });
                configLink = autoClient.configLink;
                subLink = autoClient.subLink;
                sni = autoClient.sni;
                host = autoClient.host;
                port = autoClient.port;
                target = autoClient.target;

                if (useFirebase || useLocalDb) {
                    const userDocRef = doc(db, 'users', email);
                    await updateDoc(userDocRef, {
                        config_link: configLink,
                        sub_link: subLink,
                        sni: sni,
                        host: host,
                        port: port,
                        target: target,
                        panel_id: autoClient.panelId,
                        panel_domain: autoClient.panelDomain,
                        client_uuid: autoClient.uuid
                    });
                }
                clientTraffic = await getClientTrafficStats(email, autoClient.panelId, autoClient.uuid, true);
            } catch (autoErr) {
                console.error('Auto config generation on usage check failed:', autoErr.message);
            }
        }

        if (!configLink && !clientTraffic) {
            return res.status(404).json({ success: false, message: 'No active subscription found.' });
        }

        const effectivePanelId = clientTraffic ? clientTraffic.panelId : panel.id;
        const effectivePanelDomain = clientTraffic ? clientTraffic.panelDomain : panel.domain;
        const effectivePanelName = clientTraffic ? clientTraffic.panelName : panel.name;

        const isTrafficUnlimited = isPlanUnlimited || (clientTraffic && clientTraffic.total === 0);
        const finalTotalBytes = isTrafficUnlimited ? 0 : (totalBytesLimit > 0 ? totalBytesLimit : (clientTraffic && clientTraffic.total ? clientTraffic.total : 107374182400));

        res.json({
            success: true,
            source: clientTraffic ? 'x-ui' : 'db-cache',
            data: {
                email: email,
                up: clientTraffic ? (clientTraffic.up || 0) : 0,
                down: clientTraffic ? (clientTraffic.down || 0) : 0,
                total: finalTotalBytes,
                isUnlimited: isTrafficUnlimited,
                totalGb: isTrafficUnlimited ? 'Unlimited' : (totalGbStr || '100'),
                expiryTime: clientTraffic && clientTraffic.expiryTime ? clientTraffic.expiryTime : expiryTime,
                configLink: configLink,
                subLink: subLink,
                sni: sni,
                host: host,
                port: port,
                target: target,
                panelId: effectivePanelId,
                panelDomain: effectivePanelDomain,
                panelName: effectivePanelName,
                plan: plan
            }
        });

    } catch (error) {
        console.error('Error fetching usage stats:', error.message);
        if (user && user.config_link) {
            const isUserUnlimited = isPlanUnlimited || 
                                    (user.total_gb && String(user.total_gb).toLowerCase() === 'unlimited') ||
                                    (user.plan && user.plan.toLowerCase().includes('unlimited'));
            return res.json({
                success: true,
                source: 'db-cache',
                data: {
                    email: email,
                    up: 0,
                    down: 0,
                    total: isUserUnlimited ? 0 : ((user.total_gb && String(user.total_gb).toLowerCase() !== 'unlimited') ? (parseInt(user.total_gb) || 100) * 1073741824 : 107374182400),
                    isUnlimited: isUserUnlimited,
                    totalGb: isUserUnlimited ? 'Unlimited' : (user.total_gb || '100'),
                    expiryTime: Number(user.expiry_time || 0),
                    configLink: user.config_link,
                    subLink: user.sub_link || '',
                    sni: user.sni || '',
                    host: user.host || '',
                    port: user.port || 443,
                    target: user.target || 'sni',
                    panelId: panel.id,
                    panelDomain: panel.domain,
                    panelName: panel.name,
                    plan: plan || user.plan
                }
            });
        }
        res.status(500).json({ success: false, message: 'Failed to retrieve usage stats.' });
    }
});

// Public usage check endpoint (supports subLink, email, UUID)
app.get('/api/public/usage', async (req, res) => {
    try {
        const query = (req.query.query || '').trim();
        if (!query) {
            return res.status(400).json({ success: false, message: 'Query parameter required' });
        }

        let email = '';
        let clientUuid = '';
        let targetUser = null;

        // Search DB users
        if (useLocalDb && localDb && localDb.users) {
            for (const u of Object.values(localDb.users)) {
                if (
                    (u.email && u.email.toLowerCase() === query.toLowerCase()) ||
                    (u.sub_link && (u.sub_link.includes(query) || query.includes(u.sub_link))) ||
                    (u.client_uuid && u.client_uuid === query) ||
                    (u.config_link && (u.config_link.includes(query) || query.includes(u.config_link)))
                ) {
                    targetUser = u;
                    email = u.email;
                    clientUuid = u.client_uuid || '';
                    break;
                }
            }
        }

        if (!email) {
            if (query.includes('@')) {
                email = query;
            } else if (query.includes('/sub/')) {
                const subId = query.split('/sub/')[1].split('?')[0].split('/')[0].trim();
                if (useLocalDb && localDb && localDb.users) {
                    for (const u of Object.values(localDb.users)) {
                        if (u.sub_link && u.sub_link.includes(subId)) {
                            targetUser = u;
                            email = u.email;
                            clientUuid = u.client_uuid || '';
                            break;
                        }
                    }
                }
            }
        }

        const preferredPanelId = targetUser && targetUser.panel_id ? parseInt(targetUser.panel_id) : 1;
        const stats = await getClientTrafficStats(email, preferredPanelId, clientUuid);

        if (!stats && !targetUser) {
            return res.status(404).json({ success: false, message: 'No client or usage record found for query.' });
        }

        const defaultPanel = getPanelById(preferredPanelId);
        const targetPlan = (targetUser && targetUser.plan ? targetUser.plan : '');
        const isPublicUnlimited = (targetUser && (targetUser.total_gb && String(targetUser.total_gb).toLowerCase() === 'unlimited')) ||
                                  targetPlan.toLowerCase().includes('unlimited') ||
                                  (stats && stats.total === 0);
        const publicTotalBytes = isPublicUnlimited ? 0 : (stats && stats.total ? stats.total : (targetUser && targetUser.total_gb && String(targetUser.total_gb).toLowerCase() !== 'unlimited' ? (parseInt(targetUser.total_gb) || 100) * 1073741824 : 107374182400));

        return res.json({
            success: true,
            source: stats ? 'x-ui' : 'db-cache',
            data: {
                email: email || (targetUser ? targetUser.email : 'User'),
                up: stats ? stats.up : 0,
                down: stats ? stats.down : 0,
                total: publicTotalBytes,
                isUnlimited: isPublicUnlimited,
                totalGb: isPublicUnlimited ? 'Unlimited' : (targetUser && targetUser.total_gb ? targetUser.total_gb : '100'),
                expiryTime: stats && stats.expiryTime ? stats.expiryTime : (targetUser && targetUser.expiry_time ? Number(targetUser.expiry_time) : 0),
                configLink: targetUser && targetUser.config_link ? targetUser.config_link : '',
                subLink: targetUser && targetUser.sub_link ? targetUser.sub_link : '',
                sni: targetUser && targetUser.sni ? targetUser.sni : '',
                host: targetUser && targetUser.host ? targetUser.host : '',
                port: targetUser && targetUser.port ? targetUser.port : 443,
                target: targetUser && targetUser.target ? targetUser.target : 'sni',
                panelId: stats ? stats.panelId : (targetUser ? targetUser.panel_id : defaultPanel.id),
                panelDomain: stats ? stats.panelDomain : defaultPanel.domain,
                panelName: stats ? stats.panelName : defaultPanel.name,
                plan: targetPlan
            }
        });
    } catch (err) {
        console.error('Error in /api/public/usage:', err.message);
        res.status(500).json({ success: false, message: 'Failed to retrieve usage stats.' });
    }
});

// Endpoint: User on-demand config generation / re-sync
app.post('/api/user/generate-config', authenticateToken, async (req, res) => {
    const email = req.user.email;
    try {
        if ((!useFirebase && !useLocalDb)) return res.status(400).json({ success: false, message: 'Database offline.' });
        const userDocRef = doc(db, 'users', email);
        const userSnap = await getDoc(userDocRef);
        if (!userSnap.exists()) return res.status(404).json({ success: false, message: 'User not found.' });

        const user = userSnap.data();
        if (user.status !== 'active' || !user.plan || user.plan === 'None') {
            return res.status(400).json({ success: false, message: 'You need an active package before generating a config.' });
        }

        const planId = req.body.planId || user.plan;
        const selectedGb = req.body.selectedGb || user.total_gb || '100';
        const days = req.body.days || 30;

        const configResult = await create3xuiClient({
            email,
            planId,
            planName: user.plan,
            selectedGb,
            days
        });

        await updateDoc(userDocRef, {
            config_link: configResult.configLink,
            sub_link: configResult.subLink,
            sni: configResult.sni,
            host: configResult.host,
            port: configResult.port,
            target: configResult.target,
            panel_id: configResult.panelId,
            panel_domain: configResult.panelDomain,
            client_uuid: configResult.uuid,
            total_gb: selectedGb
        });

        res.json({
            success: true,
            message: `Configuration auto-generated on ${configResult.panelName}!`,
            config: configResult.configLink,
            subLink: configResult.subLink,
            sni: configResult.sni,
            host: configResult.host,
            port: configResult.port,
            target: configResult.target,
            panelId: configResult.panelId,
            panelDomain: configResult.panelDomain,
            panelName: configResult.panelName,
            uuid: configResult.uuid
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// Endpoint: Admin on-demand config generation
app.post('/api/admin/generate-config', authenticateToken, async (req, res) => {
    if (req.user.role !== 'admin') return res.status(403).json({ success: false, message: 'Admin access required.' });
    const { email, planId, selectedGb = '100', days = 30, customSni, panelId } = req.body;
    if (!email) return res.status(400).json({ success: false, message: 'Email identifier is required.' });

    try {
        const configResult = await create3xuiClient({
            email,
            planId: planId || 'CUSTOM',
            planName: planId || 'Custom Admin Pack',
            selectedGb,
            days,
            panelId: panelId ? parseInt(panelId) : null
        });

        if (customSni) {
            configResult.sni = customSni;
            configResult.configLink = configResult.configLink.replace(/sni=[^&#]+/, `sni=${encodeURIComponent(customSni)}`);
        }

        if (useFirebase || useLocalDb) {
            const userDocRef = doc(db, 'users', email);
            const userSnap = await getDoc(userDocRef);
            if (userSnap.exists()) {
                await updateDoc(userDocRef, {
                    config_link: configResult.configLink,
                    sub_link: configResult.subLink,
                    sni: configResult.sni,
                    host: configResult.host,
                    port: configResult.port,
                    target: configResult.target,
                    panel_id: configResult.panelId,
                    panel_domain: configResult.panelDomain,
                    client_uuid: configResult.uuid
                });
            }
        }

        res.json({
            success: true,
            message: `Config generated on ${configResult.panelName}!`,
            config: configResult.configLink,
            subLink: configResult.subLink,
            sni: configResult.sni,
            host: configResult.host,
            port: configResult.port,
            target: configResult.target,
            panelId: configResult.panelId,
            panelDomain: configResult.panelDomain,
            panelName: configResult.panelName,
            uuid: configResult.uuid
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});


// Health check endpoint for monitoring & reverse-proxy testing
app.get('/api/health', (req, res) => {
    res.json({ 
        status: 'ok', 
        time: Date.now(), 
        uptime: process.uptime(),
        database: useLocalDb ? 'local' : (useFirebase ? 'firebase' : 'none')
    });
});

// Global unhandled error handler so no exception hangs requests
app.use((err, req, res, next) => {
    console.error('[Express Error]', err);
    if (!res.headersSent) {
        res.status(500).json({ success: false, message: 'Internal Server Error' });
    }
});

// Catch-all route to redirect undefined files to index.html
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// Start listening immediately so port 3000 is open in <1ms for Nginx reverse proxy
app.listen(PORT, '0.0.0.0', () => {
    console.log(`=========================================`);
    console.log(`🚀 Tunnel Forde LK backend server running`);
    console.log(`📍 Port: ${PORT}`);
    console.log(`💻 Environment: ${process.env.NODE_ENV || 'development'}`);
    console.log(`=========================================`);

    // Connect to database in the background without blocking server startup
    connectDb().then(() => {
        console.log('✓ Database initialization finished.');
    }).catch(err => {
        console.error('CRITICAL: Database connection error:', err.message);
    });

    startTelegramBotPolling();
    
    // Automated Telegram Daily Database Backup Scheduler
    initDailyBackupScheduler();
    
    // Automatic 30-day slip storage cleanup (runs on startup, then every 24 hours)
    cleanupOldSlips().catch(err => console.warn('[Cleanup] Initial cleanup warning:', err.message));
    setInterval(() => {
        cleanupOldSlips().catch(err => console.warn('[Cleanup] Periodic cleanup warning:', err.message));
    }, 24 * 60 * 60 * 1000);
});
