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

// ============================================================================
// 🚀 المحرك البرمجي المطور (متعدد اللغات، العملات، والنواقص)
// ============================================================================
function smartLocalParser(text) {
    const results = [];
    // تنظيف الأرصدة بأي لغة لمنع الحسابات الخاطئة
    const cleanText = text.replace(/(?:الصرف المتبقي|الرصيد|Balance|Available).*?\n?/gi, '');
    
    // التقاط أي مبلغ يتبعه عملة (3 حروف إنجليزية، أو عملات عربية، أو رموز)
    const regex = /([\d,]+(?:\.\d{1,2})?)\s*([A-Z]{3}|ريال|دولار|درهم|دينار|\$|€|£)/gi;
    let match;
    
    while ((match = regex.exec(cleanText)) !== null) {
        const amount = parseFloat(match[1].replace(/,/g, ''));
        if (amount <= 0) continue;

        let currency = match[2].toUpperCase();
        if (currency === 'ريال') currency = 'SAR';
        if (currency === 'دولار') currency = 'USD';
        
        // أخذ السياق المحيط بالمبلغ لتحليله (عربي وإنجليزي)
        const start = Math.max(0, match.index - 60);
        const end = Math.min(cleanText.length, match.index + 80);
        const context = cleanText.substring(start, end);
        
        // تحديد نوع العملية
        let type = 'purchase';
        if (/استرجاع|كاش باك|مكافأة|إلغاء|refund|reversal|cashback/i.test(context)) {
            type = 'cashback';
        }
        
        // استخراج المتجر - إذا لم يجده يتركه فارغاً تماماً
        let merchant = ""; 
        const merchantMatch = context.match(/(?:من|لدى|at|from)\s+([a-zA-Z\u0600-\u06FF\s]+)/i);
        if (merchantMatch && merchantMatch[1]) {
            merchant = merchantMatch[1].replace(/(?:إئتمانية|بطاقة|في|SAR|USD|card)/gi, '').trim();
        }

        // استخراج التاريخ الخاص بالعملية
        let txDate = new Date().toISOString().split('T')[0];
        const dateMatch = context.match(/\d{2,4}[-/]\d{2}[-/]\d{2,4}/);
        if (dateMatch) {
            let dStr = dateMatch[0].replace(/\//g, '-');
            let parts = dStr.split('-');
            if (parts.length === 3 && parts[2].length === 2) txDate = `20${parts[2]}-${parts[1]}-${parts[0]}`;
        }

        results.push({ type, amount, currency, merchant, date: txDate });
    }
    return results;
}

class TransactionCache {
    static cache = new Map();
    static set(id, data) { this.cache.set(id, { ...data, timestamp: Date.now() }); }
    static get(id) { return this.cache.get(id); }
    static delete(id) { this.cache.delete(id); }
}

const bot = new Telegraf(process.env.BOT_TOKEN || '8927972087:AAGt8Y1x9tKDQUy3koQvA9ICfn2sLEaZ3-M');

bot.on('text', async (ctx) => {
    if (ctx.message.text.startsWith('/start')) return;

    try {
        const userQuery = await db.collection('users').where('telegramId', '==', ctx.from.id.toString()).get();
        if (userQuery.empty) return;

        const userData = userQuery.docs[0].data();
        const userId = userQuery.docs[0].id;
        
        // قراءة لغة المستخدم من الموقع (إذا لم تكن محددة يفترض العربية)
        const userLang = userData.language || 'ar';
        const msgs = {
            ar: { success: "✅ تم الإضافة.", choose: "اختر السائق:" },
            en: { success: "✅ Added successfully.", choose: "Select driver:" }
        };

        const transactions = smartLocalParser(ctx.message.text);
        if (transactions.length === 0) return;

        const driversQuery = await db.collection('drivers').where('userId', '==', userId).get();
        const drivers = driversQuery.docs.map(doc => ({ id: doc.id, name: doc.data().name }));
        if (drivers.length === 0) return;

        const purchases = transactions.filter(t => t.type === 'purchase');
        const cashbacks = transactions.filter(t => t.type === 'cashback');
        const totalCashback = cashbacks.reduce((sum, t) => sum + t.amount, 0);

        if (purchases.length > 0) {
            if (drivers.length === 1) {
                const pBatch = db.batch();
                purchases.forEach(p => {
                    const docRef = db.collection('expenses').doc();
                    pBatch.set(docRef, {
                        userId, driverId: drivers[0].id, shopName: p.merchant,
                        amount: p.amount, cashback: totalCashback || 0,
                        date: p.date, status: 'completed', // بحرف صغير لإنهاء مشكلة Pending
                        type: 'purchase', receiptUrl: "", createdAt: FieldValue.serverTimestamp()
                    });
                });
                await pBatch.commit();
                ctx.reply(msgs[userLang].success);
            } else {
                for (const p of purchases) {
                    p.cashback = totalCashback;
                    const txId = crypto.randomBytes(4).toString('hex');
                    TransactionCache.set(txId, { userId, transaction: p, lang: userLang });
                    const buttons = drivers.map(d => [Markup.button.callback(`🚗 ${d.name}`, `assign_${txId}_${d.id}`)]);
                    await ctx.reply(msgs[userLang].choose, Markup.inlineKeyboard(buttons));
                }
            }
        } else if (totalCashback > 0) {
             const docRef = db.collection('expenses').doc();
             await docRef.set({
                 userId, driverId: drivers[0].id, shopName: "",
                 amount: 0, cashback: totalCashback, date: cashbacks[0].date, 
                 status: 'completed', type: 'cashback', receiptUrl: "", createdAt: FieldValue.serverTimestamp()
             });
             ctx.reply(msgs[userLang].success);
        }
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

        const docRef = db.collection('expenses').doc();
        await docRef.set({
            userId: pendingData.userId, driverId: driverId, shopName: pendingData.transaction.merchant,
            amount: pendingData.transaction.amount, 
            cashback: pendingData.transaction.cashback || 0, 
            date: pendingData.transaction.date,
            status: 'completed', 
            type: 'purchase', receiptUrl: "", createdAt: FieldValue.serverTimestamp()
        });

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