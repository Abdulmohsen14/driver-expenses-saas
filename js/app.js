// ==========================================
// 1. أكواد الحماية (منع المتطفلين من فحص الموقع)
// ==========================================
try {
    document.addEventListener('contextmenu', event => event.preventDefault()); // منع كليك يمين
    document.onkeydown = function(e) {
        if(e.keyCode == 123) return false; // منع F12
        if(e.ctrlKey && e.shiftKey && e.keyCode == 'I'.charCodeAt(0)) return false; // Ctrl+Shift+I
        if(e.ctrlKey && e.shiftKey && e.keyCode == 'J'.charCodeAt(0)) return false; // Ctrl+Shift+J
        if(e.ctrlKey && e.keyCode == 'U'.charCodeAt(0)) return false; // Ctrl+U (Source)
    }
} catch (err) { console.warn("Security layer error"); }

// ==========================================
// 2. الاستدعاءات والإعدادات الأساسية
// ==========================================
import { db } from './firebase-config.js';
import { collection, query, where, doc, deleteDoc, updateDoc, addDoc, getDoc, onSnapshot, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { getAuth, updatePassword, updateProfile, verifyBeforeUpdateEmail } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";

const auth = getAuth();
const contentArea = document.querySelector('.content-area');
const navItems = document.querySelectorAll('.nav-item');
const BOT_USERNAME = "DriverExpenseTrackerBot"; // اسم بوت التيليجرام الخاص بك

let currentUser = null;
let unsubscribeExpenses = null;
let unsubscribeDrivers = null;
let unsubscribeDashboardDrivers = null;
let unsubscribeDriversExpenses = null;
let unsubscribeAnalyticsDrivers = null;
let unsubscribeAnalyticsExpenses = null;
let unsubscribeTelegramObserver = null;
let activeDriverId = null; 
window.userTelegramLinked = false; // متغير عالمي يراقب حالة التيليجرام بدون قلتش

// استرجاع اللغة
try {
    const savedLang = localStorage.getItem('site_lang');
    if (savedLang === 'en') {
        document.documentElement.lang = 'en';
        document.documentElement.dir = 'ltr';
    } else {
        document.documentElement.lang = 'ar';
        document.documentElement.dir = 'rtl';
    }
} catch(e) {}
applyLanguage();

function cleanupSubscriptions() {
    if (unsubscribeExpenses) unsubscribeExpenses();
    if (unsubscribeDrivers) unsubscribeDrivers();
    if (unsubscribeDashboardDrivers) unsubscribeDashboardDrivers();
    if (unsubscribeDriversExpenses) unsubscribeDriversExpenses();
    if (unsubscribeAnalyticsDrivers) unsubscribeAnalyticsDrivers();
    if (unsubscribeAnalyticsExpenses) unsubscribeAnalyticsExpenses();
    unsubscribeExpenses = null;
    unsubscribeDrivers = null;
    unsubscribeDashboardDrivers = null;
    unsubscribeDriversExpenses = null;
    unsubscribeAnalyticsDrivers = null;
    unsubscribeAnalyticsExpenses = null;
}

// ترتيب السائقين من الأحدث للأقدم
function sortByNewest(arr) {
    return arr.slice().sort((a, b) => {
        const timeA = (a.createdAt && a.createdAt.seconds) ? a.createdAt.seconds : 0;
        const timeB = (b.createdAt && b.createdAt.seconds) ? b.createdAt.seconds : 0;
        return timeB - timeA;
    });
}

function setText(id, t) { const el = document.getElementById(id); if (el) el.textContent = t; }
function setPlaceholder(id, t) { const el = document.getElementById(id); if (el && 'placeholder' in el) el.placeholder = t; }

// تطبيق اللغة الكامل (شاشة الدخول، التسجيل، الشعار، القائمة)
function applyLanguage() {
    try {
        const isEng = document.documentElement.lang === 'en';
        const langBtn = document.getElementById('lang-toggle');
        if (langBtn) langBtn.textContent = isEng ? 'ع' : 'EN';

        setText('logo-text-1', isEng ? 'Driver Expenses' : 'مصاريف السائق');
        setText('logo-text-2', isEng ? 'Driver Expenses' : 'مصاريف السائق');

        setText('login-welcome-title', isEng ? 'Welcome Back' : 'مرحباً بك');
        setText('login-welcome-sub', isEng ? 'Sign in to access your account' : 'سجل دخولك للوصول إلى حسابك');
        setText('email-login-btn', isEng ? 'Login' : 'دخول');
        setText('login-no-account-text', isEng ? "Don't have an account?" : 'ليس لديك حساب؟');
        setText('show-signup', isEng ? 'Sign up' : 'أنشئ حساباً جديداً');
        setPlaceholder('login-email', isEng ? 'Email' : 'البريد الإلكتروني');
        setPlaceholder('login-password', isEng ? 'Password' : 'كلمة المرور');

        setText('signup-title-text', isEng ? 'Create Account' : 'حساب جديد');
        setText('signup-sub-text', isEng ? 'Enter your details to create an account' : 'أدخل بياناتك لإنشاء حسابك الخاص');
        setText('email-signup-btn', isEng ? 'Sign Up' : 'إنشاء الحساب');
        setText('signup-has-account-text', isEng ? 'Already have an account?' : 'لديك حساب بالفعل؟');
        setText('show-login', isEng ? 'Sign in' : 'سجل دخولك');
        setPlaceholder('signup-name', isEng ? 'Full Name' : 'الاسم الكامل');
        setPlaceholder('signup-email', isEng ? 'Email' : 'البريد الإلكتروني');
        setPlaceholder('signup-password', isEng ? 'Password' : 'كلمة المرور');
        setPlaceholder('signup-password-confirm', isEng ? 'Confirm Password' : 'تأكيد كلمة المرور');

        setText('divider-or-text', isEng ? 'OR' : 'أو');
        setText('google-btn-text', isEng ? 'Continue with Google' : 'المتابعة باستخدام Google');

        document.querySelectorAll('.nav-item').forEach(el => {
            if (isEng) {
                if (el.innerHTML.includes('العمليات')) el.innerHTML = '<i class="fa-solid fa-receipt"></i> Operations';
                if (el.innerHTML.includes('التحليلات')) el.innerHTML = '<i class="fa-solid fa-chart-line"></i> Analytics';
                if (el.innerHTML.includes('السائقين')) el.innerHTML = '<i class="fa-solid fa-users"></i> Drivers';
            } else {
                if (el.innerHTML.includes('Operations')) el.innerHTML = '<i class="fa-solid fa-receipt"></i> العمليات';
                if (el.innerHTML.includes('Analytics')) el.innerHTML = '<i class="fa-solid fa-chart-line"></i> التحليلات';
                if (el.innerHTML.includes('Drivers')) el.innerHTML = '<i class="fa-solid fa-users"></i> السائقين';
            }
        });
        const logoutBtn = document.getElementById('logout-btn');
        if (logoutBtn) logoutBtn.textContent = isEng ? 'Logout' : 'تسجيل خروج';
        updateTelegramButtonUI();
    } catch (err) {
        console.error('applyLanguage error', err);
    }
}

// ==========================================
// 3. مراقب التيليجرام الذكي (يعمل بالخلفية)
// ==========================================
function startTelegramObserver(uid) {
    try {
        if (unsubscribeTelegramObserver) unsubscribeTelegramObserver();
        const userRef = doc(db, 'users', uid);
        unsubscribeTelegramObserver = onSnapshot(userRef, (docSnap) => {
            if (docSnap.exists()) {
                const data = docSnap.data();
                window.userTelegramLinked = !!data.telegramId;
                updateTelegramButtonUI(); // تحديث الزر برمجياً لو كان موجود بالشاشة
            }
        });
    } catch (error) {
        console.error("Error with observer");
    }
}

function updateTelegramButtonUI() {
    const btn = document.getElementById('dynamic-telegram-btn');
    if (!btn) return;
    
    const isEng = document.documentElement.lang === 'en';
    
    if (window.userTelegramLinked) {
        btn.innerHTML = isEng ? '➕ Add Expenses' : '➕ إضافة مشتريات';
        btn.style.backgroundColor = '#28a745';
        btn.onclick = () => window.open(`https://t.me/${BOT_USERNAME}`, '_blank');
    } else {
        btn.innerHTML = isEng ? '🤖 Link Bot' : '🤖 ربط البوت';
        btn.style.backgroundColor = '#0088cc';
        btn.onclick = () => window.open(`https://t.me/${BOT_USERNAME}?start=${currentUser.uid}`, '_blank');
    }
}

// التنقل بين الصفحات
navItems.forEach(item => {
    item.addEventListener('click', () => {
        try {
            navItems.forEach(nav => nav.classList.remove('active'));
            item.classList.add('active');
            cleanupSubscriptions();
            
            const isEng = document.documentElement.lang === 'en';
            const target = item.getAttribute('data-target');
            
            if (target === 'manage') {
                document.getElementById('page-title').textContent = isEng ? "Operations Management" : "إدارة العمليات";
                renderDashboard();
                fetchDashboardDrivers();
            } else if (target === 'analytics') {
                document.getElementById('page-title').textContent = isEng ? "Analytics Dashboard" : "لوحة التحليلات";
                renderAnalyticsPage();
                fetchAnalyticsData();
            } else if (target === 'drivers') {
                document.getElementById('page-title').textContent = isEng ? "Drivers Management" : "إدارة السائقين";
                renderDriversPage();
                fetchDriversList();
            }
        } catch (error) {
            Swal.fire({ icon: 'error', title: 'خطأ بالنظام', text: 'حدث خطأ أثناء تحميل الصفحة.' });
        }
    });
});

document.getElementById('settings-btn').addEventListener('click', () => {
    navItems.forEach(nav => nav.classList.remove('active'));
    cleanupSubscriptions();
    renderSettingsPage();
});

window.addEventListener('userLoggedIn', (e) => {
    currentUser = e.detail;
    startTelegramObserver(currentUser.uid); // تشغيل المراقب بصمت
    document.querySelector('[data-target="manage"]').click();
});

// ==========================================
// 4. صفحة العمليات (إدارة العمليات)
// ==========================================
function renderDashboard() {
    const isEng = document.documentElement.lang === 'en';
    
    // ترجمة النصوص الثابتة في الجدول
    const t_loadingDrivers = isEng ? "Loading drivers..." : "جاري تحميل السائقين...";
    const t_history = isEng ? "Expenses History" : "سجل العمليات";
    const t_btnCheck = isEng ? "⏳ Checking..." : "⏳ جاري التحقق...";
    const t_store = isEng ? "Store" : "المتجر";
    const t_date = isEng ? "Date" : "التاريخ";
    const t_amount = isEng ? "Amount" : "المبلغ";
    const t_cashback = isEng ? "Cashback" : "الكاش باك";
    const t_status = isEng ? "Status" : "الحالة";
    const t_receipt = isEng ? "Receipt" : "الفاتورة";
    const t_action = isEng ? "Action" : "إجراء";
    const t_emptyMsg = isEng ? "Please add and select a driver to view expenses." : "الرجاء إضافة واختيار سائق لعرض عملياته.";
    const t_sortLabel = isEng ? "Sort:" : "ترتيب:";
    const t_sortNewest = isEng ? "Newest" : "الأحدث";
    const t_sortDate = isEng ? "By date" : "حسب التاريخ";
    const t_sortShop = isEng ? "By store name" : "حسب اسم المتجر";
    const t_sortReceipt = isEng ? "Receipts on top" : "الفاتورة أولاً";
    const t_sortLow = isEng ? "Lowest amount" : "الأقل سعراً";
    const t_sortHigh = isEng ? "Highest amount" : "الأعلى سعراً";

    contentArea.innerHTML = `
        <div id="dashboard-driver-tabs" style="display: flex; gap: 10px; margin-bottom: 25px; overflow-x: auto; padding-bottom: 5px;">
            <span style="color: var(--text-muted); font-size: 13px;">${t_loadingDrivers}</span>
        </div>

        <div class="table-header" style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; gap: 10px; flex-wrap: wrap;">
            <div style="display: flex; align-items: center; gap: 10px; flex-wrap: wrap;">
                <h3 style="font-size: 18px; font-weight: 600; margin: 0;">${t_history}</h3>
                <label for="expenses-sort" style="color: var(--text-muted); font-size: 13px;">${t_sortLabel}</label>
                <select id="expenses-sort" style="background: var(--bg-base); border: 1px solid var(--border-color); color: var(--text-primary); padding: 7px 12px; border-radius: 8px; font-size: 13px; outline: none; cursor: pointer;">
                    <option value="newest">${t_sortNewest}</option>
                    <option value="amount-asc">${t_sortLow}</option>
                    <option value="amount-desc">${t_sortHigh}</option>
                    <option value="date">${t_sortDate}</option>
                    <option value="receipt">${t_sortReceipt}</option>
                    <option value="shop">${t_sortShop}</option>
                </select>
            </div>
            <button id="dynamic-telegram-btn" class="btn-primary" style="flex: none; width: auto; font-size: 13px; padding: 8px 15px; font-weight:bold;">
                ${t_btnCheck}
            </button>
        </div>
        
        <div class="table-container" style="background-color: var(--bg-surface); border: 1px solid rgba(130, 130, 130, 0.3); border-radius: 12px; overflow-x: auto; box-shadow: 0 4px 15px rgba(0,0,0,0.1);">
            <table class="saas-table" style="width: 100%; border-collapse: collapse; text-align: ${isEng ? 'left' : 'right'};">
                <thead style="background-color: rgba(150, 150, 150, 0.05);">
                    <tr>
                        <th style="padding: 16px; border-bottom: 1px solid var(--border-color); color: var(--text-muted); font-size: 13px;">${t_store}</th>
                        <th style="padding: 16px; border-bottom: 1px solid var(--border-color); color: var(--text-muted); font-size: 13px;">${t_date}</th>
                        <th style="padding: 16px; border-bottom: 1px solid var(--border-color); color: var(--text-muted); font-size: 13px;">${t_amount}</th>
                        <th style="padding: 16px; border-bottom: 1px solid var(--border-color); color: var(--text-muted); font-size: 13px;">${t_cashback}</th>
                        <th style="padding: 16px; border-bottom: 1px solid var(--border-color); color: var(--text-muted); font-size: 13px;">${t_status}</th>
                        <th style="padding: 16px; border-bottom: 1px solid var(--border-color); color: var(--text-muted); font-size: 13px;">${t_receipt}</th>
                        <th style="padding: 16px; border-bottom: 1px solid var(--border-color); color: var(--text-muted); font-size: 13px;">${t_action}</th>
                    </tr>
                </thead>
                <tbody id="expenses-tbody">
                    <tr><td colspan="7" style="text-align: center; padding: 30px; color: var(--text-muted);">${t_emptyMsg}</td></tr>
                </tbody>
            </table>
        </div>
    `;
    updateTelegramButtonUI(); 
}

function fetchDashboardDrivers() {
    try {
        const q = query(collection(db, "drivers"), where("userId", "==", currentUser.uid));
        if (unsubscribeDashboardDrivers) unsubscribeDashboardDrivers();
        unsubscribeDashboardDrivers = onSnapshot(q, (snapshot) => {
            const tabsContainer = document.getElementById('dashboard-driver-tabs');
            if (!tabsContainer) return;
            tabsContainer.innerHTML = '';
            
            const isEng = document.documentElement.lang === 'en';
            
            if (snapshot.empty) {
                tabsContainer.innerHTML = `<span style="color: var(--text-muted); font-size: 13px;">${isEng ? "No drivers found. Add them from Drivers page." : "لا يوجد سائقين. اذهب لصفحة السائقين للإضافة."}</span>`;
                activeDriverId = null;
                if (unsubscribeExpenses) unsubscribeExpenses();
                return;
            }

            let drivers = [];
            snapshot.forEach(docSnap => drivers.push({ id: docSnap.id, ...docSnap.data() }));
            
            drivers = sortByNewest(drivers);

            if (!activeDriverId || !drivers.some(d => d.id === activeDriverId)) {
                activeDriverId = drivers[0].id;
            }

            drivers.forEach(driver => {
                const isActive = driver.id === activeDriverId;
                const btnStyle = isActive 
                    ? 'background-color: var(--primary-accent); color: white; border-color: var(--primary-accent); box-shadow: 0 2px 8px rgba(59, 130, 246, 0.3);' 
                    : 'background-color: var(--bg-surface); color: var(--text-primary); border-color: var(--border-color);';

                tabsContainer.innerHTML += `
                    <button class="dashboard-tab-btn" data-id="${driver.id}" style="${btnStyle} padding: 8px 16px; border-radius: 8px; border: 1px solid; font-size: 13px; font-weight: 500; cursor: pointer; transition: all 0.2s; white-space: nowrap;">
                        <i class="fa-solid fa-car-side"></i> ${driver.name}
                    </button>
                `;
            });

            fetchUserExpenses(activeDriverId);
        });
    } catch (error) {
        console.error("Error fetching drivers");
    }
}

let activeExpenseSort = 'newest';
let expensesCache = [];
const MAX_RECEIPTS = 3;

function getReceiptUrls(exp) {
    if (!exp) return [];
    const arr = Array.isArray(exp.receiptUrls) ? exp.receiptUrls.filter(u => u && (typeof u !== 'string' || (u !== '-' && u.toLowerCase() !== 'pending'))) : [];
    if (arr.length > 0) return arr;
    const legacy = exp.receiptUrl;
    if (legacy && typeof legacy === 'string' && legacy !== '-' && legacy.toLowerCase() !== 'pending') return [legacy];
    return [];
}

function fetchUserExpenses(driverId) {
    if (!driverId) return;
    if (unsubscribeExpenses) unsubscribeExpenses();
    
    try {
        const q = query(collection(db, "expenses"), where("userId", "==", currentUser.uid), where("driverId", "==", driverId));
        const tbody = document.getElementById('expenses-tbody');

        unsubscribeExpenses = onSnapshot(q, (snapshot) => {
            if (!tbody) return;
            
            if (snapshot.empty) {
                expensesCache = [];
                renderExpensesTable();
                return;
            }

            let expensesArray = [];
            snapshot.forEach((docSnap) => expensesArray.push({ id: docSnap.id, ...docSnap.data() }));
            expensesCache = expensesArray;

            renderExpensesTable();
        });
    } catch(err) {}
}

function renderExpensesTable() {
    const tbody = document.getElementById('expenses-tbody');
    if (!tbody) return;
    const isEng = document.documentElement.lang === 'en';
    const currencyStr = isEng ? 'SAR' : 'ريال';
    const list = sortExpenses(expensesCache);

    if (list.length === 0) {
        tbody.innerHTML = `<tr><td colspan="7" style="text-align: center; padding: 40px; color: var(--text-muted);">${isEng ? "No operations recorded for this driver." : "لا توجد عمليات مسجلة لهذا السائق."}</td></tr>`;
        return;
    }

    const rows = list.map((data) => {
        const id = data.id;
        const receipts = getReceiptUrls(data);
        const isCompleted = data.status && data.status.toLowerCase() === 'completed';
        const statusColor = isCompleted ? '#10b981' : '#eab308';
        const statusText = isEng ? (isCompleted ? "Completed" : "Pending") : (isCompleted ? "مكتملة" : "معلقة");
        const statusBadge = `<span style="color: ${statusColor}">●</span> ${statusText}`;

        // الفواتير: زر واحد يفتح المعرض (تصفح + حذف)، وزر إضافة منفصل (حتى 3)
        const addBtn = `<button class="btn-text upload-btn" data-id="${id}" style="color: var(--primary-accent); font-weight: bold; margin: 2px;"><i class="fa-solid fa-upload"></i> ${isEng ? 'Attach' : 'إرفاق'}</button>`;

        let receiptBadge;
        if (receipts.length === 0) {
            receiptBadge = addBtn;
        } else {
            const pathsJson = encodeURIComponent(JSON.stringify(receipts.map(receiptPathFromUrl)));
            receiptBadge = `<button class="btn-text receipt-many-btn" data-id="${id}" data-paths="${pathsJson}" style="background-color: rgba(46,204,113,0.1); color: #2ecc71; padding: 6px 12px; border-radius: 6px; font-size: 12px; font-weight: 600; display: inline-block; cursor: pointer; margin: 2px;"><i class="fa-solid fa-check"></i> ${isEng ? 'Receipt' : 'الفاتورة'}${receipts.length > 1 ? ' (' + receipts.length + ')' : ''}</button>`;
            if (receipts.length < MAX_RECEIPTS) {
                receiptBadge += addBtn;
            }
        }

        return `
            <tr id="exp-row-${id}" style="border-bottom: 1px solid var(--border-color); transition: background 0.2s;">
                <td class="col-shop" style="padding: 16px; font-weight: 500;">${data.shopName || (isEng ? 'Unknown' : 'غير معروف')}</td>
                <td class="col-date" style="padding: 16px; color: var(--text-muted); font-size: 14px;" dir="ltr">${expenseDateStr(data) || '-'}</td>
                <td class="col-amount" style="padding: 16px;" data-val="${data.amount || 0}">${data.amount || 0} ${currencyStr}</td>
                <td class="col-cashback" style="padding: 16px; color: var(--success);" data-val="${data.cashback || 0}">${data.cashback > 0 ? data.cashback + ' ' + currencyStr : '-'}</td>
                <td class="col-status" style="padding: 16px; font-weight: 600;">
                    ${statusBadge}
                </td>
                <td style="padding: 16px;">${receiptBadge}</td>
                <td class="col-actions" style="padding: 16px; white-space: nowrap;">
                    <button class="btn-text edit-expense-btn" data-id="${id}" style="color: var(--primary-accent); font-size: 15px; background: rgba(59, 130, 246, 0.1); padding: 6px 10px; border-radius: 6px; margin-left: 5px;" title="${isEng ? 'Edit' : 'تعديل'}"><i class="fa-solid fa-pen"></i></button>
                    <button class="btn-text delete-btn" data-id="${id}" style="color: var(--danger); font-size: 15px; background: rgba(231, 76, 60, 0.1); padding: 6px 10px; border-radius: 6px;" title="${isEng ? 'Delete' : 'حذف'}"><i class="fa-solid fa-trash"></i></button>
                </td>
            </tr>
        `;
    }).join('');

    tbody.innerHTML = rows;
}

function sortExpenses(arr) {
    const copy = (arr || []).slice();
    const cmpDate = (a, b) => (expenseDateStr(b) || '').localeCompare(expenseDateStr(a) || '');
    const isReceipt = (x) => getReceiptUrls(x).length > 0;

    switch (activeExpenseSort) {
        case 'amount-asc':
            copy.sort((a, b) => (Number(a.amount) || 0) - (Number(b.amount) || 0));
            break;
        case 'amount-desc':
            copy.sort((a, b) => (Number(b.amount) || 0) - (Number(a.amount) || 0));
            break;
        case 'date':
            copy.sort(cmpDate);
            break;
        case 'receipt':
            copy.sort((a, b) => {
                const ha = isReceipt(a) ? 0 : 1;
                const hb = isReceipt(b) ? 0 : 1;
                if (ha !== hb) return ha - hb;
                return cmpDate(a, b);
            });
            break;
        case 'shop':
            copy.sort((a, b) => {
                const c = (a.shopName || '').localeCompare(b.shopName || '', 'ar');
                return c !== 0 ? c : cmpDate(a, b);
            });
            break;
        default:
            copy.sort((a, b) => {
                const timeA = (a.createdAt && a.createdAt.seconds) ? a.createdAt.seconds : 0;
                const timeB = (b.createdAt && b.createdAt.seconds) ? b.createdAt.seconds : 0;
                return timeB - timeA;
            });
    }
    return copy;
}

function pad2(n) { return String(n).padStart(2, '0'); }

function expenseDateStr(exp) {
    const v = exp && exp.date;
    if (!v) return '';
    if (typeof v === 'string') {
        const iso = v.match(/^(\d{4})-(\d{2})-(\d{2})/);
        if (iso) return iso[1] + '-' + iso[2] + '-' + iso[3];
        const local = v.match(/(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/);
        if (local) return local[3] + '-' + pad2(local[2]) + '-' + pad2(local[1]);
        return v;
    }
    let d = v;
    if (v.toDate) d = v.toDate();
    if (d instanceof Date && !isNaN(d.getTime())) {
        return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
    }
    return '';
}

function receiptPathFromUrl(url) {
    if (!url) return '';
    if (!/^https?:/.test(url)) return url;
    try {
        const u = new URL(url);
        const idx = u.pathname.lastIndexOf('/o/');
        if (idx !== -1) return decodeURIComponent(u.pathname.substring(idx + 3));
    } catch (err) {}
    return url;
}

function compressImage(file, maxSize = 1000, quality = 0.75) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onerror = () => reject(new Error('READ_FAIL'));
        reader.onload = (e) => {
            const img = new Image();
            img.onerror = () => reject(new Error('IMG_LOAD_FAIL'));
            img.onload = () => {
                let width = img.naturalWidth, height = img.naturalHeight;
                const scale = Math.min(1, maxSize / Math.max(width, height));
                width = Math.max(1, Math.round(width * scale));
                height = Math.max(1, Math.round(height * scale));
                const canvas = document.createElement('canvas');
                canvas.width = width;
                canvas.height = height;
                const ctx = canvas.getContext('2d');
                ctx.fillStyle = '#ffffff';
                ctx.fillRect(0, 0, width, height);
                ctx.drawImage(img, 0, 0, width, height);
                resolve(canvas.toDataURL('image/jpeg', quality));
            };
            img.src = e.target.result;
        };
        reader.readAsDataURL(file);
    });
}

