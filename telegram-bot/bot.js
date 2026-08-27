require('dotenv').config();
const { Telegraf, Markup } = require('telegraf'); 
const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const { GoogleGenerativeAI } = require('@google/generative-ai'); // مكتبة الذكاء الاصطناعي


let serviceAccount;
try {
    serviceAccount = require('/etc/secrets/serviceAccountKey.json');
} catch (error) {
    serviceAccount = require('./serviceAccountKey.json');
}
initializeApp({ credential: cert(serviceAccount) });
const db = getFirestore();


const bot = new Telegraf('8927972087:AAGt8Y1x9tKDQUy3koQvA9ICfn2sLEaZ3-M');
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

const pendingTransactions = new Map();


async function aiBankParser(messageText) {

    const model = genAI.getGenerativeModel({ 
        model: "gemini-1.5-flash",
        generationConfig: { responseMimeType: "application/json" } // نجبره يرجع بيانات مرتبة فقط
    });

    const prompt = `
    أنت محلل مالي دقيق جداً. مهمتك استخراج العمليات المالية من النص التالي.
    النص قد يحتوي على عملية واحدة أو عدة عمليات، بأي لغة، وأي صيغة بنكية.
    استخرج المعلومات وأرجعها كـ JSON Array يحتوي على كائنات (Objects) فقط بهذه الصيغة:
    [
      {
        "type": "purchase" أو "cashback" (استرجاع/مكافأة يعتبر كاش باك),
        "amount": رقم المبلغ (فقط أرقام),
        "merchant": "اسم المتجر أو نقطة البيع",
        "cardInfo": "آخر 4 أرقام من البطاقة، أو '----' إذا لم توجد",
        "currency": "رمز العملة (مثال: SAR, USD)",
        "date": "التاريخ المستخرج بصيغة YYYY-MM-DD"
      }
    ]
    النص المراد تحليله:
    ${messageText}
    `;

    try {
        const result = await model.generateContent(prompt);
        return JSON.parse(result.response.text());
    } catch (error) {
        console.error("AI Parsing Error:", error);
        return [];
    }
}


bot.on('text', async (ctx) => {
    const text = ctx.message.text;
    const telegramUserId = ctx.from.id.toString();

    if (text.startsWith('/start')) return; 

    const msg = await ctx.reply('🤖 جاري تحليل البيانات بواسطة الذكاء الاصطناعي...');

    try {
        const userQuery = await db.collection('users').where('telegramId', '==', telegramUserId).get();
        if (userQuery.empty) {
            return ctx.telegram.editMessageText(ctx.chat.id, msg.message_id, undefined, '⚠️ حسابك غير مربوط بالموقع.');
        }

        const userId = userQuery.docs[0].id;
        

        const transactions = await aiBankParser(text);
        
        if (!transactions || transactions.length === 0) {
            return ctx.telegram.editMessageText(ctx.chat.id, msg.message_id, undefined, '❌ لم يتعرف الذكاء الاصطناعي على عمليات مالية واضحة في الرسالة.');
        }

        const cashbacks = transactions.filter(t => t.type === 'cashback');
        const purchases = transactions.filter(t => t.type === 'purchase');

        const batch = db.batch();
        let summaryMsg = '';

   
        if (cashbacks.length > 0) {
            cashbacks.forEach(cb => {
                const docRef = db.collection('expenses').doc();
                batch.set(docRef, { userId, shopName: cb.merchant, amount: cb.amount, currency: cb.currency, date: cb.date, cardInfo: cb.cardInfo, status: 'مكتملة', type: 'cashback', receiptUrl: null, createdAt: FieldValue.serverTimestamp() });
            });
            await batch.commit();
            summaryMsg += `✅ تم رصد وحفظ (${cashbacks.length}) عمليات كاش باك.\n`;
        }

        // معالجة المشتريات
        if (purchases.length > 0) {
            const driversQuery = await db.collection('drivers').where('userId', '==', userId).get();
            let drivers = [];
            driversQuery.forEach(doc => drivers.push({ id: doc.id, name: doc.data().name }));

            if (drivers.length === 0) {
                summaryMsg += '⚠️ لا يوجد سائقين مسجلين لتوزيع المشتريات عليهم.';
                return ctx.telegram.editMessageText(ctx.chat.id, msg.message_id, undefined, summaryMsg);
            }

            if (drivers.length === 1) {
                const pBatch = db.batch();
                purchases.forEach(p => {
                    const docRef = db.collection('expenses').doc();
                    pBatch.set(docRef, { userId, driverId: drivers[0].id, shopName: p.merchant, amount: p.amount, currency: p.currency, date: p.date, cardInfo: p.cardInfo, status: 'مكتملة', type: 'purchase', receiptUrl: null, createdAt: FieldValue.serverTimestamp() });
                });
                await pBatch.commit();
                summaryMsg += `✅ تم تسجيل (${purchases.length}) مشتريات على السائق: ${drivers[0].name}`;
                ctx.telegram.editMessageText(ctx.chat.id, msg.message_id, undefined, summaryMsg);
            } else {
                ctx.telegram.editMessageText(ctx.chat.id, msg.message_id, undefined, summaryMsg + `👇 تم رصد (${purchases.length}) مشتريات. حدد السائق لكل عملية:`);
                
                for (const p of purchases) {
                    const txId = Math.random().toString(36).substring(7);
                    pendingTransactions.set(txId, { userId, transaction: p });
                    const buttons = drivers.map(d => [Markup.button.callback(`🚗 ${d.name}`, `assign_${txId}_${d.id}`)]);
                    await ctx.reply(`🛒 ${p.merchant} | 💰 ${p.amount} ${p.currency}\n📅 ${p.date}`, Markup.inlineKeyboard(buttons));
                }
            }
        } else if (cashbacks.length > 0) {
             ctx.telegram.editMessageText(ctx.chat.id, msg.message_id, undefined, summaryMsg);
        }

    } catch (error) {
        console.error("System Error:", error);
        ctx.telegram.editMessageText(ctx.chat.id, msg.message_id, undefined, '❌ حدث خطأ داخلي أثناء معالجة البيانات.');
    }
});


bot.action(/^assign_(.+?)_(.+)$/, async (ctx) => {
    const txId = ctx.match[1];
    const driverId = ctx.match[2];
    
    const pendingData = pendingTransactions.get(txId);
    if (!pendingData) return ctx.answerCbQuery('⚠️ تمت المعالجة مسبقاً!', { show_alert: true });

    try {
        const docRef = db.collection('expenses').doc();
        const p = pendingData.transaction;
        await docRef.set({
            userId: pendingData.userId, driverId: driverId, shopName: p.merchant, amount: p.amount, currency: p.currency, date: p.date, cardInfo: p.cardInfo, status: 'مكتملة', type: 'purchase', receiptUrl: null, createdAt: FieldValue.serverTimestamp()
        });

        pendingTransactions.delete(txId);
        ctx.editMessageText(`✅ تم حفظ عملية ${p.merchant} للسائق المحدد.`);
    } catch (error) {
        console.error(error);
        ctx.answerCbQuery('❌ حدث خطأ أثناء الحفظ.', { show_alert: true });
    }
});


const express = require('express');
const path = require('path');
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, '../')));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, '../index.html')));
app.listen(PORT, () => console.log(`🌐 Web server listening on port ${PORT}`));

bot.launch();
console.log('🚀 10X AI Telegram Bot is Running...');