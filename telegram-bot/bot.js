require('dotenv').config();
const { Telegraf, Markup } = require('telegraf'); 
const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const express = require('express');
const path = require('path');
const crypto = require('crypto');

class DatabaseConfig {
    static init() {
        let serviceAccount;
        try { serviceAccount = require('/etc/secrets/serviceAccountKey.json'); } 
        catch (error) { serviceAccount = require('./serviceAccountKey.json'); }
        initializeApp({ credential: cert(serviceAccount) });
        return getFirestore();
    }
}
const db = DatabaseConfig.init();

function normalizeCurrency(c) {
    const s = String(c || '').toUpperCase();
    if (s === 'ريال' || s === 'SAR' || s === 'SR' || s === 'ر.س' || s === 'ر. س') return 'SAR';
    if (s === 'دولار' || s === 'USD' || s === '$' || s === 'US$') return 'USD';
    if (s === 'درهم' || s === 'AED') return 'AED';
    if (s === 'دينار' || s === 'KWD') return 'KWD';
    return s;
}

const AMOUNT_NUM = '([\\d,]+(?:[.]\\d{1,2})?)';
const AMOUNT_CUR = '(SAR|SR|USD|AED|KWD|BHD|QAR|OMR|EUR|GBP|ريال|دولار|درهم|دينار|ر[.]\\s?س|\\$|€|£)';

// استخراج المبلغ مع العملة - يدعم الترتيبين: "مبلغ 80.00 SAR" و "بـSAR 71" و "بـSR 30" و "مبلغ: 9.66 ريال"
function parseAmountFromLine(line) {
    if (!line) return null;
    const m1 = line.match(new RegExp(`(?:مبلغ|المبلغ|بمبلغ|بمقدار|قيمة|amount|of|بـ|ب)\\s*[:،؛]?\\s*${AMOUNT_NUM}\\s*${AMOUNT_CUR}`, 'i'));
    if (m1) {
        const amount = parseFloat(m1[1].replace(/,/g, ''));
        if (!isNaN(amount) && amount > 0) return { amount, currency: normalizeCurrency(m1[2]) };
    }
    const m2 = line.match(new RegExp(`(?:مبلغ|المبلغ|بمبلغ|بمقدار|قيمة|amount|of|بـ|ب)\\s*[:،؛]?\\s*${AMOUNT_CUR}\\s*${AMOUNT_NUM}`, 'i'));
    if (m2) {
        const amount = parseFloat(m2[2].replace(/,/g, ''));
        if (!isNaN(amount) && amount > 0) return { amount, currency: normalizeCurrency(m2[1]) };
    }
    return null;
}

const TYPE_RULES = [
    { type: 'cashback',  re: /(استرجاع نقدي|استرداد نقدي|استرداد|مسترد|كاش باك|refund|reversal|مكافأة نقدية|مكافأة|إلغاء عملية|credit back|cashback|cash back|reward)/i },
    { type: 'withdrawal', re: /(سحب نقدي|سحب|withdrawal|withdraw|cash out)/i },
    { type: 'transfer',  re: /(تحويل فوري|تحويل|حوالة|transfer|instapay)/i },
    { type: 'deposit',   re: /(إيداع|إضافة رصيد|قيد إيداع|deposit)/i },
    { type: 'fee',       re: /(عمولة|رسوم خدمة|رسوم|خصم عمولة|fee)/i },
    { type: 'purchase',  re: /(شراء-POS|شراء|مشتريات|عملية شراء|دفع فوري|سداد فاتورة|سداد|نقاط البيع|نقاط بيع|انترنت|إنترنت|online|purchase|sale|pos)/i }
];

function detectLineType(line) {
    for (const rule of TYPE_RULES) {
        if (rule.re.test(line)) return rule.type;
    }
    return null;
}

// إزالة معرّفات قد تلتصق بآخر اسم المتجر
function cleanMerchant(m) {
    let x = String(m || '').replace(/[،,؛;:]/g, ' ').trim();
    x = x.replace(/\s*(إئتمانية|ائتمانية|بطاقة|أثير|مسبقة الدفع|ذات غطاء|مدى|الرصيد|المتبقي|في|على|on|SAR|USD|AED|KWD|card|cash)[\s\-]*$/gi, '');
    x = x.replace(/\s{2,}/g, ' ');
    return x.trim();
}

