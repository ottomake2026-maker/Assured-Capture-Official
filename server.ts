import express from 'express';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { initializeApp, getApps, getApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import firebaseConfig from './firebase-applet-config.json' with { type: 'json' };

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Initialize Firebase Admin with project ID and configured firestore database
const adminApp = getApps().length === 0
  ? initializeApp({
      projectId: firebaseConfig.projectId,
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

    // Check user record in Firebase Auth
    const authUser = await adminAuth.getUser(uid);
    if (authUser.disabled) {
      return res.status(403).json({ error: 'Your account has been disabled by an Administrator' });
    }

    // Check user profile document in Firestore
    const userDocRef = adminDb.collection('users').doc(uid);
    const userDoc = await userDocRef.get();

    let userRole = 'User';
    let userDisabled: boolean = Boolean(authUser.disabled);

    if (userDoc.exists) {
      const data = userDoc.data() || {};
      userRole = data.role || (decodedToken.role as string) || 'User';
      userDisabled = userDisabled || Boolean(data.disabled || data.status === 'Disabled');
    } else {
      // Check if any admin exists in the system to bootstrap the first administrator
      const adminSnapshot = await adminDb.collection('users').where('role', '==', 'Administrator').limit(1).get();
      if (adminSnapshot.empty) {
        userRole = 'Administrator';
        await userDocRef.set(
          {
            userId: uid,
            email: decodedToken.email || '',
            name: decodedToken.name || decodedToken.email?.split('@')[0] || 'Administrator',
            displayName: decodedToken.name || decodedToken.email?.split('@')[0] || 'Administrator',
            profileName: decodedToken.name || decodedToken.email?.split('@')[0] || 'Administrator',
            role: 'Administrator',
            disabled: false,
            status: 'Active',
            accountType: 'authenticated',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
          { merge: true }
        );
        await adminAuth.setCustomUserClaims(uid, { role: 'Administrator' });
      }
    }

    if (userDisabled) {
      return res.status(403).json({ error: 'Your account has been disabled by an Administrator' });
    }

    if (userRole !== 'Administrator') {
      return res.status(403).json({ error: 'Forbidden: Administrator privileges required' });
    }

    (req as any).user = {
      uid,
      email: decodedToken.email,
      role: userRole,
    };

    next();
  } catch (err: any) {
    console.error('Server auth verification error:', err);
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
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const token = authHeader.split('Bearer ')[1];
  try {
    const decodedToken = await adminAuth.verifyIdToken(token);
    const uid = decodedToken.uid;
    const authUser = await adminAuth.getUser(uid);

    const userDocRef = adminDb.collection('users').doc(uid);
    const userDoc = await userDocRef.get();

    let userRole = (decodedToken.role as string) || 'User';
    let userDisabled: boolean = Boolean(authUser.disabled);

    if (userDoc.exists) {
      const data = userDoc.data() || {};
      userRole = data.role || userRole;
      userDisabled = userDisabled || Boolean(data.disabled || data.status === 'Disabled');
    } else {
      // Bootstrap the first user as Administrator if none exists
      const adminSnapshot = await adminDb.collection('users').where('role', '==', 'Administrator').limit(1).get();
      if (adminSnapshot.empty) {
        userRole = 'Administrator';
        await userDocRef.set(
          {
            userId: uid,
            email: decodedToken.email || '',
            name: decodedToken.name || decodedToken.email?.split('@')[0] || 'Administrator',
            displayName: decodedToken.name || decodedToken.email?.split('@')[0] || 'Administrator',
            profileName: decodedToken.name || decodedToken.email?.split('@')[0] || 'Administrator',
            role: 'Administrator',
            disabled: false,
            status: 'Active',
            accountType: 'authenticated',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
          { merge: true }
        );
        await adminAuth.setCustomUserClaims(uid, { role: 'Administrator' });
      }
    }

    res.json({
      uid,
      email: decodedToken.email || '',
      role: userRole,
      disabled: userDisabled,
      status: userDisabled ? 'Disabled' : 'Active',
    });
  } catch (err: any) {
    res.status(401).json({ error: 'Invalid token session' });
  }
});

// List all system users (Administrator only)
app.get('/api/admin/users', requireAdminAuth, async (_req, res) => {
  try {
    const authUsersResult = await adminAuth.listUsers(1000);
    const authUsers = authUsersResult.users;

    const profilesSnapshot = await adminDb.collection('users').get();
    const profilesMap = new Map<string, any>();
    profilesSnapshot.forEach((doc) => {
      profilesMap.set(doc.id, doc.data());
    });

    const userList = authUsers.map((u) => {
      const profile = profilesMap.get(u.uid) || {};
      const role = profile.role || (u.customClaims?.role as string) || 'User';
      const disabled = u.disabled || Boolean(profile.disabled || profile.status === 'Disabled');
      return {
        uid: u.uid,
        email: u.email || profile.email || '',
        displayName: u.displayName || profile.displayName || profile.name || profile.profileName || '',
        role: role === 'Administrator' ? 'Administrator' : 'User',
        disabled,
        status: disabled ? 'Disabled' : 'Active',
        createdAt: profile.createdAt || u.metadata.creationTime || new Date().toISOString(),
        lastSignInTime: u.metadata.lastSignInTime,
      };
    });

    res.json({ users: userList });
  } catch (err: any) {
    console.error('List users error:', err);
    res.status(500).json({ error: err.message || 'Failed to list users' });
  }
});

// Create new user (Administrator only)
app.post('/api/admin/users', requireAdminAuth, async (req, res) => {
  try {
    const { email, password, displayName, role } = req.body;

    if (!email || typeof email !== 'string' || !email.includes('@')) {
      return res.status(400).json({ error: 'A valid email address is required' });
    }

    if (!password || typeof password !== 'string' || password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }

    const assignedRole = role === 'Administrator' ? 'Administrator' : 'User';
    const cleanName =
      typeof displayName === 'string' && displayName.trim()
        ? displayName.trim()
        : email.split('@')[0];

    // 1. Create user in Firebase Auth
    const newUserRecord = await adminAuth.createUser({
      email: email.trim(),
      password,
      displayName: cleanName,
      disabled: false,
    });

    // 2. Store profile in Firestore
    const newProfile = {
      userId: newUserRecord.uid,
      email: email.trim(),
      name: cleanName,
      displayName: cleanName,
      profileName: cleanName,
      fullName: cleanName,
      avatarUrl: '',
      photoURL: null,
      avatarStorageUri: '',
      role: assignedRole,
      disabled: false,
      status: 'Active',
      accountType: 'authenticated',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    await adminDb.collection('users').doc(newUserRecord.uid).set(newProfile);

    // 3. Set custom user claims
    await adminAuth.setCustomUserClaims(newUserRecord.uid, { role: assignedRole });

    res.status(201).json({
      success: true,
      user: {
        uid: newUserRecord.uid,
        email: email.trim(),
        displayName: cleanName,
        role: assignedRole,
        disabled: false,
        status: 'Active',
        createdAt: newProfile.createdAt,
      },
    });
  } catch (err: any) {
    console.error('Create user error:', err);
    if (err.code === 'auth/email-already-exists') {
      return res.status(400).json({ error: 'A user account with this email address already exists' });
    }
    res.status(500).json({ error: err.message || 'Failed to create user account' });
  }
});

// Update user active/disabled status (Administrator only)
app.patch('/api/admin/users/:uid/status', requireAdminAuth, async (req, res) => {
  try {
    const targetUid = req.params.uid;
    const { disabled } = req.body;
    const caller = (req as any).user;

    if (caller.uid === targetUid && disabled) {
      return res.status(400).json({ error: 'You cannot disable your own administrator account' });
    }

    if (typeof disabled !== 'boolean') {
      return res.status(400).json({ error: 'Invalid disabled flag. Boolean required.' });
    }

    // 1. Update in Firebase Auth
    await adminAuth.updateUser(targetUid, { disabled });

    // 2. Update in Firestore
    await adminDb.collection('users').doc(targetUid).set(
      {
        disabled,
        status: disabled ? 'Disabled' : 'Active',
        updatedAt: new Date().toISOString(),
      },
      { merge: true }
    );

    res.json({ success: true, disabled, status: disabled ? 'Disabled' : 'Active' });
  } catch (err: any) {
    console.error('Update status error:', err);
    res.status(500).json({ error: err.message || 'Failed to update user status' });
  }
});

// Update user role (Administrator only)
app.patch('/api/admin/users/:uid/role', requireAdminAuth, async (req, res) => {
  try {
    const targetUid = req.params.uid;
    const { role } = req.body;
    const caller = (req as any).user;

    if (caller.uid === targetUid && role !== 'Administrator') {
      return res.status(400).json({ error: 'You cannot demote your own administrator account' });
    }

    if (role !== 'Administrator' && role !== 'User') {
      return res.status(400).json({ error: 'Role must be either Administrator or User' });
    }

    // 1. Update in Firestore
    await adminDb.collection('users').doc(targetUid).set(
      {
        role,
        updatedAt: new Date().toISOString(),
      },
      { merge: true }
    );

    // 2. Update custom user claims
    await adminAuth.setCustomUserClaims(targetUid, { role });

    res.json({ success: true, role });
  } catch (err: any) {
    console.error('Update role error:', err);
    res.status(500).json({ error: err.message || 'Failed to update user role' });
  }
});

// ----------------------------------------------------
// FRONTEND STATIC / VITE MIDDLEWARE SERVING
// ----------------------------------------------------

const distPath = path.join(__dirname, 'dist');
const isProduction = process.env.NODE_ENV === 'production' || fs.existsSync(path.join(distPath, 'index.html'));

if (isProduction && fs.existsSync(distPath)) {
  app.use(express.static(distPath));
  app.get('*', (_req, res) => {
    res.sendFile(path.join(distPath, 'index.html'));
  });
} else {
  // Vite dev middleware mode
  const { createServer } = await import('vite');
  const vite = await createServer({
    server: { middlewareMode: true, hmr: process.env.DISABLE_HMR !== 'true' },
    appType: 'spa',
  });
  app.use(vite.middlewares);
}

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Assured Capture server running on port ${PORT}`);
});
