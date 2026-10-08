import express from 'express';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { initializeApp, getApps, getApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load firebase configuration safely
const configPath = path.join(__dirname, 'firebase-applet-config.json');
let firebaseConfig: any = { projectId: 'ai-studio-assuredcapture' };
try {
  if (fs.existsSync(configPath)) {
    firebaseConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  }
} catch (e) {
  console.warn('Notice loading firebase-applet-config.json:', e);
}

// Initialize Firebase Admin with project ID and configured firestore database
const adminApp = getApps().length === 0
  ? initializeApp({
      projectId: firebaseConfig.projectId || 'ai-studio-assuredcapture',
    })
  : getApp();

const adminAuth = getAuth(adminApp);
const databaseId =
  (firebaseConfig as any).firestoreDatabaseId ||
  'ai-studio-assuredcapture-513bf318-4d91-47b0-86f4-2eddbb15e73f';
const adminDb = getFirestore(adminApp, databaseId);

const app = express();
const PORT = Number(process.env.PORT) || 3000;

app.use(express.json());

// ----------------------------------------------------
// AUTHENTICATION & AUTHORIZATION MIDDLEWARE
// ----------------------------------------------------

async function requireAdminAuth(req: express.Request, res: express.Response, next: express.NextFunction) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized: Missing or invalid token' });
  }

  const token = authHeader.split('Bearer ')[1];
  try {
    const decodedToken = await adminAuth.verifyIdToken(token);
    const uid = decodedToken.uid;
    const email = (decodedToken.email || '').toLowerCase();

    // Check administrator authorization:
    // 1. Root bootstrap administrator email (ottomake2026@gmail.com)
    // 2. Custom claims (role === 'Administrator' or admin === true)
    let isAdministrator =
      email === 'ottomake2026@gmail.com' ||
      decodedToken.role === 'Administrator' ||
      decodedToken.admin === true;

    if (!isAdministrator) {
      // Optional check if Firestore profile is available
      try {
        const userDoc = await adminDb.collection('users').doc(uid).get();
        if (userDoc.exists && userDoc.data()?.role === 'Administrator') {
          isAdministrator = true;
        }
      } catch {
        // Ignore Firestore credential failure
      }
    }

    if (!isAdministrator) {
      return res.status(403).json({ error: 'Forbidden: Administrator privileges required' });
    }

    (req as any).user = {
      uid,
      email: decodedToken.email || '',
      displayName: decodedToken.name || (decodedToken.email ? decodedToken.email.split('@')[0] : 'Administrator'),
      role: 'Administrator',
      authTime: decodedToken.auth_time ? new Date(decodedToken.auth_time * 1000).toISOString() : new Date().toISOString(),
    };

    next();
  } catch (err: any) {
    console.error('Server auth verification error:', err?.message || err);
    return res.status(401).json({ error: 'Unauthorized: Invalid authentication session' });
  }
}

// ----------------------------------------------------
// API ROUTES
// ----------------------------------------------------

// Verify current session role and active status
app.get('/api/auth/me', async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized: Missing token' });
  }

  const token = authHeader.split('Bearer ')[1];
  try {
    const decodedToken = await adminAuth.verifyIdToken(token);
    const uid = decodedToken.uid;
    const email = (decodedToken.email || '').toLowerCase();

    let userRole = (decodedToken.role as string) || (email === 'ottomake2026@gmail.com' ? 'Administrator' : 'User');
    let userDisabled = false;

    try {
      const userDoc = await adminDb.collection('users').doc(uid).get();
      if (userDoc.exists) {
        const data = userDoc.data() || {};
        userRole = data.role || userRole;
        userDisabled = userDisabled || Boolean(data.disabled || data.status === 'Disabled');
      }
    } catch {
      // fallback to token
    }

    res.json({
      uid,
      email: decodedToken.email || '',
      displayName: decodedToken.name || (decodedToken.email ? decodedToken.email.split('@')[0] : 'User'),
      role: userRole === 'Administrator' ? 'Administrator' : 'User',
      disabled: userDisabled,
      status: userDisabled ? 'Disabled' : 'Active',
    });
  } catch (err: any) {
    res.status(401).json({ error: 'Invalid token session' });
  }
});

// Helper to parse Firestore REST document fields safely
function parseFirestoreDocFields(fields: any): any {
  const result: any = {};
  for (const [k, v] of Object.entries(fields || {})) {
    const val: any = v;
    if (val.stringValue !== undefined) result[k] = val.stringValue;
    else if (val.booleanValue !== undefined) result[k] = val.booleanValue;
    else if (val.integerValue !== undefined) result[k] = Number(val.integerValue);
  }
  return result;
}

