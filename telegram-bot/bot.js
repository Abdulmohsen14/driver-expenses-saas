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

// =========================================================================
// 🧠 محرك الذكاء الاصطناعي المطور (يصيد الكاش باك والمشتريات بدقة تامة)
// =========================================================================
async function aiBankParser(messageText) {
    const model = genAI.getGenerativeModel({ 
        model: "gemini-1.5-flash",
        generationConfig: { responseMimeType: "application/json" }
    });

    const prompt = `أنت محلل مالي. استخرج جميع عمليات الشراء والكاش باك (استرجاع نقدي/مكافأة) من النص التالي.
    أرجع البيانات كـ JSON Array فقط يبدأ بـ [ وينتهي بـ ].
    كل عنصر يجب أن يحتوي على:
    - "type": "cashback" إذا كانت العملية استرجاع نقدي أو مكافأة، أو "purchase" إذا كانت شراء.
    - "amount": قيمة المبلغ برقم عشري (مثلاً 41.00 أو 2.05).
    - "merchant": اسم المتجر أو جهة الاسترجاع.
    - "currency": العملة (غالباً SAR).
    
    النص:
    ${messageText}`;

    try {
        const result = await model.generateContent(prompt);
        let rawText = result.response.text();
        
        const startIndex = rawText.indexOf('[');
        const endIndex = rawText.lastIndexOf(']');
        if (startIndex === -1 || endIndex === -1) throw new Error("JSON Error");
        
        const parsedData = JSON.parse(rawText.substring(startIndex, endIndex + 1));

        return parsedData.map(item => ({
            type: String(item.type).toLowerCase().includes('cash') ? 'cashback' : 'purchase',
            amount: parseFloat(item.amount) || 0,
            merchant: item.merchant || 'متجر غير معروف',
            currency: item.currency || 'SAR',
            date: new Date().toISOString().split('T')[0]
        })).filter(item => item.amount > 0);

    } catch (error) {
        console.error("AI Error:", error);
        return [];
    }
}

// =========================================================================
// 🤖 معالجة الرسائل وحفظ الكاش باك والمشتريات في الداتابيس بشكل صحيح
// =========================================================================
bot.on('text', async (ctx) => {
    if (ctx.message.text.startsWith('/start')) return; 

    let msg;
    try { msg = await ctx.reply('🤖 جاري تحليل العمليات والكاش باك...'); } catch(e) { return; } 

    try {
        const userQuery = await db.collection('users').where('telegramId', '==', ctx.from.id.toString()).get();
        if (userQuery.empty) {
            return ctx.telegram.editMessageText(ctx.chat.id, msg.message_id, undefined, '⚠️ حسابك غير مربوط بالموقع.');
        }

        const userId = userQuery.docs[0].id;
        const transactions = await aiBankParser(ctx.message.text);
        
        if (transactions.length === 0) {
            return ctx.telegram.editMessageText(ctx.chat.id, msg.message_id, undefined, '❌ لم يتعرف الذكاء الاصطناعي على عمليات مالية.');
        }

        // جلب السائقين أولاً للتأكد منهم
        const driversQuery = await db.collection('drivers').where('userId', '==', userId).get();
        let drivers = [];
        driversQuery.forEach(doc => drivers.push({ id: doc.id, name: doc.data().name }));

        if (drivers.length === 0) {
            return ctx.telegram.editMessageText(ctx.chat.id, msg.message_id, undefined, '⚠️ تنبيه: لا يوجد لديك أي سائق مسجل في حسابك.');
        }

        const batch = db.batch();
        let cashbackCount = 0;
        let purchases = [];

        transactions.forEach(t => {
            const docRef = db.collection('expenses').doc();
            if (t.type === 'cashback') {
                // حفظ الكاش باك مباشرة في الداتابيس مع ربطه بأول سائق أو إبقائه مسترد
                batch.set(docRef, {
                    userId,
                    driverId: drivers[0].id, // ربطه بأول سائق عشان يظهر في جدول الموقع
                    shopName: `[استرجاع] ${t.merchant}`,
                    amount: t.amount,
                    currency: t.currency,
                    date: t.date,
                    status: 'Completed',
                    type: 'cashback',
                    receiptUrl: null,
                    createdAt: FieldValue.serverTimestamp()
                });
                cashbackCount++;
            } else {
                purchases.push(t);
            }
        });

        await batch.commit();

        let summaryMsg = '';
        if (cashbackCount > 0) {
            summaryMsg += `✅ تم رصد وإضافة (${cashbackCount}) عمليات كاش باك في الجدول بنجاح!\n`;
        }

        if (purchases.length > 0) {
            if (drivers.length === 1) {
                const pBatch = db.batch();
                purchases.forEach(p => {
                    const docRef = db.collection('expenses').doc();
                    pBatch.set(docRef, {
                        userId,
                        driverId: drivers[0].id,
                        shopName: p.merchant,
                        amount: `${p.amount} ${p.currency}`, // التنسيق المطابق للموقع
                        date: p.date,
                        status: 'Completed',
                        type: 'purchase',
                        receiptUrl: null,
                        createdAt: FieldValue.serverTimestamp()
                    });
                });
                await pBatch.commit();
                summaryMsg += `✅ تم تسجيل (${purchases.length}) مشتريات للسائق: ${drivers[0].name}`;
                ctx.telegram.editMessageText(ctx.chat.id, msg.message_id, undefined, summaryMsg);
            } else {
                ctx.telegram.editMessageText(ctx.chat.id, msg.message_id, undefined, summaryMsg + `👇 تم رصد (${purchases.length}) مشتريات. اختر السائق لكل عملية:`);
                
                for (const p of purchases) {
                    const txId = Math.random().toString(36).substring(7);
                    pendingTransactions.set(txId, { userId, transaction: p });
                    const buttons = drivers.map(d => [Markup.button.callback(`🚗 ${d.name}`, `assign_${txId}_${d.id}`)]);
                    
                    await ctx.reply(`🛒 المتجر: ${p.merchant}\n💰 المبلغ: ${p.amount} ${p.currency}`, Markup.inlineKeyboard(buttons));
                }
            }
        } else {
            ctx.telegram.editMessageText(ctx.chat.id, msg.message_id, undefined, summaryMsg);
        }

    } catch (error) {
        console.error("Error:", error);
        ctx.telegram.editMessageText(ctx.chat.id, msg.message_id, undefined, '❌ حدث خطأ في معالجة البيانات.');
    }
});

// =========================================================================
// 🎯 حفظ المشتريات بعد اختيار السائق
// =========================================================================
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
            shopName: p.merchant,
            amount: `${p.amount} ${p.currency}`,
            date: p.date,
            status: 'Completed',
            type: 'purchase',
            receiptUrl: null,
            createdAt: FieldValue.serverTimestamp()
        });

        pendingTransactions.delete(txId);
        ctx.editMessageText(`✅ تم الحفظ بنجاح في الموقع.`);
    } catch (error) {
        ctx.answerCbQuery('❌ حدث خطأ أثناء الحفظ.', { show_alert: true });
    }
});

const express = require('express');
const app = express();
app.listen(process.env.PORT || 3000, () => console.log(`🌐 Server Running...`));
bot.launch();