require('dotenv').config();
const { Telegraf, Markup } = require('telegraf'); 
const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const { GoogleGenerativeAI } = require('@google/generative-ai');

// =========================================================================
// 1. إعداد قاعدة البيانات (بأمان تام)
// =========================================================================
let serviceAccount;
try {
    serviceAccount = require('/etc/secrets/serviceAccountKey.json');
} catch (error) {
    serviceAccount = require('./serviceAccountKey.json');
}
initializeApp({ credential: cert(serviceAccount) });
const db = getFirestore();

// =========================================================================
// 2. إعداد البوت والذكاء الاصطناعي
// =========================================================================
const bot = new Telegraf(process.env.BOT_TOKEN || '8927972087:AAGt8Y1x9tKDQUy3koQvA9ICfn2sLEaZ3-M');
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

const pendingTransactions = new Map();

// =========================================================================
// 🧠 3. المحرك الخارق (Gemini AI Parser) - [مضاد للأخطاء بنسبة 100%]
// =========================================================================
async function aiBankParser(messageText) {
    // إجبار الذكاء الاصطناعي على إرجاع JSON صافي بدون أي نصوص أو تعليقات (هذا السر!)
    const model = genAI.getGenerativeModel({ 
        model: "gemini-1.5-flash",
        generationConfig: {
            responseMimeType: "application/json"
        }
    });

    const prompt = `
    أنت محلل مالي دقيق. استخرج جميع العمليات المالية من النص التالي مهما كانت لغته أو صيغته أو البنك.
    أرجع البيانات كـ JSON Array فقط، يحتوي على هذه المفاتيح بالضبط:
    [
      {
        "type": "purchase" أو "cashback",
        "amount": رقم المبلغ كقيمة رقمية فقط,
        "merchant": "اسم المتجر أو نقطة البيع باختصار",
        "cardInfo": "آخر 4 أرقام من البطاقة، أو '----'",
        "currency": "رمز العملة (مثال: SAR)",
        "date": "التاريخ المستخرج بصيغة YYYY-MM-DD"
      }
    ]
    النص المراد تحليله:
    ${messageText}
    `;

    try {
        const result = await model.generateContent(prompt);
        let rawText = result.response.text();
        
        // درع حماية إضافي: قص أي شيء خارج الأقواس المربعة لضمان القراءة الصحيحة
        const jsonMatch = rawText.match(/\[[\s\S]*\]/);
        const cleanJsonString = jsonMatch ? jsonMatch[0] : rawText;

        const parsedData = JSON.parse(cleanJsonString);

        // تنظيف البيانات (التأكد إن المبالغ أرقام مو نصوص عشان ما تخرب الداتابيس)
        return parsedData.map(item => ({
            type: item.type === 'cashback' ? 'cashback' : 'purchase',
            amount: parseFloat(item.amount) || 0,
            merchant: item.merchant || 'متجر غير معروف',
            cardInfo: item.cardInfo || '----',
            currency: item.currency || 'SAR',
            date: item.date || new Date().toISOString().split('T')[0]
        })).filter(item => item.amount > 0); // تجاهل أي عملية مبلغها صفر أو خطأ

    } catch (error) {
        console.error("AI Parsing Error:", error);
        return []; // في حال حدوث أسوأ سيناريو، يرجع مصفوفة فارغة بدون ما يطفي البوت
    }
}

