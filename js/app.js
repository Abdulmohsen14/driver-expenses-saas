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
import { collection, query, where, doc, deleteDoc, updateDoc, addDoc, onSnapshot, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { getAuth, updateEmail, updatePassword, updateProfile } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";

const auth = getAuth();
const contentArea = document.querySelector('.content-area');
const navItems = document.querySelectorAll('.nav-item');
const BOT_USERNAME = "DriverExpenseTrackerBot"; // اسم بوت التيليجرام الخاص بك

let currentUser = null;
let unsubscribeExpenses = null;
let unsubscribeDrivers = null;
let unsubscribeDashboardDrivers = null;
let activeDriverId = null; 
window.userTelegramLinked = false; // متغير عالمي يراقب حالة التيليجرام بدون قلتش

// استرجاع اللغة
try {
    const savedLang = localStorage.getItem('site_lang');
    if (savedLang === 'en') {
        document.documentElement.lang = 'en';
        document.documentElement.dir = 'ltr';
        window.addEventListener('DOMContentLoaded', () => {
            const langBtn = document.getElementById('lang-toggle');
            if (langBtn) langBtn.textContent = 'ع';
        });
    }
} catch(e) {}

function cleanupSubscriptions() {
    if (unsubscribeExpenses) unsubscribeExpenses();
    if (unsubscribeDrivers) unsubscribeDrivers();
    if (unsubscribeDashboardDrivers) unsubscribeDashboardDrivers();
}

// ==========================================
// 3. مراقب التيليجرام الذكي (يعمل بالخلفية)
// ==========================================
function startTelegramObserver(uid) {
    try {
        const userRef = doc(db, 'users', uid);
        onSnapshot(userRef, (docSnap) => {
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
    
    if (window.userTelegramLinked) {
        btn.innerHTML = '➕ إضافة مشتريات';
        btn.style.backgroundColor = '#28a745';
        btn.onclick = () => window.open(`https://t.me/${BOT_USERNAME}`, '_blank');
    } else {
        btn.innerHTML = '🤖 ربط البوت';
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
            
            const target = item.getAttribute('data-target');
            if (target === 'manage') {
                document.getElementById('page-title').textContent = "إدارة العمليات";
                renderDashboard();
                fetchDashboardDrivers();
            } else if (target === 'analytics') {
                document.getElementById('page-title').textContent = "لوحة التحليلات";
                renderAnalyticsPage();
                fetchAnalyticsData();
            } else if (target === 'drivers') {
                document.getElementById('page-title').textContent = "إدارة السائقين";
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
    contentArea.innerHTML = `
        <div id="dashboard-driver-tabs" style="display: flex; gap: 10px; margin-bottom: 25px; overflow-x: auto; padding-bottom: 5px;">
            <span style="color: var(--text-muted); font-size: 13px;">جاري تحميل السائقين...</span>
        </div>

        <div class="table-header" style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px;">
            <h3 style="font-size: 18px; font-weight: 600; margin: 0;">سجل العمليات</h3>
            <!-- زر التيليجرام الديناميكي الذي يتغير بناءً على حالة الربط -->
            <button id="dynamic-telegram-btn" class="btn-primary" style="flex: none; width: auto; font-size: 13px; padding: 8px 15px; font-weight:bold;">
                ⏳ جاري التحقق...
            </button>
        </div>
        
        <div class="table-container" style="background-color: var(--bg-surface); border: 1px solid rgba(130, 130, 130, 0.3); border-radius: 12px; overflow-x: auto; box-shadow: 0 4px 15px rgba(0,0,0,0.1);">
            <table class="saas-table" style="width: 100%; border-collapse: collapse; text-align: right;">
                <thead style="background-color: rgba(150, 150, 150, 0.05);">
                    <tr>
                        <th style="padding: 16px; border-bottom: 1px solid var(--border-color); color: var(--text-muted); font-size: 13px;">المتجر</th>
                        <th style="padding: 16px; border-bottom: 1px solid var(--border-color); color: var(--text-muted); font-size: 13px;">التاريخ</th>
                        <th style="padding: 16px; border-bottom: 1px solid var(--border-color); color: var(--text-muted); font-size: 13px;">المبلغ</th>
                        <th style="padding: 16px; border-bottom: 1px solid var(--border-color); color: var(--text-muted); font-size: 13px;">الكاش باك</th>
                        <th style="padding: 16px; border-bottom: 1px solid var(--border-color); color: var(--text-muted); font-size: 13px;">الحالة</th>
                        <th style="padding: 16px; border-bottom: 1px solid var(--border-color); color: var(--text-muted); font-size: 13px;">الفاتورة</th>
                        <th style="padding: 16px; border-bottom: 1px solid var(--border-color); color: var(--text-muted); font-size: 13px;">إجراء</th>
                    </tr>
                </thead>
                <tbody id="expenses-tbody">
                    <tr><td colspan="7" style="text-align: center; padding: 30px; color: var(--text-muted);">الرجاء إضافة واختيار سائق لعرض عملياته.</td></tr>
                </tbody>
            </table>
        </div>
    `;
    updateTelegramButtonUI(); // تحديث الزر فوراً بعد رسمه
}

function fetchDashboardDrivers() {
    try {
        const q = query(collection(db, "drivers"), where("userId", "==", currentUser.uid));
        unsubscribeDashboardDrivers = onSnapshot(q, (snapshot) => {
            const tabsContainer = document.getElementById('dashboard-driver-tabs');
            if (!tabsContainer) return;
            tabsContainer.innerHTML = '';
            
            if (snapshot.empty) {
                tabsContainer.innerHTML = `<span style="color: var(--text-muted); font-size: 13px;">لا يوجد سائقين. اذهب لصفحة "السائقين" من القائمة للإضافة.</span>`;
                activeDriverId = null;
                if (unsubscribeExpenses) unsubscribeExpenses();
                return;
            }

            let drivers = [];
            snapshot.forEach(docSnap => drivers.push({ id: docSnap.id, ...docSnap.data() }));
            
            drivers.sort((a, b) => {
                const timeA = (a.createdAt && a.createdAt.seconds) ? a.createdAt.seconds : 0;
                const timeB = (b.createdAt && b.createdAt.seconds) ? b.createdAt.seconds : 0;
                return timeB - timeA;
            });

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

function fetchUserExpenses(driverId) {
    if (!driverId) return;
    if (unsubscribeExpenses) unsubscribeExpenses();
    
    try {
        const q = query(collection(db, "expenses"), where("userId", "==", currentUser.uid), where("driverId", "==", driverId));
        const tbody = document.getElementById('expenses-tbody');

        unsubscribeExpenses = onSnapshot(q, (snapshot) => {
            if (!tbody) return;
            tbody.innerHTML = ''; 
            if (snapshot.empty) {
                tbody.innerHTML = `<tr><td colspan="7" style="text-align: center; padding: 40px; color: var(--text-muted);">لا توجد عمليات مسجلة لهذا السائق.</td></tr>`;
                return;
            }

            let expensesArray = [];
            snapshot.forEach((docSnap) => expensesArray.push({ id: docSnap.id, ...docSnap.data() }));
            
            expensesArray.sort((a, b) => {
                const timeA = (a.createdAt && a.createdAt.seconds) ? a.createdAt.seconds : 0;
                const timeB = (b.createdAt && b.createdAt.seconds) ? b.createdAt.seconds : 0;
                return timeB - timeA;
            });

            expensesArray.forEach((data) => {
                const id = data.id;
                const receiptBadge = data.receiptUrl 
                    ? `<a href="${data.receiptUrl}" target="_blank" style="background-color: rgba(46,204,113,0.1); color: #2ecc71; padding: 6px 12px; border-radius: 6px; font-size: 12px; font-weight: 600; text-decoration: none; display: inline-block;"><i class="fa-solid fa-check"></i> الفاتورة</a>` 
                    : `<button class="btn-text upload-btn" data-id="${id}" style="color: var(--primary-accent); font-weight: bold;"><i class="fa-solid fa-upload"></i> إرفاق</button>`;
                    
                tbody.innerHTML += `
                    <tr id="exp-row-${id}" style="border-bottom: 1px solid var(--border-color); transition: background 0.2s;">
                        <td class="col-shop" style="padding: 16px; font-weight: 500;">${data.shopName || 'غير معروف'}</td>
                        <td class="col-date" style="padding: 16px; color: var(--text-muted); font-size: 14px;" dir="ltr">${data.date || '-'}</td>
                        <td class="col-amount" style="padding: 16px;" data-val="${data.amount || 0}">${data.amount || 0} ريال</td>
                        <td class="col-cashback" style="padding: 16px; color: var(--success);" data-val="${data.cashback || 0}">${data.cashback > 0 ? data.cashback + ' ريال' : '-'}</td>
                        <td class="col-status" style="padding: 16px;">
                            <span style="display:inline-block; width:8px; height:8px; border-radius:50%; margin-left:6px; background-color:${data.status === 'مكتملة' ? '#2ecc71' : '#d4af37'}"></span> 
                            ${data.status || 'معلقة'}
                        </td>
                        <td style="padding: 16px;">${receiptBadge}</td>
                        <td class="col-actions" style="padding: 16px; white-space: nowrap;">
                            <button class="btn-text edit-expense-btn" data-id="${id}" style="color: var(--primary-accent); font-size: 15px; background: rgba(59, 130, 246, 0.1); padding: 6px 10px; border-radius: 6px; margin-left: 5px;" title="تعديل"><i class="fa-solid fa-pen"></i></button>
                            <button class="btn-text delete-btn" data-id="${id}" style="color: var(--danger); font-size: 15px; background: rgba(231, 76, 60, 0.1); padding: 6px 10px; border-radius: 6px;" title="حذف"><i class="fa-solid fa-trash"></i></button>
                        </td>
                    </tr>
                `;
            });
        });
    } catch(err) {}
}

// ==========================================
// 5. صفحة إدارة السائقين
// ==========================================
let driversExpensesUnsub = null;

function renderDriversPage() {
    contentArea.innerHTML = `
        <div style="background-color: var(--bg-surface); border: 1px solid rgba(130, 130, 130, 0.3); border-radius: 12px; padding: 25px; margin-bottom: 25px; box-shadow: 0 4px 15px rgba(0,0,0,0.1);">
            <h3 id="form-title" style="font-size: 16px; font-weight: 600; margin-top: 0; margin-bottom: 15px;">إضافة سائق جديد</h3>
            <form id="add-driver-form" style="display: flex; gap: 15px; align-items: flex-end; flex-wrap: wrap;">
                <input type="hidden" id="edit-driver-id" value="">
                
                <div style="flex: 1; min-width: 150px;">
                    <label style="display: block; font-size: 13px; color: var(--text-muted); margin-bottom: 5px;">اسم السائق (إلزامي)</label>
                    <input type="text" id="driver-name" placeholder="أدخل الاسم" required style="width: 100%; padding: 10px 14px; background: var(--bg-base); border: 1px solid var(--border-color); border-radius: 8px; color: var(--text-primary); outline: none; box-sizing: border-box;">
                </div>
                
                <div style="flex: 1; min-width: 150px;">
                    <label style="display: block; font-size: 13px; color: var(--text-muted); margin-bottom: 5px;">السيارة</label>
                    <input type="text" id="driver-car" placeholder="مثال: كامري 2024" style="width: 100%; padding: 10px 14px; background: var(--bg-base); border: 1px solid var(--border-color); border-radius: 8px; color: var(--text-primary); outline: none; box-sizing: border-box;">
                </div>
                
                <div style="flex: 1; min-width: 150px; display: flex; flex-direction: column; gap: 5px;">
                    <label style="display: block; font-size: 13px; color: var(--text-muted); margin-bottom: 0px;">نوع البطاقة</label>
                    <div style="display: flex; gap: 5px; width: 100%;">
                        <select id="driver-card" style="flex: 1; padding: 10px 14px; background: var(--bg-base); border: 1px solid var(--border-color); border-radius: 8px; color: var(--text-primary); outline: none; box-sizing: border-box; appearance: auto;">
                            <option value="">اختر...</option>
                            <option value="مدى">مدى</option>
                            <option value="فيزا">فيزا</option>
                            <option value="ماستركارد">ماستركارد</option>
                            <option value="أخرى">أخرى (كتابة)</option>
                        </select>
                        <input type="text" id="driver-card-other" placeholder="اكتب نوع البطاقة..." style="display: none; flex: 1; padding: 10px 14px; background: var(--bg-base); border: 1px solid var(--border-color); border-radius: 8px; color: var(--text-primary); outline: none; box-sizing: border-box;">
                    </div>
                </div>
                
                <button type="submit" id="submit-driver-btn" class="btn-primary" style="flex: none; padding: 10px 25px; font-size: 14px; height: 42px; white-space: nowrap;"><i class="fa-solid fa-floppy-disk"></i> حفظ</button>
                <button type="button" id="cancel-edit-btn" style="display: none; background: transparent; border: 1px solid var(--border-color); color: var(--text-primary); padding: 10px 20px; border-radius: 8px; font-size: 14px; height: 42px; cursor: pointer;">إلغاء</button>
            </form>
        </div>

        <div class="table-container" style="background-color: var(--bg-surface); border: 1px solid rgba(130, 130, 130, 0.3); border-radius: 12px; overflow-x: auto; box-shadow: 0 4px 15px rgba(0,0,0,0.1);">
            <table class="saas-table" style="width: 100%; border-collapse: collapse; text-align: right;">
                <thead style="background-color: rgba(150, 150, 150, 0.05);">
                    <tr>
                        <th style="padding: 16px; border-bottom: 1px solid var(--border-color); color: var(--text-muted); font-size: 13px;">اسم السائق</th>
                        <th style="padding: 16px; border-bottom: 1px solid var(--border-color); color: var(--text-muted); font-size: 13px;">السيارة</th>
                        <th style="padding: 16px; border-bottom: 1px solid var(--border-color); color: var(--text-muted); font-size: 13px;">نوع البطاقة</th>
                        <th style="padding: 16px; border-bottom: 1px solid var(--border-color); color: var(--text-muted); font-size: 13px;">مجموع المصاريف</th>
                        <th style="padding: 16px; border-bottom: 1px solid var(--border-color); color: var(--text-muted); font-size: 13px; text-align: center; width: 80px;">تعديل</th>
                        <th style="padding: 16px; border-bottom: 1px solid var(--border-color); color: var(--text-muted); font-size: 13px; text-align: center; width: 80px;">حذف</th>
                    </tr>
                </thead>
                <tbody id="drivers-tbody">
                    <tr><td colspan="6" style="text-align: center; padding: 30px; color: var(--text-muted);">جاري جلب السائقين...</td></tr>
                </tbody>
            </table>
        </div>
    `;
}

function fetchDriversList() {
    const tbody = document.getElementById('drivers-tbody');
    if (!tbody) return;

    try {
        const q = query(collection(db, "drivers"), where("userId", "==", currentUser.uid));
        const expensesQ = query(collection(db, "expenses"), where("userId", "==", currentUser.uid));

        unsubscribeDrivers = onSnapshot(q, (driverSnapshot) => {
            if (window.driversExpensesUnsub) window.driversExpensesUnsub();
            
            window.driversExpensesUnsub = onSnapshot(expensesQ, (expenseSnapshot) => {
                tbody.innerHTML = '';
                
                if (driverSnapshot.empty) {
                    tbody.innerHTML = `<tr><td colspan="6" style="text-align: center; padding: 40px; color: var(--text-muted);">لا يوجد سائقين. قم بالإضافة بالأعلى.</td></tr>`;
                    return;
                }

                let expensesTotal = {};
                expenseSnapshot.forEach(expDoc => {
                    const exp = expDoc.data();
                    if (exp.driverId) expensesTotal[exp.driverId] = (expensesTotal[exp.driverId] || 0) + (Number(exp.amount) || 0);
                });

                let driversArray = [];
                driverSnapshot.forEach(docSnap => driversArray.push({ id: docSnap.id, ...docSnap.data() }));
                
                driversArray.sort((a, b) => {
                    const timeA = (a.createdAt && a.createdAt.seconds) ? a.createdAt.seconds : 0;
                    const timeB = (b.createdAt && b.createdAt.seconds) ? b.createdAt.seconds : 0;
                    return timeB - timeA;
                });

                driversArray.forEach((data) => {
                    const id = data.id;
                    const total = expensesTotal[id] || 0;
                    
                    tbody.innerHTML += `
                        <tr style="border-bottom: 1px solid var(--border-color); transition: background 0.2s;">
                            <td style="padding: 16px; font-weight: 500;">${data.name}</td>
                            <td style="padding: 16px; color: var(--text-muted);">${data.car || '-'}</td>
                            <td style="padding: 16px; color: var(--text-muted);">${data.cardType || '-'}</td>
                            <td style="padding: 16px; color: var(--danger); font-weight: bold;">${total} ريال</td>
                            <td style="padding: 16px; text-align: center;">
                                <button class="btn-text edit-driver-btn" data-id="${id}" data-name="${data.name}" data-car="${data.car || ''}" data-card="${data.cardType || ''}" style="color: var(--primary-accent); font-size: 15px; background: rgba(59, 130, 246, 0.1); padding: 6px 12px; border-radius: 6px;" title="تعديل"><i class="fa-solid fa-pen-to-square"></i></button>
                            </td>
                            <td style="padding: 16px; text-align: center;">
                                <button class="btn-text delete-driver-btn" data-id="${id}" style="color: var(--danger); font-size: 14px; background: rgba(231, 76, 60, 0.1); padding: 6px 12px; border-radius: 6px; font-weight: bold; transition: all 0.2s;" title="حذف"><i class="fa-solid fa-trash"></i></button>
                            </td>
                        </tr>
                    `;
                });
            });
        });
    } catch (error) {
        tbody.innerHTML = `<tr><td colspan="6" style="text-align: center; color: var(--danger); padding: 20px;">حدث خطأ في قراءة البيانات.</td></tr>`;
    }
}
// ==========================================
// 6. صفحة الإعدادات
// ==========================================
function renderSettingsPage() {
    document.getElementById('page-title').textContent = "إعدادات الحساب";
    const currentName = document.getElementById('user-name').textContent;
    const currentEmail = currentUser && currentUser.email ? currentUser.email : '';
    
    contentArea.innerHTML = `
        <div style="background-color: var(--bg-surface); border: 1px solid rgba(130, 130, 130, 0.3); border-radius: 12px; padding: 35px; margin: 0 auto; max-width: 650px; box-shadow: 0 4px 15px rgba(0,0,0,0.1);">
            <h3 style="font-size: 20px; font-weight: 700; margin-top: 0; margin-bottom: 25px; color: var(--primary-accent); border-bottom: 1px solid rgba(130,130,130,0.2); padding-bottom: 10px;">المعلومات الشخصية</h3>

            <form id="settings-form" style="display: flex; flex-direction: column; gap: 20px;">
                <div style="display: flex; align-items: center; gap: 15px; flex-wrap: wrap;">
                    <label style="width: 120px; font-size: 15px; font-weight: 600; color: var(--text-primary);">الاسم:</label>
                    <input type="text" id="settings-name-input" value="${currentName === '...' ? '' : currentName}" required autocomplete="off" style="flex: 1; min-width: 250px; padding: 12px 15px; background: var(--bg-base); border: 1px solid rgba(130,130,130,0.3); border-radius: 8px; color: var(--text-primary); outline: none;">
                </div>
                
                <div style="display: flex; align-items: center; gap: 15px; flex-wrap: wrap;">
                    <label style="width: 120px; font-size: 15px; font-weight: 600; color: var(--text-primary);">الإيميل:</label>
                    <input type="email" id="settings-email-input" value="${currentEmail}" required autocomplete="off" style="flex: 1; min-width: 250px; padding: 12px 15px; background: var(--bg-base); border: 1px solid rgba(130,130,130,0.3); border-radius: 8px; color: var(--text-primary); outline: none;">
                </div>
                
                <div style="display: flex; align-items: center; gap: 15px; flex-wrap: wrap;">
                    <label style="width: 120px; font-size: 15px; font-weight: 600; color: var(--text-primary);">الرقم السري:</label>
                    <input type="password" id="settings-password-input" placeholder="******** (للتغيير اكتب هنا)" autocomplete="new-password" style="flex: 1; min-width: 250px; padding: 12px 15px; background: var(--bg-base); border: 1px solid rgba(130,130,130,0.3); border-radius: 8px; color: var(--text-primary); outline: none;">
                </div>

                <div style="display: flex; gap: 15px; margin-top: 15px; justify-content: center;">
                    <button type="button" id="cancel-settings-btn" style="background: transparent; border: 1px solid var(--border-color); color: var(--text-primary); padding: 10px 40px; border-radius: 8px; font-size: 15px; font-weight: 600; cursor: pointer; transition: 0.2s;">إلغاء</button>
                    <button type="submit" id="save-settings-btn" class="btn-primary" style="padding: 10px 50px; font-size: 15px; font-weight: 600; transition: 0.2s;">حفظ</button>
                </div>
            </form>

            <div id="otp-verification-section" style="display: none; text-align: center; padding: 20px;">
                <i class="fa-solid fa-envelope-circle-check fa-3x" style="color: var(--primary-accent); margin-bottom: 15px;"></i>
                <h4 style="font-size: 18px; margin-bottom: 10px;">تحقق من الإيميل الجديد</h4>
                <p style="color: var(--text-muted); margin-bottom: 20px; font-size: 14px;">أرسلنا رمز تحقق مكون من 6 أرقام إلى إيميلك. <br>(للتجربة حالياً اكتب: 123456)</p>
                <input type="text" id="otp-input" placeholder="------" maxlength="6" style="text-align: center; letter-spacing: 15px; font-size: 24px; font-weight: bold; padding: 15px; width: 220px; margin: 0 auto 25px auto; display: block; background: var(--bg-base); border: 1px solid rgba(130,130,130,0.5); border-radius: 8px; color: var(--text-primary); outline: none;">
                <div style="display: flex; gap: 10px; justify-content: center;">
                    <button type="button" id="cancel-otp-btn" style="background: transparent; border: 1px solid var(--border-color); color: var(--text-primary); padding: 10px 30px; border-radius: 8px; cursor: pointer; font-weight: 600;">تراجع</button>
                    <button type="button" id="confirm-otp-btn" class="btn-primary" style="padding: 10px 40px; font-weight: 600;">تأكيد الرمز</button>
                </div>
            </div>
        </div>
    `;
}

// ==========================================
// 7. صفحة التحليلات (وإنشاء PDF) - التحديث الجذري
// ==========================================
let barChartInstance = null;
let pieChartInstance = null;
let lineChartInstance = null;
let activeAnalyticsDriverId = null;
let activeTimeRange = '1m'; 
let globalDriversList = []; // نحفظ السواقين هنا عشان نستخدمهم في رسم خطوط المقارنة

function renderAnalyticsPage() {
    contentArea.innerHTML = `
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px;">
            <div id="analytics-driver-tabs" style="display: flex; gap: 10px; overflow-x: auto; padding-bottom: 5px;">
                <span style="color: var(--text-muted); font-size: 13px;">جاري تحميل السائقين...</span>
            </div>
            <!-- زر إنشاء التقرير PDF -->
            <button id="export-pdf-btn" class="btn-primary" style="flex: none; background-color: #e74c3c; border-color: #e74c3c; font-size: 13px; padding: 8px 15px; border-radius: 8px;">
                <i class="fa-solid fa-file-pdf"></i> إنشاء تقرير PDF
            </button>
        </div>

        <div id="time-filters-container" style="display: flex; gap: 10px; margin-bottom: 25px; justify-content: center; flex-wrap: wrap; background: var(--bg-surface); padding: 10px; border-radius: 12px; border: 1px solid rgba(130, 130, 130, 0.2);">
            <button class="time-filter-btn active" data-range="1m" style="padding: 6px 16px; border-radius: 20px; border: none; background: var(--primary-accent); color: white; cursor: pointer;">شهر</button>
            <button class="time-filter-btn" data-range="3m" style="padding: 6px 16px; border-radius: 20px; border: none; background: transparent; color: var(--text-primary); cursor: pointer;">3 أشهر</button>
            <button class="time-filter-btn" data-range="6m" style="padding: 6px 16px; border-radius: 20px; border: none; background: transparent; color: var(--text-primary); cursor: pointer;">6 أشهر</button>
            <button class="time-filter-btn" data-range="1y" style="padding: 6px 16px; border-radius: 20px; border: none; background: transparent; color: var(--text-primary); cursor: pointer;">سنة</button>
            <button class="time-filter-btn" data-range="all" style="padding: 6px 16px; border-radius: 20px; border: none; background: transparent; color: var(--text-primary); cursor: pointer;">كل الأوقات</button>
        </div>

        <!-- المنطقة التي سيتم تحويلها لـ PDF -->
        <div id="pdf-export-area" style="background: var(--bg-base); padding: 15px; border-radius: 12px;">
            
            <!-- الصف الأول: الكروت الأساسية (2 فقط) -->
            <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(250px, 1fr)); gap: 15px; margin-bottom: 25px;">
                <div style="background-color: var(--bg-surface); padding: 25px; border-radius: 12px; border: 1px solid rgba(130, 130, 130, 0.3); box-shadow: 0 4px 15px rgba(0,0,0,0.05); text-align: center;">
                    <div style="color: var(--text-muted); font-size: 15px; margin-bottom: 10px;"><i class="fa-solid fa-money-bill-wave"></i> إجمالي الصرفية</div>
                    <div id="stat-total-amt" style="font-size: 32px; font-weight: bold; color: var(--danger);">0 ريال</div>
                </div>
                <div style="background-color: var(--bg-surface); padding: 25px; border-radius: 12px; border: 1px solid rgba(130, 130, 130, 0.3); box-shadow: 0 4px 15px rgba(0,0,0,0.05); text-align: center;">
                    <div style="color: var(--text-muted); font-size: 15px; margin-bottom: 10px;"><i class="fa-solid fa-hand-holding-dollar"></i> كاش باك مسترجع</div>
                    <div id="stat-total-cb" style="font-size: 32px; font-weight: bold; color: #2ecc71;">0 ريال</div>
                </div>
            </div>

            <!-- الصف الثاني: البار جراف (اليسار) والباى شارت (اليمين) -->
            <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 15px; margin-bottom: 25px;">
                <!-- رسم الأعمدة -->
                <div style="background-color: var(--bg-surface); padding: 25px; border-radius: 12px; border: 1px solid rgba(130, 130, 130, 0.3); box-shadow: 0 4px 15px rgba(0,0,0,0.05); flex: 2;">
                    <h3 style="font-size: 16px; font-weight: 600; margin-top: 0; margin-bottom: 20px;">أكثر مبالغ تم صرفها (أعلى 10 محلات)</h3>
                    <div style="position: relative; height: 300px; width: 100%;">
                        <canvas id="barChart"></canvas>
                    </div>
                </div>
                <!-- رسم الدائرة -->
                <div style="background-color: var(--bg-surface); padding: 25px; border-radius: 12px; border: 1px solid rgba(130, 130, 130, 0.3); box-shadow: 0 4px 15px rgba(0,0,0,0.05); flex: 1;">
                    <h3 style="font-size: 16px; font-weight: 600; margin-top: 0; margin-bottom: 20px;">توزيع المصاريف (النسب المئوية)</h3>
                    <div style="position: relative; height: 300px; width: 100%;">
                        <canvas id="pieChart"></canvas>
                    </div>
                </div>
            </div>

            <!-- الصف الثالث: الرسم الخطي لمقارنة كل السواقين -->
            <div style="background-color: var(--bg-surface); padding: 25px; border-radius: 12px; border: 1px solid rgba(130, 130, 130, 0.3); box-shadow: 0 4px 15px rgba(0,0,0,0.05);">
                <h3 style="font-size: 16px; font-weight: 600; margin-top: 0; margin-bottom: 20px;">مقارنة صرف السائقين عبر الزمن</h3>
                <div style="position: relative; height: 350px; width: 100%;">
                    <canvas id="lineChart"></canvas>
                </div>
            </div>
        </div>
    `;
}

window.fetchAnalyticsData = function() {
    try {
        const q = query(collection(db, "drivers"), where("userId", "==", currentUser.uid));
        if (window.unsubAnalyticsDrivers) window.unsubAnalyticsDrivers();
        
        window.unsubAnalyticsDrivers = onSnapshot(q, (snapshot) => {
            const tabsContainer = document.getElementById('analytics-driver-tabs');
            if (!tabsContainer) return;
            tabsContainer.innerHTML = '';
            
            globalDriversList = []; 
            snapshot.forEach(docSnap => globalDriversList.push({ id: docSnap.id, ...docSnap.data() }));

            if (globalDriversList.length === 0) {
                tabsContainer.innerHTML = `<span style="color: var(--text-muted); font-size: 13px;">لا يوجد سائقين.</span>`;
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

function processDriverAnalytics() {
    if (globalDriversList.length === 0) return;
    
    try {
        const q = query(collection(db, "expenses"), where("userId", "==", currentUser.uid));
        if (window.unsubAnalyticsExpenses) window.unsubAnalyticsExpenses();

        window.unsubAnalyticsExpenses = onSnapshot(q, (snapshot) => {
            let allExpenses = [];
            snapshot.forEach(doc => allExpenses.push(doc.data()));

            let startDate = new Date();
            if (activeTimeRange === '1m') startDate.setMonth(startDate.getMonth() - 1);
            else if (activeTimeRange === '3m') startDate.setMonth(startDate.getMonth() - 3);
            else if (activeTimeRange === '6m') startDate.setMonth(startDate.getMonth() - 6);
            else if (activeTimeRange === '1y') startDate.setFullYear(startDate.getFullYear() - 1);
            else if (activeTimeRange === 'all') startDate = new Date('2000-01-01');

            let startDateStr = startDate.toISOString().split('T')[0];
            let timeFilteredExp = allExpenses.filter(exp => exp.date && exp.date >= startDateStr);

            let activeDriverExp = timeFilteredExp.filter(exp => exp.driverId === activeAnalyticsDriverId);
            
            let totalAmt = 0, totalCb = 0;
            let shopTotals = {};

            activeDriverExp.forEach(exp => {
                let amt = Number(exp.amount) || 0;
                let cb = Number(exp.cashback) || 0;
                let shop = exp.shopName || 'غير معروف';

                totalAmt += amt;
                totalCb += cb;
                shopTotals[shop] = (shopTotals[shop] || 0) + amt;
            });

            const elAmt = document.getElementById('stat-total-amt');
            if(elAmt) {
                elAmt.textContent = totalAmt + ' ريال';
                document.getElementById('stat-total-cb').textContent = totalCb + ' ريال';
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
                let date = exp.date;
                let groupKey = date;

                if (activeTimeRange === '3m' || activeTimeRange === '6m') {
                    let d = new Date(date);
                    d.setDate(d.getDate() - d.getDay()); 
                    groupKey = d.toISOString().split('T')[0] + ' (أسبوع)';
                } else if (activeTimeRange === '1y' || activeTimeRange === 'all') {
                    groupKey = date.substring(0, 7) + ' (شهر)'; 
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
                        label: 'المبلغ (ريال)',
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
                                    return ` ${label}: ${value} ريال (${percentage}%)`;
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
    if (e.target && e.target.id === 'driver-card') {
        const otherInput = document.getElementById('driver-card-other');
        if (e.target.value === 'أخرى') {
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
        const name = document.getElementById('driver-name').value.trim();
        const car = document.getElementById('driver-car').value.trim();
        const editId = document.getElementById('edit-driver-id').value;
        let card = document.getElementById('driver-card').value;
        if (card === 'أخرى') card = document.getElementById('driver-card-other').value.trim();
        if (!name) return;

        const submitBtn = document.getElementById('submit-driver-btn');
        const originalText = submitBtn.innerHTML;
        submitBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';

    try {
            if (editId) {
                await updateDoc(doc(db, "drivers", editId), { name: name, car: car || "", cardType: card || "" });
                document.getElementById('form-title').textContent = "إضافة سائق جديد";
                document.getElementById('cancel-edit-btn').style.display = 'none';
                submitBtn.innerHTML = 'تم التحديث ✔';
                submitBtn.style.background = '#2ecc71';
                submitBtn.style.borderColor = '#2ecc71';
            } else {
                await addDoc(collection(db, "drivers"), { userId: currentUser.uid, name: name, car: car || "", cardType: card || "", createdAt: serverTimestamp() });
                submitBtn.innerHTML = 'تمت الإضافة ✔';
                submitBtn.style.background = '#2ecc71';
                submitBtn.style.borderColor = '#2ecc71';
            }
            
            e.target.reset();
            document.getElementById('edit-driver-id').value = "";
            
            // إرجاع الزر لشكله ولونه الطبيعي بعد ثانيتين
            setTimeout(() => {
                submitBtn.innerHTML = '<i class="fa-solid fa-floppy-disk"></i> حفظ';
                submitBtn.style.background = '';
                submitBtn.style.borderColor = '';
            }, 2000);
            
        } catch (error) { 
            submitBtn.innerHTML = 'حدث خطأ ❌';
            submitBtn.style.background = 'var(--danger)';
            submitBtn.style.borderColor = 'var(--danger)';
            setTimeout(() => {
                submitBtn.innerHTML = originalText;
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
        
        if (!newName || !newEmail) return;
        const currentEmail = currentUser && currentUser.email ? currentUser.email : '';
        
        if (newEmail !== currentEmail && currentEmail !== '') {
            document.getElementById('settings-form').style.display = 'none';
            document.getElementById('otp-verification-section').style.display = 'block';
            const section = document.getElementById('otp-verification-section');
            section.dataset.newName = newName;
            section.dataset.newEmail = newEmail;
            section.dataset.newPassword = newPassword; 
        } else {
            const saveBtn = document.getElementById('save-settings-btn');
            const originalText = saveBtn.innerHTML;
            saveBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';
            
            try {
                if (auth.currentUser) {
                    await updateProfile(auth.currentUser, { displayName: newName });
                    if (newPassword) await updatePassword(auth.currentUser, newPassword);
                }
                document.getElementById('user-name').textContent = newName;
                saveBtn.innerHTML = 'تم الحفظ ✔';
                saveBtn.style.background = '#2ecc71';
                document.getElementById('settings-password-input').value = ''; 
                setTimeout(() => { saveBtn.innerHTML = originalText; saveBtn.style.background = ''; }, 2000);
            } catch (error) {
                Swal.fire({icon: 'error', title: 'تحذير أمني', text: 'لتغيير الرقم السري، يرجى تسجيل الخروج والدخول مجدداً لتأكيد هويتك.'});
                saveBtn.innerHTML = originalText;
            }
        }
    }
});

document.addEventListener('click', async (e) => {
    // === زر التعديل في جدول العمليات (يحول النص لمربع إدخال) ===
    const editExpBtn = e.target.closest('.edit-expense-btn');
    if (editExpBtn) {
        const id = editExpBtn.getAttribute('data-id');
        const row = document.getElementById(`exp-row-${id}`);
        if (!row) return;

        const shop = row.querySelector('.col-shop').innerText;
        const date = row.querySelector('.col-date').innerText;
        const amount = row.querySelector('.col-amount').getAttribute('data-val');
        const cashback = row.querySelector('.col-cashback').getAttribute('data-val');

        // ستايل موحد لمربعات الإدخال
        const inputStyle = "width: 100%; min-width: 80px; padding: 6px; border-radius: 6px; border: 1px solid var(--border-color); background: var(--bg-base); color: var(--text-primary); outline: none; font-family: inherit;";

        row.querySelector('.col-shop').innerHTML = `<input type="text" class="edit-in-shop" value="${shop}" style="${inputStyle}">`;
        row.querySelector('.col-date').innerHTML = `<input type="date" class="edit-in-date" value="${date}" style="${inputStyle}">`;
        row.querySelector('.col-amount').innerHTML = `<input type="number" class="edit-in-amount" value="${amount}" style="${inputStyle}">`;
        row.querySelector('.col-cashback').innerHTML = `<input type="number" class="edit-in-cashback" value="${cashback}" style="${inputStyle}">`;
        
        row.querySelector('.col-actions').innerHTML = `
            <button class="btn-text save-expense-btn" data-id="${id}" style="color: white; font-size: 13px; background: #2ecc71; padding: 6px 12px; border-radius: 6px; margin-left: 5px; font-weight: bold;">حفظ</button>
            <button class="btn-text cancel-expense-btn" style="color: var(--text-primary); font-size: 13px; background: rgba(130,130,130,0.2); padding: 6px 12px; border-radius: 6px; font-weight: bold;">إلغاء</button>
        `;
        return;
    }

    // === زر إلغاء تعديل العملية ===
    if (e.target.closest('.cancel-expense-btn')) {
        fetchUserExpenses(activeDriverId); // إعادة جلب البيانات تلغي التعديل بسهولة
        return;
    }

    // === زر حفظ تعديل العملية ===
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
            // قاعدة البيانات (onSnapshot) بتحدث الجدول تلقائياً بشكل أنيق
        } catch (err) {
            saveExpBtn.innerHTML = 'خطأ!';
            saveExpBtn.style.background = 'var(--danger)';
            setTimeout(() => fetchUserExpenses(activeDriverId), 2000);
        }
        return;
    }
// ==========================================
    // 1. زر إنشاء تقرير PDF (احترافي، ألوان واضحة، وصياغة مالية)
    // ==========================================
    if (e.target.closest('#export-pdf-btn')) {
        const btn = e.target.closest('#export-pdf-btn');
        const originalText = btn.innerHTML;
        btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> جاري إصدار التقرير...';
        
        const totalAmt = document.getElementById('stat-total-amt').innerText;
        const totalCb = document.getElementById('stat-total-cb').innerText;
        const currentDate = new Date().toLocaleDateString('ar-SA');
        const isEnglish = document.documentElement.lang === 'en';

        // 1. حفظ ألوان الشارت الأصلية (عشان نرجعها بعدين)
        const originalColor = Chart.defaults.color;
        
        // 2. إجبار الشارت على اللون الأسود الداكن عشان يوضح في الـ PDF
        Chart.defaults.color = '#1e293b';
        if (barChartInstance) { 
            barChartInstance.options.scales.x.ticks.color = '#1e293b'; 
            barChartInstance.options.scales.y.ticks.color = '#1e293b'; 
            barChartInstance.update(); 
        }
        if (pieChartInstance) { 
            pieChartInstance.options.plugins.legend.display = true; // إظهار الأسماء المفقودة
            pieChartInstance.options.plugins.legend.position = 'bottom';
            pieChartInstance.options.plugins.legend.labels.color = '#1e293b'; 
            pieChartInstance.update(); 
        }
        if (lineChartInstance) { 
            lineChartInstance.options.scales.x.ticks.color = '#1e293b'; 
            lineChartInstance.options.scales.y.ticks.color = '#1e293b'; 
            lineChartInstance.options.plugins.legend.labels.color = '#1e293b'; 
            lineChartInstance.update(); 
        }

        // نعطي الشارت نص ثانية عشان يتحدث لونه للأسود، ثم نصوره
        setTimeout(() => {
            // دالة سرية تصور الشارت بخلفية بيضاء إجبارية عشان ما تطلع الأرقام شفافة
            const getChartImage = (chart) => {
                if (!chart) return '';
                const canvas = chart.canvas;
                const tempCanvas = document.createElement('canvas');
                tempCanvas.width = canvas.width; tempCanvas.height = canvas.height;
                const tempCtx = tempCanvas.getContext('2d');
                tempCtx.fillStyle = '#ffffff'; // خلفية بيضاء
                tempCtx.fillRect(0, 0, tempCanvas.width, tempCanvas.height);
                tempCtx.drawImage(canvas, 0, 0);
                return tempCanvas.toDataURL('image/jpeg', 1.0);
            };

            const barImg = getChartImage(barChartInstance);
            const pieImg = getChartImage(pieChartInstance);
            const lineImg = getChartImage(lineChartInstance);

            // 3. إرجاع الألوان للوضع الليلي في الموقع بعد التصوير
            Chart.defaults.color = originalColor;
            const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
            const restoreColor = isDark ? '#e2e8f0' : '#1e293b';
            if (barChartInstance) { barChartInstance.options.scales.x.ticks.color = restoreColor; barChartInstance.options.scales.y.ticks.color = restoreColor; barChartInstance.update(); }
            if (pieChartInstance) { pieChartInstance.options.plugins.legend.labels.color = restoreColor; pieChartInstance.update(); }
            if (lineChartInstance) { lineChartInstance.options.scales.x.ticks.color = restoreColor; lineChartInstance.options.scales.y.ticks.color = restoreColor; lineChartInstance.options.plugins.legend.labels.color = restoreColor; lineChartInstance.update(); }

            // 4. صياغة مالية احترافية بدون خرابيط الـ AI
            const titleStr = isEnglish ? 'Financial Expenses Report' : 'تقرير المصروفات المالي';
            const dateStr = isEnglish ? 'Date:' : 'تاريخ التقرير:';
            const totalExpStr = isEnglish ? 'Total Expenses' : 'إجمالي المصروفات';
            const totalCbStr = isEnglish ? 'Total Cashback' : 'الاسترداد النقدي (Cashback)';
            const top10Str = isEnglish ? 'Highest Spending Categories' : 'أعلى المتاجر صرفاً';
            const distStr = isEnglish ? 'Expenses Distribution' : 'التوزيع النسبي للمصروفات';
            const lineStr = isEnglish ? 'Spending Trends' : 'المؤشر الزمني للمصروفات';

            const pdfTemplate = document.createElement('div');
            pdfTemplate.innerHTML = `
                <div style="font-family: Arial, sans-serif; width: 100%; direction: ${isEnglish ? 'ltr' : 'rtl'}; background: #ffffff; color: #000000;">
                    
                    <!-- الصفحة الأولى -->
                    <div style="padding: 40px; page-break-after: always;">
                        <div style="border-bottom: 3px solid #1e3a8a; padding-bottom: 10px; margin-bottom: 30px; display: flex; justify-content: space-between; align-items: flex-end;">
                            <div>
                                <h1 style="color: #1e3a8a; margin: 0; font-size: 28px; font-weight: bold;">${titleStr}</h1>
                                <p style="margin: 5px 0 0 0; font-size: 14px; color: #475569;">${isEnglish ? 'Driver Expense Tracking System' : 'نظام إدارة مصاريف السائقين'}</p>
                            </div>
                            <div style="text-align: ${isEnglish ? 'right' : 'left'};">
                                <p style="margin: 0; font-size: 14px; color: #000000; font-weight: bold;">${dateStr} ${currentDate}</p>
                            </div>
                        </div>

                        <div style="display: flex; justify-content: space-between; margin-bottom: 40px; gap: 20px;">
                            <div style="background: #f1f5f9; padding: 25px; border-radius: 8px; flex: 1; border-right: ${isEnglish ? '0' : '5px solid #e74c3c'}; border-left: ${isEnglish ? '5px solid #e74c3c' : '0'}; text-align: center;">
                                <h3 style="margin: 0 0 10px 0; color: #334155; font-size: 18px;">${totalExpStr}</h3>
                                <div style="font-size: 28px; font-weight: bold; color: #b91c1c;">${totalAmt}</div>
                            </div>
                            <div style="background: #f1f5f9; padding: 25px; border-radius: 8px; flex: 1; border-right: ${isEnglish ? '0' : '5px solid #2ecc71'}; border-left: ${isEnglish ? '5px solid #2ecc71' : '0'}; text-align: center;">
                                <h3 style="margin: 0 0 10px 0; color: #334155; font-size: 18px;">${totalCbStr}</h3>
                                <div style="font-size: 28px; font-weight: bold; color: #15803d;">${totalCb}</div>
                            </div>
                        </div>

                        <div style="text-align: center; margin-top: 30px;">
                            <h2 style="color: #1e3a8a; margin-bottom: 20px; font-size: 20px;">${top10Str}</h2>
                            <img src="${barImg}" style="width: 100%; max-height: 450px; object-fit: contain;">
                        </div>
                    </div>
                    
                    <!-- الصفحة الثانية -->
                    <div style="padding: 40px; page-break-after: always;">
                        <div style="text-align: center;">
                            <h2 style="color: #1e3a8a; margin-bottom: 20px; font-size: 20px;">${distStr}</h2>
                            <img src="${pieImg}" style="width: 100%; max-height: 500px; object-fit: contain;">
                        </div>
                    </div>

                    <!-- الصفحة الثالثة -->
                    <div style="padding: 40px;">
                        <div style="text-align: center;">
                            <h2 style="color: #1e3a8a; margin-bottom: 20px; font-size: 20px;">${lineStr}</h2>
                            <img src="${lineImg}" style="width: 100%; max-height: 500px; object-fit: contain;">
                        </div>
                    </div>
                </div>
            `;

            const opt = {
                margin:       [10, 0, 15, 0],
                filename:     isEnglish ? 'Financial_Report.pdf' : 'تقرير_المصاريف.pdf',
                image:        { type: 'jpeg', quality: 1 },
                html2canvas:  { 
                scale: 2, 
                useCORS: true,
                windowWidth: 1024 // هذا السطر اللي بيوهم الجوال إنه شاشة كمبيوتر عريضة
                },
                jsPDF:        { unit: 'mm', format: 'a4', orientation: 'portrait' },
                pagebreak:    { mode: ['avoid-all', 'css', 'legacy'] } // وهذا السطر اللي بيمنع قص الرسومات بالنص
                };

            html2pdf().set(opt).from(pdfTemplate).toPdf().get('pdf').then(function (pdf) {
                const totalPages = pdf.internal.getNumberOfPages();
                for (let i = 1; i <= totalPages; i++) {
                    pdf.setPage(i);
                    pdf.setFontSize(10);
                    pdf.setTextColor(100);
                    const pageWidth = pdf.internal.pageSize.getWidth();
                    const pageHeight = pdf.internal.pageSize.getHeight();
                    pdf.text(String(i) + ' / ' + String(totalPages), pageWidth / 2, pageHeight - 10, { align: 'center' });
                }
            }).save().then(() => {
                btn.innerHTML = originalText;
            }).catch(err => {
                console.error(err);
                btn.innerHTML = originalText;
            });
        }, 500);
        return;
    }

// ==========================================
    // 2. زر تغيير اللغة (English / العربية)
    // ==========================================
    const langBtn = e.target.closest('#lang-toggle');
    if (langBtn) {
        const currentLang = document.documentElement.lang;
        const isAr = currentLang === 'ar';

        if (isAr) {
            document.documentElement.lang = 'en'; 
            document.documentElement.dir = 'ltr'; 
            langBtn.textContent = 'ع'; 
            localStorage.setItem('site_lang', 'en');
            
            document.querySelectorAll('.nav-item').forEach(el => {
                if(el.innerHTML.includes('العمليات')) el.innerHTML = '<i class="fa-solid fa-receipt"></i> Operations';
                if(el.innerHTML.includes('التحليلات')) el.innerHTML = '<i class="fa-solid fa-chart-line"></i> Analytics';
                if(el.innerHTML.includes('السائقين')) el.innerHTML = '<i class="fa-solid fa-users"></i> Drivers';
            });
            document.getElementById('logout-btn').textContent = 'Logout';
        } else {
            document.documentElement.lang = 'ar'; 
            document.documentElement.dir = 'rtl'; 
            langBtn.textContent = 'EN'; 
            localStorage.setItem('site_lang', 'ar');
            
            document.querySelectorAll('.nav-item').forEach(el => {
                if(el.innerHTML.includes('Operations')) el.innerHTML = '<i class="fa-solid fa-receipt"></i> العمليات';
                if(el.innerHTML.includes('Analytics')) el.innerHTML = '<i class="fa-solid fa-chart-line"></i> التحليلات';
                if(el.innerHTML.includes('Drivers')) el.innerHTML = '<i class="fa-solid fa-users"></i> السائقين';
            });
            document.getElementById('logout-btn').textContent = 'تسجيل خروج';
        }
        
        const activeNav = document.querySelector('.nav-item.active').getAttribute('data-target');
        if(activeNav === 'manage') { document.querySelector('[data-target="manage"]').click(); }
        else if(activeNav === 'analytics') { document.querySelector('[data-target="analytics"]').click(); }
        else if(activeNav === 'drivers') { document.querySelector('[data-target="drivers"]').click(); }
        
        return;
    }

    // 3. التنقل بالتحليلات
    const analyticsTabBtn = e.target.closest('.analytics-driver-tab-btn');
    if (analyticsTabBtn) {
        activeAnalyticsDriverId = analyticsTabBtn.getAttribute('data-id');
        window.fetchAnalyticsData(); 
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

        document.getElementById('form-title').textContent = "تعديل بيانات السائق";
        document.getElementById('submit-driver-btn').innerHTML = '<i class="fa-solid fa-pen-to-square"></i> تحديث';
        document.getElementById('cancel-edit-btn').style.display = 'inline-block';
        window.scrollTo({ top: 0, behavior: 'smooth' });
        return;
    }

    const cancelEditBtn = e.target.closest('#cancel-edit-btn');
    if (cancelEditBtn) {
        document.getElementById('add-driver-form').reset();
        document.getElementById('driver-card-other').style.display = 'none';
        document.getElementById('edit-driver-id').value = "";
        document.getElementById('form-title').textContent = "إضافة سائق جديد";
        document.getElementById('submit-driver-btn').innerHTML = '<i class="fa-solid fa-floppy-disk"></i> حفظ';
        cancelEditBtn.style.display = 'none';
        return;
    }

    // 5. الحذف (مع Try Catch)
    const deleteBtn = e.target.closest('.delete-btn');
    if (deleteBtn) {
        const id = deleteBtn.getAttribute('data-id');
        if (!deleteBtn.classList.contains('confirming-delete')) {
            const originalHtml = deleteBtn.innerHTML;
            deleteBtn.innerHTML = 'متأكد؟';
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
            catch (err) { Swal.fire({icon: 'error', title: 'خطأ', text: 'لم يتم الحذف.'}); }
        }
        return;
    }

    const deleteDriverBtn = e.target.closest('.delete-driver-btn');
    if (deleteDriverBtn) {
        const id = deleteDriverBtn.getAttribute('data-id');
        if (!deleteDriverBtn.classList.contains('confirming-delete')) {
            const originalHtml = deleteDriverBtn.innerHTML;
            deleteDriverBtn.innerHTML = 'متأكد؟';
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
            catch (err) { Swal.fire({icon: 'error', title: 'خطأ', text: 'لم يتم الحذف.'}); }
        }
        return;
    }
});
