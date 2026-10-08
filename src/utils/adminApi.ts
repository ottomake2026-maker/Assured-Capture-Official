import { auth, db } from './firebaseAuth';
import { doc, setDoc, getDocs, collection } from 'firebase/firestore';
import { ManagedUser } from '../types';

async function getAuthHeaders(): Promise<HeadersInit> {
  const currentUser = auth.currentUser;
  if (!currentUser) {
    throw new Error('You must be signed in to perform this operation');
  }
  const token = await currentUser.getIdToken(true);
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
  };
}

export async function fetchUsersList(): Promise<ManagedUser[]> {
  const headers = await getAuthHeaders();
  let serverUsers: ManagedUser[] = [];
  try {
    const res = await fetch('/api/admin/users', { headers });
    if (res.ok) {
      const data = await res.json();
      serverUsers = data.users || [];
    }
  } catch (e) {
    console.warn('Notice fetching from /api/admin/users:', e);
  }

  const usersMap = new Map<string, ManagedUser>();
  for (const u of serverUsers) {
    usersMap.set(u.uid, u);
  }

  // Also query Firestore authorized_users collection directly
  try {
    const snap = await getDocs(collection(db, 'authorized_users'));
    for (const d of snap.docs) {
      const docData = d.data();
      const uid = docData.userId || d.id;
      if (uid) {
        if (usersMap.has(uid)) {
          const existing = usersMap.get(uid)!;
          if (docData.displayName && !existing.displayName) {
            existing.displayName = docData.displayName;
          }
          if (docData.role && existing.role !== 'Administrator') {
            existing.role = docData.role === 'Administrator' ? 'Administrator' : 'User';
          }
        } else {
          usersMap.set(uid, {
            uid,
            email: docData.email || '',
            displayName: docData.displayName || docData.email || 'User',
            role: docData.role === 'Administrator' ? 'Administrator' : 'User',
            disabled: Boolean(docData.disabled),
            status: Boolean(docData.disabled) ? 'Disabled' : 'Active',
            createdAt: docData.createdAt || new Date().toISOString(),
          });
        }
      }
    }
  } catch (fsErr) {
    console.warn('Notice querying client Firestore authorized_users:', fsErr);
  }

  // Always ensure current admin user is present
  const currentUser = auth.currentUser;
  if (currentUser && !usersMap.has(currentUser.uid)) {
    const isRoot = (currentUser.email || '').toLowerCase() === 'ottomake2026@gmail.com';
    usersMap.set(currentUser.uid, {
      uid: currentUser.uid,
      email: currentUser.email || '',
      displayName: currentUser.displayName || currentUser.email || 'Administrator',
      role: 'Administrator',
      disabled: false,
      status: 'Active',
      createdAt: new Date().toISOString(),
    });
  }

  return Array.from(usersMap.values());
}

export async function createNewUser(payload: {
  fullName: string;
  email: string;
  password: string;
}): Promise<ManagedUser> {
  const headers = await getAuthHeaders();
  const res = await fetch('/api/admin/users', {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    let errorMsg = `Failed to create user (status ${res.status})`;
    try {
      const errorData = await res.json();
      if (errorData.error) errorMsg = errorData.error;
    } catch {
      // ignore
    }
    throw new Error(errorMsg);
  }
  const data = await res.json();
  const createdUser = data.user;

  // Persist directly to Firestore using client Firestore SDK
  try {
    await setDoc(doc(db, 'authorized_users', createdUser.uid), {
      userId: createdUser.uid,
      email: createdUser.email,
      displayName: createdUser.displayName,
      role: 'User',
      status: 'Active',
      disabled: false,
      createdAt: createdUser.createdAt || new Date().toISOString(),
    });
  } catch (fsErr) {
    console.warn('Notice writing to Firestore from client:', fsErr);
  }

  return createdUser;
}

export async function updateUserStatus(uid: string, disabled: boolean): Promise<ManagedUser> {
  const headers = await getAuthHeaders();
  const res = await fetch(`/api/admin/users/${encodeURIComponent(uid)}/status`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify({ disabled }),
  });
  if (!res.ok) {
    let errorMsg = `Failed to update user status (status ${res.status})`;
    try {
      const errorData = await res.json();
      if (errorData.error) errorMsg = errorData.error;
    } catch {
      // ignore
    }
    throw new Error(errorMsg);
  }
  const data = await res.json();

  // Sync status to Firestore using client Firestore SDK
  try {
    await setDoc(
      doc(db, 'authorized_users', uid),
      {
        disabled,
        status: disabled ? 'Disabled' : 'Active',
      },
      { merge: true }
    );
  } catch (fsErr) {
    console.warn('Notice updating Firestore status from client:', fsErr);
  }

  return data.user;
}

export async function checkMyAuthStatus(): Promise<{
  uid: string;
  email: string;
  role: string;
  disabled: boolean;
}> {
  const headers = await getAuthHeaders();
  const res = await fetch('/api/auth/me', { headers });
  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    throw new Error(errorData.error || `Failed to verify auth status (status ${res.status})`);
  }
  return await res.json();
}
