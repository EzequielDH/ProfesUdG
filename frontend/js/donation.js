(function () {
  const STORAGE_KEY = 'pud_donation';
  const COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000;
  const KOFI_URL = 'https://ko-fi.com/profesudg';

  function shouldShow() {
    try {
      const d = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
      if (d.never) return false;
      if (d.lastShown && Date.now() - d.lastShown < COOLDOWN_MS) return false;
    } catch {}
    return true;
  }

  function markShown() {
    try {
      const d = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
      d.lastShown = Date.now();
      localStorage.setItem(STORAGE_KEY, JSON.stringify(d));
    } catch {}
  }

  window.neverDonation = function () {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ never: true })); } catch {}
    closeDonationModal();
  };

  function injectHTML() {
    if (document.getElementById('donationOverlay')) return;
    const el = document.createElement('div');
    el.innerHTML = `
<div class="donation-overlay" id="donationOverlay" onclick="if(event.target===this)closeDonationModal()">
  <div class="donation-modal">
    <button class="donation-close" onclick="closeDonationModal()"><i class="ti ti-x"></i></button>
    <div class="donation-coffee">☕</div>
    <h3 class="donation-title">¿Te fue útil ProfesUdG?</h3>
    <p class="donation-body">
      Este proyecto lo mantengo <strong>de mi bolsillo</strong> — el servidor cuesta
      <strong>$12 USD al mes</strong>. Si te ayudó a elegir a tus profes o armar tu horario,
      una pequeña donación me permite seguir manteniéndolo activo.
    </p>
    <a class="donation-btn-kofi" href="${KOFI_URL}" target="_blank" rel="noopener" onclick="closeDonationModal()">
      <i class="ti ti-coffee"></i> Invitarme un café en Ko-fi
    </a>
    <div class="donation-footer-btns">
      <button class="donation-btn-later" onclick="closeDonationModal()">Quizás después</button>
      <button class="donation-btn-never" onclick="neverDonation()">No volver a mostrar</button>
    </div>
  </div>
</div>`;
    document.body.appendChild(el.firstElementChild);
  }

  window.showDonationPopup = function () {
    if (!shouldShow()) return;
    injectHTML();
    const ov = document.getElementById('donationOverlay');
    ov.style.display = 'flex';
    requestAnimationFrame(() => ov.classList.add('show'));
    markShown();
  };

  window.closeDonationModal = function () {
    const ov = document.getElementById('donationOverlay');
    if (!ov) return;
    ov.classList.remove('show');
    setTimeout(() => { ov.style.display = 'none'; }, 300);
  };

  // Trigger por muchos clicks (25)
  let clicks = 0;
  document.addEventListener('click', function () {
    clicks++;
    if (clicks === 25) setTimeout(window.showDonationPopup, 600);
  }, { passive: true });
})();
