import { activity, isoNow, noteBodies, noteIndex, profiles, projects, tasks } from './fixtures.mjs';

const HOST = 'hpolfsrneebrapupyoca.supabase.co';

/**
 * Answers the Supabase REST and auth endpoints from the fixtures so the tests
 * never touch a real project. Every request is recorded, which is how the
 * concurrency tests count refreshes and inserts.
 */
export async function installSupabaseStub(page, options = {}) {
  const state = {
    calls: [],
    refreshes: 0,
    unauthorized: 0,
    /** Flip on to make every REST call answer 401 until a refresh succeeds. */
    accessTokenExpired: false,
    /** Supabase rotates refresh tokens: reusing a spent one is a 400. */
    rotateRefreshToken: true,
    /** Addresses public.invitations would say yes to. */
    invited: ['brady@example.ca'],
    /** Set false to model a project with "Confirm email" switched on. */
    signUpReturnsSession: true,
    signUps: [],
    created: [],
    resets: [],
    passwordUpdates: 0,
    ...options
  };

  await page.unroute(`**/${HOST}/**`).catch(() => {});
  await page.route(`**/${HOST}/**`, async route => {
    const request = route.request();
    const url = request.url();
    const method = request.method();
    const path = url.split(`${HOST}/`)[1] || url;
    state.calls.push(`${method} ${path}`);

    const json = body => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
    const fail = (status, message) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify({ message }) });

    if (url.includes('grant_type=refresh_token')) {
      state.refreshes += 1;
      if (state.rotateRefreshToken && state.refreshes > 1) return fail(400, 'Invalid Refresh Token');
      state.accessTokenExpired = false;
      return json({ access_token: `access-${state.refreshes}`, refresh_token: `refresh-${state.refreshes}`, user: { id: 'u-1' } });
    }
    if (url.includes('grant_type=password')) return json({ access_token: 'access-0', refresh_token: 'refresh-0', user: { id: 'u-1', email: 'michaila@example.ca' } });
    if (url.includes('/auth/v1/logout')) return route.fulfill({ status: 204, body: '' });

    if (path.startsWith('auth/v1/signup')) {
      const body = JSON.parse(request.postData() || '{}');
      state.signUps.push(body.email);
      if (!state.signUpReturnsSession) return json({ id: 'u-new', email: body.email });
      return json({ access_token: 'access-new', refresh_token: 'refresh-new', user: { id: 'u-1', email: body.email } });
    }
    if (path.startsWith('auth/v1/recover')) {
      state.resets.push(JSON.parse(request.postData() || '{}').email);
      return json({});
    }
    if (path.startsWith('auth/v1/user') && method === 'PUT') {
      state.passwordUpdates += 1;
      return json({ id: 'u-1', email: 'michaila@example.ca' });
    }
    if (path.startsWith('rest/v1/rpc/email_is_invited')) {
      const { check_email: email } = JSON.parse(request.postData() || '{}');
      return json(state.invited.includes(String(email).trim().toLowerCase()));
    }

    if (state.accessTokenExpired) {
      state.unauthorized += 1;
      return fail(401, 'JWT expired');
    }

    if (url.includes('profiles?id=eq.')) return json([profiles[0]]);
    if (url.includes('profiles?select')) return json(profiles);
    if (url.includes('task_activity')) return json(activity);

    if (path.startsWith('rest/v1/notes')) {
      if (method === 'POST') {
        const body = JSON.parse(request.postData() || '{}');
        return json([{ id: 99, created_at: isoNow, ...body }]);
      }
      if (method === 'DELETE') return route.fulfill({ status: 204, body: '' });
      return json(url.includes('select=id') ? noteIndex : noteBodies);
    }

    if (path.startsWith('rest/v1/projects')) {
      if (method === 'POST') {
        const body = JSON.parse(request.postData() || '{}');
        return json([{ id: 11, created_at: isoNow, updated_at: isoNow, ...body }]);
      }
      return json(projects);
    }

    if (path.startsWith('rest/v1/tasks')) {
      if (method === 'POST') {
        const body = JSON.parse(request.postData() || '{}');
        state.created.push(body);
        const row = { ...tasks[0], id: 50 + state.created.length, created_at: isoNow, updated_at: bumped(), ...body };
        tasks.push(row);
        return json([row]);
      }
      if (method === 'PATCH') {
        const id = Number(url.match(/id=eq\.(\d+)/)?.[1]);
        const row = tasks.find(item => item.id === id);
        if (!row) return json([]);
        // A conditional claim matches nothing once the flag is already set.
        if (url.includes('recurrence_generated=is.false') && row.recurrence_generated) return json([]);
        Object.assign(row, JSON.parse(request.postData() || '{}'), { updated_at: bumped() });
        return json([row]);
      }
      return json(tasks.filter(item => !item.deleted_at));
    }

    return json([]);
  });

  return state;
}

let tick = 0;
function bumped() {
  tick += 1;
  return new Date(Date.parse(isoNow) + tick * 1000).toISOString();
}
