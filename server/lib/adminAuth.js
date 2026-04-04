export function verifyAdminKey(input, expected) {
  if (!input || !expected) return false;
  if (input.length !== expected.length) return false;
  let result = 0;
  for (let i = 0; i < input.length; i += 1) {
    result |= input.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  return result === 0;
}

export function getConfiguredAdminKey(c) {
  const injected = c.get?.('adminKey');
  if (typeof injected === 'string') {
    return injected.trim();
  }
  const envValue = c.env?.ADMIN_KEY;
  if (typeof envValue === 'string') {
    return envValue.trim();
  }
  return '';
}

export function getAdminAuthFailure(c) {
  const provided = c.req.header('X-Admin-Key') || c.req.query('key') || '';
  const expected = getConfiguredAdminKey(c);

  if (!expected) {
    return { status: 503, error: 'Admin key is not configured on the server.' };
  }
  if (!verifyAdminKey(provided, expected)) {
    return { status: 401, error: 'Unauthorized. Set X-Admin-Key header.' };
  }
  return null;
}
