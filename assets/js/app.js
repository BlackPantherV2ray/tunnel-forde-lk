// ==========================================================================
// Tunnel Forde LK - App JS Client Controller
// ==========================================================================

// Global Application State
let isLoggedIn = false;
let currentUserDetails = null;
let currentUserDocData = null; // Stored user document data
let currentUserCoins = 0;
let currentUserRole = 'user';
let currentUserStatus = 'inactive';
let userUnlockedConfigs = [];
let jwtToken = '';
let currentActiveTab = 'dashboard';
let userFirestoreListener = null;
let isAdminUnlocked = false;

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

const isSystemAdminUser = isSystemAdminEmail;

// Global Chat, Subscription Link, and Renewal States
let guestChats = [
    {
        userEmail: 'ambepitiyaw@gmail.com',
        userName: 'Ambepitiya W',
        userPicture: '',
        sender: 'user',
        text: 'Hello admin, I bought Dialog Router Zoom. When does my package expire?',
        timestamp: Date.now() - 18 * 60 * 1000,
        read: true
    },
    {
        userEmail: 'ambepitiyaw@gmail.com',
        userName: 'Ambepitiya W',
        userPicture: '',
        sender: 'admin',
        text: 'Hello! Your package is active and expires on 11/10/2026. Let us know if you need any config help!',
        timestamp: Date.now() - 12 * 60 * 1000,
        read: true
    },
    {
        userEmail: 'anonyteclk@gmail.com',
        userName: 'Anony Tec LK',
        userPicture: '',
        sender: 'user',
        text: 'Airtel Zoom is working very fast! Thank you!',
        timestamp: Date.now() - 5 * 60 * 1000,
        read: false
    }
];
let adminActiveChatUser = 'ambepitiyaw@gmail.com';
let adminChatMessagesListener = null;
let adminAllChatsListener = null;
let allChatsList = [];
let guestSubLink = '';
let renewPlanId = '';
let renewPlanPrice = 0;
let renewCoinCost = 0;
let renewTargetPackage = null;
let renewSelectedGb = '100';
let renewBonusCoins = 10;

// Global Polling Intervals
let userProfileInterval = null;
let userSlipsInterval = null;
let activeChatInterval = null;
let adminChatThreadsInterval = null;
let adminSlipsInterval = null;
let adminClientsInterval = null;
let packagesInterval = null;
let globalUnreadChatInterval = null;

// Global Api Fetch helper
async function apiFetch(url, options = {}) {
    const headers = options.headers || {};
    if (jwtToken) {
        headers['Authorization'] = `Bearer ${jwtToken}`;
    }
    if (!(options.body instanceof FormData) && !headers['Content-Type']) {
        headers['Content-Type'] = 'application/json';
    }
    
    const controller = new AbortController();
    const timeoutDuration = options.timeout || 15000;
    const timeoutId = setTimeout(() => controller.abort(), timeoutDuration);

    try {
        const res = await fetch(url, {
            ...options,
            headers,
            signal: options.signal || controller.signal
        });
        clearTimeout(timeoutId);
        
        if (res.status === 401 || res.status === 403) {
            handleLogout();
            showNotification('Your session has expired. Please log in again.', 'error');
            throw new Error('Session expired');
        }
        
        return res;
    } catch (err) {
        clearTimeout(timeoutId);
        if (err.name === 'AbortError') {
            throw new Error('Server request timed out after 15s.');
        }
        throw err;
    }
}

// Guest Preview Sandbox States
let isGuestMode = false;
window.allConfigsList = [];
let guestConfigs = [
    { id: 'g1', title: 'Airtel YouTube Premium Bypass', isp: 'Airtel', config: 'vless://airtel-youtube-guest-unlocked-uuid@127.0.0.1:443?security=tls#TunnelForde-AirtelYoutube', coinCost: 50, price: 100.00 },
    { id: 'g2', title: 'Dialog Zoom VIP Line', isp: 'Dialog', config: 'vless://dialog-zoom-guest-unlocked-uuid@127.0.0.1:443?security=tls#TunnelForde-DialogZoom', coinCost: 100, price: 150.00 },
    { id: 'g3', title: 'Hutch Social Pack Free', isp: 'Hutch', config: 'vless://hutch-social-guest-unlocked-uuid@127.0.0.1:443?security=tls#TunnelForde-HutchFree', coinCost: 0, price: 0.00 }
];
let guestSlips = [
    { id: 'gs1', email: 'yasindu.lakshan@gmail.com', planId: 'DIALOG_ROUTER_ZOOM_S72', price: 750.00, slipUrl: 'https://upload.wikimedia.org/wikipedia/commons/e/ea/Placeholder_no_image.svg', status: 'pending', created_at: new Date() },
    { id: 'gs2', email: 'perera.test@gmail.com', planId: 'AIRTEL_TIKTOK_S70', price: 300.00, slipUrl: 'https://upload.wikimedia.org/wikipedia/commons/e/ea/Placeholder_no_image.svg', status: 'pending', created_at: new Date(Date.now() - 3600000) }
];
let guestUserSlips = [
    { planId: 'AIRTEL_ZOOM_SUPER_S75', price: 500.00, slipUrl: 'https://upload.wikimedia.org/wikipedia/commons/e/ea/Placeholder_no_image.svg', status: 'approved', created_at: new Date(Date.now() - 86400000) },
    { planId: 'DIALOG_ROUTER_ZOOM_S72', price: 750.00, slipUrl: 'https://upload.wikimedia.org/wikipedia/commons/e/ea/Placeholder_no_image.svg', status: 'pending', created_at: new Date(Date.now() - 3600000) },
    { planId: 'AIRTEL_TIKTOK_S70', price: 300.00, slipUrl: 'https://upload.wikimedia.org/wikipedia/commons/e/ea/Placeholder_no_image.svg', status: 'rejected', created_at: new Date(Date.now() - 172800000) }
];
let guestClients = [
    { email: 'yasindulakshan2006@gmail.com', name: 'Yasindu Lakshan', picture: '', role: 'admin', status: 'active', plan: 'Dialog 1118 (Unlimited GB)', coins: 105, expiryTime: Date.now() + 90 * 24 * 60 * 60 * 1000 },
    { email: 'ambepitiyaw@gmail.com', name: 'Ambepitiya W', picture: '', role: 'user', status: 'active', plan: 'Dialog Router Zoom (Unlimited GB) - Port 443', coins: 35, expiryTime: Date.now() + 30 * 24 * 60 * 60 * 1000 },
    { email: 'anonyteclk@gmail.com', name: 'Anony Tec LK', picture: '', role: 'user', status: 'active', plan: 'Airtel Zoom (100 GB) - Port 8080', coins: 30, expiryTime: Date.now() + 60 * 24 * 60 * 60 * 1000 }
];

// Packages Specification List (representing Airtel/Dialog layouts in screenshots)
let availablePackages = [
    // Category: Speed Packages
    { id: 'HUTCH_ZOOM', name: 'Hutch Zoom', network: 'Hutch', host: 'Support.zoom.us', port: 8080, target: 'address', price: 200.00, limitGB: 100, days: 30, desc: 'Hutch Zoom Pack (Port 8080)', promo: '⚡ Port 8080', server: 'PREMIUM SERVER 70', remaining: 28962, bonusCoins: 10, coinCost: 100, badge: null, category: 'speed' },
    { id: 'MOBITEL_ZOOM', name: 'Mobitel Zoom', network: 'Mobitel', host: '104.17.70.206', port: 8443, target: 'address', price: 200.00, limitGB: 100, days: 30, desc: 'Mobitel Zoom High-speed Bypass (Port 8443)', promo: '⚡ Port 8443', server: 'PREMIUM SERVER 70', remaining: 28962, bonusCoins: 10, coinCost: 100, badge: null, category: 'speed' },
    { id: 'AIRTEL_ZOOM', name: 'Airtel Zoom', network: 'Airtel', host: 'Support.zoom.us', port: 8080, target: 'address', price: 200.00, limitGB: 100, days: 30, desc: 'Airtel Zoom Pack (Port 8080)', promo: '⚡ Port 8080', server: 'PREMIUM SERVER 70', remaining: 28962, bonusCoins: 10, coinCost: 100, badge: null, category: 'speed' },
    { id: 'DIALOG_ROUTER_ZOOM', name: 'Dialog Router Zoom', network: 'Dialog', host: 'aka.ms', port: 443, target: 'sni', price: 200.00, limitGB: 100, days: 30, desc: 'High-speed Router Zoom Package', promo: '', server: 'PREMIUM SERVER 72', remaining: 9224, bonusCoins: 10, coinCost: 100, badge: null, category: 'speed' },
    { id: 'DIALOG_TIKTOK', name: 'Dialog TikTok', network: 'Dialog', host: 'www.tiktok.com', port: 443, target: 'sni', price: 200.00, limitGB: 100, days: 30, desc: 'Dialog TikTok High-speed Pack', promo: 'Special Offer!', server: 'PREMIUM SERVER 72', remaining: 9224, bonusCoins: 10, coinCost: 100, badge: null, category: 'speed' },
    { id: 'SLT_ZOOM', name: 'SLT Zoom', network: 'Other', host: 'zoom.us', port: 443, target: 'sni', price: 200.00, limitGB: 100, days: 30, desc: 'SLT Fiber/4G Zoom', promo: '', server: 'PREMIUM SERVER 75', remaining: 3487, bonusCoins: 10, coinCost: 100, badge: null, category: 'speed' },
    { id: 'SLT_NETFLIX', name: 'SLT Netflix', network: 'Other', host: 'netflix.com', port: 443, target: 'sni', price: 200.00, limitGB: 100, days: 30, desc: 'SLT Fiber Netflix Bypass', promo: '', server: 'PREMIUM SERVER 72', remaining: 9224, bonusCoins: 10, coinCost: 100, badge: null, category: 'speed' },
    { id: 'AIRTEL_TIKTOK', name: 'Airtel TikTok', network: 'Airtel', host: 'www.tiktok.com', port: 443, target: 'sni', price: 200.00, limitGB: 100, days: 30, desc: 'Airtel TikTok Package', promo: 'Special Offer!', server: 'PREMIUM SERVER 72', remaining: 9224, bonusCoins: 10, coinCost: 100, badge: null, category: 'speed' },
    { id: 'AIRTEL_YOUTUBE', name: 'Airtel YouTube', network: 'Airtel', host: 'm.youtube.com', port: 443, target: 'sni', price: 200.00, limitGB: 100, days: 30, desc: 'Airtel YouTube High-speed', promo: '', server: 'PREMIUM SERVER 70', remaining: 28962, bonusCoins: 10, coinCost: 100, badge: null, category: 'speed' },
    { id: 'DIALOG_348', name: 'Dialog 348', network: 'Dialog', host: 'aka.ms', port: 443, target: 'sni', price: 200.00, limitGB: 100, days: 30, desc: 'Dialog 348 Pack', promo: '', server: 'PREMIUM SERVER 70', remaining: 28962, bonusCoins: 10, coinCost: 100, badge: null, category: 'speed' },
    { id: 'DIALOG_1118', name: 'Dialog 1118', network: 'Dialog', host: 'aka.ms', port: 443, target: 'sni', price: 200.00, limitGB: 100, days: 30, desc: 'Dialog 1118 Work & Learn', promo: 'Recommended!', server: 'PREMIUM SERVER 72', remaining: 9224, bonusCoins: 10, coinCost: 100, badge: null, category: 'speed' },
    
    // Category: Speed Limit Packages
    { id: 'HUTCH_SOCIAL', name: 'Hutch Social', network: 'Hutch', host: 'static-web.likeevideo.com', port: 443, target: 'sni', price: 200.00, limitGB: 100, days: 30, desc: 'Hutch Social Unlimited', promo: '', server: 'PREMIUM SERVER 70', remaining: 28962, bonusCoins: 10, coinCost: 100, badge: null, category: 'speed_limit' },
    { id: 'HUTCH_TIKTOK', name: 'Hutch TikTok', network: 'Hutch', host: 'www.tiktok.com', port: 443, target: 'sni', price: 200.00, limitGB: 100, days: 30, desc: 'Hutch TikTok Unlimited', promo: '', server: 'PREMIUM SERVER 70', remaining: 28962, bonusCoins: 10, coinCost: 100, badge: null, category: 'speed_limit' },
    { id: 'DIALOG_SOCIAL', name: 'Dialog Social', network: 'Dialog', host: 'web.whatsapp.com', port: 443, target: 'sni', price: 200.00, limitGB: 100, days: 30, desc: 'Dialog Social Unlimited Bypass', promo: '', server: 'PREMIUM SERVER 70', remaining: 28962, bonusCoins: 10, coinCost: 100, badge: null, category: 'speed_limit' },
    { id: 'AIRTEL_SOCIAL', name: 'Airtel Social', network: 'Airtel', host: 'www.googleapis.cn', port: 443, target: 'sni', price: 200.00, limitGB: 100, days: 30, desc: 'Airtel Social Pack', promo: '', server: 'PREMIUM SERVER 70', remaining: 28962, bonusCoins: 10, coinCost: 100, badge: null, category: 'speed_limit' },
    { id: 'DIALOG_YOUTUBE', name: 'Dialog Youtube', network: 'Dialog', host: 'm.youtube.com', port: 443, target: 'sni', price: 200.00, limitGB: 100, days: 30, desc: 'Dialog Youtube Pack', promo: '', server: 'PREMIUM SERVER 70', remaining: 28962, bonusCoins: 10, coinCost: 100, badge: null, category: 'speed_limit' },
    { id: 'DIALOG_SIM_ZOOM', name: 'Dialog Sim Zoom', network: 'Dialog', host: 'aka.ms', port: 443, target: 'sni', price: 200.00, limitGB: 100, days: 30, desc: 'Dialog Zoom Non-Router', promo: '', server: 'PREMIUM SERVER 70', remaining: 28962, bonusCoins: 10, coinCost: 100, badge: null, category: 'speed_limit' },
    { id: 'AIRTEL_260', name: 'Airtel 260', network: 'Airtel', host: 'www.googleapis.cn', port: 443, target: 'sni', price: 200.00, limitGB: 100, days: 30, desc: 'Airtel 260 Special SIM', promo: '', server: 'PREMIUM SERVER 70', remaining: 28962, bonusCoins: 10, coinCost: 100, badge: null, category: 'speed_limit' },
    { id: 'AIRTEL_135', name: 'Airtel 135', network: 'Airtel', host: 'www.googleapis.cn', port: 443, target: 'sni', price: 200.00, limitGB: 100, days: 30, desc: 'Airtel 135 Social Pack', promo: '', server: 'PREMIUM SERVER 75', remaining: 3487, bonusCoins: 10, coinCost: 100, badge: null, category: 'speed_limit' },
    { id: 'MOBITEL_SOCIAL', name: 'Mobitel Social', network: 'Mobitel', host: 'web.whatsapp.com', port: 443, target: 'sni', price: 200.00, limitGB: 100, days: 30, desc: 'Mobitel Social Unlimited', promo: '', server: 'PREMIUM SERVER 70', remaining: 28962, bonusCoins: 10, coinCost: 100, badge: null, category: 'speed_limit' }
];

// Helper: Show/Hide Loader
function showLoader(show) {
    const loader = document.getElementById('loadingOverlay');
    if (loader) {
        loader.style.opacity = show ? '1' : '0';
        loader.style.pointerEvents = show ? 'all' : 'none';
    }
}

// ----------------------------------------------------
// INITIALIZATION ON DOM READY (BLAZING FAST STARTUP)
// ----------------------------------------------------
let isAppInitialized = false;

function initApp() {
    if (isAppInitialized) return;
    isAppInitialized = true;

    // Ensure loader is hidden so cached interface is instantly usable
    showLoader(false);

    // Check for referral code in URL parameters (?ref=TF-XXXX)
    try {
        const urlParams = new URLSearchParams(window.location.search);
        const refParam = urlParams.get('ref') || urlParams.get('referral');
        if (refParam && refParam.trim()) {
            localStorage.setItem('tf_referral_code', refParam.trim().toUpperCase());
        }
    } catch (e) {
        console.warn('Referral param parse error:', e);
    }

    // Check local storage for existing session
    const storedToken = localStorage.getItem('jwt_token');
    const storedUser = localStorage.getItem('user_details');
    
    if (storedToken && storedUser) {
        jwtToken = storedToken;
        try {
            currentUserDetails = JSON.parse(storedUser);
        } catch (e) {
            currentUserDetails = null;
        }
    }

    if (jwtToken && currentUserDetails) {
        isLoggedIn = true;
        
        const userEmail = currentUserDetails?.email || '';
        const isAdmin = isSystemAdminEmail(userEmail) || currentUserDetails.role === 'admin';
        if (isAdmin) {
            currentUserDetails.role = 'admin';
            isAdminUnlocked = true;
            currentUserRole = 'admin';
            const adminNav = document.getElementById('adminTabNav');
            if (adminNav) adminNav.style.display = 'block';
        } else {
            isAdminUnlocked = false;
            currentUserRole = 'user';
            const adminNav = document.getElementById('adminTabNav');
            if (adminNav) adminNav.style.display = 'none';
        }
        
        // Show app wrapper and load details immediately
        const loginCard = document.getElementById('loginCard');
        const appCard = document.getElementById('appCard');
        if (loginCard) loginCard.style.display = 'none';
        if (appCard) appCard.style.display = 'flex';
        
        // Greet user & render avatar / profile card immediately
        updateUserProfileUI(currentUserDetails);

        currentUserCoins = currentUserDetails.coins || 0;
        const startupCoinsEl = document.getElementById('userCoinsBalance');
        if (startupCoinsEl) {
            startupCoinsEl.textContent = `${Math.floor(currentUserCoins)} Coins`;
        }

        if (currentUserDetails.referral_code) {
            const linkInput = document.getElementById('dashboardReferralLinkInput');
            if (linkInput) {
                linkInput.value = `${window.location.origin}/?ref=${currentUserDetails.referral_code}`;
            }
        }

        // Render package cards immediately so dashboard is ready instantly
        renderPackages();
        
        // Dismiss loader immediately so user sees dashboard without delay
        showLoader(false);

        // Background sync: Priority 1 (Profile & Packages)
        startUserProfilePolling();
        initPackagesListener();

        // Background sync: Priority 2 (Slips, Chat, Referral - staggered slightly to keep connections free)
        setTimeout(() => {
            loadReferralData();
            startUserSlipsPolling();
            startGlobalChatUnreadPolling();
            initChatListener(currentUserDetails.email);
        }, 250);
    } else {
        // Guest / Not logged in: Show login page & packages immediately
        showLoader(false);
        renderPackages();
        renderGoogleSignInButton();
        const gisCheckInterval = setInterval(() => {
            if (window.google && window.google.accounts) {
                clearInterval(gisCheckInterval);
                renderGoogleSignInButton();
            }
        }, 250);
        setTimeout(() => clearInterval(gisCheckInterval), 4000);
    }
}

// Run immediately if DOM is already parsed, otherwise on DOMContentLoaded
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initApp);
} else {
    initApp();
}
// Fallback safety trigger
window.addEventListener('load', initApp);

// ----------------------------------------------------
// AUTHENTICATION LOGIC
// ----------------------------------------------------

// Switch Login / Register Forms
function switchAuthForm(formType) {
    const tabLogin = document.getElementById('tabAuthLogin');
    const tabRegister = document.getElementById('tabAuthRegister');
    const formLogin = document.getElementById('authLoginForm');
    const formRegister = document.getElementById('authRegisterForm');
    
    if (formType === 'login') {
        tabLogin.style.color = 'var(--primary)';
        tabLogin.style.borderBottom = '2px solid var(--primary)';
        tabRegister.style.color = 'var(--text-secondary)';
        tabRegister.style.borderBottom = '2px solid transparent';
        
        formLogin.style.display = 'flex';
        formRegister.style.display = 'none';
    } else {
        tabRegister.style.color = 'var(--primary)';
        tabRegister.style.borderBottom = '2px solid var(--primary)';
        tabLogin.style.color = 'var(--text-secondary)';
        tabLogin.style.borderBottom = '2px solid transparent';
        
        formLogin.style.display = 'none';
        formRegister.style.display = 'flex';
    }
}

// ----------------------------------------------------
// GOOGLE SIGN-IN INTEGRATION & SESSION HANDLING
// ----------------------------------------------------

// Google Identity Services (GSI) Callback
async function handleCredentialResponse(response) {
    showLoader(true);
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 25000);
    try {
        const refCode = localStorage.getItem('tf_referral_code') || undefined;
        const res = await fetch('/api/auth/google', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                token: response.credential,
                referralCode: refCode
            }),
            signal: controller.signal
        });
        clearTimeout(timeoutId);
        const data = await res.json();
        if (data.success && data.token) {
            completeLogin(data.token, data.user);
            showNotification(`Welcome, ${data.user.name || 'User'}! Logged in with Google.`, 'success');
        } else {
            showNotification(data.message || 'Google Login failed.', 'error');
        }
    } catch (err) {
        clearTimeout(timeoutId);
        console.error('Google login error:', err);
        showNotification(err.name === 'AbortError' ? 'Server is taking too long to respond. Please ensure server is running.' : 'Failed to connect to authentication server.', 'error');
    } finally {
        showLoader(false);
    }
}

// Real Google OAuth Client ID
const GOOGLE_CLIENT_ID = "913090074120-sjole7f9tqiih87vacv0kt76s5b3tip9.apps.googleusercontent.com";

// Initialize Google Identity Services & Render Button
function renderGoogleSignInButton() {
    const container = document.getElementById('googleSignInBtnContainer');
    const fallbackBtn = document.getElementById('fallbackGoogleBtn');
    
    if (window.google && window.google.accounts && window.google.accounts.id) {
        try {
            window.google.accounts.id.initialize({
                client_id: GOOGLE_CLIENT_ID,
                callback: handleCredentialResponse,
                auto_select: false,
                cancel_on_tap_outside: true
            });

            if (container) {
                container.innerHTML = '';
                window.google.accounts.id.renderButton(container, {
                    type: 'standard',
                    theme: 'outline',
                    size: 'large',
                    text: 'continue_with',
                    shape: 'pill',
                    logo_alignment: 'left',
                    width: 320
                });
            }
            if (fallbackBtn) fallbackBtn.style.display = 'none';
        } catch (e) {
            console.warn('Google Sign-In initialization error:', e);
            if (fallbackBtn) fallbackBtn.style.display = 'flex';
        }
    } else {
        if (fallbackBtn) fallbackBtn.style.display = 'flex';
    }
}

// Google Button Click Handler
function triggerGoogleSignIn() {
    if (window.google && window.google.accounts && window.google.accounts.id) {
        window.google.accounts.id.prompt();
    } else {
        loginWithCustomEmail("yasindulakshan2006@gmail.com");
    }
}

// Direct Gmail Login helper when Client ID is pending
async function loginWithCustomEmail(email) {
    showLoader(true);
    try {
        const displayName = email.split('@')[0];
        const refCode = localStorage.getItem('tf_referral_code') || undefined;
        const res = await fetch('/api/auth/google', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                demoUser: {
                    email: email,
                    name: displayName,
                    picture: 'https://lh3.googleusercontent.com/a/default-user=s96-c'
                },
                referralCode: refCode
            })
        });
        const data = await res.json();
        if (data.success && data.token) {
            completeLogin(data.token, data.user);
            showNotification(`Welcome, ${data.user.name}! Logged in as ${data.user.email}`, 'success');
        } else {
            showNotification(data.message || 'Login failed', 'error');
            showLoader(false);
        }
    } catch (e) {
        showNotification(e.message, 'error');
        showLoader(false);
    }
}

// 1-Click Fast Demo Google Sign-In (using your Gmail)
async function handleDemoGoogleSignIn() {
    showLoader(true);
    try {
        const refCode = localStorage.getItem('tf_referral_code') || undefined;
        const res = await fetch('/api/auth/google', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                demoUser: {
                    email: 'yasindulakshan2006@gmail.com',
                    name: 'Yasindu Lakshan',
                    picture: 'https://lh3.googleusercontent.com/a/default-user=s96-c'
                },
                referralCode: refCode
            })
        });
        const data = await res.json();
        if (data.success && data.token) {
            completeLogin(data.token, data.user);
            showNotification(`Logged in as ${data.user.name} (${data.user.email})!`, 'success');
        } else {
            showNotification(data.message || 'Demo login failed', 'error');
            showLoader(false);
        }
    } catch (e) {
        showNotification(e.message, 'error');
        showLoader(false);
    }
}

function completeLogin(token, user) {
    jwtToken = token;
    currentUserDetails = user;
    isLoggedIn = true;
    
    const userEmail = user?.email || '';
    const isAdmin = isSystemAdminEmail(userEmail) || user?.role === 'admin';
    if (isAdmin) {
        if (currentUserDetails) currentUserDetails.role = 'admin';
        isAdminUnlocked = true;
        currentUserRole = 'admin';
        const adminNav = document.getElementById('adminTabNav');
        if (adminNav) adminNav.style.display = 'block';
    } else {
        isAdminUnlocked = false;
        currentUserRole = 'user';
        const adminNav = document.getElementById('adminTabNav');
        if (adminNav) adminNav.style.display = 'none';
    }
    
    localStorage.setItem('jwt_token', jwtToken);
    localStorage.setItem('user_details', JSON.stringify(currentUserDetails));
    
    document.getElementById('loginCard').style.display = 'none';
    document.getElementById('appCard').style.display = 'flex';
    updateUserProfileUI(currentUserDetails);
    
    startUserProfilePolling();
    startUserSlipsPolling();
    startGlobalChatUnreadPolling();
    initChatListener(currentUserDetails.email);
    initPackagesListener();
    loadReferralData();
    showLoader(false);
}

// Phone Number + Password Login Submit (Fallback)
async function submitPhoneLogin(event) {
    event.preventDefault();
    showLoader(true);
    
    const phone = document.getElementById('loginPhone') ? document.getElementById('loginPhone').value.trim() : '';
    const password = document.getElementById('loginPassword') ? document.getElementById('loginPassword').value : '';
    
    if (!phone || !password) {
        showNotification('Please enter login credentials.', 'error');
        showLoader(false);
        return;
    }
    
    const emailId = phone.includes('@') ? phone : phone + "@tunnelforde.lk";
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 25000);
    
    try {
        const res = await fetch('/api/auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ phone: emailId, password }),
            signal: controller.signal
        });
        clearTimeout(timeoutId);
        const data = await res.json();
        if (data.success && data.token) {
            completeLogin(data.token, data.user);
            showNotification('Logged in successfully!', 'success');
        } else {
            showNotification(data.message || 'Login failed.', 'error');
        }
    } catch(err) {
        clearTimeout(timeoutId);
        console.error(err);
        showNotification(err.name === 'AbortError' ? 'Server is taking too long to respond. Please ensure server is running.' : 'Failed to communicate with authentication server.', 'error');
    } finally {
        showLoader(false);
    }
}

