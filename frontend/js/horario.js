/* Schedule Builder Application Logic */

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

const AVATAR_COLORS = {
  CUCEI: 'av-blue', CUCEA: 'av-purple', CUCS: 'av-coral',
  CUAAD: 'av-teal', CUCBA: 'av-teal', CUCSH: 'av-purple',
  CUCSUR: 'av-blue', CUALTOS: 'av-teal', CUTONALA: 'av-blue',
  UDG_VIRTUAL: 'av-purple'
};

const CENTROS = [
  "CUAAD", "CUCBA", "CUCEA", "CUCEI", "CUCS", "CUCSH", "CUALTOS",
  "CUCIENEGA", "CUCOSTA", "CUCSUR", "CUSUR", "CUVALLES", "CUNORTE",
  "CUTONALA", "UDG_VIRTUAL", "CU_TLAJOMULCO", "CU_GUADALAJARA",
  "CU_TLAQUEPAQUE", "CU_CHAPALA"
];

// DOM references
const centroSelect    = document.getElementById('centroSelect');
const clavesInput     = document.getElementById('clavesInput');
const promedioInput   = document.getElementById('promedioInput');
const estrategiaSelect = document.getElementById('estrategiaSelect');
const optimizarBtn    = document.getElementById('optimizarBtn');
const apiStatus       = document.getElementById('apiStatus');
const resultsPlaceholder = document.getElementById('resultsPlaceholder');
const resultsContent  = document.getElementById('resultsContent');

// Populate university center select dropdown
CENTROS.forEach(c => {
  const opt = document.createElement('option');
  opt.value = c;
  opt.textContent = c;
  if (c === 'CUCEI') opt.selected = true;
  centroSelect.appendChild(opt);
});

// UI Helper Functions
function showStatus(msg, type = 'info') {
  apiStatus.style.display = 'block';
  apiStatus.className = `api-status ${type}`;
  apiStatus.innerHTML = msg;
}
function hideStatus() { apiStatus.style.display = 'none'; }

function showResults(html) {
  resultsPlaceholder.style.display = 'none';
  resultsContent.style.display = 'block';
  resultsContent.innerHTML = html;
}
function resetResults() {
  resultsPlaceholder.style.display = 'flex';
  resultsContent.style.display = 'none';
  resultsContent.innerHTML = '';
}

function setLoading(loading) {
  optimizarBtn.disabled = loading;
  optimizarBtn.innerHTML = loading
    ? '<i class="ti ti-loader-2 spin"></i> Calculando...'
    : '<i class="ti ti-sparkles"></i> Optimizar';
}

// Renders the visual schedule grid
function generarHtmlHorario(combinacion) {
  const coloresPastel = ["#FFB3BA", "#FFDFBA", "#FFFFBA", "#BAFFC9", "#BAE1FF", "#E6B3FF", "#FFB3E6", "#E2F0CB"];
  const materiasUnicas = [...new Set(combinacion.map(c => c.Materia))];
  const mapaColores = {};
  materiasUnicas.forEach((m, i) => { mapaColores[m] = coloresPastel[i % coloresPastel.length]; });

  const diasMap = { "LU": 0, "MA": 1, "MI": 2, "JU": 3, "VI": 4, "SA": 5 };
  const diasNombres = ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];

  // 15 rows (7–21h), 6 columns
  const matriz = Array.from({ length: 15 }, () => Array(6).fill(null));

  for (const clase of combinacion) {
    if (clase.Inicio === 0) continue;
    const inicioH    = Math.floor(clase.Inicio / 100);
    const inicioMins = inicioH * 60 + (clase.Inicio % 100);
    const finMins    = Math.floor(clase.Fin / 100) * 60 + (clase.Fin % 100);
    const duracion   = Math.max(1, Math.ceil((finMins - inicioMins) / 60));

    for (const d of clase.Dias) {
      const dIdx = diasMap[d];
      const hIdx = inicioH - 7;
      if (dIdx !== undefined && hIdx >= 0 && hIdx < 15) {
        matriz[hIdx][dIdx] = { materia: clase.Materia, color: mapaColores[clase.Materia], rowspan: duracion };
        for (let i = 1; i < duracion && hIdx + i < 15; i++) {
          matriz[hIdx + i][dIdx] = 'ocupado';
        }
      }
    }
  }

  let html = '<div class="horario-wrap"><table class="horario-table"><thead><tr>';
  html += '<th class="horario-hora">Hora</th>';
  diasNombres.forEach(d => { html += `<th>${d}</th>`; });
  html += '</tr></thead><tbody>';

  for (let h = 0; h < 15; h++) {
    html += `<tr><td class="horario-hora">${String(h + 7).padStart(2, '0')}:00</td>`;
    for (let d = 0; d < 6; d++) {
      const celda = matriz[h][d];
      if (celda === null) {
        html += '<td></td>';
      } else if (celda !== 'ocupado') {
        html += `<td rowspan="${celda.rowspan}" class="horario-clase" style="background:${celda.color};">${celda.materia}</td>`;
      }
    }
    html += '</tr>';
  }

  html += '</tbody></table></div>';
  return html;
}

