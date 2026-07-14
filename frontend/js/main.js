/* Main Application Logic */

const API_BASE = '';

// Escapa texto del usuario antes de inyectarlo al DOM (previene XSS almacenado)
function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// Solo permite URLs http/https (la foto de Google) — evita javascript:/data: en src
function safeUrl(url) {
  const s = String(url ?? '').trim();
  return /^https?:\/\//i.test(s) ? s.replace(/"/g, '&quot;') : '';
}

// DOM elements
const grid = document.getElementById('profGrid');
const searchInput = document.getElementById('searchInput');
const modal = document.getElementById('modal');
const modalContent = document.getElementById('modalContent');
const sectionTitle = document.querySelector('#profes .section-title');
const cycleBadge = document.querySelector('#profes .cycle-badge');

// Application State
let _mode = 'ranking';
let _activeCU = 'all';
let _currentProfes = [];
let _currentRanking = [];
let _googleUser = null;   // { email, name } when verified via Google OAuth session

const AVATAR_COLORS = {
  CUCEI: 'av-blue', CUCEA: 'av-purple', CUCS: 'av-coral',
  CUAAD: 'av-teal', CUCBA: 'av-teal', CUCSH: 'av-purple',
  CUCSUR: 'av-blue', CUALTOS: 'av-teal', CUTONALA: 'av-blue',
  UDG_VIRTUAL: 'av-purple'
};

// Google OAuth Authentication Flow via Popup
async function _checkGoogleSession() {
  try {
    const res = await fetch(`${API_BASE}/api/auth/me`);
    const data = await res.json();
    _googleUser = data.verified ? { email: data.email, name: data.name, picture: data.picture || '' } : null;
  } catch { _googleUser = null; }
}

function _openGoogleVerification() {
  const w = 500, h = 620;
  const left = Math.round(screen.width / 2 - w / 2);
  const top  = Math.round(screen.height / 2 - h / 2);

  // Clear stale result before opening
  try { localStorage.removeItem('_gauth'); } catch(e) {}

  const popup = window.open(
    `${API_BASE}/api/auth/google`, 'google-auth',
    `width=${w},height=${h},left=${left},top=${top},resizable=yes,scrollbars=yes`
  );
  if (!popup) { window.location.href = `${API_BASE}/api/auth/google`; return; }

  const handle = async (status) => {
    window.removeEventListener('storage', onStorage);
    window.removeEventListener('message', onMsg);
    await _checkGoogleSession();
    _updateGoogleUI(status !== 'ok' ? status : null);
  };

  // localStorage is more reliable than postMessage across OAuth redirects
  const onStorage = (e) => {
    if (e.key !== '_gauth' || !e.newValue) return;
    localStorage.removeItem('_gauth');
    handle(e.newValue);
  };
  window.addEventListener('storage', onStorage);

  // postMessage as backup (same-origin popup that didn't redirect)
  const onMsg = (e) => {
    if (e.origin !== window.location.origin || e.data?.type !== 'google-auth') return;
    handle(e.data.status);
  };
  window.addEventListener('message', onMsg);
}

async function _clearGoogleAuth() {
  try { await fetch(`${API_BASE}/api/auth/logout`, { method: 'POST' }); } catch {}
  _googleUser = null;
  _updateGoogleUI();
}

function _updateGoogleUI(state) {
  const btnEl     = document.getElementById('rfGoogleBtn');
  const nombreWrap = document.getElementById('rfNombreWrap');
  if (!btnEl) return;

  if (_googleUser) {
    btnEl.innerHTML = `
      <div style="display:inline-flex;align-items:center;gap:8px;padding:8px 14px;background:var(--teal-50);border-radius:999px;width:100%;box-sizing:border-box;">
        <i class="ti ti-circle-check-filled" style="color:var(--teal-600);font-size:15px;flex-shrink:0;"></i>
        <span style="font-size:13px;font-weight:600;color:var(--teal-900);flex:1;">${_googleUser.email}</span>
        <button onclick="_clearGoogleAuth()" style="background:none;border:none;cursor:pointer;color:var(--text-tertiary);padding:0;line-height:1;font-size:14px;">✕</button>
      </div>`;

    if (nombreWrap) {
      const photoHtml = _googleUser.picture
        ? `<img src="${_googleUser.picture}" style="width:30px;height:30px;border-radius:50%;flex-shrink:0;margin-top:1px;" onerror="this.style.display='none'">`
        : '';
      const fotoLabel = _googleUser.picture ? ' y foto' : '';
      nombreWrap.style.cssText = 'display:flex;align-items:flex-start;gap:8px;margin-top:4px;';
      nombreWrap.innerHTML = `
        <input type="checkbox" id="rfMostrarNombre" style="margin-top:4px;flex-shrink:0;cursor:pointer;accent-color:var(--blue-600);">
        <label for="rfMostrarNombre" style="font-size:13px;color:var(--text-secondary);cursor:pointer;line-height:1.4;display:flex;align-items:flex-start;gap:7px;">
          ${photoHtml}
          <span>Usar mi nombre (<strong>${_googleUser.name}</strong>)${fotoLabel} en la reseña. Si no, aparece como "Anónimo ✓".</span>
        </label>`;
    }
  } else {
    const extra = state === 'denied'
      ? '<p style="font-size:12px;color:var(--coral-600);margin:6px 0 0;">Debes usar una cuenta @alumnos.udg.mx</p>'
      : state === 'error'
      ? '<p style="font-size:12px;color:var(--coral-600);margin:6px 0 0;">No se pudo verificar. Intenta de nuevo.</p>'
      : '';
    btnEl.innerHTML = `
      <button onclick="_openGoogleVerification()" style="display:inline-flex;align-items:center;gap:8px;padding:9px 16px;background:white;border:1px solid var(--border);border-radius:8px;cursor:pointer;font-size:13px;font-weight:500;color:var(--text-primary);">
        <svg width="16" height="16" viewBox="0 0 24 24" style="flex-shrink:0;"><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z"/><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/></svg>
        Verificar con Google
      </button>${extra}`;
    if (nombreWrap) nombreWrap.style.display = 'none';
  }
}

