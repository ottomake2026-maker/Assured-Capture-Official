import { initializeApp, getApps } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import path from 'path';
import fs from 'fs';

let firebaseConfig: Record<string, any> = {};
try {
  const configPath = path.resolve(process.cwd(), 'firebase-applet-config.json');
  if (fs.existsSync(configPath)) {
    firebaseConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  }
} catch (e) {
  console.warn('[Admin Service] Notice reading firebase-applet-config.json:', e);
}

const projectId = firebaseConfig.projectId || 'gen-lang-client-0759396865';

// Initialize Firebase Admin with Application Default Credentials (ADC)
const app = getApps().length === 0
  ? initializeApp({
      projectId,
    })
  : getApps()[0];

export const adminAuth = getAuth(app);
export const adminFirestore = getFirestore(app, firebaseConfig.firestoreDatabaseId);

export const PRIMARY_ADMIN_EMAIL = 'ottomake2026@gmail.com';

/**
 * Secure server-side helper to verify whether an authenticated request's Firebase ID token has the admin claim.
 * Strictly checks decoded.admin === true without any email address fallback.
 */
export async function verifyAdminToken(idToken: string): Promise<{ uid: string; email?: string } | null> {
  if (!idToken) return null;
  try {
    const decoded = await adminAuth.verifyIdToken(idToken);
    if (decoded.admin === true) {
      return {
        uid: decoded.uid,
        email: decoded.email,
      };
    }
    return null;
  } catch {
    return null;
  }
}