// Renders a single schedule option card
function renderOpcion(clases, idx) {
  const sinHorario = clases.filter(c => c.Por_Asignar).map(c => c.Materia);
  const cu = centroSelect.value;

  const rows = clases.map(c => {
    const probClass = c.Probabilidad >= 50 ? 'prob-high' : c.Probabilidad >= 10 ? 'prob-mid' : 'prob-low';
    return `<tr>
      <td>${c.NRC}</td>
      <td><strong>${c.Materia}</strong></td>
      <td><button class="prof-link" data-nombre="${c.Profesor.replace(/"/g,'&quot;')}" data-cu="${cu}">${c.Profesor}</button></td>
      <td>${c.Dias_texto}</td>
      <td>${c.Inicio_texto}</td>
      <td>${c.Fin_texto}</td>
      <td>${c['Saturacion_%']}%</td>
      <td><span class="prob-badge ${probClass}">${c.Probabilidad}%</span></td>
    </tr>`;
  }).join('');

  const sinHorarioAlert = sinHorario.length
    ? `<div class="alert alert-info"><i class="ti ti-info-circle"></i><span>Horario Por Asignar: las siguientes materias no tienen día/hora definidos en SIIAU: <strong>${sinHorario.join(', ')}</strong>. El horario lo asignará el profesor al inicio del ciclo.</span></div>`
    : '';

  return `
    <div class="schedule-option">
      <div class="option-header opt-rank-${idx + 1}">
        <span class="opt-rank-num">${idx + 1}</span>
        <span class="opt-label">Opción ${idx + 1}</span>
      </div>
      <div style="overflow-x:auto;">
        <table class="results-table">
          <thead>
            <tr>
              <th>NRC</th><th>Materia</th><th>Profesor</th>
              <th>Días</th><th>Inicio</th><th>Fin</th>
              <th>Sat. esta materia</th><th>Prob. de alcanzar</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
      ${generarHtmlHorario(clases)}
      ${sinHorarioAlert}
    </div>
  `;
}

// Renders flexibility analysis when classes have low probability
function renderFlexibilidad(flex) {
  if (!flex) return '';

  if (flex.tipo === 'sin_alternativa') {
    return `<div class="alert alert-info"><i class="ti ti-info-circle"></i><span>No se encontró un horario alternativo 100% seguro, incluso sacrificando una materia.</span></div>`;
  }

  let header = '';
  if (flex.tipo === 'alternativa_profesor') {
    header = `<div class="alert alert-success" style="margin-bottom:12px;"><i class="ti ti-bulb"></i><span><strong>Alternativa de Profesor:</strong> Si mantienes todas tus materias, este es el mejor horario 100% seguro (probabilidad &gt; 10% en todas):</span></div>`;
  } else if (flex.tipo === 'sacrificio') {
    header = `<div class="alert alert-success" style="margin-bottom:12px;"><i class="ti ti-bulb"></i><span><strong>Alternativa de Sacrificio:</strong> No es posible tomar todas las materias de forma segura. Pero si retiras <strong>${flex.materia_sacrificada}</strong>, obtendrías este horario seguro:</span></div>`;
  }

  const rows = flex.clases.map(c => {
    const probClass = c.Probabilidad >= 50 ? 'prob-high' : c.Probabilidad >= 10 ? 'prob-mid' : 'prob-low';
    return `<tr>
      <td>${c.NRC}</td><td><strong>${c.Materia}</strong></td><td>${c.Profesor}</td>
      <td>${c.Dias_texto}</td><td>${c.Inicio_texto}</td><td>${c.Fin_texto}</td>
      <td>${c['Saturacion_%']}%</td>
      <td><span class="prob-badge ${probClass}">${c.Probabilidad}%</span></td>
    </tr>`;
  }).join('');

  return `
    <div class="schedule-option" style="border-color: var(--teal-600);">
      <div class="option-header">
        <span class="option-badge badge-safe"><i class="ti ti-bulb"></i> Alternativa Segura</span>
      </div>
      ${header}
      <div style="overflow-x:auto;">
        <table class="results-table">
          <thead>
            <tr><th>NRC</th><th>Materia</th><th>Profesor</th><th>Días</th><th>Inicio</th><th>Fin</th><th>Saturación Hist.</th><th>Prob. de alcanzar</th></tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
      ${generarHtmlHorario(flex.clases)}
    </div>
  `;
}

