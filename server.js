'use strict';
/**
 * RVKINO PRODUCTION backend. Node.js >= 20. No third-party dependencies.
 * Credentials are kept only in server-side .env (ignored by Git).
 */
const http = require('node:http');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');

const ROOT = __dirname;
const DATA_FILE = path.join(ROOT, 'data', 'projects.json');
const UPLOADS = path.join(ROOT, 'assets', 'posters', 'uploads');
const DEFAULT_FILE = path.join(ROOT, 'projects.json');
const POSTER_LIST = path.join(ROOT, 'posters.json');
const SITE_DATA_FILE = path.join(ROOT, 'data', 'site.json');

function loadEnvFile() {
  const file = path.join(ROOT, '.env');
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^([A-Z][A-Z0-9_]*)=(.*)$/);
    if (!match || process.env[match[1]] !== undefined) continue;
    let value = match[2].trim();
    if (value.startsWith('"')) {
      try { value = JSON.parse(value); } catch (_) { continue; }
    }
    process.env[match[1]] = value;
  }
}
loadEnvFile();
const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '127.0.0.1';
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || '';
const PASSWORD_HASH = process.env.ADMIN_PASSWORD_HASH || '';
const ADMIN_ENABLED = Boolean(ADMIN_USERNAME && /^scrypt\$[0-9a-f]{32}\$[0-9a-f]{128}$/.test(PASSWORD_HASH));
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
const SESSION_TTL = 12 * 60 * 60 * 1000;
const MAX_JSON = 120 * 1024;
const MAX_UPLOAD = 9 * 1024 * 1024;
const MAX_FILE = 8 * 1024 * 1024;
const sessions = new Map();
const loginAttempts = new Map();
let mutationQueue = Promise.resolve();

