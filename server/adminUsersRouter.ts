import { Router, Request, Response } from 'express';
import { adminAuth, adminFirestore, verifyAdminToken, PRIMARY_ADMIN_EMAIL } from './adminAuth.js';

export const adminUsersRouter = Router();

// Middleware to enforce Admin ID Token authorization on all routes
adminUsersRouter.use(async (req: Request, res: Response, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Authentication required. Missing Bearer token.' });
    return;
  }

  const token = authHeader.split('Bearer ')[1].trim();
  const verifiedCaller = await verifyAdminToken(token);

  if (!verifiedCaller) {
    res.status(403).json({ error: 'Access denied. Administrator privileges required.' });
    return;
  }

  // Attach verified caller to request locals
  res.locals.adminCaller = verifiedCaller;
  next();
});

/**
 * GET /api/admin/users
 * Returns a list of real Firebase Authentication users
 */
adminUsersRouter.get('/users', async (req: Request, res: Response) => {
  try {
    const pageToken = typeof req.query.pageToken === 'string' ? req.query.pageToken : undefined;
    const maxResults = Math.min(Number(req.query.maxResults) || 50, 100);

    const listUsersResult = await adminAuth.listUsers(maxResults, pageToken);

    const users = listUsersResult.users.map((user) => {
      const isAdmin = user.customClaims?.admin === true;
      return {
        uid: user.uid,
        email: user.email || '',
        displayName: user.displayName || '',
        role: isAdmin ? 'Administrator' : 'User',
        disabled: !!user.disabled,
        emailVerified: !!user.emailVerified,
        createdAt: user.metadata.creationTime || null,
        lastSignInTime: user.metadata.lastSignInTime || null,
        photoURL: user.photoURL || null,
      };
    });

    res.json({
      users,
      pageToken: listUsersResult.pageToken || null,
    });
  } catch (err: any) {
    console.error('Error listing Firebase users:', err);
    res.status(500).json({ error: 'Failed to retrieve user accounts. Please check server logs.' });
  }
});

/**
 * POST /api/admin/users
 * Creates a new user in Firebase Auth and assigns appropriate roles
 */
adminUsersRouter.post('/users', async (req: Request, res: Response) => {
  try {
    const { email, displayName, role } = req.body;

    if (!email || typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      res.status(400).json({ error: 'A valid email address is required.' });
      return;
    }

    const cleanEmail = email.trim().toLowerCase();
    const cleanName = typeof displayName === 'string' ? displayName.trim() : '';
    const assignedRole = role === 'Administrator' ? 'Administrator' : 'User';

    // 1. Create the Firebase Auth user without a password (ready for Stage 2 passwordless email link)
    let newUser;
    try {
      newUser = await adminAuth.createUser({
        email: cleanEmail,
        displayName: cleanName || undefined,
        emailVerified: false,
        disabled: false,
      });
    } catch (createErr: any) {
      if (createErr.code === 'auth/email-already-exists') {
        res.status(409).json({ error: 'A user with this email address already exists.' });
        return;
      }
      throw createErr;
    }

    // 2. Assign custom claim if role is Administrator
    if (assignedRole === 'Administrator') {
      await adminAuth.setCustomUserClaims(newUser.uid, { admin: true });
    }

    // 3. Populate initial Firestore user profile for application consistency
    try {
      const userDocRef = adminFirestore.doc(`users/${newUser.uid}`);
      await userDocRef.set(
        {
          userId: newUser.uid,
          profileName: cleanName,
          displayName: cleanName,
          name: cleanName || 'User Profile',
          fullName: cleanName || 'User Profile',
          email: cleanEmail,
          role: assignedRole,
          accountType: 'authenticated',
          updatedAt: new Date().toISOString(),
          createdAt: new Date().toISOString(),
        },
        { merge: true }
      );
    } catch (fsErr) {
      console.warn('Note: Firestore user document initial write notice:', fsErr);
    }

    res.status(201).json({
      user: {
        uid: newUser.uid,
        email: newUser.email,
        displayName: newUser.displayName || '',
        role: assignedRole,
        disabled: false,
        emailVerified: false,
        createdAt: newUser.metadata.creationTime,
        lastSignInTime: null,
        photoURL: null,
      },
    });
  } catch (err: any) {
    console.error('Error creating user account:', err);
    res.status(500).json({ error: err?.message || 'Failed to create user account. Please try again.' });
  }
});

