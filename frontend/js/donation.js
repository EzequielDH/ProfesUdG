(function () {
  const STORAGE_KEY = 'pud_donation';
  const COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000;
  const KOFI_URL = 'https://ko-fi.com/profesudg';
  const STRIPE_LINK = 'https://buy.stripe.com/fZu9ALfPR2KOb3S3PF43S00';
  const STRIPE_PUBLISHABLE_KEY = 'pk_live_51Tsx4218OJBs5K1fhV8zPlMgrTl6PWemMEqvqxTWbBgpVRc97t4dbhb0dmk8OShkAQoUD5roa5LyltRsdYoH6L7K00hzy1OB01';

  let stripeObj = null;
  let paymentRequest = null;

  /* ── Pre-inject Modals into DOM ── */
  function injectFullModal() {
    if (document.getElementById('donationFullOverlay')) return;
    const el = document.createElement('div');
    el.innerHTML = `
<div class="dfull-overlay" id="donationFullOverlay" onclick="if(event.target===this)closeFullDonationModal()">
  <div class="dfull-modal" id="donationFullModal">
    <button class="dfull-close" onclick="closeFullDonationModal()" aria-label="Cerrar"><i class="ti ti-x"></i></button>

    <div class="dfull-header" id="dfullHeader">
      <div class="dfull-emoji" id="dfullEmoji">☕</div>
      <h2 class="dfull-title" id="dfullTitle">Apoya ProfesUdG</h2>
      <p class="dfull-sub" id="dfullSub">Hecho por un estudiante UdG, para estudiantes UdG</p>
    </div>

    <div class="dfull-story" id="dfullStory">
      <p>
        Creé ProfesUdG porque encontrar información real sobre profesores era imposible.
        No hay patrocinio ni publicidad — costeo el servidor y el dominio
        <strong>de mi bolsillo</strong> para que tú puedas elegir mejor a tus profes y armar tu horario.
      </p>
    </div>

    <div class="dfull-cost-card" id="dfullCost">
      <p class="dfull-cost-label">Lo que me cuesta mantenerlo activo:</p>
      <div class="dfull-cost-pills">
        <div class="dfull-pill">
          <i class="ti ti-server"></i>
          <div>
            <span class="dfull-pill-name">Servidor</span>
            <span class="dfull-pill-val">$18 USD / mes</span>
          </div>
        </div>
        <div class="dfull-pill">
          <i class="ti ti-world"></i>
          <div>
            <span class="dfull-pill-name">Dominio</span>
            <span class="dfull-pill-val">$350 / año</span>
          </div>
        </div>
      </div>
    </div>

    <div class="dfull-pay-methods" id="dfullPay">
      <span class="dfull-pay-label" style="font-weight:600; color:var(--blue-900);">Selecciona cómo quieres donar:</span>
      <div class="dfull-pay-badges">
        <button class="dfull-badge-primary" data-method="google" onclick="triggerPayment('google')">
          <i class="ti ti-brand-google"></i>
          <span>Google Pay</span>
        </button>
        <button class="dfull-badge-primary" data-method="apple" onclick="triggerPayment('apple')">
          <i class="ti ti-brand-apple"></i>
          <span>Apple Pay</span>
        </button>
        <button class="dfull-badge-primary" data-method="card" onclick="triggerPayment('card')">
          <i class="ti ti-credit-card"></i>
          <span>Tarjeta</span>
        </button>
      </div>
    </div>

    <!-- Botón secundario de Ko-fi / PayPal -->
    <a class="dfull-kofi-subtle-btn" id="dfullBtn" href="${KOFI_URL}" target="_blank" rel="noopener">
      <i class="ti ti-coffee"></i> Donar vía Ko-fi / PayPal
    </a>

    <p class="dfull-note" id="dfullNote" style="margin-top: 14px;">Cualquier monto ayuda a mantener el proyecto activo.</p>
  </div>
</div>`;
    document.body.appendChild(el.firstElementChild);
    initStripeButton();
  }

  /* ── Inicialización de Stripe 1-Clic ── */
  function initStripeButton() {
    if (!window.Stripe || stripeObj) return;
    try {
      stripeObj = Stripe(STRIPE_PUBLISHABLE_KEY);
      paymentRequest = stripeObj.paymentRequest({
        country: 'MX',
        currency: 'mxn',
        total: {
          label: 'Donación ProfesUdG',
          amount: 5000, // $50.00 MXN
        },
        requestPayerName: false,
      });

      paymentRequest.canMakePayment().then(function (result) {
        console.log('[Stripe] canMakePayment:', result);
      });

      paymentRequest.on('paymentmethod', function (ev) {
        ev.complete('success');
        alert('¡Muchas gracias por tu apoyo a ProfesUdG!');
        closeFullDonationModal();
      });
    } catch (err) {
      console.warn('[Stripe] init info:', err);
    }
  }

  /* ── Manejador 1-Clic de Pago Directo ── */
  window.triggerPayment = function (method) {
    const isAppleDevice = /Mac|iPhone|iPad|iPod/i.test(navigator.userAgent);
    
    if (method === 'apple' && isAppleDevice && paymentRequest) {
      paymentRequest.canMakePayment().then(function (res) {
        if (res && res.applePay) {
          paymentRequest.show();
          return;
        }
        openStripePopup();
      }).catch(openStripePopup);
    } else if (method === 'google' && paymentRequest) {
      paymentRequest.canMakePayment().then(function (res) {
        if (res && res.googlePay) {
          paymentRequest.show();
          return;
        }
        openStripePopup();
      }).catch(openStripePopup);
    } else {
      openStripePopup();
    }
  };

  /* ── Ventana elegante de Stripe Checkout ── */
  window.openStripePopup = function () {
    const w = 580;
    const h = 750;
    const left = Math.max(0, (window.screen.width / 2) - (w / 2));
    const top = Math.max(0, (window.screen.height / 2) - (h / 2));
    window.open(
      STRIPE_LINK,
      'StripeCheckout',
      `width=${w},height=${h},top=${top},left=${left},status=no,toolbar=no,menubar=no,location=no,resizable=yes,scrollbars=yes`
    );
  };

  function injectPopup() {
    if (document.getElementById('donationOverlay')) return;
    const el = document.createElement('div');
    el.innerHTML = `
<div class="donation-overlay" id="donationOverlay" onclick="if(event.target===this)closeDonationModal()">
  <div class="donation-modal">
    <button class="donation-close" onclick="closeDonationModal()" aria-label="Cerrar"><i class="ti ti-x"></i></button>
    <div class="donation-coffee">☕</div>
    <h3 class="donation-title">¿Te fue útil ProfesUdG?</h3>
    <p class="donation-body">
      Mantengo este servidor <strong>de mi bolsillo</strong> — cuesta
      <strong>$12 USD al mes</strong>. Una pequeña donación me ayuda a mantenerlo activo.
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

  // Pre-inyectar modales al cargar el DOM para eliminar delay en clic
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      injectFullModal();
      injectPopup();
    });
  } else {
    injectFullModal();
    injectPopup();
  }

  /* ── Helper de Storage ── */
  function shouldShowPopup() {
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
    closeFullDonationModal();
  };

  /* ── Modal completo (botón nav) ── */
  window.openDonationModal = function () {
    injectFullModal();
    const ov = document.getElementById('donationFullOverlay');
    const modal = document.getElementById('donationFullModal');
    if (!ov || !modal) return;

    ov.style.display = 'flex';

    if (window.gsap) {
      gsap.killTweensOf([ov, modal]);
      gsap.set(ov, { opacity: 0 });
      gsap.set(modal, { opacity: 0, y: 16, scale: 0.97 });

      gsap.to(ov, { opacity: 1, duration: 0.18, ease: 'power2.out' });
      gsap.to(modal, { opacity: 1, y: 0, scale: 1, duration: 0.22, ease: 'back.out(1.2)' });
    } else {
      ov.classList.add('show');
    }
  };

  window.closeFullDonationModal = function () {
    const ov = document.getElementById('donationFullOverlay');
    if (!ov) return;
    const modal = document.getElementById('donationFullModal');
    if (window.gsap && modal) {
      gsap.killTweensOf([ov, modal]);
      gsap.to(ov, { opacity: 0, duration: 0.16, ease: 'power2.in' });
      gsap.to(modal, {
        opacity: 0, y: 12, scale: 0.97, duration: 0.16, ease: 'power2.in',
        onComplete: () => { ov.style.display = 'none'; }
      });
    } else {
      ov.classList.remove('show');
      setTimeout(() => { ov.style.display = 'none'; }, 200);
    }
  };

  /* ── Popup automático (mini) ── */
  window.showDonationPopup = function () {
    if (!shouldShowPopup()) return;
    injectPopup();
    const ov = document.getElementById('donationOverlay');
    if (!ov) return;
    ov.style.display = 'flex';
    requestAnimationFrame(() => ov.classList.add('show'));
    markShown();
  };

  window.closeDonationModal = function () {
    const ov = document.getElementById('donationOverlay');
    if (!ov) return;
    ov.classList.remove('show');
    setTimeout(() => { ov.style.display = 'none'; }, 200);
  };

  // Contador de clics
  let clicks = 0;
  document.addEventListener('click', function () {
    clicks++;
    if (clicks === 25) setTimeout(window.showDonationPopup, 600);
  }, { passive: true });
})();