// Ranking Mode Functions
async function loadRanking(cu = 'all') {
  _mode = 'ranking';
  setSectionRanking(cu);
  showLoading();
  try {
    const res = await fetch(`${API_BASE}/api/ranking?cu=${cu}&limit=10`);
    const data = await res.json();
    _currentRanking = data;
    renderRanking(data);
  } catch { showServerError(); }
}

function setSectionRanking(cu = 'all') {
  if (sectionTitle) sectionTitle.innerHTML = `
    <span class="section-icon"><i class="ti ti-trophy"></i></span>
    Mejor calificados`;
  if (cycleBadge) {
    cycleBadge.textContent = cu === 'all' ? 'Top global · 2026A' : `${cu} · 2026A`;
    cycleBadge.style.cssText = '';
  }
}

function setSectionSearch(total) {
  if (sectionTitle) sectionTitle.innerHTML = `
    <span class="section-icon blue"><i class="ti ti-search"></i></span>
    Resultados de búsqueda`;
  if (cycleBadge) {
    cycleBadge.textContent = `${total.toLocaleString('es-MX')} encontrados`;
    cycleBadge.style.cssText = 'background:var(--teal-50);color:var(--teal-900);';
  }
}

// Search Mode Functions
async function fetchProfesores(cu = 'all', query = '') {
  if (!query.trim()) return loadRanking(cu);
  _mode = 'search';
  showLoading();
  const params = new URLSearchParams({ cu, limit: 20, q: query });
  try {
    const res = await fetch(`${API_BASE}/api/profesores?${params}`);
    const data = await res.json();
    _currentProfes = data.data;
    setSectionSearch(data.total);
    renderSearch(data.data, data.total);
  } catch { showServerError(); }
}

// Shared Helpers and Error Handlers
function showLoading() {
  grid.innerHTML = `
    <div style="text-align:center;padding:48px 20px;color:var(--text-tertiary);">
      <i class="ti ti-loader-2" style="font-size:32px;display:block;margin-bottom:8px;animation:spin .8s linear infinite;"></i>
      <p style="font-size:13px;">Cargando...</p>
    </div>`;
}

function showServerError() {
  grid.innerHTML = `
    <div class="offline-state">
      <div class="offline-rings">
        <div class="offline-ring offline-ring-3" id="or3"></div>
        <div class="offline-ring offline-ring-2" id="or2"></div>
        <div class="offline-ring offline-ring-1" id="or1"></div>
        <div class="offline-icon"><i class="ti ti-wifi-off"></i></div>
      </div>
      <h3 style="font-family:var(--font-display);font-size:18px;color:var(--blue-900);margin-bottom:8px;">Sin conexión al servidor</h3>
      <p style="font-size:13px;color:var(--text-secondary);max-width:300px;margin:0 auto;">
        No pudimos cargar los datos. Revisa tu conexión e inténtalo de nuevo en un momento.
      </p>
    </div>`;

  if (!window.gsap) return;
  const rings = [document.getElementById('or1'), document.getElementById('or2'), document.getElementById('or3')];
  const tl = gsap.timeline({ repeat: -1 });
  rings.forEach((el, i) => {
    if (!el) return;
    tl.fromTo(el,
      { scale: 0.4, opacity: 0.7 },
      { scale: 2.2, opacity: 0, duration: 1.8, ease: 'power1.out' },
      i * 0.5);
  });
  gsap.to('.offline-icon', { y: -5, duration: 1.4, repeat: -1, yoyo: true, ease: 'sine.inOut' });
}

function animateCards() {
  if (window.gsap) {
    gsap.fromTo('.prof-card',
      { opacity: 0, y: 20 },
      { opacity: 1, y: 0, duration: 0.4, stagger: 0.05, ease: 'power2.out' });
  }
}

function animateMedals() {
  if (window.gsap) {
    gsap.fromTo('.medal-badge',
      { scale: 0, rotation: -20 },
      { scale: 1, rotation: 0, duration: 0.5, stagger: 0.08, ease: 'back.out(2)', delay: 0.25 });
  }
}

function attachCardClicks() {
  grid.querySelectorAll('.prof-card').forEach(card => {
    card.addEventListener('click', () => openProfile(card.dataset.nombre, card.dataset.cu));
  });
}

function starsHtml(rating, size = 13) {
  const n = Math.round(Math.max(1, Math.min(5, rating)));
  return `<span style="color:var(--amber-600);font-size:${size}px;letter-spacing:1px;">${'★'.repeat(n)}${'☆'.repeat(5 - n)}</span>`;
}