// استخراج التاريخ والوقت - يدعم ISO (2026-08-09) والمحلي (28/8/26 00:18) مع وقت قبل التاريخ أو بعده
function parseDateTime(lines) {
    const pad = n => String(parseInt(n, 10)).padStart(2, '0');
    for (const l of lines) {
        // صيغة سنة-شهر-يوم (ISO)
        let m = l.match(/(?:(?:(\d{1,2}):(\d{2})(?::\d{2})?\s+)?(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:\s+(\d{1,2}):(\d{2})(?::\d{2})?)?)/);
        if (m && m[3]) {
            const y = parseInt(m[3], 10), mo = parseInt(m[4], 10), d = parseInt(m[5], 10);
            if (y >= 2015 && mo >= 1 && mo <= 12 && d >= 1 && d <= 31) {
                const time = m[6] ? `${pad(m[6])}:${pad(m[7])}` : (m[1] ? `${pad(m[1])}:${pad(m[2])}` : '12:00');
                const date = `${y}-${pad(mo)}-${pad(d)}`;
                return { date, ts: new Date(`${date}T${time}`).getTime() };
            }
        }
        // صيغة يوم-شهر-سنة (المحلية)
        m = l.match(/(?:(?:(\d{1,2}):(\d{2})(?::\d{2})?\s+)?(\d{1,2})[-/](\d{1,2})[-/](\d{4}|\d{2})(?:\s+(\d{1,2}):(\d{2})(?::\d{2})?)?)/);
        if (m && m[3]) {
            let y = parseInt(m[5], 10);
            if (y < 100) y += 2000;
            const d = parseInt(m[3], 10), mo = parseInt(m[4], 10);
            if (y >= 2015 && mo >= 1 && mo <= 12 && d >= 1 && d <= 31) {
                const time = m[6] ? `${pad(m[6])}:${pad(m[7])}` : (m[1] ? `${pad(m[1])}:${pad(m[2])}` : '12:00');
                const date = `${y}-${pad(mo)}-${pad(d)}`;
                return { date, ts: new Date(`${date}T${time}`).getTime() };
            }
        }
        // وقت فقط منفصل (إن لم يوجد تاريخ)
        m = l.match(/\b(\d{1,2}):(\d{2})(?::\d{2})?\b/);
        if (m) return { date: todayISO(), ts: todayAtTime(m[1], m[2]) };
    }
    return { date: todayISO(), ts: Date.now() };
}

