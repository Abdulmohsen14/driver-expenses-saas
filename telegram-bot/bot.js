require('dotenv').config();
const { Telegraf, Markup } = require('telegraf'); 
const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const express = require('express');
const path = require('path');
const crypto = require('crypto');

// ============================================================================
// [1] إعداد قاعدة البيانات
// ============================================================================
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

// ============================================================================
// [2] 🧠 محرك الذكاء الاصطناعي 10X (يفهم المحادثات، كل العملات، والصيغ المعقدة)
// ============================================================================
class AIEngine {
    static async extractFinancialData(text) {
        // نستخدم 1.5-flash لسرعته وذكائه، مع بديل gemini-pro لو حصل ضغط
        const fallbackModels = ["gemini-1.5-flash", "gemini-pro"];
        let lastError = null;

        // هذا هو الـ Prompt الخارق اللي يفهم كل شيء (سوالف، رسائل بنك، عملات مختلفة)
        const prompt = `
        أنت محرك ذكاء اصطناعي مالي "10X" مصمم لتحليل النصوص المعقدة، المحادثات العشوائية، والرسائل البنكية المنسوخة (بأي لغة، وبأي عملة، وبأي صيغة).
        مهمتك: قراءة النص واستخراج جميع المصاريف (مشتريات) وعمليات الاسترجاع (كاش باك/مكافآت).
        
        القواعد الصارمة للتحليل:
        1. الفهم العميق: افهم السياق سواء كان رسالة بنك رسمية، أو شخص يكتب بالعامية (مثال: "شريت بـ 50 دولار من امازون اليوم" أو "دفعت 20 دينار للبقالة").
        2. العملات (Currency): التقط العملة بدقة (SAR, USD, EUR, ريال، دولار، دينار، إلخ). لا تفترض دائماً أنها SAR.
        3. الكاش باك (Cashback): أي عملية فيها "استرجاع"، "إلغاء شراء"، "مكافأة"، "refund"، أو استرداد تعتبر type: "cashback".
        4. المشتريات (Purchase): أي عملية سحب، دفع، نقاط بيع، "شريت"، "دفعت" تعتبر type: "purchase".
        5. الإخراج (Output): يجب أن يكون مصفوفة JSON (Array) نقية فقط، بدون أي حرف إضافي أو شروحات.
        
        مثال للإخراج المطلوب:
        [
          {"type": "purchase", "amount": 150.50, "merchant": "Amazon US", "currency": "USD"},
          {"type": "cashback", "amount": 15.00, "merchant": "STC Pay مكافأة", "currency": "SAR"}
        ]

        النص المراد تحليله:
        ${text}
        `;

        for (const modelName of fallbackModels) {
            try {
                const model = genAI.getGenerativeModel({ model: modelName });
                const result = await model.generateContent(prompt);
                return this.parseJSON(result.response.text());
            } catch (err) {
                lastError = err;
                console.warn(`[AI] Model ${modelName} failed. Trying next...`);
            }
        }
        throw new Error(`AI Engine Failed: ${lastError.message}`);
    }

    static parseJSON(rawText) {
        // فلتر جراحي يقص الـ JSON حتى لو الذكاء الاصطناعي تفلسف وحط نصوص إضافية
        const match = rawText.match(/\[[\s\S]*\]/);
        if (!match) return [];
        try {
            const data = JSON.parse(match[0]);
            return data.map(item => ({
                type: String(item.type).toLowerCase().includes('cash') ? 'cashback' : 'purchase',
                amount: Math.abs(parseFloat(item.amount)) || 0,
                merchant: String(item.merchant || 'غير معروف').trim(),
                currency: String(item.currency || 'SAR').trim(),
                date: new Date().toISOString().split('T')[0]
            })).filter(i => i.amount > 0);
        } catch (e) {
            console.error("JSON Parse Error:", e);
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
    try { statusMsg = await ctx.reply('🧠 جاري التحليل العميق (سياق، عملات، نصوص)...'); } catch (e) { return; }

    try {
        const userQuery = await db.collection('users').where('telegramId', '==', ctx.from.id.toString()).get();
        if (userQuery.empty) return ctx.telegram.editMessageText(ctx.chat.id, statusMsg.message_id, undefined, '⚠️ حسابك غير مربوط بالموقع.');

        const userId = userQuery.docs[0].id;
        
        let transactions;
        try {
            transactions = await AIEngine.extractFinancialData(ctx.message.text);
        } catch (aiError) {
            console.error(aiError);
            return ctx.telegram.editMessageText(ctx.chat.id, statusMsg.message_id, undefined, '❌ خطأ في معالجة الذكاء الاصطناعي (حاول مرة أخرى).');
        }

        if (!transactions || transactions.length === 0) {
            return ctx.telegram.editMessageText(ctx.chat.id, statusMsg.message_id, undefined, '❌ لم يتعرف الذكاء الاصطناعي على أي عمليات مالية في النص.');
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
                ctx.telegram.editMessageText(ctx.chat.id, statusMsg.message_id, undefined, `✅ تم تحليل النص بنجاح. اختر السائق لـ (${purchases.length}) عمليات:`);
                for (const p of purchases) {
                    const txId = crypto.randomBytes(4).toString('hex');
                    TransactionCache.set(txId, { userId, transaction: p });
                    const buttons = drivers.map(d => [Markup.button.callback(`🚗 ${d.name}`, `assign_${txId}_${d.id}`)]);
                    await ctx.reply(`🛒 المتجر: ${p.merchant}\n💰 المبلغ: ${p.amount} ${p.currency}`, Markup.inlineKeyboard(buttons));
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

// ============================================================================
// [3] السيرفر (تم إصلاح خطأ المسار * ليعمل الموقع بدون مشاكل Cannot GET)
// ============================================================================
const app = express();
app.use(express.static(path.join(__dirname, '../')));
app.get('/', (req, res) => res.sendFile(path.resolve(__dirname, '../index.html')));
app.listen(process.env.PORT || 3000, () => console.log(`[Web Server] Active`));
bot.launch();