// Phone Number + Password Register Submit
async function submitPhoneRegister(event) {
    event.preventDefault();
    showLoader(true);
    
    const name = document.getElementById('registerName').value.trim();
    const phone = document.getElementById('registerPhone').value.trim();
    const password = document.getElementById('registerPassword').value;
    
    if (!name || !phone || !password) {
        showNotification('Please enter all details.', 'error');
        showLoader(false);
        return;
    }
    
    const emailId = phone.includes('@') ? phone : phone + "@tunnelforde.lk";
    
    try {
        const refCode = localStorage.getItem('tf_referral_code') || undefined;
        const resRegister = await fetch('/api/auth/register', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                phone: emailId,
                name: name,
                password: password,
                referralCode: refCode
            })
        });
        
        const dataRegister = await resRegister.json();
        if (!dataRegister.success) {
            showNotification(dataRegister.message || 'Registration failed.', 'error');
            showLoader(false);
            return;
        }
        
        const resLogin = await fetch('/api/auth/login', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                phone: emailId,
                password: password
            })
        });
        
        const dataLogin = await resLogin.json();
        if (dataLogin.success) {
            jwtToken = dataLogin.token;
            currentUserDetails = dataLogin.user;
            isLoggedIn = true;
            
            localStorage.setItem('jwt_token', jwtToken);
            localStorage.setItem('user_details', JSON.stringify(currentUserDetails));
            
            document.getElementById('loginCard').style.display = 'none';
            document.getElementById('appCard').style.display = 'flex';
            document.getElementById('welcomeUser').textContent = `Welcome back, ${currentUserDetails.name}`;
            
            startUserProfilePolling();
            startUserSlipsPolling();
            startGlobalChatUnreadPolling();
            initChatListener(currentUserDetails.email);
            initPackagesListener();
            
            showNotification('Account registered and logged in successfully!', 'success');
        } else {
            showNotification('Registration completed! Please login now.', 'success');
            switchAuthForm('login');
            showLoader(false);
        }
    } catch(err) {
        console.error(err);
        showNotification('Registration failed. Please try again.', 'error');
        showLoader(false);
    }
}

// Bypass Demo Account login (for testing without credential configs)
async function handleDemoSignIn() {
    showLoader(true);
    
    try {
        const res = await fetch('/api/auth/login', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                phone: 'demo@gmail.com',
                name: 'Demo User',
                role: 'user'
            })
        });
        
        const data = await res.json();
        
        if (data.success) {
            jwtToken = data.token;
            currentUserDetails = data.user;
            isLoggedIn = true;
            
            localStorage.setItem('jwt_token', jwtToken);
            localStorage.setItem('user_details', JSON.stringify(currentUserDetails));
            
            document.getElementById('loginCard').style.display = 'none';
            document.getElementById('appCard').style.display = 'flex';
            document.getElementById('welcomeUser').textContent = `Welcome back, ${currentUserDetails.name}`;
            
            startUserProfilePolling();
            startUserSlipsPolling();
            startGlobalChatUnreadPolling();
            initChatListener(currentUserDetails.email);
            initPackagesListener();
            
            showNotification('Demo logged in successfully!', 'success');
        } else {
            showNotification(data.message, 'error');
            showLoader(false);
        }
    } catch (err) {
        console.error(err);
        showNotification('Unable to initiate bypass login.', 'error');
        showLoader(false);
    }
}

// Forgot Password Modal Controls
function openForgotPasswordModal(event) {
    if (event) event.preventDefault();
    document.getElementById('forgotPhoneInput').value = '';
    const newPass = document.getElementById('forgotNewPasswordInput');
    if (newPass) newPass.value = '';
    document.getElementById('forgotPasswordModal').style.display = 'flex';
}

function closeForgotPasswordModal() {
    document.getElementById('forgotPasswordModal').style.display = 'none';
}

async function handleResetPassword(event) {
    event.preventDefault();
    const phone = document.getElementById('forgotPhoneInput').value.trim();
    const newPassword = document.getElementById('forgotNewPasswordInput').value;
    
    if (!phone || !newPassword) {
        showNotification('Please fill in all fields.', 'error');
        return;
    }
    
    const emailId = phone.includes('@') ? phone : phone + "@tunnelforde.lk";
    
    showLoader(true);
    
    if (isGuestMode) {
        const client = guestClients.find(c => c.email === emailId);
        if (!client) {
            showNotification('Registered account not found for this phone number (Guest Mode).', 'error');
            showLoader(false);
            return;
        }
        client.password = newPassword;
        showNotification('✓ Password reset successfully (Guest Mode)!', 'success');
        closeForgotPasswordModal();
        showLoader(false);
        return;
    }
    
    try {
        const response = await fetch('/api/auth/reset-password', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                phone: emailId,
                newPassword: newPassword
            })
        });
        const data = await response.json();
        if (data.success) {
            showNotification('✓ Password reset successfully! Please login now.', 'success');
            closeForgotPasswordModal();
        } else {
            showNotification(data.message || 'Failed to reset password.', 'error');
        }
        showLoader(false);
    } catch (err) {
        console.error('Reset password error:', err);
        showNotification('Failed to communicate with authentication server.', 'error');
        showLoader(false);
    }
}


// Logout
function handleLogout() {
    if (confirm('Are you sure you want to logout?')) {
        try {
            if (jwtToken) {
                fetch('/api/presence/offline', {
                    method: 'POST',
                    headers: { 'Authorization': `Bearer ${jwtToken}` },
                    keepalive: true
                }).catch(() => {});
            }
        } catch (e) {}

        clearAllPollingIntervals();
        
        localStorage.removeItem('jwt_token');
        localStorage.removeItem('user_details');
        
        isLoggedIn = false;
        currentUserDetails = null;
        jwtToken = '';
        isAdminUnlocked = false;
        
        // Reset view states
        document.getElementById('appCard').style.display = 'none';
        document.getElementById('loginCard').style.display = 'block';
        
        // Refresh index
        window.location.reload();
    }
}

