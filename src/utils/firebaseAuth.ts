import { initializeApp, getApps, getApp } from 'firebase/app';
import {
  getAuth,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  updateProfile,
  onAuthStateChanged,
  User,
  signOut,
  sendPasswordResetEmail,
  sendSignInLinkToEmail,
  isSignInWithEmailLink,
  signInWithEmailLink,
} from 'firebase/auth';
import {
  initializeFirestore,
  setLogLevel,
  doc,
  getDoc,
  setDoc,
  collection,
  query,
  where,
  getDocs,
  limit,
  updateDoc,
} from 'firebase/firestore';
import { AuthorizedUser, UserRole, UserStatus } from '../types';
import { saveAuthorizedUserLocal, getAllAuthorizedUsersLocal } from '../db/storage';
import firebaseConfig from '../../firebase-applet-config.json';

// Configure log level to silent to prevent internal transport connection warning alerts
try {
  setLogLevel('silent');
} catch {
  // ignore
}

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}

export function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo: auth.currentUser?.providerData?.map((provider) => ({
        providerId: provider.providerId,
        email: provider.email,
      })) || [],
    },
    operationType,
    path,
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

// Canonical Firestore named database ID provisioned for this application
export const FIRESTORE_DATABASE_ID =
  (firebaseConfig as any).firestoreDatabaseId ||
  'ai-studio-assuredcapture-513bf318-4d91-47b0-86f4-2eddbb15e73f';

// Initialize Firebase App singleton safely
const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();
export const auth = getAuth(app);

// Initialize Firestore using the configured database ID with resilient long polling
export const db = initializeFirestore(
  app,
  {
    experimentalForceLongPolling: true,
  },
  FIRESTORE_DATABASE_ID
);

// ==========================================
// ADMIN & AUTHORIZED USERS MANAGEMENT
// ==========================================

export const INITIAL_ADMIN_EMAIL = 'ottomake2026@gmail.com';

/**
 * Safely bootstraps the initial Administrator account in Firestore.
 * Ensures the first admin account is established upon first sign in.
 */
export const bootstrapInitialAdminAccount = async (currentUser: User): Promise<AuthorizedUser | null> => {
  if (!currentUser || !currentUser.email) return null;
  const email = currentUser.email.trim().toLowerCase();

  const isAdminEmail = email === INITIAL_ADMIN_EMAIL;

  try {
    // Check if record exists in Firestore `authorized_users/{uid}`
    const adminDocRef = doc(db, 'authorized_users', currentUser.uid);
    const adminDocSnap = await getDoc(adminDocRef);

    if (adminDocSnap.exists()) {
      const data = adminDocSnap.data() as AuthorizedUser;
      await saveAuthorizedUserLocal(data);
      return data;
    }

    // Check if record exists by email match
    const emailQuery = query(collection(db, 'authorized_users'), where('email', '==', email), limit(1));
    const emailSnap = await getDocs(emailQuery);

    if (!emailSnap.empty) {
      const existingDoc = emailSnap.docs[0];
      const data = existingDoc.data() as AuthorizedUser;
      const updated: AuthorizedUser = {
        ...data,
        userId: currentUser.uid,
        updatedAt: new Date().toISOString(),
      };
      if (isAdminEmail) {
        updated.role = 'admin';
        updated.status = 'Active';
      }
      await setDoc(doc(db, 'authorized_users', existingDoc.id), updated, { merge: true });
      await saveAuthorizedUserLocal(updated);
      return updated;
    }

    // If this is the primary operator or first admin signing in, create initial active Admin record
    if (isAdminEmail) {
      const newAdminRecord: AuthorizedUser = {
        id: currentUser.uid,
        userId: currentUser.uid,
        name: currentUser.displayName || 'Otto Admin',
        email,
        role: 'admin',
        status: 'Active',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      await setDoc(doc(db, 'authorized_users', currentUser.uid), newAdminRecord);
      await saveAuthorizedUserLocal(newAdminRecord);
      return newAdminRecord;
    }
  } catch (err) {
    console.warn('Bootstrap admin account note:', err);
  }

  return null;
};

/**
 * Fetches all authorized user records from Firestore for the Admin Users page.
 */
export const fetchAuthorizedUsersFromFirestore = async (): Promise<AuthorizedUser[]> => {
  try {
    const q = collection(db, 'authorized_users');
    const snapshot = await getDocs(q);
    const users: AuthorizedUser[] = snapshot.docs.map((docSnap) => ({
      id: docSnap.id,
      ...(docSnap.data() as Omit<AuthorizedUser, 'id'>),
    }));

    users.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    // Sync to local cache
    for (const u of users) {
      await saveAuthorizedUserLocal(u);
    }

    return users;
  } catch (err) {
    handleFirestoreError(err, OperationType.LIST, 'authorized_users');
    return [];
  }
};

/**
 * Creates or updates an authorized user record in Firestore.
 */
export const saveAuthorizedUserRecord = async (userRecord: AuthorizedUser): Promise<void> => {
  try {
    const docRef = doc(db, 'authorized_users', userRecord.id);
    const payload = {
      ...userRecord,
      updatedAt: new Date().toISOString(),
    };
    await setDoc(docRef, payload, { merge: true });
    await saveAuthorizedUserLocal(payload);
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, `authorized_users/${userRecord.id}`);
  }
};

