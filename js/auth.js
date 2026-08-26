import { auth } from './firebase-config.js';
import { 
    GoogleAuthProvider, signInWithPopup, onAuthStateChanged, signOut, 
    createUserWithEmailAndPassword, signInWithEmailAndPassword, updateProfile 
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";

const provider = new GoogleAuthProvider();

// عناصر الواجهة
const loginScreen = document.getElementById('login-screen');
const dashboardScreen = document.getElementById('dashboard-screen');
const themeToggleBtn = document.getElementById('theme-toggle');

// حاويات النماذج
const loginFormContainer = document.getElementById('login-form-container');
const signupFormContainer = document.getElementById('signup-form-container');
const showSignupBtn = document.getElementById('show-signup');
const showLoginBtn = document.getElementById('show-login');

// أزرار وحقول الدخول
const emailLoginBtn = document.getElementById('email-login-btn');
const loginEmail = document.getElementById('login-email');
const loginPassword = document.getElementById('login-password');

// أزرار وحقول التسجيل
const emailSignupBtn = document.getElementById('email-signup-btn');
const signupName = document.getElementById('signup-name');
const signupEmail = document.getElementById('signup-email');
const signupPassword = document.getElementById('signup-password');
const signupPasswordConfirm = document.getElementById('signup-password-confirm');

const googleBtn = document.getElementById('google-login-btn');
const logoutBtn = document.getElementById('logout-btn');
const userNameEl = document.getElementById('user-name');
const userAvatarEl = document.getElementById('user-avatar');

// 1. الدارك مود
const savedTheme = localStorage.getItem('app-theme') || 'light';
document.documentElement.setAttribute('data-theme', savedTheme);
themeToggleBtn.innerHTML = savedTheme === 'dark' ? '<i class="fa-solid fa-sun"></i>' : '<i class="fa-solid fa-moon"></i>';

themeToggleBtn.addEventListener('click', () => {
    const htmlEl = document.documentElement;
    const newTheme = htmlEl.getAttribute('data-theme') === 'light' ? 'dark' : 'light';
    htmlEl.setAttribute('data-theme', newTheme);
    localStorage.setItem('app-theme', newTheme); // حفظ الخيار في المتصفح
    themeToggleBtn.innerHTML = newTheme === 'dark' ? '<i class="fa-solid fa-sun"></i>' : '<i class="fa-solid fa-moon"></i>';
});

// 2. التبديل بين شاشة الدخول والتسجيل
showSignupBtn.addEventListener('click', () => {
    loginFormContainer.classList.add('hidden');
    signupFormContainer.classList.remove('hidden');
});

showLoginBtn.addEventListener('click', () => {
    signupFormContainer.classList.add('hidden');
    loginFormContainer.classList.remove('hidden');
});

// 3. قوقل
googleBtn.addEventListener('click', async () => {
    try { await signInWithPopup(auth, provider); } 
    catch (error) { alert("فشل الدخول بحساب قوقل."); }
});

// 4. إنشاء حساب جديد (مع شروط الأمان)
emailSignupBtn.addEventListener('click', async () => {
    const name = signupName.value.trim();
    const email = signupEmail.value.trim();
    const pass = signupPassword.value;
    const passConfirm = signupPasswordConfirm.value;

    // التأكد من عدم وجود حقول فارغة
    if (!name || !email || !pass || !passConfirm) {
        return alert("الرجاء تعبئة جميع الحقول!");
    }

    // التأكد من تطابق كلمة المرور
    if (pass !== passConfirm) {
        return alert("كلمات المرور غير متطابقة، تأكد منها!");
    }

    // فحص قوة كلمة المرور (8 خانات على الأقل، حروف إنجليزية وأرقام)
    const strongRegex = /^(?=.*[A-Za-z])(?=.*\d).{8,}$/;
    if (!strongRegex.test(pass)) {
        return alert("كلمة المرور ضعيفة! يجب أن تكون 8 خانات على الأقل وتحتوي على أحرف إنجليزية وأرقام.");
    }

    try {
        emailSignupBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> جاري الإنشاء...';
        // إنشاء الحساب في فايربيس
        const userCredential = await createUserWithEmailAndPassword(auth, email, pass);
        
        // حفظ اسم المستخدم في بروفايله
        await updateProfile(userCredential.user, { displayName: name });
        
        // إعادة تعيين الزر
        emailSignupBtn.innerHTML = 'إنشاء الحساب';
    } catch (error) {
        emailSignupBtn.innerHTML = 'إنشاء الحساب';
        if(error.code === 'auth/email-already-in-use') alert("هذا الإيميل مسجل مسبقاً!");
        else alert("خطأ: " + error.message);
    }
});

// 5. تسجيل الدخول العادي
emailLoginBtn.addEventListener('click', async () => {
    const email = loginEmail.value.trim();
    const password = loginPassword.value;
    
    if (!email || !password) return alert("الرجاء إدخال البريد وكلمة المرور!");
    
    try {
        emailLoginBtn.innerHTML = "جاري الدخول...";
        await signInWithEmailAndPassword(auth, email, password);
    } catch (error) {
        emailLoginBtn.innerHTML = "دخول";
        alert("بيانات الدخول غير صحيحة!");
    }
});

// 6. تسجيل الخروج
logoutBtn.addEventListener('click', () => signOut(auth));

// 7. مراقب حالة المستخدم
onAuthStateChanged(auth, (user) => {
    if (user) {
        loginScreen.classList.add('hidden');
        dashboardScreen.classList.remove('hidden');
        
        const displayName = user.displayName || user.email.split('@')[0];
        userNameEl.textContent = displayName;
        userAvatarEl.src = user.photoURL || "https://ui-avatars.com/api/?name=" + displayName + "&background=2563eb&color=fff";

        window.dispatchEvent(new CustomEvent('userLoggedIn', { detail: user }));
    } else {
        dashboardScreen.classList.add('hidden');
        loginScreen.classList.remove('hidden');
        emailLoginBtn.innerHTML = "دخول";
    }
});