function ratingBlock(p) {
  let nota;
  if (p.num_reviews > 0) {
    // Hay reseñas reales: indica cuántas (y cuántas verificadas)
    const verif = p.num_verificadas > 0
      ? ` <i class="ti ti-circle-check-filled" style="color:var(--blue-600);" title="${p.num_verificadas} verificadas"></i>`
      : '';
    nota = `<div style="font-size:9px;color:var(--teal-700,#0F6E56);margin-top:2px;font-weight:600;">${p.num_reviews} reseña${p.num_reviews !== 1 ? 's' : ''}${verif}</div>`;
  } else {
    // Sin reseñas: la nota es 100% estimada por algoritmo
    nota = `<div style="font-size:9px;color:var(--text-tertiary);margin-top:2px;">${p.has_history ? 'Estimado' : 'Sin historial'}</div>`;
  }
  return `
    <div class="prof-rating">
      <div class="prof-rating-num">${p.rating.toFixed(1)}</div>
      ${starsHtml(p.rating)}
      ${nota}
    </div>`;
}

function demandBadge() {
  return `<span class="demand-badge"><i class="ti ti-flame"></i> Alta demanda</span>`;
}

// Render Ranking List
function renderRanking(profes) {
  if (!profes.length) {
    grid.innerHTML = `
      <div style="text-align:center;padding:40px;color:var(--text-tertiary);">
        <i class="ti ti-mood-empty" style="font-size:32px;"></i>
        <p style="margin-top:8px;font-size:14px;">Sin datos de ranking para este centro</p>
      </div>`; return;
  }
  const medalHtml = [
    `<div class="medal-badge medal-1">1</div>`,
    `<div class="medal-badge medal-2">2</div>`,
    `<div class="medal-badge medal-3">3</div>`,
  ];
  grid.innerHTML = profes.map((p, i) => {
    const avatarClass = AVATAR_COLORS[p.cu] || 'av-blue';
    const rankEl = i < 3 ? medalHtml[i] : `<div class="medal-rank">#${i + 1}</div>`;
    const top2 = p.materias.slice(0, 2).join(' · ');
    const mas = p.materias.length > 2
      ? ` · <span style="color:var(--text-tertiary);">+${p.materias.length - 2} más</span>` : '';
    return `
      <div class="prof-card" data-cu="${p.cu}" data-nombre="${p.nombre.replace(/"/g, '&quot;')}">
        ${rankEl}
        <div class="avatar ${avatarClass}">${p.iniciales}</div>
        <div class="prof-info">
          <div class="prof-name-row">
            <span class="prof-name">${p.nombre}</span>
            <span class="cu-tag" data-cu="${p.cu}">${p.cu}</span>
            ${p.alta_demanda ? demandBadge() : ''}
          </div>
          <div class="prof-meta">${top2 || 'Sin materias registradas'}${mas}</div>
          <div class="prof-stats-row">
            <span class="stat-good"><i class="ti ti-chart-bar"></i> ${p.avg_sat}% sat.</span>
            <span class="stat-hard"><i class="ti ti-book"></i> ${p.num_materias} materias</span>
          </div>
        </div>
        ${ratingBlock(p)}
      </div>`;
  }).join('');
  attachCardClicks();
  animateCards();
  animateMedals();
}

// Render Search Results
function renderSearch(profes, total) {
  if (!profes.length) {
    grid.innerHTML = `
      <div style="text-align:center;padding:40px;color:var(--text-tertiary);">
        <i class="ti ti-mood-empty" style="font-size:32px;"></i>
        <p style="margin-top:8px;font-size:14px;">No se encontraron profesores</p>
      </div>`; return;
  }
  grid.innerHTML = profes.map(p => {
    const avatarClass = AVATAR_COLORS[p.cu] || 'av-blue';
    const top2 = p.materias.slice(0, 2).join(' · ');
    const mas = p.materias.length > 2
      ? ` · <span style="color:var(--text-tertiary);">+${p.materias.length - 2} más</span>` : '';
    return `
      <div class="prof-card" data-cu="${p.cu}" data-nombre="${p.nombre.replace(/"/g, '&quot;')}">
        <div class="avatar ${avatarClass}">${p.iniciales}</div>
        <div class="prof-info">
          <div class="prof-name-row">
            <span class="prof-name">${p.nombre}</span>
            <span class="cu-tag" data-cu="${p.cu}">${p.cu}</span>
            ${p.alta_demanda ? demandBadge() : ''}
          </div>
          <div class="prof-meta">${top2}${mas}</div>
          <div class="prof-stats-row">
            <span class="stat-good"><i class="ti ti-book"></i> ${p.num_materias} materias</span>
            <span class="stat-hard"><i class="ti ti-calendar-event"></i> ${p.num_secciones} secciones</span>
          </div>
        </div>
        ${ratingBlock(p)}
      </div>`;
  }).join('');
  if (total > profes.length) {
    grid.innerHTML += `<p style="text-align:center;font-size:12px;color:var(--text-tertiary);padding:12px 0 4px;">
      Mostrando ${profes.length} de ${total.toLocaleString('es-MX')} — refina la búsqueda</p>`;
  }
  attachCardClicks();
  animateCards();
}