// =========================================================================
// 🤖 4. استقبال الرسائل ومعالجتها
// =========================================================================
bot.on('text', async (ctx) => {
    const text = ctx.message.text;
    const telegramUserId = ctx.from.id.toString();

    if (text.startsWith('/start')) return; 

    let msg;
    try {
        msg = await ctx.reply('🤖 جاري تحليل البيانات وفهم السياق...');
    } catch(e) { return; } // حماية لو البوت ما قدر يرسل رسالة

    try {
        // التحقق من المستخدم
        const userQuery = await db.collection('users').where('telegramId', '==', telegramUserId).get();
        if (userQuery.empty) {
            return ctx.telegram.editMessageText(ctx.chat.id, msg.message_id, undefined, '⚠️ حسابك غير مربوط بلوحة التحكم.');
        }

        const userId = userQuery.docs[0].id;
        
        // استدعاء الذكاء الاصطناعي
        const transactions = await aiBankParser(text);
        
        if (transactions.length === 0) {
            return ctx.telegram.editMessageText(ctx.chat.id, msg.message_id, undefined, '❌ لم يتعرف الذكاء الاصطناعي على عمليات مالية واضحة في رسالتك.');
        }

        // فصل الكاش باك والمشتريات
        const cashbacks = transactions.filter(t => t.type === 'cashback');
        const purchases = transactions.filter(t => t.type === 'purchase');

        const batch = db.batch();
        let summaryMsg = '';

        // 🟢 معالجة الكاش باك بصمت
        if (cashbacks.length > 0) {
            cashbacks.forEach(cb => {
                const docRef = db.collection('expenses').doc();
                batch.set(docRef, { userId, shopName: cb.merchant, amount: cb.amount, currency: cb.currency, date: cb.date, cardInfo: cb.cardInfo, status: 'مكتملة', type: 'cashback', receiptUrl: null, createdAt: FieldValue.serverTimestamp() });
            });
            await batch.commit();
            summaryMsg += `✅ تم حفظ (${cashbacks.length}) عمليات كاش باك في الداتابيس.\n`;
        }

        // 🔴 معالجة المشتريات
        if (purchases.length > 0) {
            const driversQuery = await db.collection('drivers').where('userId', '==', userId).get();
            let drivers = [];
            driversQuery.forEach(doc => drivers.push({ id: doc.id, name: doc.data().name }));

            // إذا ما فيه سواقين أبداً
            if (drivers.length === 0) {
                summaryMsg += '⚠️ تنبيه: لا يوجد لديك سائقين مسجلين لتعيين المشتريات عليهم.';
                return ctx.telegram.editMessageText(ctx.chat.id, msg.message_id, undefined, summaryMsg);
            }

            // إذا فيه سواق واحد فقط (يحفظها له مباشرة)
            if (drivers.length === 1) {
                const pBatch = db.batch();
                purchases.forEach(p => {
                    const docRef = db.collection('expenses').doc();
                    pBatch.set(docRef, { userId, driverId: drivers[0].id, shopName: p.merchant, amount: p.amount, currency: p.currency, date: p.date, cardInfo: p.cardInfo, status: 'مكتملة', type: 'purchase', receiptUrl: null, createdAt: FieldValue.serverTimestamp() });
                });
                await pBatch.commit();
                summaryMsg += `✅ تم تسجيل (${purchases.length}) مشتريات تلقائياً للسائق: ${drivers[0].name}`;
                ctx.telegram.editMessageText(ctx.chat.id, msg.message_id, undefined, summaryMsg);
            } 
            // إذا فيه أكثر من سواق (يعطيك أزرار تختار لكل عملية)
            else {
                ctx.telegram.editMessageText(ctx.chat.id, msg.message_id, undefined, summaryMsg + `👇 تم رصد (${purchases.length}) مشتريات. حدد السائق لكل عملية:`);
                
                for (const p of purchases) {
                    const txId = Math.random().toString(36).substring(7);
                    pendingTransactions.set(txId, { userId, transaction: p });
                    
                    // توليد أزرار بأسماء السائقين
                    const buttons = drivers.map(d => [Markup.button.callback(`🚗 ${d.name}`, `assign_${txId}_${d.id}`)]);
                    
                    await ctx.reply(`🛒 المتجر: ${p.merchant}\n💰 المبلغ: ${p.amount} ${p.currency}`, Markup.inlineKeyboard(buttons));
                }
            }
        } else if (cashbacks.length > 0) {
             ctx.telegram.editMessageText(ctx.chat.id, msg.message_id, undefined, summaryMsg);
        }

    } catch (error) {
        console.error("System Error in Text Handler:", error);
        ctx.telegram.editMessageText(ctx.chat.id, msg.message_id, undefined, '❌ حدث خطأ داخلي، يرجى المحاولة لاحقاً.');
    }
});

// =========================================================================
// 🎯 5. التعامل مع الضغط على أزرار السائقين
// =========================================================================
bot.action(/^assign_(.+?)_(.+)$/, async (ctx) => {
    try {
        const txId = ctx.match[1];
        const driverId = ctx.match[2];
        
        const pendingData = pendingTransactions.get(txId);
        if (!pendingData) {
            return ctx.answerCbQuery('⚠️ تمت إضافة هذه العملية مسبقاً!', { show_alert: true });
        }

        const docRef = db.collection('expenses').doc();
        const p = pendingData.transaction;
        
        await docRef.set({
            userId: pendingData.userId, 
            driverId: driverId, 
            shopName: p.merchant, 
            amount: p.amount, 
            currency: p.currency, 
            date: p.date, 
            cardInfo: p.cardInfo, 
            status: 'مكتملة', 
            type: 'purchase', 
            receiptUrl: null, 
            createdAt: FieldValue.serverTimestamp()
        });

        pendingTransactions.delete(txId); // تفريغ الذاكرة
        ctx.editMessageText(`✅ تم الحفظ بنجاح!`);
    } catch (error) {
        console.error("Button Action Error:", error);
        ctx.answerCbQuery('❌ حدث خطأ أثناء الحفظ.', { show_alert: true });
    }
});

// =========================================================================
// 🌐 6. تشغيل خادم الويب (لمنع سقوط السيرفر في Render)
// =========================================================================
const express = require('express');
const path = require('path');
const app = express();
app.use(express.static(path.join(__dirname, '../')));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, '../index.html')));
app.listen(process.env.PORT || 3000, () => console.log(`🌐 Server Running...`));

bot.launch();
console.log('🚀 10X AI Bot is Running perfectly without errors...');