// Main optimizer event handler
optimizarBtn.addEventListener('click', async () => {
  const centro     = centroSelect.value;
  const claves     = clavesInput.value.trim();
  const promedio   = parseFloat(promedioInput.value) || 85;
  const turno      = document.querySelector('input[name="turno"]:checked')?.value || 'Libre';
  const estrategia = estrategiaSelect.value;

  if (!claves) {
    showStatus('Ingresa al menos una clave de materia.', 'error');
    return;
  }

  setLoading(true);
  showStatus('Conectando con el servidor...', 'info');
  resetResults();

  try {
    const res = await fetch(`${API_BASE}/api/optimizar`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ centro, claves, promedio, turno, estrategia })
    });

    const data = await res.json();

    if (!res.ok) {
      showStatus(data.error || 'Error al optimizar.', 'error');
      return;
    }

    hideStatus();

    let html = '';

    if (data.duplicadas?.length) {
      html += `<div class="alert alert-info"><i class="ti ti-info-circle"></i><span>Claves duplicadas detectadas y eliminadas: ${data.duplicadas.join(', ')}</span></div>`;
    }

    const n = data.resultados.length;
    html += `<div class="alert alert-success"><i class="ti ti-check"></i><span>Se encontraron <strong>${data.total}</strong> horarios sin choques de clases. Mostrando los mejores <strong>${n}</strong>:</span></div>`;

    data.resultados.forEach((clases, idx) => {
      html += renderOpcion(clases, idx);
    });

    const tieneRiesgo = data.resultados[0]?.some(c => c.Probabilidad < 10);
    if (tieneRiesgo) {
      html += `<hr style="border:none;border-top:1px solid var(--border);margin:8px 0 16px;">`;
      html += `<div class="alert alert-warning"><i class="ti ti-alert-triangle"></i><span><strong>Análisis de Flexibilidad:</strong> Tu horario óptimo incluye materias con probabilidad de cupo muy baja (&lt; 10%).</span></div>`;
      html += renderFlexibilidad(data.flexibilidad);
    }

    showResults(html);

  } catch (err) {
    const isNetworkError = err instanceof TypeError;
    showStatus(
      isNetworkError
        ? 'No se pudo conectar con el servidor. Revisa tu conexión e inténtalo de nuevo en un momento.'
        : 'Ocurrió un error al optimizar. Inténtalo de nuevo.',
      'error'
    );
  } finally {
    setLoading(false);
  }
});

// Allow Enter key on claves input
clavesInput.addEventListener('keydown', e => {
  if (e.key === 'Enter') optimizarBtn.click();
});

// Delegated click event for professor modal links
resultsContent.addEventListener('click', e => {
  const btn = e.target.closest('.prof-link');
  if (btn) openProfModal(btn.dataset.nombre, btn.dataset.cu);
});

// Professor detail modal functions
function openProfModal(nombre, cu) {
  const overlay = document.getElementById('profModal');
  const body    = document.getElementById('profModalBody');
  overlay.style.display = 'flex';
  body.innerHTML = '<div class="pm-loading"><i class="ti ti-loader-2 spin"></i> Cargando...</div>';

  Promise.all([
    fetch(`/api/profesores?q=${encodeURIComponent(nombre)}&cu=${cu}&limit=20`).then(r => r.json()),
    fetch(`/api/reviews/${cu}/${encodeURIComponent(nombre)}`).then(r => r.json())
  ]).then(([profData, revData]) => {
    const prof = profData.data?.find(p => p.nombre === nombre) || null;
    body.innerHTML = buildProfModal(nombre, cu, prof, revData);
  }).catch(() => {
    body.innerHTML = '<p style="color:#991B1B;padding:16px;">Error al cargar datos del profesor.</p>';
  });
}