// Professor Profile Modal Dialog
function openProfile(nombre, cu) {
  const p = _currentRanking.find(x => x.nombre === nombre && x.cu === cu)
    || _currentProfes.find(x => x.nombre === nombre && x.cu === cu);
  if (!p) return;

  const avatarClass = AVATAR_COLORS[p.cu] || 'av-blue';
  const mats = p.materias || [];
  const clvs = p.claves || [];
  const cursosHtml = mats.length
    ? mats.map((m, i) => {
      const c = clvs[i] || '';
      return `
          <div class="curso-row">
            ${c ? `<span class="curso-clave">${c}</span>` : ''}
            <span class="curso-nombre">${m}</span>
          </div>`;
    }).join('')
    : '<span style="color:var(--text-tertiary);font-size:13px;">Sin datos</span>';
  const altaDemandaAlert = p.alta_demanda ? `
    <div class="rev-alert rev-alert-fire">
      <i class="ti ti-flame"></i>
      <span><strong>Alta demanda:</strong> Saturación histórica ≥ 85% — muchos estudiantes quieren a este profesor.</span>
    </div>` : '';

  modalContent.innerHTML = `
    <button class="modal-close" id="modalClose"><i class="ti ti-x"></i></button>
    <div class="modal-head">
      <div class="modal-avatar ${avatarClass}">${p.iniciales}</div>
      <div>
        <h2 class="modal-name">${p.nombre}</h2>
        <div class="modal-dept">${p.cu}</div>
      </div>
    </div>

    ${altaDemandaAlert}

    <div class="modal-stats" id="modalStats">
      <div class="ms-card stat-blue">
        <div class="ms-num" style="color:var(--blue-900);">${p.num_materias}</div>
        <div class="ms-lbl" style="color:var(--blue-600);">Materias</div>
      </div>
      <div class="ms-card stat-teal">
        <div class="ms-num" style="color:var(--teal-900);">${p.num_secciones || '—'}</div>
        <div class="ms-lbl" style="color:var(--teal-600);">Secciones</div>
      </div>
      <div class="ms-card stat-amber" id="ratingCard">
        <div class="ms-num" style="color:var(--amber-900);">${p.rating.toFixed(1)}</div>
        <div class="ms-lbl" style="color:var(--amber-600);">Score est.</div>
      </div>
      <div class="ms-card" style="background:${p.alta_demanda ? '#FEF3C7' : 'var(--bg)'};">
        <div class="ms-num" style="font-size:18px;color:${p.alta_demanda ? '#92400E' : 'var(--text-tertiary)'};">${p.avg_sat}%</div>
        <div class="ms-lbl" style="color:${p.alta_demanda ? '#B45309' : 'var(--text-tertiary)'};">Saturación de cupos</div>
        <div style="font-size:9px;color:var(--text-tertiary);margin-top:2px;line-height:1.3;">promedio de todas sus materias</div>
      </div>
    </div>

    <div class="reviews-title">Materias impartidas</div>
    <div class="cursos-list">${cursosHtml}</div>

    <div id="reviewsSection">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;">
        <span class="reviews-title" style="margin:0;">Reseñas de estudiantes</span>
        <button class="btn-add-review" id="btnAddReview">
          <i class="ti ti-pencil-plus"></i> Agregar reseña
        </button>
      </div>
      <div id="reviewsList">
        <div style="text-align:center;padding:16px;color:var(--text-tertiary);font-size:13px;">
          <i class="ti ti-loader-2" style="animation:spin .8s linear infinite;"></i>
        </div>
      </div>
    </div>
  `;

  modal.classList.add('show');
  document.getElementById('modalClose').addEventListener('click', closeModal);
  document.getElementById('btnAddReview').addEventListener('click', () => showReviewForm(nombre, cu, p.materias || []));

  loadReviews(nombre, cu);
}

async function loadReviews(nombre, cu) {
  const list = document.getElementById('reviewsList');
  if (!list) return;
  try {
    const res = await fetch(`${API_BASE}/api/reviews/${cu}/${encodeURIComponent(nombre)}`);
    const data = await res.json();
    renderReviews(data);
  } catch {
    if (list) list.innerHTML = '<p style="font-size:13px;color:var(--text-tertiary);">No se pudieron cargar las reseñas.</p>';
  }
}

