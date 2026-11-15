'use strict';
(() => {
  const { publicProjects, posterUrl, types, apiBase } = window.RVKINO;
  const $ = id => document.getElementById(id);
  const icon = name => { const img = document.createElement('img'); img.src = 'assets/icons/' + name + '.svg'; img.alt = ''; img.setAttribute('aria-hidden','true'); return img; };
  $('year').textContent = new Date().getFullYear();
  const menu = $('menu-toggle');
  menu.addEventListener('click', () => { const expanded = menu.getAttribute('aria-expanded') === 'true'; menu.setAttribute('aria-expanded', String(!expanded)); $('site-header').classList.toggle('menu-open', !expanded); menu.setAttribute('aria-label', expanded ? 'Открыть меню' : 'Закрыть меню'); });
  document.querySelectorAll('.main-nav a').forEach(link => link.addEventListener('click', () => { closeMobileNavigation(); }));
  function closeMobileNavigation() {
    const header = document.querySelector('.site-header');
    header.classList.remove('menu-open');
    menu.setAttribute('aria-expanded', 'false');
    menu.setAttribute('aria-label', 'Открыть меню');
  }
  document.addEventListener('click', event => {
    const header = document.querySelector('.site-header');
    if (header.classList.contains('menu-open') && !header.contains(event.target)) closeMobileNavigation();
  });
  document.addEventListener('keydown', event => { if (event.key === 'Escape') closeMobileNavigation(); });
  window.addEventListener('resize', () => { if (innerWidth > 760) closeMobileNavigation(); });
  window.addEventListener('scroll', () => { const total = document.documentElement.scrollHeight - innerHeight; $('progress').style.width = (total > 0 ? scrollY / total * 100 : 0) + '%'; }, { passive: true });
  let projects = [];
  let filter = 'all';
  function card(project) {
    const a = document.createElement('a'); a.className = 'project-card'; a.href = 'project.html?id=' + encodeURIComponent(project.id);
    const media = document.createElement('div'); media.className = 'project-media';
    if (posterUrl(project.poster)) {
      const img = document.createElement('img'); img.src = posterUrl(project.poster); img.alt = 'Постер: ' + project.title; img.loading = 'lazy';
      img.onerror = () => { media.classList.add('no-poster'); img.remove(); const mark = document.createElement('strong'); mark.textContent = 'RVKINO'; media.prepend(mark); };
      media.append(img);
    } else { media.classList.add('no-poster'); const mark = document.createElement('strong'); mark.textContent = 'RVKINO'; media.append(mark); }
    const arrow = document.createElement('span'); arrow.className = 'project-arrow'; arrow.append(icon('arrow-up-right')); media.append(arrow);
    const meta = document.createElement('div'); meta.className = 'project-meta';
    const left = document.createElement('div'); const h = document.createElement('h3'); h.textContent = project.title;
    const desc = document.createElement('p'); desc.textContent = [types[project.type] || 'ПРОЕКТ', project.status].filter(Boolean).join(' / ');
    left.append(h, desc);
    const year = document.createElement('span'); year.className = 'project-year'; year.textContent = project.year || '';
    meta.append(left, year); a.append(media, meta); return a;
  }
  function renderProjects() {
    const items = projects.filter(p => filter === 'all' || p.type === filter);
    $('projects').replaceChildren(...items.map(card));
    $('empty').hidden = projects.length > 0;
    $('no-filter').hidden = projects.length === 0 || items.length > 0;
    $('project-count').textContent = projects.length + ' ' + (projects.length === 1 ? 'ПРОЕКТ' : 'ПРОЕКТОВ');
  }
  $('project-filters').addEventListener('click', e => {
    const b = e.target.closest('button[data-filter]'); if (!b) return;
    filter = b.dataset.filter;
    $('project-filters').querySelectorAll('button').forEach(node => { node.classList.toggle('active', node === b); node.setAttribute('aria-pressed', String(node === b)); });
    renderProjects();
  });
  publicProjects().then(data => { projects = data; renderProjects(); }).catch(() => { $('empty').querySelector('p').textContent = 'Не удалось загрузить каталог. Попробуйте обновить страницу.'; });
  function safeUrl(url) {
    try { const u = new URL(url); if (['https:', 'mailto:', 'tel:'].includes(u.protocol) && !u.username && !u.password) return u.href; }
    catch (_) { /* invalid URL */ }
    return '';
  }
  function row(label, value, url) {
    const href = safeUrl(url);
    const el = document.createElement(href ? 'a' : 'div'); el.className = 'link-row';
    if (href) { el.href = href; if (href.startsWith('https:')) { el.target = '_blank'; el.rel = 'noopener noreferrer'; } }
    const name = document.createElement('span'); name.textContent = label;
    const end = document.createElement('span'); const v = document.createElement('span'); v.className = 'link-value'; v.textContent = value || (href ? new URL(href).hostname : ''); end.append(v); if (href) end.append(icon('arrow-up-right'));
    el.append(name, end); return el;
  }
  function formatDate(value) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) return 'НОВОСТЬ';
    const [year, month, day] = value.split('-'); return day + '.' + month + '.' + year;
  }
  function newsDetail(item) {
    const dialog = document.createElement('dialog'); dialog.className = 'news-dialog';
    const wrap = document.createElement('div'); wrap.className = 'news-dialog-content';
    const close = document.createElement('button'); close.type = 'button'; close.className = 'icon-button'; close.setAttribute('aria-label', 'Закрыть новость'); close.append(icon('x'));
    const date = document.createElement('span'); date.className = 'fine-label'; date.textContent = formatDate(item.date);
    const h = document.createElement('h2'); h.textContent = item.title;
    const body = document.createElement('p'); body.textContent = item.body || item.excerpt || '';
    wrap.append(close, date, h, body); dialog.append(wrap); document.body.append(dialog);
    close.addEventListener('click', () => dialog.close()); dialog.addEventListener('click', e => { if (e.target === dialog) dialog.close(); }); dialog.addEventListener('close', () => dialog.remove());
    dialog.showModal();
  }
  function renderNews(items) {
    $('news-list').replaceChildren(); $('news-empty').hidden = items.length > 0;
    for (const item of items) {
      const card = document.createElement('article'); card.className = 'news-card';
      const date = document.createElement('span'); date.className = 'news-date'; date.textContent = formatDate(item.date);
      const body = document.createElement('div'); const h = document.createElement('h3'); h.textContent = item.title; const p = document.createElement('p'); p.textContent = item.excerpt || ''; body.append(h, p);
      card.append(date, body);
      if (item.body || safeUrl(item.url)) {
        const action = document.createElement(item.url ? 'a' : 'button');
        if (item.url && safeUrl(item.url)) { action.href = safeUrl(item.url); action.target = '_blank'; action.rel = 'noopener noreferrer'; action.setAttribute('aria-label', 'Открыть новость: ' + item.title); }
        else { action.type = 'button'; action.setAttribute('aria-label', 'Читать новость: ' + item.title); action.addEventListener('click', () => newsDetail(item)); }
        action.append(icon('arrow-up-right')); card.append(action);
      }
      $('news-list').append(card);
    }
  }
  async function loadSite() {
    let site;
    try { const response = await fetch(apiBase + '/api/site', { cache: 'no-store' }); if (!response.ok) return; site = await response.json(); }
    catch (_) { return; }
    const settings = site.settings || {};
    const mapping = { heroEyebrow: 'hero-eyebrow', heroTitle: 'hero-title', heroDescription: 'hero-description', aboutTitle: 'about-title', aboutDescription: 'about-description', contactTitle: 'contact-title', contactDescription: 'contact-description' };
    for (const [key, id] of Object.entries(mapping)) if (typeof settings[key] === 'string') $(id).textContent = settings[key];
    if (settings.siteName) { document.title = settings.siteName + ' — независимый кинопродакшен'; document.querySelector('.footer-row>span').textContent = '© ' + new Date().getFullYear() + ' ' + settings.siteName; }
    if (typeof settings.siteDescription === 'string') document.querySelector('meta[name=description]').content = settings.siteDescription;
    const contacts = site.contacts || [], links = site.links || [];
    $('contact-list').replaceChildren(...contacts.map(c => row(c.label, c.value, c.url)));
    $('external-list').replaceChildren(...links.map(l => row(l.label, '', l.url)));
    if (contacts.length) { const url = safeUrl(contacts[0].url); if (url) { $('contact-primary').href = url; if (!url.startsWith('https:')) { $('contact-primary').removeAttribute('target'); } } else $('contact-primary').hidden = true; }
    else $('contact-primary').hidden = true;
    renderNews(site.news || []);
  }
  loadSite();
})();
