require('dotenv').config();
const { Telegraf, Markup } = require('telegraf'); 
const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');

// =========================================================================
// 1. إعدادات الاتصال بقاعدة البيانات (مخفية وآمنة 100%)
// =========================================================================
// السطر هذا بيسحب المفتاح السري من الملف الخارجي بدون ما يظهر في الكود
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
// 3. المحلل المالي الذكي (SaaS Level Parser) - إصدار خالي من الأخطاء 100%
// =========================================================================
function parseBankMessages(text) {
    try {
        const arabicNumbers = [/٠/g, /١/g, /٢/g, /٣/g, /٤/g, /٥/g, /٦/g, /٧/g, /٨/g, /٩/g];
        for (let i = 0; i < 10; i++) { text = text.replace(arabicNumbers[i], i); }

        let lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);
        let purchases = [];
        let cashbacks = [];
        let currentEvent = null;

        // 🔥 الدالة المنقذة: تحفظ الحدث السابق في مكانه الصح بدون ما تمسح أي كاش باك
        const saveEvent = () => {
            if (currentEvent && currentEvent.amount) {
                if (currentEvent.type === 'purchase') purchases.push(currentEvent);
                if (currentEvent.type === 'cashback') cashbacks.push(currentEvent);
            }
        };

        for (let i = 0; i < lines.length; i++) {
            let line = lines[i];
            
            if (/^(شراء|دفع|سحب|Purchase|POS)/i.test(line)) {
                saveEvent(); // نحفظ الحدث اللي قبله
                currentEvent = { type: 'purchase', raw: line };
                continue;
            }
            
            if (/^(استرجاع|Cashback|مكافأة)/i.test(line)) {
                saveEvent(); // نحفظ الحدث اللي قبله
                currentEvent = { type: 'cashback', raw: line };
                continue;
            }

            if (!currentEvent) continue;

            if (!currentEvent.amount && /(?:بـ|مبلغ|Amount)\s*([\d\.,]+)\s*([A-Za-zأ-ي]+)?/i.test(line)) {
                let match = line.match(/(?:بـ|مبلغ|Amount)\s*([\d\.,]+)\s*([A-Za-zأ-ي]+)?/i);
                currentEvent.amount = parseFloat(match[1].replace(/,/g, ''));
                currentEvent.currency = match[2] ? match[2].toUpperCase() : 'SAR'; 
                continue;
            }

            if (currentEvent.type === 'purchase' && !currentEvent.shop && /^(?:من|at)\s+(.+)/i.test(line)) {
                currentEvent.shop = line.match(/^(?:من|at)\s+(.+)/i)[1].trim();
                continue;
            }

            if (!currentEvent.card && /(?:بطاقة|بطاقه|إئتمانية|ائتمانية|حساب|\*+|x+)\s*(?:\**)\s*(\d{4})/i.test(line)) {
                currentEvent.card = line.match(/(?:بطاقة|بطاقه|إئتمانية|ائتمانية|حساب|\*+|x+)\s*(?:\**)\s*(\d{4})/i)[1];
                continue;
            }

            if (!currentEvent.datetime && /(?:في|on)\s+(\d{2,4}[\/\-]\d{1,2}[\/\-]\d{1,2})\s+(\d{1,2}:\d{2})/i.test(line)) {
                let match = line.match(/(?:في|on)\s+(\d{2,4}[\/\-]\d{1,2}[\/\-]\d{1,2})\s+(\d{1,2}:\d{2})/i);
                let dateParts = match[1].split(/[\/\-]/);
                
                if (dateParts[2].length === 2) {
                    currentEvent.date = `20${dateParts[2]}-${dateParts[1]}-${dateParts[0]}`; 
                } else {
                    currentEvent.date = match[1]; 
                }
                
                currentEvent.time = match[2];
                currentEvent.datetime = `${currentEvent.date}T${currentEvent.time}:00`;
                continue;
            }
        }
        
        saveEvent(); // 🔥 لا تنسى تحفظ آخر حدث في الرسالة بعد ما يخلص اللوب
        
        let finalTransactions = [];
        
        purchases.forEach(p => {
            let matchedCashbackAmount = 0;
            let usedCashbackIndex = -1;
            
            for (let i = 0; i < cashbacks.length; i++) {
                let cb = cashbacks[i];
                
                let isCardMatch = (cb.card === p.card);
                // 🔥 استخدمنا Math.abs عشان لو جا الكاش باك قبل أو بعد ما يهم، ووسعنا الوقت لـ 5 دقايق
                let timeDiffMinutes = Math.abs(new Date(cb.datetime).getTime() - new Date(p.datetime).getTime()) / (1000 * 60);
                let isTimeMatch = (timeDiffMinutes <= 5);

                if ((isCardMatch && isTimeMatch) || (!p.card && isTimeMatch && cb.amount > 0)) {
                    matchedCashbackAmount = cb.amount;
                    usedCashbackIndex = i;
                    break; 
                }
            }
            
            finalTransactions.push({
                shopName: p.shop || 'متجر غير معروف',
                amount: p.amount,
                currency: p.currency || 'SAR',      
                cashback: matchedCashbackAmount,    
                date: p.date,                       
                cardInfo: p.card || '----',         
                status: 'مكتملة'                    
            });
            
            if (usedCashbackIndex > -1) {
                cashbacks.splice(usedCashbackIndex, 1);
            }
        });

        return finalTransactions;
    } catch (error) {
        console.error("خطأ في تحليل الرسائل:", error);
        return []; 
    }
}
// =========================================================================
// 4. أوامر البوت الأساسية
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
// 5. استقبال الرسائل وإظهار قائمة السائقين (الذكاء التفاعلي)
// =========================================================================
bot.on('text', async (ctx) => {
    const text = ctx.message.text;
    const telegramUserId = ctx.from.id.toString();

    if (text.startsWith('/start')) return; 

    ctx.reply('⏳ جاري تحليل العمليات...');

    try {
        const userQuery = await db.collection('users').where('telegramId', '==', telegramUserId).get();
        if (userQuery.empty) {
            return ctx.reply('⚠️ حسابك غير مربوط. يرجى ربط حسابك من إعدادات الموقع أولاً.');
        }

        const userId = userQuery.docs[0].id;

        const transactions = parseBankMessages(text);
        if (transactions.length === 0) {
            return ctx.reply('❌ لم أتمكن من التعرف على أي عملية صحيحة.');
        }

        const driversQuery = await db.collection('drivers').where('userId', '==', userId).get();
        if (driversQuery.empty) {
            return ctx.reply('⚠️ لم تقم بإضافة أي سائق في الموقع حتى الآن! أضف سائقاً أولاً لكي أتمكن من تسجيل المصاريف عليه.');
        }

        let drivers = [];
        driversQuery.forEach(doc => drivers.push({ id: doc.id, name: doc.data().name }));

        if (drivers.length === 1) {
            const defaultDriverId = drivers[0].id;
            const batch = db.batch();
            transactions.forEach(t => {
                const docRef = db.collection('expenses').doc();
                batch.set(docRef, {
                    userId, driverId: defaultDriverId,
                    ...t, receiptUrl: null, createdAt: FieldValue.serverTimestamp()
                });
            });
            await batch.commit();
            return ctx.reply(`✅ تم بنجاح! إضافة ${transactions.length} عملية للسائق الوحيد لديك: ${drivers[0].name}`);
        }

        pendingTransactions.set(telegramUserId, { userId, transactions });

        const buttons = drivers.map(d => [Markup.button.callback(`🚗 ${d.name}`, `driver_${d.id}`)]);

        ctx.reply(`🔍 حلّلت ${transactions.length} عملية جاهزة للإضافة.\n\n👇 الرجاء اختيار السائق الذي تود تسجيل هذه العمليات في حسابه:`, 
            Markup.inlineKeyboard(buttons)
        );

    } catch (error) {
        console.error(error);
        ctx.reply('❌ حدث خطأ في النظام.');
    }
});

// =========================================================================
// 6. استجابة البوت عند ضغط المستخدم على زر السائق
// =========================================================================
bot.action(/^driver_(.+)$/, async (ctx) => {
    const driverId = ctx.match[1];
    const telegramUserId = ctx.from.id.toString();

    const pendingData = pendingTransactions.get(telegramUserId);

    if (!pendingData) {
        return ctx.answerCbQuery('⚠️ انتهت صلاحية هذه العمليات أو تمت إضافتها مسبقاً. أرسل الرسائل مرة أخرى.', { show_alert: true });
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

        ctx.editMessageText(`✅ ممتاز! تم حفظ ${transactions.length} عملية بنجاح في حساب السائق المحدد.`);
    } catch (error) {
        console.error("Error saving batch:", error);
        ctx.answerCbQuery('❌ حدث خطأ أثناء الحفظ.', { show_alert: true });
    }
});

bot.launch();
console.log('🤖 Telegram Bot is running with Interactive Driver Selection...');