function showReceiptModal(path, isEng) {
    Swal.fire({
        title: isEng ? 'Receipt' : 'الفاتورة',
        html: '<div style="text-align: center; padding: 25px 10px;"><i class="fa-solid fa-spinner fa-spin" style="font-size: 32px; color: var(--primary-accent);"></i><br><br><span style="color: var(--text-muted);">' + (isEng ? 'Loading receipt...' : 'جاري تحميل الفاتورة...') + '</span></div>',
        confirmButtonText: isEng ? 'Close' : 'إغلاق',
        didOpen: async (modalEl) => {
            try {
                let freshUrl = path;
                if (path && /^data:/.test(path)) {
                    freshUrl = path;
                } else if (path && !/^https?:/.test(path)) {
                    const { getStorage, ref, getDownloadURL } = await import("https://www.gstatic.com/firebasejs/10.8.0/firebase-storage.js");
                    freshUrl = await getDownloadURL(ref(getStorage(), path));
                }
                if (!freshUrl) throw new Error('NO_URL');

                const img = new Image();
                img.onload = () => {
                    const container = modalEl.querySelector('.swal2-html-container');
                    if (!container) return;
                    container.innerHTML =
                        '<div style="text-align: center;">' +
                            '<img src="' + freshUrl + '" style="max-width: 100%; max-height: 480px; border-radius: 10px; box-shadow: 0 4px 15px rgba(0,0,0,0.15);" alt="Receipt">' +
                            '<br><br>' +
                            '<a href="' + freshUrl + '" target="_blank" rel="noopener" style="display: inline-block; background: var(--primary-accent); color: #fff; padding: 8px 18px; border-radius: 8px; text-decoration: none; font-size: 13px; font-weight: 600;">' + (isEng ? 'Open / Download' : 'فتح / تحميل الصورة') + '</a>' +
                        '</div>';
                };
                img.onerror = () => {
                    const container = modalEl.querySelector('.swal2-html-container');
                    if (!container) return;
                    container.innerHTML = '<div style="text-align: center; padding: 20px; color: var(--danger);"><i class="fa-solid fa-circle-exclamation" style="font-size: 34px;"></i><br><br><b>' + (isEng ? 'Receipt file not found' : 'الفاتورة غير متوفرة') + '</b><br><span style="color: var(--text-muted); font-size: 13px;">' + (isEng ? 'The file may have been deleted or moved.' : 'قد يكون الملف محذوفاً أو غير موجود في Storage.') + '</span></div>';
                };
                img.src = freshUrl;
            } catch (err) {
                console.error(err);
                const container = modalEl.querySelector('.swal2-html-container');
                if (!container) return;
                container.innerHTML = '<div style="text-align: center; padding: 20px; color: var(--danger);"><i class="fa-solid fa-circle-exclamation" style="font-size: 34px;"></i><br><br><b>' + (isEng ? 'Could not load receipt' : 'تعذر تحميل الفاتورة') + '</b><br><span style="color: var(--text-muted); font-size: 13px;">' + (isEng ? 'Check your internet connection and the Firebase Storage rules.' : 'تأكد من اتصالك بالإنترنت ومن قواعد Firebase Storage.') + '</span></div>';
            }
        }
    });
}

