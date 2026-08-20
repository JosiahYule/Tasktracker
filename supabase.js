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
    try { localStorage.removeItem(sessionKey); } catch { /* storage unavailable */ }
    return null;
  }
}

function storeSession(value) {
  session = value;
  // A browser in private mode, or one with storage blocked, throws here. The
  // in-memory session still works for this tab, so do not take the app down.
  try { localStorage.setItem(sessionKey, JSON.stringify(value)); } catch { /* not persisted */ }
}

function clearSession() {
  session = null;
  try { localStorage.removeItem(sessionKey); } catch { /* storage unavailable */ }
}

function authHeaders() {
  return { ...headers, Authorization: `Bearer ${session?.access_token || SUPABASE_PUBLISHABLE_KEY}` };
}

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

/** The database is missing something this build of the app expects. */
export class SchemaError extends Error {
  constructor(message) {
    super(message);
    this.name = 'SchemaError';
  }
}

/** The request never reached Supabase, so the caller can retry quietly. */
export class OfflineError extends Error {
  constructor(message = 'No connection to the workspace.', options) {
    super(message, options);
    this.name = 'OfflineError';
  }
}

/**
 * The session is gone and cannot be renewed. The app returns to the sign-in
 * screen rather than showing "something went wrong" on every poll until the
 * user thinks to reload.
 */
export class AuthError extends Error {
  constructor(message = 'Your session has expired. Please sign in again.') {
    super(message);
    this.name = 'AuthError';
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
    throw new OfflineError(
      error.name === 'AbortError' ? 'The workspace took too long to respond.' : undefined,
      { cause: error }
    );
  } finally {
    clearTimeout(timer);
  }
}

/** Only reads may be sent again; see the note in request(). */
function isReplayable(options) {
  const method = (options.method || 'GET').toUpperCase();
  return method === 'GET' || method === 'HEAD';
}

async function request(path, options = {}, attempt = 0) {
  const url = `${SUPABASE_URL}/rest/v1/${path}`;
  const send = () => fetchWithTimeout(url, { ...options, headers: { ...authHeaders(), ...options.headers } });

  // Network blips are common on office wifi, but a write that timed out may
  // still have landed, so replaying a POST turns one blip into two tasks.
  // Reads are safe to repeat; writes surface the error and let the user decide.
  const canRetry = isReplayable(options) && attempt < RETRY_DELAYS.length;
  let response;

  try {
    response = await send();
  } catch (error) {
    if (canRetry) {
      await wait(RETRY_DELAYS[attempt]);
      return request(path, options, attempt + 1);
    }
    throw error;
  }

  if (response.status === 401 && session) {
    await refreshSession();
    response = await send();
  }

  if (response.status >= 500 && canRetry) {
    await wait(RETRY_DELAYS[attempt]);
    return request(path, options, attempt + 1);
  }

  if (response.status === 401) {
    clearSession();
    throw new AuthError();
  }

  if (!response.ok) throw describeFailure(response.status, await response.text());

  return response.status === 204 ? null : response.json();
}

let refreshInFlight = null;

/**
 * Supabase rotates the refresh token every time it is used. The workspace poll
 * fires four requests at once, so when the access token expired they all got a
 * 401 and all tried to refresh: the first succeeded and the rest spent a token
 * that had already been replaced, signing the user out mid-session. Concurrent
 * callers now share one refresh.
 */
function refreshSession() {
  refreshInFlight ??= performRefresh().finally(() => { refreshInFlight = null; });
  return refreshInFlight;
}

async function performRefresh() {
  const token = session?.refresh_token;
  if (!token) {
    clearSession();
    throw new AuthError();
  }

  // A refresh that never reached Supabase says nothing about the token, so let
  // the OfflineError through and keep the session for the next attempt.
  const response = await fetchWithTimeout(`${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ refresh_token: token })
  });

  if (!response.ok) {
    clearSession();
    throw new AuthError();
  }
  storeSession(await response.json());
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

  /**
   * Completes a recurring task and claims the right to schedule the next one in
   * a single conditional write. The filter only matches while
   * recurrence_generated is still false, so when both offices tick the same
   * reconciliation at once exactly one of them gets a row back and the other
   * gets nothing instead of creating a duplicate occurrence.
   */
  async completeAndClaimRecurrence(id) {
    const [claimed] = await request(
      `tasks?id=eq.${encodeURIComponent(id)}&recurrence_generated=is.false`,
      {
        method: 'PATCH',
        headers: { Prefer: 'return=representation' },
        body: JSON.stringify({ completed: true, recurrence_generated: true })
      }
    );
    return claimed;
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
   * The list view only needs a count per item, so the poll fetches three small
   * columns instead of every note body in the workspace. `id` is included so a
   * delete and a post landing in the same poll window still move the signature.
   */
  async index() { return request('notes?select=id,entity_type,entity_id'); },

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
    storeSession(await response.json());
    return session;
  },

  async profile() {
    const userId = session?.user?.id;
    if (!userId) throw new AuthError('Please sign in to open the workspace.');
    const [profile] = await request(`profiles?id=eq.${encodeURIComponent(userId)}&select=*`);
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