function closeProfModal() {
  document.getElementById('profModal').style.display = 'none';
}

function starsHtml(n, size = 14) {
  const full = Math.round(n || 0);
  return `<span style="color:#F59E0B;font-size:${size}px;letter-spacing:1px;">${'★'.repeat(full)}${'☆'.repeat(5 - full)}</span>`;
}

function buildProfModal(nombre, cu, prof, revData) {
  const avatarClass = AVATAR_COLORS[cu] || 'av-blue';
  const iniciales   = prof?.iniciales || nombre.split(' ').slice(0, 2).map(w => w[0]).join('');

  const altaDemanda = prof?.alta_demanda ? `
    <div class="rev-alert rev-alert-fire" style="display:flex;align-items:flex-start;gap:10px;background:#FEF3C7;border:1px solid #FDE68A;border-radius:10px;padding:12px 14px;margin-bottom:16px;font-size:13px;color:#92400E;">
      <i class="ti ti-flame" style="font-size:18px;flex-shrink:0;margin-top:1px;"></i>
      <span><strong>Alta demanda:</strong> Saturación histórica ≥ 85% — muchos estudiantes quieren a este profesor.</span>
    </div>` : '';

  const statsBlock = prof ? `
    <div class="modal-stats" style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-bottom:20px;">
      <div class="ms-card stat-blue">
        <div class="ms-num" style="color:var(--blue-900);">${prof.num_materias ?? '—'}</div>
        <div class="ms-lbl" style="color:var(--blue-600);">Materias</div>
      </div>
      <div class="ms-card stat-teal">
        <div class="ms-num" style="color:var(--teal-900);">${prof.num_secciones ?? '—'}</div>
        <div class="ms-lbl" style="color:var(--teal-600);">Secciones</div>
      </div>
      <div class="ms-card stat-amber">
        <div class="ms-num" style="color:var(--amber-900);">${revData.avg_rating ? revData.avg_rating.toFixed(1) : (prof.rating?.toFixed(1) ?? '—')}</div>
        <div class="ms-lbl" style="color:var(--amber-600);">${revData.avg_rating ? 'Rating real' : 'Score est.'}</div>
      </div>
      <div class="ms-card" style="background:${prof.alta_demanda ? '#FEF3C7' : 'var(--bg)'};">
        <div class="ms-num" style="font-size:18px;color:${prof.alta_demanda ? '#92400E' : 'var(--text-tertiary)'};">${prof.avg_sat ?? '—'}%</div>
        <div class="ms-lbl" style="color:${prof.alta_demanda ? '#B45309' : 'var(--text-tertiary)'};">Saturación de cupos</div>
        <div style="font-size:9px;color:var(--text-tertiary);margin-top:2px;line-height:1.3;">promedio de todas sus materias</div>
      </div>
    </div>` : '';

  const mats  = prof?.materias || [];
  const clvs  = prof?.claves   || [];
  const cursosHtml = mats.length
    ? mats.map((m, i) => `
        <div class="curso-row">
          ${clvs[i] ? `<span class="curso-clave">${clvs[i]}</span>` : ''}
          <span class="curso-nombre">${m}</span>
        </div>`).join('')
    : '<span style="color:var(--text-tertiary);font-size:13px;">Sin datos</span>';

  // Reviews
  let reviewsSection = '';
  if (!revData.num_reviews) {
    reviewsSection = `
      <div style="display:flex;align-items:flex-start;gap:10px;background:var(--bg);border:1px solid var(--border);border-radius:10px;padding:12px 14px;font-size:13px;color:var(--text-secondary);">
        <i class="ti ti-robot" style="font-size:18px;flex-shrink:0;"></i>
        <span>El score mostrado es <strong>estimado por algoritmo</strong>. Aún no hay reseñas — ¡sé el primero en la página principal!</span>
      </div>`;
  } else {
    const pctBadge   = revData.pct_recomienda !== null ? `<span style="background:var(--teal-50);color:var(--teal-900);font-size:11px;font-weight:600;padding:2px 8px;border-radius:999px;">${revData.pct_recomienda}% lo recomiendan</span>` : '';
    const verBadge   = revData.num_verificadas > 0 ? `<span style="background:var(--blue-50);color:var(--blue-600);font-size:11px;padding:2px 8px;border-radius:999px;display:inline-flex;align-items:center;gap:3px;">${revData.num_verificadas} verificadas <i class="ti ti-circle-check-filled"></i></span>` : '';
    const califBadge = revData.avg_calificacion != null ? `<span style="background:#f5f3ff;color:#7c3aed;font-size:11px;font-weight:600;padding:2px 8px;border-radius:999px;display:inline-flex;align-items:center;gap:3px;"><i class="ti ti-school"></i> Calif. promedio: ${revData.avg_calificacion}/100</span>` : '';
    const header     = `<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:12px;"><span style="font-size:13px;color:var(--text-secondary);">${revData.num_reviews} reseña${revData.num_reviews !== 1 ? 's' : ''}</span>${pctBadge}${verBadge}${califBadge}</div>`;
    const cards = (revData.reviews || []).map(r => {
      const nameTag   = r.verificada ? `<span class="rev-verified-badge">${escapeHtml(r.nombre_mostrado || 'Anónimo')} <i class="ti ti-circle-check-filled"></i></span>` : `<span style="font-size:11px;color:var(--text-tertiary);">Anónimo</span>`;
      const cicloTag  = r.ciclo    ? `<span style="font-size:11px;color:var(--text-tertiary);">${escapeHtml(r.ciclo)}</span>` : '';
      const materiaTag = r.materia ? `<span style="font-size:11px;color:var(--text-tertiary);">${escapeHtml(r.materia)}</span>` : '';
      const califTag  = r.calificacion != null ? `<span style="font-size:11px;font-weight:700;background:#f5f3ff;color:#7c3aed;padding:2px 8px;border-radius:999px;">${r.calificacion}/100</span>` : '';
      const recTag    = r.recomienda
        ? `<span style="font-size:10px;background:var(--teal-50);color:var(--teal-900);padding:2px 7px;border-radius:999px;display:inline-flex;align-items:center;gap:2px;"><i class="ti ti-check"></i> Recomienda</span>`
        : `<span style="font-size:10px;background:var(--coral-50);color:var(--coral-900);padding:2px 7px;border-radius:999px;display:inline-flex;align-items:center;gap:2px;"><i class="ti ti-x"></i> No recomienda</span>`;
      const texto = r.texto ? `<p style="font-size:13px;color:var(--text-secondary);margin:8px 0 0;line-height:1.5;">${escapeHtml(r.texto)}</p>` : '';
      return `<div class="rev-card"><div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:6px;"><div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">${nameTag}${cicloTag}${materiaTag}${califTag}</div><div style="display:flex;align-items:center;gap:6px;">${starsHtml(r.rating_general, 12)}${recTag}</div></div>${texto}</div>`;
    }).join('');
    reviewsSection = header + cards;
  }

  return `
    <div class="modal-head" style="display:flex;gap:16px;margin-bottom:18px;">
      <div class="modal-avatar ${avatarClass}" style="width:64px;height:64px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-family:var(--font-display);font-weight:700;font-size:22px;flex-shrink:0;">${iniciales}</div>
      <div>
        <h2 class="modal-name" style="font-size:20px;color:var(--blue-900);margin-bottom:4px;">${nombre}</h2>
        <div class="modal-dept" style="font-size:13px;color:var(--text-secondary);">${cu}</div>
      </div>
    </div>
    ${altaDemanda}
    ${statsBlock}
    <div class="reviews-title" style="font-size:14px;font-weight:600;color:var(--blue-900);margin-bottom:12px;padding-top:14px;border-top:1px solid var(--border);">Materias impartidas</div>
    <div class="cursos-list" style="margin-bottom:20px;">${cursosHtml}</div>
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;padding-top:14px;border-top:1px solid var(--border);">
      <span style="font-size:14px;font-weight:600;color:var(--blue-900);">Reseñas de estudiantes</span>
    </div>
    ${reviewsSection}
  `;
}