function showReceiptsModal(id, urls, isEng) {
    let list = (urls || []).filter(Boolean).slice();
    let idx = 0;
    const resolvedCache = {};

    const resolvePath = async (path) => {
        if (resolvedCache[path]) return resolvedCache[path];
        let url = path;
        if (path && /^https?:/.test(path)) {
            url = path;
        } else if (path && /^data:/.test(path)) {
            url = path;
        } else if (path) {
            try {
                const { getStorage, ref, getDownloadURL } = await import("https://www.gstatic.com/firebasejs/10.8.0/firebase-storage.js");
                url = await getDownloadURL(ref(getStorage(), path));
            } catch (err) {
                console.error(err);
                url = '';
            }
        }
        resolvedCache[path] = url;
        return url;
    };

    if (list.length === 0) { Swal.fire({ icon: 'info', title: isEng ? 'No receipts' : 'لا توجد فواتير' }); return; }

    Swal.fire({
        title: isEng ? 'Receipts (' + list.length + ')' : 'الفواتير (' + list.length + ')',
        html:
            '<div style="text-align:center;">' +
                '<div id="rg-img-holder" style="min-height:140px;"><i class="fa-solid fa-spinner fa-spin" style="font-size:28px;color:var(--primary-accent);"></i></div>' +
                '<div id="rg-count" style="color:var(--text-muted);font-size:13px;margin:10px 0;"></div>' +
                '<div style="display:flex;gap:8px;justify-content:center;flex-wrap:wrap;">' +
                    '<button id="rg-prev" style="padding:6px 14px;border-radius:8px;border:1px solid var(--border-color);background:var(--bg-base);color:var(--text-primary);cursor:pointer;font-size:15px;">&#8249;</button>' +
                    '<button id="rg-del" style="padding:6px 16px;border-radius:8px;border:none;background:var(--danger);color:#fff;cursor:pointer;font-size:13px;font-weight:600;"><i class="fa-solid fa-trash"></i> ' + (isEng ? 'Delete' : 'حذف') + '</button>' +
                    '<button id="rg-next" style="padding:6px 14px;border-radius:8px;border:1px solid var(--border-color);background:var(--bg-base);color:var(--text-primary);cursor:pointer;font-size:15px;">&#8250;</button>' +
                '</div>' +
            '</div>',
        showConfirmButton: false,
        showCloseButton: true,
        didOpen: async (modalEl) => {
            const holder = modalEl.querySelector('#rg-img-holder');
            const countEl = modalEl.querySelector('#rg-count');
            const prevEl = modalEl.querySelector('#rg-prev');
            const nextEl = modalEl.querySelector('#rg-next');
            const delEl = modalEl.querySelector('#rg-del');
            let confirmDel = false;

            const render = async () => {
                if (list.length === 0) { Swal.close(); return; }
                idx = Math.min(idx, list.length - 1);
                countEl.textContent = (idx + 1) + ' / ' + list.length;
                holder.innerHTML = '<i class="fa-solid fa-spinner fa-spin" style="font-size:28px;color:var(--primary-accent);"></i>';
                const url = await resolvePath(list[idx]);
                if (!url) {
                    holder.innerHTML = '<div style="padding:20px;color:var(--danger);"><i class="fa-solid fa-circle-exclamation" style="font-size:32px;"></i><br><br><b>' + (isEng ? 'Receipt not available' : 'الفاتورة غير متوفرة') + '</b></div>';
                } else {
                    holder.innerHTML = '<img src="' + url + '" style="max-width:100%;max-height:460px;border-radius:10px;box-shadow:0 4px 15px rgba(0,0,0,0.15);">';
                }
                confirmDel = false;
                delEl.innerHTML = '<i class="fa-solid fa-trash"></i> ' + (isEng ? 'Delete' : 'حذف');
                delEl.style.background = 'var(--danger)';
            };

            prevEl.onclick = () => { idx = (idx - 1 + list.length) % list.length; render(); };
            nextEl.onclick = () => { idx = (idx + 1) % list.length; render(); };
            delEl.onclick = async () => {
                if (!confirmDel) {
                    confirmDel = true;
                    delEl.innerHTML = isEng ? 'Sure?' : 'متأكد؟';
                    delEl.style.background = '#b91c1c';
                    return;
                }
                confirmDel = false;
                delEl.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';
                const target = list[idx];
                try {
                    const snap = await getDoc(doc(db, "expenses", id));
                    const all = getReceiptUrls(snap.exists() ? snap.data() : {});
                    const filtered = all.filter(u => receiptPathFromUrl(u) !== receiptPathFromUrl(target));
                    if (filtered.length === 0) {
                        await updateDoc(doc(db, "expenses", id), { receiptUrls: [], receiptUrl: '-' });
                    } else {
                        await updateDoc(doc(db, "expenses", id), { receiptUrls: filtered });
                    }
                    list = filtered;
                    if (list.length === 0) { Swal.close(); return; }
                    render();
                } catch (err) {
                    console.error(err);
                    delEl.innerHTML = '<i class="fa-solid fa-trash"></i> ' + (isEng ? 'Delete' : 'حذف');
                }
            };

            render();
        }
    });
}

