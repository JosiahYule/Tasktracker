const SUPABASE_URL = 'https://hpolfsrneebrapupyoca.supabase.co';
const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_3_oOraYSn1eo3spJH-RdDA_AGvHAib5';

const headers = {
  apikey: SUPABASE_PUBLISHABLE_KEY,
  Authorization: `Bearer ${SUPABASE_PUBLISHABLE_KEY}`,
  'Content-Type': 'application/json'
};

async function request(path, options = {}) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...options,
    headers: { ...headers, ...options.headers }
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || `Supabase request failed (${response.status})`);
  }

  return response.status === 204 ? null : response.json();
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
