require('dotenv').config();
const { Telegraf, Markup } = require('telegraf'); 
const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const { GoogleGenerativeAI } = require('@google/generative-ai');

let serviceAccount;
try {
    serviceAccount = require('/etc/secrets/serviceAccountKey.json');
} catch (error) {
    serviceAccount = require('./serviceAccountKey.json');
}
initializeApp({ credential: cert(serviceAccount) });
const db = getFirestore();

const bot = new Telegraf(process.env.BOT_TOKEN || '8927972087:AAGt8Y1x9tKDQUy3koQvA9ICfn2sLEaZ3-M');
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const pendingTransactions = new Map();

async function aiBankParser(messageText) {
    const model = genAI.getGenerativeModel({ 
        model: "gemini-1.5-flash",
        generationConfig: { responseMimeType: "application/json" }
    });

    // برومبت أبسط وأوضح بكثير للذكاء الاصطناعي
    const prompt = `
    أنت محلل بنكي. اقرأ الرسالة التالية واستخرج منها العمليات المالية (شراء أو كاش باك).
    أرجع النتيجة حصرياً بصيغة JSON Array كالتالي بدون أي نص إضافي:
    [
      {
        "type": "purchase" أو "cashback",
        "amount": 10.50,
        "merchant": "اسم المتجر"
      }
    ]
    النص:
    ${messageText}
    `;

    try {
        const result = await model.generateContent(prompt);
        let rawText = result.response.text();
        
        const start = rawText.indexOf('[');
        const end = rawText.lastIndexOf(']');
        if (start === -1 || end === -1) return [];

        return JSON.parse(rawText.substring(start, end + 1));
    } catch (e) {
        console.error("AI Error:", e);
        return [];
    }
}

bot.on('text', async (ctx) => {
    if (ctx.message.text.startsWith('/start')) return; 

    let msg;
    try { msg = await ctx.reply('⏳ جاري التحليل...'); } catch(e) { return; } 

    try {
        const userQuery = await db.collection('users').where('telegramId', '==', ctx.from.id.toString()).get();
        if (userQuery.empty) {
            return ctx.telegram.editMessageText(ctx.chat.id, msg.message_id, undefined, '⚠️ حسابك غير مربوط بالموقع.');
        }

        const userId = userQuery.docs[0].id;
        const transactions = await aiBankParser(ctx.message.text);
        
        if (!transactions || transactions.length === 0) {
            return ctx.telegram.editMessageText(ctx.chat.id, msg.message_id, undefined, '❌ عذراً، لم يتمكن النظام من قراءة العمليات.');
        }

        const driversQuery = await db.collection('drivers').where('userId', '==', userId).get();
        let drivers = [];
        driversQuery.forEach(doc => drivers.push({ id: doc.id, name: doc.data().name }));

        if (drivers.length === 0) {
            return ctx.telegram.editMessageText(ctx.chat.id, msg.message_id, undefined, '⚠️ لا يوجد لديك سائقين مسجلين.');
        }

        const batch = db.batch();
        let savedCount = 0;
        let purchases = [];

        transactions.forEach(t => {
            const docRef = db.collection('expenses').doc();
            if (t.type === 'cashback') {
                batch.set(docRef, {
                    userId,
                    driverId: drivers[0].id,
                    shopName: `[استرجاع] ${t.merchant || 'غير معروف'}`,
                    amount: `${t.amount} SAR`,
                    date: new Date().toISOString().split('T')[0],
                    status: 'Completed',
                    type: 'cashback',
                    receiptUrl: null,
                    createdAt: FieldValue.serverTimestamp()
                });
                savedCount++;
            } else {
                purchases.push(t);
            }
        });

        if (savedCount > 0) await batch.commit();

        if (purchases.length > 0) {
            if (drivers.length === 1) {
                const pBatch = db.batch();
                purchases.forEach(p => {
                    const docRef = db.collection('expenses').doc();
                    pBatch.set(docRef, {
                        userId,
                        driverId: drivers[0].id,
                        shopName: p.merchant || 'غير معروف',
                        amount: `${p.amount} SAR`,
                        date: new Date().toISOString().split('T')[0],
                        status: 'Completed',
                        type: 'purchase',
                        receiptUrl: null,
                        createdAt: FieldValue.serverTimestamp()
                    });
                });
                await pBatch.commit();
                ctx.telegram.editMessageText(ctx.chat.id, msg.message_id, undefined, `✅ تم حفظ العمليات والكاش باك بنجاح للسائق ${drivers[0].name}`);
            } else {
                ctx.telegram.editMessageText(ctx.chat.id, msg.message_id, undefined, `👇 تم رصد (${purchases.length}) مشتريات. اختر السائق لكل عملية:`);
                for (const p of purchases) {
                    const txId = Math.random().toString(36).substring(7);
                    pendingTransactions.set(txId, { userId, transaction: p });
                    const buttons = drivers.map(d => [Markup.button.callback(`🚗 ${d.name}`, `assign_${txId}_${d.id}`)]);
                    await ctx.reply(`🛒 ${p.merchant || 'متجر'}\n💰 ${p.amount} SAR`, Markup.inlineKeyboard(buttons));
                }
            }
        } else {
            ctx.telegram.editMessageText(ctx.chat.id, msg.message_id, undefined, `✅ تم حفظ عمليات الكاش باك (${savedCount}) بنجاح.`);
        }

    } catch (error) {
        console.error(error);
        ctx.telegram.editMessageText(ctx.chat.id, msg.message_id, undefined, '❌ حدث خطأ في النظام.');
    }
});

bot.action(/^assign_(.+?)_(.+)$/, async (ctx) => {
    try {
        const txId = ctx.match[1];
        const driverId = ctx.match[2];
        const pendingData = pendingTransactions.get(txId);
        
        if (!pendingData) return ctx.answerCbQuery('⚠️ تمت المعالجة مسبقاً!', { show_alert: true });

        const docRef = db.collection('expenses').doc();
        const p = pendingData.transaction;
        
        await docRef.set({
            userId: pendingData.userId,
            driverId: driverId,
            shopName: p.merchant || 'غير معروف',
            amount: `${p.amount} SAR`,
            date: new Date().toISOString().split('T')[0],
            status: 'Completed',
            type: 'purchase',
            receiptUrl: null,
            createdAt: FieldValue.serverTimestamp()
        });

        pendingTransactions.delete(txId);
        ctx.editMessageText(`✅ تم الحفظ بنجاح.`);
    } catch (error) {
        ctx.answerCbQuery('❌ حدث خطأ.', { show_alert: true });
    }
});

const express = require('express');
const app = express();
app.listen(process.env.PORT || 3000, () => console.log(`Server running...`));
bot.launch();