// ==========================================
// 5. صفحة إدارة السائقين
// ==========================================
function renderDriversPage() {
    const isEng = document.documentElement.lang === 'en';
    const t_title = isEng ? "Add New Driver" : "إضافة سائق جديد";
    const t_name = isEng ? "Driver Name (Required)" : "اسم السائق (إلزامي)";
    const t_car = isEng ? "Car Details" : "السيارة";
    const t_card = isEng ? "Card Type" : "نوع البطاقة";
    const t_cardPlaceholder = isEng ? "e.g. Visa..." : "اكتب نوع البطاقة...";
    const t_save = isEng ? "Save" : "حفظ";
    const t_cancel = isEng ? "Cancel" : "إلغاء";
    
    // خيارات البطاقة
    const optChoose = isEng ? "Choose..." : "اختر...";
    const optMada = isEng ? "Mada" : "مدى";
    const optVisa = "Visa";
    const optMaster = "MasterCard";
    const optOther = isEng ? "Other (Type it)" : "أخرى (كتابة)";

    // رؤوس الجدول
    const t_thName = isEng ? "Driver Name" : "اسم السائق";
    const t_thCar = isEng ? "Car" : "السيارة";
    const t_thCard = isEng ? "Card Type" : "نوع البطاقة";
    const t_thTotal = isEng ? "Total Expenses" : "مجموع المصاريف";
    const t_thEdit = isEng ? "Edit" : "تعديل";
    const t_thDel = isEng ? "Delete" : "حذف";

    contentArea.innerHTML = `
        <div style="background-color: var(--bg-surface); border: 1px solid rgba(130, 130, 130, 0.3); border-radius: 12px; padding: 25px; margin-bottom: 25px; box-shadow: 0 4px 15px rgba(0,0,0,0.1);">
            <h3 id="form-title" style="font-size: 16px; font-weight: 600; margin-top: 0; margin-bottom: 15px;">${t_title}</h3>
            <form id="add-driver-form" style="display: flex; gap: 15px; align-items: flex-end; flex-wrap: wrap;">
                <input type="hidden" id="edit-driver-id" value="">
                
                <div style="flex: 1; min-width: 150px;">
                    <label style="display: block; font-size: 13px; color: var(--text-muted); margin-bottom: 5px;">${t_name}</label>
                    <input type="text" id="driver-name" required style="width: 100%; padding: 10px 14px; background: var(--bg-base); border: 1px solid var(--border-color); border-radius: 8px; color: var(--text-primary); outline: none; box-sizing: border-box;">
                </div>
                
                <div style="flex: 1; min-width: 150px;">
                    <label style="display: block; font-size: 13px; color: var(--text-muted); margin-bottom: 5px;">${t_car}</label>
                    <input type="text" id="driver-car" style="width: 100%; padding: 10px 14px; background: var(--bg-base); border: 1px solid var(--border-color); border-radius: 8px; color: var(--text-primary); outline: none; box-sizing: border-box;">
                </div>
                
                <div style="flex: 1; min-width: 150px; display: flex; flex-direction: column; gap: 5px;">
                    <label style="display: block; font-size: 13px; color: var(--text-muted); margin-bottom: 0px;">${t_card}</label>
                    <div style="display: flex; gap: 5px; width: 100%;">
                        <select id="driver-card" style="flex: 1; padding: 10px 14px; background: var(--bg-base); border: 1px solid var(--border-color); border-radius: 8px; color: var(--text-primary); outline: none; box-sizing: border-box; appearance: auto;">
                            <option value="">${optChoose}</option>
                            <option value="مدى">${optMada}</option>
                            <option value="فيزا">${optVisa}</option>
                            <option value="ماستركارد">${optMaster}</option>
                            <option value="أخرى">${optOther}</option>
                        </select>
                        <input type="text" id="driver-card-other" placeholder="${t_cardPlaceholder}" style="display: none; flex: 1; padding: 10px 14px; background: var(--bg-base); border: 1px solid var(--border-color); border-radius: 8px; color: var(--text-primary); outline: none; box-sizing: border-box;">
                    </div>
                </div>
                
                <button type="submit" id="submit-driver-btn" class="btn-primary" style="flex: none; padding: 10px 25px; font-size: 14px; height: 42px; white-space: nowrap;"><i class="fa-solid fa-floppy-disk"></i> <span id="submit-btn-text">${t_save}</span></button>
                <button type="button" id="cancel-edit-btn" style="display: none; background: transparent; border: 1px solid var(--border-color); color: var(--text-primary); padding: 10px 20px; border-radius: 8px; font-size: 14px; height: 42px; cursor: pointer;">${t_cancel}</button>
            </form>
        </div>

        <div class="table-container" style="background-color: var(--bg-surface); border: 1px solid rgba(130, 130, 130, 0.3); border-radius: 12px; overflow-x: auto; box-shadow: 0 4px 15px rgba(0,0,0,0.1);">
            <table class="saas-table" style="width: 100%; border-collapse: collapse; text-align: ${isEng ? 'left' : 'right'};">
                <thead style="background-color: rgba(150, 150, 150, 0.05);">
                    <tr>
                        <th style="padding: 16px; border-bottom: 1px solid var(--border-color); color: var(--text-muted); font-size: 13px;">${t_thName}</th>
                        <th style="padding: 16px; border-bottom: 1px solid var(--border-color); color: var(--text-muted); font-size: 13px;">${t_thCar}</th>
                        <th style="padding: 16px; border-bottom: 1px solid var(--border-color); color: var(--text-muted); font-size: 13px;">${t_thCard}</th>
                        <th style="padding: 16px; border-bottom: 1px solid var(--border-color); color: var(--text-muted); font-size: 13px;">${t_thTotal}</th>
                        <th style="padding: 16px; border-bottom: 1px solid var(--border-color); color: var(--text-muted); font-size: 13px; text-align: center; width: 80px;">${t_thEdit}</th>
                        <th style="padding: 16px; border-bottom: 1px solid var(--border-color); color: var(--text-muted); font-size: 13px; text-align: center; width: 80px;">${t_thDel}</th>
                    </tr>
                </thead>
                <tbody id="drivers-tbody">
                    <tr><td colspan="6" style="text-align: center; padding: 30px; color: var(--text-muted);">${isEng ? "Loading..." : "جاري جلب السائقين..."}</td></tr>
                </tbody>
            </table>
        </div>
    `;
}

function fetchDriversList() {
    const tbody = document.getElementById('drivers-tbody');
    if (!tbody) return;
    const isEng = document.documentElement.lang === 'en';

    try {
        const q = query(collection(db, "drivers"), where("userId", "==", currentUser.uid));
        const expensesQ = query(collection(db, "expenses"), where("userId", "==", currentUser.uid));

        if (unsubscribeDrivers) unsubscribeDrivers();
        unsubscribeDrivers = onSnapshot(q, (driverSnapshot) => {
            if (unsubscribeDriversExpenses) unsubscribeDriversExpenses();
            
            unsubscribeDriversExpenses = onSnapshot(expensesQ, (expenseSnapshot) => {
                tbody.innerHTML = '';
                
                if (driverSnapshot.empty) {
                    tbody.innerHTML = `<tr><td colspan="6" style="text-align: center; padding: 40px; color: var(--text-muted);">${isEng ? "No drivers found. Add above." : "لا يوجد سائقين. قم بالإضافة بالأعلى."}</td></tr>`;
                    return;
                }

                let expensesTotal = {};
                expenseSnapshot.forEach(expDoc => {
                    const exp = expDoc.data();
                    if (exp.driverId) expensesTotal[exp.driverId] = (expensesTotal[exp.driverId] || 0) + (Number(exp.amount) || 0);
                });

                let driversArray = [];
                driverSnapshot.forEach(docSnap => driversArray.push({ id: docSnap.id, ...docSnap.data() }));
                
                driversArray = sortByNewest(driversArray);

                driversArray.forEach((data) => {
                    const id = data.id;
                    const total = expensesTotal[id] || 0;
                    
                    tbody.innerHTML += `
                        <tr style="border-bottom: 1px solid var(--border-color); transition: background 0.2s;">
                            <td style="padding: 16px; font-weight: 500;">${data.name}</td>
                            <td style="padding: 16px; color: var(--text-muted);">${data.car || '-'}</td>
                            <td style="padding: 16px; color: var(--text-muted);">${data.cardType || '-'}</td>
                            <td style="padding: 16px; color: var(--danger); font-weight: bold;">${total} ${isEng ? 'SAR' : 'ريال'}</td>
                            <td style="padding: 16px; text-align: center;">
                                <button class="btn-text edit-driver-btn" data-id="${id}" data-name="${data.name}" data-car="${data.car || ''}" data-card="${data.cardType || ''}" style="color: var(--primary-accent); font-size: 15px; background: rgba(59, 130, 246, 0.1); padding: 6px 12px; border-radius: 6px;"><i class="fa-solid fa-pen-to-square"></i></button>
                            </td>
                            <td style="padding: 16px; text-align: center;">
                                <button class="btn-text delete-driver-btn" data-id="${id}" style="color: var(--danger); font-size: 14px; background: rgba(231, 76, 60, 0.1); padding: 6px 12px; border-radius: 6px; font-weight: bold; transition: all 0.2s;"><i class="fa-solid fa-trash"></i></button>
                            </td>
                        </tr>
                    `;
                });
            });
        });
    } catch (error) {
        tbody.innerHTML = `<tr><td colspan="6" style="text-align: center; color: var(--danger); padding: 20px;">Error loading data.</td></tr>`;
    }
}
// ==========================================
// 6. صفحة الإعدادات
// ==========================================
function renderSettingsPage() {
    const isEng = document.documentElement.lang === 'en';
    document.getElementById('page-title').textContent = isEng ? "Account Settings" : "إعدادات الحساب";
    const currentName = document.getElementById('user-name').textContent;
    const currentEmail = currentUser && currentUser.email ? currentUser.email : '';
    
    contentArea.innerHTML = `
        <div style="background-color: var(--bg-surface); border: 1px solid rgba(130, 130, 130, 0.3); border-radius: 12px; padding: 35px; margin: 0 auto; max-width: 650px; box-shadow: 0 4px 15px rgba(0,0,0,0.1);">
            <h3 style="font-size: 20px; font-weight: 700; margin-top: 0; margin-bottom: 25px; color: var(--primary-accent); border-bottom: 1px solid rgba(130,130,130,0.2); padding-bottom: 10px;">${isEng ? "Personal Info" : "المعلومات الشخصية"}</h3>

            <form id="settings-form" style="display: flex; flex-direction: column; gap: 20px;">
                <div style="display: flex; align-items: center; gap: 15px; flex-wrap: wrap;">
                    <label style="width: 120px; font-size: 15px; font-weight: 600; color: var(--text-primary);">${isEng ? "Name:" : "الاسم:"}</label>
                    <input type="text" id="settings-name-input" value="${currentName === '...' ? '' : currentName}" required autocomplete="off" style="flex: 1; min-width: 250px; padding: 12px 15px; background: var(--bg-base); border: 1px solid rgba(130,130,130,0.3); border-radius: 8px; color: var(--text-primary); outline: none;">
                </div>
                
                <div style="display: flex; align-items: center; gap: 15px; flex-wrap: wrap;">
                    <label style="width: 120px; font-size: 15px; font-weight: 600; color: var(--text-primary);">${isEng ? "Email:" : "الإيميل:"}</label>
                    <input type="email" id="settings-email-input" value="${currentEmail}" required autocomplete="off" style="flex: 1; min-width: 250px; padding: 12px 15px; background: var(--bg-base); border: 1px solid rgba(130,130,130,0.3); border-radius: 8px; color: var(--text-primary); outline: none;">
                </div>
                <p id="settings-email-error" class="field-error" style="color: var(--danger); margin-left: 135px;"></p>
                
                <div style="display: flex; align-items: center; gap: 15px; flex-wrap: wrap;">
                    <label style="width: 120px; font-size: 15px; font-weight: 600; color: var(--text-primary);">${isEng ? "New Password:" : "رقم سري جديد:"}</label>
                    <input type="password" id="settings-password-input" placeholder="${isEng ? 'Leave empty to keep it' : 'اتركه فارغاً إذا لا تريد تغييره'}" autocomplete="new-password" style="flex: 1; min-width: 250px; padding: 12px 15px; background: var(--bg-base); border: 1px solid rgba(130,130,130,0.3); border-radius: 8px; color: var(--text-primary); outline: none;">
                </div>
                <p id="settings-password-error" class="field-error" style="color: var(--danger); margin-left: 135px; white-space: normal;"></p>

                <div style="display: flex; gap: 15px; margin-top: 15px; justify-content: center;">
                    <button type="submit" id="save-settings-btn" class="btn-primary" style="padding: 10px 50px; font-size: 15px; font-weight: 600; transition: 0.2s;">${isEng ? "Save" : "حفظ"}</button>
                </div>
            </form>
        </div>
    `;
}

