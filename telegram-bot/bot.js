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
    if (s === 'ريال' || s === 'SAR') return 'SAR';
    if (s === 'دولار' || s === 'USD' || s === '$') return 'USD';
    if (s === 'درهم' || s === 'AED') return 'AED';
    if (s === 'دينار' || s === 'KWD') return 'KWD';
    return s;
}

// استخراج المبلغ مع العملة من سطر (يدعم "مبلغ 0.04 SAR", "بـ5.00 SAR", "بمبلغ 30 ريال" ...)
function parseAmountFromLine(line) {
    const m = line.match(/(?:مبلغ|المبلغ|بـ|ب|بمبلغ|بمقدار|قيمة|amount|of)?\s*([\d,]+(?:\.\d{1,2})?)\s*(SAR|USD|AED|KWD|BHD|QAR|EUR|GBP|INR|ريال|دولار|درهم|دينار|\$|€|£)/i);
    if (!m) return null;
    const amount = parseFloat(m[1].replace(/,/g, ''));
    if (isNaN(amount) || amount <= 0) return null;
    return { amount, currency: normalizeCurrency(m[2]) };
}

const TYPE_RULES = [
    { type: 'cashback',  re: /(استرجاع نقدي|كاش باك|refund|reversal|مكافأة نقدية|مكافأة|إلغاء عملية|credit back|cashback|cash back|reward)/i },
    { type: 'withdrawal', re: /(سحب نقدي|سحب|withdrawal|cash withdrawal)/i },
    { type: 'transfer',  re: /(تحويل فوري|تحويل|حوالة|transfer|instapay)/i },
    { type: 'deposit',   re: /(إيداع|إضافة رصيد|deposit)/i },
    { type: 'fee',       re: /(عمولة|رسوم خدمة|رسوم|fee)/i },
    { type: 'purchase',  re: /(شراء-POS|شراء|مشتريات|purchase|sale|عملية شراء|دفع فوري|سداد فاتورة|سداد|عبر نقاط البيع|Apple Pay|AP)/i }
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

// استخراج التاريخ والوقت من أسطر الكتلة وتحويله لتنسيق YYYY-MM-DD + طابع زمني
function parseDateTime(lines) {
    for (const l of lines) {
        const m = l.match(/(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})(?:\s+(\d{1,2}):(\d{2}))?/);
        if (m) {
            let y = parseInt(m[3], 10);
            if (y < 100) y += 2000;
            const day = String(parseInt(m[1], 10)).padStart(2, '0');
            const mon = String(parseInt(m[2], 10)).padStart(2, '0');
            const time = m[4] ? `${String(m[4]).padStart(2, '0')}:${m[5]}` : '12:00';
            const date = `${y}-${mon}-${day}`;
            return { date, ts: new Date(`${date}T${time}`).getTime() };
        }
    }
    const now = new Date();
    const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    return { date: today, ts: Date.now() };
}

function detectCard(lines) {
    for (const l of lines) {
        const m = l.match(/(?:بطاقة|إئتمانية|ائتمانية|حساب)[^\d]{0,12}\s*(\d{4})/i);
        if (m) return m[1];
    }
    for (const l of lines) {
        const m = l.match(/\b(\d{4})\b/);
        if (m) return m[1];
    }
    return '';
}

function extractMerchant(blockText, lines) {
    const m = blockText.match(/(?:من|لدى|عند|at|from|merchant|فواتير)\s+([A-Za-z\u0600-\u06FF][A-Za-z\u0600-\u06FF ]*)/i);
    if (m && m[1]) return cleanMerchant(m[1]);
    // محاولة أخذ السطر الذي يبدأ باسم متجر (كلمة أجنبية أو عربية غير معروفة) بعد سطر المبلغ
    for (const l of lines) {
        if (/^(من|لدى|عند|at|from|merchant)\s+/i.test(l)) {
            return cleanMerchant(l.replace(/^(من|لدى|عند|at|from|merchant)\s+/i, ''));
        }
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
        if (/^(الصرف المتبقي|الرصيد|الرصيد المتاح|الرصيد الحالي|الحد المتاح|الصرف المتاح|Balance|Available|Credit Limit)/i.test(l)) continue;
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

// حفظ قائمة إيصالات كاملة (مشتريات، استرجاع، سحب، تحويلات...) بسائق واحد دفعة واحدة
async function commitRecords(userId, driverId, records) {
    const pBatch = db.batch();
    for (const r of records) {
        const docRef = db.collection('expenses').doc();
        pBatch.set(docRef, {
            userId,
            driverId,
            shopName: r.merchant || "",
            amount: r.amount || 0,
            cashback: r.cashback || 0,
            date: r.date,
            status: 'Completed',
            type: r.type,
            receiptUrl: "-",
            createdAt: FieldValue.serverTimestamp()
        });
    }
    await pBatch.commit();
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

        if (drivers.length === 1) {
            await commitRecords(userId, drivers[0].id, transactions);
            return ctx.reply(msgs[userLang].success);
        }

        if (transactions.length === 1) {
            const txId = crypto.randomBytes(4).toString('hex');
            TransactionCache.set(txId, { userId, transaction: transactions[0], lang: userLang });
            const buttons = drivers.map(d => [Markup.button.callback(`🚗 ${d.name}`, `assign_${txId}_${d.id}`)]);
            const t = transactions[0];
            const title = t.type === 'cashback'
                ? `↩️ ${t.merchant || 'Cash back'}\n➕ ${t.cashback} ${t.currency}`
                : `🛒 ${t.merchant || '—'}\n💰 ${t.amount} ${t.currency}`;
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

        if (pendingData.records) {
            await commitRecords(pendingData.userId, driverId, pendingData.records);
        } else if (pendingData.transaction) {
            await commitRecords(pendingData.userId, driverId, [pendingData.transaction]);
        }

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