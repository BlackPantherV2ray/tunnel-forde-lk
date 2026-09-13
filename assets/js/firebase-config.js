// Firebase configuration for Tunnel Forde LK
// Replace these placeholders with your actual keys from Firebase Console -> Project Settings
const firebaseConfig = {
    apiKey: "your-api-key-here",
    authDomain: "your-project-id.firebaseapp.com",
    projectId: "your-project-id",
    storageBucket: "your-project-id.appspot.com",
    messagingSenderId: "your-messaging-sender-id",
    appId: "your-app-id"
};

// Initialize Firebase if not already initialized
if (!firebase.apps.length) {
    firebase.initializeApp(firebaseConfig);
}

// Global references for database, storage, and authentication
const db = firebase.firestore();
const storage = firebase.storage();
const auth = firebase.auth();
