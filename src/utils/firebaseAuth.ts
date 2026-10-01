import { initializeApp, getApps, getApp } from 'firebase/app';
import {
  getAuth,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  updateProfile,
  onAuthStateChanged,
  User,
  signOut,
} from 'firebase/auth';
import { initializeFirestore, setLogLevel } from 'firebase/firestore';
import firebaseConfig from '../../firebase-applet-config.json';

// Configure log level to silent to prevent internal transport connection warning alerts
try {
  setLogLevel('silent');
} catch {
  // ignore
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

// Listen to Firebase Auth state across app reloads & sessions
export const initAuth = (
  onAuthUserChanged: (user: User | null) => void
) => {
  return onAuthStateChanged(auth, (user: User | null) => {
    onAuthUserChanged(user);
  });
};

// Email & Password Sign In
export const emailSignIn = async (email: string, password: string):Promise<User> => {
  const userCredential = await signInWithEmailAndPassword(auth, email.trim(), password);
  return userCredential.user;
};

// Email & Password Account Registration
export const emailSignUp = async (email: string, password: string, displayName?: string): Promise<User> => {
  const userCredential = await createUserWithEmailAndPassword(auth, email.trim(), password);
  if (displayName && userCredential.user) {
    await updateProfile(userCredential.user, { displayName });
  }
  return userCredential.user;
};

// Secure sign out
export const logout = async () => {
  await signOut(auth);
};