/**
 * PATCH /api/admin/users/:uid/role
 * Changes a user's role (User <-> Administrator)
 */
adminUsersRouter.patch('/users/:uid/role', async (req: Request, res: Response) => {
  try {
    const { uid } = req.params;
    const { role } = req.body;
    const caller = res.locals.adminCaller;

    if (!uid || typeof uid !== 'string') {
      res.status(400).json({ error: 'User UID parameter is required.' });
      return;
    }

    if (role !== 'Administrator' && role !== 'User') {
      res.status(400).json({ error: 'Role must be either "Administrator" or "User".' });
      return;
    }

    // Protect caller from removing their own admin role
    if (caller.uid === uid && role !== 'Administrator') {
      res.status(400).json({ error: "You can't remove your own administrator access." });
      return;
    }

    // Fetch target user to ensure existence
    const targetUser = await adminAuth.getUser(uid);

    // Protect primary admin email
    if (targetUser.email?.toLowerCase() === PRIMARY_ADMIN_EMAIL.toLowerCase() && role !== 'Administrator') {
      res.status(400).json({ error: "You can't remove administrator access from the primary administrator account." });
      return;
    }

    const currentClaims = { ...(targetUser.customClaims || {}) };

    if (role === 'Administrator') {
      currentClaims.admin = true;
    } else {
      delete currentClaims.admin;
    }

    await adminAuth.setCustomUserClaims(uid, currentClaims);

    // Sync role to Firestore profile if present
    try {
      const userDocRef = adminFirestore.doc(`users/${uid}`);
      await userDocRef.set({ role, updatedAt: new Date().toISOString() }, { merge: true });
    } catch (fsErr) {
      console.warn('Note: Firestore user document role sync notice:', fsErr);
    }

    res.json({
      success: true,
      uid,
      role,
    });
  } catch (err: any) {
    if (err.code === 'auth/user-not-found') {
      res.status(404).json({ error: 'User account not found.' });
      return;
    }
    console.error('Error updating user role:', err);
    res.status(500).json({ error: err?.message || 'Failed to update user role.' });
  }
});

/**
 * PATCH /api/admin/users/:uid/status
 * Enables or disables a user account in Firebase Auth
 */
adminUsersRouter.patch('/users/:uid/status', async (req: Request, res: Response) => {
  try {
    const { uid } = req.params;
    const { disabled } = req.body;
    const caller = res.locals.adminCaller;

    if (!uid || typeof uid !== 'string') {
      res.status(400).json({ error: 'User UID parameter is required.' });
      return;
    }

    if (typeof disabled !== 'boolean') {
      res.status(400).json({ error: 'Disabled field must be a boolean.' });
      return;
    }

    // Protect caller from disabling their own account
    if (caller.uid === uid && disabled === true) {
      res.status(400).json({ error: "You can't disable your own administrator account." });
      return;
    }

    // Fetch target user to ensure existence
    const targetUser = await adminAuth.getUser(uid);

    // Protect primary admin email
    if (targetUser.email?.toLowerCase() === PRIMARY_ADMIN_EMAIL.toLowerCase() && disabled === true) {
      res.status(400).json({ error: "You can't disable the primary administrator account." });
      return;
    }

    await adminAuth.updateUser(uid, { disabled });

    res.json({
      success: true,
      uid,
      disabled,
    });
  } catch (err: any) {
    if (err.code === 'auth/user-not-found') {
      res.status(404).json({ error: 'User account not found.' });
      return;
    }
    console.error('Error updating user status:', err);
    res.status(500).json({ error: err?.message || 'Failed to update user status.' });
  }
});
