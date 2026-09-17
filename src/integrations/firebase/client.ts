// Firebase — единственный бэкенд проекта (аутентификация, база, файлы).
import { initializeApp, getApps, type FirebaseApp } from "firebase/app";
import { getAuth, type Auth } from "firebase/auth";
import { getFirestore, type Firestore } from "firebase/firestore";
import { getStorage, type FirebaseStorage } from "firebase/storage";

export const firebaseConfig = {
  apiKey: "AIzaSyAQGwGiDU-oNr6nh6DiqlQlKG48zicbuK4",
  authDomain: "skladnow-6d2fb.firebaseapp.com",
  projectId: "skladnow-6d2fb",
  storageBucket: "skladnow-6d2fb.firebasestorage.app",
  messagingSenderId: "1050744102177",
  appId: "1:1050744102177:web:548e60e1baa81b132e7260",
};

let _app: FirebaseApp | undefined;
export function fbApp(): FirebaseApp {
  if (!_app) _app = getApps()[0] ?? initializeApp(firebaseConfig);
  return _app;
}

let _auth: Auth | undefined;
export function fbAuth(): Auth {
  if (!_auth) _auth = getAuth(fbApp());
  return _auth;
}

let _fs: Firestore | undefined;
export function fbFirestore(): Firestore {
  if (!_fs) _fs = getFirestore(fbApp());
  return _fs;
}

let _st: FirebaseStorage | undefined;
export function fbStorage(): FirebaseStorage {
  if (!_st) _st = getStorage(fbApp());
  return _st;
}
