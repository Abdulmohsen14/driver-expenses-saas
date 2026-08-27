require('dotenv').config();
const { Telegraf, Markup } = require('telegraf'); 
const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');

const serviceAccount = require('./serviceAccountKey.json');

initializeApp({ credential: cert(serviceAccount) });
const db = getFirestore();

const bot = new Telegraf('8927972087:AAGt8Y1x9tKDQUy3koQvA9ICfn2sLEaZ3-M');

const pendingTransactions = new Map();

const texts = {
    ar: {
        linkedSuccess: '✅ تم ربط حسابك بنجاح!\n\nأرسل رسائل البنك هنا، وسأقوم بفرزها وسؤالك عن السائق الذي تود إضافتها إليه.',
        linkError: '❌ حدث خطأ أثناء الربط، يرجى المحاولة مرة أخرى.',
        welcomeUnlinked: 'مرحباً بك! 🚗\nلتفعيل البوت، يرجى الذهاب إلى لوحة التحكم في الموقع والضغط على "ربط الحساب".',
        analyzing: '⏳ جاري التحليل الذكي للعملية...',
        notLinked: '⚠️ حسابك غير مربوط. يرجى ربط حسابك من إعدادات الموقع أولاً.',
        noAmount: '❌ لم أتمكن من استخراج المبلغ، الرجاء التأكد من صيغة الرسالة.',
        noDrivers: '⚠️ لم تقم بإضافة أي سائق في الموقع حتى الآن! أضف سائقاً لتسجيل المصاريف.',
        cashback: (amount, card) => '✅ تم رصد استرجاع/كاش باك!\nالمبلغ: ' + amount + ' SAR\nالبطاقة: ' + card + '\n\n⏳ جاري البحث لربطه بالعمليات السابقة...',
        purchaseSingle: (amount, shop, driver) => '✅ تم بنجاح! رصدت مبلغ ' + amount + ' ريال من ' + shop + '، وتمت إضافتها للسائق الوحيد: ' + driver,
        purchaseMulti: (shop, amount, card) => '✅ رصدت عملية شراء!\nالمحل: ' + shop + '\nالمبلغ: ' + amount + ' SAR\nالبطاقة: ' + card + '\n\n👇 اختر السائق الذي تود تسجيل العملية عليه:',
        sysError: '❌ حدث خطأ في النظام أثناء معالجة العملية.',
        expiredCb: '⚠️ انتهت صلاحية هذه العملية أو تمت إضافتها مسبقاً.',
        savedSuccess: (amount) => '✅ ممتاز! تم حفظ عملية بقيمة ' + amount + ' ريال بنجاح في حساب السائق المحدد.',
        saveError: '❌ حدث خطأ أثناء الحفظ.',
        logCashbackFound: (merchant) => '✅ تم الاصطياد! هذا الكاش باك يتبع لعملية ' + merchant + '.',
        logCashbackNotFound: '⚠️ تم تسجيل الكاش باك، لكن لم نجد عملية سابقة مطابقة.',
        logSearchCashback: (amount) => '⏳ جاري البحث عن العملية الأصلية لربط الكاش باك (مبلغ: ' + amount + ')...'
    },
    en: {
        linkedSuccess: '✅ Account linked successfully!\n\nSend bank messages here, and I will parse them and ask which driver to assign them to.',
        linkError: '❌ Error during linking, please try again.',
        welcomeUnlinked: 'Welcome! 🚗\nTo activate the bot, please go to the website dashboard and click "Link Account".',
        analyzing: '⏳ Smart analysis in progress...',
        notLinked: '⚠️ Your account is not linked. Please link it from the website settings first.',
        noAmount: '❌ Could not extract the amount. Please check the message format.',
        noDrivers: '⚠️ You have not added any drivers yet! Add a driver to record expenses.',
        cashback: (amount, card) => '✅ Cashback detected!\nAmount: ' + amount + ' SAR\nCard: ' + card + '\n\n⏳ Searching to link with previous transactions...',
        purchaseSingle: (amount, shop, driver) => '✅ Success! Detected ' + amount + ' SAR from ' + shop + ', added to your only driver: ' + driver,
        purchaseMulti: (shop, amount, card) => '✅ Purchase detected!\nMerchant: ' + shop + '\nAmount: ' + amount + ' SAR\nCard: ' + card + '\n\n👇 Choose the driver for this transaction:',
        sysError: '❌ A system error occurred while processing.',
        expiredCb: '⚠️ This transaction expired or was already added.',
        savedSuccess: (amount) => '✅ Excellent! Transaction of ' + amount + ' SAR successfully saved to the selected driver.',
        saveError: '❌ Error occurred while saving.',
        logCashbackFound: (merchant) => '✅ Caught! This cashback belongs to the transaction at ' + merchant + '.',
        logCashbackNotFound: '⚠️ Cashback recorded, but no matching previous transaction found.',
        logSearchCashback: (amount) => '⏳ Searching for original transaction to link cashback (Amount: ' + amount + ')...'
    }
};

