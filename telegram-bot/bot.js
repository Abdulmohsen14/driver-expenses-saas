require('dotenv').config();
const { Telegraf, Markup } = require('telegraf'); 
const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const express = require('express');
const path = require('path');
const crypto = require('crypto');

// ============================================================================
// [1] Core Infrastructure & Database Initialization
// ============================================================================
class DatabaseConfig {
    static init() {
        let serviceAccount;
        try {
            serviceAccount = require('/etc/secrets/serviceAccountKey.json');
        } catch (error) {
            serviceAccount = require('./serviceAccountKey.json');
        }
        initializeApp({ credential: cert(serviceAccount) });
        return getFirestore();
    }
}
const db = DatabaseConfig.init();

// ============================================================================
// [2] Advanced AI Engine (Resilient & Deterministic)
// ============================================================================
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

class AIEngine {
    static async extractFinancialData(text) {
        // تم التحديث لموديلات 2.5 الصاروخية لتجنب 404
        const fallbackModels = ["gemini-2.5-flash", "gemini-2.5-pro"];
        let lastError = null;

        const prompt = `
        You are an elite financial data extractor. Analyze the banking message.
        CRITICAL RULE: Output ONLY a strict, valid JSON array. No explanations, no markdown tags.
        Format:
        [
          {"type": "purchase", "amount": 41.00, "merchant": "LULU HYPE", "currency": "SAR"}
        ]
        If it indicates a refund, reversal, or cashback, set "type" to "cashback".
        
        MESSAGE:
        ${text}
        `;

        for (const modelName of fallbackModels) {
            try {
                const model = genAI.getGenerativeModel({ 
                    model: modelName,
                    generationConfig: { 
                        temperature: 0.0, 
                        topK: 1,
                        responseMimeType: "application/json" // إجبار تام على مخرجات نظيفة
                    } 
                });

                const aiPromise = model.generateContent(prompt);
                const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error("AI_Timeout")), 12000));
                
                const result = await Promise.race([aiPromise, timeoutPromise]);
                return this.parseJSON(result.response.text());

            } catch (err) {
                lastError = err;
                console.warn(`[AI Engine] Model ${modelName} failed: ${err.message}. Trying next...`);
                continue; 
            }
        }
        throw new Error(`All AI Engines Failed. Last Error: ${lastError.message}`);
    }

    static parseJSON(rawText) {
        try {
            const match = rawText.match(/\[[\s\S]*\]/);
            if (!match) throw new Error("No JSON Array detected in response");

            const data = JSON.parse(match[0]);
            return data.map(item => ({
                type: String(item.type).toLowerCase().includes('cash') ? 'cashback' : 'purchase',
                amount: Math.abs(parseFloat(item.amount)) || 0,
                merchant: String(item.merchant || 'متجر غير معروف').trim(),
                currency: String(item.currency || 'SAR').trim(),
                date: new Date().toISOString().split('T')[0]
            })).filter(i => i.amount > 0);
        } catch (e) {
            throw new Error(`Data sanitization failed: ${e.message} | Raw Input: ${rawText}`);
        }
    }
}

// ============================================================================
// [3] State Management (Memory Leak Protection)
// ============================================================================
class TransactionCache {
    static cache = new Map();
    static set(id, data) {
        this.cache.set(id, { ...data, timestamp: Date.now() });
        this.cleanup();
    }
    static get(id) {
        return this.cache.get(id);
    }
    static delete(id) {
        this.cache.delete(id);
    }
    static cleanup() {
        const oneHour = 60 * 60 * 1000;
        const now = Date.now();
        for (const [key, value] of this.cache.entries()) {
            if (now - value.timestamp > oneHour) this.cache.delete(key);
        }
    }
}

// ============================================================================
// [4] Telegram Bot Controller
// ============================================================================
const bot = new Telegraf(process.env.BOT_TOKEN || '8927972087:AAGt8Y1x9tKDQUy3koQvA9ICfn2sLEaZ3-M');

