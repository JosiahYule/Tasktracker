const SUPABASE_URL = 'https://hpolfsrneebrapupyoca.supabase.co';
const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_3_oOraYSn1eo3spJH-RdDA_AGvHAib5';

const headers = {
  apikey: SUPABASE_PUBLISHABLE_KEY,
  Authorization: `Bearer ${SUPABASE_PUBLISHABLE_KEY}`,
  'Content-Type': 'application/json'
};
const sessionKey = 'tasktracker-session';
let session = JSON.parse(localStorage.getItem(sessionKey) || 'null');

function authHeaders() {
  return { ...headers, Authorization: `Bearer ${session?.access_token || SUPABASE_PUBLISHABLE_KEY}` };
}

async function request(path, options = {}) {
  let response = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...options,
    headers: { ...authHeaders(), ...options.headers }
  });

  if (response.status === 401 && session?.refresh_token) {
    await refreshSession();
    response = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
      ...options,
      headers: { ...authHeaders(), ...options.headers }
    });
  }

  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || `Supabase request failed (${response.status})`);
  }

  return response.status === 204 ? null : response.json();
}

async function refreshSession() {
  const response = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, {
    method: 'POST', headers, body: JSON.stringify({ refresh_token: session.refresh_token })
  });
  if (!response.ok) {
    auth.signOut();
    throw new Error('Your session has expired. Please sign in again.');
  }
  session = await response.json();
  localStorage.setItem(sessionKey, JSON.stringify(session));
}

export const taskStore = {
  async list() {
    return request('tasks?select=*&order=created_at.asc');
  },

  async create(task) {
    const [created] = await request('tasks', {
      method: 'POST',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify(task)
    });
    return created;
  },

  async update(id, changes) {
    const [updated] = await request(`tasks?id=eq.${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify(changes)
    });
    return updated;
  },

  async remove(id) {
    return request(`tasks?id=eq.${encodeURIComponent(id)}`, { method: 'DELETE' });
  }
};

export const projectStore = {
  async list() { return request('projects?select=*&order=created_at.asc'); },
  async create(project) {
    const [created] = await request('projects', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify(project) });
    return created;
  },
  async remove(id) { return request(`projects?id=eq.${encodeURIComponent(id)}`, { method: 'DELETE' }); }
};

export const auth = {
  getSession() { return session; },

  async signIn(email, password) {
    const response = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
      method: 'POST', headers, body: JSON.stringify({ email, password })
    });
    if (!response.ok) throw new Error('The email or password is incorrect.');
    session = await response.json();
    localStorage.setItem(sessionKey, JSON.stringify(session));
    return session;
  },

  async profile() {
    const [profile] = await request(`profiles?id=eq.${encodeURIComponent(session.user.id)}&select=*`);
    if (!profile) throw new Error('This account has not been given access.');
    return profile;
  },

  signOut() {
    session = null;
    localStorage.removeItem(sessionKey);
  }
};