// ==========================================
// 7. صفحة التحليلات (وإنشاء PDF) 
// ==========================================
let barChartInstance = null;
let pieChartInstance = null;
let lineChartInstance = null;
let activeAnalyticsDriverId = null;
let activeTimeRange = '1m'; 
let globalDriversList = []; 

function renderAnalyticsPage() {
    const isEng = document.documentElement.lang === 'en';
    contentArea.innerHTML = `
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px;">
            <div id="analytics-driver-tabs" style="display: flex; gap: 10px; overflow-x: auto; padding-bottom: 5px;">
                <span style="color: var(--text-muted); font-size: 13px;">${isEng ? "Loading..." : "جاري تحميل السائقين..."}</span>
            </div>
            <button id="export-pdf-btn" class="btn-primary" style="flex: none; background-color: #e74c3c; border-color: #e74c3c; font-size: 13px; padding: 8px 15px; border-radius: 8px;">
                <i class="fa-solid fa-file-pdf"></i> ${isEng ? "Export PDF" : "إنشاء تقرير PDF"}
            </button>
        </div>

        <div id="time-filters-container" style="display: flex; gap: 10px; margin-bottom: 25px; justify-content: center; flex-wrap: wrap; background: var(--bg-surface); padding: 10px; border-radius: 12px; border: 1px solid rgba(130, 130, 130, 0.2);">
            <button class="time-filter-btn active" data-range="1m" style="padding: 6px 16px; border-radius: 20px; border: none; background: var(--primary-accent); color: white; cursor: pointer;">${isEng ? '1 Month' : 'شهر'}</button>
            <button class="time-filter-btn" data-range="3m" style="padding: 6px 16px; border-radius: 20px; border: none; background: transparent; color: var(--text-primary); cursor: pointer;">${isEng ? '3 Months' : '3 أشهر'}</button>
            <button class="time-filter-btn" data-range="6m" style="padding: 6px 16px; border-radius: 20px; border: none; background: transparent; color: var(--text-primary); cursor: pointer;">${isEng ? '6 Months' : '6 أشهر'}</button>
            <button class="time-filter-btn" data-range="1y" style="padding: 6px 16px; border-radius: 20px; border: none; background: transparent; color: var(--text-primary); cursor: pointer;">${isEng ? '1 Year' : 'سنة'}</button>
            <button class="time-filter-btn" data-range="all" style="padding: 6px 16px; border-radius: 20px; border: none; background: transparent; color: var(--text-primary); cursor: pointer;">${isEng ? 'All Time' : 'كل الأوقات'}</button>
        </div>

        <div id="pdf-export-area" style="background: var(--bg-base); padding: 15px; border-radius: 12px;">
            
            <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(250px, 1fr)); gap: 15px; margin-bottom: 25px;">
                <div style="background-color: var(--bg-surface); padding: 25px; border-radius: 12px; border: 1px solid rgba(130, 130, 130, 0.3); box-shadow: 0 4px 15px rgba(0,0,0,0.05); text-align: center;">
                    <div style="color: var(--text-muted); font-size: 15px; margin-bottom: 10px;"><i class="fa-solid fa-money-bill-wave"></i> ${isEng ? 'Total Expenses' : 'إجمالي الصرفية'}</div>
                    <div id="stat-total-amt" style="font-size: 32px; font-weight: bold; color: var(--danger);">0</div>
                </div>
                <div style="background-color: var(--bg-surface); padding: 25px; border-radius: 12px; border: 1px solid rgba(130, 130, 130, 0.3); box-shadow: 0 4px 15px rgba(0,0,0,0.05); text-align: center;">
                    <div style="color: var(--text-muted); font-size: 15px; margin-bottom: 10px;"><i class="fa-solid fa-hand-holding-dollar"></i> ${isEng ? 'Total Cashback' : 'كاش باك مسترجع'}</div>
                    <div id="stat-total-cb" style="font-size: 32px; font-weight: bold; color: #2ecc71;">0</div>
                </div>
            </div>

            <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 15px; margin-bottom: 25px;">
                <div style="background-color: var(--bg-surface); padding: 25px; border-radius: 12px; border: 1px solid rgba(130, 130, 130, 0.3); box-shadow: 0 4px 15px rgba(0,0,0,0.05); flex: 2;">
                    <h3 style="font-size: 16px; font-weight: 600; margin-top: 0; margin-bottom: 20px;">${isEng ? 'Highest Spending Categories (Top 10)' : 'أكثر مبالغ تم صرفها (أعلى 10 محلات)'}</h3>
                    <div style="position: relative; height: 300px; width: 100%;">
                        <canvas id="barChart"></canvas>
                    </div>
                </div>
                <div style="background-color: var(--bg-surface); padding: 25px; border-radius: 12px; border: 1px solid rgba(130, 130, 130, 0.3); box-shadow: 0 4px 15px rgba(0,0,0,0.05); flex: 1;">
                    <h3 style="font-size: 16px; font-weight: 600; margin-top: 0; margin-bottom: 20px;">${isEng ? 'Expenses Distribution' : 'توزيع المصاريف (النسب المئوية)'}</h3>
                    <div style="position: relative; height: 300px; width: 100%;">
                        <canvas id="pieChart"></canvas>
                    </div>
                </div>
            </div>

            <div style="background-color: var(--bg-surface); padding: 25px; border-radius: 12px; border: 1px solid rgba(130, 130, 130, 0.3); box-shadow: 0 4px 15px rgba(0,0,0,0.05);">
                <h3 style="font-size: 16px; font-weight: 600; margin-top: 0; margin-bottom: 20px;">${isEng ? 'Spending Trends Over Time' : 'مقارنة صرف السائقين عبر الزمن'}</h3>
                <div style="position: relative; height: 350px; width: 100%;">
                    <canvas id="lineChart"></canvas>
                </div>
            </div>
        </div>
    `;
}

function fetchAnalyticsData() {
    try {
        const q = query(collection(db, "drivers"), where("userId", "==", currentUser.uid));
        if (unsubscribeAnalyticsDrivers) unsubscribeAnalyticsDrivers();
        
        unsubscribeAnalyticsDrivers = onSnapshot(q, (snapshot) => {
            const tabsContainer = document.getElementById('analytics-driver-tabs');
            if (!tabsContainer) return;
            tabsContainer.innerHTML = '';
            const isEng = document.documentElement.lang === 'en';
            
            globalDriversList = []; 
            snapshot.forEach(docSnap => globalDriversList.push({ id: docSnap.id, ...docSnap.data() }));

            if (globalDriversList.length === 0) {
                tabsContainer.innerHTML = `<span style="color: var(--text-muted); font-size: 13px;">${isEng ? "No drivers found." : "لا يوجد سائقين."}</span>`;
                return;
            }

            if (!activeAnalyticsDriverId || !globalDriversList.some(d => d.id === activeAnalyticsDriverId)) {
                activeAnalyticsDriverId = globalDriversList[0].id;
            }

            globalDriversList.forEach(driver => {
                const isActive = driver.id === activeAnalyticsDriverId;
                const btnStyle = isActive 
                    ? 'background-color: var(--primary-accent); color: white; border-color: var(--primary-accent); box-shadow: 0 2px 8px rgba(59, 130, 246, 0.3);' 
                    : 'background-color: var(--bg-surface); color: var(--text-primary); border-color: var(--border-color);';

                tabsContainer.innerHTML += `
                    <button class="analytics-driver-tab-btn" data-id="${driver.id}" style="${btnStyle} padding: 8px 16px; border-radius: 8px; border: 1px solid; font-size: 13px; font-weight: 500; cursor: pointer; transition: all 0.2s; white-space: nowrap;">
                        <i class="fa-solid fa-car-side"></i> ${driver.name}
                    </button>
                `;
            });
            processDriverAnalytics();
        });
    } catch(err) {}
}

function timeRangeStartDate() {
    const now = new Date();
    if (activeTimeRange === 'all') return new Date(2000, 0, 1);
    const months = { '1m': 1, '3m': 3, '6m': 6, '1y': 12 }[activeTimeRange] || 1;
    return new Date(now.getFullYear(), now.getMonth() - (months - 1), 1);
}

function processDriverAnalytics() {
    if (globalDriversList.length === 0) return;
    const isEng = document.documentElement.lang === 'en';
    const currencyStr = isEng ? 'SAR' : 'ريال';
    
    try {
        const q = query(collection(db, "expenses"), where("userId", "==", currentUser.uid));
        if (unsubscribeAnalyticsExpenses) unsubscribeAnalyticsExpenses();

        unsubscribeAnalyticsExpenses = onSnapshot(q, (snapshot) => {
            let allExpenses = [];
            snapshot.forEach(doc => allExpenses.push(doc.data()));

            const sd = timeRangeStartDate();
            const startDateStr = sd.getFullYear() + '-' + pad2(sd.getMonth() + 1) + '-' + pad2(sd.getDate());
            let timeFilteredExp = allExpenses.filter(exp => {
                const d = expenseDateStr(exp);
                return d !== '' && d >= startDateStr;
            });

            let activeDriverExp = timeFilteredExp.filter(exp => exp.driverId === activeAnalyticsDriverId);
            
            let totalAmt = 0, totalCb = 0;
            let shopTotals = {};

            activeDriverExp.forEach(exp => {
                let amt = Number(exp.amount) || 0;
                let cb = Number(exp.cashback) || 0;
                let shop = exp.shopName || (isEng ? 'Unknown' : 'غير معروف');

                totalAmt += amt;
                totalCb += cb;
                shopTotals[shop] = (shopTotals[shop] || 0) + amt;
            });

            const elAmt = document.getElementById('stat-total-amt');
            if(elAmt) {
                elAmt.textContent = totalAmt.toFixed(2) + ' ' + currencyStr;
                document.getElementById('stat-total-cb').textContent = totalCb.toFixed(2) + ' ' + currencyStr;
            }

            let sortedShops = Object.keys(shopTotals).sort((a,b) => shopTotals[b] - shopTotals[a]);
            
            let top10Shops = sortedShops.slice(0, 10);
            let top10Amounts = top10Shops.map(s => shopTotals[s]);

            let allPieAmounts = sortedShops.map(s => shopTotals[s]);

            let driverTimeSeries = {};
            globalDriversList.forEach(d => { driverTimeSeries[d.id] = { name: d.name, data: {} }; });
            let allTimeKeys = new Set();

            timeFilteredExp.forEach(exp => {
                let amt = Number(exp.amount) || 0;
                let date = expenseDateStr(exp);
                let groupKey = date;

                if (activeTimeRange === '3m' || activeTimeRange === '6m') {
                    let d = new Date(date + 'T00:00:00');
                    d.setDate(d.getDate() - d.getDay()); 
                    groupKey = d.toISOString().split('T')[0] + (isEng ? ' (Week)' : ' (أسبوع)');
                } else if (activeTimeRange === '1y' || activeTimeRange === 'all') {
                    groupKey = date.substring(0, 7) + (isEng ? ' (Month)' : ' (شهر)'); 
                }

                allTimeKeys.add(groupKey);
                if (driverTimeSeries[exp.driverId]) {
                    driverTimeSeries[exp.driverId].data[groupKey] = (driverTimeSeries[exp.driverId].data[groupKey] || 0) + amt;
                }
            });

            let sortedTimeLabels = Array.from(allTimeKeys).sort();
            let lineDatasets = [];
            const lineColors = ['#3b82f6', '#e74c3c', '#2ecc71', '#f39c12', '#9b59b6', '#1abc9c', '#34495e'];
            let colorIndex = 0;

            globalDriversList.forEach(d => {
                let dData = sortedTimeLabels.map(t => driverTimeSeries[d.id].data[t] || 0);
                if (dData.some(val => val > 0)) {
                    lineDatasets.push({
                        label: d.name,
                        data: dData,
                        borderColor: lineColors[colorIndex % lineColors.length],
                        backgroundColor: lineColors[colorIndex % lineColors.length],
                        borderWidth: 2,
                        tension: 0.3,
                        fill: false
                    });
                    colorIndex++;
                }
            });

            const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
            const textColor = isDark ? '#e2e8f0' : '#1e293b';
            const gridColor = isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)';

            Chart.defaults.color = textColor;
            Chart.defaults.font.family = "'IBM Plex Sans Arabic', sans-serif";

            if (barChartInstance) barChartInstance.destroy();
            const ctxBar = document.getElementById('barChart').getContext('2d');
            barChartInstance = new Chart(ctxBar, {
                type: 'bar',
                data: {
                    labels: top10Shops,
                    datasets: [{
                        label: isEng ? 'Amount' : 'المبلغ (ريال)',
                        data: top10Amounts,
                        backgroundColor: 'rgba(59, 130, 246, 0.8)',
                        borderRadius: 6 
                    }]
                },
                options: {
                    responsive: true, maintainAspectRatio: false,
                    plugins: { legend: { display: false } },
                    scales: {
                        y: { beginAtZero: true, grid: { color: gridColor } },
                        x: { grid: { display: false } }
                    }
                }
            });

            if (pieChartInstance) pieChartInstance.destroy();
            const ctxPie = document.getElementById('pieChart').getContext('2d');
            const pieColors = ['#3b82f6', '#2ecc71', '#f39c12', '#e74c3c', '#9b59b6', '#34495e', '#1abc9c', '#d35400', '#c0392b', '#7f8c8d'];
            
            pieChartInstance = new Chart(ctxPie, {
                type: 'doughnut', 
                data: {
                    labels: sortedShops,
                    datasets: [{
                        data: allPieAmounts,
                        backgroundColor: pieColors,
                        borderWidth: 0
                    }]
                },
                options: {
                    responsive: true, maintainAspectRatio: false,
                    plugins: {
                        legend: { position: 'right' },
                        tooltip: {
                            callbacks: {
                                label: function(context) {
                                    let label = context.label || '';
                                    let value = context.parsed || 0;
                                    let percentage = totalAmt > 0 ? ((value / totalAmt) * 100).toFixed(1) : 0;
                                    return ` ${label}: ${value} ${currencyStr} (${percentage}%)`;
                                }
                            }
                        }
                    },
                    cutout: '60%' 
                }
            });

            if (lineChartInstance) lineChartInstance.destroy();
            const ctxLine = document.getElementById('lineChart').getContext('2d');
            lineChartInstance = new Chart(ctxLine, {
                type: 'line',
                data: {
                    labels: sortedTimeLabels,
                    datasets: lineDatasets
                },
                options: {
                    responsive: true, maintainAspectRatio: false,
                    plugins: {
                        legend: { position: 'top' } 
                    },
                    scales: {
                        y: { beginAtZero: true, grid: { color: gridColor } },
                        x: { grid: { display: false } }
                    }
                }
            });

        });
    } catch (err) {}
}

