'use strict';
(() => {
  const { posterUrl, types, isGithubPages, apiBase } = window.RVKINO;
  const $ = id => document.getElementById(id);
  const icon = name => { const img = document.createElement('img'); img.src = 'assets/icons/' + name + '.svg'; img.alt = ''; img.setAttribute('aria-hidden', 'true'); return img; };
  const form = $('project-form'), modal = $('project-modal'), itemModal = $('item-modal');
  const field = name => form.elements.namedItem(name);
  let csrf = '', projects = [], posters = [], site = { settings: {}, contacts: [], links: [], news: [] };
  let projectId = null, poster = '', itemId = null, collection = '', busy = false, activeTab = 'overview';
  async function request(url, options = {}) {
    const headers = { ...(options.headers || {}) };
    if (options.body && !(options.body instanceof FormData)) headers['content-type'] = 'application/json';
    if (options.method && options.method !== 'GET') headers['X-RVKINO-CSRF'] = csrf;
    const response = await fetch(url, { credentials: 'same-origin', cache: 'no-store', ...options, headers });
    let data = {}; try { data = await response.json(); } catch (_) { /* server unavailable */ }
    if (!response.ok) throw new Error(data.error || 'Ошибка сервера: ' + response.status);
    return data;
  }
  function notice(element, message, kind = 'error') { element.textContent = message; element.className = 'admin-alert ' + kind; element.hidden = false; }
  function hideNotice(element) { element.hidden = true; }
  function lockModal(open) { document.body.style.overflow = open ? 'hidden' : ''; }
  function button(label, iconName, callback, cls = 'row-btn') { const el = document.createElement('button'); el.type = 'button'; el.className = cls; if (iconName) el.append(icon(iconName)); el.append(document.createTextNode(label)); el.addEventListener('click', callback); return el; }
  function showLogin() { $('boot-message').hidden = true; $('dashboard').hidden = true; $('login-view').hidden = false; }
  async function showDashboard() { $('boot-message').hidden = true; $('login-view').hidden = true; $('dashboard').hidden = false; await refresh(); switchTab(activeTab); }
  async function refresh() {
    const [p, photos, content] = await Promise.all([request('/api/admin/projects'), request('/api/admin/posters'), request('/api/admin/site')]);
    projects = p.projects || []; posters = photos.posters || []; site = content;
    renderProjects(); renderCollection('contacts'); renderCollection('links'); renderCollection('news'); fillSettings(); updateStats();
  }
  function switchTab(name) {
    activeTab = name;
    document.querySelectorAll('.admin-tab').forEach(tab => tab.hidden = tab.id !== 'tab-' + name);
    document.querySelectorAll('#admin-navigation button').forEach(btn => btn.classList.toggle('active', btn.dataset.tab === name));
    const titles = { overview: 'ОБЗОР', projects: 'ПРОЕКТЫ', settings: 'О САЙТЕ', contacts: 'КОНТАКТЫ', links: 'ССЫЛКИ', news: 'НОВОСТИ' };
    $('current-breadcrumb').textContent = titles[name] || '';
    closeAdminNavigation();
    window.scrollTo({ top: 0, behavior: 'instant' });
  }
  function updateStats() {
    $('stat-projects').textContent = projects.length;
    $('stat-published').textContent = projects.filter(p => p.published !== false).length;
    $('stat-news').textContent = (site.news || []).filter(n => n.published).length;
    $('stat-links').textContent = (site.contacts || []).length + (site.links || []).length;
  }
  function rowBase(title, subtitle, iconName, posterSrc) {
    const row = document.createElement('article'); row.className = 'admin-row';
    const media = document.createElement('div'); media.className = posterSrc ? 'admin-row-poster' : 'admin-row-icon';
    if (posterSrc) { const img = document.createElement('img'); img.src = posterSrc; img.alt = ''; img.loading = 'lazy'; img.onerror = () => { media.replaceChildren(icon('film')); }; media.append(img); }
    else media.append(icon(iconName));
    const info = document.createElement('div'); info.className = 'admin-row-info';
    const h = document.createElement('h3'); h.textContent = title;
    const p = document.createElement('p'); p.textContent = subtitle;
    info.append(h, p); row.append(media, info);
    const actions = document.createElement('div'); actions.className = 'admin-row-actions'; row.append(actions);
    return { row, actions };
  }
  function emptyList(list, label) { const div = document.createElement('div'); div.className = 'empty-admin'; div.append(icon('info')); const p = document.createElement('p'); p.textContent = label; div.append(p); list.append(div); }
  function renderProjects() {
    const list = $('admin-list'); list.replaceChildren();
    $('admin-count').textContent = `${projects.length} ВСЕГО / ${projects.filter(p => p.published !== false).length} ОПУБЛИКОВАНО`;
    if (!projects.length) { emptyList(list, 'Пока нет проектов. Добавьте первый фильм, сериал или шоу.'); return; }
    for (const p of projects) {
      const { row, actions } = rowBase(p.title, [types[p.type] || 'ПРОЕКТ', p.year, p.published === false ? 'ЧЕРНОВИК' : 'НА САЙТЕ'].filter(Boolean).join(' · '), 'film', posterUrl(p.poster));
      actions.append(button('Изменить', 'pencil', () => openProject(p)));
      if (p.published !== false) actions.append(button('Открыть', 'external-link', () => window.open('project.html?id=' + encodeURIComponent(p.id), '_blank', 'noopener,noreferrer')));
      list.append(row);
    }
  }
  const colInfo = {
    contacts: { list: 'contacts-list', icon: 'contact', name: 'контакт' },
    links: { list: 'links-list', icon: 'link-2', name: 'ссылка' },
    news: { list: 'news-admin-list', icon: 'newspaper', name: 'новость' }
  };
  function renderCollection(col) {
    const list = $(colInfo[col].list); list.replaceChildren();
    const items = site[col] || [];
    if (!items.length) { emptyList(list, 'Пока нет записей. Нажмите «Добавить», чтобы создать первую.'); return; }
    for (const item of items) {
      const subtitle = col === 'news' ? [item.date, item.published ? 'ОПУБЛИКОВАНО' : 'ЧЕРНОВИК'].filter(Boolean).join(' · ')
        : [item.value || item.url, item.visible ? 'НА САЙТЕ' : 'СКРЫТО'].filter(Boolean).join(' · ');
      const { row, actions } = rowBase(item.title || item.label, subtitle, colInfo[col].icon);
      actions.append(button('Изменить', 'pencil', () => openItem(col, item)));
      actions.append(button('Удалить', 'trash-2', () => removeItem(col, item)));
      list.append(row);
    }
  }
  function fillSettings() {
    const form = $('settings-form');
    for (const name of ['siteName', 'siteDescription', 'heroEyebrow', 'heroTitle', 'heroDescription', 'aboutTitle', 'aboutDescription', 'contactTitle', 'contactDescription']) form.elements.namedItem(name).value = site.settings?.[name] || '';
  }
  $('admin-navigation').addEventListener('click', e => { const tab = e.target.closest('[data-tab]'); if (tab) switchTab(tab.dataset.tab); });
  const sideMenu = $('admin-sidebar');
  const sideBackdrop = $('admin-sidebar-backdrop');
  const sideToggle = $('admin-mobile-menu');
  function closeAdminNavigation() {
    sideMenu.classList.remove('open');
    sideBackdrop.hidden = true;
    sideToggle.setAttribute('aria-expanded','false');
    sideToggle.setAttribute('aria-label','Открыть разделы');
  }
  sideToggle.addEventListener('click', () => {
    const shouldOpen = !sideMenu.classList.contains('open');
    sideMenu.classList.toggle('open', shouldOpen);
    sideBackdrop.hidden = !shouldOpen;
    sideToggle.setAttribute('aria-expanded',String(shouldOpen));
    sideToggle.setAttribute('aria-label',shouldOpen ? 'Закрыть разделы' : 'Открыть разделы');
  });
  sideBackdrop.addEventListener('click', closeAdminNavigation);
  window.addEventListener('resize', () => { if (innerWidth > 760) closeAdminNavigation(); });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && sideMenu.classList.contains('open')) { closeAdminNavigation(); sideToggle.focus(); }
  });
  $('quick-project').addEventListener('click', () => { switchTab('projects'); openProject(); });
  $('quick-news').addEventListener('click', () => { switchTab('news'); openItem('news'); });
  $('add-project').addEventListener('click', () => openProject());
  document.querySelectorAll('[data-add]').forEach(el => el.addEventListener('click', () => openItem(el.dataset.add)));
  $('settings-form').addEventListener('submit', async e => {
    e.preventDefault(); const btn = $('save-settings'); btn.disabled = true; hideNotice($('settings-alert'));
    const data = {}; for (const el of e.target.querySelectorAll('[name]')) data[el.name] = el.value.trim();
    try { const result = await request('/api/admin/site', { method: 'PUT', body: JSON.stringify(data) }); site.settings = result.settings; notice($('settings-alert'), 'Изменения сохранены и уже отображаются на сайте.', 'success'); }
    catch (error) { notice($('settings-alert'), error.message); } finally { btn.disabled = false; }
  });
  function renderPosters() {
    const library = $('poster-library'); library.replaceChildren();
    const search = $('poster-search').value.trim().toLowerCase();
    for (const name of posters.filter(p => p.toLowerCase().includes(search))) {
      const b = document.createElement('button'); b.type = 'button'; b.className = 'poster-option' + (name === poster ? ' selected' : ''); b.title = name.split('/').pop(); b.setAttribute('aria-label', 'Выбрать постер ' + b.title); b.setAttribute('aria-pressed', String(name === poster));
      const img = document.createElement('img'); img.src = posterUrl(name); img.alt = ''; img.loading = 'lazy'; b.append(img);
      b.addEventListener('click', () => { poster = name; renderPosters(); updatePoster(); }); library.append(b);
    }
    if (!library.children.length) library.textContent = 'Ничего не найдено';
  }
  function updatePoster() {
    const preview = $('poster-preview'); preview.replaceChildren();
    if (poster) { const img = document.createElement('img'); img.src = posterUrl(poster); img.alt = 'Выбранный постер'; img.onerror = () => { preview.textContent = 'Постер не загружен'; }; preview.append(img); }
    else preview.textContent = 'НЕТ ПОСТЕРА';
  }
  function openProject(p = null) {
    projectId = p?.id || null; poster = p?.poster || ''; form.reset(); hideNotice($('form-alert'));
    field('watchUrl').value = 'https://rvkino.ru/';
    $('poster-search').value = ''; $('poster-upload').value = '';
    $('modal-title').textContent = p ? 'Редактировать проект' : 'Новый проект'; $('delete-project').hidden = !p;
    if (p) { for (const name of ['title','type','year','status','logline','synopsis','genre','duration','director','role','cast','watchUrl','imdb']) field(name).value = p[name] || ''; field('published').checked = p.published !== false; }
    renderPosters(); updatePoster(); modal.hidden = false; lockModal(true); field('title').focus();
  }
  function closeProject() { if (busy) return; modal.hidden = true; lockModal(false); }
  $('close-modal').addEventListener('click', closeProject); $('cancel-project').addEventListener('click', closeProject);
  modal.addEventListener('click', e => { if (e.target === modal) closeProject(); });
  $('poster-search').addEventListener('input', renderPosters);
  $('clear-poster').addEventListener('click', () => { poster = ''; renderPosters(); updatePoster(); });
  $('poster-upload').addEventListener('change', async e => {
    const file = e.target.files[0]; if (!file) return;
    if (file.size > 8 * 1024 * 1024) { notice($('form-alert'), 'Постер должен быть не больше 8 МБ.'); return; }
    const data = new FormData(); data.append('file', file); e.target.disabled = true;
    try { const result = await request('/api/admin/upload', { method: 'POST', body: data }); poster = result.poster; posters.unshift(poster); $('poster-search').value = ''; renderPosters(); updatePoster(); notice($('form-alert'), 'Постер загружен. Сохраните проект, чтобы использовать его.', 'success'); }
    catch (err) { notice($('form-alert'), err.message); } finally { e.target.disabled = false; e.target.value = ''; }
  });
  function projectPayload() { const data = {}; for (const name of ['title','type','year','status','logline','synopsis','genre','duration','director','role','cast','watchUrl','imdb']) data[name] = field(name).value.trim(); data.poster = poster; data.published = field('published').checked; return data; }
  form.addEventListener('submit', async e => {
    e.preventDefault(); if (busy) return; busy = true; $('save-project').disabled = true; hideNotice($('form-alert'));
    try { const result = await request(projectId ? '/api/admin/projects/' + projectId : '/api/admin/projects', { method: projectId ? 'PUT' : 'POST', body: JSON.stringify(projectPayload()) }); busy = false; closeProject(); await refresh(); notice($('dashboard-alert'), 'Проект «' + result.project.title + '» сохранён.', 'success'); }
    catch (err) { notice($('form-alert'), err.message); } finally { busy = false; $('save-project').disabled = false; }
  });
  $('delete-project').addEventListener('click', async () => {
    if (!projectId || busy || !confirm('Удалить проект «' + field('title').value + '» без возможности восстановления?')) return;
    busy = true;
    try { await request('/api/admin/projects/' + projectId, { method: 'DELETE' }); busy = false; closeProject(); await refresh(); notice($('dashboard-alert'), 'Проект удалён.', 'success'); }
    catch (err) { notice($('form-alert'), err.message); } finally { busy = false; }
  });
  const schemas = {
    contacts: [{name:'label',label:'НАЗВАНИЕ *',required:true,max:80,placeholder:'Telegram / Email / Телефон'}, {name:'value',label:'ПОДПИСЬ',max:180,placeholder:'@RvKino'}, {name:'url',label:'ССЫЛКА',max:1500,placeholder:'https://t.me/... или mailto:... или tel:...'}, {name:'visible',label:'Показывать на сайте',type:'checkbox'}],
    links: [{name:'label',label:'НАЗВАНИЕ *',required:true,max:80,placeholder:'Онлайн-кинотеатр'}, {name:'url',label:'HTTPS-ССЫЛКА *',type:'url',required:true,max:1500,placeholder:'https://rvkino.ru/'}, {name:'visible',label:'Показывать на сайте',type:'checkbox'}],
    news: [{name:'title',label:'ЗАГОЛОВОК *',required:true,max:180,placeholder:'Новый проект RVKINO'}, {name:'date',label:'ДАТА',type:'date'}, {name:'excerpt',label:'КРАТКОЕ ОПИСАНИЕ',max:400,placeholder:'Одна-две строки о новости'}, {name:'body',label:'ПОЛНЫЙ ТЕКСТ',type:'textarea',max:8000,rows:6}, {name:'url',label:'ССЫЛКА НА ПУБЛИКАЦИЮ (НЕОБЯЗАТЕЛЬНО)',type:'url',max:1500,placeholder:'https://...'}, {name:'published',label:'Опубликовать на сайте',type:'checkbox'}]
  };
  function buildItemFields(col, item) {
    const root = $('item-fields'); root.replaceChildren();
    for (const def of schemas[col]) {
      const label = document.createElement('label'); label.className = 'full';
      if (def.type === 'checkbox') label.className += ' check-row';
      let input;
      if (def.type === 'textarea') { input = document.createElement('textarea'); input.rows = def.rows || 4; }
      else { input = document.createElement('input'); input.type = def.type || 'text'; }
      input.name = def.name; input.required = Boolean(def.required); if (def.max) input.maxLength = def.max;
      if (def.placeholder) input.placeholder = def.placeholder;
      if (def.type === 'checkbox') { input.checked = item ? item[def.name] === true : true; label.append(input, document.createTextNode(' ' + def.label)); }
      else { label.append(document.createTextNode(def.label), input); input.value = item?.[def.name] || (def.type === 'date' ? new Date().toISOString().slice(0,10) : ''); }
      root.append(label);
    }
  }
  function openItem(col, item = null) {
    collection = col; itemId = item?.id || null; hideNotice($('item-alert'));
    const title = col === 'contacts' ? 'контакт' : col === 'links' ? 'ссылку' : 'новость';
    $('item-modal-title').textContent = item ? 'Редактировать ' + title : 'Добавить ' + title;
    $('item-modal-label').textContent = col === 'news' ? 'НОВОСТИ СТУДИИ' : col === 'contacts' ? 'КОНТАКТЫ' : 'ВНЕШНИЕ ССЫЛКИ';
    $('delete-item').hidden = !item;
    buildItemFields(col, item); itemModal.hidden = false; lockModal(true);
    const first = $('item-fields').querySelector('input:not([type=checkbox])'); if (first) first.focus();
  }
  function closeItem() { if (busy) return; itemModal.hidden = true; lockModal(false); }
  $('close-item').addEventListener('click', closeItem); $('cancel-item').addEventListener('click', closeItem);
  itemModal.addEventListener('click', e => { if (e.target === itemModal) closeItem(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') { if (!modal.hidden) closeProject(); else if (!itemModal.hidden) closeItem(); } });
  function itemPayload() { const data = {}; for (const def of schemas[collection]) { const input = $('item-form').elements.namedItem(def.name); data[def.name] = def.type === 'checkbox' ? input.checked : input.value.trim(); } return data; }
  $('item-form').addEventListener('submit', async e => {
    e.preventDefault(); if (busy) return; busy = true; $('save-item').disabled = true; hideNotice($('item-alert'));
    try { await request('/api/admin/' + collection + (itemId ? '/' + itemId : ''), { method: itemId ? 'PUT' : 'POST', body: JSON.stringify(itemPayload()) }); busy = false; closeItem(); await refresh(); notice($('dashboard-alert'), 'Изменения сохранены и доступны на сайте.', 'success'); }
    catch (err) { notice($('item-alert'), err.message); } finally { busy = false; $('save-item').disabled = false; }
  });
  async function removeItem(col, item) {
    if (!confirm('Удалить «' + (item.title || item.label) + '»?')) return;
    try { await request('/api/admin/' + col + '/' + item.id, { method: 'DELETE' }); await refresh(); notice($('dashboard-alert'), 'Запись удалена.', 'success'); }
    catch (err) { notice($('dashboard-alert'), err.message); }
  }
  $('delete-item').addEventListener('click', async () => {
    if (!itemId || busy || !confirm('Удалить эту запись без возможности восстановления?')) return;
    busy = true;
    try { await request('/api/admin/' + collection + '/' + itemId, { method: 'DELETE' }); busy = false; closeItem(); await refresh(); notice($('dashboard-alert'), 'Запись удалена.', 'success'); }
    catch (err) { notice($('item-alert'), err.message); } finally { busy = false; }
  });
  $('login-form').addEventListener('submit', async e => {
    e.preventDefault(); hideNotice($('login-alert')); const btn = e.target.querySelector('button'); btn.disabled = true;
    try { const result = await request('/api/admin/login', { method: 'POST', body: JSON.stringify({ username: e.target.elements.namedItem('username').value, password: e.target.elements.namedItem('password').value }) }); csrf = result.csrf; e.target.reset(); await showDashboard(); }
    catch (err) { notice($('login-alert'), err.message); } finally { btn.disabled = false; }
  });
  $('logout').addEventListener('click', async () => { try { await request('/api/admin/logout', { method: 'POST' }); } catch (_) {} csrf = ''; projects = []; showLogin(); });
  async function boot() {
    if (isGithubPages) { if (apiBase) { location.replace(apiBase + '/admin.html'); return; } notice($('boot-message'), 'Для админки необходим Node.js-сервер. GitHub Pages не сохраняет изменения.'); return; }
    try { const s = await request('/api/admin/session'); if (s.loggedIn) { csrf = s.csrf; await showDashboard(); } else { showLogin(); if (!s.configured) notice($('login-alert'), 'Для начала запустите npm run setup на сервере.'); } }
    catch (err) { notice($('boot-message'), 'Сервер управления недоступен. Откройте сайт через Node.js. ' + err.message); }
  }
  boot();
})();
