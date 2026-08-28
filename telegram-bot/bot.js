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
// 🚀 المحرك المحلي المستقل 
// ============================================================================
function smartLocalParser(text) {
    const results = [];
    const cleanText = text.replace(/الصرف المتبقي.*?\n?/g, '');
    
    let dateMatch = cleanText.match(/\d{2}\/\d{2}\/\d{2}/);
    let txDate = new Date().toISOString().split('T')[0];
    if (dateMatch) {
        const parts = dateMatch[0].split('/');
        if(parts.length === 3) { txDate = `20${parts[2]}-${parts[1]}-${parts[0]}`; }
    }

    const regex = /(?:مبلغ|بـ)\s*([\d,]+(?:\.\d{1,2})?)\s*(SAR|USD|EUR|ريال|دولار)/gi;
    let match;
    
    while ((match = regex.exec(cleanText)) !== null) {
        const amount = parseFloat(match[1].replace(/,/g, ''));
        if (amount <= 0) continue;

        let currency = match[2].toUpperCase();
        if (currency === 'ريال') currency = 'SAR';
        if (currency === 'دولار') currency = 'USD';
        
        const start = Math.max(0, match.index - 80);
        const end = Math.min(cleanText.length, match.index + 120);
        const context = cleanText.substring(start, end);
        
        let type = 'purchase';
        let merchant = 'متجر غير معروف';
        
        if (/استرجاع|كاش باك|مكافأة|إلغاء|refund/i.test(context)) {
            type = 'cashback';
            merchant = 'استرجاع نقدي';
        } else {
            const merchantMatch = context.match(/(?:من|لدى)\s+([^\n]+)/);
            if (merchantMatch) {
                merchant = merchantMatch[1].trim();
                merchant = merchant.split(/(?:إئتمانية|بطاقة|في\s\d|SAR)/)[0].trim();
            }
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
        if (userQuery.empty) return ctx.reply('⚠️ حسابك غير مربوط بالموقع.');

        const userId = userQuery.docs[0].id;
        const transactions = smartLocalParser(ctx.message.text);

        if (transactions.length === 0) return ctx.reply('❌ لم يتم العثور على مبالغ مالية صالحة في الرسالة.');

        const driversQuery = await db.collection('drivers').where('userId', '==', userId).get();
        const drivers = driversQuery.docs.map(doc => ({ id: doc.id, name: doc.data().name }));
        if (drivers.length === 0) return ctx.reply('⚠️ لا يوجد لديك سائقين مسجلين.');

        // فصل المشتريات ودمج الكاش باك معها لتظهر في عمود الواجهة
        const purchases = transactions.filter(t => t.type === 'purchase');
        const cashbacks = transactions.filter(t => t.type === 'cashback');
        const totalCashback = cashbacks.reduce((sum, t) => sum + t.amount, 0);

        if (purchases.length > 0) {
            purchases[0].cashback = totalCashback; // دمج الكاش باك في الفاتورة
            
            if (drivers.length === 1) {
                const pBatch = db.batch();
                purchases.forEach(p => {
                    const docRef = db.collection('expenses').doc();
                    pBatch.set(docRef, {
                        userId, driverId: drivers[0].id, shopName: p.merchant,
                        amount: p.amount, // الرقم صافي بدون SAR
                        cashback: p.cashback || 0,
                        date: p.date, status: 'completed', // حرف صغير
                        type: 'purchase', receiptUrl: null, createdAt: FieldValue.serverTimestamp()
                    });
                });
                await pBatch.commit();
                ctx.reply(`✅ تم تسجيل (${purchases.length}) عمليات للسائق ${drivers[0].name}`);
            } else {
                let replyText = totalCashback > 0 ? `✅ تم دمج (${totalCashback}) كاش باك.\n\n👇 اختر السائق:` : `👇 تم رصد (${purchases.length}) عمليات. اختر السائق:`;
                await ctx.reply(replyText);
                
                for (const p of purchases) {
                    const txId = crypto.randomBytes(4).toString('hex');
                    TransactionCache.set(txId, { userId, transaction: p });
                    const buttons = drivers.map(d => [Markup.button.callback(`🚗 ${d.name}`, `assign_${txId}_${d.id}`)]);
                    await ctx.reply(`🛒 ${p.merchant}\n💰 ${p.amount} ${p.currency}\n📅 ${p.date}`, Markup.inlineKeyboard(buttons));
                }
            }
        } else if (totalCashback > 0) {
             // في حال إرسال كاش باك فقط بدون مشتريات
             const docRef = db.collection('expenses').doc();
             await docRef.set({
                 userId, driverId: drivers[0].id, shopName: 'استرجاع نقدي مستقل',
                 amount: 0, cashback: totalCashback, date: cashbacks[0].date, 
                 status: 'completed', type: 'cashback', receiptUrl: null, createdAt: FieldValue.serverTimestamp()
             });
             ctx.reply(`✅ تم حفظ (${totalCashback}) كاش باك في النظام.`);
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
            amount: pendingData.transaction.amount, // الرقم صافي
            cashback: pendingData.transaction.cashback || 0, // إضافة عمود الكاش باك
            date: pendingData.transaction.date,
            status: 'completed', // حرف صغير
            type: 'purchase', receiptUrl: null, createdAt: FieldValue.serverTimestamp()
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