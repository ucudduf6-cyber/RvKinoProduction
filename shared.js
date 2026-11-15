(function () {
  'use strict';
  const apiBase = String(window.RVKINO_API_BASE || '').trim().replace(/\/+$/, '');
  const types = { film: 'ФИЛЬМ', series: 'СЕРИАЛ', show: 'ШОУ', vertical: 'ВЕРТИКАЛЬНЫЙ СЕРИАЛ' };
  const isGithubPages = location.hostname.endsWith('.github.io');

  function posterUrl(poster) {
    if (!poster || typeof poster !== 'string') return '';
    // Paths are generated/validated by the server. No user-supplied arbitrary URLs.
    if (!/^assets\/posters\/(?:uploads\/)?[a-zA-Z0-9_.-]+$/.test(poster)) return '';
    const path = poster.split('/').map(encodeURIComponent).join('/');
    return poster.startsWith('assets/posters/uploads/') && apiBase ? apiBase + '/' + path : path;
  }
  async function publicProjects() {
    if (!isGithubPages || apiBase) {
      try {
        const response = await fetch(apiBase + '/api/projects', { cache: 'no-store' });
        if (response.ok) {
          const projects = await response.json();
          if (Array.isArray(projects)) return projects;
        }
      } catch (_) { /* local/static fallback */ }
    }
    const response = await fetch('projects.json', { cache: 'no-store' });
    if (!response.ok) throw new Error('Не удалось загрузить проекты');
    const projects = await response.json();
    return Array.isArray(projects) ? projects.filter(p => p.published !== false) : [];
  }
  function createPoster(poster, alt, loading) {
    const src = posterUrl(poster);
    if (!src) {
      const placeholder = document.createElement('div');
      placeholder.className = 'poster-placeholder';
      placeholder.textContent = 'RVKINO';
      return placeholder;
    }
    const img = document.createElement('img');
    img.src = src;
    img.alt = alt;
    img.loading = loading || 'lazy';
    img.onerror = () => { img.style.display = 'none'; img.parentElement.classList.add('missing-poster'); };
    return img;
  }
  function setAdminLink() {
    const el = document.getElementById('admin-entry');
    if (el && apiBase) el.href = apiBase + '/admin.html';
  }
  window.RVKINO = { apiBase, types, posterUrl, publicProjects, createPoster, setAdminLink, isGithubPages };
  setAdminLink();
})();