window.addEventListener('beforeunload', () => {
    if (isLoggedIn && !isGuestMode && jwtToken) {
        try {
            fetch('/api/presence/offline', {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${jwtToken}` },
                keepalive: true
            }).catch(() => {});
        } catch (e) {}
    }
});

// ----------------------------------------------------
// TAB ROUTING CONTROLLER
// ----------------------------------------------------
function switchTab(tabId, event) {
    if (tabId === 'admin') {
        const userEmail = currentUserDetails?.email || '';
        if (currentUserRole !== 'admin' || !isSystemAdminEmail(userEmail)) {
            showNotification('Access Denied: Admin panel is restricted to the administrator.', 'error');
            return;
        }
    }
    if (event) event.preventDefault();
    
    // Deactivate all links & views
    document.querySelectorAll('.nav-link').forEach(link => link.classList.remove('active'));
    document.querySelectorAll('.tab-view').forEach(view => view.classList.remove('active'));
    
    // Activate clicked tab Link
    const targetLink = Array.from(document.querySelectorAll('.nav-link')).find(link => link.onclick.toString().includes(tabId));
    if (targetLink) targetLink.classList.add('active');
    
    // Activate view panel
    const targetView = document.getElementById(`view-${tabId}`);
    if (targetView) targetView.classList.add('active');
    
    currentActiveTab = tabId;
    
    // Dynamic subtitle update based on tab
    const subtitle = document.getElementById('headerSubtitle');
    if (tabId === 'dashboard') subtitle.textContent = "Here's your account overview";
    else if (tabId === 'packages') subtitle.textContent = "Browse and select available network packages";
    else if (tabId === 'orders') subtitle.textContent = "Track slip uploads history and status";
    else if (tabId === 'accounts') subtitle.textContent = "View details of your active configurations";
    else if (tabId === 'freeConfigs') subtitle.textContent = "Unlock configuration configs with loyalty points";
    else if (tabId === 'messages') subtitle.textContent = "Latest news and updates";
    else if (tabId === 'posts') subtitle.textContent = "Guides, tips, and tutorials";
    else if (tabId === 'admin') subtitle.textContent = "Control panel configurations management";
    
    // Polling Optimization: stop admin polling if we switched away from admin tab
    if (tabId !== 'admin') {
        stopAdminAllChatsPolling();
        stopAdminChatMessagesPolling();
        stopAdminSlipsPolling();
        stopAdminClientsPolling();
    }
    
    // Sync Mobile Bottom Navigation Items
    document.querySelectorAll('.bottom-nav-item').forEach(btn => {
        if (btn.getAttribute('data-tab') === tabId) {
            btn.classList.add('active');
        } else {
            btn.classList.remove('active');
        }
    });

    // Close mobile drawer if opened
    closeMobileSidebar();

    // Reload components if required
    const floatingWidget = document.getElementById('floatingChatWidget');
    if (floatingWidget) {
        const isUserAdmin = currentUserRole === 'admin' || isSystemAdminUser(currentUserDetails?.email);
        const hideOnTab = (tabId === 'messages') || (isUserAdmin && tabId === 'admin');
        floatingWidget.style.display = hideOnTab ? 'none' : 'flex';
    }

    if (tabId === 'dashboard') loadReferralData();
    if (tabId === 'freeConfigs') loadConfigsMarket();
    if (tabId === 'orders') fetchUserSlips();
    if (tabId === 'messages') {
        stopTitleBlink();
        updateUserNavBadge(0);
        markUserChatRead();
        startChatPolling();
    } else {
        stopChatPolling();
    }
    if (tabId === 'admin') {
        stopTitleBlink();
        loadAdminPanel();
        if (adminActiveChatUser) markAdminChatRead(adminActiveChatUser);
    }
}

// Mobile Off-canvas Drawer Handlers
function toggleMobileSidebar() {
    const sidebar = document.querySelector('.sidebar');
    const backdrop = document.getElementById('sidebarBackdrop');
    if (sidebar) sidebar.classList.toggle('mobile-open');
    if (backdrop) backdrop.classList.toggle('active');
    document.body.classList.toggle('sidebar-locked', sidebar && sidebar.classList.contains('mobile-open'));
}

function closeMobileSidebar() {
    const sidebar = document.querySelector('.sidebar');
    const backdrop = document.getElementById('sidebarBackdrop');
    if (sidebar) sidebar.classList.remove('mobile-open');
    if (backdrop) backdrop.classList.remove('active');
    document.body.classList.remove('sidebar-locked');
}

// ----------------------------------------------------
// FIRESTORE SYNC (REAL-TIME SNAPSHOT LISTENERS)
// ----------------------------------------------------

// User Document snapshot
// ----------------------------------------------------
// USER PROFILE & GOOGLE AVATAR DISPLAY CONTROLLER
// ----------------------------------------------------
function updateUserProfileUI(userData) {
    if (!userData) return;
    const name = userData.name || 'User';
    const email = userData.email || userData.phone || '';
    const picture = userData.picture || 'https://lh3.googleusercontent.com/a/default-user=s96-c';
    const isAdmin = isSystemAdminEmail(email) || userData.role === 'admin';
    const roleText = isAdmin ? '👑 ADMIN' : '⚡ USER';

    // 1. Sidebar User Profile Card
    const avatarEl = document.getElementById('sidebarUserAvatar');
    if (avatarEl) {
        avatarEl.src = picture;
        avatarEl.onerror = () => { avatarEl.src = 'https://lh3.googleusercontent.com/a/default-user=s96-c'; };
    }
    const nameEl = document.getElementById('sidebarUserName');
    if (nameEl) nameEl.textContent = name;
    
    const emailEl = document.getElementById('sidebarUserEmail');
    if (emailEl) emailEl.textContent = email;
    
    const badgeEl = document.getElementById('sidebarUserBadge');
    if (badgeEl) {
        badgeEl.textContent = roleText;
        badgeEl.className = isAdmin ? 'sidebar-user-badge admin' : 'sidebar-user-badge user';
    }

    // 2. Top Header Avatar
    const headerAvatar = document.getElementById('headerUserAvatar');
    if (headerAvatar) {
        headerAvatar.src = picture;
        headerAvatar.onerror = () => { headerAvatar.src = 'https://lh3.googleusercontent.com/a/default-user=s96-c'; };
    }

    // 3. Welcome title
    const welcomeEl = document.getElementById('welcomeUser');
    if (welcomeEl) welcomeEl.textContent = `Welcome back, ${name}`;
}

function clearAllPollingIntervals() {
    stopUserProfilePolling();
    stopUserSlipsPolling();
    stopChatPolling();
    stopAdminChatMessagesPolling();
    stopAdminAllChatsPolling();
    stopAdminSlipsPolling();
    stopAdminClientsPolling();
    stopPackagesPolling();
    stopGlobalChatUnreadPolling();
}

function startUserProfilePolling() {
    stopUserProfilePolling();
    fetchUserProfile();
    userProfileInterval = setInterval(fetchUserProfile, 12000);
}

function stopUserProfilePolling() {
    if (userProfileInterval) {
        clearInterval(userProfileInterval);
        userProfileInterval = null;
    }
}

async function fetchUserProfile() {
    if (!isLoggedIn || isGuestMode) return;
    try {
        const res = await apiFetch('/api/user/profile');
        const data = await res.json();
        if (data.success && data.user) {
            const userData = data.user;
            currentUserDocData = userData;
            
            // Sync user state variables
            currentUserCoins = userData.coins || 0;
            const userEmail = userData.email || currentUserDetails?.email || '';
            const isAdmin = isSystemAdminEmail(userEmail) || userData.role === 'admin';
            currentUserRole = isAdmin ? 'admin' : 'user';
            isAdminUnlocked = isAdmin;
            currentUserStatus = userData.status || 'inactive';
            userUnlockedConfigs = userData.unlockedConfigs || [];
            
            // Update User Profile Avatar & Interface
            updateUserProfileUI(userData);
            const coinsBalEl = document.getElementById('userCoinsBalance');
            if (coinsBalEl) coinsBalEl.textContent = `${Math.floor(currentUserCoins)} Coins`;

            // Immediately set referral link if present
            if (userData.referral_code) {
                const linkInput = document.getElementById('dashboardReferralLinkInput');
                if (linkInput) {
                    linkInput.value = `${window.location.origin}/?ref=${userData.referral_code}`;
                }
            }
            
            // Admin Navigation (show only for admin)
            const adminNav = document.getElementById('adminTabNav');
            if (adminNav) {
                adminNav.style.display = (currentUserRole === 'admin') ? 'block' : 'none';
            }
            const addFreeBtn = document.getElementById('btnOpenAddFreeConfigModal');
            if (addFreeBtn) {
                addFreeBtn.style.display = (currentUserRole === 'admin') ? 'flex' : 'none';
            }
            
            // Populate Config Selector Dropdown
            populateConfigSelector(userData);

            // Check Expiry State and fetch usage stats if active
            checkUserStatusState(userData);

            // Sync referral rewards & link stats
            loadReferralData();
        }
    } catch (err) {
        console.error('Fetch profile error:', err);
    }
}

function startUserSlipsPolling() {
    stopUserSlipsPolling();
    fetchUserSlips();
    userSlipsInterval = setInterval(fetchUserSlips, 5000);
}

function stopUserSlipsPolling() {
    if (userSlipsInterval) {
        clearInterval(userSlipsInterval);
        userSlipsInterval = null;
    }
}

async function fetchUserSlips() {
    if (!isLoggedIn || isGuestMode) return;
    const historyBody = document.getElementById('userSlipsHistoryBody');
    if (!historyBody) return;
    
    try {
        const res = await apiFetch('/api/slips/user');
        const data = await res.json();
        if (data.success && data.slips) {
            if (data.slips.length === 0) {
                if (!historyBody.querySelector('.order-card-row')) {
                    historyBody.innerHTML = `
                        <tr>
                            <td colspan="5" style="text-align: center; color: var(--text-muted); padding: 3rem;">No order history found.</td>
                        </tr>
                    `;
                }
                return;
            }
            
            historyBody.innerHTML = '';
            data.slips.forEach(order => {
                const tr = document.createElement('tr');
                tr.className = 'order-card-row';
                const createdDate = order.created_at ? new Date(order.created_at).toLocaleString() : 'Pending';
                const planIdText = order.planId ? getPlanDisplayName(order.planId) : 'Custom VPN Plan';
                const priceVal = typeof order.price === 'number' ? order.price : parseFloat(order.price) || 0;
                const rawSlip = String(order.slipUrl || '');
                const isCoinOrder = order.isCoinOrder || 
                                    order.paymentMethod === 'coins' || 
                                    rawSlip === 'coins' || 
                                    rawSlip.includes('COIN') || 
                                    (priceVal === 0 && (order.coinCost > 0 || order.days > 0));
                const coinCost = order.coinCost || 100;
                
                let priceHtml = `<strong>LKR ${priceVal.toFixed(2)}</strong>`;
                let slipHtml = '';
                
                if (isCoinOrder) {
                    priceHtml = `<span class="badge-order-coins"><i class="fas fa-coins text-gold"></i> ${coinCost} Coins</span>`;
                    slipHtml = `<span class="badge-coin-redeem" title="Redeemed with Data Coins"><i class="fas fa-coins"></i> Coin Redeem</span>`;
                } else if (rawSlip && rawSlip.length > 5) {
                    const safeUrl = rawSlip.replace(/'/g, "\\'");
                    slipHtml = `<img src="${rawSlip}" class="thumbnail-slip" onclick="viewFullImage('${safeUrl}')" alt="Slip Receipt">`;
                } else {
                    slipHtml = `<span style="color: var(--text-muted); font-size: 0.8rem;">No Slip</span>`;
                }
                
                tr.innerHTML = `
                    <td>
                        <span class="mobile-td-label"><i class="fas fa-calendar-alt"></i> Date</span>
                        <span class="order-td-value">${createdDate}</span>
                    </td>
                    <td>
                        <span class="mobile-td-label"><i class="fas fa-box"></i> Package</span>
                        <span class="order-td-value"><strong>${planIdText}${order.selected_gb ? ` (${order.selected_gb} GB)` : ''}</strong></span>
                    </td>
                    <td>
                        <span class="mobile-td-label"><i class="fas fa-tag"></i> Price</span>
                        <span class="order-td-value">${priceHtml}</span>
                    </td>
                    <td>
                        <span class="mobile-td-label"><i class="fas fa-receipt"></i> Payment Slip</span>
                        <span class="order-td-value">${slipHtml}</span>
                    </td>
                    <td>
                        <span class="mobile-td-label"><i class="fas fa-info-circle"></i> Status</span>
                        <span class="order-td-value"><span class="badge-status ${order.status}">${order.status.toUpperCase()}</span></span>
                    </td>
                `;
                historyBody.appendChild(tr);
            });
        }
    } catch (err) {
        console.error('Fetch user slips error:', err);
    }
}

// ----------------------------------------------------
// CORE USER SUBSCRIPTION HANDLING & GRAPH RENDER
// ----------------------------------------------------

async function checkUserStatusState(userData) {
    const now = Date.now();
    const expiry = userData.expiryTime || userData.expiry_time || 0;
    
    // Check if subscription has expired
    if (userData.status === 'active' && expiry > 0 && now > expiry) {
        showNotification('Your Tunnel subscription has expired.', 'warning');
        // Render empty stats locally
        renderEmptyStats(userData);
        return;
    }
    
    // Fetch live bandwidth stats
    loadUsageStats(userData);
}

// Call backend to fetch usage details (either using linked subLink or email)
async function loadUsageStats(userData, packageId = '', forceFresh = false) {
    try {
        let response;
        const activePkgId = packageId || userData?.active_package_id || currentUserDocData?.active_package_id || '';
        let url = '/api/user/usage';
        const params = [];
        if (activePkgId) params.push(`packageId=${encodeURIComponent(activePkgId)}`);
        if (forceFresh) params.push('fresh=true');
        if (params.length > 0) url += `?${params.join('&')}`;

        if (jwtToken) {
            response = await fetch(url, {
                method: 'GET',
                headers: {
                    'Authorization': `Bearer ${jwtToken}`
                }
            });
        } else if (userData.subLink) {
            response = await fetch(`/api/public/usage?query=${encodeURIComponent(userData.subLink)}`);
        } else {
            renderEmptyStats(userData);
            return;
        }
        
        const resData = await response.json();
        
        if (resData.success && resData.data) {
            const traffic = resData.data;
            const mergedUser = {
                ...userData,
                plan: traffic.plan || userData.plan,
                total_gb: traffic.totalGb || userData.total_gb || userData.totalGb,
                configLink: traffic.configLink || userData.config_link || userData.configLink,
                subLink: traffic.subLink || userData.sub_link || userData.subLink,
                sni: traffic.sni || userData.sni,
                host: traffic.host || userData.host,
                port: traffic.port || userData.port,
                target: traffic.target || userData.target,
                panelId: traffic.panelId || userData.panel_id || userData.panelId,
                panelName: traffic.panelName || userData.panelName,
                expiryTime: traffic.expiryTime || userData.expiryTime || userData.expiry_time || 0,
                packages: userData.packages || currentUserDocData?.packages || [],
                active_package_id: activePkgId || userData.active_package_id || currentUserDocData?.active_package_id
            };
            renderStatsDashboard(traffic, mergedUser);
        } else {
            renderEmptyStats(userData);
        }
    } catch(err) {
        console.error('Fetch usage error:', err);
        renderEmptyStats(userData);
    }
}

// Convert Bytes to GB helper
function bytesToGB(bytes) {
    if (!bytes || bytes <= 0) return 0;
    return parseFloat((bytes / (1024 * 1024 * 1024)).toFixed(2));
}

// Calculates and renders stats metrics UI
function renderStatsDashboard(traffic, userData) {
    const uploadGB = bytesToGB(traffic.up);
    const downloadGB = bytesToGB(traffic.down);
    const usedGB = parseFloat((uploadGB + downloadGB).toFixed(2));
    
    // Expiry countdown calculations
    const expiryTime = (traffic && traffic.expiryTime) ? Number(traffic.expiryTime) : (userData.expiryTime || userData.expiry_time || 0);
    let daysRemaining = '--';
    if (expiryTime > 0) {
        const diff = expiryTime - Date.now();
        daysRemaining = Math.max(0, Math.ceil(diff / (1000 * 60 * 60 * 24)));
    }
    
    // Detect if this plan is Unlimited
    const planName = (traffic.plan || userData.plan || '').toLowerCase();
    const isUnlimited = traffic.isUnlimited === true ||
                        (traffic.totalGb && String(traffic.totalGb).toLowerCase() === 'unlimited') ||
                        (userData.total_gb && String(userData.total_gb).toLowerCase() === 'unlimited') ||
                        (userData.totalGb && String(userData.totalGb).toLowerCase() === 'unlimited') ||
                        planName.includes('unlimited') ||
                        traffic.total === 0;

    // Plan data limits parsing (convert bytes limit to GB)
    const totalLimitGB = isUnlimited ? 0 : (bytesToGB(traffic.total) || 100);
    
    // Compute Percentages
    let percentUsed = 0;
    if (!isUnlimited && totalLimitGB > 0) {
        const rawPercent = (usedGB / totalLimitGB) * 100;
        percentUsed = (rawPercent > 0 && rawPercent < 1) ? parseFloat(rawPercent.toFixed(1)) : Math.min(100, Math.round(rawPercent));
    }
    
    // 1. Update Grid widgets
    document.getElementById('statUpload').textContent = `${uploadGB} GB`;
    document.getElementById('statDownload').textContent = `${downloadGB} GB`;
    document.getElementById('statExpiry').textContent = expiryTime > 0 ? `${daysRemaining} Days` : '-- Days';
    
    const statusText = document.getElementById('statStatus');
    const statusIcon = document.getElementById('statusBadgeIcon');
    statusText.textContent = (userData.status || 'ACTIVE').toUpperCase();
    statusIcon.className = `stat-icon icon-status ${userData.status || 'active'}`;
    
    // 2. Update Bar fills
    document.getElementById('barUploadText').textContent = `${uploadGB} GB`;
    document.getElementById('barDownloadText').textContent = `${downloadGB} GB`;
    
    const maxBar = Math.max(uploadGB, downloadGB, 0.1);
    document.getElementById('barUploadFill').style.width = `${Math.min(100, (uploadGB / maxBar) * 100)}%`;
    document.getElementById('barDownloadFill').style.width = `${Math.min(100, (downloadGB / maxBar) * 100)}%`;
    
    // 3. Update Circular SVG Progress Gauge
    document.getElementById('gaugePercentText').textContent = isUnlimited ? '0%' : `${percentUsed}%`;
    document.getElementById('gaugeUsedVal').textContent = `${usedGB} GB`;
    document.getElementById('gaugeRemainingVal').textContent = isUnlimited ? 'Unlimited' : `${Math.max(0, parseFloat((totalLimitGB - usedGB).toFixed(2)))} GB`;
    
    // Circle dash offset trigger
    const circle = document.getElementById('gaugeCircleFill');
    if (circle) {
        const radius = circle.r.baseVal.value || 40;
        const circumference = 2 * Math.PI * radius; // ~251.2
        const offset = isUnlimited ? circumference : (circumference - (circumference * percentUsed / 100));
        circle.style.strokeDashoffset = offset;
    }
    
    // Update config dropdown selector dynamically with all user packages
    populateConfigSelector(userData);
    
    // 4. Render Active configuration card
    renderActiveConfigCards(traffic.configLink, userData, daysRemaining);
    
    // 5. Update connection status info card
    const expiryText = expiryTime > 0 ? new Date(expiryTime).toLocaleDateString() : 'Unknown';
    const connectionStatusContent = document.getElementById('connectionStatusContent');
    if (connectionStatusContent) {
        connectionStatusContent.innerHTML = `
            <i class="fas fa-circle-check text-gradient" style="font-size: 3rem; color: var(--success); margin-bottom: 1rem; display: block;"></i>
            <p style="color: var(--text-primary); font-size: 0.95rem; font-weight: 700; margin-bottom: 0.25rem;">${userData.plan || 'Active Pack'} is Active</p>
            <p style="color: var(--text-secondary); font-size: 0.8rem; margin-bottom: 1rem; text-align: center;">Expires on: ${expiryText}</p>
            <button class="btn btn-primary" style="padding: 0.65rem 1.25rem; border-radius: 10px; font-size: 0.85rem; font-weight: 600; width: 100%;" onclick="openRenewModal()"><i class="fas fa-rotate"></i> Renew Plan</button>
        `;
    }
}

// Populate the config selector dropdown with all owned packages
function populateConfigSelector(userData) {
    const selector = document.getElementById('configSelector');
    const deleteBtn = document.getElementById('btnDeleteSelectedConfig');
    if (!selector) return;

    const packages = (userData && Array.isArray(userData.packages) && userData.packages.length > 0)
        ? userData.packages
        : (currentUserDocData && Array.isArray(currentUserDocData.packages) ? currentUserDocData.packages : []);

    if (packages.length === 0) {
        if (userData && userData.plan && userData.plan !== 'None' && (userData.config_link || userData.configLink)) {
            selector.innerHTML = `<option value="active-xui">${userData.plan}</option>`;
            if (deleteBtn) deleteBtn.style.display = 'inline-flex';
        } else {
            selector.innerHTML = `<option value="">No Active Package</option>`;
            if (deleteBtn) deleteBtn.style.display = 'none';
        }
        return;
    }

    const activeId = userData?.active_package_id || currentUserDocData?.active_package_id || (userData?.configLink ? packages.find(p => p.configLink === userData.configLink)?.id : packages[0]?.id);

    let html = '';
    packages.forEach(pkg => {
        const isSelected = (pkg.id === activeId || pkg.configLink === userData?.configLink || (pkg.planId && pkg.planId === userData?.planId && !activeId));
        const label = pkg.planName || pkg.planId || 'Configuration';
        html += `<option value="${pkg.id}" ${isSelected ? 'selected' : ''}>${label}</option>`;
    });
    selector.innerHTML = html;

    if (deleteBtn) {
        if (selector.value && selector.value !== '' && selector.value !== 'No Active Package') {
            deleteBtn.style.display = 'inline-flex';
        } else {
            deleteBtn.style.display = 'none';
        }
    }
}

// Fallback / Inactive user rendering (matching the screenshots)
function renderEmptyStats(userData) {
    document.getElementById('statUpload').textContent = '0 GB';
    document.getElementById('statDownload').textContent = '0 GB';
    document.getElementById('statExpiry').textContent = '-- Days';
    
    const statusText = document.getElementById('statStatus');
    const statusIcon = document.getElementById('statusBadgeIcon');
    statusText.textContent = userData.status ? userData.status.toUpperCase() : 'INACTIVE';
    statusIcon.className = `stat-icon icon-status ${userData.status || 'inactive'}`;
    
    document.getElementById('barUploadText').textContent = '0.00 GB';
    document.getElementById('barDownloadText').textContent = '0.00 GB';
    document.getElementById('barUploadFill').style.width = '0%';
    document.getElementById('barDownloadFill').style.width = '0%';
    
    document.getElementById('gaugePercentText').textContent = '0%';
    document.getElementById('gaugeUsedVal').textContent = '0.00 GB';
    document.getElementById('gaugeRemainingVal').textContent = '0.00 GB';
    document.getElementById('gaugeCircleFill').style.strokeDashoffset = '251.2';
    
    populateConfigSelector(userData);
    
    // Render empty state card inside active configs block
    document.getElementById('activeConfigsSection').innerHTML = `
        <div class="empty-state-card" style="text-align: center; padding: 2.5rem 1.5rem; background: var(--bg-card); border-radius: 16px; border: 1px dashed var(--border-color);">
            <div class="empty-state-icon" style="font-size: 2.5rem; color: var(--primary); margin-bottom: 1rem;">
                <i class="fas fa-box-open"></i>
            </div>
            <h3 style="font-size: 1.25rem; font-weight: 700; margin-bottom: 0.5rem; color: var(--text-primary);">No Active Package</h3>
            <p style="color: var(--text-secondary); max-width: 420px; margin: 0 auto 1.5rem auto; font-size: 0.9rem; line-height: 1.5;">
                ඔබ තවමත් කිසිදු Package එකක් මිලදී ගෙන නැත. High-Speed V2Ray පහසුකම ලබාගැනීමට පහතින් Package එකක් තෝරාගන්න.
            </p>
            <button class="btn btn-primary" onclick="switchTab('packages', event)" style="padding: 0.75rem 1.8rem; border-radius: 12px; font-weight: 600; display: inline-flex; align-items: center; gap: 0.5rem; cursor: pointer;">
                <i class="fas fa-shopping-bag"></i>
                <span>Browse Packages</span>
            </button>
        </div>
    `;
    
    document.getElementById('accountsWrapper').innerHTML = `
        <div class="empty-state-card">
            <div class="empty-state-icon">
                <i class="fas fa-user-xmark"></i>
            </div>
            <h4>No Active Accounts</h4>
            <p>You do not have any active V2Ray accounts currently.</p>
            <button class="btn btn-primary" onclick="switchTab('packages')">Browse Packages</button>
        </div>
    `;
    
    // Update connection status info card
    const connectionStatusContent = document.getElementById('connectionStatusContent');
    if (connectionStatusContent) {
        if (userData.status === 'active' && userData.plan && userData.plan !== 'None') {
            const expiryText = userData.expiryTime ? new Date(userData.expiryTime).toLocaleDateString() : 'Unknown';
            connectionStatusContent.innerHTML = `
                <i class="fas fa-circle-check text-gradient" style="font-size: 3rem; color: var(--success); margin-bottom: 1rem; display: block;"></i>
                <p style="color: var(--text-primary); font-size: 0.95rem; font-weight: 700; margin-bottom: 0.25rem;">${userData.plan} is Active</p>
                <p style="color: var(--text-secondary); font-size: 0.8rem; margin-bottom: 1rem; text-align: center;">Expires on: ${expiryText}</p>
                <button class="btn btn-primary" style="padding: 0.65rem 1.25rem; border-radius: 10px; font-size: 0.85rem; font-weight: 600; width: 100%;" onclick="openRenewModal()"><i class="fas fa-rotate"></i> Renew Plan</button>
            `;
        } else {
            connectionStatusContent.innerHTML = `
                <i class="fas fa-shield-halved text-gradient" style="font-size: 3rem; margin-bottom: 1rem; display: block;"></i>
                <p style="color: var(--text-secondary); font-size: 0.85rem; text-align: center; margin-bottom: 1rem;">No active package found. Connect to high-speed tunneling VPN configs by activating a plan.</p>
                <button class="btn btn-primary" style="padding: 0.65rem 1.25rem; border-radius: 10px; font-size: 0.85rem; font-weight: 600; width: 100%;" onclick="switchTab('packages')"><i class="fas fa-shopping-cart"></i> Browse Packages</button>
            `;
        }
    }
}

// Renders the Config card with copy links & all owned packages in My Accounts
function renderActiveConfigCards(link, userData, daysRemaining) {
    const activeLink = userData.configLink || link || userData.subLink || '';
    const unlinkBtnHtml = userData.subLink ? `<button class="btn btn-secondary" style="padding: 0.5rem 1rem; border-radius: 8px; font-size: 0.8rem; border-color: #ef4444; color: #ef4444;" onclick="unlinkSubscription()"><i class="fas fa-link-slash"></i> Unlink</button>` : '';
    
    const isAddressTarget = userData.target === 'address';
    const hostLabel = isAddressTarget ? 'Host Address' : 'SNI Bug Host';
    const hostValue = userData.host || userData.sni || 'Auto';
    const portVal = userData.port ? userData.port : (isAddressTarget ? 8080 : 443);

    const activeCardHtml = `
        <div class="active-config-card">
            <div class="config-header-row">
                <div class="config-title-group">
                    <h4>${userData.plan || 'Active'} V2Ray Subscription Line</h4>
                    <span>Assigned to: ${userData.email || userData.phone || 'User'}</span>
                </div>
                <span class="badge-status active">ACTIVE</span>
            </div>
            
            <div class="config-details-row">
                <div class="detail-item">
                    <span>Server Node</span>
                    <strong style="color: var(--primary);"><i class="fas fa-server"></i> ${userData.panelName || (userData.panel_id === 2 || userData.panelId === 2 ? 'Node 02 (Site)' : 'Node 01 (Panther)')}</strong>
                </div>
                <div class="detail-item">
                    <span>Subscription Plan</span>
                    <strong>${userData.plan || 'Custom'} Pack</strong>
                </div>
                <div class="detail-item">
                    <span>${hostLabel}</span>
                    <strong style="color: var(--primary);">${hostValue} <span class="badge" style="font-size: 0.72rem; padding: 0.15rem 0.45rem; background: var(--bg-hover); border-radius: 4px; margin-left: 4px;">Port ${portVal}</span></strong>
                </div>
                <div class="detail-item">
                    <span>Expiration</span>
                    <strong>${daysRemaining} Days left</strong>
                </div>
            </div>
            
            <div class="form-group" style="margin-bottom: 0;">
                <label>Vless / Vmess Configuration Link (with Auto SNI & Port)</label>
                <div class="sub-link-input-group">
                    <input type="text" class="sub-link-input" id="subLinkInput" readonly value="${activeLink}">
                    <button class="btn-sub primary" onclick="copySubscriptionLink()"><i class="fas fa-copy"></i> Copy</button>
                    <button class="btn-sub secondary" onclick="openSubscriptionQrModal('${activeLink}')"><i class="fas fa-qrcode"></i> QR Code</button>
                </div>
            </div>
            
            <div class="action-buttons" style="display: flex; gap: 0.5rem; margin-top: 1rem; flex-wrap: wrap;">
                <button class="btn btn-primary" style="padding: 0.5rem 1rem; border-radius: 8px; font-size: 0.8rem; font-weight: 600;" onclick="openRenewModal()"><i class="fas fa-rotate"></i> Renew Plan</button>
                ${unlinkBtnHtml}
                <button class="btn-delete-item" style="padding: 0.5rem 0.9rem; font-size: 0.8rem;" onclick="deleteCurrentActivePackage()" title="Delete this configuration"><i class="fas fa-trash-can"></i> Delete Configuration</button>
            </div>
        </div>
    `;
    
    document.getElementById('activeConfigsSection').innerHTML = activeCardHtml;
    
    // Populate "My Accounts" tab with ALL user owned packages
    const accountsWrapper = document.getElementById('accountsWrapper');
    if (accountsWrapper) {
        const packages = (userData && Array.isArray(userData.packages) && userData.packages.length > 0)
            ? userData.packages
            : (currentUserDocData && Array.isArray(currentUserDocData.packages) ? currentUserDocData.packages : []);

        if (packages.length <= 1) {
            accountsWrapper.innerHTML = activeCardHtml;
        } else {
            const activeId = userData.active_package_id || currentUserDocData?.active_package_id;
            let accountsHtml = '<div style="display: flex; flex-direction: column; gap: 1.25rem;">';
            
            packages.forEach(pkg => {
                const isActive = (pkg.id === activeId || pkg.configLink === activeLink);
                const pkgIsAddressTarget = pkg.target === 'address';
                const pkgHostLabel = pkgIsAddressTarget ? 'Host Address' : 'SNI Bug Host';
                const pkgHostVal = pkg.host || pkg.sni || 'Auto';
                const pkgPortVal = pkg.port || (pkgIsAddressTarget ? 8080 : 443);
                const pkgPanelName = pkg.panelName || (pkg.panelId === 2 || pkg.panel_id === 2 ? 'Node 02 (Site)' : 'Node 01 (Panther)');
                
                const actionBtnHtml = isActive 
                    ? `<div style="display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap;">
                         <span class="badge-status active" style="font-size: 0.85rem; padding: 0.4rem 0.8rem;"><i class="fas fa-circle-check"></i> CURRENTLY ACTIVE</span>
                         <button class="btn btn-primary" style="padding: 0.4rem 0.75rem; font-size: 0.78rem;" onclick="openRenewModal('${pkg.id}')"><i class="fas fa-rotate"></i> Renew</button>
                         <button class="btn-delete-item" style="padding: 0.4rem 0.75rem; font-size: 0.78rem;" onclick="confirmAndDeletePackage('${pkg.id}', '${(pkg.planName || 'Configuration').replace(/'/g, "\\'")}')" title="Delete this configuration"><i class="fas fa-trash-can"></i> Delete</button>
                       </div>`
                    : `<div style="display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap;">
                         <button class="btn btn-primary" style="padding: 0.5rem 1rem; border-radius: 8px; font-size: 0.82rem; font-weight: 600;" onclick="switchActivePackage('${pkg.id}')"><i class="fas fa-arrow-right-arrow-left"></i> Switch to this Package</button>
                         <button class="btn btn-primary" style="padding: 0.4rem 0.75rem; font-size: 0.78rem; background: var(--bg-hover); color: var(--text-primary); border: 1px solid var(--border-color);" onclick="openRenewModal('${pkg.id}')"><i class="fas fa-rotate"></i> Renew</button>
                         <button class="btn-delete-item" style="padding: 0.4rem 0.75rem; font-size: 0.78rem;" onclick="confirmAndDeletePackage('${pkg.id}', '${(pkg.planName || 'Configuration').replace(/'/g, "\\'")}')" title="Delete this configuration"><i class="fas fa-trash-can"></i> Delete</button>
                       </div>`;

                accountsHtml += `
                    <div class="active-config-card" style="${isActive ? 'border: 2px solid var(--primary); box-shadow: 0 0 15px rgba(99, 102, 241, 0.15);' : 'opacity: 0.95;'}">
                        <div class="config-header-row">
                            <div class="config-title-group">
                                <h4>${pkg.planName || 'V2Ray Package'}</h4>
                                <span>Assigned to: ${userData.email || 'User'}</span>
                            </div>
                            <div>${actionBtnHtml}</div>
                        </div>
                        
                        <div class="config-details-row">
                            <div class="detail-item">
                                <span>Server Node</span>
                                <strong style="color: var(--primary);"><i class="fas fa-server"></i> ${pkgPanelName}</strong>
                            </div>
                            <div class="detail-item">
                                <span>Data Limit</span>
                                <strong>${(pkg.totalGb && String(pkg.totalGb).toLowerCase() === 'unlimited') || (pkg.planName && pkg.planName.toLowerCase().includes('unlimited')) ? 'Unlimited' : `${pkg.totalGb || '100'} GB`}</strong>
                            </div>
                            <div class="detail-item">
                                <span>${pkgHostLabel}</span>
                                <strong style="color: var(--primary);">${pkgHostVal} <span class="badge" style="font-size: 0.72rem; padding: 0.15rem 0.45rem; background: var(--bg-hover); border-radius: 4px; margin-left: 4px;">Port ${pkgPortVal}</span></strong>
                            </div>
                            <div class="detail-item">
                                <span>Status</span>
                                <strong><span class="badge-status ${isActive ? 'active' : 'approved'}">${isActive ? 'ACTIVE' : 'READY'}</span></strong>
                            </div>
                        </div>
                        
                        <div class="form-group" style="margin-bottom: 0;">
                            <label>Configuration Link</label>
                            <div class="sub-link-input-group">
                                <input type="text" class="sub-link-input" readonly value="${pkg.configLink || ''}">
                                <button class="btn-sub primary" onclick="copySpecificLink('${pkg.configLink || ''}')"><i class="fas fa-copy"></i> Copy</button>
                                <button class="btn-sub secondary" onclick="openSubscriptionQrModal('${pkg.configLink || ''}')"><i class="fas fa-qrcode"></i> QR</button>
                            </div>
                        </div>
                    </div>
                `;
            });
            
            accountsHtml += '</div>';
            accountsWrapper.innerHTML = accountsHtml;
        }
    }
}

// Switch active package by ID
async function switchActivePackage(packageId) {
    if (!packageId) return;
    showLoader(true);
    try {
        const token = localStorage.getItem('jwt_token') || jwtToken;
        if (!token) {
            showNotification('Please login to switch package.', 'warning');
            return;
        }

        const res = await fetch('/api/user/switch-package', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({ packageId })
        });

        const data = await res.json();
        if (data.success && data.user) {
            currentUserDocData = data.user;
            
            // Re-populate dropdown so selection is maintained
            populateConfigSelector(data.user);
            
            showNotification(`Switched active package to: ${data.activePackage?.planName || data.user.plan}!`, 'success');
            
            // Render immediate usage stats for this specific package if returned
            if (data.usage) {
                const immediateUser = {
                    ...data.user,
                    configLink: data.usage.configLink,
                    subLink: data.usage.subLink,
                    sni: data.usage.sni,
                    host: data.usage.host,
                    port: data.usage.port,
                    target: data.usage.target,
                    panelId: data.usage.panelId,
                    panelName: data.usage.panelName,
                    plan: data.usage.plan || data.user.plan,
                    expiryTime: data.usage.expiryTime,
                    packages: data.user.packages || []
                };
                renderStatsDashboard(data.usage, immediateUser);
            }
            
            // Reload fresh live stats for this specific package
            await loadUsageStats(data.user, packageId, true);
        } else {
            showNotification(data.message || 'Failed to switch package.', 'error');
        }
    } catch (err) {
        console.error('Switch package error:', err);
        showNotification(err.message || 'Error switching package.', 'error');
    } finally {
        showLoader(false);
    }
}

function handleConfigSelectorChange(val) {
    const deleteBtn = document.getElementById('btnDeleteSelectedConfig');
    if (deleteBtn) {
        deleteBtn.style.display = (val && val !== '' && val !== 'No Active Package') ? 'inline-flex' : 'none';
    }
    switchActivePackage(val);
}

// Triggered when user clicks Delete button next to config dropdown on Dashboard
function deleteCurrentSelectedPackage() {
    const selector = document.getElementById('configSelector');
    if (!selector || !selector.value || selector.value === '' || selector.value === 'No Active Package') {
        showNotification('Please select a valid configuration to delete.', 'warning');
        return;
    }
    const pkgId = selector.value;
    const pkgName = selector.options[selector.selectedIndex]?.text || 'this configuration';
    confirmAndDeletePackage(pkgId, pkgName);
}

// Triggered when user clicks Delete button on active package card
function deleteCurrentActivePackage() {
    const selector = document.getElementById('configSelector');
    const activeId = selector?.value || currentUserDocData?.active_package_id || 'active-xui';
    const pkgName = currentUserDocData?.plan || 'Active Package';
    confirmAndDeletePackage(activeId, pkgName);
}

// Universal package delete function with instantaneous optimistic UI update
async function confirmAndDeletePackage(packageId, packageName) {
    if (!packageId) return;
    const displayName = packageName || 'this configuration';
    const confirmed = confirm(`Are you sure you want to delete "${displayName}"?\n\nමෙම Configuration file එක ඔබගේ Account එකෙන් සම්පූර්ණයෙන්ම ඉවත් කෙරේ.`);
    if (!confirmed) return;

    const token = localStorage.getItem('jwt_token') || jwtToken;
    if (!token) {
        showNotification('Please login to delete configuration.', 'warning');
        return;
    }

    // 1. INSTANT OPTIMISTIC UI REMOVAL (ZERO WAITING, NO FULL-SCREEN SPINNER)
    if (currentUserDocData && Array.isArray(currentUserDocData.packages)) {
        currentUserDocData.packages = currentUserDocData.packages.filter(p => p.id !== packageId && p.configLink !== packageId);
        if (currentUserDocData.active_package_id === packageId) {
            currentUserDocData.active_package_id = currentUserDocData.packages[0] ? currentUserDocData.packages[0].id : null;
        }
        populateConfigSelector(currentUserDocData);
    }
    showNotification(`Deleted "${displayName}" successfully!`, 'success');

    // 2. Background sync with backend
    try {
        const res = await fetch(`/api/user/packages/${encodeURIComponent(packageId)}`, {
            method: 'DELETE',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            }
        });
        const data = await res.json();
        if (data.success && data.user) {
            currentUserDocData = data.user;
            populateConfigSelector(currentUserDocData);
        }
    } catch (err) {
        console.warn('Background package delete sync:', err.message);
    }
}

function loadConfigStats(val) {
    switchActivePackage(val);
}

function copySpecificLink(link) {
    if (!link) return;
    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(link).then(() => {
            showNotification('Configuration link copied to clipboard!', 'success');
        }).catch(() => {
            fallbackCopyText(link);
        });
    } else {
        fallbackCopyText(link);
    }
}

function fallbackCopyText(text) {
    const temp = document.createElement('textarea');
    temp.value = text;
    temp.style.position = 'fixed';
    temp.style.left = '-9999px';
    document.body.appendChild(temp);
    temp.select();
    document.execCommand('copy');
    document.body.removeChild(temp);
    showNotification('Configuration link copied to clipboard!', 'success');
}

// User on-demand config re-sync
async function syncUserConfig() {
    showLoader(true);
    try {
        const token = localStorage.getItem('jwt_token');
        const res = await fetch('/api/user/generate-config', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            }
        });
        const data = await res.json();
        if (data.success) {
            const labelDesc = data.target === 'address' ? `Address: ${data.host}` : `SNI: ${data.sni}`;
            showNotification(`Config generated on ${data.panelName || 'Server'}! ${labelDesc} (Port ${data.port || 443})`, 'success');
            await loadUserDashboard();
        } else {
            showNotification(data.message || 'Failed to generate config', 'error');
        }
    } catch (e) {
        showNotification(e.message, 'error');
    } finally {
        showLoader(false);
    }
}

// Copy to Clipboard
function copySubscriptionLink() {
    const input = document.getElementById('subLinkInput');
    if (input) {
        input.select();
        document.execCommand('copy');
        showNotification('Configuration link copied to clipboard!', 'success');
    }
}

// ----------------------------------------------------
// PACKAGES RENDER & TRANSACTION LOGIC
// ----------------------------------------------------
function getPackageRates(pkgOrCategory, gb) {
    const volume = String(gb);
    let basePrice = 200;
    let baseOrigPrice = null;
    let isOfferExplicit = false;
    let baseCoinCost = 100;
    let baseBonusCoins = 10;
    
    if (pkgOrCategory && typeof pkgOrCategory === 'object') {
        basePrice = Number(pkgOrCategory.price) || 200;
        if (pkgOrCategory.originalPrice && Number(pkgOrCategory.originalPrice) > 0) {
            baseOrigPrice = Number(pkgOrCategory.originalPrice);
        }
        isOfferExplicit = pkgOrCategory.isOffer === true || pkgOrCategory.badge === 'limited' || pkgOrCategory.badge === 'offer' || pkgOrCategory.badge === 'hot';
        if (isOfferExplicit && (!baseOrigPrice || baseOrigPrice <= basePrice)) {
            baseOrigPrice = Math.round(basePrice * 1.5);
        }
        baseCoinCost = Number(pkgOrCategory.coinCost) || 100;
        baseBonusCoins = Number(pkgOrCategory.bonusCoins) || 10;
    }
    
    let step = 0;
    let coinMult = 1.0;
    if (volume === '100') {
        step = 0; coinMult = 1.0;
    } else if (volume === '200') {
        step = 100; coinMult = 1.5;
    } else if (volume === '300') {
        step = 200; coinMult = 2.0;
    } else if (volume === 'Unlimited' || volume === 'Unlimited GB') {
        step = 300; coinMult = 2.5;
    }
    
    const price = basePrice + step;
    const originalPrice = baseOrigPrice ? (baseOrigPrice + step) : null;
    const hasOffer = Boolean(originalPrice && originalPrice > price);
    const discountPercent = hasOffer ? Math.round(((originalPrice - price) / originalPrice) * 100) : 0;
    const coinCost = Math.round(baseCoinCost * coinMult);
    const bonusCoins = Math.round(baseBonusCoins * coinMult);
    
    return { price, originalPrice, hasOffer, discountPercent, coinCost, bonusCoins };
}

function handleGbChange(selectElement, pkgId, isSpeedPack) {
    const gb = selectElement.value;
    const pkg = availablePackages.find(p => p.id === pkgId) || { id: pkgId, category: isSpeedPack ? 'speed' : 'speed_limit' };
    const rates = getPackageRates(pkg, gb);
    
    const card = selectElement.closest('.package-card');
    if (card) {
        const priceWrap = card.querySelector('.package-price-wrap');
        if (priceWrap) {
            if (rates.hasOffer && rates.originalPrice) {
                priceWrap.innerHTML = `
                    <span class="package-original-price">LKR ${rates.originalPrice.toFixed(2)}</span>
                    <span class="package-price offer-active">LKR ${rates.price.toFixed(2)}</span>
                    <span class="package-discount-pill"><i class="fas fa-arrow-trend-down"></i> ${rates.discountPercent}% OFF</span>
                `;
            } else {
                priceWrap.innerHTML = `<span class="package-price">LKR ${rates.price.toFixed(2)}</span>`;
            }
        }
        card.querySelector('.btn-buy-coins').innerHTML = `<i class="fas fa-coins text-gold"></i> Buy with ${rates.coinCost} Coins`;
        card.querySelector('.spec-bonus-coins').innerHTML = `<i class="fas fa-coins text-gold"></i> Earn +${rates.bonusCoins} Data Coins`;
        card.querySelector('.spec-limit-gb').innerHTML = `<i class="fas fa-database"></i> <span>${gb}${gb === 'Unlimited' ? '' : ' GB'} / 30 Days</span>`;
        
        const orderBtn = card.querySelector('.btn-order-now');
        const buyCoinsBtn = card.querySelector('.btn-buy-coins');
        const pkgName = card.querySelector('.package-name-header').textContent;
        
        orderBtn.onclick = () => openSlipModal(pkgId, pkgName, rates.price, gb, rates.bonusCoins);
        buyCoinsBtn.onclick = () => handleRedeemCoins(pkgId, rates.coinCost, gb, rates.bonusCoins);
    }
}

function renderPackages() {
    const speedGrid = document.getElementById('speedPackagesListGrid');
    const speedLimitGrid = document.getElementById('speedLimitPackagesListGrid');
    if (!speedGrid || !speedLimitGrid) return;
    
    // Save currently selected GB values of each card to prevent auto-reset on polling refresh
    const selectedGbs = {};
    document.querySelectorAll('.package-card').forEach(card => {
        const pkgId = card.dataset.pkgId;
        const selector = card.querySelector('.gb-selector');
        if (pkgId && selector) {
            selectedGbs[pkgId] = selector.value;
        }
    });
    
    speedGrid.innerHTML = '';
    speedLimitGrid.innerHTML = '';
    
    availablePackages.forEach(pkg => {
        const card = document.createElement('div');
        card.className = 'package-card';
        card.dataset.pkgId = pkg.id; // Store pkg ID
        
        // Restore selection if exists, otherwise default to '100'
        const activeGb = selectedGbs[pkg.id] || '100';
        const rates = getPackageRates(pkg, activeGb);
        
        let badgeHtml = '';
        if (pkg.badge === 'vesak') {
            badgeHtml = '<div class="holiday-badge"><i class="fas fa-dharmachakra"></i> Vesak</div>';
        } else if (pkg.badge === 'limited') {
            badgeHtml = '<div class="limited-badge"><i class="fas fa-bolt"></i> Limited</div>';
        } else if (pkg.badge === 'offer') {
            badgeHtml = '<div class="offer-badge"><i class="fas fa-tag"></i> Offer</div>';
        } else if (pkg.badge === 'hot') {
            badgeHtml = '<div class="hot-badge"><i class="fas fa-fire"></i> Hot Deal</div>';
        } else if (rates.hasOffer) {
            badgeHtml = '<div class="limited-badge"><i class="fas fa-bolt"></i> Limited</div>';
        }
        
        const textStyle = pkg.network === 'Airtel' ? 'color: #ef4444;' : pkg.network === 'Dialog' ? 'color: #10b981;' : 'color: #3b82f6;';
        
        card.innerHTML = `
            ${badgeHtml}
            <div class="package-header">
                <h4 style="${textStyle}" class="package-name-header">${pkg.name}</h4>
                <div class="package-price-wrap">
                    ${rates.hasOffer && rates.originalPrice ? `
                        <span class="package-original-price">LKR ${rates.originalPrice.toFixed(2)}</span>
                        <span class="package-price offer-active">LKR ${rates.price.toFixed(2)}</span>
                        <span class="package-discount-pill"><i class="fas fa-arrow-trend-down"></i> ${rates.discountPercent}% OFF</span>
                    ` : `
                        <span class="package-price">LKR ${rates.price.toFixed(2)}</span>
                    `}
                </div>
            </div>
            
            <div class="package-body">
                <div class="spec-item spec-limit-gb">
                    <i class="fas fa-database"></i>
                    <span>${activeGb}${activeGb === 'Unlimited' ? '' : ' GB'} / 30 Days</span>
                </div>
                
                <div class="form-group" style="margin-top: 0.75rem; margin-bottom: 0.75rem;">
                    <label style="font-size: 0.85rem; font-weight: 700; display: block; margin-bottom: 0.35rem; color: var(--text-primary);">Select Data Volume (GB):</label>
                    <select class="form-control gb-selector" onchange="handleGbChange(this, '${pkg.id}', ${pkg.category === 'speed' ? 'true' : 'false'})" style="padding: 0.65rem 0.85rem; border-radius: 12px; font-size: 0.95rem; font-weight: 700; outline: none; background: var(--bg-card); color: var(--text-primary); border: 2px solid var(--primary); width: 100%; cursor: pointer;">
                        <option value="100" ${activeGb === '100' ? 'selected' : ''}>100 GB (Default)</option>
                        <option value="200" ${activeGb === '200' ? 'selected' : ''}>200 GB</option>
                        <option value="300" ${activeGb === '300' ? 'selected' : ''}>300 GB</option>
                        <option value="Unlimited" ${activeGb === 'Unlimited' ? 'selected' : ''}>Unlimited GB</option>
                    </select>
                </div>
 
                <div class="spec-item">
                    <i class="fas fa-network-wired"></i>
                    <span>${(pkg.desc || '').replace(/\s*\([^)]*\.[a-z]{2,}[^)]*\)/gi, '').trim()}</span>
                </div>
                <div class="spec-item" style="color: var(--primary); font-weight: 600;">
                    <i class="fas fa-satellite-dish"></i>
                    <span>${pkg.target === 'address' ? 'Host Address' : 'SNI Bug'}: <code>Auto</code> <span class="badge" style="font-size: 0.7rem; padding: 0.15rem 0.4rem; background: var(--bg-hover); border-radius: 4px; margin-left: 4px;">Port ${pkg.port || 443}</span></span>
                </div>
                ${pkg.promo ? `<div class="promo-tag ${rates.hasOffer ? 'offer-promo' : ''}"><i class="fas ${rates.hasOffer ? 'fa-fire' : 'fa-certificate'}"></i> ${pkg.promo}</div>` : ''}
                <div class="spec-item">
                    <i class="fas fa-server"></i>
                    <span>${pkg.server}</span>
                </div>
                <div class="spec-item spec-muted">
                    <i class="fas fa-users"></i>
                    <span>${pkg.remaining.toLocaleString()} accounts remaining today</span>
                </div>
                <div class="spec-item spec-bonus-coins" style="color: #fbbf24; font-weight: 700;">
                    <i class="fas fa-coins text-gold"></i>
                    <span>Earn +${rates.bonusCoins} Data Coins</span>
                </div>
            </div>
            
            <div class="package-footer">
                <button class="btn btn-primary btn-block btn-order-now" onclick="openSlipModal('${pkg.id}', '${pkg.name}', ${rates.price}, '${activeGb}', ${rates.bonusCoins})">
                    <i class="fas fa-cart-shopping"></i> Order Now
                </button>
                <button class="btn-buy-coins" onclick="handleRedeemCoins('${pkg.id}', ${rates.coinCost}, '${activeGb}', ${rates.bonusCoins})">
                    <i class="fas fa-coins text-gold"></i> Buy with ${rates.coinCost} Coins
                </button>
            </div>
        `;
        
        if (pkg.category === 'speed') {
            speedGrid.appendChild(card);
        } else {
            speedLimitGrid.appendChild(card);
        }
    });
}

function filterPackages() {
    const queryInput = document.getElementById('packageSearchInput');
    const query = queryInput.value.trim();
    
    if (query.toLowerCase() === 'admin') {
        queryInput.value = '';
        const cards = document.querySelectorAll('.packages-grid .package-card');
        cards.forEach(card => card.style.display = 'flex');
        openAdminLoginModal();
        return;
    }
    
    const cards = document.querySelectorAll('.packages-grid .package-card');
    cards.forEach(card => {
        const text = card.textContent.toLowerCase();
        card.style.display = text.includes(query.toLowerCase()) ? 'flex' : 'none';
    });
}

function openSlipModal(planId, planName, price, selectedGb = '100', bonusCoins = 20, packageId = null, isRenewal = false) {
    if (!isLoggedIn) {
        showNotification('Please login to place an order.', 'error');
        return;
    }
    
    document.getElementById('modalPackageName').textContent = `${planName} (${selectedGb} GB)`;
    document.getElementById('modalPackagePrice').textContent = `LKR ${price.toFixed(2)}`;
    document.getElementById('modalPlanId').value = planId;
    document.getElementById('modalPlanPrice').value = price;
    
    window.modalSelectedGb = selectedGb;
    window.modalBonusCoins = bonusCoins;
    window.modalPackageId = packageId;
    window.modalIsRenewal = !!isRenewal;
    
    document.getElementById('slipFileInput').value = '';
    document.getElementById('slipPreviewContainer').style.display = 'none';
    const titleEl = document.getElementById('uploadCardTitle');
    if (titleEl) {
        titleEl.textContent = 'Select your receipt image';
        titleEl.style.color = '';
    }
    
    document.getElementById('slipModal').style.display = 'flex';
}

function closeSlipModal() {
    document.getElementById('slipModal').style.display = 'none';
}

// Admin Login Modal controls
function openAdminLoginModal() {
    document.getElementById('adminLoginForm').reset();
    document.getElementById('adminLoginError').style.display = 'none';
    document.getElementById('adminLoginModal').style.display = 'flex';
}

function closeAdminLoginModal() {
    document.getElementById('adminLoginModal').style.display = 'none';
}

function handleAdminLogin(event) {
    event.preventDefault();
    const userVal = document.getElementById('adminUsernameInput').value.trim();
    const passVal = document.getElementById('adminPasswordInput').value;
    
    const userEmail = currentUserDetails?.email || '';
    if (userVal === 'admin' && passVal === 'fordelk@admin' && isSystemAdminEmail(userEmail)) {
        isAdminUnlocked = true;
        currentUserRole = 'admin';
        
        // Show Admin Navigation Link
        document.getElementById('adminTabNav').style.display = 'block';
        
        // If in Guest Mode, update guest user registry details
        if (isGuestMode) {
            const guestClientIdx = guestClients.findIndex(c => c.email === currentUserDetails.email);
            if (guestClientIdx !== -1) {
                guestClients[guestClientIdx].role = 'admin';
            }
            renderGuestAdminClients();
        }
        
        closeAdminLoginModal();
        showNotification('✓ Admin panel unlocked successfully!', 'success');
        switchTab('admin');
    } else {
        document.getElementById('adminLoginError').style.display = 'flex';
    }
}

function previewSlipImage(event) {
    const file = event.target.files[0];
    if (file) {
        const titleEl = document.getElementById('uploadCardTitle');
        if (titleEl) {
            titleEl.textContent = `Selected: ${file.name}`;
            titleEl.style.color = 'var(--success)';
        }
        const reader = new FileReader();
        reader.onload = function() {
            const img = document.getElementById('slipPreviewImg');
            img.src = reader.result;
            document.getElementById('slipPreviewContainer').style.display = 'block';
        };
        reader.readAsDataURL(file);
    }
}

// Compress receipt image file to lightweight ~150KB JPEG before upload (instant upload on mobile network)
function compressImageBeforeUpload(file, maxWidth = 1200, quality = 0.75) {
    return new Promise((resolve) => {
        if (!file || !file.type || !file.type.startsWith('image/')) {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.onerror = () => resolve(null);
            reader.readAsDataURL(file);
            return;
        }

        const reader = new FileReader();
        reader.onload = function(e) {
            const img = new Image();
            img.onload = function() {
                let width = img.width;
                let height = img.height;

                // Scale down if larger than maxWidth
                if (width > maxWidth) {
                    height = Math.round((height * maxWidth) / width);
                    width = maxWidth;
                }

                const canvas = document.createElement('canvas');
                canvas.width = width;
                canvas.height = height;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0, width, height);

                // Export as clean compressed JPEG (~100-200 KB)
                const compressedDataUrl = canvas.toDataURL('image/jpeg', quality);
                resolve(compressedDataUrl);
            };
            img.onerror = function() {
                resolve(e.target.result);
            };
            img.src = e.target.result;
        };
        reader.onerror = function() {
            resolve(null);
        };
        reader.readAsDataURL(file);
    });
}

// Handle Manual Payment Slip Submit
async function handleSlipSubmit(event) {
    event.preventDefault();
    
    const submitBtn = event.target.querySelector('button[type="submit"]') || event.target.querySelector('.btn-primary');
    const originalBtnText = submitBtn ? submitBtn.innerHTML : '';
    if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Submitting Slip...';
    }
    
    const planId = document.getElementById('modalPlanId').value;
    const planPrice = parseFloat(document.getElementById('modalPlanPrice').value);
    const fileInput = document.getElementById('slipFileInput');
    
    if (fileInput.files.length === 0) {
        showNotification('Please select a receipt slip photo file to upload.', 'error');
        if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.innerHTML = originalBtnText;
        }
        return;
    }
    
    const file = fileInput.files[0];
    const selectedGb = window.modalSelectedGb || '100';
    const bonusCoins = window.modalBonusCoins || 20;
    const packageId = window.modalPackageId || null;
    const isRenewal = !!window.modalIsRenewal;
    
    try {
        // Compress photo to lightweight ~150KB in milliseconds so upload finishes in 0.3s
        const base64Data = await compressImageBeforeUpload(file, 1200, 0.75);
        if (!base64Data) {
            throw new Error('Failed to process receipt image file.');
        }

        if (isGuestMode) {
            const newSlip = {
                planId: planId,
                price: planPrice,
                slipUrl: base64Data,
                status: 'pending',
                created_at: new Date(),
                selected_gb: selectedGb,
                bonus_coins: bonusCoins,
                package_id: packageId,
                is_renewal: isRenewal,
                days: 30
            };
            guestUserSlips.unshift(newSlip);
            guestSlips.unshift({
                id: 'gs_' + Date.now(),
                email: currentUserDetails.email,
                planId: planId,
                price: planPrice,
                slipUrl: base64Data,
                status: 'pending',
                selected_gb: selectedGb,
                bonus_coins: bonusCoins,
                package_id: packageId,
                is_renewal: isRenewal,
                days: 30,
                created_at: new Date()
            });
            showNotification('Payment receipt submitted successfully! Pending approval.', 'success');
            closeSlipModal();
            renderGuestOrders();
            renderGuestAdminSlips();
            switchTab('orders');
            return;
        }

        const response = await apiFetch('/api/slips/submit', {
            method: 'POST',
            body: JSON.stringify({
                planId: planId,
                price: planPrice,
                slipUrl: base64Data,
                selectedGb: selectedGb,
                bonusCoins: bonusCoins,
                packageId: packageId,
                isRenewal: isRenewal,
                days: 30
            })
        });
        const data = await response.json();
        if (data.success) {
            showNotification('Payment receipt submitted successfully! Pending approval.', 'success');
            closeSlipModal();
            switchTab('orders');

            // Optimistically insert new slip row immediately (0ms visual feedback)
            const historyBody = document.getElementById('userSlipsHistoryBody');
            if (historyBody) {
                if (historyBody.innerHTML.includes('No order history found')) {
                    historyBody.innerHTML = '';
                }
                const tr = document.createElement('tr');
                tr.className = 'order-card-row';
                const createdDate = new Date().toLocaleString();
                const planIdText = getPlanDisplayName(planId);
                const priceVal = parseFloat(planPrice) || 0;
                const safeUrl = base64Data.replace(/'/g, "\\'");
                tr.innerHTML = `
                    <td>
                        <span class="mobile-td-label"><i class="fas fa-calendar-alt"></i> Date</span>
                        <span class="order-td-value">${createdDate}</span>
                    </td>
                    <td>
                        <span class="mobile-td-label"><i class="fas fa-box"></i> Package</span>
                        <span class="order-td-value"><strong>${planIdText}${selectedGb ? ` (${selectedGb} GB)` : ''}</strong></span>
                    </td>
                    <td>
                        <span class="mobile-td-label"><i class="fas fa-tag"></i> Price</span>
                        <span class="order-td-value"><strong>LKR ${priceVal.toFixed(2)}</strong></span>
                    </td>
                    <td>
                        <span class="mobile-td-label"><i class="fas fa-receipt"></i> Payment Slip</span>
                        <span class="order-td-value"><img src="${base64Data}" class="thumbnail-slip" onclick="viewFullImage('${safeUrl}')" alt="Slip Receipt"></span>
                    </td>
                    <td>
                        <span class="mobile-td-label"><i class="fas fa-info-circle"></i> Status</span>
                        <span class="order-td-value"><span class="badge-status pending">PENDING</span></span>
                    </td>
                `;
                historyBody.insertBefore(tr, historyBody.firstChild);
            }

            // Sync from backend
            fetchUserSlips();
        } else {
            showNotification(data.message || 'Failed to submit slip.', 'error');
        }
    } catch (err) {
        console.error('Slip upload error:', err);
        showNotification('Failed to upload receipt slip. Please try again.', 'error');
    } finally {
        if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.innerHTML = originalBtnText;
        }
    }
}

// Real-time Slips History listener for user orders
let slipsListener = null;
function initSlipsListener() {
    // Replaced by startUserSlipsPolling()
}

// Expand full-size thumbnail image helper
function viewFullImage(url) {
    const modal = document.createElement('div');
    modal.className = 'modal-backdrop';
    modal.onclick = () => modal.remove();
    modal.innerHTML = `
        <div style="max-width: 90%; max-height: 90%;">
            <img src="${url}" style="max-width: 100%; max-height: 100vh; border-radius: 12px; box-shadow: var(--shadow-modal);" alt="Receipt Full">
        </div>
    `;
    document.body.appendChild(modal);
}

// Coins redemption logic
async function handleRedeemCoins(planId, cost, selectedGb = '100', bonusCoins = 20) {
    if (!isLoggedIn) {
        showNotification('Please login to redeem package.', 'error');
        return;
    }
    
    if (currentUserCoins < cost) {
        showNotification(`Insufficient Coins! You need at least ${cost} coins inside your wallet.`, 'error');
        return;
    }
    
    const cleanPlanName = planId.replace(/_/g, ' ') + ` (${selectedGb} GB)`;
    if (!confirm(`Redeem package: ${cleanPlanName} using ${cost} coins? This activates it instantly.`)) return;
    
    showLoader(true);
    
    if (isGuestMode) {
        currentUserCoins -= cost;
        document.getElementById('userCoinsBalance').textContent = `${Math.floor(currentUserCoins)} Coins`;
        const marketCoinBalEl = document.getElementById('marketCoinBalance');
        if (marketCoinBalEl) {
            marketCoinBalEl.textContent = `${Math.floor(currentUserCoins)} Coins`;
        }
        guestUserSlips.unshift({
            planId: planId,
            price: 0.00,
            slipUrl: 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect width="100%" height="100%" fill="%23fbbf24"/><text x="10" y="50" fill="white" font-weight="bold">COIN REDEEM</text></svg>',
            status: 'approved',
            selected_gb: selectedGb,
            bonus_coins: 0,
            days: 30,
            created_at: new Date()
        });
        
        // Update guest client details expiry & plan name
        const clientIdx = guestClients.findIndex(c => c.email === currentUserDetails.email);
        if (clientIdx !== -1) {
            guestClients[clientIdx].plan = cleanPlanName;
            guestClients[clientIdx].coins = currentUserCoins;
            const currentExpiry = guestClients[clientIdx].expiryTime || Date.now();
            const extendFrom = currentExpiry > Date.now() ? currentExpiry : Date.now();
            guestClients[clientIdx].expiryTime = extendFrom + 30 * 24 * 60 * 60 * 1000;
        }
        
        showNotification(`✓ Successfully redeemed the ${cleanPlanName} (Guest Mode)!`, 'success');
        renderGuestOrders();
        renderGuestAccounts();
        await loadGuestUsageStats();
        switchTab('dashboard');
        showLoader(false);
        return;
    }
    
    try {
        const response = await apiFetch('/api/user/renew-coins', {
            method: 'POST',
            body: JSON.stringify({
                planId: planId,
                coinCost: cost,
                days: 30,
                selectedGb: selectedGb
            })
        });
        const data = await response.json();
        if (data.success) {
            showNotification(`✓ Successfully redeemed the ${cleanPlanName}!`, 'success');
            currentUserCoins -= cost;
            document.getElementById('userCoinsBalance').textContent = `${Math.floor(currentUserCoins)} Coins`;
            fetchUserProfile();
            switchTab('dashboard');
        } else {
            showNotification(data.message || 'Transaction failed. Please try again.', 'error');
            showLoader(false);
        }
    } catch(err) {
        console.error('Transaction redemption failed:', err.message);
        showNotification(err.message || 'Transaction failed. Please try again.', 'error');
        showLoader(false);
    }
}

// ----------------------------------------------------
// FREE CONFIGS EXCHANGE LOGIC
// ----------------------------------------------------
function getPlanDisplayName(planId) {
    if (planId.startsWith('config_')) {
        const configId = planId.replace('config_', '');
        const list = isGuestMode ? guestConfigs : (window.allConfigsList || []);
        const config = list.find(c => String(c.id) === String(configId));
        return config ? `Config: ${config.title}` : `Config #${configId}`;
    } else {
        return planId.replace(/_/g, ' ');
    }
}