// ==========================================
// 8. معالجة الأحداث والنماذج
// ==========================================
document.addEventListener('change', (e) => {
    if (e.target && e.target.id === 'expenses-sort') {
        activeExpenseSort = e.target.value;
        renderExpensesTable();
        return;
    }
    if (e.target && e.target.id === 'driver-card') {
        const otherInput = document.getElementById('driver-card-other');
        if (e.target.value === 'أخرى' || e.target.value === 'Other') {
            otherInput.style.display = 'block';
            otherInput.required = true;
        } else {
            otherInput.style.display = 'none';
            otherInput.required = false;
            otherInput.value = '';
        }
    }
});

document.addEventListener('submit', async (e) => {
    if (e.target && e.target.id === 'add-driver-form') {
        e.preventDefault();
        const isEng = document.documentElement.lang === 'en';
        const name = document.getElementById('driver-name').value.trim();
        const car = document.getElementById('driver-car').value.trim();
        const editId = document.getElementById('edit-driver-id').value;
        let card = document.getElementById('driver-card').value;
        if (card === 'أخرى' || card === 'Other') card = document.getElementById('driver-card-other').value.trim();
        if (!name) return;

        const submitBtn = document.getElementById('submit-driver-btn');
        const textSpan = document.getElementById('submit-btn-text');
        const originalText = textSpan ? textSpan.innerText : (isEng ? "Save" : "حفظ");
        submitBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';

    try {
            if (editId) {
                await updateDoc(doc(db, "drivers", editId), { name: name, car: car || "", cardType: card || "" });
                document.getElementById('form-title').textContent = isEng ? "Add New Driver" : "إضافة سائق جديد";
                document.getElementById('cancel-edit-btn').style.display = 'none';
                submitBtn.innerHTML = isEng ? 'Updated ✔' : 'تم التحديث ✔';
                submitBtn.style.background = '#2ecc71';
                submitBtn.style.borderColor = '#2ecc71';
            } else {
                await addDoc(collection(db, "drivers"), { userId: currentUser.uid, name: name, car: car || "", cardType: card || "", createdAt: serverTimestamp() });
                submitBtn.innerHTML = isEng ? 'Added ✔' : 'تمت الإضافة ✔';
                submitBtn.style.background = '#2ecc71';
                submitBtn.style.borderColor = '#2ecc71';
            }
            
            e.target.reset();
            document.getElementById('edit-driver-id').value = "";
            
            setTimeout(() => {
                submitBtn.innerHTML = `<i class="fa-solid fa-floppy-disk"></i> <span id="submit-btn-text">${isEng ? 'Save' : 'حفظ'}</span>`;
                submitBtn.style.background = '';
                submitBtn.style.borderColor = '';
            }, 2000);
            
        } catch (error) { 
            submitBtn.innerHTML = isEng ? 'Error ❌' : 'حدث خطأ ❌';
            submitBtn.style.background = 'var(--danger)';
            submitBtn.style.borderColor = 'var(--danger)';
            setTimeout(() => {
                submitBtn.innerHTML = `<i class="fa-solid fa-floppy-disk"></i> <span id="submit-btn-text">${originalText}</span>`;
                submitBtn.style.background = '';
                submitBtn.style.borderColor = '';
            }, 2000);
        }
    }
    
    if (e.target && e.target.id === 'settings-form') {
        e.preventDefault();
        const newName = document.getElementById('settings-name-input').value.trim();
        const newEmail = document.getElementById('settings-email-input').value.trim();
        const newPassword = document.getElementById('settings-password-input').value;

        const emailErrEl = document.getElementById('settings-email-error');
        const passErrEl = document.getElementById('settings-password-error');
        const isEng = document.documentElement.lang === 'en';
        const setErr = (el, msg) => { if (el) { el.textContent = msg; el.classList.add('show'); } };
        const clearAll = () => [emailErrEl, passErrEl].forEach(el => { if (el) { el.textContent = ''; el.classList.remove('show'); } });

        clearAll();

        if (!newName) { return; }

        // شروط كلمة المرور مطبقة على التغيير أيضاً
        if (newPassword && !/^(?=.*[A-Za-z])(?=.*\d).{8,}$/.test(newPassword)) {
            setErr(passErrEl, isEng
                ? 'Weak password. It must be at least 8 characters and contain both English letters and numbers.'
                : 'كلمة المرور ضعيفة! يجب أن تكون 8 خانات على الأقل وتحتوي على أحرف إنجليزية وأرقام.');
            document.getElementById('settings-password-input').classList.add('input-error');
            return;
        }

        const saveBtn = document.getElementById('save-settings-btn');
        const originalText = saveBtn.innerHTML;
        saveBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';

        try {
            if (auth.currentUser) {
                // أولاً: تغيير الاسم (إذا تغيّر)
                if (newName !== (auth.currentUser.displayName || '')) {
                    await updateProfile(auth.currentUser, { displayName: newName });
                }

                // ثانياً: تغيير الرقم السري (إذا أُدخل)
                if (newPassword) await updatePassword(auth.currentUser, newPassword);

                // ثالثاً: تغيير الإيميل (إذا اختلف) — عبر إرسال رسالة تحقق للإيميل الجديد
                // نظام فايربيس يمنع تغيير الإيميل مباشرة لأمان (Email Enumeration Protection)
                // فعند طلب تغيير الإيميل: إن كان مسجلاً مسبقاً تظهر رسالة، وإلا يُرسل بريد تحقق
                let emailSent = false;
                if (newEmail && newEmail !== auth.currentUser.email) {
                    await verifyBeforeUpdateEmail(auth.currentUser, newEmail);
                    emailSent = true;
                }

                document.getElementById('user-name').textContent = newName;
                if (emailSent) {
                    saveBtn.innerHTML = isEng ? 'Check your inbox ✔' : 'تأكد من بريدك ✔';
                    setErr(emailErrEl, isEng
                        ? 'A verification email was sent to the new address. Open the link in that email to confirm the change.'
                        : 'تم إرسال رسالة تحقق إلى الإيميل الجديد. افتح الرابط داخل الرسالة لتأكيد التغيير.');
                } else {
                    saveBtn.innerHTML = isEng ? 'Saved ✔' : 'تم الحفظ ✔';
                    saveBtn.style.background = '#2ecc71';
                    setTimeout(() => { saveBtn.innerHTML = originalText; saveBtn.style.background = ''; }, 2000);
                }
                document.getElementById('settings-password-input').value = '';
            }
        } catch (error) {
            saveBtn.innerHTML = originalText;
            if (error.code === 'auth/email-already-in-use') {
                setErr(emailErrEl, isEng
                    ? 'This email is already registered to another account.'
                    : 'هذا الإيميل مسجل مسبقاً بحساب آخر.');
                document.getElementById('settings-email-input').classList.add('input-error');
            } else if (error.code === 'auth/requires-recent-login') {
                setErr(passErrEl, isEng
                    ? 'For security, please log out and log in again, then retry changing the email or password.'
                    : 'للأمان، سجل الخروج ثم ادخل من جديد وعاود المحاولة لتغيير الإيميل أو الرقم السري.');
            } else {
                setErr(passErrEl, isEng ? 'Error: ' + (error.message || '') : 'خطأ: ' + (error.message || ''));
            }
        }
    }
});