const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8'
};
function headers(res, extra = {}) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  if (process.env.NODE_ENV === 'production') res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: https:; connect-src 'self' https:; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'");
  for (const [name, value] of Object.entries(extra)) res.setHeader(name, value);
}
function json(res, status, data, extra = {}) {
  headers(res, { 'Content-Type': MIME['.json'], 'Cache-Control': 'no-store', ...extra });
  res.writeHead(status); res.end(JSON.stringify(data));
}
function fail(status, message) { const error = new Error(message); error.status = status; throw error; }
function cookies(req) {
  const result = {};
  for (const part of String(req.headers.cookie || '').split(';')) {
    const index = part.indexOf('=');
    if (index !== -1) result[part.slice(0, index).trim()] = part.slice(index + 1).trim();
  }
  return result;
}
function isSecure(req) {
  return Boolean(req.socket.encrypted || (process.env.TRUST_PROXY === '1' && req.headers['x-forwarded-proto'] === 'https'));
}
function sessionCookie(req, token, maxAge) {
  return 'rvkino_session=' + token + '; HttpOnly; SameSite=Strict; Path=/api/admin; Max-Age=' + maxAge + (isSecure(req) ? '; Secure' : '');
}
function getSession(req) {
  const token = cookies(req).rvkino_session;
  if (!token) return null;
  const session = sessions.get(token);
  if (!session) return null;
  if (session.expires <= Date.now()) { sessions.delete(token); return null; }
  return { token, ...session };
}
function auth(req, res) {
  const session = getSession(req);
  if (!session) fail(401, 'Сессия завершена. Войдите повторно.');
  if (req.method !== 'GET' && req.headers['x-rvkino-csrf'] !== session.csrf) fail(403, 'Неверный защитный токен.');
  return session;
}
function checkOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return;
  try {
    const originUrl = new URL(origin);
    const expectedHost = process.env.TRUST_PROXY === '1' && req.headers['x-forwarded-host']
      ? req.headers['x-forwarded-host'] : req.headers.host;
    if (originUrl.host !== expectedHost) fail(403, 'Запрос из другого источника запрещён.');
  } catch (error) {
    if (error.status) throw error;
    fail(403, 'Недопустимый источник запроса.');
  }
}
async function bodyBuffer(req, limit) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) fail(413, 'Файл или запрос слишком большой.');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}
async function bodyJson(req) {
  if (!String(req.headers['content-type'] || '').startsWith('application/json')) fail(415, 'Ожидается JSON.');
  const raw = await bodyBuffer(req, MAX_JSON);
  try { return JSON.parse(raw.toString('utf8')); }
  catch (_) { fail(400, 'Некорректный JSON.'); }
}
async function readProjects() {
  await fsp.mkdir(path.dirname(DATA_FILE), { recursive: true });
  try {
    const data = JSON.parse(await fsp.readFile(DATA_FILE, 'utf8'));
    if (!Array.isArray(data)) fail(500, 'Ошибка базы проектов.');
    return data;
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    try {
      const initial = JSON.parse(await fsp.readFile(DEFAULT_FILE, 'utf8'));
      return Array.isArray(initial) ? initial : [];
    } catch (_) { return []; }
  }
}
async function saveProjects(projects) {
  await fsp.mkdir(path.dirname(DATA_FILE), { recursive: true });
  const temp = DATA_FILE + '.' + crypto.randomUUID() + '.tmp';
  try {
    await fsp.writeFile(temp, JSON.stringify(projects, null, 2) + '\n', { mode: 0o600 });
    await fsp.rename(temp, DATA_FILE);
  } finally { await fsp.rm(temp, { force: true }).catch(() => {}); }
}
const DEFAULT_SITE = {
  settings: {
    siteName: 'RVKINO PRODUCTION',
    siteDescription: 'Независимый кинопродакшен. Фильмы, сериалы, шоу и истории, которые остаются.',
    heroEyebrow: 'НЕЗАВИСИМЫЙ КИНОПРОДАКШЕН',
    heroTitle: 'ИСТОРИИ.\nВ КАДРЕ.',
    heroDescription: 'Создаём кино, сериалы и визуальные истории, в которых важна каждая деталь.',
    aboutTitle: 'КИНО — ЭТО\nНАШ ЯЗЫК.',
    aboutDescription: 'RVKINO PRODUCTION — независимый продакшен, объединяющий идеи, людей и визуальный язык. Мы работаем с разными форматами: от фильмов и сериалов до шоу и вертикальных историй.',
    contactTitle: 'ЕСТЬ ИДЕЯ?\nОБСУДИМ.',
    contactDescription: 'Открыты к новым проектам, предложениям и сотрудничеству.'
  },
  contacts: [{ id: '00000000-0000-4000-8000-000000000001', label: 'Telegram', value: '@RvKino', url: 'https://t.me/RvKino', visible: true }],
  links: [{ id: '00000000-0000-4000-8000-000000000002', label: 'IMDb', url: 'https://www.imdb.com/name/nm18357618/', visible: true }, { id: '00000000-0000-4000-8000-000000000003', label: 'Онлайн-кинотеатр', url: 'https://rvkino.ru/', visible: true }],
  news: []
};
async function readSite() {
  try {
    const saved = JSON.parse(await fsp.readFile(SITE_DATA_FILE, 'utf8'));
    if (!saved || typeof saved !== 'object' || Array.isArray(saved)) throw new Error('Invalid site data');
    return {
      settings: { ...DEFAULT_SITE.settings, ...(saved.settings || {}) },
      contacts: Array.isArray(saved.contacts) ? saved.contacts : DEFAULT_SITE.contacts,
      links: Array.isArray(saved.links) ? saved.links : DEFAULT_SITE.links,
      news: Array.isArray(saved.news) ? saved.news : DEFAULT_SITE.news
    };
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    return JSON.parse(JSON.stringify(DEFAULT_SITE));
  }
}
async function saveSite(site) {
  await fsp.mkdir(path.dirname(SITE_DATA_FILE), { recursive: true });
  const temp = SITE_DATA_FILE + '.' + crypto.randomUUID() + '.tmp';
  try {
    await fsp.writeFile(temp, JSON.stringify(site, null, 2) + '\n', { mode: 0o600 });
    await fsp.rename(temp, SITE_DATA_FILE);
  } finally { await fsp.rm(temp, { force: true }).catch(() => {}); }
}
function validLink(value, protocols, label) {
  if (!value) return '';
  let url;
  try { url = new URL(value); } catch (_) { fail(400, label + ': неверная ссылка.'); }
  if (!protocols.includes(url.protocol) || (url.protocol.startsWith('http') && (!url.hostname || url.username || url.password))) {
    fail(400, label + ': недопустимая ссылка.');
  }
  if (url.protocol === 'mailto:' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(url.pathname)) fail(400, label + ': неверный email.');
  if (url.protocol === 'tel:' && !/^\+?[0-9() .-]{5,30}$/.test(url.pathname)) fail(400, label + ': неверный телефон.');
  return url.href;
}
function validateSiteSettings(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) fail(400, 'Неверный формат настроек.');
  const fields = {
    siteName: 80, siteDescription: 350, heroEyebrow: 100, heroTitle: 120,
    heroDescription: 600, aboutTitle: 140, aboutDescription: 5000,
    contactTitle: 140, contactDescription: 1000
  };
  const settings = {};
  for (const [key, max] of Object.entries(fields)) settings[key] = string(input[key], max);
  if (!settings.siteName) fail(400, 'Укажите название сайта.');
  return settings;
}
function validateSiteItem(collection, input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) fail(400, 'Неверные данные.');
  if (collection === 'contacts') {
    const label = string(input.label, 80);
    if (!label) fail(400, 'Укажите название контакта.');
    return { label, value: string(input.value, 180), url: validLink(string(input.url, 1500), ['https:', 'mailto:', 'tel:'], 'Контакт'), visible: input.visible === true };
  }
  if (collection === 'links') {
    const label = string(input.label, 80);
    if (!label) fail(400, 'Укажите название ссылки.');
    const url = validLink(string(input.url, 1500), ['https:'], 'Ссылка');
    if (!url) fail(400, 'Укажите адрес ссылки.');
    return { label, url, visible: input.visible === true };
  }
  if (collection === 'news') {
    const title = string(input.title, 180);
    if (!title) fail(400, 'Укажите заголовок новости.');
    const date = string(input.date, 10);
    if (date && (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(date + 'T12:00:00Z')))) fail(400, 'Неверная дата.');
    return { title, date, excerpt: string(input.excerpt, 400), body: string(input.body, 8000),
      url: validLink(string(input.url, 1500), ['https:'], 'Ссылка новости'), published: input.published === true };
  }
  fail(404, 'Неизвестный раздел.');
}
function publicSite(site) {
  return { settings: site.settings,
    contacts: site.contacts.filter(x => x.visible === true),
    links: site.links.filter(x => x.visible === true),
    news: site.news.filter(x => x.published === true).sort((a, b) => (b.date || '').localeCompare(a.date || '')) };
}
function mutate(fn) {
  const pending = mutationQueue.then(fn);
  mutationQueue = pending.catch(() => {});
  return pending;
}
function string(value, max = 150) {
  if (value == null) return '';
  if (typeof value !== 'string') fail(400, 'Неверный формат текстового поля.');
  const clean = value.trim();
  if (clean.length > max) fail(400, 'Слишком длинное значение поля.');
  return clean;
}
function validExternalUrl(value, allowedHosts, label) {
  if (!value) return '';
  let url;
  try { url = new URL(value); } catch (_) { fail(400, label + ': некорректная ссылка.'); }
  if (url.protocol !== 'https:' || !allowedHosts.includes(url.hostname) || url.username || url.password) {
    fail(400, label + ': требуется HTTPS-ссылка на разрешённый сайт.');
  }
  return url.href;
}
async function validateProject(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) fail(400, 'Некорректные данные проекта.');
  const title = string(input.title, 150);
  if (!title) fail(400, 'Введите название проекта.');
  const type = string(input.type, 20);
  if (!['film', 'series', 'show', 'vertical'].includes(type)) fail(400, 'Выберите тип проекта.');
  const poster = string(input.poster, 250);
  if (poster) {
    if (!/^assets\/posters\/(?:uploads\/)?[a-zA-Z0-9_.-]+\.(?:jpeg|jpg|png|webp)$/.test(poster)) fail(400, 'Недопустимое имя постера.');
    const file = path.join(ROOT, poster);
    if (!file.startsWith(path.join(ROOT, 'assets', 'posters') + path.sep)) fail(400, 'Недопустимый путь постера.');
    try { if (!(await fsp.stat(file)).isFile()) fail(400, 'Постер не найден.'); }
    catch (error) { if (error.status) throw error; fail(400, 'Постер не найден.'); }
  }
  return {
    title, type, poster, year: string(input.year, 12),
    status: string(input.status, 80), logline: string(input.logline, 300),
    synopsis: string(input.synopsis, 6000), genre: string(input.genre, 150),
    duration: string(input.duration, 80), director: string(input.director, 150),
    role: string(input.role, 150), cast: string(input.cast, 500),
    watchUrl: validExternalUrl(string(input.watchUrl, 1500) || 'https://rvkino.ru/', ['rvkino.ru', 'www.rvkino.ru'], 'Ссылка «Смотреть»'),
    imdb: validExternalUrl(string(input.imdb, 1500), ['imdb.com', 'www.imdb.com'], 'Ссылка IMDb'),
    published: input.published === true
  };
}
function verifyPassword(username, password) {
  if (!ADMIN_ENABLED) return false;
  if (typeof username !== 'string' || typeof password !== 'string' || password.length > 1024) return false;
  const [, saltHex, hashHex] = PASSWORD_HASH.split('$');
  const candidate = crypto.scryptSync(password, Buffer.from(saltHex, 'hex'), 64);
  const expected = Buffer.from(hashHex, 'hex');
  return crypto.timingSafeEqual(candidate, expected) &&
    crypto.timingSafeEqual(Buffer.from(crypto.createHash('sha256').update(username).digest()), Buffer.from(crypto.createHash('sha256').update(ADMIN_USERNAME).digest()));
}
function loginKey(req) { return (process.env.TRUST_PROXY === '1' && req.headers['x-real-ip']) || req.socket.remoteAddress || 'unknown'; }
function checkLoginRate(req) {
  const key = loginKey(req), entry = loginAttempts.get(key);
  if (entry && entry.reset > Date.now() && entry.count >= 5) fail(429, 'Слишком много попыток. Повторите через 15 минут.');
}
function recordFailedLogin(req) {
  const key = loginKey(req);
  const current = loginAttempts.get(key);
  if (!current || current.reset < Date.now()) loginAttempts.set(key, { count: 1, reset: Date.now() + 15 * 60 * 1000 });
  else current.count++;
}
function corsPublic(req, res) {
  const origin = req.headers.origin;
  if (origin && ALLOWED_ORIGINS.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }
}
async function listPosters() {
  let original = [];
  try { original = JSON.parse(await fsp.readFile(POSTER_LIST, 'utf8')).map(name => 'assets/posters/' + name); }
  catch (_) { /* no preloaded posters */ }
  let uploaded = [];
  try { uploaded = (await fsp.readdir(UPLOADS)).filter(name => /^[a-zA-Z0-9_.-]+\.(?:png|jpe?g|webp)$/.test(name)).map(name => 'assets/posters/uploads/' + name); }
  catch (_) { /* no uploads */ }
  return [...uploaded.reverse(), ...original];
}
function imageExtension(buffer) {
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))) return '.png';
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return '.jpg';
  if (buffer.length >= 12 && buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') return '.webp';
  return '';
}
async function upload(req, res) {
  if (!String(req.headers['content-type'] || '').startsWith('multipart/form-data;')) fail(415, 'Ожидается файл изображения.');
  const buffer = await bodyBuffer(req, MAX_UPLOAD);
  const request = new Request('http://localhost/upload', { method: 'POST', headers: { 'content-type': req.headers['content-type'] }, body: buffer });
  let form;
  try { form = await request.formData(); } catch (_) { fail(400, 'Некорректная загрузка файла.'); }
  const file = form.get('file');
  if (!file || typeof file.arrayBuffer !== 'function') fail(400, 'Выберите файл постера.');
  if (file.size > MAX_FILE || file.size === 0) fail(413, 'Размер постера должен быть от 1 байта до 8 МБ.');
  const bytes = Buffer.from(await file.arrayBuffer());
  const ext = imageExtension(bytes);
  if (!ext) fail(400, 'Разрешены только изображения JPEG, PNG и WEBP.');
  await fsp.mkdir(UPLOADS, { recursive: true });
  const name = crypto.randomUUID() + ext;
  await fsp.writeFile(path.join(UPLOADS, name), bytes, { flag: 'wx', mode: 0o644 });
  json(res, 201, { poster: 'assets/posters/uploads/' + name });
}
async function serveStatic(req, res, pathname) {
  const safePages = new Set(['/', '/index.html', '/project.html', '/admin.html', '/style.css', '/script.js', '/shared.js', '/detail.js', '/admin.js', '/config.js', '/projects.json', '/posters.json', '/favicon.ico']);
  if (!safePages.has(pathname) && !/^\/assets\/(?:posters\/(?:uploads\/)?[a-zA-Z0-9_.-]+|icons\/[a-z0-9-]+\.svg|logo\.png)$/.test(pathname)) fail(404, 'Файл не найден.');
  const filePath = path.join(ROOT, pathname === '/' ? 'index.html' : pathname.slice(1));
  let stats;
  try { stats = await fsp.stat(filePath); }
  catch (_) { fail(404, 'Файл не найден.'); }
  if (!stats.isFile()) fail(404, 'Файл не найден.');
  const mime = MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
  headers(res, { 'Content-Type': mime, 'Cache-Control': 'no-cache' });
  if (pathname === '/admin.html') res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  res.writeHead(200);
  fs.createReadStream(filePath).pipe(res);
}
async function handle(req, res) {
  const url = new URL(req.url, 'http://localhost');
  const pathname = url.pathname;
  if (pathname === '/health' && req.method === 'GET') return json(res, 200, { ok: true, adminConfigured: ADMIN_ENABLED });
  if (pathname === '/api/site' && req.method === 'GET') {
    corsPublic(req, res);
    return json(res, 200, publicSite(await readSite()));
  }
  if (pathname === '/api/projects' && req.method === 'GET') {
    corsPublic(req, res);
    const projects = await readProjects();
    return json(res, 200, projects.filter(p => p.published !== false));
  }
  if (pathname.startsWith('/api/admin/')) {
    checkOrigin(req);
    if (pathname === '/api/admin/session' && req.method === 'GET') {
      const session = getSession(req);
      return json(res, 200, { loggedIn: Boolean(session), csrf: session?.csrf || '', configured: ADMIN_ENABLED });
    }
    if (pathname === '/api/admin/login' && req.method === 'POST') {
      if (!ADMIN_ENABLED) fail(503, 'Админка не настроена. Запустите npm run setup на сервере.');
      checkLoginRate(req);
      const input = await bodyJson(req);
      if (!verifyPassword(input.username, input.password)) {
        recordFailedLogin(req);
        fail(401, 'Неверный логин или пароль.');
      }
      loginAttempts.delete(loginKey(req));
      const token = crypto.randomBytes(32).toString('hex');
      const csrf = crypto.randomBytes(32).toString('hex');
      sessions.set(token, { csrf, expires: Date.now() + SESSION_TTL });
      res.setHeader('Set-Cookie', sessionCookie(req, token, Math.floor(SESSION_TTL / 1000)));
      return json(res, 200, { ok: true, csrf });
    }
    const session = auth(req, res);
    if (pathname === '/api/admin/logout' && req.method === 'POST') {
      sessions.delete(session.token);
      res.setHeader('Set-Cookie', sessionCookie(req, '', 0));
      return json(res, 200, { ok: true });
    }
    if (pathname === '/api/admin/site' && req.method === 'GET') return json(res, 200, await readSite());
    if (pathname === '/api/admin/site' && req.method === 'PUT') {
      const settings = validateSiteSettings(await bodyJson(req));
      await mutate(async () => { const site = await readSite(); site.settings = settings; await saveSite(site); });
      return json(res, 200, { settings });
    }
    const collectionMatch = pathname.match(/^\/api\/admin\/(contacts|links|news)(?:\/([a-f0-9-]{36}))?$/);
    if (collectionMatch) {
      const [, collection, id] = collectionMatch;
      if (!id && req.method === 'POST') {
        const payload = validateSiteItem(collection, await bodyJson(req));
        const item = { id: crypto.randomUUID(), ...payload, createdAt: new Date().toISOString() };
        await mutate(async () => { const site = await readSite(); site[collection].unshift(item); await saveSite(site); });
        return json(res, 201, { item });
      }
      if (id && req.method === 'PUT') {
        const payload = validateSiteItem(collection, await bodyJson(req));
        const item = await mutate(async () => {
          const site = await readSite();
          const index = site[collection].findIndex(x => x.id === id);
          if (index < 0) fail(404, 'Запись не найдена.');
          site[collection][index] = { ...site[collection][index], ...payload, updatedAt: new Date().toISOString() };
          await saveSite(site);
          return site[collection][index];
        });
        return json(res, 200, { item });
      }
      if (id && req.method === 'DELETE') {
        await mutate(async () => {
          const site = await readSite();
          const index = site[collection].findIndex(x => x.id === id);
          if (index < 0) fail(404, 'Запись не найдена.');
          site[collection].splice(index, 1);
          await saveSite(site);
        });
        return json(res, 200, { ok: true });
      }
      fail(405, 'Метод не поддерживается.');
    }
    if (pathname === '/api/admin/projects' && req.method === 'GET') return json(res, 200, { projects: await readProjects() });
    if (pathname === '/api/admin/posters' && req.method === 'GET') return json(res, 200, { posters: await listPosters() });
    if (pathname === '/api/admin/upload' && req.method === 'POST') return upload(req, res);
    if (pathname === '/api/admin/projects' && req.method === 'POST') {
      const payload = await validateProject(await bodyJson(req));
      const project = { id: crypto.randomUUID(), ...payload, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
      await mutate(async () => { const projects = await readProjects(); projects.unshift(project); await saveProjects(projects); });
      return json(res, 201, { project });
    }
    const match = pathname.match(/^\/api\/admin\/projects\/([a-f0-9-]{36})$/);
    if (match && req.method === 'PUT') {
      const payload = await validateProject(await bodyJson(req));
      const project = await mutate(async () => {
        const projects = await readProjects();
        const index = projects.findIndex(p => p.id === match[1]);
        if (index < 0) fail(404, 'Проект не найден.');
        projects[index] = { ...projects[index], ...payload, updatedAt: new Date().toISOString() };
        await saveProjects(projects);
        return projects[index];
      });
      return json(res, 200, { project });
    }
    if (match && req.method === 'DELETE') {
      await mutate(async () => {
        const projects = await readProjects();
        const index = projects.findIndex(p => p.id === match[1]);
        if (index < 0) fail(404, 'Проект не найден.');
        projects.splice(index, 1);
        await saveProjects(projects);
      });
      return json(res, 200, { ok: true });
    }
    fail(404, 'Неизвестный адрес API.');
  }
  if (req.method === 'GET' || req.method === 'HEAD') return serveStatic(req, res, pathname);
  fail(405, 'Метод не поддерживается.');
}
const server = http.createServer((req, res) => {
  handle(req, res).catch(error => {
    if (res.headersSent) { res.destroy(); return; }
    const status = error.status || 500;
    if (status >= 500) console.error('Server error:', error.message);
    json(res, status, { error: status >= 500 && !error.status ? 'Внутренняя ошибка сервера.' : error.message });
  });
});
setInterval(() => {
  const now = Date.now();
  for (const [key, session] of sessions) if (session.expires <= now) sessions.delete(key);
  for (const [key, entry] of loginAttempts) if (entry.reset <= now) loginAttempts.delete(key);
}, 60 * 60 * 1000).unref();
if (require.main === module) {
  server.listen(PORT, HOST, () => {
    console.log(`RVKINO PRODUCTION: http://${HOST}:${PORT}`);
    console.log(ADMIN_ENABLED ? 'Admin login configured.' : 'Admin disabled. Run npm run setup to configure.');
  });
}
module.exports = { server };