function renderReviews(data) {
  const list = document.getElementById('reviewsList');
  const card = document.getElementById('ratingCard');
  if (!list) return;

  if (data.avg_rating && card) {
    card.innerHTML = `
      <div class="ms-num" style="color:var(--amber-900);">${data.avg_rating.toFixed(1)}</div>
      <div class="ms-lbl" style="color:var(--amber-600);">Rating real</div>`;
  }

  if (!data.num_reviews) {
    list.innerHTML = `
      <div class="rev-alert rev-alert-algo">
        <i class="ti ti-robot"></i>
        <span>El score mostrado es <strong>estimado por algoritmo</strong> basado en saturación histórica y amplitud de materias. Aún no hay reseñas — ¡sé el primero!</span>
      </div>`;
    return;
  }

  const pctBadge = data.pct_recomienda !== null
    ? `<span style="background:var(--teal-50);color:var(--teal-900);font-size:11px;font-weight:600;padding:2px 8px;border-radius:999px;">
         ${data.pct_recomienda}% lo recomiendan
       </span>` : '';
  const verBadge = data.num_verificadas > 0
    ? `<span style="background:var(--blue-50);color:var(--blue-600);font-size:11px;padding:2px 8px;border-radius:999px;display:inline-flex;align-items:center;gap:3px;">
         ${data.num_verificadas} verificadas <i class="ti ti-circle-check-filled"></i>
       </span>` : '';
  const califBadge = data.avg_calificacion !== null && data.avg_calificacion !== undefined
    ? `<span style="background:var(--purple-50,#f5f3ff);color:var(--purple-600,#7c3aed);font-size:11px;font-weight:600;padding:2px 8px;border-radius:999px;display:inline-flex;align-items:center;gap:3px;">
         <i class="ti ti-school"></i> Calif. promedio: ${data.avg_calificacion}/100
       </span>` : '';

  const header = `
    <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:12px;">
      <span style="font-size:13px;color:var(--text-secondary);">${data.num_reviews} reseña${data.num_reviews !== 1 ? 's' : ''}</span>
      ${pctBadge}${verBadge}${califBadge}
    </div>`;

  const cards = data.reviews.map(r => {
    const fotoSrc = r.verificada ? safeUrl(r.foto_url) : '';
    const photoHtml = fotoSrc
      ? `<img src="${fotoSrc}" style="width:22px;height:22px;border-radius:50%;flex-shrink:0;vertical-align:middle;margin-right:4px;" onerror="this.style.display='none'">`
      : '';
    const nameTag = r.verificada
      ? `<span class="rev-verified-badge">${photoHtml}${escapeHtml(r.nombre_mostrado || 'Anónimo')} <i class="ti ti-circle-check-filled"></i></span>`
      : `<span style="font-size:11px;color:var(--text-tertiary);">Anónimo</span>`;
    const cicloTag = r.ciclo ? `<span style="font-size:11px;color:var(--text-tertiary);">${escapeHtml(r.ciclo)}</span>` : '';
    const materiaTag = r.materia ? `<span style="font-size:11px;color:var(--text-tertiary);">${escapeHtml(r.materia)}</span>` : '';
    const califTag = r.calificacion != null
      ? `<span style="font-size:11px;font-weight:700;background:var(--purple-50,#f5f3ff);color:var(--purple-600,#7c3aed);padding:2px 8px;border-radius:999px;">${r.calificacion}/100</span>`
      : '';
    const recTag = r.recomienda
      ? `<span style="font-size:10px;background:var(--teal-50);color:var(--teal-900);padding:2px 7px;border-radius:999px;display:inline-flex;align-items:center;gap:2px;"><i class="ti ti-check"></i> Sí recomienda</span>`
      : `<span style="font-size:10px;background:var(--coral-50);color:var(--coral-900);padding:2px 7px;border-radius:999px;display:inline-flex;align-items:center;gap:2px;"><i class="ti ti-x"></i> No recomienda</span>`;
    const subRatings = (r.rating_claridad || r.rating_dificultad) ? `
      <div style="display:flex;gap:12px;margin-top:7px;flex-wrap:wrap;">
        ${r.rating_claridad ? `<span style="font-size:11px;color:var(--text-tertiary);">Claridad: ${starsHtml(r.rating_claridad, 10)}</span>` : ''}
        ${r.rating_dificultad ? `<span style="font-size:11px;color:var(--text-tertiary);">Dificultad: ${starsHtml(r.rating_dificultad, 10)}</span>` : ''}
      </div>` : '';
    const texto = r.texto ? `<p style="font-size:13px;color:var(--text-secondary);margin:8px 0 0;line-height:1.5;">${escapeHtml(r.texto)}</p>` : '';
    return `
      <div class="rev-card">
        <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:6px;">
          <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
            ${nameTag}${cicloTag}${materiaTag}${califTag}
          </div>
          <div style="display:flex;align-items:center;gap:6px;">
            ${starsHtml(r.rating_general, 12)}
            ${recTag}
          </div>
        </div>
        ${subRatings}
        ${texto}
      </div>`;
  }).join('');

  list.innerHTML = header + cards;
}

