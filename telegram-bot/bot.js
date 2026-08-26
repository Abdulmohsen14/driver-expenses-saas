require('dotenv').config();
const { Telegraf, Markup } = require('telegraf'); 
const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');

// =========================================================================
// 1. إعدادات الاتصال بقاعدة البيانات (مخفية وآمنة 100%)
// =========================================================================
const serviceAccount = require('./serviceAccountKey.json');

initializeApp({ credential: cert(serviceAccount) });
const db = getFirestore();

// توكن البوت (يفضل مستقبلاً تحطه في ملف .env أيضاً لمزيد من الأمان)
const bot = new Telegraf('8927972087:AAGt8Y1x9tKDQUy3koQvA9ICfn2sLEaZ3-M');

// =========================================================================
// 2. ذاكرة مؤقتة لحفظ العمليات حتى يختار المستخدم السائق
// =========================================================================
const pendingTransactions = new Map();

// =========================================================================
// 3. المحلل المالي الذكي (The Smart Parser - SaaS Level)
// =========================================================================
function smartBankParser(message) {
    // توحيد النص وتجهيزه
    const cleanText = message.replace(/\n/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();

    const result = {
        type: 'UNKNOWN',
        amount: 0,
        merchant: 'غير معروف',
        cardLast4: null,
        isCashback: false,
        rawDate: null
    };

    // تحديد نوع العملية
    const cashbackKeywords = /كاش باك|استرجاع|مكافأة|مستردة|رد مبلغ|cashback|refund|reversal/;
    if (cashbackKeywords.test(cleanText)) {
        result.type = 'CASHBACK';
        result.isCashback = true;
    } else if (/شراء|دفع|pos|purchase|pay/.test(cleanText)) {
        result.type = 'PURCHASE';
    }

    // استخراج المبلغ
    const amountRegex = /(?:sar|ريال|ر\.س|مبلغ|بـ|مال|money)?\s*(\d+(?:\.\d{1,2})?)\s*(?:sar|ريال|ر\.س)?/gi;
    let amounts = [];
    let match;
    while ((match = amountRegex.exec(cleanText)) !== null) {
        amounts.push(parseFloat(match[1]));
    }
    if (amounts.length > 0) {
        result.amount = amounts[0]; // نأخذ أول مبلغ (غالباً مبلغ الشراء وليس الرصيد المتبقي)
    }

    // استخراج آخر 4 أرقام من البطاقة
    const cardRegex = /(?:بطاقة|إئتمانية|مدى|حساب|فيزا|ماستر|card|acct|x|[*#-])\s*(\d{4})\b/;
    const cardMatch = cleanText.match(cardRegex);
    if (cardMatch) result.cardLast4 = cardMatch[1];

    // استخراج اسم المحل
    const merchantRegex = /(?:من|at)\s+([a-z\u0600-\u06FF\s]+)(?=\s+(?:بـ|في|بطاقة|إئتمانية|sar|ريال|ر\.س|\d))/i;
    const merchantMatch = cleanText.match(merchantRegex);
    if (merchantMatch && merchantMatch[1]) {
        result.merchant = merchantMatch[1].trim();
    }

    return result;
}

// =========================================================================
// 4. محرك ربط الكاش باك المبدئي (The Time-Travel Linker)
// =========================================================================
async function processCashbackMessage(parsedMessage, driverId) {
    if (!parsedMessage.isCashback) return;

    console.log(`⏳ جاري البحث عن العملية الأصلية لربط الكاش باك (مبلغ: ${parsedMessage.amount})...`);

    // (سيتم تطوير هذا الجزء لاحقاً للبحث المتقدم في فايربيس وخصم المبلغ من فاتورة قديمة)
    const foundOriginalTransaction = {
        id: "EXP_9921",
        merchant: "ALDREES",
        amount: 100.00,
        date: "2026-08-01",
        cashbackReceived: false
    };

    if (foundOriginalTransaction) {
        console.log(`✅ تم الاصطياد! هذا الكاش باك يتبع لعملية ${foundOriginalTransaction.merchant}.`);
    } else {
        console.log(`⚠️ تم تسجيل الكاش باك، لكن لم نجد عملية سابقة مطابقة.`);
    }
}

// =========================================================================
// 5. أوامر البوت الأساسية (ربط الحساب)
// =========================================================================
bot.start(async (ctx) => {
    const payload = ctx.startPayload; 
    const telegramId = ctx.from.id;

    if (payload) {
        try {
            const userRef = db.collection('users').doc(payload);
            await userRef.set({ telegramId: telegramId.toString() }, { merge: true });
            
            ctx.reply('✅ تم ربط حسابك بنجاح!\n\nأرسل رسائل البنك هنا، وسأقوم بفرزها وسؤالك عن السائق الذي تود إضافتها إليه.');
        } catch (error) {
            console.error("Error linking account:", error);
            ctx.reply('❌ حدث خطأ أثناء الربط، يرجى المحاولة مرة أخرى.');
        }
    } else {
        ctx.reply('مرحباً بك! 🚗\nلتفعيل البوت، يرجى الذهاب إلى لوحة التحكم في الموقع والضغط على "ربط الحساب".');
    }
});

// =========================================================================
// 6. العقل المدبر: استقبال الرسائل، التحليل الذكي، وإظهار أزرار السائقين
// =========================================================================
bot.on('text', async (ctx) => {
    const text = ctx.message.text;
    const telegramUserId = ctx.from.id.toString();

    if (text.startsWith('/start')) return; 

    ctx.reply('⏳ جاري التحليل الذكي للعملية...');

    try {
        // التحقق من أن المستخدم مربوط
        const userQuery = await db.collection('users').where('telegramId', '==', telegramUserId).get();
        if (userQuery.empty) {
            return ctx.reply('⚠️ حسابك غير مربوط. يرجى ربط حسابك من إعدادات الموقع أولاً.');
        }

        const userId = userQuery.docs[0].id;

        // رمي النص في المحلل الذكي
        const parsedData = smartBankParser(text);
        
        if (parsedData.amount === 0) {
            return ctx.reply('❌ لم أتمكن من استخراج المبلغ، الرجاء التأكد من صيغة الرسالة.');
        }

        // مسار الكاش باك
        if (parsedData.isCashback) {
            ctx.reply(`✅ تم رصد استرجاع/كاش باك!\nالمبلغ: ${parsedData.amount} SAR\nالبطاقة: ${parsedData.cardLast4}\n\n⏳ جاري البحث لربطه بالعمليات السابقة...`);
            await processCashbackMessage(parsedData, telegramUserId);
            return; // إنهاء التنفيذ هنا حتى لا يسأل عن السائق
        }

        // مسار المشتريات وتجهيز البيانات لواجهة الموقع
        const formattedTransaction = {
            shopName: parsedData.merchant || 'متجر غير معروف',
            amount: parsedData.amount,
            currency: 'SAR',
            cashback: 0,
            date: new Date().toISOString().split('T')[0], // نأخذ تاريخ اليوم
            cardInfo: parsedData.cardLast4 || '----',
            status: 'مكتملة',
            type: 'purchase'
        };

        // جلب قائمة السائقين
        const driversQuery = await db.collection('drivers').where('userId', '==', userId).get();
        if (driversQuery.empty) {
            return ctx.reply('⚠️ لم تقم بإضافة أي سائق في الموقع حتى الآن! أضف سائقاً لتسجيل المصاريف.');
        }

        let drivers = [];
        driversQuery.forEach(doc => drivers.push({ id: doc.id, name: doc.data().name }));

        // إضافة تلقائية إذا كان هناك سائق واحد فقط
        if (drivers.length === 1) {
            const defaultDriverId = drivers[0].id;
            const docRef = db.collection('expenses').doc();
            await docRef.set({
                userId, driverId: defaultDriverId,
                ...formattedTransaction, receiptUrl: null, createdAt: FieldValue.serverTimestamp()
            });
            return ctx.reply(`✅ تم بنجاح! رصدت مبلغ ${formattedTransaction.amount} ريال من ${formattedTransaction.shopName}، وتمت إضافتها للسائق الوحيد: ${drivers[0].name}`);
        }

        // إذا كان هناك أكثر من سائق، نعرض الأزرار
        pendingTransactions.set(telegramUserId, { userId, transactions: [formattedTransaction] });

        const buttons = drivers.map(d => [Markup.button.callback(`🚗 ${d.name}`, `driver_${d.id}`)]);

        ctx.reply(`✅ رصدت عملية شراء!\nالمحل: ${formattedTransaction.shopName}\nالمبلغ: ${formattedTransaction.amount} SAR\nالبطاقة: ${formattedTransaction.cardInfo}\n\n👇 اختر السائق الذي تود تسجيل العملية عليه:`, 
            Markup.inlineKeyboard(buttons)
        );

    } catch (error) {
        console.error("خطأ في نظام البوت:", error);
        ctx.reply('❌ حدث خطأ في النظام أثناء معالجة العملية.');
    }
});

// =========================================================================
// 7. استجابة البوت عند ضغط المستخدم على زر السائق
// =========================================================================
bot.action(/^driver_(.+)$/, async (ctx) => {
    const driverId = ctx.match[1];
    const telegramUserId = ctx.from.id.toString();

    const pendingData = pendingTransactions.get(telegramUserId);

    if (!pendingData) {
        return ctx.answerCbQuery('⚠️ انتهت صلاحية هذه العملية أو تمت إضافتها مسبقاً.', { show_alert: true });
    }

    const { userId, transactions } = pendingData;

    try {
        const batch = db.batch();
        transactions.forEach(t => {
            const docRef = db.collection('expenses').doc();
            batch.set(docRef, {
                userId, driverId,
                ...t, receiptUrl: null, createdAt: FieldValue.serverTimestamp()
            });
        });

        await batch.commit();
        pendingTransactions.delete(telegramUserId);

        ctx.editMessageText(`✅ ممتاز! تم حفظ عملية بقيمة ${transactions[0].amount} ريال بنجاح في حساب السائق المحدد.`);
    } catch (error) {
        console.error("Error saving batch:", error);
        ctx.answerCbQuery('❌ حدث خطأ أثناء الحفظ.', { show_alert: true });
    }
});

// تشغيل البوت
bot.launch();
console.log('🤖 Telegram Bot is running with Smart Parser & Interactive Driver Selection...');