function buyConfigWithCash(configId, title, price) {
    if (!isLoggedIn) {
        showNotification('Please login to place an order.', 'error');
        return;
    }
    openSlipModal('config_' + configId, `Config: ${title}`, price);
}

async function loadConfigsMarket() {
    const freeGrid = document.getElementById('freeConfigsListGrid');
    const premiumGrid = document.getElementById('premiumConfigsListGrid');
    if (!freeGrid) return;
    
    const marketCoinBalEl = document.getElementById('marketCoinBalance');
    if (marketCoinBalEl) {
        marketCoinBalEl.textContent = `${Math.floor(currentUserCoins)} Coins`;
    }
    
    if (isGuestMode) {
        renderGuestConfigsMarket();
        return;
    }
    
    freeGrid.innerHTML = '<div style="grid-column:1/-1; text-align:center; padding: 2rem;"><i class="fas fa-spinner fa-spin" style="font-size: 1.25rem;"></i> Loading...</div>';
    if (premiumGrid) {
        premiumGrid.innerHTML = '<div style="grid-column:1/-1; text-align:center; padding: 2rem;"><i class="fas fa-spinner fa-spin" style="font-size: 1.25rem;"></i> Loading...</div>';
    }
    
    try {
        const response = await fetch('/api/configs');
        const data = await response.json();
        if (data.success && data.configs) {
            window.allConfigsList = data.configs;
            
            if (data.configs.length === 0) {
                freeGrid.innerHTML = '<div style="grid-column:1/-1; text-align:center; color: var(--text-muted); padding: 2rem;">No free configurations available.</div>';
                if (premiumGrid) {
                    premiumGrid.innerHTML = '<div style="grid-column:1/-1; text-align:center; color: var(--text-muted); padding: 2rem;">No premium configurations available.</div>';
                }
                return;
            }
            
            freeGrid.innerHTML = '';
            if (premiumGrid) premiumGrid.innerHTML = '';
            
            let freeCount = 0;
            let premiumCount = 0;
            
            data.configs.forEach(config => {
                const configId = config.id;
                const isUnlocked = userUnlockedConfigs.includes(configId) || (config.coinCost === 0 && config.price === 0);
                
                const card = document.createElement('div');
                card.className = `config-market-card ${isUnlocked ? 'unlocked' : 'locked'}`;
                
                if (isUnlocked) {
                    const deleteBtnHtml = (currentUserRole === 'admin' || isAdminUnlocked) ? `
                        <button type="button" class="btn btn-sm" onclick="deleteFreeConfig('${configId}')" style="margin-top: 0.6rem; width: 100%; padding: 0.4rem; font-size: 0.75rem; background: rgba(239, 68, 68, 0.1); color: #ef4444; border: 1px solid rgba(239, 68, 68, 0.2); border-radius: 8px; cursor: pointer;">
                            <i class="fas fa-trash-alt"></i> Delete Config
                        </button>
                    ` : '';
                    card.innerHTML = `
                        <span class="network-badge">${config.isp}</span>
                        <h4>${config.title}</h4>
                        <p style="color: var(--success); font-weight:700;"><i class="fas fa-circle-check"></i> Unlocked / Free</p>
                        
                        <div class="form-group" style="margin-top: 0.5rem; margin-bottom: 0;">
                             <div class="sub-link-input-group">
                                  <input type="text" class="sub-link-input" id="freeLink-${configId}" readonly value="${config.config}">
                                  <button class="btn-sub primary" onclick="copyFreeLink('${configId}')"><i class="fas fa-copy"></i> Copy</button>
                             </div>
                        </div>
                        ${deleteBtnHtml}
                    `;
                } else {
                    let unlockButtonsHtml = '';
                    if (config.coinCost > 0) {
                        unlockButtonsHtml += `
                             <button class="btn-unlock-config" onclick="unlockFreeConfig('${configId}', ${config.coinCost})" style="width: 100%;">
                                  <i class="fas fa-coins text-gold"></i> Unlock with ${config.coinCost} Coins
                             </button>
                        `;
                    }
                    if (config.price > 0) {
                        unlockButtonsHtml += `
                             <button class="btn-unlock-config" style="margin-top: 0.5rem; background: linear-gradient(135deg, #ec4899 0%, #8b5cf6 100%); width: 100%;" onclick="buyConfigWithCash('${configId}', '${config.title.replace(/'/g, "\\'")}', ${config.price})">
                                  <i class="fas fa-credit-card"></i> Buy for LKR ${config.price.toFixed(2)}
                             </button>
                        `;
                    }
                    card.innerHTML = `
                        <span class="network-badge">${config.isp}</span>
                        <h4>${config.title}</h4>
                        <p style="color: var(--text-secondary); font-size: 0.8rem;">Requires coins or payment to unlock payload details.</p>
                        
                        <div class="config-lock-overlay" style="padding: 1rem 0.5rem;">
                             <div class="lock-icon-circle">
                                  <i class="fas fa-lock"></i>
                             </div>
                             ${unlockButtonsHtml}
                        </div>
                    `;
                }
                
                if (config.coinCost === 0 && config.price === 0) {
                    freeGrid.appendChild(card);
                    freeCount++;
                } else if (premiumGrid) {
                    premiumGrid.appendChild(card);
                    premiumCount++;
                }
            });
            
            if (freeCount === 0) {
                freeGrid.innerHTML = '<div style="grid-column:1/-1; text-align:center; color: var(--text-muted); padding: 2rem;">No free configurations available.</div>';
            }
            if (premiumGrid && premiumCount === 0) {
                premiumGrid.innerHTML = '<div style="grid-column:1/-1; text-align:center; color: var(--text-muted); padding: 2rem;">No premium configurations available.</div>';
            }
        }
    } catch(err) {
        console.error('Market error:', err);
        freeGrid.innerHTML = '<div style="grid-column:1/-1; text-align:center; color: var(--danger); padding: 2rem;">Failed to load free configs.</div>';
        if (premiumGrid) {
            premiumGrid.innerHTML = '<div style="grid-column:1/-1; text-align:center; color: var(--danger); padding: 2rem;">Failed to load premium configs.</div>';
        }
    }
}

function copyFreeLink(id) {
    const input = document.getElementById(`freeLink-${id}`);
    if (input) {
        input.select();
        document.execCommand('copy');
        showNotification('Config copied successfully!', 'success');
    }
}

function openAddFreeConfigModal() {
    const modal = document.getElementById('addFreeConfigModal');
    if (modal) {
        modal.style.display = 'flex';
        const input = document.getElementById('quickConfigTitle');
        if (input) setTimeout(() => input.focus(), 100);
    }
}

function closeAddFreeConfigModal() {
    const modal = document.getElementById('addFreeConfigModal');
    if (modal) modal.style.display = 'none';
}

async function handleQuickAddFreeConfig(event) {
    event.preventDefault();
    const title = document.getElementById('quickConfigTitle').value.trim();
    const isp = document.getElementById('quickConfigIsp').value;
    const config = document.getElementById('quickConfigText').value.trim();
    
    if (!title || !config) {
        showNotification('Please fill in both title and config string.', 'warning');
        return;
    }
    
    showLoader(true);
    try {
        const res = await apiFetch('/api/configs/publish', {
            method: 'POST',
            body: JSON.stringify({
                title,
                isp,
                config,
                coinCost: 0,
                price: 0
            })
        });
        const data = await res.json();
        if (data.success) {
            showNotification('✓ Free Config published successfully!', 'success');
            document.getElementById('quickAddFreeConfigForm').reset();
            closeAddFreeConfigModal();
            loadConfigsMarket();
        } else {
            showNotification(data.message || 'Failed to publish configuration.', 'error');
        }
    } catch (err) {
        console.error('Publish free config error:', err);
        showNotification('Failed to publish configuration.', 'error');
    } finally {
        showLoader(false);
    }
}

async function deleteFreeConfig(configId) {
    if (!confirm('Are you sure you want to delete this free configuration?')) return;
    const card = document.getElementById(`freeConfigCard-${configId}`);
    if (card) {
        card.style.transition = 'all 0.3s ease';
        card.style.opacity = '0';
        card.style.transform = 'scale(0.95)';
        setTimeout(() => card.remove(), 300);
    }
    showNotification('✓ Free config deleted successfully.', 'success');
    try {
        const res = await apiFetch(`/api/configs/${configId}`, {
            method: 'DELETE'
        });
        const data = await res.json();
        if (!data.success) {
            showNotification(data.message || 'Failed to delete configuration.', 'error');
            loadConfigsMarket();
        }
    } catch (err) {
        console.error('Delete config error:', err);
    }
}

async function unlockFreeConfig(configId, cost) {
    if (!isLoggedIn) {
        showNotification('Please login to unlock configurations.', 'error');
        return;
    }
    
    if (currentUserCoins < cost) {
        showNotification('Insufficient coins inside your wallet!', 'error');
        return;
    }
    
    if (!confirm(`Unlock this V2Ray configuration line using ${cost} coins?`)) return;
    
    showLoader(true);
    
    if (isGuestMode) {
        currentUserCoins -= cost;
        userUnlockedConfigs.push(configId);
        document.getElementById('userCoinsBalance').textContent = `${Math.floor(currentUserCoins)} Coins`;
        const marketCoinBalEl = document.getElementById('marketCoinBalance');
        if (marketCoinBalEl) {
            marketCoinBalEl.textContent = `${Math.floor(currentUserCoins)} Coins`;
        }
        showNotification('Config unlocked successfully in Guest Mode!', 'success');
        renderGuestConfigsMarket();
        showLoader(false);
        return;
    }
    
    try {
        const response = await apiFetch('/api/configs/unlock', {
            method: 'POST',
            body: JSON.stringify({
                configId: configId,
                cost: cost
            })
        });
        const data = await response.json();
        if (data.success) {
            showNotification('Config unlocked successfully!', 'success');
            // Instantly update local state so UI redraws correctly before next user profile poll
            currentUserCoins -= cost;
            document.getElementById('userCoinsBalance').textContent = `${Math.floor(currentUserCoins)} Coins`;
            userUnlockedConfigs.push(configId);
            loadConfigsMarket();
        } else {
            showNotification(data.message || 'Failed to unlock configuration.', 'error');
        }
        showLoader(false);
    } catch(err) {
        console.error('Unlock error:', err);
        showNotification('Failed to unlock configuration.', 'error');
        showLoader(false);
    }
}

// ----------------------------------------------------
// ADMIN OPERATIONS CONTROL PANEL
// ----------------------------------------------------

async function loadAdminPanel() {
    const userEmail = currentUserDetails?.email || '';
    if (currentUserRole !== 'admin' || !isSystemAdminEmail(userEmail)) return;
    
    if (isGuestMode) {
        renderGuestAdminSlips();
        renderGuestAdminClients();
        refreshAdminChatThreadsList();
        renderAdminPackagesTable();
        return;
    }
    
    loadAdminPendingSlips();
    loadAdminClientsTable();
    initAdminAllChatsListener();
    renderAdminPackagesTable();
}

