'use strict';
(() => {
  const { types, publicProjects, createPoster } = window.RVKINO;
  const $ = id => document.getElementById(id);
  $('year').textContent = new Date().getFullYear();
  const menu = $('menu-toggle');
  menu.addEventListener('click', () => { const opened = menu.getAttribute('aria-expanded') === 'true'; menu.setAttribute('aria-expanded', String(!opened)); document.querySelector('.site-header').classList.toggle('menu-open', !opened); menu.setAttribute('aria-label', opened ? 'Открыть меню' : 'Закрыть меню'); });
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
  document.querySelectorAll('.main-nav a').forEach(link => link.addEventListener('click', closeMobileNavigation));
  window.addEventListener('scroll', () => { const max = document.documentElement.scrollHeight - innerHeight; $('progress').style.width = (max > 0 ? scrollY / max * 100 : 0) + '%'; }, { passive: true });
  function icon(name) { const img = document.createElement('img'); img.src = 'assets/icons/' + name + '.svg'; img.alt = ''; return img; }
  function fact(label, value) { if (!value) return; const el = document.createElement('div'); el.className = 'fact-row'; const dt = document.createElement('dt'); dt.textContent = label; const dd = document.createElement('dd'); dd.textContent = value; el.append(dt, dd); $('detail-facts').append(el); }
  function validWatch(value) { try { const url = new URL(value); if (url.protocol === 'https:' && ['rvkino.ru', 'www.rvkino.ru'].includes(url.hostname) && !url.username && !url.password) return url.href; } catch (_) {} return ''; }
  async function render() {
    const id = new URLSearchParams(location.search).get('id');
    const projects = await publicProjects(); const p = projects.find(x => x.id === id);
    if (!p) { document.title = 'Проект не найден — RVKINO'; $('detail-title').textContent = 'Проект не найден.'; $('detail-logline').textContent = 'Проект удалён или пока не опубликован.'; $('detail-info').hidden = true; return; }
    document.title = p.title + ' — RVKINO PRODUCTION'; $('detail-title').textContent = p.title;
    $('detail-type').textContent = types[p.type] || 'ПРОЕКТ'; $('detail-year').textContent = p.year || '';
    $('detail-logline').textContent = p.logline || ''; $('detail-synopsis').textContent = p.synopsis || p.logline || 'Описание появится позже.';
    $('detail-poster').replaceChildren(createPoster(p.poster, 'Постер проекта ' + p.title, 'eager'));
    const watch = validWatch(p.watchUrl);
    if (watch) { const a = document.createElement('a'); a.className = 'btn btn-white'; a.href = watch; a.target = '_blank'; a.rel = 'noopener noreferrer'; a.textContent = 'СМОТРЕТЬ НА RVKINO'; a.append(icon('arrow-up-right')); $('detail-actions').append(a); }
    else { const span = document.createElement('span'); span.className = 'watch-unavailable'; span.textContent = 'СКОРО НА RVKINO.RU'; $('detail-actions').append(span); }
    if (p.imdb) { try { const u = new URL(p.imdb); if (u.protocol === 'https:' && ['imdb.com','www.imdb.com'].includes(u.hostname)) { const a = document.createElement('a'); a.className = 'btn btn-outline'; a.href = u.href; a.target = '_blank'; a.rel = 'noopener noreferrer'; a.textContent = 'IMDb'; a.append(icon('external-link')); $('detail-actions').append(a); } } catch (_) {} }
    [['ФОРМАТ',types[p.type]],['ГОД',p.year],['СТАТУС',p.status],['ЖАНР',p.genre],['ХРОНОМЕТРАЖ',p.duration],['РЕЖИССЁР',p.director],['УЧАСТИЕ',p.role],['В РОЛЯХ / КОМАНДА',p.cast]].forEach(([label,value]) => fact(label,value));
  }
  render().catch(() => { $('detail-title').textContent = 'Ошибка загрузки.'; $('detail-logline').textContent = 'Попробуйте открыть страницу позже.'; $('detail-info').hidden = true; });
})();