document.addEventListener('click', async (e) => {
    // === زر عرض الفواتير (معرض: تصفح + حذف) ===
    const manyBtn = e.target.closest('.receipt-many-btn');
    if (manyBtn) {
        const id = manyBtn.getAttribute('data-id');
        const isEng = document.documentElement.lang === 'en';
        let paths = [];
        try { paths = JSON.parse(decodeURIComponent(manyBtn.getAttribute('data-paths') || '[]')); } catch (err) { paths = []; }
        showReceiptsModal(id, paths, isEng);
        return;
    }

    // === زر إرفاق الفاتورة ===
    const uploadBtn = e.target.closest('.upload-btn');
    if (uploadBtn) {
        const expenseId = uploadBtn.getAttribute('data-id');
        const isEng = document.documentElement.lang === 'en';
        
        // إنشاء زر وهمي مخفي لفتح ملفات الجهاز
        const fileInput = document.createElement('input');
        fileInput.type = 'file';
        fileInput.accept = 'image/*,application/pdf';
        
        fileInput.onchange = async (event) => {
            const file = event.target.files[0];
            if (!file) return;

            const originalHtml = uploadBtn.innerHTML;
            uploadBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';
            uploadBtn.style.pointerEvents = 'none';

            const fail = (msg) => {
                uploadBtn.innerHTML = originalHtml;
                uploadBtn.style.pointerEvents = 'auto';
                Swal.fire({ icon: 'error', title: isEng ? 'Upload failed' : 'فشل الرفع', text: msg });
            };

            try {
                // عدد الفواتير الحالية للعملية
                const currentSnap = await getDoc(doc(db, "expenses", expenseId));
                const existing = getReceiptUrls(currentSnap.exists() ? currentSnap.data() : {});
                if (existing.length >= MAX_RECEIPTS) {
                    uploadBtn.innerHTML = originalHtml;
                    uploadBtn.style.pointerEvents = 'auto';
                    Swal.fire({ icon: 'info', title: isEng ? 'Maximum reached' : 'الحد الأقصى 3 فواتير', text: isEng ? 'You can add up to 3 receipts per operation. Delete one first.' : 'يمكن إضافة حتى 3 فواتير للعملية الواحدة. احذف فاتورة أولاً لتضيف غيرها.', timer: 2500, showConfirmButton: false });
                    return;
                }

                // ضغط الصورة وحفظها داخل الموقع مباشرة
                let dataUrl = null;
                try {
                    dataUrl = await compressImage(file, 900, 0.72);
                    if (!dataUrl || dataUrl.length > 850000) {
                        dataUrl = await compressImage(file, 600, 0.55);
                    }
                } catch (compressErr) {
                    console.error('Compress failed:', compressErr);
                }

                if (dataUrl && dataUrl.length <= 850000) {
                    await updateDoc(doc(db, "expenses", expenseId), { receiptUrls: existing.concat(dataUrl) });
                    uploadBtn.innerHTML = originalHtml;
                    uploadBtn.style.pointerEvents = 'auto';
                    return; // الجدول يتحدث تلقائياً ويظهر زر الفاتورة
                }

                fail(isEng
                    ? 'Cannot save this image. Try another image (JPG or PNG).'
                    : 'تعذر حفظ الصورة. جرّب صورة أصغر أو بصيغة JPG.');
            } catch (err) {
                console.error(err);
                fail((isEng ? 'Error: ' : 'خطأ: ')
                    + (err && (err.message || err.code) ? (err.message || err.code) : 'unknown')
                    + (err && err.code ? ' (' + err.code + ')' : ''));
            }
        };
        
        fileInput.click();
        return;
    }
    const editExpBtn = e.target.closest('.edit-expense-btn');
    if (editExpBtn) {
        const id = editExpBtn.getAttribute('data-id');
        const row = document.getElementById(`exp-row-${id}`);
        if (!row) return;
        const isEng = document.documentElement.lang === 'en';

        const shop = row.querySelector('.col-shop').innerText;
        const date = row.querySelector('.col-date').innerText;
        const amount = row.querySelector('.col-amount').getAttribute('data-val');
        const cashback = row.querySelector('.col-cashback').getAttribute('data-val');

        const inputStyle = "width: 100%; min-width: 80px; padding: 6px; border-radius: 6px; border: 1px solid var(--border-color); background: var(--bg-base); color: var(--text-primary); outline: none; font-family: inherit;";

        row.querySelector('.col-shop').innerHTML = `<input type="text" class="edit-in-shop" value="${shop === 'غير معروف' || shop === 'Unknown' ? '' : shop}" style="${inputStyle}">`;
        row.querySelector('.col-date').innerHTML = `<input type="date" class="edit-in-date" value="${date === '-' ? '' : date}" style="${inputStyle}">`;
        row.querySelector('.col-amount').innerHTML = `<input type="number" class="edit-in-amount" value="${amount}" style="${inputStyle}">`;
        row.querySelector('.col-cashback').innerHTML = `<input type="number" class="edit-in-cashback" value="${cashback}" style="${inputStyle}">`;
        
        row.querySelector('.col-actions').innerHTML = `
            <button class="btn-text save-expense-btn" data-id="${id}" style="color: white; font-size: 13px; background: #2ecc71; padding: 6px 12px; border-radius: 6px; margin-left: 5px; font-weight: bold;">${isEng ? 'Save' : 'حفظ'}</button>
            <button class="btn-text cancel-expense-btn" style="color: var(--text-primary); font-size: 13px; background: rgba(130,130,130,0.2); padding: 6px 12px; border-radius: 6px; font-weight: bold;">${isEng ? 'Cancel' : 'إلغاء'}</button>
        `;
        return;
    }

    // === زر إلغاء تعديل العملية ===
    if (e.target.closest('.cancel-expense-btn')) {
        fetchUserExpenses(activeDriverId); 
        return;
    }

    // === زر حفظ تعديل العملية (بها تصحيح التعليق) ===
    const saveExpBtn = e.target.closest('.save-expense-btn');
    if (saveExpBtn) {
        const id = saveExpBtn.getAttribute('data-id');
        const row = document.getElementById(`exp-row-${id}`);
        if (!row) return;

        saveExpBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';

        const newShop = row.querySelector('.edit-in-shop').value.trim();
        const newDate = row.querySelector('.edit-in-date').value;
        const newAmount = parseFloat(row.querySelector('.edit-in-amount').value) || 0;
        const newCashback = parseFloat(row.querySelector('.edit-in-cashback').value) || 0;

        try {
            await updateDoc(doc(db, "expenses", id), {
                shopName: newShop,
                date: newDate,
                amount: newAmount,
                cashback: newCashback
            });
            // قاعدة البيانات (onSnapshot) بتحدث الجدول تلقائياً وتخفي زر الحفظ بمجرد النجاح
        } catch (err) {
            saveExpBtn.innerHTML = 'Error!';
            saveExpBtn.style.background = 'var(--danger)';
            // إخفاء التعليق وإلغاء العملية بعد ثانيتين
            setTimeout(() => fetchUserExpenses(activeDriverId), 2000);
        }
        return;
    }

    // ==========================================
    // 1. زر إنشاء تقرير PDF
    // ==========================================
    if (e.target.closest('#export-pdf-btn')) {
        const btn = e.target.closest('#export-pdf-btn');
        const isEng = document.documentElement.lang === 'en';
        const originalText = btn.innerHTML;
        btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> ${isEng ? 'Generating...' : 'جاري إصدار التقرير...'}`;
        try {
            if (typeof html2canvas === 'undefined') throw new Error('REPORT_LIB_MISSING');
            if (typeof window.jspdf === 'undefined' || typeof window.jspdf.jsPDF === 'undefined') throw new Error('REPORT_LIB_MISSING');
            if (typeof Chart === 'undefined') throw new Error('CHART_LIB_MISSING');

            const totalAmt = (document.getElementById('stat-total-amt') || {}).textContent || '0';
            const totalCb = (document.getElementById('stat-total-cb') || {}).textContent || '0';
            const currentDate = new Date().toLocaleDateString(isEng ? 'en-US' : 'ar-SA');

            // تحويل ألوان الرسوم لألوان داكنة واضحة على الخلفية البيضاء أثناء التصوير
            const curDark = document.documentElement.getAttribute('data-theme') === 'dark';
            const originalColor = Chart.defaults.color;
            const exportGrid = 'rgba(0,0,0,0.08)';
            const exportTick = '#1e293b';
            Chart.defaults.color = exportTick;
            if (barChartInstance) { barChartInstance.options.scales.x.ticks.color = exportTick; barChartInstance.options.scales.y.ticks.color = exportTick; barChartInstance.options.scales.y.grid.color = exportGrid; barChartInstance.options.scales.x.grid.color = exportGrid; barChartInstance.update(); }
            if (pieChartInstance) { pieChartInstance.options.plugins.legend.labels.color = exportTick; pieChartInstance.options.plugins.legend.display = true; pieChartInstance.options.plugins.legend.position = 'bottom'; pieChartInstance.update(); }
            if (lineChartInstance) { lineChartInstance.options.scales.x.ticks.color = exportTick; lineChartInstance.options.scales.y.ticks.color = exportTick; lineChartInstance.options.scales.x.grid.color = exportGrid; lineChartInstance.options.scales.y.grid.color = exportGrid; lineChartInstance.options.plugins.legend.labels.color = exportTick; lineChartInstance.update(); }

            setTimeout(async () => {
                let tempPages = [];
                try {
                    const getChartImage = (chart) => {
                        if (!chart) return '';
                        const canvas = chart.canvas;
                        const tempCanvas = document.createElement('canvas');
                        tempCanvas.width = canvas.width; tempCanvas.height = canvas.height;
                        const tempCtx = tempCanvas.getContext('2d');
                        tempCtx.fillStyle = '#ffffff';
                        tempCtx.fillRect(0, 0, tempCanvas.width, tempCanvas.height);
                        tempCtx.drawImage(canvas, 0, 0);
                        return tempCanvas.toDataURL('image/jpeg', 0.95);
                    };

                    const barImg = getChartImage(barChartInstance);
                    const pieImg = getChartImage(pieChartInstance);
                    const lineImg = getChartImage(lineChartInstance);

                    // استعادة ألوان الرسوم للوضع الأصلي على الشاشة
                    Chart.defaults.color = originalColor;
                    const screenTick = curDark ? '#e2e8f0' : '#1e293b';
                    const screenGrid = curDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)';
                    if (barChartInstance) { barChartInstance.options.scales.x.ticks.color = screenTick; barChartInstance.options.scales.y.ticks.color = screenTick; barChartInstance.options.scales.x.grid.color = screenGrid; barChartInstance.options.scales.y.grid.color = screenGrid; barChartInstance.update(); }
                    if (pieChartInstance) { pieChartInstance.options.plugins.legend.labels.color = screenTick; pieChartInstance.update(); }
                    if (lineChartInstance) { lineChartInstance.options.scales.x.ticks.color = screenTick; lineChartInstance.options.scales.y.ticks.color = screenTick; lineChartInstance.options.scales.x.grid.color = screenGrid; lineChartInstance.options.scales.y.grid.color = screenGrid; lineChartInstance.options.plugins.legend.labels.color = screenTick; lineChartInstance.update(); }

                    const titleStr = isEng ? 'Financial Expenses Report' : 'تقرير المصروفات المالي';
                    const dateStr = isEng ? 'Date:' : 'تاريخ التقرير:';
                    const totalExpStr = isEng ? 'Total Expenses' : 'إجمالي المصروفات';
                    const totalCbStr = isEng ? 'Total Cashback' : 'الاسترداد النقدي (Cashback)';
                    const top10Str = isEng ? 'Highest Spending Categories' : 'أعلى المتاجر صرفاً';
                    const distStr = isEng ? 'Expenses Distribution' : 'التوزيع النسبي للمصروفات';
                    const lineStr = isEng ? 'Spending Trends' : 'المؤشر الزمني للمصروفات';

                    // كل قسم = صفحة A4 كاملة (لا انقسام)
                    const makePage = (inner) => {
                        const d = document.createElement('div');
                        d.style.cssText = "width: 794px; height: 1123px; padding: 45px; box-sizing: border-box; background: #ffffff; color: #000000; font-family: Arial, sans-serif; direction: ltr; overflow: hidden; position: fixed; left: -10000px; top: 0; z-index: -1;";
                        d.setAttribute('dir', 'ltr');
                        d.innerHTML = inner;
                        return d;
                    };

                    const page1 = makePage(`
                        <table style="width: 100%; border-collapse: collapse; border-bottom: 3px solid #1e3a8a; padding-bottom: 10px; margin-bottom: 30px;">
                            <tr>
                                <td style="text-align: left;">
                                    <h1 style="color: #1e3a8a; margin: 0; font-size: 26px; font-weight: bold;">${titleStr}</h1>
                                    <p style="margin: 6px 0 0 0; font-size: 13px; color: #475569;">${isEng ? 'Driver Expense Tracking System' : 'نظام إدارة مصاريف السائقين'}</p>
                                </td>
                                <td style="text-align: right; vertical-align: bottom;">
                                    <p style="margin: 0; font-size: 13px; font-weight: bold; color: #000;">${dateStr} ${currentDate}</p>
                                </td>
                            </tr>
                        </table>

                        <table style="width: 100%; border-collapse: separate; border-spacing: 0; margin-bottom: 32px;">
                            <tr>
                                <td style="width: 48%; background: #f1f5f9; padding: 20px; border-radius: 8px; border-right: 5px solid #e74c3c; text-align: center;">
                                    <div style="color: #334155; font-size: 15px; margin-bottom: 8px; font-weight: bold;">${totalExpStr}</div>
                                    <div style="font-size: 26px; font-weight: bold; color: #b91c1c;">${totalAmt}</div>
                                </td>
                                <td style="width: 4%;"></td>
                                <td style="width: 48%; background: #f1f5f9; padding: 20px; border-radius: 8px; border-right: 5px solid #2ecc71; text-align: center;">
                                    <div style="color: #334155; font-size: 15px; margin-bottom: 8px; font-weight: bold;">${totalCbStr}</div>
                                    <div style="font-size: 26px; font-weight: bold; color: #15803d;">${totalCb}</div>
                                </td>
                            </tr>
                        </table>

                        <div style="text-align: center;">
                            <h3 style="color: #1e3a8a; margin-bottom: 18px; font-size: 17px;">${top10Str}</h3>
                            <img src="${barImg}" style="width: 100%; max-height: 420px; object-fit: contain; display: block; margin: 0 auto;">
                        </div>
                    `);

                    const page2 = makePage(`
                        <div style="text-align: center; padding-top: 20px;">
                            <h3 style="color: #1e3a8a; margin-bottom: 30px; font-size: 17px;">${distStr}</h3>
                            <img src="${pieImg}" style="width: 80%; max-height: 680px; object-fit: contain; display: block; margin: 0 auto;">
                        </div>
                    `);

                    const page3 = makePage(`
                        <div style="text-align: center; padding-top: 20px;">
                            <h3 style="color: #1e3a8a; margin-bottom: 30px; font-size: 17px;">${lineStr}</h3>
                            <img src="${lineImg}" style="width: 100%; max-height: 680px; object-fit: contain; display: block; margin: 0 auto;">
                        </div>
                    `);

                    const { jsPDF } = window.jspdf;
                    const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
                    const pageWidth = pdf.internal.pageSize.getWidth();
                    const pageHeight = pdf.internal.pageSize.getHeight();

                    const targets = [page1, page2, page3];
                    for (let i = 0; i < targets.length; i++) {
                        document.body.appendChild(targets[i]);
                        tempPages.push(targets[i]);
                        const canvas = await html2canvas(targets[i], { scale: 2, useCORS: true, backgroundColor: '#ffffff', logging: false });
                        const imgData = canvas.toDataURL('image/jpeg', 0.92);
                        if (i > 0) pdf.addPage();
                        pdf.addImage(imgData, 'JPEG', 0, 0, pageWidth, pageHeight, undefined, 'FAST');
                    }

                    while (tempPages.length) {
                        const p = tempPages.pop();
                        if (p && p.parentNode) p.parentNode.removeChild(p);
                    }

                    const totalPages = pdf.internal.getNumberOfPages();
                    for (let i = 1; i <= totalPages; i++) {
                        pdf.setPage(i);
                        pdf.setFontSize(10);
                        pdf.setTextColor(100);
                        pdf.text(String(i) + ' / ' + String(totalPages), pageWidth / 2, pageHeight - 7, { align: 'center' });
                    }

                    pdf.save(isEng ? 'Financial_Report.pdf' : 'تقرير_المصاريف.pdf');
                    btn.innerHTML = originalText;
                } catch (err) {
                    console.error(err);
                    while (tempPages.length) {
                        const p = tempPages.pop();
                        if (p && p.parentNode) p.parentNode.removeChild(p);
                    }
                    btn.innerHTML = originalText;
                    Swal.fire({ icon: 'error', title: isEng ? 'PDF Error' : 'خطأ بالتقرير', text: isEng ? 'Could not generate the report. Try again.' : 'حصل خطأ أثناء إنشاء التقرير. حاول مجدداً.' });
                }
            }, 700);
        } catch (err) {
            console.error(err);
            btn.innerHTML = originalText;
            Swal.fire({
                icon: 'error',
                title: isEng ? 'PDF Error' : 'خطأ بالتقرير',
                text: (err && (err.message === 'REPORT_LIB_MISSING' || err.message === 'CHART_LIB_MISSING'))
                    ? (isEng ? 'Report library not loaded. Check your internet and reload the page.' : 'مكتبة التقرير لم تُحمّل. تأكد من الاتصال بالإنترنت وأعد تحميل الصفحة.')
                    : (isEng ? 'Could not generate the report. Try again.' : 'حصل خطأ أثناء إنشاء التقرير. حاول مجدداً.')
            });
        }
        return;
    }

    // ==========================================
    // 2. زر تغيير اللغة
    // ==========================================
    const langBtn = e.target.closest('#lang-toggle');
    if (langBtn) {
        const isAr = document.documentElement.lang === 'ar';
        document.documentElement.lang = isAr ? 'en' : 'ar';
        document.documentElement.dir = isAr ? 'ltr' : 'rtl';
        localStorage.setItem('site_lang', isAr ? 'en' : 'ar');
        applyLanguage();
        
        const activeNavObj = document.querySelector('.nav-item.active');
        if(activeNavObj) {
            const activeNav = activeNavObj.getAttribute('data-target');
            if(activeNav === 'manage') { document.querySelector('[data-target="manage"]').click(); }
            else if(activeNav === 'analytics') { document.querySelector('[data-target="analytics"]').click(); }
            else if(activeNav === 'drivers') { document.querySelector('[data-target="drivers"]').click(); }
        }
        return;
    }

    // 3. التنقل بالتحليلات
    const analyticsTabBtn = e.target.closest('.analytics-driver-tab-btn');
    if (analyticsTabBtn) {
        activeAnalyticsDriverId = analyticsTabBtn.getAttribute('data-id');
        fetchAnalyticsData(); 
        return;
    }

    const timeFilterBtn = e.target.closest('.time-filter-btn');
    if (timeFilterBtn) {
        document.querySelectorAll('.time-filter-btn').forEach(btn => {
            btn.classList.remove('active');
            btn.style.background = 'transparent';
            btn.style.color = 'var(--text-primary)';
        });
        timeFilterBtn.classList.add('active');
        timeFilterBtn.style.background = 'var(--primary-accent)';
        timeFilterBtn.style.color = 'white';
        activeTimeRange = timeFilterBtn.getAttribute('data-range');
        if(typeof processDriverAnalytics === "function") processDriverAnalytics(); 
        return;
    }

    // 4. السائقين والعمليات 
    const tabBtn = e.target.closest('.dashboard-tab-btn');
    if (tabBtn) {
        activeDriverId = tabBtn.getAttribute('data-id');
        fetchDashboardDrivers(); 
        return;
    }

    const editDriverBtn = e.target.closest('.edit-driver-btn');
    if (editDriverBtn) {
        document.getElementById('driver-name').value = editDriverBtn.getAttribute('data-name');
        document.getElementById('driver-car').value = editDriverBtn.getAttribute('data-car');
        document.getElementById('edit-driver-id').value = editDriverBtn.getAttribute('data-id');
        
        const card = editDriverBtn.getAttribute('data-card');
        const cardSelect = document.getElementById('driver-card');
        const cardOther = document.getElementById('driver-card-other');
        
        if (["مدى", "فيزا", "ماستركارد", ""].includes(card)) {
            cardSelect.value = card;
            cardOther.style.display = 'none';
        } else {
            cardSelect.value = 'أخرى';
            cardOther.style.display = 'block';
            cardOther.value = card;
        }

        const isEng = document.documentElement.lang === 'en';
        document.getElementById('form-title').textContent = isEng ? "Edit Driver Details" : "تعديل بيانات السائق";
        document.getElementById('submit-driver-btn').innerHTML = `<i class="fa-solid fa-pen-to-square"></i> <span id="submit-btn-text">${isEng ? 'Update' : 'تحديث'}</span>`;
        document.getElementById('cancel-edit-btn').style.display = 'inline-block';
        window.scrollTo({ top: 0, behavior: 'smooth' });
        return;
    }

    const cancelEditBtn = e.target.closest('#cancel-edit-btn');
    if (cancelEditBtn) {
        const isEng = document.documentElement.lang === 'en';
        document.getElementById('add-driver-form').reset();
        document.getElementById('driver-card-other').style.display = 'none';
        document.getElementById('edit-driver-id').value = "";
        document.getElementById('form-title').textContent = isEng ? "Add New Driver" : "إضافة سائق جديد";
        document.getElementById('submit-driver-btn').innerHTML = `<i class="fa-solid fa-floppy-disk"></i> <span id="submit-btn-text">${isEng ? 'Save' : 'حفظ'}</span>`;
        cancelEditBtn.style.display = 'none';
        return;
    }

    // 5. الحذف (مع الترجمة للمتأكد)
    const deleteBtn = e.target.closest('.delete-btn');
    if (deleteBtn) {
        const id = deleteBtn.getAttribute('data-id');
        const isEng = document.documentElement.lang === 'en';
        if (!deleteBtn.classList.contains('confirming-delete')) {
            const originalHtml = deleteBtn.innerHTML;
            deleteBtn.innerHTML = isEng ? 'Sure?' : 'متأكد؟';
            deleteBtn.style.color = 'white'; deleteBtn.style.background = 'var(--danger)';
            deleteBtn.style.padding = '4px 8px'; deleteBtn.style.borderRadius = '4px';
            deleteBtn.classList.add('confirming-delete');
            setTimeout(() => {
                if (document.body.contains(deleteBtn)) {
                    deleteBtn.innerHTML = originalHtml;
                    deleteBtn.style.color = 'var(--danger)'; deleteBtn.style.background = 'none'; deleteBtn.style.padding = '0';
                    deleteBtn.classList.remove('confirming-delete');
                }
            }, 3000);
        } else {
            deleteBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';
            try { await deleteDoc(doc(db, "expenses", id)); } 
            catch (err) { Swal.fire({icon: 'error', title: 'Error', text: 'Failed to delete.'}); }
        }
        return;
    }

    const deleteDriverBtn = e.target.closest('.delete-driver-btn');
    if (deleteDriverBtn) {
        const id = deleteDriverBtn.getAttribute('data-id');
        const isEng = document.documentElement.lang === 'en';
        if (!deleteDriverBtn.classList.contains('confirming-delete')) {
            const originalHtml = deleteDriverBtn.innerHTML;
            deleteDriverBtn.innerHTML = isEng ? 'Sure?' : 'متأكد؟';
            deleteDriverBtn.style.background = 'var(--danger)'; deleteDriverBtn.style.color = 'white';
            deleteDriverBtn.classList.add('confirming-delete');
            setTimeout(() => {
                if (document.body.contains(deleteDriverBtn)) {
                    deleteDriverBtn.innerHTML = originalHtml;
                    deleteDriverBtn.style.background = 'rgba(231, 76, 60, 0.1)'; deleteDriverBtn.style.color = 'var(--danger)';
                    deleteDriverBtn.classList.remove('confirming-delete');
                }
            }, 3000);
        } else {
            deleteDriverBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';
            try { await deleteDoc(doc(db, "drivers", id)); } 
            catch (err) { Swal.fire({icon: 'error', title: 'Error', text: 'Failed to delete.'}); }
        }
        return;
    }
});