// Approve / Reject payment receipts
let pendingSlipsListener = null;
function loadAdminPendingSlips() {
    stopAdminSlipsPolling();
    if (isGuestMode) {
        renderGuestAdminSlips();
        return;
    }
    fetchAdminPendingSlips();
    adminSlipsInterval = setInterval(fetchAdminPendingSlips, 5000);
}

function stopAdminSlipsPolling() {
    if (adminSlipsInterval) {
        clearInterval(adminSlipsInterval);
        adminSlipsInterval = null;
    }
}

async function fetchAdminPendingSlips() {
    if (!isLoggedIn || isGuestMode) return;
    const container = document.getElementById('adminPendingSlipsList');
    if (!container) return;
    try {
        const res = await apiFetch('/api/admin/slips/pending');
        const data = await res.json();
        if (data.success && data.slips) {
            document.getElementById('pendingSlipsCount').textContent = data.slips.length;
            
            if (data.slips.length === 0) {
                container.innerHTML = '<div style="text-align: center; color: var(--text-muted); padding: 2rem;">No pending slips found.</div>';
                return;
            }
            
            container.innerHTML = '';
            data.slips.forEach(slip => {
                const date = slip.created_at ? new Date(slip.created_at).toLocaleString() : 'Pending';
                const card = document.createElement('div');
                card.className = 'admin-slip-card';
                card.innerHTML = `
                    <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap: 0.5rem;">
                        <div class="slip-user-info">
                            <h5>${slip.email}</h5>
                            <span>Submitted: ${date}</span>
                        </div>
                        <img src="${slip.slipUrl}" class="thumbnail-slip" style="width:55px; height:55px;" onclick="viewFullImage('${slip.slipUrl}')">
                    </div>
                    
                    <div class="slip-meta-details">
                        <span>Item: <strong>${getPlanDisplayName(slip.planId)}${slip.selected_gb ? ` (${slip.selected_gb} GB)` : ''}</strong></span>
                        <span>Price: <strong>LKR ${slip.price.toFixed(2)}</strong></span>
                    </div>
                    
                    <div class="action-buttons" style="margin-top: 0.25rem;">
                        <button class="btn-sub primary" style="background:#10b981; flex:1; justify-content:center;" onclick="adminProcessSlip('${slip.id}', 'approved')"><i class="fas fa-check"></i> Approve</button>
                        <button class="btn-sub primary" style="background:#ef4444; flex:1; justify-content:center;" onclick="adminProcessSlip('${slip.id}', 'rejected')"><i class="fas fa-times"></i> Reject</button>
                    </div>
                `;
                container.appendChild(card);
            });
        }
    } catch (err) {
        console.error('Fetch pending slips error:', err);
    }
}

// Admin Process Receipt slip
async function adminProcessSlip(slipId, action) {
    if (!confirm(`Are you sure you want to ${action} this slip?`)) return;
    
    showLoader(true);
    
    if (isGuestMode) {
        const idx = guestSlips.findIndex(s => s.id === slipId);
        if (idx !== -1) {
            const slip = guestSlips[idx];
            if (action === 'approved') {
                const clientIdx = guestClients.findIndex(c => c.email === slip.email);
                if (slip.planId.startsWith('config_')) {
                    const configId = slip.planId.replace('config_', '');
                    if (!userUnlockedConfigs.includes(configId)) {
                        userUnlockedConfigs.push(configId);
                    }
                    const userSlipIdx = guestUserSlips.findIndex(s => s.planId === slip.planId && s.status === 'pending');
                    if (userSlipIdx !== -1) guestUserSlips[userSlipIdx].status = 'approved';
                    showNotification(`✓ Slip Approved (Guest Mode)! Configuration unlocked.`, 'success');
                    renderGuestConfigsMarket();
                } else {
                    const mappedPkg = availablePackages.find(p => p.id === slip.planId) || { name: 'Package', bonusCoins: 10, price: 300, days: 30 };
                    const bonusCoinsToAdd = slip.bonus_coins !== undefined ? slip.bonus_coins : (mappedPkg.bonusCoins || 10);
                    const selectedGbOption = slip.selected_gb || '';
                    if (clientIdx !== -1) {
                        guestClients[clientIdx].status = 'active';
                        guestClients[clientIdx].plan = mappedPkg.name.replace(/_/g, ' ') + (selectedGbOption ? ` (${selectedGbOption} GB)` : '');
                        guestClients[clientIdx].coins += bonusCoinsToAdd;
                        guestClients[clientIdx].expiryTime = Date.now() + 30 * 24 * 60 * 60 * 1000;
                    }
                    const userSlipIdx = guestUserSlips.findIndex(s => s.planId === slip.planId && s.status === 'pending');
                    if (userSlipIdx !== -1) guestUserSlips[userSlipIdx].status = 'approved';
                    showNotification(`✓ Slip Approved (Guest Mode)! Mapped plan & credited +${bonusCoinsToAdd} coins.`, 'success');
                }
            } else {
                const userSlipIdx = guestUserSlips.findIndex(s => s.planId === slip.planId && s.status === 'pending');
                if (userSlipIdx !== -1) guestUserSlips[userSlipIdx].status = 'rejected';
                showNotification('✗ Slip rejected (Guest Mode).', 'warning');
            }
            guestSlips.splice(idx, 1);
            renderGuestAdminSlips();
            renderGuestAdminClients();
        }
        showLoader(false);
        return;
    }
    
    try {
        const endpoint = action === 'approved' ? 'approve' : 'reject';
        const response = await apiFetch(`/api/admin/slips/${slipId}/${endpoint}`, {
            method: 'POST'
        });
        const data = await response.json();
        if (data.success) {
            const sniMsg = data.sni ? ` (SNI: ${data.sni})` : '';
            showNotification(`Slip ${action === 'approved' ? 'Approved & Config Auto-Generated' + sniMsg : 'Rejected'}!`, 'success');
            fetchAdminPendingSlips();
            if (adminClientsInterval) fetchAdminClients();
        } else {
            showNotification(data.message || 'Verification execution failed.', 'error');
        }
        showLoader(false);
    } catch(err) {
        console.error('Admin approval error:', err);
        showNotification('Verification execution failed.', 'error');
        showLoader(false);
    }
}

async function adminCleanupOldSlips() {
    if (!confirm('Are you sure you want to clean up all payment slips older than 30 days? This will permanently free up database storage.')) return;
    try {
        showLoader(true);
        const response = await apiFetch('/api/admin/slips/cleanup', { method: 'POST' });
        const data = await response.json();
        showLoader(false);
        if (data.success) {
            showNotification(data.message || 'Cleanup complete!', 'success');
            fetchAdminPendingSlips();
        } else {
            showNotification(data.message || 'Cleanup failed.', 'error');
        }
    } catch(err) {
        showLoader(false);
        showNotification('Cleanup error: ' + err.message, 'error');
    }
}

// Load Registry Clients List
let clientsListener = null;
function loadAdminClientsTable() {
    stopAdminClientsPolling();
    if (isGuestMode) {
        renderGuestAdminClients();
        return;
    }
    fetchAdminClients();
    adminClientsInterval = setInterval(fetchAdminClients, 5000);
}

function stopAdminClientsPolling() {
    if (adminClientsInterval) {
        clearInterval(adminClientsInterval);
        adminClientsInterval = null;
    }
}