/**
 * Retrieves the authorization record for a user to verify status and role.
 */
export const getUserAuthorizationRecord = async (user: User): Promise<AuthorizedUser | null> => {
  if (!user || !user.email) return null;
  const email = user.email.trim().toLowerCase();

  try {
    const docRef = doc(db, 'authorized_users', user.uid);
    const docSnap = await getDoc(docRef);
    if (docSnap.exists()) {
      return docSnap.data() as AuthorizedUser;
    }

    const emailQuery = query(collection(db, 'authorized_users'), where('email', '==', email), limit(1));
    const emailSnap = await getDocs(emailQuery);
    if (!emailSnap.empty) {
      return emailSnap.docs[0].data() as AuthorizedUser;
    }
  } catch (e) {
    console.warn('Failed to fetch user authorization record:', e);
  }

  if (email === INITIAL_ADMIN_EMAIL) {
    return bootstrapInitialAdminAccount(user);
  }

  return null;
};

/**
 * Verifies that the authenticated user is an authorized Assured Capture account.
 * Because Firebase Email Link can authenticate previously unregistered emails,
 * this gate protects against unauthorized public access and blocks disabled users.
 */
export const checkUserAuthorized = async (user: User): Promise<boolean> => {
  if (!user || !user.email) return false;
  const email = user.email.trim().toLowerCase();

  // 1. Check Firestore authorized_users record
  const authRecord = await getUserAuthorizationRecord(user);
  if (authRecord) {
    if (authRecord.status === 'Disabled') {
      console.warn(`Access denied: User ${email} is disabled.`);
      return false;
    }
    return true;
  }

  // 2. Primary admin fallback
  if (email === INITIAL_ADMIN_EMAIL) {
    await bootstrapInitialAdminAccount(user);
    return true;
  }

  // 3. Check if user profile already exists in Firestore `users/{userId}`
  try {
    const userDocRef = doc(db, 'users', user.uid);
    const userDocSnap = await getDoc(userDocRef);
    if (userDocSnap.exists()) {
      return true;
    }
  } catch (e) {
    console.warn('Authorization check note (users collection):', e);
  }

  // 4. Check if user has existing reports in Firestore database
  try {
    const reportsQuery = query(collection(db, 'reports'), where('userId', '==', user.uid), limit(1));
    const reportsSnap = await getDocs(reportsQuery);
    if (!reportsSnap.empty) {
      return true;
    }
  } catch (e) {
    console.warn('Authorization check note (reports collection):', e);
  }

  return false;
};

// Email Link Auth Helpers
export const EMAIL_FOR_SIGN_IN_STORAGE_KEY = 'assured_capture_email_for_signin';

export const sendAccessLinkToEmail = async (email: string): Promise<void> => {
  const cleanEmail = email.trim().toLowerCase();
  const actionCodeSettings = {
    url: window.location.origin + window.location.pathname,
    handleCodeInApp: true,
  };
  await sendSignInLinkToEmail(auth, cleanEmail, actionCodeSettings);
  try {
    window.localStorage.setItem(EMAIL_FOR_SIGN_IN_STORAGE_KEY, cleanEmail);
  } catch (err) {
    console.warn('LocalStorage saving note:', err);
  }
};

export const isEmailSignInLink = (url: string = window.location.href): boolean => {
  return isSignInWithEmailLink(auth, url);
};

export const completeEmailSignIn = async (email: string, href: string = window.location.href): Promise<User | null> => {
  const result = await signInWithEmailLink(auth, email.trim(), href);
  return result.user;
};

export const initAuth = (callback: (user: User | null) => void): (() => void) => {
  return onAuthStateChanged(auth, callback);
};

// Email & Password Sign In (kept for backward compatibility & transition)
export const emailSignIn = async (email: string, password: string): Promise<User> => {
  const userCredential = await signInWithEmailAndPassword(auth, email.trim(), password);
  return userCredential.user;
};

// Email & Password Account Registration (kept for administrative creation if needed)
export const emailSignUp = async (email: string, password: string, displayName?: string): Promise<User> => {
  const userCredential = await createUserWithEmailAndPassword(auth, email.trim(), password);
  if (displayName && userCredential.user) {
    await updateProfile(userCredential.user, { displayName });
  }
  return userCredential.user;
};

// Password reset recovery
export const sendPasswordReset = async (email: string): Promise<void> => {
  await sendPasswordResetEmail(auth, email.trim());
};

// Secure sign out
export const logout = async () => {
  await signOut(auth);
};
