import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { getStorage } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-storage.js";

// ضع بيانات مشروعك هنا
    const firebaseConfig = {
        apiKey: "AIzaSyDOrmB5AjHRrY8fx-RmCRZRFMmig43KNVE",
        authDomain: "driver-expenses.firebaseapp.com",
        projectId: "driver-expenses",
        storageBucket: "driver-expenses.firebasestorage.app",
        messagingSenderId: "63457030238",
        appId: "1:63457030238:web:eb4677da50ba83d1bb84cf",
        measurementId: "G-LZKEDHK0WF"
    };


// تهيئة النظام
const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
export const storage = getStorage(app);