async function fetchAdminClients() {
    if (!isLoggedIn || isGuestMode) return;
    const tbody = document.getElementById('adminClientsTableBody');
    if (!tbody) return;
    try {
        const res = await apiFetch('/api/admin/clients');
        const data = await res.json();
        if (data.success && data.clients) {
            if (data.clients.length === 0) {
                tbody.innerHTML = '<tr><td colspan="4" style="text-align:center; padding:1.5rem; color: var(--text-muted);"><i class="fas fa-box-open" style="margin-right:6px;"></i> No package buyers yet. (Users appear here when they purchase a package)</td></tr>';
                return;
            }
            
            tbody.innerHTML = '';
            data.clients.forEach(client => {
                const clientEmail = (client.email || client.phone || 'Unknown').trim();
                const clientName = (client.name || clientEmail.split('@')[0] || 'Client').trim();
                const clientPic = client.picture && client.picture.trim() !== '' ? client.picture : 'assets/images/default-avatar.svg';
                const tr = document.createElement('tr');
                const expiryTimeVal = client.expiryTime || client.expiry_time || 0;
                const expiryText = expiryTimeVal > 0 ? new Date(expiryTimeVal).toLocaleDateString() : 'None';
                
                const escEmail = clientEmail.replace(/'/g, "\\'");
                const escPlan = (client.plan || 'None').replace(/'/g, "\\'");
                const escStatus = (client.status || 'active').replace(/'/g, "\\'");
                const escRole = (client.role || 'user').replace(/'/g, "\\'");
                
                const roleClass = escRole.toLowerCase() === 'admin' ? 'admin' : 'user';
                const statusClass = escStatus.toLowerCase() === 'active' ? 'active' : 'inactive';
                
                tr.innerHTML = `
                    <td>
                        <div class="admin-client-info-cell">
                            <div class="admin-client-avatar-wrapper">
                                <img src="${clientPic}" alt="${clientName}" class="admin-client-avatar" onerror="this.onerror=null; this.src='assets/images/default-avatar.svg';">
                            </div>
                            <div class="admin-client-details">
                                <div class="admin-client-name" title="${clientName}">${clientName}</div>
                                <div class="admin-client-email" title="${clientEmail}">${clientEmail}</div>
                                <div class="admin-client-badges">
                                    <span class="client-badge ${roleClass}">${escRole.toUpperCase()}</span>
                                    <span class="client-badge ${statusClass}">${escStatus.toUpperCase()}</span>
                                </div>
                            </div>
                        </div>
                    </td>
                    <td>
                        <div style="font-weight:600; font-size:0.82rem; color: var(--text-primary);">${client.plan || 'None'}</div>
                        <div style="font-size:0.72rem; color: var(--text-muted); margin-top: 2px;"><i class="far fa-calendar-alt" style="margin-right: 4px;"></i>Expiry: ${expiryText}</div>
                    </td>
                    <td><strong style="color: #f59e0b; font-size: 0.95rem;">🪙 ${Math.floor(client.coins || 0)}</strong></td>
                    <td>
                        <div style="display: flex; gap: 0.35rem; align-items: center;">
                            <button class="btn-sub secondary" style="padding:0.4rem 0.65rem; border-radius: 8px; font-weight: 500;" onclick="openAdminEditUserModal('${escEmail}', '${escPlan}', '${escStatus}', '${escRole}', ${client.coins || 0}, ${expiryTimeVal})" title="Edit user details"><i class="fas fa-edit"></i> Edit</button>
                            <button class="btn-sub primary" style="padding:0.4rem 0.65rem; border-radius: 8px; font-weight: 500; background: var(--primary);" onclick="adminDirectStartChat('${escEmail}')" title="Chat with this client"><i class="fas fa-comment"></i> Chat</button>
                        </div>
                    </td>
                `;
                tbody.appendChild(tr);
            });
        }
    } catch (err) {
        console.error('Fetch admin clients error:', err);
    }
}

// Edit Client Registry modal controllers
let activeEditUserEmail = '';
function openAdminEditUserModal(email, plan, status, role, coins, expiryTime) {
    activeEditUserEmail = email;
    document.getElementById('editUserEmailTitle').textContent = email;
    document.getElementById('editUserPlan').value = plan.includes('100GB') ? '100GB' : plan.includes('200GB') ? '200GB' : plan.includes('300GB') ? '300GB' : plan.includes('Unlimited') ? 'Unlimited' : 'None';
    document.getElementById('editUserStatus').value = status;
    document.getElementById('editUserRole').value = role;
    document.getElementById('editUserCoins').value = Math.floor(coins);
    document.getElementById('editUserExpiryDays').value = '';
    
    document.getElementById('adminEditUserModal').style.display = 'flex';
}

function closeAdminEditUserModal() {
    document.getElementById('adminEditUserModal').style.display = 'none';
}

async function saveAdminClientChanges() {
    if (!activeEditUserEmail) return;
    
    showLoader(true);
    
    if (isGuestMode) {
        const clientIdx = guestClients.findIndex(c => c.email === activeEditUserEmail);
        if (clientIdx !== -1) {
            const plan = document.getElementById('editUserPlan').value;
            const status = document.getElementById('editUserStatus').value;
            const role = document.getElementById('editUserRole').value;
            const coins = parseFloat(document.getElementById('editUserCoins').value) || 0;
            const expiryDays = parseInt(document.getElementById('editUserExpiryDays').value);
            
            guestClients[clientIdx].plan = plan === 'None' ? 'None' : `${plan} Plan`;
            guestClients[clientIdx].status = status;
            guestClients[clientIdx].role = role;
            guestClients[clientIdx].coins = coins;
            if (!isNaN(expiryDays) && expiryDays >= 0) {
                guestClients[clientIdx].expiryTime = Date.now() + expiryDays * 24 * 60 * 60 * 1000;
            }
            showNotification(`✓ Registry updated for ${activeEditUserEmail} (Guest Mode)`, 'success');
            renderGuestAdminClients();
            closeAdminEditUserModal();
        }
        showLoader(false);
        return;
    }
    
    const plan = document.getElementById('editUserPlan').value;
    const status = document.getElementById('editUserStatus').value;
    const role = document.getElementById('editUserRole').value;
    const coins = parseFloat(document.getElementById('editUserCoins').value) || 0;
    const expiryDays = parseInt(document.getElementById('editUserExpiryDays').value);
    
    try {
        const payload = {
            coins: coins,
            role: role,
            status: status,
            plan: plan === 'None' ? 'None' : `${plan} Plan`
        };
        if (!isNaN(expiryDays) && expiryDays >= 0) {
            payload.customDays = expiryDays;
        }
        
        const response = await apiFetch(`/api/admin/clients/${encodeURIComponent(activeEditUserEmail)}`, {
            method: 'PUT',
            body: JSON.stringify(payload)
        });
        const data = await response.json();
        if (data.success) {
            showNotification(`✓ Registry updated for ${activeEditUserEmail}`, 'success');
            closeAdminEditUserModal();
            fetchAdminClients();
        } else {
            showNotification(data.message || 'Failed to update registry client.', 'error');
        }
        showLoader(false);
    } catch(err) {
        console.error('Save registry error:', err);
        showNotification('Failed to update registry client.', 'error');
        showLoader(false);
    }
}

// Expose cost input toggling for config publish form
function toggleConfigCostInput() {
    const configType = document.getElementById('configType').value;
    const costGroup = document.getElementById('configCostGroup');
    if (configType === 'free') {
        costGroup.style.display = 'none';
        document.getElementById('configCoinCost').value = '0';
        document.getElementById('configPrice').value = '0.00';
    } else {
        costGroup.style.display = 'block';
        document.getElementById('configCoinCost').value = '50';
        document.getElementById('configPrice').value = '100.00';
    }
}

// Auto-generate config for admin from 3x-ui
async function adminAutoGenerateConfigText() {
    const title = document.getElementById('configTitle').value.trim() || 'Admin Config';
    const isp = document.getElementById('configIsp').value || 'All';
    showLoader(true);
    try {
        const res = await apiFetch('/api/admin/generate-config', {
            method: 'POST',
            body: JSON.stringify({
                email: `admin_${isp.toLowerCase()}_${Date.now().toString().slice(-4)}`,
                planId: isp.toUpperCase(),
                selectedGb: '100',
                days: 30
            })
        });
        const data = await res.json();
        if (data.success && data.config) {
            document.getElementById('configText').value = data.config;
            showNotification(`3x-ui Config generated with SNI: ${data.sni || 'Auto'}!`, 'success');
        } else {
            showNotification(data.message || 'Auto-generation failed', 'error');
        }
    } catch (e) {
        showNotification(e.message, 'error');
    } finally {
        showLoader(false);
    }
}

// Publish free/premium config
async function handlePublishConfig(event) {
    event.preventDefault();
    showLoader(true);
    
    const title = document.getElementById('configTitle').value.trim();
    const isp = document.getElementById('configIsp').value;
    const configStr = document.getElementById('configText').value.trim();
    const configType = document.getElementById('configType').value;
    const coinCost = configType === 'free' ? 0 : (parseInt(document.getElementById('configCoinCost').value) || 0);
    const price = configType === 'free' ? 0.00 : (parseFloat(document.getElementById('configPrice').value) || 0.00);
    
    if (isGuestMode) {
        const newId = 'g_' + Date.now();
        guestConfigs.push({
            id: newId,
            title: title,
            isp: isp,
            config: configStr,
            coinCost: coinCost,
            price: price
        });
        showNotification('Config published in coin market (Guest Mode)!', 'success');
        document.getElementById('addConfigForm').reset();
        toggleConfigCostInput(); // Reset visibility
        renderGuestConfigsMarket();
        showLoader(false);
        return;
    }
    
    try {
        const response = await apiFetch('/api/configs/publish', {
            method: 'POST',
            body: JSON.stringify({
                title: title,
                isp: isp,
                config: configStr,
                coinCost: coinCost,
                price: price
            })
        });
        const data = await response.json();
        if (data.success) {
            showNotification('Config published in coin market!', 'success');
            document.getElementById('addConfigForm').reset();
            toggleConfigCostInput();
            loadConfigsMarket();
        } else {
            showNotification(data.message || 'Failed to publish configuration.', 'error');
        }
        showLoader(false);
    } catch(err) {
        console.error('Config publish error:', err);
        showNotification('Failed to publish configuration.', 'error');
        showLoader(false);
    }
}

// ----------------------------------------------------
// UI ENHANCEMENTS: THEME & NOTIFICATIONS
// ----------------------------------------------------

// Theme Toggle
function toggleTheme() {
    const body = document.body;
    const btn = document.getElementById('themeToggleBtn');
    
    if (body.classList.contains('light-mode')) {
        body.classList.remove('light-mode');
        body.classList.add('dark-mode');
        btn.innerHTML = '<i class="fas fa-sun" style="color: #fbbf24;"></i> <span>Light Mode</span>';
        localStorage.setItem('app_theme', 'dark-mode');
    } else {
        body.classList.remove('dark-mode');
        body.classList.add('light-mode');
        btn.innerHTML = '<i class="fas fa-moon"></i> <span>Dark Mode</span>';
        localStorage.setItem('app_theme', 'light-mode');
    }
}

// Auto load stored theme
(function loadTheme() {
    const stored = localStorage.getItem('app_theme');
    if (stored === 'dark-mode') {
        window.addEventListener('DOMContentLoaded', () => {
            document.body.className = 'dark-mode';
            document.getElementById('themeToggleBtn').innerHTML = '<i class="fas fa-sun" style="color: #fbbf24;"></i> <span>Light Mode</span>';
        });
    }
})();

// Notifications / Announcements drawer popup
function toggleAnnouncements() {
    switchTab('messages');
    // Clear badge
    document.getElementById('notifBadge').style.display = 'none';
}

// Toast Notifications Helper
function showNotification(message, type = 'info') {
    const container = document.createElement('div');
    container.style.position = 'fixed';
    container.style.bottom = '2rem';
    container.style.right = '2rem';
    container.style.padding = '0.9rem 1.5rem';
    container.style.borderRadius = '12px';
    container.style.color = '#ffffff';
    container.style.fontSize = '0.85rem';
    container.style.fontWeight = '600';
    container.style.zIndex = '99999';
    container.style.display = 'flex';
    container.style.alignItems = 'center';
    container.style.gap = '0.5rem';
    container.style.boxShadow = '0 10px 30px rgba(0,0,0,0.15)';
    container.style.transform = 'translateY(15px)';
    container.style.opacity = '0';
    container.style.transition = 'all 0.3s cubic-bezier(0.16, 1, 0.3, 1)';
    
    let icon = '';
    if (type === 'success') {
        container.style.background = 'linear-gradient(135deg, #059669 0%, #10b981 100%)';
        icon = '<i class="fas fa-check-circle"></i>';
    } else if (type === 'error') {
        container.style.background = 'linear-gradient(135deg, #dc2626 0%, #ef4444 100%)';
        icon = '<i class="fas fa-exclamation-circle"></i>';
    } else if (type === 'warning') {
        container.style.background = 'linear-gradient(135deg, #d97706 0%, #f59e0b 100%)';
        icon = '<i class="fas fa-exclamation-triangle"></i>';
    } else {
        container.style.background = 'linear-gradient(135deg, #2563eb 0%, #3b82f6 100%)';
        icon = '<i class="fas fa-info-circle"></i>';
    }
    
    container.innerHTML = `${icon} <span>${message}</span>`;
    document.body.appendChild(container);
    
    // Animate in
    setTimeout(() => {
        container.style.transform = 'translateY(0)';
        container.style.opacity = '1';
    }, 10);
    
    // Animate out
    setTimeout(() => {
        container.style.transform = 'translateY(15px)';
        container.style.opacity = '0';
        setTimeout(() => container.remove(), 300);
    }, 4000);
}

// ----------------------------------------------------
// LINK & UNLINK SUBSCRIPTION LOGIC
// ----------------------------------------------------

async function linkSubscriptionFromDashboard() {
    if (!isLoggedIn) {
        showNotification('Please login to link subscription.', 'error');
        return;
    }
    
    const link = document.getElementById('dashboardSubLinkInput').value.trim();
    if (!link) {
        showNotification('Please enter a valid subscription link.', 'error');
        return;
    }
    
    showLoader(true);
    
    if (isGuestMode) {
        guestSubLink = link;
        currentUserDetails.subLink = link;
        showNotification('✓ Subscription link linked in Guest Mode!', 'success');
        await loadGuestUsageStats();
        showLoader(false);
        return;
    }
    
    try {
        const response = await apiFetch('/api/user/link-sub', {
            method: 'POST',
            body: JSON.stringify({ subLink: link })
        });
        const data = await response.json();
        if (data.success) {
            showNotification('✓ Subscription link linked successfully!', 'success');
            fetchUserProfile();
        } else {
            showNotification(data.message || 'Failed to link subscription.', 'error');
            showLoader(false);
        }
    } catch (err) {
        console.error('Link subscription error:', err);
        showNotification('Failed to link subscription. Please try again.', 'error');
        showLoader(false);
    }
}

async function unlinkSubscription() {
    if (!confirm('Are you sure you want to unlink your V2Ray subscription line?')) return;
    
    showLoader(true);
    
    if (isGuestMode) {
        guestSubLink = '';
        if (currentUserDetails) {
            delete currentUserDetails.subLink;
        }
        showNotification('✓ Subscription link unlinked in Guest Mode!', 'success');
        renderEmptyStats({ email: currentUserDetails.email, plan: 'None', status: 'inactive' });
        showLoader(false);
        return;
    }
    
    try {
        const response = await apiFetch('/api/user/unlink-sub', {
            method: 'POST'
        });
        const data = await response.json();
        if (data.success) {
            showNotification('✓ Subscription link unlinked successfully!', 'success');
            fetchUserProfile();
        } else {
            showNotification(data.message || 'Failed to unlink subscription.', 'error');
            showLoader(false);
        }
    } catch (err) {
        console.error('Unlink subscription error:', err);
        showNotification('Failed to unlink subscription.', 'error');
        showLoader(false);
    }
}

// Helper: Query usage stats in guest mode with linked subscription
async function loadGuestUsageStats() {
    if (!guestSubLink) {
        renderGuestDashboard();
        return;
    }
    
    try {
        const response = await fetch(`/api/public/usage?query=${encodeURIComponent(guestSubLink)}`);
        const resData = await response.json();
        
        if (resData.success && resData.data) {
            const traffic = resData.data;
            const mockUser = {
                email: currentUserDetails.email,
                plan: guestClients.find(c => c.email === currentUserDetails.email)?.plan || 'Guest Pack',
                status: 'active',
                expiryTime: traffic.expiryTime || (Date.now() + 24 * 24 * 60 * 60 * 1000),
                subLink: guestSubLink
            };
            renderStatsDashboard(traffic, mockUser);
        } else {
            showNotification(resData.message || 'Failed to query subscription statistics. Showing mock stats.', 'warning');
            renderGuestDashboard();
        }
    } catch (err) {
        console.error('Guest fetch usage error:', err);
        renderGuestDashboard();
    }
}

// ----------------------------------------------------
// SUBSCRIPTION RENEWAL LOGIC
// ----------------------------------------------------

function openRenewModal(targetPackageId) {
    if (!isLoggedIn) {
        showNotification('Please login to renew package.', 'error');
        return;
    }
    
    // 1. Resolve packages list
    const packages = (currentUserDocData && Array.isArray(currentUserDocData.packages) && currentUserDocData.packages.length > 0)
        ? currentUserDocData.packages
        : [];
        
    let targetPkg = null;
    
    // Priority A: If targetPackageId passed, match from packages
    if (targetPackageId) {
        targetPkg = packages.find(p => p.id === targetPackageId || p.planId === targetPackageId);
    }
    
    // Priority B: Check currently selected config in dropdown if active
    if (!targetPkg) {
        const selectorVal = document.getElementById('configSelector')?.value;
        if (selectorVal && selectorVal !== 'g-active') {
            targetPkg = packages.find(p => p.id === selectorVal || p.planId === selectorVal || p.configLink === selectorVal);
        }
    }
    
    // Priority C: User's active_package_id
    if (!targetPkg && currentUserDocData && currentUserDocData.active_package_id) {
        targetPkg = packages.find(p => p.id === currentUserDocData.active_package_id);
    }
    
    // Priority D: First package in packages list
    if (!targetPkg && packages.length > 0) {
        targetPkg = packages[0];
    }
    
    // Priority E: Fallback to currentUserDocData itself if active plan exists
    if (!targetPkg && currentUserDocData && currentUserDocData.plan && currentUserDocData.plan !== 'None') {
        targetPkg = {
            id: currentUserDocData.active_package_id || 'pkg_active',
            planId: 'ACTIVE_PLAN',
            planName: currentUserDocData.plan,
            configLink: currentUserDocData.config_link || '',
            totalGb: currentUserDocData.total_gb || (currentUserDocData.plan && currentUserDocData.plan.toLowerCase().includes('unlimited') ? 'Unlimited' : '100'),
            panelId: currentUserDocData.panel_id || 1,
            port: currentUserDocData.port || 443,
            host: currentUserDocData.host || currentUserDocData.sni || 'Auto',
            expiryTime: currentUserDocData.expiry_time || 0
        };
    }
    
    // Guest mode handling
    if (isGuestMode) {
        const guestClient = guestClients.find(c => c.email === currentUserDetails.email);
        targetPkg = {
            id: 'guest_pkg',
            planId: 'AIRTEL_ZOOM',
            planName: guestClient?.plan || 'AIRTEL ZOOM SUPER S75',
            configLink: guestSubLink,
            totalGb: '100',
            panelId: 1,
            port: 8080,
            host: 'Support.zoom.us'
        };
    }

    if (!targetPkg) {
        showNotification('You do not have an active package to renew. Please purchase a package first.', 'warning');
        return;
    }
    
    renewTargetPackage = targetPkg;
    
    // Clean plan name from decorators like "(300 GB)", "- Port 443", "V2Ray", etc.
    const rawName = targetPkg.planName || targetPkg.plan || 'Subscription';
    const cleanPlanName = rawName
        .replace(/\s*\(\d+\s*GB\)/gi, '')
        .replace(/\s*\(Unlimited(?:\s*GB)?\)/gi, '')
        .replace(/\s*-\s*Port\s*\d+/gi, '')
        .replace(/\s*V2Ray\s*(?:Subscription\s*Line|Package)?/gi, '')
        .replace(/\s*Pack(?:age)?/gi, '')
        .trim() || 'V2Ray Package';
        
    // Find matching package in availablePackages
    let pkg = null;
    if (targetPkg.planId && targetPkg.planId !== 'ACTIVE_PLAN') {
        pkg = availablePackages.find(p => p.id === targetPkg.planId);
    }
    if (!pkg) {
        pkg = availablePackages.find(p => 
            p.name.replace(/_/g, ' ').toLowerCase() === cleanPlanName.toLowerCase() ||
            cleanPlanName.toLowerCase().includes(p.name.replace(/_/g, ' ').toLowerCase()) ||
            p.name.replace(/_/g, ' ').toLowerCase().includes(cleanPlanName.toLowerCase())
        );
    }
    
    // Set planId and category - SAFE RESOLUTION, NEVER TIKTOK FALLBACK
    renewPlanId = pkg ? pkg.id : (targetPkg.planId && targetPkg.planId !== 'ACTIVE_PLAN' ? targetPkg.planId : cleanPlanName.replace(/\s+/g, '_').toUpperCase());
    const pkgCategory = pkg ? (pkg.category || 'speed') : (targetPkg.target === 'address' ? 'speed' : 'speed_limit');
    renewTargetPackage.resolvedCategory = pkgCategory;
    renewTargetPackage.planId = renewPlanId;
    renewTargetPackage.cleanName = cleanPlanName;
    
    // Set Plan Name & Info in Modal
    document.getElementById('renewPlanName').textContent = cleanPlanName;
    const nodeName = targetPkg.panelName || (targetPkg.panelId === 2 || targetPkg.panel_id === 2 ? 'Node 02 (Site)' : 'Node 01 (Panther)');
    const hostVal = targetPkg.host || targetPkg.sni || 'Auto';
    const portVal = targetPkg.port || (targetPkg.target === 'address' ? 8080 : 443);
    const detailsEl = document.getElementById('renewConfigDetails');
    if (detailsEl) {
        detailsEl.textContent = `Server: ${nodeName} • Port: ${portVal} • Host: ${hostVal}`;
    }
    
    // Initialize GB Selector with package's current GB
    let currentGb = String(targetPkg.totalGb || '100').replace(/[^0-9Unlimited]/gi, '').trim();
    if (!['100', '200', '300', 'Unlimited'].includes(currentGb)) {
        if ((targetPkg.planName && targetPkg.planName.toLowerCase().includes('unlimited')) || (targetPkg.totalGb && String(targetPkg.totalGb).toLowerCase() === 'unlimited')) {
            currentGb = 'Unlimited';
        } else {
            currentGb = '100';
        }
    }
    
    const gbSelector = document.getElementById('renewGbSelector');
    if (gbSelector) {
        gbSelector.value = currentGb;
    }
    renewSelectedGb = currentGb;
    
    // Update rates and buttons
    updateRenewModalRates(renewSelectedGb);
    
    document.getElementById('renewPlanModal').style.display = 'flex';
}

function closeRenewModal() {
    document.getElementById('renewPlanModal').style.display = 'none';
}

function handleRenewGbChange(gb) {
    renewSelectedGb = gb;
    updateRenewModalRates(gb);
}

function updateRenewModalRates(gb) {
    const category = renewTargetPackage?.resolvedCategory || 'speed';
    const rates = getPackageRates(category, gb);
    
    renewPlanPrice = rates.price;
    renewCoinCost = rates.coinCost;
    renewBonusCoins = rates.bonusCoins;
    
    const coinBtnTitle = document.getElementById('renewCoinBtnTitle');
    if (coinBtnTitle) {
        coinBtnTitle.textContent = `Renew with ${renewCoinCost} Coins`;
    }
    const coinCostText = document.getElementById('renewCoinCostText');
    if (coinCostText) {
        coinCostText.textContent = `Pay ${renewCoinCost} Coins • Instant +30 Days Renewal (${gb}${gb === 'Unlimited' ? '' : ' GB'})`;
    }
    
    const slipBtnTitle = document.getElementById('renewSlipBtnTitle');
    if (slipBtnTitle) {
        slipBtnTitle.textContent = `Renew with Bank Slip (LKR ${renewPlanPrice.toFixed(2)})`;
    }
    const slipPriceText = document.getElementById('renewSlipPriceText');
    if (slipPriceText) {
        slipPriceText.textContent = `LKR ${renewPlanPrice.toFixed(2)} • Upload receipt slip (+${renewBonusCoins} Bonus Coins)`;
    }
}

async function submitRenewWithCoins() {
    if (currentUserCoins < renewCoinCost) {
        showNotification(`Insufficient Coins! You need ${renewCoinCost} coins to renew this plan.`, 'error');
        return;
    }
    
    const planName = document.getElementById('renewPlanName').textContent;
    if (!confirm(`Renew package: "${planName}" (${renewSelectedGb}${renewSelectedGb === 'Unlimited' ? '' : ' GB'}) for 30 days using ${renewCoinCost} coins?`)) return;
    
    showLoader(true);
    
    if (isGuestMode) {
        currentUserCoins -= renewCoinCost;
        document.getElementById('userCoinsBalance').textContent = `${Math.floor(currentUserCoins)} Coins`;
        const marketCoinBalEl = document.getElementById('marketCoinBalance');
        if (marketCoinBalEl) {
            marketCoinBalEl.textContent = `${Math.floor(currentUserCoins)} Coins`;
        }
        
        guestUserSlips.unshift({
            planId: renewPlanId,
            price: 0.00,
            slipUrl: 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect width="100%" height="100%" fill="%23fbbf24"/><text x="10" y="50" fill="white" font-weight="bold">COIN RENEW</text></svg>',
            status: 'approved',
            selected_gb: renewSelectedGb,
            created_at: new Date()
        });
        
        const clientIdx = guestClients.findIndex(c => c.email === currentUserDetails.email);
        if (clientIdx !== -1) {
            const currentExpiry = guestClients[clientIdx].expiryTime || Date.now();
            const extendFrom = currentExpiry > Date.now() ? currentExpiry : Date.now();
            guestClients[clientIdx].expiryTime = extendFrom + 30 * 24 * 60 * 60 * 1000;
            guestClients[clientIdx].coins = currentUserCoins;
            guestClients[clientIdx].totalGb = renewSelectedGb;
        }
        
        showNotification(`✓ Subscription renewed successfully! +30 Days and ${renewSelectedGb} GB added.`, 'success');
        closeRenewModal();
        renderGuestOrders();
        await loadGuestUsageStats();
        showLoader(false);
        return;
    }
    
    try {
        const response = await apiFetch('/api/user/renew-coins', {
            method: 'POST',
            body: JSON.stringify({
                packageId: renewTargetPackage ? renewTargetPackage.id : null,
                planId: renewPlanId,
                planName: planName,
                selectedGb: renewSelectedGb,
                coinCost: renewCoinCost,
                days: 30
            })
        });
        const data = await response.json();
        if (data.success) {
            showNotification(`✓ Package renewed successfully! +30 Days and ${renewSelectedGb} GB added.`, 'success');
            closeRenewModal();
            // Instantly update coins locally before next profile sync poll
            currentUserCoins -= renewCoinCost;
            document.getElementById('userCoinsBalance').textContent = `${Math.floor(currentUserCoins)} Coins`;
            const marketCoinBalEl = document.getElementById('marketCoinBalance');
            if (marketCoinBalEl) {
                marketCoinBalEl.textContent = `${Math.floor(currentUserCoins)} Coins`;
            }
            await fetchUserProfile();
        } else {
            showNotification(data.message || 'Renewal failed.', 'error');
        }
    } catch(err) {
        console.error('Renew transaction failed:', err);
        showNotification(err.message || 'Renewal failed. Please try again.', 'error');
    } finally {
        showLoader(false);
    }
}

function submitRenewWithSlip() {
    const planName = document.getElementById('renewPlanName').textContent;
    const targetPackageId = renewTargetPackage ? renewTargetPackage.id : null;
    closeRenewModal();
    openSlipModal(
        renewPlanId,
        `Renewal: ${planName}`,
        renewPlanPrice,
        renewSelectedGb,
        renewBonusCoins,
        targetPackageId,
        true // isRenewal
    );
}

// ----------------------------------------------------
// LIVE SUPPORT CHAT LOGIC & NOTIFICATIONS
// ----------------------------------------------------

// Melodic Audio Chime Generator (WhatsApp Web style)
function playMessageNotificationSound() {
    try {
        const AudioContextClass = window.AudioContext || window.webkitAudioContext;
        if (!AudioContextClass) return;
        const ctx = new AudioContextClass();
        if (ctx.state === 'suspended') {
            ctx.resume();
        }
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        const now = ctx.currentTime;
        // Two-tone melodic ping (D5: 587.33Hz -> A5: 880Hz)
        osc.frequency.setValueAtTime(587.33, now);
        osc.frequency.setValueAtTime(880, now + 0.08);
        gain.gain.setValueAtTime(0.22, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.36);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now);
        osc.stop(now + 0.37);
    } catch (err) {
        console.warn('Audio chime notice:', err);
    }
}

// Browser Desktop Push Notification (Web Notification API)
function showDesktopNotification(title, body, onClick) {
    if (!("Notification" in window)) return;
    if (Notification.permission === "granted") {
        try {
            const notif = new Notification(title, {
                body: body,
                icon: 'assets/images/logo_round.jpg',
                badge: 'assets/images/logo_round.jpg'
            });
            notif.onclick = () => {
                window.focus();
                if (typeof onClick === 'function') onClick();
                notif.close();
            };
        } catch (e) {
            console.warn('Desktop notif error:', e);
        }
    } else if (Notification.permission === "default") {
        try {
            Notification.requestPermission();
        } catch (pErr) {}
    }
}

// Title Blinking For Background Tabs and Alert Awareness
let titleBlinkInterval = null;
let originalPageTitle = document.title || 'Tunnel Forde LK';

function startTitleBlink(count) {
    stopTitleBlink();
    const formattedCount = count > 99 ? '99+' : count;
    const alertTitle = `🔴 (${formattedCount}) New Message! - Tunnel Forde LK`;
    const defaultTitle = originalPageTitle || 'Tunnel Forde LK';
    let toggle = false;
    titleBlinkInterval = setInterval(() => {
        document.title = toggle ? alertTitle : defaultTitle;
        toggle = !toggle;
    }, 1000);
}

function stopTitleBlink() {
    if (titleBlinkInterval) {
        clearInterval(titleBlinkInterval);
        titleBlinkInterval = null;
    }
    document.title = originalPageTitle || 'Tunnel Forde LK';
}

// Window focus listener to reset title blink if viewing relevant active tab
window.addEventListener('focus', () => {
    if (currentActiveTab === 'messages' || (currentActiveTab === 'admin' && adminActiveChatUser)) {
        stopTitleBlink();
    }
});

// Presence Heartbeat & Dynamic Online/Offline Tracking
let presenceHeartbeatInterval = null;
let isCurrentAdminOnline = false;

function startPresenceHeartbeat() {
    stopPresenceHeartbeat();
    sendPresenceHeartbeat();
    presenceHeartbeatInterval = setInterval(sendPresenceHeartbeat, 15000);
}

function stopPresenceHeartbeat() {
    if (presenceHeartbeatInterval) {
        clearInterval(presenceHeartbeatInterval);
        presenceHeartbeatInterval = null;
    }
}

async function sendPresenceHeartbeat() {
    if (!isLoggedIn || isGuestMode) return;
    try {
        const res = await apiFetch('/api/presence/heartbeat', { method: 'POST' });
        const data = await res.json();
        if (data.success) {
            updateAdminOnlineStatusUI(data.isAdminOnline);
            updateSelfOnlineStatus(true);
        }
    } catch (e) {
        updateSelfOnlineStatus(false);
    }
}

function updateAdminOnlineStatusUI(isOnline) {
    const currentIsAdmin = (currentUserRole === 'admin' || isSystemAdminEmail(currentUserDetails?.email));
    const effectiveOnline = currentIsAdmin ? true : !!isOnline;

    isCurrentAdminOnline = effectiveOnline;
    const avatarDot = document.getElementById('chatAdminAvatarStatusDot');
    const statusPill = document.getElementById('chatAdminStatusPill');
    const statusDotIcon = document.getElementById('chatAdminStatusDotIcon');
    const statusText = document.getElementById('chatAdminStatusText');

    if (avatarDot) {
        avatarDot.className = `chat-avatar-status-dot ${effectiveOnline ? 'online' : 'offline'}`;
    }
    if (statusPill) {
        statusPill.className = `chat-status-pill ${effectiveOnline ? 'online' : 'offline'}`;
    }
    if (statusDotIcon) {
        statusDotIcon.style.animation = effectiveOnline ? 'pulseBadgeGreen 2s infinite' : 'none';
    }
    if (statusText) {
        statusText.textContent = effectiveOnline ? 'Admin Online' : 'Admin Offline';
    }
}

function updateSelfOnlineStatus(isOnline) {
    const dot = document.getElementById('sidebarUserStatusDot');
    if (dot) {
        dot.className = `user-status-indicator ${isOnline ? 'online' : 'offline'}`;
        dot.title = isOnline ? 'Online' : 'Offline';
    }
}

// Navigation Badge Updaters
function updateUserNavBadge(count, latestText) {
    const badge = document.getElementById('userNavChatBadge');
    const navMessages = document.getElementById('navLinkMessages');
    const navMessagesPulseDot = document.getElementById('userNavChatPulseDot');
    const headerBadge = document.getElementById('userChatHeaderUnreadBadge');
    const dashboardAlert = document.getElementById('userDashboardChatAlert');
    const dashboardCount = document.getElementById('userDashboardAlertCount');
    const mobileDot = document.getElementById('mobileMenuNotifDot');
    const mobileBadge = document.getElementById('mobileMenuNotifBadge');
    const headerAlertBtn = document.getElementById('headerChatAlertBtn');
    const headerAlertBadge = document.getElementById('headerChatAlertBadge');
    const floatingWidget = document.getElementById('floatingChatWidget');
    const floatingBadge = document.getElementById('floatingChatBadge');
    const floatingBubble = document.getElementById('floatingChatBubble');
    const floatingPreviewText = document.getElementById('floatingChatPreviewText');

    const formattedCount = count > 99 ? '99+' : count;

    // Sidebar Messages nav link and indicators
    if (badge) {
        if (count > 0 && currentActiveTab !== 'messages') {
            badge.textContent = formattedCount;
            badge.style.display = 'inline-flex';
        } else {
            badge.style.display = 'none';
        }
    }
    if (navMessages) {
        if (count > 0 && currentActiveTab !== 'messages') {
            navMessages.classList.add('has-unread');
        } else {
            navMessages.classList.remove('has-unread');
        }
    }
    if (navMessagesPulseDot) {
        navMessagesPulseDot.style.display = (count > 0 && currentActiveTab !== 'messages') ? 'block' : 'none';
    }

    if (headerBadge) {
        if (count > 0) {
            headerBadge.textContent = `${count} New`;
            headerBadge.style.display = 'inline-flex';
        } else {
            headerBadge.style.display = 'none';
        }
    }
    if (dashboardAlert) {
        if (count > 0 && currentActiveTab !== 'messages') {
            dashboardAlert.style.display = 'flex';
            if (dashboardCount) dashboardCount.textContent = `${count} New`;
        } else {
            dashboardAlert.style.display = 'none';
        }
    }
    if (mobileDot) {
        mobileDot.style.display = (count > 0 && currentActiveTab !== 'messages') ? 'block' : 'none';
    }
    if (mobileBadge) {
        if (count > 0 && currentActiveTab !== 'messages') {
            mobileBadge.textContent = formattedCount;
            mobileBadge.style.display = 'inline-flex';
        } else {
            mobileBadge.style.display = 'none';
        }
    }
    if (headerAlertBtn) {
        if (count > 0 && currentActiveTab !== 'messages') {
            headerAlertBtn.style.display = 'inline-flex';
            if (headerAlertBadge) headerAlertBadge.textContent = formattedCount;
        } else {
            headerAlertBtn.style.display = 'none';
        }
    }

    // Update Floating Chat Button Badge & Alert Bubble
    updateFloatingChatBadge(count, latestText, 'Admin replied');

    if (count > 0 && currentActiveTab !== 'messages') {
        startTitleBlink(count);
    } else {
        stopTitleBlink();
    }
}

function handleFloatingChatClick(event) {
    if (event) event.preventDefault();
    const isUserAdmin = currentUserRole === 'admin' || isSystemAdminUser(currentUserDetails?.email);
    if (isUserAdmin) {
        switchTab('admin');
    } else {
        switchTab('messages');
    }
}

function updateFloatingChatBadge(count, latestText, titlePrefix = 'Admin') {
    const floatingWidget = document.getElementById('floatingChatWidget');
    const floatingBadge = document.getElementById('floatingChatBadge');
    const floatingBubble = document.getElementById('floatingChatBubble');
    const floatingPreviewText = document.getElementById('floatingChatPreviewText');
    const floatingBubbleTitle = document.getElementById('floatingChatBubbleTitle');
    const formattedCount = count > 99 ? '99+' : count;

    if (!floatingWidget) return;

    const isUserAdmin = currentUserRole === 'admin' || isSystemAdminUser(currentUserDetails?.email);
    const isCurrentChatTab = (currentActiveTab === 'messages') || (isUserAdmin && currentActiveTab === 'admin');

    if (isCurrentChatTab) {
        floatingWidget.style.display = 'none';
        return;
    }

    floatingWidget.style.display = 'flex';

    if (count > 0) {
        floatingWidget.classList.add('has-unread');
        if (floatingBadge) {
            floatingBadge.textContent = formattedCount;
            floatingBadge.style.display = 'inline-flex';
        }
        if (floatingBubble) {
            if (floatingBubbleTitle) {
                floatingBubbleTitle.textContent = `${titlePrefix}:`;
            }
            if (latestText && floatingPreviewText) {
                floatingPreviewText.textContent = latestText;
            }
            floatingBubble.style.display = 'block';
        }
    } else {
        floatingWidget.classList.remove('has-unread');
        if (floatingBadge) {
            floatingBadge.style.display = 'none';
        }
        if (floatingBubble) {
            floatingBubble.style.display = 'none';
        }
    }
}

function updateAdminNavBadge(count, latestText) {
    const badge = document.getElementById('adminNavChatBadge');
    const navAdmin = document.getElementById('navLinkAdmin');
    const navAdminPulseDot = document.getElementById('adminNavChatPulseDot');
    const mobileDot = document.getElementById('mobileMenuNotifDot');
    const mobileBadge = document.getElementById('mobileMenuNotifBadge');
    const formattedCount = count > 99 ? '99+' : count;

    if (badge) {
        if (count > 0 && currentActiveTab !== 'admin') {
            badge.textContent = formattedCount;
            badge.style.display = 'inline-flex';
        } else {
            badge.style.display = 'none';
        }
    }
    if (navAdmin) {
        if (count > 0 && currentActiveTab !== 'admin') {
            navAdmin.classList.add('has-unread');
        } else {
            navAdmin.classList.remove('has-unread');
        }
    }
    if (navAdminPulseDot) {
        navAdminPulseDot.style.display = (count > 0 && currentActiveTab !== 'admin') ? 'block' : 'none';
    }
    if (mobileDot) {
        mobileDot.style.display = (count > 0 && currentActiveTab !== 'admin') ? 'block' : 'none';
    }
    if (mobileBadge) {
        if (count > 0 && currentActiveTab !== 'admin') {
            mobileBadge.textContent = formattedCount;
            mobileBadge.style.display = 'inline-flex';
        } else {
            mobileBadge.style.display = 'none';
        }
    }

    // Update Floating Chat Button for Admin
    updateFloatingChatBadge(count, latestText, 'Customer inquiry');

    if (count > 0 && currentActiveTab !== 'admin') {
        startTitleBlink(count);
    } else if (currentActiveTab === 'admin') {
        stopTitleBlink();
    }
}

// Mark User Chat Messages as Read
async function markUserChatRead() {
    updateUserNavBadge(0);
    if (isGuestMode) {
        guestChats.forEach(c => {
            if (c.sender === 'admin') c.read = true;
        });
        return;
    }
    try {
        await apiFetch('/api/chats/mark-read', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({})
        });
    } catch (e) {
        console.warn('markUserChatRead error:', e);
    }
}

// Mark Admin Chat Messages from Specific User as Read
async function markAdminChatRead(userEmail) {
    if (!userEmail) return;
    if (isGuestMode) {
        guestChats.forEach(c => {
            if (c.userEmail === userEmail && c.sender === 'user') c.read = true;
        });
        refreshAdminChatThreadsList();
        return;
    }
    try {
        await apiFetch('/api/chats/mark-read', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userEmail })
        });
        const thread = (allChatsList || []).find(t => (t.userEmail || '').toLowerCase() === userEmail.toLowerCase());
        if (thread) {
            thread.unreadCount = 0;
        }
        renderAdminChatThreads(allChatsList);
    } catch (e) {
        console.warn('markAdminChatRead error:', e);
    }
}

// Global Background Unread Message Poller
let lastSeenUnreadCount = 0;
let hasInitializedUnread = false;

function startGlobalChatUnreadPolling() {
    stopGlobalChatUnreadPolling();
    checkGlobalUnreadMessages();
    globalUnreadChatInterval = setInterval(checkGlobalUnreadMessages, 2500);
    startPresenceHeartbeat();
}

function stopGlobalChatUnreadPolling() {
    if (globalUnreadChatInterval) {
        clearInterval(globalUnreadChatInterval);
        globalUnreadChatInterval = null;
    }
    stopPresenceHeartbeat();
}

async function checkGlobalUnreadMessages() {
    if (!isLoggedIn) return;

    if (isGuestMode) {
        if (isAdminUnlocked) {
            const unreadUserMsgs = guestChats.filter(c => c.sender === 'user' && !c.read);
            const unreadCount = unreadUserMsgs.length;
            const latestText = unreadUserMsgs.length > 0 ? (unreadUserMsgs[unreadUserMsgs.length - 1].text || unreadUserMsgs[unreadUserMsgs.length - 1].message || 'New customer message') : '';
            if (hasInitializedUnread && unreadCount > lastSeenUnreadCount) {
                playMessageNotificationSound();
                showDesktopNotification('New Support Inquiry', latestText || 'A visitor sent a live chat message', () => switchTab('admin'));
                showNotification('💬 New support inquiry from visitor', 'info');
            }
            lastSeenUnreadCount = unreadCount;
            updateAdminNavBadge(unreadCount, latestText);
            updateAdminOnlineStatusUI(true);
        } else {
            const unreadAdminMsgs = guestChats.filter(c => c.sender === 'admin' && !c.read);
            const unreadCount = unreadAdminMsgs.length;
            const latestText = unreadAdminMsgs.length > 0 ? (unreadAdminMsgs[unreadAdminMsgs.length - 1].message || 'New message received') : '';
            if (hasInitializedUnread && unreadCount > lastSeenUnreadCount) {
                playMessageNotificationSound();
                showDesktopNotification('Tunnel Forde LK Support', latestText || 'Admin sent you a reply', () => switchTab('messages'));
                showNotification('💬 New reply received from Admin!', 'info');
            }
            lastSeenUnreadCount = unreadCount;
            updateUserNavBadge(unreadCount, latestText);
            updateAdminOnlineStatusUI(false);
        }
        hasInitializedUnread = true;
        return;
    }

    try {
        const res = await apiFetch('/api/chats/unread-count');
        const data = await res.json();
        if (data.success) {
            if (typeof data.isAdminOnline !== 'undefined') {
                updateAdminOnlineStatusUI(data.isAdminOnline);
            }

            const unreadCount = Number(data.unreadCount || 0);
            const latestMsg = data.latestMessage || 'New message received';
            const isUserAdmin = currentUserRole === 'admin' || isSystemAdminUser(currentUserDetails?.email);

            if (hasInitializedUnread && unreadCount > lastSeenUnreadCount) {
                playMessageNotificationSound();
                if (isUserAdmin) {
                    showDesktopNotification('Tunnel Forde LK Support', 'New customer support message received', () => switchTab('admin'));
                    showNotification('💬 New support message received from customer!', 'info');
                    if (currentActiveTab === 'admin') {
                        fetchAdminChatThreads();
                        if (adminActiveChatUser) fetchAdminChatMessages(adminActiveChatUser);
                    }
                } else {
                    showDesktopNotification('Tunnel Forde LK Support', latestMsg || 'Admin replied to your message', () => switchTab('messages'));
                    showNotification('💬 Admin has replied to your message!', 'info');
                    if (currentActiveTab === 'messages') {
                        fetchChatMessages();
                        markUserChatRead();
                    }
                }
            }

            lastSeenUnreadCount = unreadCount;
            hasInitializedUnread = true;

            if (isUserAdmin) {
                updateAdminNavBadge(unreadCount, latestMsg);
            } else {
                updateUserNavBadge(unreadCount, latestMsg);
            }
        }
    } catch (err) {
        // Silently catch network errors in background poll
    }
}

async function handleSendChatMessage(event) {
    event.preventDefault();
    
    if (!isLoggedIn) {
        showNotification('Please login to chat with admin.', 'error');
        return;
    }
    
    const input = document.getElementById('chatMessageInput');
    const text = input.value.trim();
    if (!text) return;
    
    input.value = '';
    
    // Real-Time Optimistic UI Update
    const windowEl = document.getElementById('chatMessagesWindow');
    if (windowEl) {
        if (windowEl.querySelector('.fa-comments') || windowEl.textContent.includes('No messages yet')) {
            windowEl.innerHTML = '';
        }
        const userAvatar = (currentUserDetails && currentUserDetails.picture) || 'assets/images/default-avatar.svg';
        const timeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        const row = document.createElement('div');
        row.className = 'chat-msg-row msg-outgoing';
        row.innerHTML = `
            <div class="chat-msg-avatar-wrap" style="position: relative;">
                <img src="${userAvatar}" alt="You" class="chat-msg-avatar" onerror="this.onerror=null; this.src='assets/images/default-avatar.svg';">
                <span class="chat-avatar-status-dot online"></span>
            </div>
            <div class="chat-msg-bubble">
                <div class="chat-msg-sender-name">You</div>
                <div class="chat-msg-text">${text}</div>
                <div class="chat-msg-time">${timeStr} <span class="chat-status-ticks ticks-delivered" title="Sent"><i class="fas fa-check"></i></span></div>
            </div>
        `;
        windowEl.appendChild(row);
        windowEl.scrollTop = windowEl.scrollHeight;
    }

    if (isGuestMode) {
        guestChats.push({
            userEmail: currentUserDetails.email,
            sender: 'user',
            text: text,
            timestamp: Date.now(),
            read: false
        });
        
        renderUserMessages(guestChats.filter(c => c.userEmail === currentUserDetails.email));
        if (isAdminUnlocked && adminActiveChatUser === currentUserDetails.email) {
            renderAdminMessages(guestChats.filter(c => c.userEmail === adminActiveChatUser));
        }
        refreshAdminChatThreadsList();
        return;
    }
    
    try {
        const response = await apiFetch('/api/chats', {
            method: 'POST',
            body: JSON.stringify({ text: text })
        });
        const data = await response.json();
        if (data.success) {
            window._userChatLastSig = null;
            fetchChatMessages();
        }
    } catch (err) {
        console.error('Send message error:', err);
        showNotification('Failed to send message.', 'error');
    }
}

