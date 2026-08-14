const SUPABASE_URL = 'https://hpolfsrneebrapupyoca.supabase.co';
const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_3_oOraYSn1eo3spJH-RdDA_AGvHAib5';

const REQUEST_TIMEOUT = 12000;
const RETRY_DELAYS = [400, 1200];

const headers = {
  apikey: SUPABASE_PUBLISHABLE_KEY,
  Authorization: `Bearer ${SUPABASE_PUBLISHABLE_KEY}`,
  'Content-Type': 'application/json'
};
const sessionKey = 'tasktracker-session';
let session = readStoredSession();

function readStoredSession() {
  try {
    return JSON.parse(localStorage.getItem(sessionKey) || 'null');
  } catch {
    localStorage.removeItem(sessionKey);
    return null;
  }
}

function authHeaders() {
  return { ...headers, Authorization: `Bearer ${session?.access_token || SUPABASE_PUBLISHABLE_KEY}` };
}

/** The database is missing something this build of the app expects. */
export class SchemaError extends Error {
  constructor(message) {
    super(message);
    this.name = 'SchemaError';
  }
}

/** The request never reached Supabase, so the caller can retry quietly. */
export class OfflineError extends Error {
  constructor(message = 'No connection to the workspace.') {
    super(message);
    this.name = 'OfflineError';
  }
}

function describeFailure(status, body) {
  let payload = {};
  try {
    payload = JSON.parse(body);
  } catch {
    payload = { message: body };
  }
  const message = payload.message || body || `Supabase request failed (${status})`;
  const schemaCodes = ['PGRST204', 'PGRST205', '42703', '42P01'];
  if (schemaCodes.includes(payload.code) || /does not exist|schema cache/i.test(message)) {
    return new SchemaError(message);
  }
  return new Error(message);
}

async function fetchWithTimeout(url, options) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } catch (error) {
    throw new OfflineError(error.name === 'AbortError' ? 'The workspace took too long to respond.' : undefined);
  } finally {
    clearTimeout(timer);
  }
}

async function request(path, options = {}, attempt = 0) {
  const url = `${SUPABASE_URL}/rest/v1/${path}`;
  let response;

  try {
    response = await fetchWithTimeout(url, { ...options, headers: { ...authHeaders(), ...options.headers } });
  } catch (error) {
    // Network blips are common on office wifi; retry a couple of times before
    // telling the user anything is wrong.
    if (attempt < RETRY_DELAYS.length) {
      await new Promise(resolve => setTimeout(resolve, RETRY_DELAYS[attempt]));
      return request(path, options, attempt + 1);
    }
    throw error;
  }

  if (response.status === 401 && session?.refresh_token) {
    await refreshSession();
    response = await fetchWithTimeout(url, { ...options, headers: { ...authHeaders(), ...options.headers } });
  }

  if (response.status >= 500 && attempt < RETRY_DELAYS.length) {
    await new Promise(resolve => setTimeout(resolve, RETRY_DELAYS[attempt]));
    return request(path, options, attempt + 1);
  }

  if (!response.ok) throw describeFailure(response.status, await response.text());

  return response.status === 204 ? null : response.json();
}

async function refreshSession() {
  const response = await fetchWithTimeout(`${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ refresh_token: session.refresh_token })
  });
  if (!response.ok) {
    clearSession();
    throw new Error('Your session has expired. Please sign in again.');
  }
  session = await response.json();
  localStorage.setItem(sessionKey, JSON.stringify(session));
}

function clearSession() {
  session = null;
  localStorage.removeItem(sessionKey);
}

const TASK_COLUMNS = [
  'id', 'name', 'assignee', 'due', 'project', 'recurring', 'frequency', 'paused',
  'recurrence_generated', 'status', 'note', 'completed', 'priority', 'completed_at',
  'created_at', 'updated_at'
].join(',');

export const taskStore = {
  /** Soft-deleted rows stay in the table so Undo can bring them back. */
  async list() {
    return request(`tasks?select=${TASK_COLUMNS}&deleted_at=is.null&order=created_at.asc`);
  },

  async create(task) {
    const [created] = await request('tasks', {
      method: 'POST',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify(task)
    });
    return created;
  },

  /**
   * Patches only the fields that changed. The previous version sent the whole
   * row, so two people editing different fields of one task clobbered each
   * other's work.
   */
  async update(id, changes) {
    const [updated] = await request(`tasks?id=eq.${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify(changes)
    });
    return updated;
  },

  async softDelete(id) {
    return this.update(id, { deleted_at: new Date().toISOString() });
  },

  async restore(id) {
    return this.update(id, { deleted_at: null });
  }
};

export const projectStore = {
  async list() { return request('projects?select=*&order=created_at.asc'); },
  async create(project) {
    const [created] = await request('projects', {
      method: 'POST',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify(project)
    });
    return created;
  },
  async update(id, changes) {
    const [updated] = await request(`projects?id=eq.${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify(changes)
    });
    return updated;
  },
  async remove(id) { return request(`projects?id=eq.${encodeURIComponent(id)}`, { method: 'DELETE' }); }
};

export const noteStore = {
  /**
   * The list view only needs a count per item, so the poll fetches two small
   * columns instead of every note body in the workspace.
   */
  async index() { return request('notes?select=entity_type,entity_id'); },

  async forEntity(type, id) {
    return request(`notes?select=*&entity_type=eq.${encodeURIComponent(type)}&entity_id=eq.${encodeURIComponent(id)}&order=created_at.asc`);
  },

  async create(note) {
    const [created] = await request('notes', {
      method: 'POST',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify(note)
    });
    return created;
  },

  async remove(id) { return request(`notes?id=eq.${encodeURIComponent(id)}`, { method: 'DELETE' }); }
};

export const activityStore = {
  async forTask(id) {
    return request(`task_activity?select=*&task_id=eq.${encodeURIComponent(id)}&order=created_at.desc&limit=40`);
  }
};

export const profileStore = {
  async list() {
    return request('profiles?select=id,display_name,role,title,office,accent,active,sort_order&order=sort_order.asc,display_name.asc');
  }
};

export const auth = {
  getSession() { return session; },

  async signIn(email, password) {
    const response = await fetchWithTimeout(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ email, password })
    });
    if (!response.ok) throw new Error('The email or password is incorrect.');
    session = await response.json();
    localStorage.setItem(sessionKey, JSON.stringify(session));
    return session;
  },

  async profile() {
    const [profile] = await request(`profiles?id=eq.${encodeURIComponent(session.user.id)}&select=*`);
    if (!profile) throw new Error('This account has not been given access. Ask the workspace administrator to add your profile.');
    return profile;
  },

  /**
   * Revokes the refresh token server-side. Clearing localStorage on its own
   * left a working token behind on shared machines.
   */
  async signOut() {
    const token = session?.access_token;
    clearSession();
    if (!token) return;
    try {
      await fetchWithTimeout(`${SUPABASE_URL}/auth/v1/logout`, {
        method: 'POST',
        headers: { ...headers, Authorization: `Bearer ${token}` }
      });
    } catch {
      // The local session is already gone; a failed revoke should not block
      // the user from leaving.
    }
  }
};
