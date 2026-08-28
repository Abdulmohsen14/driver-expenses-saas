require('dotenv').config();
const { Telegraf, Markup } = require('telegraf'); 
const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const { GoogleGenerativeAI } = require('@google/generative-ai');
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
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

class AIEngine {
    static async extractFinancialData(text) {
        // قائمة الموديلات: نبدأ بالأحدث، وإذا فشل ننتقل للمستقر (gemini-pro)
        const modelsToTry = ["gemini-1.5-flash-latest", "gemini-pro"];
        let lastError;

        const prompt = `
        أنت محاسب مالي دقيق جداً. اقرأ الرسالة البنكية واستخرج العمليات المالية فقط.
        
        قواعد صارمة جداً:
        1. استخرج (المبالغ المدفوعة للمشتريات) و (المبالغ المسترجعة/الكاش باك).
        2. استخرج تاريخ العملية (حوله لصيغة YYYY-MM-DD)، إذا لم تجد تاريخاً استخدم تاريخ اليوم.
        3. تجاهل تماماً: الأوقات (مثل 09:21)، أرقام البطاقات، والرصيد المتبقي (مثل الصرف المتبقي 2795.15). لا تعتبرها مبالغ مالية أبداً.
        4. حدد العملة الصحيحة.
        5. أرجع النتيجة كمصفوفة JSON (Array) نقية فقط.
        
        صيغة الإخراج المطلوبة:
        [
          {"type": "purchase", "amount": 5.00, "merchant": "Khairat A", "currency": "SAR", "date": "2026-08-01"},
          {"type": "cashback", "amount": 0.04, "merchant": "استرجاع نقدي", "currency": "SAR", "date": "2026-08-01"}
        ]

        الرسالة:
        ${text}
        `;

        for (const modelName of modelsToTry) {
            try {
                // الموديلات القديمة لا تدعم إجبار الـ JSON، لذلك نعزلها برمجياً
                const config = modelName.includes("1.5") ? { responseMimeType: "application/json" } : {};
                const model = genAI.getGenerativeModel({ 
                    model: modelName,
                    generationConfig: config
                });
                
                const aiPromise = model.generateContent(prompt);
                const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error("AI_Timeout (انتهى الوقت)")), 15000));
                
                const result = await Promise.race([aiPromise, timeoutPromise]);
                return this.parseJSON(result.response.text());
            } catch (err) {
                lastError = err;
                console.warn(`[AI] فشل موديل ${modelName}، جاري تجربة البديل...`);
            }
        }
        throw new Error(`كل الموديلات فشلت. الخطأ الأخير: ${lastError.message}`);
    }

    static parseJSON(rawText) {
        const match = rawText.match(/\[[\s\S]*\]/);
        if (!match) return [];
        try {
            const data = JSON.parse(match[0]);
            return data.map(item => ({
                type: String(item.type).toLowerCase().includes('cash') ? 'cashback' : 'purchase',
                amount: Math.abs(parseFloat(item.amount)) || 0,
                merchant: String(item.merchant || 'متجر غير معروف').trim(),
                currency: String(item.currency || 'SAR').trim(),
                date: String(item.date || new Date().toISOString().split('T')[0]).trim()
            })).filter(i => i.amount > 0);
        } catch (e) {
            return [];
        }
    }
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

    let statusMsg;
    try { statusMsg = await ctx.reply('🧠 جاري التحليل الذكي للرسالة...'); } catch (e) { return; }

    try {
        const userQuery = await db.collection('users').where('telegramId', '==', ctx.from.id.toString()).get();
        if (userQuery.empty) return ctx.telegram.editMessageText(ctx.chat.id, statusMsg.message_id, undefined, '⚠️ حسابك غير مربوط بالموقع.');

        const userId = userQuery.docs[0].id;
        
        let transactions;
        try {
            transactions = await AIEngine.extractFinancialData(ctx.message.text);
        } catch (aiError) {
            console.error("AI Error:", aiError.message);
            return ctx.telegram.editMessageText(ctx.chat.id, statusMsg.message_id, undefined, `❌ خطأ فني من جوجل: ${aiError.message}`);
        }

        if (!transactions || transactions.length === 0) {
            return ctx.telegram.editMessageText(ctx.chat.id, statusMsg.message_id, undefined, '❌ لم يتم العثور على عمليات مالية مدفوعة في الرسالة.');
        }

        const driversQuery = await db.collection('drivers').where('userId', '==', userId).get();
        const drivers = driversQuery.docs.map(doc => ({ id: doc.id, name: doc.data().name }));

        if (drivers.length === 0) return ctx.telegram.editMessageText(ctx.chat.id, statusMsg.message_id, undefined, '⚠️ لا يوجد لديك سائقين مسجلين.');

        const batch = db.batch();
        const purchases = [];
        let savedCashback = 0;

        transactions.forEach(t => {
            if (t.type === 'cashback') {
                const docRef = db.collection('expenses').doc();
                batch.set(docRef, {
                    userId, driverId: drivers[0].id, shopName: `[استرجاع] ${t.merchant}`,
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
                ctx.telegram.editMessageText(ctx.chat.id, statusMsg.message_id, undefined, `✅ تم تسجيل (${purchases.length}) عمليات للسائق ${drivers[0].name}`);
            } else {
                let replyText = savedCashback > 0 ? `✅ تم حفظ (${savedCashback}) كاش باك.\n\n👇 اختر السائق لـ (${purchases.length}) مشتريات:` : `👇 تم رصد (${purchases.length}) عمليات. اختر السائق:`;
                ctx.telegram.editMessageText(ctx.chat.id, statusMsg.message_id, undefined, replyText);
                
                for (const p of purchases) {
                    const txId = crypto.randomBytes(4).toString('hex');
                    TransactionCache.set(txId, { userId, transaction: p });
                    const buttons = drivers.map(d => [Markup.button.callback(`🚗 ${d.name}`, `assign_${txId}_${d.id}`)]);
                    await ctx.reply(`🛒 ${p.merchant}\n💰 ${p.amount} ${p.currency}\n📅 ${p.date}`, Markup.inlineKeyboard(buttons));
                }
            }
        } else {
            ctx.telegram.editMessageText(ctx.chat.id, statusMsg.message_id, undefined, `✅ تم حفظ (${savedCashback}) عمليات كاش باك في النظام.`);
        }

    } catch (error) {
        console.error("System Error:", error);
        ctx.telegram.editMessageText(ctx.chat.id, statusMsg.message_id, undefined, '❌ حدث فشل داخلي في النظام.');
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