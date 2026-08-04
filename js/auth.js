import { auth } from './firebase-config.js';
import { 
    GoogleAuthProvider, signInWithPopup, onAuthStateChanged, signOut, 
    createUserWithEmailAndPassword, signInWithEmailAndPassword, updateProfile,
    sendEmailVerification, sendPasswordResetEmail
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";

const provider = new GoogleAuthProvider();

// ==========================================
// DOM Elements Definition
// ==========================================
const loginScreen = document.getElementById('login-screen');
const dashboardScreen = document.getElementById('dashboard-screen');
const themeToggleBtn = document.getElementById('theme-toggle');

// Form Containers
const loginFormContainer = document.getElementById('login-form-container');
const signupFormContainer = document.getElementById('signup-form-container');
const showSignupBtn = document.getElementById('show-signup');
const showLoginBtn = document.getElementById('show-login');

// Login Fields & Buttons
const emailLoginBtn = document.getElementById('email-login-btn');
const loginEmail = document.getElementById('login-email');
const loginPassword = document.getElementById('login-password');

// Signup Fields & Buttons
const emailSignupBtn = document.getElementById('email-signup-btn');
const signupName = document.getElementById('signup-name');
const signupEmail = document.getElementById('signup-email');
const signupPassword = document.getElementById('signup-password');
const signupPasswordConfirm = document.getElementById('signup-password-confirm');

const googleBtn = document.getElementById('google-login-btn');
const logoutBtn = document.getElementById('logout-btn');
const userNameEl = document.getElementById('user-name');
const userAvatarEl = document.getElementById('user-avatar');

// ==========================================
// Dynamic Forgot Password Injection
// ==========================================
window.addEventListener('DOMContentLoaded', () => {
    const isEn = document.documentElement.lang === 'en';
    const passwordInput = document.getElementById('login-password');
    if (passwordInput && !document.getElementById('forgot-password-wrapper')) {
        const wrapper = document.createElement('div');
        wrapper.id = 'forgot-password-wrapper';
        wrapper.style = "text-align: right; margin-top: -10px; margin-bottom: 15px;";
        wrapper.innerHTML = `<a href="#" id="forgot-password-link" style="color: var(--primary-accent); font-size: 13px; text-decoration: none; font-weight: bold;">${isEn ? 'Forgot Password?' : 'نسيت كلمة المرور؟'}</a>`;
        passwordInput.parentNode.insertBefore(wrapper, passwordInput.nextSibling);
    }
});

// Sync Forgot Password Link with Language Toggle
document.addEventListener('click', (e) => {
    const langBtn = e.target.closest('#lang-toggle');
    if (langBtn) {
        setTimeout(() => {
            const isEn = document.documentElement.lang === 'en';
            const fpLink = document.getElementById('forgot-password-link');
            if (fpLink) fpLink.textContent = isEn ? 'Forgot Password?' : 'نسيت كلمة المرور؟';
        }, 100);
    }
});

// ==========================================
// Helper: Inline Error Message Handler
// ==========================================
const showInlineError = (btnElement, originalHTML, errorMessage) => {
    btnElement.innerHTML = errorMessage;
    btnElement.style.background = 'var(--danger)';
    btnElement.style.borderColor = 'var(--danger)';
    
    // Revert button state after 4 seconds
    setTimeout(() => {
        btnElement.innerHTML = originalHTML;
        btnElement.style.background = '';
        btnElement.style.borderColor = '';
    }, 4000);
};

// ==========================================
// 1. Theme Management (Dark/Light Mode)
// ==========================================
const savedTheme = localStorage.getItem('app-theme') || 'light';
document.documentElement.setAttribute('data-theme', savedTheme);
themeToggleBtn.innerHTML = savedTheme === 'dark' ? '<i class="fa-solid fa-sun"></i>' : '<i class="fa-solid fa-moon"></i>';

themeToggleBtn.addEventListener('click', () => {
    const htmlEl = document.documentElement;
    const newTheme = htmlEl.getAttribute('data-theme') === 'light' ? 'dark' : 'light';
    htmlEl.setAttribute('data-theme', newTheme);
    localStorage.setItem('app-theme', newTheme); // Persist user preference
    themeToggleBtn.innerHTML = newTheme === 'dark' ? '<i class="fa-solid fa-sun"></i>' : '<i class="fa-solid fa-moon"></i>';
});

// ==========================================
// 2. Toggle Login/Signup Forms
// ==========================================
showSignupBtn.addEventListener('click', (e) => {
    e.preventDefault();
    if (loginFormContainer) loginFormContainer.classList.add('hidden');
    if (signupFormContainer) signupFormContainer.classList.remove('hidden');
});

showLoginBtn.addEventListener('click', (e) => {
    e.preventDefault();
    if (signupFormContainer) signupFormContainer.classList.add('hidden');
    if (loginFormContainer) loginFormContainer.classList.remove('hidden');
});

// ==========================================
// 3. Google Authentication
// ==========================================
googleBtn.addEventListener('click', async (e) => {
    e.preventDefault();
    const originalText = googleBtn.innerHTML;
    const isEn = document.documentElement.lang === 'en';
    
    try { 
        // التعديل السحري هنا
        await signInWithPopup(auth, provider); 
    } catch (error) { 
        showInlineError(googleBtn, originalText, isEn ? 'Authentication Failed ❌' : 'فشل الدخول ❌');
    }
});

// ==========================================
// 4. Email/Password Sign Up (With Verification)
// ==========================================
emailSignupBtn.addEventListener('click', async (e) => {
    e.preventDefault();
    const name = signupName.value.trim();
    const email = signupEmail.value.trim();
    const pass = signupPassword.value;
    const passConfirm = signupPasswordConfirm.value;
    
    const originalText = emailSignupBtn.innerHTML;
    const isEn = document.documentElement.lang === 'en';

    // Validate empty fields
    if (!name || !email || !pass || !passConfirm) {
        return showInlineError(emailSignupBtn, originalText, isEn ? 'Fill all fields!' : 'أكمل جميع الحقول!');
    }

    // Validate password match
    if (pass !== passConfirm) {
        return showInlineError(emailSignupBtn, originalText, isEn ? 'Passwords mismatch!' : 'كلمات المرور غير متطابقة!');
    }

    // Firebase enforces a minimum of 6 characters
    if (pass.length < 6) {
        return showInlineError(emailSignupBtn, originalText, isEn ? 'Password too short!' : 'كلمة المرور قصيرة!');
    }

    try {
        emailSignupBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';
        
        // Execute Firebase user creation
        const userCredential = await createUserWithEmailAndPassword(auth, email, pass);
        
        // Append display name to the user profile
        await updateProfile(userCredential.user, { displayName: name });
        
// Send Email Verification Link
        await sendEmailVerification(userCredential.user);

        // Force sign-out to prevent access until verified
        await signOut(auth);
        
        emailSignupBtn.innerHTML = isEn ? 'Verification Sent! Check Email ✔' : 'تم إرسال رابط التوثيق لإيميلك ✔';
        emailSignupBtn.style.background = '#2ecc71';
        
        // Explicitly clear all signup fields to prevent browser caching/autofill confusion
        signupName.value = '';
        signupEmail.value = '';
        signupPassword.value = '';
        signupPasswordConfirm.value = '';

        // Immediately switch to login tab and clean button state
        setTimeout(() => {
            emailSignupBtn.innerHTML = originalText;
            emailSignupBtn.style.background = '';
            
            // Switch view to login container
            signupFormContainer.classList.add('hidden');
            loginFormContainer.classList.remove('hidden');
            
            // Pre-fill the login email field with the registered email for smooth UX
            loginEmail.value = email;
            loginPassword.focus();
        }, 2000);
        
    } catch (error) {
        if (error.code === 'auth/email-already-in-use') {
            showInlineError(emailSignupBtn, originalText, isEn ? 'Email Taken!' : 'الإيميل مسجل مسبقاً!');
        } else if (error.code === 'auth/invalid-email') {
            showInlineError(emailSignupBtn, originalText, isEn ? 'Invalid Email!' : 'صيغة الإيميل خاطئة!');
        } else {
            showInlineError(emailSignupBtn, originalText, isEn ? 'Error ❌' : 'حدث خطأ ❌');
        }
    }
});

// ==========================================
// 5. Password Reset Request (Forgot Password)
// ==========================================
document.addEventListener('click', async (e) => {
    if (e.target && e.target.id === 'forgot-password-link') {
        e.preventDefault();
        const email = loginEmail.value.trim();
        const originalText = emailLoginBtn.innerHTML;
        const isEn = document.documentElement.lang === 'en';

        if (!email) {
            return showInlineError(emailLoginBtn, originalText, isEn ? 'Enter email first to reset!' : 'أدخل الإيميل أولاً لإرسال الرابط!');
        }

        try {
            emailLoginBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';
            await sendPasswordResetEmail(auth, email);
            
            emailLoginBtn.innerHTML = isEn ? 'Reset Link Sent! Check Email ✔' : 'تم إرسال رابط الاستعادة ✔';
            emailLoginBtn.style.background = '#2ecc71';
            
            setTimeout(() => {
                emailLoginBtn.innerHTML = originalText;
                emailLoginBtn.style.background = '';
            }, 4000);
        } catch (error) {
            showInlineError(emailLoginBtn, originalText, isEn ? 'Error sending link!' : 'خطأ! تأكد من صحة الإيميل.');
        }
    }
});

// ==========================================
// 6. Email/Password Login (Strict Verification Check)
// ==========================================
emailLoginBtn.addEventListener('click', async (e) => {
    e.preventDefault();
    const email = loginEmail.value.trim();
    const password = loginPassword.value;
    
    const originalText = emailLoginBtn.innerHTML;
    const isEn = document.documentElement.lang === 'en';
    
    if (!email || !password) {
        return showInlineError(emailLoginBtn, originalText, isEn ? 'Fill all fields!' : 'أكمل جميع الحقول!');
    }
    
    try {
        emailLoginBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';
        const userCredential = await signInWithEmailAndPassword(auth, email, password);
        
        // Security Gate: Block unverified emails
        if (!userCredential.user.emailVerified) {
            await signOut(auth); // Terminate session instantly
            return showInlineError(emailLoginBtn, originalText, isEn ? 'Verify your email first!' : 'يرجى توثيق الإيميل من بريدك أولاً!');
        }

        emailLoginBtn.innerHTML = isEn ? 'Welcome ✔' : 'تم الدخول ✔';
        emailLoginBtn.style.background = '#2ecc71';
        
    } catch (error) {
        if (error.code === 'auth/user-not-found' || error.code === 'auth/wrong-password' || error.code === 'auth/invalid-credential') {
            showInlineError(emailLoginBtn, originalText, isEn ? 'Wrong Credentials!' : 'البيانات غير صحيحة!');
        } else {
            showInlineError(emailLoginBtn, originalText, isEn ? 'Error ❌' : 'حدث خطأ ❌');
        }
    }
});

// ==========================================
// 7. Logout Handler
// ==========================================
logoutBtn.addEventListener('click', () => signOut(auth));

// ==========================================
// 8. Auth State Observer
// ==========================================
onAuthStateChanged(auth, (user) => {
    // Only permit access if user exists AND email is verified
    if (user && user.emailVerified) {
        loginScreen.classList.add('hidden');
        dashboardScreen.classList.remove('hidden');
        
        const displayName = user.displayName || user.email.split('@')[0];
        userNameEl.textContent = displayName;
        userAvatarEl.src = user.photoURL || "https://ui-avatars.com/api/?name=" + displayName + "&background=2563eb&color=fff";

        // Dispatch custom event to notify main app
        window.dispatchEvent(new CustomEvent('userLoggedIn', { detail: user }));
    } else {
        dashboardScreen.classList.add('hidden');
        loginScreen.classList.remove('hidden');
        
        const isEn = document.documentElement.lang === 'en';
        emailLoginBtn.innerHTML = isEn ? 'Login' : 'دخول';
        emailLoginBtn.style.background = '';
    }
});