function smartBankParser(message) {
    const cleanText = message.replace(/\n/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();

    const result = {
        type: 'UNKNOWN',
        amount: 0,
        merchant: 'Unknown',
        cardLast4: null,
        isCashback: false,
        rawDate: null
    };

    const cashbackKeywords = /كاش باك|استرجاع|مكافأة|مستردة|رد مبلغ|cashback|refund|reversal/;
    if (cashbackKeywords.test(cleanText)) {
        result.type = 'CASHBACK';
        result.isCashback = true;
    } else if (/شراء|دفع|pos|purchase|pay/.test(cleanText)) {
        result.type = 'PURCHASE';
    }

    const amountRegex = /(?:sar|ريال|ر\.س|مبلغ|بـ|مال|money)?\s*(\d+(?:\.\d{1,2})?)\s*(?:sar|ريال|ر\.س)?/gi;
    let amounts = [];
    let match;
    while ((match = amountRegex.exec(cleanText)) !== null) {
        amounts.push(parseFloat(match[1]));
    }
    if (amounts.length > 0) {
        result.amount = amounts[0];
    }

    const cardRegex = /(?:بطاقة|إئتمانية|مدى|حساب|فيزا|ماستر|card|acct|x|[*#-])\s*(\d{4})\b/;
    const cardMatch = cleanText.match(cardRegex);
    if (cardMatch) result.cardLast4 = cardMatch[1];

    const merchantRegex = /(?:من|at)\s+([a-z\u0600-\u06FF\s]+)(?=\s+(?:بـ|في|بطاقة|إئتمانية|sar|ريال|ر\.س|\d))/i;
    const merchantMatch = cleanText.match(merchantRegex);
    if (merchantMatch && merchantMatch[1]) {
        result.merchant = merchantMatch[1].trim();
    }

    return result;
}

async function processCashbackMessage(parsedMessage, driverId, t) {
    if (!parsedMessage.isCashback) return;

    console.log(t.logSearchCashback(parsedMessage.amount));

    const foundOriginalTransaction = {
        id: "EXP_9921",
        merchant: "ALDREES",
        amount: 100.00,
        date: "2026-08-01",
        cashbackReceived: false
    };

    if (foundOriginalTransaction) {
        console.log(t.logCashbackFound(foundOriginalTransaction.merchant));
    } else {
        console.log(t.logCashbackNotFound);
    }
}

bot.start(async (ctx) => {
    const payload = ctx.startPayload; 
    const telegramId = ctx.from.id;
    const userLang = ctx.from.language_code && ctx.from.language_code.startsWith('ar') ? 'ar' : 'en';
    const t = texts[userLang];

    if (payload) {
        try {
            const userRef = db.collection('users').doc(payload);
            await userRef.set({ telegramId: telegramId.toString() }, { merge: true });
            
            ctx.reply(t.linkedSuccess);
        } catch (error) {
            console.error(error);
            ctx.reply(t.linkError);
        }
    } else {
        ctx.reply(t.welcomeUnlinked);
    }
});

bot.on('text', async (ctx) => {
    const text = ctx.message.text;
    const telegramUserId = ctx.from.id.toString();
    const userLang = ctx.from.language_code && ctx.from.language_code.startsWith('ar') ? 'ar' : 'en';
    const t = texts[userLang];

    if (text.startsWith('/start')) return; 

    ctx.reply(t.analyzing);

    try {
        const userQuery = await db.collection('users').where('telegramId', '==', telegramUserId).get();
        if (userQuery.empty) {
            return ctx.reply(t.notLinked);
        }

        const userId = userQuery.docs[0].id;
        const parsedData = smartBankParser(text);
        
        if (parsedData.amount === 0) {
            return ctx.reply(t.noAmount);
        }

        if (parsedData.isCashback) {
            ctx.reply(t.cashback(parsedData.amount, parsedData.cardLast4));
            await processCashbackMessage(parsedData, telegramUserId, t);
            return; 
        }

        const formattedTransaction = {
            shopName: parsedData.merchant || (userLang === 'ar' ? 'متجر غير معروف' : 'Unknown Merchant'),
            amount: parsedData.amount,
            currency: 'SAR',
            cashback: 0,
            date: new Date().toISOString().split('T')[0], 
            cardInfo: parsedData.cardLast4 || '----',
            status: userLang === 'ar' ? 'مكتملة' : 'Completed',
            type: 'purchase'
        };

        const driversQuery = await db.collection('drivers').where('userId', '==', userId).get();
        if (driversQuery.empty) {
            return ctx.reply(t.noDrivers);
        }

        let drivers = [];
        driversQuery.forEach(doc => drivers.push({ id: doc.id, name: doc.data().name }));

        if (drivers.length === 1) {
            const defaultDriverId = drivers[0].id;
            const docRef = db.collection('expenses').doc();
            await docRef.set({
                userId, driverId: defaultDriverId,
                ...formattedTransaction, receiptUrl: null, createdAt: FieldValue.serverTimestamp()
            });
            return ctx.reply(t.purchaseSingle(formattedTransaction.amount, formattedTransaction.shopName, drivers[0].name));
        }

        pendingTransactions.set(telegramUserId, { userId, transactions: [formattedTransaction] });
        const buttons = drivers.map(d => [Markup.button.callback(`🚗 ${d.name}`, `driver_${d.id}`)]);

        ctx.reply(t.purchaseMulti(formattedTransaction.shopName, formattedTransaction.amount, formattedTransaction.cardInfo), 
            Markup.inlineKeyboard(buttons)
        );

    } catch (error) {
        console.error(error);
        ctx.reply(t.sysError);
    }
});

bot.action(/^driver_(.+)$/, async (ctx) => {
    const driverId = ctx.match[1];
    const telegramUserId = ctx.from.id.toString();
    const userLang = ctx.from.language_code && ctx.from.language_code.startsWith('ar') ? 'ar' : 'en';
    const t = texts[userLang];

    const pendingData = pendingTransactions.get(telegramUserId);

    if (!pendingData) {
        return ctx.answerCbQuery(t.expiredCb, { show_alert: true });
    }

    const { userId, transactions } = pendingData;

    try {
        const batch = db.batch();
        transactions.forEach(tItem => {
            const docRef = db.collection('expenses').doc();
            batch.set(docRef, {
                userId, driverId,
                ...tItem, receiptUrl: null, createdAt: FieldValue.serverTimestamp()
            });
        });

        await batch.commit();
        pendingTransactions.delete(telegramUserId);

        ctx.editMessageText(t.savedSuccess(transactions[0].amount));
    } catch (error) {
        console.error(error);
        ctx.answerCbQuery(t.saveError, { show_alert: true });
    }
});

bot.launch();
console.log('Bot is running with multi-language support...');

const express = require('express');
const path = require('path');
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, '../')));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '../index.html'));
});

app.listen(PORT, () => {
    console.log(`🌐 Web server is listening on port ${PORT}`);
});