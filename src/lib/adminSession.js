const ADMIN_KEY_STORAGE_KEY = 'PRAXIS_ADMIN_KEY';
const ADMIN_VERIFIED_STORAGE_KEY = 'PRAXIS_ADMIN_VERIFIED';

function getStorage() {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null;
  } catch {
    return null;
  }
}

export function getStoredAdminKey() {
  const storage = getStorage();
  if (!storage) return '';
  return storage.getItem(ADMIN_KEY_STORAGE_KEY) || '';
}

export function hasStoredAdminKey() {
  return getStoredAdminKey().length > 0;
}

export function hasVerifiedAdminSession() {
  const storage = getStorage();
  if (!storage) return false;
  return storage.getItem(ADMIN_VERIFIED_STORAGE_KEY) === 'true';
}

export function persistAdminSession(key) {
  const storage = getStorage();
  if (!storage) return;
  storage.setItem(ADMIN_KEY_STORAGE_KEY, key);
  storage.setItem(ADMIN_VERIFIED_STORAGE_KEY, 'true');
}

export function clearAdminVerification() {
  const storage = getStorage();
  if (!storage) return;
  storage.removeItem(ADMIN_VERIFIED_STORAGE_KEY);
}

export function clearAdminSession() {
  const storage = getStorage();
  if (!storage) return;
  storage.removeItem(ADMIN_KEY_STORAGE_KEY);
  storage.removeItem(ADMIN_VERIFIED_STORAGE_KEY);
}
