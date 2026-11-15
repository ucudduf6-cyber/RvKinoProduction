'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { spawn } = require('node:child_process');

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      server.close(() => resolve(port));
    });
  });
}

async function waitReady(base) {
  for (let i = 0; i < 80; i++) {
    try { const response = await fetch(base + '/health'); if (response.ok) return; }
    catch { /* server still starting */ }
    await new Promise(resolve => setTimeout(resolve, 70));
  }
  throw new Error('Test server did not start');
}

test('CMS: authentication, CRUD, publishing, uploads, watch-link security', async t => {
  const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'rvkino-cms-'));
  const source = path.resolve(__dirname, '..');
  const assetDir = path.join(tmp, 'assets', 'posters');
  await fsp.mkdir(assetDir, { recursive: true });
  for (const name of ['server.js', 'projects.json', 'index.html', 'admin.html'])
    await fsp.copyFile(path.join(source, name), path.join(tmp, name));
  const sample = fs.readdirSync(path.join(source, 'assets', 'posters')).find(name => /\.jpeg$/.test(name));
  await fsp.copyFile(path.join(source, 'assets', 'posters', sample), path.join(assetDir, sample));
  await fsp.writeFile(path.join(tmp, 'posters.json'), JSON.stringify([sample]));
  const password = 'test-only-password-12345';
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 64);
  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;
  const server = spawn(process.execPath, [path.join(tmp, 'server.js')], {
    cwd: tmp, stdio: 'ignore', env: { ...process.env, PORT: String(port), HOST: '127.0.0.1',
      ADMIN_USERNAME: 'tester', ADMIN_PASSWORD_HASH: `scrypt$${salt.toString('hex')}$${hash.toString('hex')}` }
  });
  t.after(async () => { server.kill('SIGTERM'); await fsp.rm(tmp, { recursive: true, force: true }); });
  await waitReady(base);

  let cookie = '';
  let csrf = '';
  async function api(url, options = {}) {
    const response = await fetch(base + url, { ...options, headers: {
      ...(cookie ? { cookie } : {}),
      ...(csrf ? { 'X-RVKINO-CSRF': csrf } : {}),
      ...options.headers
    } });
    return { response, json: await response.json().catch(() => ({})) };
  }
  function jsonOptions(method, body) {
    return { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) };
  }
  assert.deepEqual((await api('/api/projects')).json, []);
  assert.equal((await api('/api/admin/projects')).response.status, 401);
  assert.equal((await api('/.env')).response.status, 404);
  assert.equal((await api('/api/admin/login', jsonOptions('POST', { username: 'tester', password: 'wrong' }))).response.status, 401);
  const login = await api('/api/admin/login', jsonOptions('POST', { username: 'tester', password }));
  assert.equal(login.response.status, 200);
  cookie = login.response.headers.get('set-cookie').split(';')[0];
  csrf = login.json.csrf;
  assert.equal((await api('/api/admin/session')).json.loggedIn, true);
  const entry = { title: 'Тестовый фильм', type: 'film', year: '2026', status: 'Выпущен',
    poster: 'assets/posters/' + sample, watchUrl: '', logline: 'Синопсис', published: true };
  assert.equal((await api('/api/admin/projects', jsonOptions('POST', { ...entry, watchUrl: 'https://evil.example/' }))).response.status, 400);
  const created = await api('/api/admin/projects', jsonOptions('POST', entry));
  assert.equal(created.response.status, 201);
  const id = created.json.project.id;
  assert.equal(created.json.project.watchUrl, 'https://rvkino.ru/');
  assert.equal((await api('/api/projects')).json.length, 1);
  const updated = await api('/api/admin/projects/' + id, jsonOptions('PUT', { ...entry, type: 'series', published: false }));
  assert.equal(updated.response.status, 200);
  assert.equal((await api('/api/projects')).json.length, 0);
  const file = await fsp.readFile(path.join(assetDir, sample));
  const form = new FormData(); form.set('file', new Blob([file], { type: 'image/jpeg' }), 'poster.jpg');
  const uploaded = await api('/api/admin/upload', { method: 'POST', body: form });
  assert.equal(uploaded.response.status, 201);
  assert.match(uploaded.json.poster, /^assets\/posters\/uploads\/[\w.-]+\.jpg$/);
  assert.equal((await api('/api/admin/projects/' + id, { method: 'DELETE' })).response.status, 200);
  assert.equal((await api('/api/admin/logout', { method: 'POST' })).response.status, 200);
  assert.equal((await api('/api/admin/projects')).response.status, 401);
});
