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

function smartLocalParser(text) {
    const results = [];
    const cleanText = text.replace(/(?:الصرف المتبقي|الرصيد|Balance|الرصيد المتاح).*?(?:\d+(?:\.\d+)?)/gi, '');
    const moneyRegex = /(?:(?:بـ|ب|مبلغ)\s*)?(\d+(?:\.\d{1,2})?)\s*(SAR|USD|EUR|ريال|دولار|ر\.س)?/gi;
    
    let match;
    while ((match = moneyRegex.exec(cleanText)) !== null) {
        const amount = parseFloat(match[1]);
        if (amount <= 0) continue;

        let currency = (match[2] || 'SAR').toUpperCase();
        if (currency.includes('ريال') || currency.includes('ر.س')) currency = 'SAR';
        if (currency.includes('دولار')) currency = 'USD';

        const start = Math.max(0, match.index - 60);
        const end = Math.min(cleanText.length, match.index + match[0].length + 60);
        const context = cleanText.substring(start, end).replace(/\n/g, ' ');

        if (match[1].length === 4 && !match[2] && context.match(/(?:بطاقة|إئتمانية)/)) continue;
        if (context.slice(match.index - 3, match.index).includes(':')) continue;

        let type = 'purchase';
        if (/استرجاع|كاش باك|refund|مكافأة|إلغاء/i.test(context)) {
            type = 'cashback';
        }

        let merchant = type === 'cashback' ? 'استرجاع/مكافأة' : 'متجر غير معروف';
        const merchantMatch = context.match(/(?:من|لدى|في متجر|at)\s+([a-zA-Z\u0600-\u06FF0-9\s]+?)(?=\s+(?:إئتمانية|في|ببطاقة|رقم|SAR|\d|$))/i);
        if (merchantMatch && merchantMatch[1].trim().length > 1) {
            merchant = merchantMatch[1].trim();
        }

        results.push({ type, amount, currency, merchant, date: new Date().toISOString().split('T')[0] });
    }

    const unique = [];
    const seen = new Set();
    for (const r of results) {
        const key = `${r.amount}-${r.type}-${r.merchant}`;
        if (!seen.has(key)) {
            seen.add(key);
            unique.push(r);
        }
    }
    return unique;
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
        if (userQuery.empty) return ctx.reply('⚠️ حسابك غير مربوط بالموقع.');

        const userId = userQuery.docs[0].id;
        const transactions = smartLocalParser(ctx.message.text);

        if (transactions.length === 0) {
            return ctx.reply('❌ لم يتم العثور على مبالغ مالية صالحة في الرسالة.');
        }

        const driversQuery = await db.collection('drivers').where('userId', '==', userId).get();
        const drivers = driversQuery.docs.map(doc => ({ id: doc.id, name: doc.data().name }));

        if (drivers.length === 0) return ctx.reply('⚠️ لا يوجد لديك سائقين مسجلين.');

        const batch = db.batch();
        const purchases = [];
        let savedCashback = 0;

        transactions.forEach(t => {
            if (t.type === 'cashback') {
                const docRef = db.collection('expenses').doc();
                batch.set(docRef, {
                    userId, driverId: drivers[0].id, shopName: t.merchant,
                    amount: `${t.amount} ${t.currency}`, date: t.date, status: 'Completed',
                    type: 'cashback', receiptUrl: null, createdAt: FieldValue.serverTimestamp()
                });
                savedCashback++;
            } else {
                purchases.push(t);
            }
        });

        if (savedCashback > 0) await batch.commit();

        if (purchases.length > 0) {
            if (drivers.length === 1) {
                const pBatch = db.batch();
                purchases.forEach(p => {
                    const docRef = db.collection('expenses').doc();
                    pBatch.set(docRef, {
                        userId, driverId: drivers[0].id, shopName: p.merchant,
                        amount: `${p.amount} ${p.currency}`, date: p.date, status: 'Completed',
                        type: 'purchase', receiptUrl: null, createdAt: FieldValue.serverTimestamp()
                    });
                });
                await pBatch.commit();
                ctx.reply(`✅ تم تسجيل (${purchases.length}) عمليات للسائق ${drivers[0].name}`);
            } else {
                let replyMsg = savedCashback > 0 ? `✅ تم حفظ (${savedCashback}) كاش باك.\n\n👇 اختر السائق لـ (${purchases.length}) مشتريات:` : `👇 تم رصد (${purchases.length}) عمليات. اختر السائق:`;
                await ctx.reply(replyMsg);
                for (const p of purchases) {
                    const txId = crypto.randomBytes(4).toString('hex');
                    TransactionCache.set(txId, { userId, transaction: p });
                    const buttons = drivers.map(d => [Markup.button.callback(`🚗 ${d.name}`, `assign_${txId}_${d.id}`)]);
                    await ctx.reply(`🛒 المتجر: ${p.merchant}\n💰 المبلغ: ${p.amount} ${p.currency}`, Markup.inlineKeyboard(buttons));
                }
            }
        } else {
            ctx.reply(`✅ تم حفظ (${savedCashback}) عمليات كاش باك في النظام.`);
        }

    } catch (error) {
        console.error("System Error:", error);
        ctx.reply('❌ حدث فشل داخلي في النظام.');
    }
});

bot.action(/^assign_([a-z0-9]+)_(.+)$/, async (ctx) => {
    try {
        const txId = ctx.match[1];
        const driverId = ctx.match[2];
        const pendingData = TransactionCache.get(txId);
        
        if (!pendingData) return ctx.answerCbQuery('⚠️ العملية غير متوفرة أو تمت معالجتها!', { show_alert: true });

        const docRef = db.collection('expenses').doc();
        await docRef.set({
            userId: pendingData.userId, driverId: driverId, shopName: pendingData.transaction.merchant,
            amount: `${pendingData.transaction.amount} ${pendingData.transaction.currency}`, date: pendingData.transaction.date,
            status: 'Completed', type: 'purchase', receiptUrl: null, createdAt: FieldValue.serverTimestamp()
        });

        TransactionCache.delete(txId);
        ctx.editMessageText(`✅ تمت مزامنة العملية مع الموقع بنجاح.`);
    } catch (error) {
        ctx.answerCbQuery('❌ فشل في حفظ البيانات.', { show_alert: true });
    }
});

const app = express();
app.use(express.static(path.join(__dirname, '../')));
app.get('/', (req, res) => res.sendFile(path.resolve(__dirname, '../index.html')));
app.listen(process.env.PORT || 3000, () => console.log(`[Web Server] Active`));
bot.launch();