bot.on('text', async (ctx) => {
    if (ctx.message.text.startsWith('/start')) return;

    let statusMsg;
    try { statusMsg = await ctx.reply('⚡ جاري التحليل الفوري عبر الذكاء الاصطناعي...'); } 
    catch (e) { return; }

    try {
        const userQuery = await db.collection('users').where('telegramId', '==', ctx.from.id.toString()).get();
        if (userQuery.empty) return ctx.telegram.editMessageText(ctx.chat.id, statusMsg.message_id, undefined, '⚠️ الحساب غير مسجل في النظام.');

        const userId = userQuery.docs[0].id;
        
        let transactions;
        try {
            transactions = await AIEngine.extractFinancialData(ctx.message.text);
        } catch (aiError) {
            console.error("[Fatal AI Error]:", aiError);
            return ctx.telegram.editMessageText(ctx.chat.id, statusMsg.message_id, undefined, '❌ تعذر تحليل الرسالة (راجع سجلات Render للتفاصيل).');
        }

        if (transactions.length === 0) {
            return ctx.telegram.editMessageText(ctx.chat.id, statusMsg.message_id, undefined, '❌ لم يتم العثور على مبالغ مالية واضحة.');
        }

        const driversQuery = await db.collection('drivers').where('userId', '==', userId).get();
        const drivers = driversQuery.docs.map(doc => ({ id: doc.id, name: doc.data().name }));

        if (drivers.length === 0) {
            return ctx.telegram.editMessageText(ctx.chat.id, statusMsg.message_id, undefined, '⚠️ قاعدة البيانات لا تحتوي على سائقين مسجلين.');
        }

        const batch = db.batch();
        const purchases = [];
        let savedCashback = 0;

        transactions.forEach(t => {
            if (t.type === 'cashback') {
                const docRef = db.collection('expenses').doc();
                batch.set(docRef, {
                    userId,
                    driverId: drivers[0].id,
                    shopName: `[استرجاع] ${t.merchant}`,
                    amount: `${t.amount} ${t.currency}`,
                    date: t.date,
                    status: 'Completed',
                    type: 'cashback',
                    receiptUrl: null,
                    createdAt: FieldValue.serverTimestamp()
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
                        userId,
                        driverId: drivers[0].id,
                        shopName: p.merchant,
                        amount: `${p.amount} ${p.currency}`,
                        date: p.date,
                        status: 'Completed',
                        type: 'purchase',
                        receiptUrl: null,
                        createdAt: FieldValue.serverTimestamp()
                    });
                });
                await pBatch.commit();
                ctx.telegram.editMessageText(ctx.chat.id, statusMsg.message_id, undefined, `✅ اكتملت المعالجة: تم تسجيل (${purchases.length}) عمليات للسائق ${drivers[0].name}`);
            } else {
                ctx.telegram.editMessageText(ctx.chat.id, statusMsg.message_id, undefined, `✅ اكتمل التحليل. اختر السائق لـ (${purchases.length}) عمليات:`);
                for (const p of purchases) {
                    const txId = crypto.randomBytes(4).toString('hex');
                    TransactionCache.set(txId, { userId, transaction: p });
                    const buttons = drivers.map(d => [Markup.button.callback(`🚗 ${d.name}`, `assign_${txId}_${d.id}`)]);
                    await ctx.reply(`🛒 ${p.merchant}\n💰 ${p.amount} ${p.currency}`, Markup.inlineKeyboard(buttons));
                }
            }
        } else {
            ctx.telegram.editMessageText(ctx.chat.id, statusMsg.message_id, undefined, `✅ تم حفظ (${savedCashback}) عمليات كاش باك.`);
        }

    } catch (error) {
        console.error("[System Core Error]:", error);
        ctx.telegram.editMessageText(ctx.chat.id, statusMsg.message_id, undefined, '❌ حدث فشل في النظام الأساسي.');
    }
});

bot.action(/^assign_([a-z0-9]+)_(.+)$/, async (ctx) => {
    try {
        const txId = ctx.match[1];
        const driverId = ctx.match[2];
        const pendingData = TransactionCache.get(txId);
        
        if (!pendingData) return ctx.answerCbQuery('⚠️ الجلسة منتهية أو تمت معالجتها مسبقاً!', { show_alert: true });

        const docRef = db.collection('expenses').doc();
        const p = pendingData.transaction;
        
        await docRef.set({
            userId: pendingData.userId,
            driverId: driverId,
            shopName: p.merchant,
            amount: `${p.amount} ${p.currency}`,
            date: p.date,
            status: 'Completed',
            type: 'purchase',
            receiptUrl: null,
            createdAt: FieldValue.serverTimestamp()
        });

        TransactionCache.delete(txId);
        ctx.editMessageText(`✅ تمت مزامنة العملية بنجاح.`);
    } catch (error) {
        console.error("[Action Error]:", error);
        ctx.answerCbQuery('❌ فشل في مزامنة البيانات.', { show_alert: true });
    }
});

// ============================================================================
// [5] Robust Web Server (SPA & Render Keep-Alive)
// ============================================================================
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, '../')));

// الخطأ كان هنا، وتم إرجاعه للصيغة الصحيحة '/'
app.get('/', (req, res) => {
    res.sendFile(path.resolve(__dirname, '../index.html'));
});

app.listen(PORT, () => console.log(`[Web Server] Active and listening on port ${PORT}`));
bot.launch().then(() => console.log(`[Telegram Bot] Active and Polling`));