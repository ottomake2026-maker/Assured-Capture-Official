import { auth } from './firebaseAuth';
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
  const res = await fetch('/api/admin/users', { headers });
  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    throw new Error(errorData.error || `Failed to fetch users (status ${res.status})`);
  }
  const data = await res.json();
  return data.users || [];
}

export async function createNewUser(payload: {
  email: string;
  password: string;
  displayName?: string;
  role: 'Administrator' | 'User';
}): Promise<ManagedUser> {
  const headers = await getAuthHeaders();
  const res = await fetch('/api/admin/users', {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    throw new Error(errorData.error || `Failed to create user (status ${res.status})`);
  }
  const data = await res.json();
  return data.user;
}

export async function updateUserStatus(uid: string, disabled: boolean): Promise<void> {
  const headers = await getAuthHeaders();
  const res = await fetch(`/api/admin/users/${encodeURIComponent(uid)}/status`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify({ disabled }),
  });
  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    throw new Error(errorData.error || `Failed to update user status (status ${res.status})`);
  }
}

export async function updateUserRole(uid: string, role: 'Administrator' | 'User'): Promise<void> {
  const headers = await getAuthHeaders();
  const res = await fetch(`/api/admin/users/${encodeURIComponent(uid)}/role`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify({ role }),
  });
  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    throw new Error(errorData.error || `Failed to update user role (status ${res.status})`);
  }
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
