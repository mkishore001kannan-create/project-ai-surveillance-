export const API_BASE = import.meta.env.VITE_API_URL || '';

export const signalingUrl = (cameraId) => {
  const base = API_BASE || window.location.origin;
  const websocketBase = base.replace(/^http/i, 'ws');
  return `${websocketBase}/api/signaling?cameraId=${encodeURIComponent(cameraId)}&token=${encodeURIComponent(localStorage.getItem('sentinel_token') || '')}`;
};

export const apiRequest = async (path, options = {}) => {
  const token = localStorage.getItem('sentinel_token');
  let response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(options.headers || {}),
      },
    });
  } catch (error) {
    if (error instanceof TypeError) {
      throw new Error('The secure server is unavailable. Confirm the application is running and try again.');
    }
    throw error;
  }
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error || `Request failed with status ${response.status}`);
  }
  return payload;
};