async function handleSendAdminChatReply(event) {
    event.preventDefault();
    
    if (!adminActiveChatUser) {
        showNotification('Please select a user thread to reply.', 'warning');
        return;
    }
    
    const input = document.getElementById('adminChatReplyInput');
    const text = input.value.trim();
    if (!text) return;
    
    input.value = '';
    
    // Real-Time Optimistic Admin UI Update
    const windowEl = document.getElementById('adminChatMessagesWindow');
    if (windowEl) {
        if (windowEl.textContent.includes('Select a client thread')) {
            windowEl.innerHTML = '';
        }
        const adminAvatar = (currentUserDetails && currentUserDetails.picture) || 'assets/images/logo_round.jpg';
        const timeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        const row = document.createElement('div');
        row.className = 'chat-msg-row msg-outgoing';
        row.innerHTML = `
            <div class="chat-msg-avatar-wrap" style="position: relative;">
                <img src="${adminAvatar}" alt="Admin" class="chat-msg-avatar" onerror="this.onerror=null; this.src='assets/images/logo_round.jpg';">
                <span class="chat-avatar-status-dot online"></span>
            </div>
            <div class="chat-msg-bubble">
                <div class="chat-msg-sender-name">👑 Admin (You)</div>
                <div class="chat-msg-text">${text}</div>
                <div class="chat-msg-time">${timeStr} <span class="chat-status-ticks ticks-delivered" title="Sent"><i class="fas fa-check"></i></span></div>
            </div>
        `;
        windowEl.appendChild(row);
        windowEl.scrollTop = windowEl.scrollHeight;
    }

    if (isGuestMode) {
        guestChats.push({
            userEmail: adminActiveChatUser,
            sender: 'admin',
            text: text,
            timestamp: Date.now(),
            read: false
        });
        
        renderAdminMessages(guestChats.filter(c => c.userEmail === adminActiveChatUser));
        refreshAdminChatThreadsList();
        
        if (currentUserDetails.email === adminActiveChatUser) {
            renderUserMessages(guestChats.filter(c => c.userEmail === currentUserDetails.email));
        }
        return;
    }
    
    try {
        const response = await apiFetch('/api/chats', {
            method: 'POST',
            body: JSON.stringify({ text: text, userEmail: adminActiveChatUser })
        });
        const data = await response.json();
        if (data.success) {
            fetchAdminChatMessages(adminActiveChatUser);
        }
    } catch (err) {
        console.error('Send admin message error:', err);
        showNotification('Failed to send reply.', 'error');
    }
}

function startChatPolling() {
    stopChatPolling();
    window._userChatLastSig = null;
    fetchChatMessages();
    activeChatInterval = setInterval(fetchChatMessages, 1000);
}

function stopChatPolling() {
    if (activeChatInterval) {
        clearInterval(activeChatInterval);
        activeChatInterval = null;
    }
}

function initChatListener(email) {
    if (isGuestMode) {
        const filtered = guestChats.filter(c => c.userEmail === email);
        renderUserMessages(filtered);
        return;
    }
    startChatPolling();
}

async function fetchChatMessages() {
    if (!isLoggedIn || isGuestMode) return;
    try {
        const res = await apiFetch(`/api/chats`);
        const data = await res.json();
        if (data.success) {
            if (typeof data.isAdminOnline !== 'undefined') {
                updateAdminOnlineStatusUI(data.isAdminOnline);
            }
            if (data.messages) {
                const newSig = JSON.stringify(data.messages.map(m => [m.id, m.read, m.text, m.timestamp])) + '_' + (isCurrentAdminOnline ? '1' : '0');
                if (window._userChatLastSig !== newSig) {
                    window._userChatLastSig = newSig;
                    renderUserMessages(data.messages);
                    if (currentActiveTab === 'messages') {
                        markUserChatRead();
                    }
                }
            }
        }
    } catch (err) {
        console.error('Fetch user chat error:', err);
    }
}

function renderUserMessages(messages) {
    const windowEl = document.getElementById('chatMessagesWindow');
    if (!windowEl) return;
    
    if (messages.length === 0) {
        windowEl.innerHTML = '<div style="text-align: center; color: var(--text-muted); font-size: 0.8rem; margin: auto; padding: 2rem 0.5rem;"><i class="fas fa-comments" style="font-size: 1.8rem; opacity: 0.4; margin-bottom: 0.5rem; display: block;"></i>No messages yet. Send a message to start chatting with admin!</div>';
        return;
    }
    
    windowEl.innerHTML = '';
    messages.forEach(msg => {
        const isMe = msg.sender === 'user';
        const timeStr = msg.timestamp ? (msg.timestamp.toDate ? msg.timestamp.toDate().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })) : 'Sending...';
        
        // Profile Avatar resolution
        const userAvatar = (currentUserDetails && currentUserDetails.picture) || msg.userPicture || 'assets/images/default-avatar.svg';
        const adminAvatar = msg.adminPicture || 'assets/images/logo_round.jpg';
        const avatarSrc = isMe ? userAvatar : adminAvatar;
        const senderName = isMe ? 'You' : '👑 Admin';

        // WhatsApp double-ticks for outgoing bubbles
        const isRead = msg.read === true;
        const tickHtml = isMe 
            ? `<span class="chat-status-ticks ${isRead ? 'ticks-read' : 'ticks-delivered'}" title="${isRead ? 'Read (Blue Double-Tick)' : 'Delivered (Grey Double-Tick)'}"><i class="fas fa-check-double"></i></span>` 
            : '';

        const adminStatusHtml = isCurrentAdminOnline 
            ? '<span style="font-size: 0.62rem; background: rgba(16, 185, 129, 0.2); color: #10b981; padding: 1px 6px; border-radius: 4px; font-weight: 700;">● Online</span>'
            : '<span style="font-size: 0.62rem; background: rgba(148, 163, 184, 0.2); color: #94a3b8; padding: 1px 6px; border-radius: 4px; font-weight: 600;">○ Offline</span>';

        const senderNameHtml = isMe 
            ? 'You' 
            : `<span style="display: inline-flex; align-items: center; gap: 4px; color: ${isCurrentAdminOnline ? '#10b981' : '#94a3b8'};"><i class="fas fa-crown" style="color: #fbbf24; font-size: 0.72rem;"></i><strong style="color: var(--text-primary);">Admin</strong>${adminStatusHtml}</span>`;

        const row = document.createElement('div');
        row.className = `chat-msg-row ${isMe ? 'msg-outgoing' : 'msg-incoming'}`;
        
        row.innerHTML = `
            <div class="chat-msg-avatar-wrap" style="position: relative;">
                <img src="${avatarSrc}" alt="${senderName}" class="chat-msg-avatar" onerror="this.onerror=null; this.src='assets/images/default-avatar.svg';">
                <span class="chat-avatar-status-dot ${isMe ? 'online' : (isCurrentAdminOnline ? 'online' : 'offline')}"></span>
            </div>
            <div class="chat-msg-bubble">
                <div class="chat-msg-sender-name">${senderNameHtml}</div>
                <div class="chat-msg-text">${msg.text}</div>
                <div class="chat-msg-time">${timeStr} ${tickHtml}</div>
            </div>
        `;
        windowEl.appendChild(row);
    });
    
    windowEl.scrollTop = windowEl.scrollHeight;
}

function initAdminAllChatsListener() {
    stopAdminAllChatsPolling();
    const container = document.getElementById('adminChatThreadsList');
    if (!container) return;
    
    if (isGuestMode) {
        refreshAdminChatThreadsList();
        return;
    }
    
    fetchAdminChatThreads();
    adminChatThreadsInterval = setInterval(fetchAdminChatThreads, 5000);
}

function stopAdminAllChatsPolling() {
    if (adminChatThreadsInterval) {
        clearInterval(adminChatThreadsInterval);
        adminChatThreadsInterval = null;
    }
}

function adminDirectStartChat(email) {
    if (!email) return;
    selectAdminChatUser(email);
    const chatSection = document.getElementById('adminChatThreadsList');
    if (chatSection) {
        chatSection.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
    const input = document.getElementById('adminChatReplyInput');
    if (input) {
        setTimeout(() => input.focus(), 350);
    }
}

async function fetchAdminChatThreads() {
    if (!isLoggedIn || isGuestMode) return;
    try {
        const res = await apiFetch('/api/admin/chats/threads');
        const data = await res.json();
        if (data.success && data.threads) {
            allChatsList = data.threads;
            renderAdminChatThreads(data.threads);
            if (!adminActiveChatUser && data.threads.length > 0) {
                selectAdminChatUser(data.threads[0].userEmail);
            }
        }
    } catch (err) {
        console.error('Fetch admin chat threads error:', err);
    }
}

function refreshAdminChatThreadsList() {
    let threads = [];
    
    if (isGuestMode) {
        const sortedGuest = [...guestChats].sort((a, b) => b.timestamp - a.timestamp);
        const threadsMap = {};
        const unreadMap = {};
        sortedGuest.forEach(chat => {
            const email = (chat.userEmail || '').trim();
            if (!email) return;
            const emailLower = email.toLowerCase();
            if (chat.sender === 'user' && !chat.read) {
                unreadMap[emailLower] = (unreadMap[emailLower] || 0) + 1;
            }
            if (!threadsMap[email]) {
                threadsMap[email] = {
                    userEmail: email,
                    userName: chat.userName || email.split('@')[0],
                    userPicture: chat.userPicture || '',
                    sender: chat.sender || 'user',
                    lastText: chat.text || '',
                    text: chat.text || '',
                    timestamp: chat.timestamp || Date.now(),
                    unreadCount: 0
                };
            }
        });
        threads = Object.values(threadsMap).map(t => ({
            ...t,
            unreadCount: unreadMap[(t.userEmail || '').toLowerCase()] || 0
        }));
    } else {
        threads = allChatsList || [];
    }
    
    renderAdminChatThreads(threads);
}

function renderAdminChatThreads(threads) {
    const container = document.getElementById('adminChatThreadsList');
    const countBadge = document.getElementById('adminChatThreadsCount');
    const totalUnreadBadge = document.getElementById('adminUnreadTotalBadge');
    if (!container) return;
    
    if (countBadge) {
        countBadge.textContent = threads ? threads.length : '0';
    }
    
    const totalUnread = (threads || []).reduce((acc, t) => acc + Number(t.unreadCount || 0), 0);
    if (totalUnreadBadge) {
        if (totalUnread > 0) {
            totalUnreadBadge.textContent = `${totalUnread} New`;
            totalUnreadBadge.style.display = 'inline-flex';
        } else {
            totalUnreadBadge.style.display = 'none';
        }
    }
    updateAdminNavBadge(totalUnread);
    
    if (!threads || threads.length === 0) {
        container.innerHTML = `
            <div style="text-align: center; color: var(--text-muted); font-size: 0.8rem; margin: auto; padding: 2rem 0.5rem; display: flex; flex-direction: column; align-items: center; gap: 0.5rem;">
                <i class="fas fa-inbox" style="font-size: 1.8rem; opacity: 0.35;"></i>
                <div style="font-weight: 600;">No user inquiries yet</div>
                <div style="font-size: 0.72rem; opacity: 0.7;">When visitors or clients send messages, they appear here.</div>
            </div>
        `;
        return;
    }
    
    container.innerHTML = '';
    threads.forEach(thread => {
        const email = thread.userEmail || 'Unknown User';
        const name = thread.userName || email.split('@')[0];
        const pic = thread.userPicture && thread.userPicture.trim() !== '' ? thread.userPicture : 'assets/images/default-avatar.svg';
        const rawMsg = thread.lastText || thread.text || '';
        const shortMsg = rawMsg.length > 25 ? rawMsg.substring(0, 25) + '...' : (rawMsg || 'Message sent');
        const isActive = email.toLowerCase() === (adminActiveChatUser || '').toLowerCase();
        const unreadCount = Number(thread.unreadCount || 0);
        
        const activeStyle = isActive 
            ? 'background: rgba(139, 92, 246, 0.2); border: 1px solid var(--primary); box-shadow: 0 0 10px rgba(139, 92, 246, 0.2);' 
            : 'background: var(--bg-card); border: 1px solid var(--border-color);';
        
        let timeStr = '';
        if (thread.timestamp) {
            const date = new Date(Number(thread.timestamp));
            const now = new Date();
            const diffMin = Math.floor((now - date) / 60000);
            if (diffMin < 1) timeStr = 'Just now';
            else if (diffMin < 60) timeStr = `${diffMin}m ago`;
            else if (diffMin < 1440) timeStr = `${Math.floor(diffMin / 60)}h ago`;
            else timeStr = date.toLocaleDateString([], { month: 'short', day: 'numeric' });
        }
        
        const senderBadge = thread.sender === 'user' 
            ? '<span style="font-size: 0.65rem; background: rgba(16, 185, 129, 0.2); color: #10b981; padding: 1px 5px; border-radius: 4px; font-weight: 600;">User</span>'
            : '<span style="font-size: 0.65rem; background: rgba(139, 92, 246, 0.2); color: #a78bfa; padding: 1px 5px; border-radius: 4px; font-weight: 600;">You</span>';
        
        const unreadBadgeHtml = unreadCount > 0 
            ? `<span class="whatsapp-unread-badge" title="${unreadCount} new messages">${unreadCount}</span>` 
            : '';

        const card = document.createElement('div');
        card.className = 'admin-chat-thread-item';
        card.style.cssText = `padding: 0.75rem; border-radius: 10px; cursor: pointer; ${activeStyle} transition: all 0.2s; display: flex; align-items: center; gap: 0.75rem;`;
        card.onclick = () => selectAdminChatUser(email);
        
        card.innerHTML = `
            <div style="position: relative; flex-shrink: 0;">
                <img src="${pic}" alt="${name}" style="width: 38px; height: 38px; border-radius: 50%; object-fit: cover; border: 1.5px solid rgba(255,255,255,0.15);" onerror="this.onerror=null; this.src='assets/images/default-avatar.svg';">
                <span class="chat-avatar-status-dot ${thread.isOnline ? 'online' : 'offline'}"></span>
            </div>
            <div style="flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 0.2rem;">
                <div style="display: flex; justify-content: space-between; align-items: center; gap: 0.25rem;">
                    <span style="font-weight: 600; font-size: 0.82rem; color: var(--text-primary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${name}</span>
                    <span style="font-size: 0.65rem; color: var(--text-muted); flex-shrink: 0;">${timeStr}</span>
                </div>
                <div style="display: flex; justify-content: space-between; align-items: center; gap: 0.5rem;">
                    <div style="font-size: 0.72rem; color: var(--text-secondary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; flex: 1;">
                        ${senderBadge} ${shortMsg}
                    </div>
                    ${unreadBadgeHtml}
                </div>
            </div>
        `;
        container.appendChild(card);
    });
}

let adminActiveChatUserName = '';
let adminActiveChatUserPicture = '';

function selectAdminChatUser(userEmail) {
    adminActiveChatUser = userEmail;
    
    let displayName = userEmail;
    const foundThread = (allChatsList || []).find(t => (t.userEmail || '').toLowerCase() === userEmail.toLowerCase())
        || (isGuestMode ? guestChats.find(c => (c.userEmail || '').toLowerCase() === userEmail.toLowerCase()) : null);
    
    const foundClient = (guestClients || []).find(c => (c.email || '').toLowerCase() === userEmail.toLowerCase());
    
    adminActiveChatUserName = (foundThread && foundThread.userName) || (foundClient && foundClient.name) || userEmail.split('@')[0];
    adminActiveChatUserPicture = (foundThread && foundThread.userPicture) || (foundClient && foundClient.picture) || '';
    
    if (adminActiveChatUserName && adminActiveChatUserName !== userEmail) {
        displayName = `${adminActiveChatUserName} (${userEmail})`;
    }
    
    const titleEl = document.getElementById('adminChatActiveUserTitle');
    if (titleEl) {
        titleEl.innerHTML = `
            <div style="display: flex; align-items: center; justify-content: space-between; width: 100%;">
                <div style="display: flex; align-items: center; gap: 0.5rem;">
                    <i class="fas fa-comment-dots" style="color: var(--primary);"></i>
                    <span>Chatting with: <strong style="color: var(--text-primary);">${displayName}</strong></span>
                </div>
                <span style="font-size: 0.72rem; color: var(--text-muted);"><i class="fas fa-circle" style="color: #10b981; font-size: 0.5rem; margin-right: 4px;"></i>Live</span>
            </div>
        `;
    }
    
    markAdminChatRead(userEmail);
    initAdminChatMessagesListener(userEmail);
    refreshAdminChatThreadsList();
}

function initAdminChatMessagesListener(userEmail) {
    stopAdminChatMessagesPolling();
    const windowEl = document.getElementById('adminChatMessagesWindow');
    if (!windowEl) return;
    
    if (isGuestMode) {
        const filtered = guestChats.filter(c => c.userEmail === userEmail);
        renderAdminMessages(filtered);
        return;
    }
    
    fetchAdminChatMessages(userEmail);
    adminChatMessagesListener = setInterval(() => fetchAdminChatMessages(userEmail), 1500);
}

function stopAdminChatMessagesPolling() {
    if (adminChatMessagesListener) {
        clearInterval(adminChatMessagesListener);
        adminChatMessagesListener = null;
    }
}

async function fetchAdminChatMessages(userEmail) {
    if (!isLoggedIn || isGuestMode || !userEmail) return;
    try {
        const res = await apiFetch(`/api/chats?userEmail=${encodeURIComponent(userEmail)}`);
        const data = await res.json();
        if (data.success && data.messages) {
            renderAdminMessages(data.messages);
        }
    } catch (err) {
        console.error('Fetch admin chat messages error:', err);
    }
}

function renderAdminMessages(messages) {
    const windowEl = document.getElementById('adminChatMessagesWindow');
    if (!windowEl) return;
    
    if (messages.length === 0) {
        windowEl.innerHTML = '<div style="text-align: center; color: var(--text-muted); font-size: 0.8rem; margin: auto; padding: 2rem 0.5rem;"><i class="fas fa-comment-dots" style="font-size: 1.8rem; opacity: 0.4; margin-bottom: 0.5rem; display: block;"></i>Select a client thread from the list to view chat.</div>';
        return;
    }
    
    windowEl.innerHTML = '';
    messages.forEach(msg => {
        const isAdmin = msg.sender === 'admin';
        const timeStr = msg.timestamp ? (msg.timestamp.toDate ? msg.timestamp.toDate().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })) : 'Sending...';
        
        // Avatar resolution
        const adminAvatar = (currentUserDetails && currentUserDetails.picture) || msg.adminPicture || 'assets/images/logo_round.jpg';
        const clientAvatar = msg.userPicture || adminActiveChatUserPicture || 'assets/images/default-avatar.svg';
        const avatarSrc = isAdmin ? adminAvatar : clientAvatar;
        const senderName = isAdmin ? '👑 Admin (You)' : (adminActiveChatUserName || msg.userEmail || 'Client');

        // WhatsApp double-ticks for outgoing bubbles
        const isRead = msg.read === true;
        const tickHtml = isAdmin 
            ? `<span class="chat-status-ticks ${isRead ? 'ticks-read' : 'ticks-delivered'}" title="${isRead ? 'Read (Blue Double-Tick)' : 'Delivered (Grey Double-Tick)'}"><i class="fas fa-check-double"></i></span>` 
            : '';

        const row = document.createElement('div');
        row.className = `chat-msg-row ${isAdmin ? 'msg-outgoing' : 'msg-incoming'}`;
        
        row.innerHTML = `
            <div class="chat-msg-avatar-wrap">
                <img src="${avatarSrc}" alt="${senderName}" class="chat-msg-avatar" onerror="this.onerror=null; this.src='assets/images/default-avatar.svg';">
            </div>
            <div class="chat-msg-bubble">
                <div class="chat-msg-sender-name">${senderName}</div>
                <div class="chat-msg-text">${msg.text}</div>
                <div class="chat-msg-time">${timeStr} ${tickHtml}</div>
            </div>
        `;
        windowEl.appendChild(row);
    });
    
    windowEl.scrollTop = windowEl.scrollHeight;
}

// ==================== GUEST PREVIEW SANDBOX LOGIC ====================
function enterGuestMode() {
    showLoader(true);
    isGuestMode = true;
    isLoggedIn = true;
    
    currentUserDetails = {
        name: "Guest Viewer",
        email: "guest@tunnelforde.lk",
        picture: "https://lh3.googleusercontent.com/a/default-user=s96-c"
    };
    
    currentUserCoins = 250;
    currentUserRole = 'user'; // Start as user in Guest mode, unlockable via search
    currentUserStatus = 'active';
    userUnlockedConfigs = ['g3']; // Start with 1 unlocked config
    
    // Set mock user document data for Guest Mode
    currentUserDocData = {
        plan: 'AIRTEL ZOOM SUPER S75',
        coins: 250,
        status: 'active',
        expiryTime: Date.now() + 24 * 24 * 60 * 60 * 1000
    };
    
    // UI elements update
    document.getElementById('loginCard').style.display = 'none';
    document.getElementById('appCard').style.display = 'flex';
    document.getElementById('welcomeUser').textContent = `Welcome back, Guest Viewer`;
    document.getElementById('userCoinsBalance').textContent = '250 Coins';
    const marketCoinBalEl = document.getElementById('marketCoinBalance');
    if (marketCoinBalEl) {
        marketCoinBalEl.textContent = '250 Coins';
    }
    document.getElementById('adminTabNav').style.display = 'none';
    
    // Load static mock details
    guestSubLink = '';
    renderGuestDashboard();
    renderGuestOrders();
    renderGuestAccounts();
    renderGuestAdminSlips();
    renderGuestAdminClients();
    initChatListener(currentUserDetails.email);
    initPackagesListener();
    startGlobalChatUnreadPolling();
    loadReferralData();
    
    showNotification('Entered Interactive Guest Mode! Explore all views.', 'success');
    switchTab('dashboard');
    showLoader(false);
}

function renderGuestDashboard() {
    // Stat boxes
    document.getElementById('statUpload').textContent = '14.50 GB';
    document.getElementById('statDownload').textContent = '68.20 GB';
    document.getElementById('statExpiry').textContent = '24 Days';
    document.getElementById('statStatus').textContent = 'ACTIVE';
    document.getElementById('statusBadgeIcon').className = 'stat-icon icon-status active';
    
    // Bar fills
    document.getElementById('barUploadText').textContent = '14.50 GB';
    document.getElementById('barDownloadText').textContent = '68.20 GB';
    document.getElementById('barUploadFill').style.width = '21%';
    document.getElementById('barDownloadFill').style.width = '100%';
    
    // Circle Gauge progress (82.7GB out of 100GB limit -> 83%)
    document.getElementById('gaugePercentText').textContent = '83%';
    document.getElementById('gaugeUsedVal').textContent = '82.70 GB';
    document.getElementById('gaugeRemainingVal').textContent = '17.30 GB';
    
    const circle = document.getElementById('gaugeCircleFill');
    const radius = circle.r.baseVal.value;
    const circumference = 2 * Math.PI * radius; // ~251.2
    circle.style.strokeDashoffset = circumference - (circumference * 83 / 100);
    
    // Config selector dropdown
    const selector = document.getElementById('configSelector');
    selector.innerHTML = '<option value="g-active">AIRTEL ZOOM SUPER S75 - guest@tunnelforde.lk</option>';
    
    // Update connection status info card in guest mode
    const connectionStatusContent = document.getElementById('connectionStatusContent');
    if (connectionStatusContent) {
        const activePlan = guestClients.find(c => c.email === currentUserDetails.email)?.plan || 'AIRTEL ZOOM SUPER S75';
        const expiryTime = guestClients.find(c => c.email === currentUserDetails.email)?.expiryTime || (Date.now() + 24 * 24 * 60 * 60 * 1000);
        const expiryText = new Date(expiryTime).toLocaleDateString();
        connectionStatusContent.innerHTML = `
            <i class="fas fa-circle-check text-gradient" style="font-size: 3rem; color: var(--success); margin-bottom: 1rem; display: block;"></i>
            <p style="color: var(--text-primary); font-size: 0.95rem; font-weight: 700; margin-bottom: 0.25rem;">${activePlan} is Active</p>
            <p style="color: var(--text-secondary); font-size: 0.8rem; margin-bottom: 1rem; text-align: center;">Expires on: ${expiryText}</p>
            <button class="btn btn-primary" style="padding: 0.65rem 1.25rem; border-radius: 10px; font-size: 0.85rem; font-weight: 600; width: 100%;" onclick="openRenewModal()"><i class="fas fa-rotate"></i> Renew Plan</button>
        `;
    }
}