// List all Firebase Authentication users (Administrator only)
app.get('/api/admin/users', requireAdminAuth, async (req, res) => {
  const callerUser = (req as any).user;
  const token = req.headers.authorization?.split('Bearer ')[1] || '';
  const rootAdminEmail = 'ottomake2026@gmail.com';
  const firebaseUsersMap = new Map<string, any>();

  let hasAuthUsers = false;

  // 1. Attempt using Firebase Admin SDK listUsers(1000)
  try {
    const authUsersResult = await adminAuth.listUsers(1000);
    for (const u of authUsersResult.users) {
      const email = u.email || '';
      const isRootAdmin = email.toLowerCase() === rootAdminEmail;
      const role = isRootAdmin || u.customClaims?.role === 'Administrator' ? 'Administrator' : 'User';
      const disabled = Boolean(u.disabled);
      const displayName = u.displayName || email || 'User';

      firebaseUsersMap.set(u.uid, {
        uid: u.uid,
        email,
        displayName,
        role: role as 'Administrator' | 'User',
        disabled,
        status: disabled ? ('Disabled' as const) : ('Active' as const),
        createdAt: u.metadata.creationTime || new Date().toISOString(),
        lastSignInTime: u.metadata.lastSignInTime,
      });
    }
    hasAuthUsers = true;
  } catch {
    // Admin SDK listUsers unavailable in Cloud Run ADC environment
  }

  // Always ensure caller administrator is present if authenticated
  if (!firebaseUsersMap.has(callerUser.uid)) {
    const isCallerRoot = (callerUser.email || '').toLowerCase() === rootAdminEmail;
    firebaseUsersMap.set(callerUser.uid, {
      uid: callerUser.uid,
      email: callerUser.email,
      displayName: callerUser.displayName || callerUser.email || 'Administrator',
      role: (isCallerRoot ? 'Administrator' : callerUser.role || 'Administrator') as 'Administrator' | 'User',
      disabled: false,
      status: 'Active' as const,
      createdAt: callerUser.authTime || new Date().toISOString(),
    });
  }

  // 2. Query Firestore authorized_users directory
  if (token) {
    try {
      const firestoreUrl = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(
        firebaseConfig.projectId
      )}/databases/${encodeURIComponent(databaseId)}/documents/authorized_users`;

      const fRes = await fetch(firestoreUrl, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (fRes.ok) {
        const fData: any = await fRes.json();
        const documents: any[] = fData.documents || [];
        for (const doc of documents) {
          const parsed = parseFirestoreDocFields(doc.fields);
          const targetUid = parsed.userId || (doc.name ? doc.name.split('/').pop() : null);

          if (targetUid) {
            if (hasAuthUsers) {
              // If we have live Firebase Auth list, ONLY enrich existing accounts
              if (firebaseUsersMap.has(targetUid)) {
                const existing = firebaseUsersMap.get(targetUid)!;
                const isRootAdmin = (existing.email || '').toLowerCase() === rootAdminEmail;

                if (!isRootAdmin && parsed.role) {
                  existing.role = (parsed.role === 'Administrator' ? 'Administrator' : 'User') as 'Administrator' | 'User';
                }
                if (parsed.displayName && (!existing.displayName || existing.displayName === existing.email)) {
                  existing.displayName = parsed.displayName;
                }
              }
            } else {
              // If Admin listUsers is unavailable, populate from authorized_users directory
              if (!firebaseUsersMap.has(targetUid)) {
                const isRootAdmin = (parsed.email || '').toLowerCase() === rootAdminEmail;
                const role = isRootAdmin ? 'Administrator' : parsed.role === 'Administrator' ? 'Administrator' : 'User';
                const disabled = Boolean(parsed.disabled);

                firebaseUsersMap.set(targetUid, {
                  uid: targetUid,
                  email: parsed.email || '',
                  displayName: parsed.displayName || parsed.email || 'User',
                  role: role as 'Administrator' | 'User',
                  disabled,
                  status: disabled ? ('Disabled' as const) : ('Active' as const),
                  createdAt: parsed.createdAt || new Date().toISOString(),
                });
              }
            }
          }
        }
      }
    } catch (fErr: any) {
      console.warn('Notice querying Firestore authorized_users metadata:', fErr?.message || fErr);
    }
  }

  return res.json({ users: Array.from(firebaseUsersMap.values()) });
});

// Create new Firebase Authentication User (Administrator only - Stage 2)
app.post('/api/admin/users', requireAdminAuth, async (req, res) => {
  try {
    const { email, password, fullName, displayName } = req.body;
    const token = req.headers.authorization?.split('Bearer ')[1] || '';

    const nameToUse = (fullName || displayName || '').trim();
    const emailToUse = (email || '').trim().toLowerCase();

    if (!nameToUse) {
      return res.status(400).json({ error: 'Full Name is required' });
    }

    if (!emailToUse || !emailToUse.includes('@')) {
      return res.status(400).json({ error: 'A valid email address is required' });
    }

    if (!password || typeof password !== 'string' || password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }

    let createdUid: string = '';
    let creationDate: string = new Date().toISOString();

    const apiKey = (firebaseConfig as any).apiKey;
    if (apiKey) {
      const restRes = await fetch(
        `https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${encodeURIComponent(apiKey)}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            email: emailToUse,
            password: password,
            displayName: nameToUse,
            returnSecureToken: true,
          }),
        }
      );

      const restData: any = await restRes.json();
      if (!restRes.ok || restData?.error) {
        const errMsg = restData?.error?.message;
        if (errMsg === 'EMAIL_EXISTS') {
          return res.status(409).json({ error: 'A user with this email already exists.' });
        }
        if (errMsg === 'INVALID_PASSWORD' || errMsg?.includes('PASSWORD')) {
          return res.status(400).json({ error: 'Password must be at least 6 characters.' });
        }
        if (errMsg === 'INVALID_EMAIL') {
          return res.status(400).json({ error: 'A valid email address is required.' });
        }
        throw new Error(errMsg || 'Failed to create user in Firebase');
      }

      createdUid = restData.localId;
    } else {
      const newUserRecord = await adminAuth.createUser({
        email: emailToUse,
        password: password,
        displayName: nameToUse,
        disabled: false,
      });
      createdUid = newUserRecord.uid;
      creationDate = newUserRecord.metadata.creationTime || creationDate;
    }

    const safeUserData = {
      uid: createdUid,
      email: emailToUse,
      displayName: nameToUse,
      role: 'User' as const,
      status: 'Active' as const,
      disabled: false,
      createdAt: creationDate,
    };

    // Persist user record in Firestore authorized_users collection for permanent directory lookup
    if (token) {
      try {
        const updateMaskParams =
          'updateMask.fieldPaths=userId&updateMask.fieldPaths=email&updateMask.fieldPaths=displayName&updateMask.fieldPaths=role&updateMask.fieldPaths=status&updateMask.fieldPaths=disabled&updateMask.fieldPaths=createdAt';
        const patchUrl = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(
          firebaseConfig.projectId
        )}/databases/${encodeURIComponent(databaseId)}/documents/authorized_users/${encodeURIComponent(
          createdUid
        )}?${updateMaskParams}`;

        const docBody = JSON.stringify({
          fields: {
            userId: { stringValue: createdUid },
            email: { stringValue: emailToUse },
            displayName: { stringValue: nameToUse },
            role: { stringValue: 'User' },
            status: { stringValue: 'Active' },
            disabled: { booleanValue: false },
            createdAt: { stringValue: creationDate },
          },
        });

        const patchRes = await fetch(patchUrl, {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: docBody,
        });

        if (!patchRes.ok) {
          const postUrl = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(
            firebaseConfig.projectId
          )}/databases/${encodeURIComponent(databaseId)}/documents/authorized_users?documentId=${encodeURIComponent(
            createdUid
          )}`;

          await fetch(postUrl, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${token}`,
            },
            body: docBody,
          });
        }
      } catch (saveErr) {
        console.warn('Notice persisting user to Firestore authorized_users:', saveErr);
      }
    }

    return res.status(201).json({
      success: true,
      message: 'User created successfully.',
      user: safeUserData,
    });
  } catch (err: any) {
    if (err?.code === 'auth/email-already-exists') {
      return res.status(409).json({ error: 'A user with this email already exists.' });
    }

    if (err?.code === 'auth/invalid-password') {
      return res.status(400).json({ error: 'Password must be at least 6 characters.' });
    }

    if (err?.code === 'auth/invalid-email') {
      return res.status(400).json({ error: 'The email address is invalid.' });
    }

    return res.status(500).json({ error: err?.message || 'Unable to create user. Please try again.' });
  }
});

// Update user active/disabled status (Administrator only - Stage 3)
app.patch('/api/admin/users/:uid/status', requireAdminAuth, async (req, res) => {
  try {
    const targetUid = req.params.uid;
    const { disabled } = req.body;
    const caller = (req as any).user;
    const token = req.headers.authorization?.split('Bearer ')[1] || '';

    if (!targetUid || typeof targetUid !== 'string') {
      return res.status(400).json({ error: 'Valid user ID is required' });
    }

    if (typeof disabled !== 'boolean') {
      return res.status(400).json({ error: 'Invalid disabled flag. Boolean required.' });
    }

    // Protection: Administrator account cannot be disabled
    if ((caller.uid === targetUid || targetUid === 'root_admin') && disabled) {
      return res.status(400).json({ error: 'The Administrator account cannot be disabled.' });
    }

    let updatedEmail = '';
    let updatedDisplayName = '';
    let updatedCreatedAt = new Date().toISOString();

    const apiKey = (firebaseConfig as any).apiKey;
    if (apiKey) {
      const restRes = await fetch(
        `https://identitytoolkit.googleapis.com/v1/accounts:update?key=${encodeURIComponent(apiKey)}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            localId: targetUid,
            disableUser: disabled,
          }),
        }
      );

      const restData: any = await restRes.json();
      if (!restRes.ok || restData?.error) {
        throw new Error(restData?.error?.message || 'Failed to update user status in Firebase');
      }

      updatedEmail = restData.email || '';
      updatedDisplayName = restData.displayName || '';
    } else {
      const updatedUserRecord = await adminAuth.updateUser(targetUid, { disabled });
      updatedEmail = updatedUserRecord.email || '';
      updatedDisplayName = updatedUserRecord.displayName || '';
      updatedCreatedAt = updatedUserRecord.metadata.creationTime || updatedCreatedAt;
    }

    // 2. Synchronize with Firestore authorized_users
    if (token) {
      try {
        const patchUrl = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(
          firebaseConfig.projectId
        )}/databases/${encodeURIComponent(databaseId)}/documents/authorized_users/${encodeURIComponent(
          targetUid
        )}?updateMask.fieldPaths=disabled&updateMask.fieldPaths=status`;

        await fetch(patchUrl, {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            fields: {
              disabled: { booleanValue: disabled },
              status: { stringValue: disabled ? 'Disabled' : 'Active' },
            },
          }),
        });
      } catch (fErr) {
        console.warn('Notice syncing status to Firestore authorized_users:', fErr);
      }
    }

    const updatedUser = {
      uid: targetUid,
      email: updatedEmail,
      displayName: updatedDisplayName || updatedEmail || 'User',
      role: 'User' as const,
      status: disabled ? ('Disabled' as const) : ('Active' as const),
      disabled,
      createdAt: updatedCreatedAt,
    };

    return res.json({
      success: true,
      message: 'User status updated successfully.',
      user: updatedUser,
    });
  } catch (err: any) {
    return res.status(500).json({ error: err?.message || 'Unable to update user status. Please try again.' });
  }
});

// ----------------------------------------------------
// FRONTEND STATIC / VITE MIDDLEWARE SERVING
// ----------------------------------------------------

const possibleDistPaths = [
  path.join(__dirname, 'dist'),
  path.resolve(process.cwd(), 'dist'),
];

let distPath = possibleDistPaths.find((p) => fs.existsSync(path.join(p, 'index.html')));

if (distPath) {
  const resolvedIndexPath = path.join(distPath, 'index.html');
  app.use(express.static(distPath, { index: false }));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api/')) {
      return next();
    }
    if (fs.existsSync(resolvedIndexPath)) {
      res.sendFile(resolvedIndexPath, (err) => {
        if (err && !res.headersSent) {
          res.status(200).send('<!doctype html><html><head><title>Assured Capture</title></head><body><div id="root"></div></body></html>');
        }
      });
    } else {
      res.status(200).send('<!doctype html><html><head><title>Assured Capture</title></head><body><div id="root"></div></body></html>');
    }
  });
} else {
  // Vite dev middleware mode with safe fallback
  try {
    const { createServer } = await import('vite');
    const vite = await createServer({
      server: { middlewareMode: true, hmr: process.env.DISABLE_HMR !== 'true' },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } catch (viteErr) {
    console.warn('Vite dev server not available, serving static fallback:', viteErr);
    app.get('*', (req, res, next) => {
      if (req.path.startsWith('/api/')) return next();
      res.status(200).send('<!doctype html><html><head><title>Assured Capture</title></head><body><div id="root"></div></body></html>');
    });
  }
}

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Assured Capture server running on port ${PORT}`);
});