// Review Submission Form in Modal
function showReviewForm(nombre, cu, materias = []) {
  const savedHTML = modalContent.innerHTML;
  const ciclos = ['2026A', '2025B', '2025A', '2024B', '2024A', '2023B', '2023A'];

  modalContent.innerHTML = `
    <div style="display:flex;align-items:center;gap:12px;margin-bottom:22px;">
      <button id="rfBackBtn" class="modal-close" style="position:relative;top:auto;right:auto;flex-shrink:0;">
        <i class="ti ti-arrow-left"></i>
      </button>
      <div>
        <h3 style="font-family:var(--font-display);font-size:17px;color:var(--blue-900);line-height:1.2;">Agregar reseña</h3>
        <p style="font-size:12px;color:var(--text-tertiary);margin-top:2px;">${nombre} · ${cu}</p>
      </div>
    </div>

    <div class="rfg">
      <label class="rfg-label">Calificación general <span style="color:var(--coral-600);">*</span></label>
      ${starPicker('rating_general')}
    </div>
    <div class="rfg">
      <label class="rfg-label">Claridad al explicar</label>
      ${starPicker('rating_claridad')}
    </div>
    <div class="rfg">
      <label class="rfg-label">Dificultad del curso</label>
      ${starPicker('rating_dificultad')}
    </div>

    <div class="rfg">
      <label class="rfg-label">¿Lo recomendarías? <span style="color:var(--coral-600);">*</span></label>
      <div style="display:flex;gap:10px;margin-top:8px;flex-wrap:wrap;">
        <label class="radio-option"><input type="radio" name="recomienda" value="1"> Sí, lo recomiendo</label>
        <label class="radio-option"><input type="radio" name="recomienda" value="0"> No lo recomiendo</label>
      </div>
    </div>

    <div class="rf-meta-grid" style="display:grid;grid-template-columns:100px 1fr 140px;gap:12px;margin-bottom:14px;">
      <div>
        <label class="rfg-label">Ciclo</label>
        <select id="rfCiclo" class="form-control" style="color:#a3a3a3"
          onchange="this.style.color=this.value?'':'#a3a3a3'">
          <option value="">opcional</option>
          ${ciclos.map(c => `<option style="color:#171717">${c}</option>`).join('')}
        </select>
      </div>
      <div>
        <label class="rfg-label">Materia</label>
        <select id="rfMateria" class="form-control" style="color:#a3a3a3"
          onchange="this.style.color=this.value?'':'#a3a3a3'">
          <option value="">opcional</option>
          ${materias.map(m => `<option style="color:#171717" value="${m.replace(/"/g, '&quot;')}">${m}</option>`).join('')}
        </select>
      </div>
      <div>
        <label class="rfg-label">Calificación obtenida <span class="label-hint"></span></label>
        <input id="rfCalificacion" type="number" class="form-control" min="0" max="100" step="1" placeholder="85">
      </div>
    </div>

    <div class="rfg">
      <label class="rfg-label">
        Comentario
        <span style="font-size:11px;color:var(--text-tertiary);font-weight:400;"> — máx. 1000 caracteres</span>
      </label>
      <textarea id="rfTexto" class="form-control" rows="3" maxlength="1000"
        placeholder="¿Cómo es el profe? ¿Qué deberían saber los estudiantes?"></textarea>
    </div>

    <hr style="border:none;border-top:1px solid var(--border);margin:16px 0 14px;">

    <div class="rfg">
      <label class="rfg-label" style="display:flex;align-items:center;gap:6px;">
        <i class="ti ti-shield-check" style="color:var(--teal-600);"></i>
        Verificar como estudiante UdG
      </label>
      <p style="font-size:12px;color:var(--text-tertiary);margin:4px 0 10px;line-height:1.5;">
        Opcional — verifica con tu cuenta Google
        <code style="background:var(--blue-50);color:var(--blue-900);padding:1px 5px;border-radius:4px;font-size:11px;">@alumnos.udg.mx</code>
        para hacer fiable tu reseña <i class="ti ti-circle-check-filled" style="color:var(--blue-600);font-size:11px;"></i>
      </p>
      <div id="rfGoogleBtn"></div>
    </div>

    <div id="rfNombreWrap" class="rfg" style="display:none;"></div>

    <div id="rfError" style="display:none;padding:10px 14px;background:#FEE2E2;border-radius:8px;font-size:13px;color:#991B1B;margin-top:8px;"></div>
    <div id="rfSuccess" style="display:none;"></div>

    <div style="display:flex;gap:10px;margin-top:16px;" id="rfBtns">
      <button id="rfCancel" class="rf-btn-cancel">Cancelar</button>
      <button id="rfSubmit" class="rf-btn-submit">
        <i class="ti ti-send"></i> Enviar reseña
      </button>
    </div>
  `;

  // Animate in
  const modalEl = modal.querySelector('.modal');
  if (modalEl) modalEl.scrollTop = 0;
  if (window.gsap) {
    gsap.fromTo(modalContent, { opacity: 0, x: 30 }, { opacity: 1, x: 0, duration: 0.3, ease: 'power2.out' });
  }

  initStarPickers();
  _updateGoogleUI();
  _checkGoogleSession().then(_updateGoogleUI);

  const goBack = (reloadReviews = false) => {
    const restore = () => {
      modalContent.innerHTML = savedHTML;
      if (modalEl) modalEl.scrollTop = 0;
      document.getElementById('modalClose')?.addEventListener('click', closeModal);
      document.getElementById('btnAddReview')?.addEventListener('click', () => showReviewForm(nombre, cu, materias));
      if (reloadReviews) loadReviews(nombre, cu);
    };
    if (window.gsap) {
      gsap.to(modalContent, {
        opacity: 0, x: -30, duration: 0.22, ease: 'power2.in', onComplete: () => {
          restore();
          gsap.fromTo(modalContent, { opacity: 0, x: -30 }, { opacity: 1, x: 0, duration: 0.28 });
        }
      });
    } else { restore(); }
  };

  document.getElementById('rfBackBtn').addEventListener('click', () => goBack(false));
  document.getElementById('rfCancel').addEventListener('click', () => goBack(false));
  document.getElementById('rfSubmit').addEventListener('click', () => submitReview(nombre, cu, goBack));

}

function starPicker(field) {
  return `
    <div class="star-picker" data-field="${field}" style="display:flex;align-items:center;gap:4px;margin-top:8px;">
      ${[1, 2, 3, 4, 5].map(n => `<span class="sp-star" data-val="${n}" style="font-size:28px;cursor:pointer;color:var(--border);transition:color .1s;line-height:1;user-select:none;">★</span>`).join('')}
      <span class="sp-label" style="font-size:12px;color:var(--text-tertiary);margin-left:6px;">—</span>
    </div>`;
}

function initStarPickers() {
  document.querySelectorAll('.star-picker').forEach(picker => {
    const stars = picker.querySelectorAll('.sp-star');
    const label = picker.querySelector('.sp-label');
    let selected = 0;
    const field = picker.dataset.field;
    const labels = field === 'rating_dificultad'
      ? ['', 'Muy fácil', 'Fácil', 'Regular', 'Difícil', 'Muy difícil']
      : ['', 'Muy malo', 'Malo', 'Regular', 'Bueno', 'Excelente'];
    const paint = n => stars.forEach((s, i) => {
      s.style.color = i < n ? 'var(--amber-600)' : 'var(--border)';
    });
    stars.forEach(star => {
      star.addEventListener('mouseenter', () => paint(+star.dataset.val));
      star.addEventListener('mouseleave', () => paint(selected));
      star.addEventListener('click', () => {
        selected = +star.dataset.val;
        picker.dataset.value = selected;
        label.textContent = labels[selected];
        paint(selected);
        if (window.gsap) gsap.fromTo(star, { scale: 1.4 }, { scale: 1, duration: 0.25, ease: 'back.out(2)' });
      });
    });
  });
}

async function submitReview(nombre, cu, goBack) {
  const btn = document.getElementById('rfSubmit');
  const errDiv = document.getElementById('rfError');
  const okDiv = document.getElementById('rfSuccess');
  errDiv.style.display = 'none';

  const ratingGeneral = +document.querySelector('.star-picker[data-field="rating_general"]')?.dataset.value || 0;
  if (!ratingGeneral) {
    errDiv.textContent = 'Selecciona una calificación general (1–5 estrellas).';
    errDiv.style.display = 'block'; return;
  }

  const recomiendaEl = document.querySelector('input[name="recomienda"]:checked');
  if (!recomiendaEl) {
    errDiv.textContent = 'Indica si recomendarías a este profesor.';
    errDiv.style.display = 'block'; return;
  }

  const califRaw = document.getElementById('rfCalificacion')?.value;
  let calificacion = califRaw !== '' && califRaw != null ? parseFloat(califRaw) : null;
  if (calificacion !== null) {
    if (isNaN(calificacion) || calificacion < 0 || calificacion > 100) {
      errDiv.textContent = 'La calificación debe ser un número entre 0 y 100.';
      errDiv.style.display = 'block'; return;
    }
  }
  const mostrarNombre = document.getElementById('rfMostrarNombre')?.checked || false;

  const payload = {
    profesor_nombre: nombre,
    cu,
    rating_general: ratingGeneral,
    rating_claridad: +document.querySelector('.star-picker[data-field="rating_claridad"]')?.dataset.value || null,
    rating_dificultad: +document.querySelector('.star-picker[data-field="rating_dificultad"]')?.dataset.value || null,
    recomienda: recomiendaEl.value === '1',
    ciclo: document.getElementById('rfCiclo')?.value || '',
    materia: document.getElementById('rfMateria')?.value?.trim() || '',
    calificacion: (!isNaN(calificacion) && calificacion !== null) ? calificacion : null,
    texto: document.getElementById('rfTexto')?.value?.trim() || '',
    mostrar_nombre: mostrarNombre,
  };

  if (mostrarNombre && _googleUser?.picture) payload.foto_url = _googleUser.picture;

  btn.disabled = true;
  btn.innerHTML = '<i class="ti ti-loader-2" style="animation:spin .8s linear infinite;"></i> Enviando...';

  try {
    const res = await fetch(`${API_BASE}/api/reviews`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (!res.ok) {
      errDiv.textContent = data.error || 'Error al enviar.';
      errDiv.style.display = 'block';
      btn.disabled = false;
      btn.innerHTML = '<i class="ti ti-send"></i> Enviar reseña'; return;
    }

    const verMsg = data.google_verificada
      ? `<p style="margin-top:6px;font-size:13px;color:var(--teal-900);">Tu reseña fue <strong>verificada automáticamente</strong> con tu cuenta Google.</p>`
      : (data.verificacion_enviada
        ? `<p style="margin-top:6px;font-size:13px;color:var(--text-secondary);">Revisa tu correo <strong>@alumnos.udg.mx</strong> para hacer fiable tu reseña <i class="ti ti-circle-check-filled" style="color:var(--blue-600);"></i></p>`
        : '');

    okDiv.innerHTML = `
      <div style="padding:22px;background:var(--teal-50);border-radius:12px;text-align:center;margin-top:12px;">
        <div style="width:52px;height:52px;background:var(--teal-600);border-radius:50%;display:flex;align-items:center;justify-content:center;margin:0 auto 12px;color:white;font-size:24px;">
          <i class="ti ti-check"></i>
        </div>
        <strong style="color:var(--teal-900);font-size:16px;font-family:var(--font-display);">¡Reseña enviada!</strong>
        ${verMsg}
        <button id="rfViewBtn" style="margin-top:14px;padding:9px 24px;background:var(--teal-600);color:white;border:none;border-radius:8px;cursor:pointer;font-size:13px;font-weight:600;display:inline-flex;align-items:center;gap:7px;">
          <i class="ti ti-eye"></i> Ver reseñas
        </button>
      </div>`;
    okDiv.style.display = 'block';
    btn.style.display = 'none';
    document.getElementById('rfBtns').style.display = 'none';

    if (window.gsap) {
      gsap.fromTo(okDiv, { scale: 0.9, opacity: 0 }, { scale: 1, opacity: 1, duration: 0.4, ease: 'back.out(1.5)' });
    }
    document.getElementById('rfViewBtn').addEventListener('click', () => goBack(true));
    setTimeout(() => window.showDonationPopup?.(), 3000);

  } catch {
    errDiv.textContent = 'Error de conexión con el servidor.';
    errDiv.style.display = 'block';
    btn.disabled = false;
    btn.innerHTML = '<i class="ti ti-send"></i> Enviar reseña';
  }
}

function closeModal() { modal.classList.remove('show'); }
modal.addEventListener('click', e => { if (e.target === modal) closeModal(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });

// University Center Chip Filter Handlers
document.querySelectorAll('.chip').forEach(chip => {
  chip.addEventListener('click', () => {
    document.querySelectorAll('.chip').forEach(c => c.classList.remove('active'));
    chip.classList.add('active');
    _activeCU = chip.dataset.cu;
    const q = searchInput.value.trim();
    q ? fetchProfesores(_activeCU, q) : loadRanking(_activeCU);
    if (window.gsap) gsap.fromTo(chip,
      { scale: 0.9 },
      { scale: 1.05, duration: 0.25, ease: 'back.out(2)', onComplete: () => gsap.to(chip, { scale: 1, duration: 0.12 }) });
  });
});

// Debounced Search Input Handler
let _searchTimer;
searchInput.addEventListener('input', () => {
  clearTimeout(_searchTimer);
  _searchTimer = setTimeout(() => {
    const q = searchInput.value.trim();
    q ? fetchProfesores(_activeCU, q) : loadRanking(_activeCU);
  }, 300);
});

// Injection of Spin Keyframes
const _style = document.createElement('style');
_style.textContent = `@keyframes spin { from{transform:rotate(0deg)} to{transform:rotate(360deg)} }`;
document.head.appendChild(_style);

// Handle Google OAuth Redirect Fallback
(async () => {
  const authParam = new URLSearchParams(location.search).get('auth');
  if (authParam) {
    history.replaceState({}, '', '/');
    if (authParam === 'ok') await _checkGoogleSession();
  }
})();

// Display Verified Toast Notification on Redirect
if (new URLSearchParams(location.search).get('verified') === '1') {
  const t = document.createElement('div');
  t.style.cssText = 'position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:#042C53;color:white;padding:12px 24px;border-radius:10px;font-size:14px;z-index:9999;box-shadow:0 4px 20px rgba(0,0,0,.2);display:flex;align-items:center;gap:8px;';
  t.innerHTML = '<i class="ti ti-circle-check-filled" style="color:#6EE7B7;"></i> ¡Reseña verificada con tu cuenta @alumnos.udg.mx!';
  document.body.appendChild(t);
  if (window.gsap) gsap.fromTo(t, { y: 20, opacity: 0 }, { y: 0, opacity: 1, duration: 0.4 });
  setTimeout(() => {
    if (window.gsap) gsap.to(t, { y: 20, opacity: 0, duration: 0.4, onComplete: () => t.remove() });
    else t.remove();
  }, 5000);
  history.replaceState({}, '', '/');
}

// Public Support Ticket Form Modal
function openSupportModal() {
  const ov = document.getElementById('supportOverlay');
  if (!ov) return;
  document.getElementById('supDescripcion').value = '';
  document.getElementById('supEmail').value = '';
  document.getElementById('supFoto').value = '';
  document.getElementById('supFotoLabel').textContent = 'Adjuntar captura (opcional)';
  document.getElementById('supError').style.display = 'none';
  document.getElementById('supOk').style.display = 'none';
  const btn = document.getElementById('supBtn');
  btn.style.display = '';
  btn.disabled = false;
  btn.innerHTML = '<i class="ti ti-send"></i> Enviar reporte';
  ov.style.display = 'flex';
  requestAnimationFrame(() => ov.classList.add('show'));
}

function closeSupportModal() {
  const ov = document.getElementById('supportOverlay');
  if (!ov) return;
  ov.classList.remove('show');
  setTimeout(() => { ov.style.display = 'none'; }, 300);
}

async function submitSupport() {
  const desc = document.getElementById('supDescripcion').value.trim();
  const errDiv = document.getElementById('supError');
  if (!desc) { errDiv.textContent = 'La descripción es obligatoria.'; errDiv.style.display = 'block'; return; }
  errDiv.style.display = 'none';

  const btn = document.getElementById('supBtn');
  btn.disabled = true;
  btn.innerHTML = '<i class="ti ti-loader" style="animation:spin 1s linear infinite"></i> Enviando…';

  const fd = new FormData();
  fd.append('descripcion', desc);
  const email = document.getElementById('supEmail').value.trim();
  if (email) fd.append('email', email);
  const foto = document.getElementById('supFoto').files[0];
  if (foto) fd.append('foto', foto);

  try {
    const r = await fetch('/api/soporte', { method: 'POST', body: fd }).then(r => r.json());
    if (r.success) {
      document.getElementById('supOk').style.display = 'block';
      btn.style.display = 'none';
    } else {
      errDiv.textContent = r.error || 'Error al enviar.';
      errDiv.style.display = 'block';
      btn.disabled = false;
      btn.innerHTML = '<i class="ti ti-send"></i> Enviar reporte';
    }
  } catch {
    errDiv.textContent = 'Error de conexión.';
    errDiv.style.display = 'block';
    btn.disabled = false;
    btn.innerHTML = '<i class="ti ti-send"></i> Enviar reporte';
  }
}

// Initialization and Analytics Tracking
loadRanking();
fetch('/api/visita',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({page:'index'})}).catch(()=>{});
