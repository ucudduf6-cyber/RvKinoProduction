'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const net = require('node:net');
const { spawn } = require('node:child_process');
function port() { return new Promise(resolve => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); }); }); }
async function ready(base) { for (let i = 0; i < 100; i++) { try { if ((await fetch(base + '/health')).ok) return; } catch {} await new Promise(r => setTimeout(r, 60)); } throw Error('server not ready'); }
test('Site CMS: editable descriptions, contact/link/news CRUD, draft filtering, validation, persistence', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'rvkino-site-'));
  await fs.copyFile(path.join(__dirname, '..', 'server.js'), path.join(dir, 'server.js'));
  await fs.writeFile(path.join(dir, 'projects.json'), '[]');
  const salt = crypto.randomBytes(16); const password = 'testing-only';
  const hash = `scrypt$${salt.toString('hex')}$${crypto.scryptSync(password, salt, 64).toString('hex')}`;
  const p = await port(); const base = 'http://127.0.0.1:' + p;
  const child = spawn(process.execPath, [path.join(dir, 'server.js')], { env: { ...process.env, PORT: String(p), HOST: '127.0.0.1', ADMIN_USERNAME: 'tester', ADMIN_PASSWORD_HASH: hash }, stdio: 'ignore' });
  t.after(async () => { child.kill('SIGTERM'); await fs.rm(dir, { recursive: true, force: true }); });
  await ready(base);
  let cookie = '', csrf = '';
  async function api(endpoint, method = 'GET', payload = null, token = csrf) {
    const r = await fetch(base + endpoint, { method, headers: { ...(cookie ? { cookie } : {}), ...(method !== 'GET' ? { 'x-rvkino-csrf': token } : {}), ...(payload ? { 'content-type': 'application/json' } : {}) }, ...(payload ? { body: JSON.stringify(payload) } : {}) });
    return { status: r.status, data: await r.json() };
  }
  const initial = await api('/api/site'); assert.equal(initial.status, 200);
  assert.equal(initial.data.settings.siteName, 'RVKINO PRODUCTION');
  assert.equal(initial.data.contacts.length, 1); assert.equal(initial.data.links.length, 2);
  assert.equal((await api('/api/admin/site')).status, 401);
  const login = await api('/api/admin/login', 'POST', { username: 'tester', password });
  assert.equal(login.status, 200); csrf = login.data.csrf;
  // Need cookie from the actual login response. Existing helper returns parsed JSON only.
  const reauth = await fetch(base + '/api/admin/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'tester', password }) });
  cookie = reauth.headers.get('set-cookie').split(';')[0]; csrf = (await reauth.json()).csrf;
  const originalSettings = (await api('/api/admin/site')).data.settings;
  const changed = { ...originalSettings, siteName: 'RVKINO — STUDIO', siteDescription: '', aboutDescription: 'Новое описание студии.' };
  assert.equal((await api('/api/admin/site', 'PUT', changed, 'bad-token')).status, 403);
  assert.equal((await api('/api/admin/site', 'PUT', changed)).status, 200);
  assert.equal((await api('/api/site')).data.settings.siteDescription, '');
  assert.equal((await api('/api/site')).data.settings.aboutDescription, 'Новое описание студии.');
  const createdContact = await api('/api/admin/contacts', 'POST', { label: 'Email', value: 'Написать нам', url: 'mailto:hello@example.com', visible: false });
  assert.equal(createdContact.status, 201);
  const contactId = createdContact.data.item.id;
  assert.equal((await api('/api/site')).data.contacts.length, 1);
  assert.equal((await api('/api/admin/contacts/' + contactId, 'PUT', { label: 'Email', value: 'hello@example.com', url: 'mailto:hello@example.com', visible: true })).status, 200);
  assert.equal((await api('/api/site')).data.contacts.length, 2);
  assert.equal((await api('/api/admin/links', 'POST', { label: 'Bad', url: 'javascript:alert(1)', visible: true })).status, 400);
  const newLink = await api('/api/admin/links', 'POST', { label: 'Сайт', url: 'https://example.org/', visible: true });
  assert.equal(newLink.status, 201);
  assert.equal((await api('/api/site')).data.links.length, 3);
  const draft = await api('/api/admin/news', 'POST', { title: 'Тестовая новость', date: '2026-11-15', excerpt: 'Коротко', body: 'Полный текст', published: false });
  assert.equal(draft.status, 201);
  assert.equal((await api('/api/site')).data.news.length, 0);
  const newsId = draft.data.item.id;
  assert.equal((await api('/api/admin/news/' + newsId, 'PUT', { title: 'Тестовая новость', date: '2026-11-15', excerpt: 'Коротко', body: 'Полный текст', published: true })).status, 200);
  assert.equal((await api('/api/site')).data.news.length, 1);
  const disk = JSON.parse(await fs.readFile(path.join(dir, 'data', 'site.json'), 'utf8'));
  assert.equal(disk.settings.siteName, 'RVKINO — STUDIO');
  assert.equal(disk.news.length, 1);
  assert.equal((await api('/api/admin/news/' + newsId, 'DELETE')).status, 200);
  assert.equal((await api('/api/admin/contacts/' + contactId, 'DELETE')).status, 200);
  assert.equal((await api('/api/admin/links/' + newLink.data.item.id, 'DELETE')).status, 200);
  assert.equal((await api('/api/site')).data.news.length, 0);
  assert.equal((await api('/api/admin/contacts/00000000-0000-4000-8000-000000000001', 'DELETE')).status, 200);
  assert.equal((await api('/api/site')).data.contacts.length, 0);
  assert.equal((await api('/.env')).status, 404);
});