function todayISO() {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

function todayAtTime(h, m) {
    const now = new Date();
    return new Date(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}T${String(h).padStart(2, '0')}:${m}`).getTime();
}

function detectCard(lines) {
    for (const l of lines) {
        const m = l.match(/(?:بطاقة|إئتمانية|ائتمانية|حساب|card|visa|mastercard)[^\d]{0,20}\s*\**(\d{4})/i);
        if (m) return m[1];
    }
    return '';
}

function extractMerchant(blockText, lines) {
    // إزالة التواريخ من النص قبل البحث حتى لا يلتصق رقم التاريخ باسم المتجر
    const searchText = blockText.replace(/\d{1,2}[-/]\d{1,2}[-/]\d{2,4}(?:\s+\d{1,2}:\d{2}(?::\d{2})?)?/g, ' ');
    const re = /(?:من|لدى|عند|at|from|merchant|فواتير|لـ)\s*[:،؛]?\s*([A-Za-z\u0600-\u06FF][A-Za-z\u0600-\u06FF0-9 ]*)/i;
    const m = searchText.match(re);
    if (m) {
        let merchant = m[1];
        const after = searchText.slice(m.index + m[0].length).trimStart();
        if (/^\/|^\d/.test(after)) merchant = merchant.replace(/[\s\d]+$/, '').trim();
        if (/^\/C\b|^A\//i.test(after)) merchant = merchant.replace(/\s+[A-Za-z]\s*$/, '').trim();
        return cleanMerchant(merchant);
    }
    for (const l of lines) {
        const ml = l.match(re);
        if (ml) return cleanMerchant(ml[1]);
    }
    return '';
}

// المحلل الذكي: يقسم الرسالة لإيصالات، يستخرج بيانات كل واحدة، ويربط الكاش باك مع مشتريته الصحيحة
function smartLocalParser(text) {
    const rawLines = String(text || '').split(/\r?\n/);
    const lines = [];
    for (const raw of rawLines) {
        const l = raw.trim();
        if (!l) continue;
        if (/^(الصرف المتبقي|الرصيد|رصيد|رصيدك|الرصيد المتاح|الرصيد الحالي|حد الصرف|حد الصرف المتبقي|الحد المتاح|الحد الأقصى|الحد|الصرف المتاح|المبلغ المتاح|Balance|Available|Credit Limit|Account Balance)/i.test(l)) continue;
        if (/^[.:\s]+$/.test(l)) continue;
        lines.push(l);
    }

    // تقسيم إلى كتل - كل كتلة تبدأ بسطر يحدد نوع العملية
    const blocks = [];
    for (const line of lines) {
        const t = detectLineType(line);
        const isLikelyHeader = t && (parseAmountFromLine(line) || line.replace(/[^\w\u0600-\u06FF\- ]/g, '').trim().length < 45);
        if (isLikelyHeader) {
            blocks.push({ type: t, lines: [line] });
        } else if (blocks.length > 0) {
            blocks[blocks.length - 1].lines.push(line);
        } else {
            const amt = parseAmountFromLine(line);
            if (amt) blocks.push({ type: 'purchase', lines: [line] });
        }
    }
    if (blocks.length === 0) return [];

    const results = [];
    for (const block of blocks) {
        const blockText = block.lines.join(' ');

        // المبلغ: أول مبلغ مع عملة في الكتلة
        let amountInfo = null;
        for (const l of block.lines) {
            const a = parseAmountFromLine(l);
            if (a) { amountInfo = a; break; }
        }
        if (!amountInfo) continue;

        const { date, ts } = parseDateTime(block.lines);
        const card = detectCard(block.lines);
        const merchant = extractMerchant(blockText, block.lines);

        results.push({
            type: block.type,
            amount: amountInfo.amount,
            currency: amountInfo.currency,
            merchant,
            card,
            date,
            ts,
            cashback: 0
        });
    }

    // حد منطقي لأعلى مبلغ (يستبعد أرقاماً عشوائية)
    const realistic = results.filter(r => r.amount >= 0.01 && r.amount <= 200000);

    // ربط كل استرجاع (كاش باك) بالمشتري الأنسب على نفس البطاقة والزمان، دون دمجهما بإيصال واحد
    const purchases = realistic.filter(r => r.type === 'purchase');
    const refunds = realistic.filter(r => r.type === 'cashback').sort((a, b) => a.ts - b.ts);
    const others = realistic.filter(r => r.type !== 'purchase' && r.type !== 'cashback');
    const finalRecords = [];
    const consumed = new Set();

    for (const cb of refunds) {
        let best = null;
        let bestDelta = Infinity;
        for (let i = 0; i < purchases.length; i++) {
            if (consumed.has(i)) continue;
            const p = purchases[i];
            if (p.card && cb.card && p.card !== cb.card) continue;
            const sameMerchant = p.merchant && cb.merchant && p.merchant.toLowerCase() === cb.merchant.toLowerCase();
            const delta = Math.abs((p.ts || 0) - (cb.ts || 0));
            // تفضيل نفس المتجر خلال 10 دقائق، وبدونه خلال 30 دقيقة
            const within = cb.ts >= (p.ts || 0) - 60000 && delta <= (sameMerchant ? 600000 : 1800000);
            if (!within) continue;
            if (delta < bestDelta) { best = i; bestDelta = delta; }
        }
        if (best !== null) {
            purchases[best].cashback = (purchases[best].cashback || 0) + cb.amount;
            consumed.add(best);
        } else {
            finalRecords.push({
                type: 'cashback', amount: 0, cashback: cb.amount,
                currency: cb.currency, merchant: cb.merchant || '', card: cb.card, date: cb.date, ts: cb.ts
            });
        }
    }

    purchases.forEach(p => finalRecords.push({ ...p }));
    others.forEach(o => finalRecords.push({ ...o }));
    return finalRecords;
}

class TransactionCache {
    static cache = new Map();
    static set(id, data) { this.cache.set(id, { ...data, timestamp: Date.now() }); }
    static get(id) { return this.cache.get(id); }
    static delete(id) { this.cache.delete(id); }
}

// ---------------------------------------------------------------
// ذاكرة الربط الذكي: الكاش باك يصل في رسالة منفصلة (قبل أو بعد الشراء)
// ---------------------------------------------------------------
const MATCH_WINDOW_MS = 6 * 60 * 60 * 1000;   // نافذة ربط الكاش باك بالعملية: 6 ساعات
const PENDING_TTL_MS = 48 * 60 * 60 * 1000;   // بعدها يتحول الاسترجاع المستقل لمصروف منفصل

// أحدث المشتريات في الذاكرة (لتقديم الكاش باك القادم رسالة لاحقة)
class RecentPurchases {
    static map = new Map(); // userId -> [{docId, card, ts, merchant, savedAt}]
    static add(userId, item) {
        const arr = this.map.get(userId) || [];
        arr.unshift(item);
        this.map.set(userId, arr.slice(0, 40));
    }
    static get(userId) {
        const all = this.map.get(userId) || [];
        const recent = all.filter(i => Date.now() - i.savedAt < PENDING_TTL_MS);
        if (recent.length !== all.length) this.map.set(userId, recent);
        return recent;
    }
}

// البحث عن مشتري مناسب لكاش باك قادم من رسالة سابقة (نفس البطاقة + أقرب وقت)
function findRecentPurchase(userId, cb) {
    let best = null, bestDelta = Infinity;
    for (const p of RecentPurchases.get(userId)) {
        if (cb.card && p.card && cb.card !== p.card) continue;
        const delta = Math.abs((p.ts || 0) - (cb.ts || 0));
        if (delta > MATCH_WINDOW_MS) continue;
        const sameMerchant = cb.merchant && p.merchant && cb.merchant.toLowerCase() === p.merchant.toLowerCase();
        const score = sameMerchant ? delta - 600000 : delta;
        if (score < bestDelta) { best = p; bestDelta = score; }
    }
    return best;
}

// عند وصول عملية شراء: ابحث عن كاش باك معلّق سابق وأضفه لها
async function linkPendingPurchases(pendingList, ref, purchase) {
    if (!pendingList) return;
    for (const p of pendingList) {
        if (p.matched) continue;
        if (purchase.card && p.data.card && purchase.card !== p.data.card) continue;
        if (Math.abs((purchase.ts || 0) - (p.data.ts || 0)) > MATCH_WINDOW_MS) continue;
        await ref.update({ cashback: FieldValue.increment(p.data.amount) });
        await p.ref.delete();
        p.matched = true;
    }
}

async function createExpense(userId, driverId, r) {
    const docRef = db.collection('expenses').doc();
    await docRef.set({
        userId, driverId,
        shopName: r.merchant || "",
        amount: r.amount || 0,
        cashback: r.cashback || 0,
        date: r.date,
        status: 'Completed',
        type: r.type,
        receiptUrl: "-",
        createdAt: FieldValue.serverTimestamp()
    });
    return docRef;
}

// الحفظ الذكي: مشتريات + كاش باك مربوط + بقية الأنواع، مع مطابقة الرسائل المتفرقة
async function saveTransactions(userId, driverId, transactions, pendingList) {
    const batch = db.batch();
    const toRegister = [];

    for (const t of transactions) {
        if (t.type === 'cashback') continue; // الكاش باك لا يُحفظ كإيصال إلا عند ربطه أو انتهاء مهلة
        const ref = db.collection('expenses').doc();
        batch.set(ref, {
            userId, driverId,
            shopName: t.merchant || "",
            amount: t.amount || 0,
            cashback: t.cashback || 0,
            date: t.date,
            status: 'Completed',
            type: t.type,
            receiptUrl: "-",
            createdAt: FieldValue.serverTimestamp()
        });
        if (t.type === 'purchase') toRegister.push({ ref, rec: t });
    }

    for (const t of transactions) {
        if (t.type !== 'cashback') continue;
        // حاول ربطه بعملية شراء من رسالة سابقة (بما فيها منفصلة تقريباً)
        const match = findRecentPurchase(userId, t);
        if (match) {
            batch.update(db.collection('expenses').doc(match.docId), { cashback: FieldValue.increment(t.cashback) });
        } else {
            // لا عملية بعد: احفظ معلّقاً حتى تأتي عملية الشراء
            batch.set(db.collection('pendingCashbacks').doc(), {
                userId, card: t.card || '', ts: t.ts || Date.now(),
                amount: t.cashback, currency: t.currency || 'SAR',
                merchant: t.merchant || '', date: t.date, savedAt: Date.now()
            });
        }
    }

    await batch.commit();

    // سجل المشتريات واربط الكاش باك المعلّق الذي وصل قبلها
    for (const { ref, rec } of toRegister) {
        RecentPurchases.add(userId, { docId: ref.id, card: rec.card || '', ts: rec.ts || 0, merchant: rec.merchant || '', savedAt: Date.now() });
        await linkPendingPurchases(pendingList, ref, rec);
    }

    // الكاش باك المعلّق الذي انتهت مدته: يحفظ كاسترجاع مستقل
    if (driverId) {
        const now = Date.now();
        for (const p of pendingList) {
            if (p.matched) continue;
            if ((now - (p.data.savedAt || now)) <= PENDING_TTL_MS) continue;
            const d = p.data;
            await createExpense(userId, driverId, {
                type: 'cashback', amount: 0, cashback: d.amount,
                currency: d.currency || 'SAR', merchant: d.merchant || '', date: d.date
            });
            await p.ref.delete();
        }
    }
}

const BOT_TOKEN = process.env.BOT_TOKEN;
if (!BOT_TOKEN) {
    console.error('خطأ: لم يتم العثور على BOT_TOKEN في متغيرات البيئة. أنشئ ملف .env داخل مجلد telegram-bot وضع فيه: BOT_TOKEN=<توكنك>');
    process.exit(1);
}

const bot = new Telegraf(BOT_TOKEN);

bot.on('text', async (ctx) => {
    if (ctx.message.text.startsWith('/start')) return;

    try {
        const userQuery = await db.collection('users').where('telegramId', '==', ctx.from.id.toString()).get();
        if (userQuery.empty) return;

        const userData = userQuery.docs[0].data();
        const userId = userQuery.docs[0].id;
        
        const userLang = userData.language || 'ar';
        const msgs = {
            ar: { success: "✅ تم الإضافة.", choose: "اختر السائق:", found: "✅ تم العثور على " },
            en: { success: "✅ Added successfully.", choose: "Select driver:", found: "✅ Found " }
        };

        const transactions = smartLocalParser(ctx.message.text);
        if (transactions.length === 0) return;

        const driversQuery = await db.collection('drivers').where('userId', '==', userId).get();
        const drivers = driversQuery.docs.map(doc => ({ id: doc.id, name: doc.data().name }));
        if (drivers.length === 0) return;

        // الكاش باك المعلّق السابق (قابل للربط حتى لو انعكس ترتيب الرسائل)
        const pendingDocs = await db.collection('pendingCashbacks').where('userId', '==', userId).get();
        const pendingList = pendingDocs.docs.map(d => ({ ref: d.ref, data: d.data(), matched: false }));

        // رسالة استرجاع فقط: لا تحتاج سائق، تُحفظ معلّقة وتُرتبط تلقائياً بعمليتها
        if (transactions.every(t => t.type === 'cashback')) {
            await saveTransactions(userId, drivers.length === 1 ? drivers[0].id : null, transactions, pendingList);
            return ctx.reply(msgs[userLang].success);
        }

        if (drivers.length === 1) {
            await saveTransactions(userId, drivers[0].id, transactions, pendingList);
            return ctx.reply(msgs[userLang].success);
        }

        if (transactions.length === 1) {
            const txId = crypto.randomBytes(4).toString('hex');
            TransactionCache.set(txId, { userId, transaction: transactions[0], lang: userLang });
            const buttons = drivers.map(d => [Markup.button.callback(`🚗 ${d.name}`, `assign_${txId}_${d.id}`)]);
            const t = transactions[0];
            const title = `🛒 ${t.merchant || '—'}\n💰 ${t.amount} ${t.currency}`;
            return ctx.reply(`${title}\n\n${msgs[userLang].choose}`, Markup.inlineKeyboard(buttons));
        }

        // إيصالات كثيرة: اختيار سائق واحد مرة واحدة ثم حفظ الجميع معاً دون دمجها
        const txId = crypto.randomBytes(4).toString('hex');
        TransactionCache.set(txId, { userId, records: transactions, lang: userLang });
        const buttons = drivers.map(d => [Markup.button.callback(`🚗 ${d.name}`, `assign_${txId}_${d.id}`)]);
        return ctx.reply(`${msgs[userLang].found} ${transactions.length} ${msgs[userLang].choose}`, Markup.inlineKeyboard(buttons));
    } catch (error) {
        console.error("System Error:", error);
    }
});

bot.action(/^assign_([a-z0-9]+)_(.+)$/, async (ctx) => {
    try {
        const txId = ctx.match[1];
        const driverId = ctx.match[2];
        const pendingData = TransactionCache.get(txId);
        if (!pendingData) return ctx.answerCbQuery('⚠️', { show_alert: false });

        const userLang = pendingData.lang || 'ar';
        const msgText = userLang === 'en' ? "✅ Added." : "✅ تم الإضافة.";

        const pendingDocs = await db.collection('pendingCashbacks').where('userId', '==', pendingData.userId).get();
        const pendingList = pendingDocs.docs.map(d => ({ ref: d.ref, data: d.data(), matched: false }));
        const records = pendingData.records || [pendingData.transaction];

        await saveTransactions(pendingData.userId, driverId, records, pendingList);

        TransactionCache.delete(txId);
        ctx.editMessageText(msgText);
    } catch (error) {
        ctx.answerCbQuery('❌', { show_alert: false });
    }
});

const app = express();
app.use(express.static(path.join(__dirname, '../')));
app.get('/', (req, res) => res.sendFile(path.resolve(__dirname, '../index.html')));
app.listen(process.env.PORT || 3000, () => console.log(`[Web Server] Active`));
bot.launch();