function renderGuestOrders() {
    const historyBody = document.getElementById('userSlipsHistoryBody');
    if (!historyBody) return;
    
    historyBody.innerHTML = '';
    guestUserSlips.forEach(slip => {
        const tr = document.createElement('tr');
        tr.className = 'order-card-row';
        const dateStr = slip.created_at ? new Date(slip.created_at).toLocaleString() : 'Just now';
        const rawSlip = String(slip.slipUrl || '');
        const priceVal = typeof slip.price === 'number' ? slip.price : parseFloat(slip.price) || 0;
        const isCoinOrder = slip.isCoinOrder || slip.paymentMethod === 'coins' || rawSlip === 'coins' || rawSlip.includes('COIN') || (priceVal === 0 && slip.coinCost > 0);
        const coinCost = slip.coinCost || 100;
        
        let priceHtml = `<strong>LKR ${priceVal.toFixed(2)}</strong>`;
        let slipHtml = '';
        
        if (isCoinOrder) {
            priceHtml = `<span class="badge-order-coins"><i class="fas fa-coins text-gold"></i> ${coinCost} Coins</span>`;
            slipHtml = `<span class="badge-coin-redeem" title="Redeemed with Data Coins"><i class="fas fa-coins"></i> Coin Redeem</span>`;
        } else if (rawSlip && rawSlip.length > 5) {
            const safeUrl = rawSlip.replace(/'/g, "\\'");
            slipHtml = `<img src="${rawSlip}" class="thumbnail-slip" onclick="viewFullImage('${safeUrl}')" alt="Receipt">`;
        } else {
            slipHtml = `<span style="color: var(--text-muted); font-size: 0.8rem;">No Slip</span>`;
        }

        tr.innerHTML = `
            <td>
                <span class="mobile-td-label"><i class="fas fa-calendar-alt"></i> Date</span>
                <span class="order-td-value">${dateStr}</span>
            </td>
            <td>
                <span class="mobile-td-label"><i class="fas fa-box"></i> Package</span>
                <span class="order-td-value"><strong>${getPlanDisplayName(slip.planId)}${slip.selected_gb ? ` (${slip.selected_gb} GB)` : ''}</strong></span>
            </td>
            <td>
                <span class="mobile-td-label"><i class="fas fa-tag"></i> Price</span>
                <span class="order-td-value">${priceHtml}</span>
            </td>
            <td>
                <span class="mobile-td-label"><i class="fas fa-receipt"></i> Payment Slip</span>
                <span class="order-td-value">${slipHtml}</span>
            </td>
            <td>
                <span class="mobile-td-label"><i class="fas fa-info-circle"></i> Status</span>
                <span class="order-td-value"><span class="badge-status ${slip.status}">${slip.status.toUpperCase()}</span></span>
            </td>
        `;
        historyBody.appendChild(tr);
    });
}

function renderGuestAccounts() {
    const link = guestSubLink || 'vless://guest-token-unlocked-uuid@premium.tunnelfordelk.shop:443?type=tcp&security=tls#TunnelFordeLK-Premium-Guest';
    const unlinkBtnHtml = guestSubLink ? `<button class="btn btn-secondary" style="padding: 0.5rem 1rem; border-radius: 8px; font-size: 0.8rem; border-color: #ef4444; color: #ef4444;" onclick="unlinkSubscription()"><i class="fas fa-link-slash"></i> Unlink</button>` : '';
    
    const blockHtml = `
        <div class="active-config-card">
            <div class="config-header-row">
                <div class="config-title-group">
                    <h4>AIRTEL ZOOM SUPER S75 V2Ray Subscription Line</h4>
                    <span>Assigned to: guest@tunnelforde.lk</span>
                </div>
                <span class="badge-status active">ACTIVE</span>
            </div>
            
            <div class="config-details-row">
                <div class="detail-item">
                    <span>Server Node</span>
                    <strong>Tunnel Forde Premium Server 75</strong>
                </div>
                <div class="detail-item">
                    <span>Subscription Plan</span>
                    <strong>AIRTEL ZOOM SUPER S75 Pack</strong>
                </div>
                <div class="detail-item">
                    <span>Expiration</span>
                    <strong>24 Days left</strong>
                </div>
            </div>
            
            <div class="form-group" style="margin-bottom: 0;">
                <label>Vless / Vmess Configuration Link</label>
                <div class="sub-link-input-group">
                    <input type="text" class="sub-link-input" id="subLinkInput" readonly value="${link}">
                    <button class="btn-sub primary" onclick="copySubscriptionLink()"><i class="fas fa-copy"></i> Copy</button>
                    <button class="btn-sub secondary" onclick="openSubscriptionQrModal('${link}')"><i class="fas fa-qrcode"></i> QR Code</button>
                </div>
            </div>
            
            <div class="action-buttons" style="display: flex; gap: 0.5rem; margin-top: 1rem; flex-wrap: wrap;">
                <button class="btn btn-primary" style="padding: 0.5rem 1rem; border-radius: 8px; font-size: 0.8rem; font-weight: 600;" onclick="openRenewModal()"><i class="fas fa-rotate"></i> Renew Plan</button>
                ${unlinkBtnHtml}
            </div>
        </div>
    `;
    document.getElementById('activeConfigsSection').innerHTML = blockHtml;
    document.getElementById('accountsWrapper').innerHTML = blockHtml;
}

// Render guest configs market (Locked Configs)
function renderGuestConfigsMarket() {
    const freeGrid = document.getElementById('freeConfigsListGrid');
    const premiumGrid = document.getElementById('premiumConfigsListGrid');
    if (!freeGrid) return;
    
    const marketCoinBalEl = document.getElementById('marketCoinBalance');
    if (marketCoinBalEl) {
        marketCoinBalEl.textContent = `${Math.floor(currentUserCoins)} Coins`;
    }
    
    freeGrid.innerHTML = '';
    if (premiumGrid) premiumGrid.innerHTML = '';
    
    let freeCount = 0;
    let premiumCount = 0;
    
    guestConfigs.forEach(config => {
        const configId = config.id;
        const isUnlocked = userUnlockedConfigs.includes(configId) || (config.coinCost === 0 && config.price === 0);
        
        const card = document.createElement('div');
        card.className = `config-market-card ${isUnlocked ? 'unlocked' : 'locked'}`;
        
        if (isUnlocked) {
            card.innerHTML = `
                <span class="network-badge">${config.isp}</span>
                <h4>${config.title}</h4>
                <p style="color: var(--success); font-weight:700;"><i class="fas fa-circle-check"></i> Unlocked / Free</p>
                
                <div class="form-group" style="margin-top: 0.5rem; margin-bottom: 0;">
                    <div class="sub-link-input-group">
                        <input type="text" class="sub-link-input" id="freeLink-${configId}" readonly value="${config.config}">
                        <button class="btn-sub primary" onclick="copyFreeLink('${configId}')"><i class="fas fa-copy"></i> Copy</button>
                        <button class="btn-sub secondary" onclick="openSubscriptionQrModal('${(config.config || '').replace(/'/g, "\\'")}')"><i class="fas fa-qrcode"></i> QR</button>
                    </div>
                </div>
            `;
        } else {
            let unlockButtonsHtml = '';
            if (config.coinCost > 0) {
                unlockButtonsHtml += `
                     <button class="btn-unlock-config" onclick="unlockFreeConfig('${configId}', ${config.coinCost})" style="width: 100%;">
                          <i class="fas fa-coins text-gold"></i> Unlock with ${config.coinCost} Coins
                     </button>
                `;
            }
            if (config.price > 0) {
                unlockButtonsHtml += `
                     <button class="btn-unlock-config" style="margin-top: 0.5rem; background: linear-gradient(135deg, #ec4899 0%, #8b5cf6 100%); width: 100%;" onclick="buyConfigWithCash('${configId}', '${config.title.replace(/'/g, "\\'")}', ${config.price})">
                          <i class="fas fa-credit-card"></i> Buy for LKR ${config.price.toFixed(2)}
                     </button>
                `;
            }
            card.innerHTML = `
                <span class="network-badge">${config.isp}</span>
                <h4>${config.title}</h4>
                <p style="color: var(--text-secondary); font-size: 0.8rem;">Requires coins or payment to unlock payload details.</p>
                
                <div class="config-lock-overlay" style="padding: 1rem 0.5rem;">
                    <div class="lock-icon-circle">
                        <i class="fas fa-lock"></i>
                    </div>
                    ${unlockButtonsHtml}
                </div>
            `;
        }
        
        if (config.coinCost === 0 && config.price === 0) {
            freeGrid.appendChild(card);
            freeCount++;
        } else if (premiumGrid) {
            premiumGrid.appendChild(card);
            premiumCount++;
        }
    });
    
    if (freeCount === 0) {
        freeGrid.innerHTML = '<div style="grid-column:1/-1; text-align:center; color: var(--text-muted); padding: 2rem;">No free configurations available.</div>';
    }
    if (premiumGrid && premiumCount === 0) {
        premiumGrid.innerHTML = '<div style="grid-column:1/-1; text-align:center; color: var(--text-muted); padding: 2rem;">No premium configurations available.</div>';
    }
}

function renderGuestAdminSlips() {
    const container = document.getElementById('adminPendingSlipsList');
    if (!container) return;
    
    document.getElementById('pendingSlipsCount').textContent = guestSlips.length;
    
    if (guestSlips.length === 0) {
        container.innerHTML = '<div style="text-align: center; color: var(--text-muted); padding: 2rem;">No pending slips found.</div>';
        return;
    }
    
    container.innerHTML = '';
    guestSlips.forEach(slip => {
        const dateStr = slip.created_at.toLocaleString();
        const card = document.createElement('div');
        card.className = 'admin-slip-card';
        card.innerHTML = `
            <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap: 0.5rem;">
                <div class="slip-user-info">
                    <h5>${slip.email}</h5>
                    <span>Submitted: ${dateStr}</span>
                </div>
                <img src="${slip.slipUrl}" class="thumbnail-slip" style="width:55px; height:55px;" onclick="viewFullImage('${slip.slipUrl}')">
            </div>
            
            <div class="slip-meta-details">
                <span>Item: <strong>${getPlanDisplayName(slip.planId)}${slip.selected_gb ? ` (${slip.selected_gb} GB)` : ''}</strong></span>
                <span>Price: <strong>LKR ${slip.price.toFixed(2)}</strong></span>
            </div>
            
            <div class="action-buttons" style="margin-top: 0.25rem;">
                <button class="btn-sub primary" style="background:#10b981; flex:1; justify-content:center;" onclick="adminProcessSlip('${slip.id}', 'approved')"><i class="fas fa-check"></i> Approve</button>
                <button class="btn-sub primary" style="background:#ef4444; flex:1; justify-content:center;" onclick="adminProcessSlip('${slip.id}', 'rejected')"><i class="fas fa-times"></i> Reject</button>
            </div>
        `;
        container.appendChild(card);
    });
}

function renderGuestAdminClients() {
    const tbody = document.getElementById('adminClientsTableBody');
    if (!tbody) return;
    
    tbody.innerHTML = '';
    guestClients.forEach(client => {
        const clientEmail = (client.email || 'Unknown').trim();
        const clientName = (client.name || clientEmail.split('@')[0] || 'Client').trim();
        const clientPic = client.picture && client.picture.trim() !== '' ? client.picture : 'assets/images/default-avatar.svg';
        const tr = document.createElement('tr');
        const expiryText = client.expiryTime && client.expiryTime > 0 ? new Date(client.expiryTime).toLocaleDateString() : 'None';
        const escEmail = clientEmail.replace(/'/g, "\\'");
        const escPlan = (client.plan || 'None').replace(/'/g, "\\'");
        const escStatus = (client.status || 'inactive').replace(/'/g, "\\'");
        const escRole = (client.role || 'user').replace(/'/g, "\\'");
        
        const roleClass = escRole.toLowerCase() === 'admin' ? 'admin' : 'user';
        const statusClass = escStatus.toLowerCase() === 'active' ? 'active' : 'inactive';
        
        tr.innerHTML = `
            <td>
                <div class="admin-client-info-cell">
                    <div class="admin-client-avatar-wrapper">
                        <img src="${clientPic}" alt="${clientName}" class="admin-client-avatar" onerror="this.onerror=null; this.src='assets/images/default-avatar.svg';">
                    </div>
                    <div class="admin-client-details">
                        <div class="admin-client-name" title="${clientName}">${clientName}</div>
                        <div class="admin-client-email" title="${clientEmail}">${clientEmail}</div>
                        <div class="admin-client-badges">
                            <span class="client-badge ${roleClass}">${escRole.toUpperCase()}</span>
                            <span class="client-badge ${statusClass}">${escStatus.toUpperCase()}</span>
                        </div>
                    </div>
                </div>
            </td>
            <td>
                <div style="font-weight:600; font-size:0.82rem; color: var(--text-primary);">${client.plan || 'None'}</div>
                <div style="font-size:0.72rem; color: var(--text-muted); margin-top: 2px;"><i class="far fa-calendar-alt" style="margin-right: 4px;"></i>Expiry: ${expiryText}</div>
            </td>
            <td><strong style="color: #f59e0b; font-size: 0.95rem;">🪙 ${Math.floor(client.coins || 0)}</strong></td>
            <td>
                <div style="display: flex; gap: 0.35rem; align-items: center;">
                    <button class="btn-sub secondary" style="padding:0.4rem 0.65rem; border-radius: 8px; font-weight: 500;" onclick="openAdminEditUserModal('${escEmail}', '${escPlan}', '${escStatus}', '${escRole}', ${client.coins || 0}, ${client.expiryTime || 0})" title="Edit user details"><i class="fas fa-edit"></i> Edit</button>
                    <button class="btn-sub primary" style="padding:0.4rem 0.65rem; border-radius: 8px; font-weight: 500; background: var(--primary);" onclick="adminDirectStartChat('${escEmail}')" title="Chat with this client"><i class="fas fa-comment"></i> Chat</button>
                </div>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

// ----------------------------------------------------
// DYNAMIC PACKAGES DATABASE INITIALIZATION & LISTENERS
// ----------------------------------------------------

function initPackagesListener() {
    stopPackagesPolling();
    if (isGuestMode) {
        renderPackages();
        return;
    }
    
    fetchPackages();
    packagesInterval = setInterval(fetchPackages, 10000);
}

function stopPackagesPolling() {
    if (packagesInterval) {
        clearInterval(packagesInterval);
        packagesInterval = null;
    }
}

async function fetchPackages() {
    if (isGuestMode) {
        renderPackages();
        return;
    }
    try {
        const res = await fetch('/api/packages');
        const data = await res.json();
        if (data.success && data.packages) {
            availablePackages = data.packages;
            renderPackages();
            renderAdminPackagesTable();
        }
    } catch (err) {
        console.error('Fetch packages error:', err);
    }
}

function toggleEditPkgOfferFields() {
    const isOffer = document.getElementById('editPkgIsOffer').checked;
    const badgeSelect = document.getElementById('editPkgBadge');
    if (isOffer && (!badgeSelect.value || badgeSelect.value === '')) {
        badgeSelect.value = 'limited';
    }
    updateEditPkgDiscountPreview();
}

function updateEditPkgDiscountPreview() {
    const isOffer = document.getElementById('editPkgIsOffer') ? document.getElementById('editPkgIsOffer').checked : false;
    const origPrice = parseFloat(document.getElementById('editPkgOriginalPrice').value) || 0;
    const salePrice = parseFloat(document.getElementById('editPkgPrice').value) || 0;
    const badgeEl = document.getElementById('editPkgDiscountPreview');
    if (!badgeEl) return;
    
    if (isOffer && origPrice > salePrice && origPrice > 0) {
        const discount = Math.round(((origPrice - salePrice) / origPrice) * 100);
        badgeEl.textContent = `${discount}% OFF`;
        badgeEl.style.display = 'inline-block';
    } else {
        badgeEl.style.display = 'none';
    }
}

function renderAdminPackagesTable() {
    const tbody = document.getElementById('adminPackagesTableBody');
    if (!tbody) return;
    
    tbody.innerHTML = '';
    
    availablePackages.forEach(pkg => {
        const tr = document.createElement('tr');
        
        const escId = pkg.id.replace(/'/g, "\\'");
        const hasOffer = pkg.isOffer || (pkg.originalPrice && pkg.originalPrice > pkg.price) || pkg.badge === 'limited' || pkg.badge === 'offer' || pkg.badge === 'hot';
        
        tr.innerHTML = `
            <td>
                <div style="font-weight: 600;">${pkg.name}</div>
                <div style="font-size: 0.7rem; color: var(--text-secondary);">${pkg.server}</div>
            </td>
            <td>
                <div style="font-weight: 600; color: ${pkg.network === 'Airtel' ? '#ef4444' : '#10b981'};">${pkg.network}</div>
                <div style="display: flex; align-items: baseline; gap: 0.4rem; flex-wrap: wrap; margin-top: 2px;">
                    <span style="font-weight: 700; color: ${hasOffer ? '#10b981' : 'inherit'}; font-size: 0.85rem;">LKR ${pkg.price.toFixed(2)}</span>
                    ${(pkg.originalPrice && pkg.originalPrice > pkg.price) ? `<span style="font-size: 0.72rem; color: var(--text-muted); text-decoration: line-through;">LKR ${pkg.originalPrice.toFixed(2)}</span>` : ''}
                    ${hasOffer ? `<span style="font-size: 0.65rem; padding: 1px 6px; border-radius: 6px; font-weight: 800; background: rgba(239, 68, 68, 0.18); color: #ef4444;">${(pkg.badge || 'OFFER').toUpperCase()}</span>` : ''}
                </div>
            </td>
            <td>
                <div style="font-size: 0.8rem;">${pkg.limitGB} GB / ${pkg.days} Days</div>
                <div style="font-size: 0.7rem; color: var(--text-secondary);">${(pkg.desc || '').replace(/\s*\([^)]*\.[a-z]{2,}[^)]*\)/gi, '').trim()}</div>
            </td>
            <td>
                <div style="font-size: 0.8rem;"><i class="fas fa-coins text-gold"></i> Cost: ${pkg.coinCost}</div>
                <div style="font-size: 0.7rem; color: var(--text-secondary);">Bonus: +${pkg.bonusCoins}</div>
            </td>
            <td>
                <button class="btn-sub secondary" style="padding: 0.4rem 0.6rem;" onclick="openAdminEditPackageModal('${escId}')">
                    <i class="fas fa-edit"></i> Edit
                </button>
            </td>
        `;
        
        tbody.appendChild(tr);
    });
}

function openAdminEditPackageModal(idOrPkg, name, network, price, limitGB, days, desc, promo, server, remaining, bonusCoins, coinCost, badge, originalPrice, isOffer) {
    let pkg = null;
    if (typeof idOrPkg === 'object' && idOrPkg !== null) {
        pkg = idOrPkg;
    } else {
        pkg = availablePackages.find(p => p.id === idOrPkg);
    }
    
    const idVal = pkg ? pkg.id : idOrPkg;
    const nameVal = pkg ? pkg.name : name;
    const networkVal = pkg ? pkg.network : network;
    const priceVal = pkg ? pkg.price : price;
    const origVal = pkg ? (pkg.originalPrice !== null && pkg.originalPrice !== undefined ? pkg.originalPrice : '') : (originalPrice || '');
    const isOfferVal = pkg ? (pkg.isOffer === true || Boolean(pkg.originalPrice && pkg.originalPrice > pkg.price) || pkg.badge === 'limited' || pkg.badge === 'offer' || pkg.badge === 'hot') : Boolean(isOffer);
    const limitGBVal = pkg ? pkg.limitGB : limitGB;
    const daysVal = pkg ? pkg.days : days;
    const rawDesc = pkg ? pkg.desc : desc;
    const descVal = (rawDesc || '').replace(/\s*\([^)]*\.[a-z]{2,}[^)]*\)/gi, '').trim();
    const promoVal = pkg ? (pkg.promo || '') : (promo || '');
    const serverVal = pkg ? pkg.server : server;
    const remainingVal = pkg ? pkg.remaining : remaining;
    const bonusCoinsVal = pkg ? pkg.bonusCoins : bonusCoins;
    const coinCostVal = pkg ? pkg.coinCost : coinCost;
    const badgeVal = pkg ? (pkg.badge || '') : (badge || '');

    document.getElementById('editPkgId').value = idVal;
    document.getElementById('editPkgName').value = nameVal;
    document.getElementById('editPkgNetwork').value = networkVal;
    document.getElementById('editPkgPrice').value = priceVal;
    document.getElementById('editPkgOriginalPrice').value = origVal;
    document.getElementById('editPkgIsOffer').checked = isOfferVal;
    document.getElementById('editPkgLimitGB').value = limitGBVal;
    document.getElementById('editPkgDays').value = daysVal;
    document.getElementById('editPkgDesc').value = descVal;
    document.getElementById('editPkgPromo').value = promoVal;
    document.getElementById('editPkgServer').value = serverVal;
    document.getElementById('editPkgRemaining').value = remainingVal;
    document.getElementById('editPkgBonusCoins').value = bonusCoinsVal;
    document.getElementById('editPkgCoinCost').value = coinCostVal;
    document.getElementById('editPkgBadge').value = badgeVal;
    
    updateEditPkgDiscountPreview();
    document.getElementById('adminEditPackageModal').style.display = 'flex';
}

function closeAdminEditPackageModal() {
    document.getElementById('adminEditPackageModal').style.display = 'none';
}

async function saveAdminPackageChanges(event) {
    event.preventDefault();
    showLoader(true);
    
    const id = document.getElementById('editPkgId').value;
    const name = document.getElementById('editPkgName').value.trim();
    const network = document.getElementById('editPkgNetwork').value;
    const price = parseFloat(document.getElementById('editPkgPrice').value) || 0;
    const rawOrig = parseFloat(document.getElementById('editPkgOriginalPrice').value);
    const originalPrice = (!isNaN(rawOrig) && rawOrig > 0) ? rawOrig : null;
    const isOffer = document.getElementById('editPkgIsOffer').checked;
    const limitGB = parseInt(document.getElementById('editPkgLimitGB').value) || 0;
    const days = parseInt(document.getElementById('editPkgDays').value) || 0;
    const desc = document.getElementById('editPkgDesc').value.trim();
    const promo = document.getElementById('editPkgPromo').value.trim();
    const server = document.getElementById('editPkgServer').value.trim();
    const remaining = parseInt(document.getElementById('editPkgRemaining').value) || 0;
    const bonusCoins = parseInt(document.getElementById('editPkgBonusCoins').value) || 0;
    const coinCost = parseInt(document.getElementById('editPkgCoinCost').value) || 0;
    const badge = document.getElementById('editPkgBadge').value;
    
    const pkgPayload = {
        id,
        name,
        network,
        price,
        originalPrice,
        isOffer,
        limitGB,
        days,
        desc,
        promo,
        server,
        remaining,
        bonusCoins,
        coinCost,
        badge: badge || null
    };
    
    if (isGuestMode) {
        const idx = availablePackages.findIndex(p => p.id === id);
        if (idx !== -1) {
            availablePackages[idx] = { ...availablePackages[idx], ...pkgPayload };
            renderPackages();
            renderAdminPackagesTable();
            showNotification('✓ Package updated successfully in Guest Mode!', 'success');
            closeAdminEditPackageModal();
        }
        showLoader(false);
        return;
    }
    
    try {
        const response = await apiFetch(`/api/admin/packages/${encodeURIComponent(id)}`, {
            method: 'PUT',
            body: JSON.stringify(pkgPayload)
        });
        const data = await response.json();
        if (data.success) {
            showNotification('✓ Package updated successfully!', 'success');
            closeAdminEditPackageModal();
            fetchPackages();
        } else {
            showNotification(data.message || 'Failed to update package details.', 'error');
        }
        showLoader(false);
    } catch (err) {
        console.error('Error saving package edits:', err);
        showNotification('Failed to update package details.', 'error');
        showLoader(false);
    }
}

// ==========================================================================
// REFERRAL PROGRAM & SUBSCRIPTION QR CODE MODULE
// ==========================================================================

let cachedReferralData = null;

async function loadReferralData() {
    if (!isLoggedIn) return;
    
    if (isGuestMode) {
        const linkInput = document.getElementById('dashboardReferralLinkInput');
        if (linkInput) {
            linkInput.value = `${window.location.origin}/?ref=TF-DEMO`;
        }
        const friendsEl = document.getElementById('refStatsFriends');
        if (friendsEl) friendsEl.textContent = '3';
        const purchasesEl = document.getElementById('refStatsPurchases');
        if (purchasesEl) purchasesEl.textContent = '2';
        const coinsEl = document.getElementById('refStatsCoins');
        if (coinsEl) coinsEl.innerHTML = `<i class="fas fa-coins text-gold"></i> +20 Coins`;
        return;
    }

    const linkInput = document.getElementById('dashboardReferralLinkInput');
    const fallbackCode = currentUserDocData?.referral_code || currentUserDetails?.referral_code;
    if (linkInput && fallbackCode && (linkInput.value.includes('Loading') || !linkInput.value)) {
        linkInput.value = `${window.location.origin}/?ref=${fallbackCode}`;
    }

    try {
        const res = await apiFetch('/api/user/referral');
        const data = await res.json();
        if (data && data.success) {
            cachedReferralData = data;
            if (linkInput && data.referralLink) {
                linkInput.value = data.referralLink;
            }
            const friendsEl = document.getElementById('refStatsFriends');
            if (friendsEl) {
                friendsEl.textContent = data.friendsJoined !== undefined ? data.friendsJoined : 0;
            }
            const purchasesEl = document.getElementById('refStatsPurchases');
            if (purchasesEl) {
                purchasesEl.textContent = data.packagesPurchased !== undefined ? data.packagesPurchased : 0;
            }
            const coinsEl = document.getElementById('refStatsCoins');
            if (coinsEl) {
                coinsEl.innerHTML = `<i class="fas fa-coins text-gold"></i> +${data.coinsEarned || 0} Coins`;
            }
        } else if (linkInput && fallbackCode) {
            linkInput.value = `${window.location.origin}/?ref=${fallbackCode}`;
        }
    } catch (e) {
        console.error('Error loading referral stats:', e);
        if (linkInput && fallbackCode) {
            linkInput.value = `${window.location.origin}/?ref=${fallbackCode}`;
        }
    }
}

function scrollToReferralCard(event) {
    if (event) event.preventDefault();
    switchTab('dashboard');
    setTimeout(() => {
        const card = document.getElementById('dashboardReferralProgramCard');
        if (card) {
            card.scrollIntoView({ behavior: 'smooth', block: 'center' });
            card.style.transition = 'box-shadow 0.4s ease';
            card.style.boxShadow = '0 0 30px rgba(251, 191, 36, 0.45)';
            setTimeout(() => {
                card.style.boxShadow = '';
            }, 2500);
        }
    }, 120);
}

function copyReferralLink() {
    const linkInput = document.getElementById('dashboardReferralLinkInput');
    let val = linkInput ? linkInput.value.trim() : '';
    if (!val || val.includes('Loading') || val.includes('Generating')) {
        const fallbackCode = currentUserDocData?.referral_code || currentUserDetails?.referral_code;
        if (fallbackCode) {
            val = `${window.location.origin}/?ref=${fallbackCode}`;
            if (linkInput) linkInput.value = val;
        } else {
            showNotification('Referral link is preparing, please wait a moment...', 'info');
            return;
        }
    }
    navigator.clipboard.writeText(val).then(() => {
        showNotification('Personal referral link copied to clipboard! Share with friends to earn +10 Data Coins.', 'success');
    }).catch(() => {
        if (linkInput) linkInput.select();
        document.execCommand('copy');
        showNotification('Referral link copied!', 'success');
    });
}

function shareReferralWhatsApp() {
    const linkInput = document.getElementById('dashboardReferralLinkInput');
    let val = (linkInput && linkInput.value && !linkInput.value.includes('Loading') && !linkInput.value.includes('Generating')) ? linkInput.value.trim() : '';
    if (!val) {
        const fallbackCode = currentUserDocData?.referral_code || currentUserDetails?.referral_code;
        val = fallbackCode ? `${window.location.origin}/?ref=${fallbackCode}` : window.location.origin;
    }
    const msg = `⚡ Unlimited High-Speed V2Ray Internet with TunnelForde!\nJoin using my invite link:\n${val}`;
    window.open(`https://api.whatsapp.com/send?text=${encodeURIComponent(msg)}`, '_blank');
}

function shareReferralTelegram() {
    const linkInput = document.getElementById('dashboardReferralLinkInput');
    let val = (linkInput && linkInput.value && !linkInput.value.includes('Loading') && !linkInput.value.includes('Generating')) ? linkInput.value.trim() : '';
    if (!val) {
        const fallbackCode = currentUserDocData?.referral_code || currentUserDetails?.referral_code;
        val = fallbackCode ? `${window.location.origin}/?ref=${fallbackCode}` : window.location.origin;
    }
    const msg = `⚡ Unlimited High-Speed V2Ray Internet with TunnelForde!`;
    window.open(`https://t.me/share/url?url=${encodeURIComponent(val)}&text=${encodeURIComponent(msg)}`, '_blank');
}

function openSubscriptionQrModal(link) {
    const targetLink = link || (currentUserDocData && (currentUserDocData.configLink || currentUserDocData.subLink)) || '';
    if (!targetLink) {
        showNotification('No configuration link available to generate QR code.', 'warning');
        return;
    }
    const modal = document.getElementById('subscriptionQrModal');
    const qrImg = document.getElementById('subscriptionQrImage');
    const linkInput = document.getElementById('subscriptionQrLinkInput');
    if (!modal) return;

    if (linkInput) linkInput.value = targetLink;
    if (qrImg) {
        qrImg.src = `https://api.qrserver.com/v1/create-qr-code/?size=260x260&margin=10&data=${encodeURIComponent(targetLink)}`;
    }
    modal.style.display = 'flex';
}

function closeSubscriptionQrModal() {
    const modal = document.getElementById('subscriptionQrModal');
    if (modal) modal.style.display = 'none';
}

function copySubscriptionQrLink() {
    const linkInput = document.getElementById('subscriptionQrLinkInput');
    if (!linkInput || !linkInput.value) return;
    navigator.clipboard.writeText(linkInput.value).then(() => {
        showNotification('Configuration link copied to clipboard!', 'success');
    }).catch(() => {
        linkInput.select();
        document.execCommand('copy');
        showNotification('Configuration link copied!', 'success');
    });
}

