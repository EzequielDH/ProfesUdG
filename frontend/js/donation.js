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
          amount: 2000, // $20.00 MXN por defecto
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

  /* ── Pop-up de selección de monto ÚNICAMENTE para Google Pay ── */
  window.triggerPayment = function (method) {
    if (method === 'apple') {
      const isAppleDevice = /Mac|iPhone|iPad|iPod/i.test(navigator.userAgent);
      if (!stripeObj && window.Stripe) {
        stripeObj = Stripe(STRIPE_PUBLISHABLE_KEY);
      }
      if (isAppleDevice && stripeObj) {
        try {
          const pr = stripeObj.paymentRequest({
            country: 'MX',
            currency: 'mxn',
            total: { label: 'Donación ProfesUdG', amount: 2000 },
            requestPayerName: false,
          });
          pr.canMakePayment().then(function (res) {
            if (res && res.applePay) {
              pr.show();
            } else {
              openStripePopup();
            }
          }).catch(openStripePopup);

          pr.on('paymentmethod', function (ev) {
            ev.complete('success');
            if (typeof window.closeFullDonationModal === 'function') {
              window.closeFullDonationModal();
            }
            showDonationThankYouToast();
          });
          return;
        } catch (e) {
          console.warn('[Stripe ApplePay Error]:', e);
        }
      }
      openStripePopup();
      return;
    }

    if (method === 'card') {
      openStripePopup();
      return;
    }

    // Abrir mini pop-up de monto ÚNICAMENTE para Google Pay
    openAmountPromptModal();
  };

  let selectedPromptAmount = 20;

  function openAmountPromptModal() {
    let activeModal = document.getElementById('amtPromptOverlay');
    if (activeModal) activeModal.remove();

    selectedPromptAmount = 20;

    const div = document.createElement('div');
    div.id = 'amtPromptOverlay';
    div.className = 'amt-selector-overlay';
    div.onclick = function(e) { if(e.target === div) closeAmountPromptModal(); };

    div.innerHTML = `
      <div class="amt-selector-modal">
        <button onclick="closeAmountPromptModal()" style="position:absolute;top:14px;right:14px;background:none;border:none;font-size:18px;cursor:pointer;color:#737373;" aria-label="Cerrar"><i class="ti ti-x"></i></button>
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px;color:#1A73E8;">
          <i class="ti ti-brand-google" style="font-size:22px;color:#4285F4;"></i>
          <strong style="font-size:16px;">Donar con Google Pay</strong>
        </div>
        <p style="font-size:13px;color:#525252;margin:0 0 14px;">Selecciona el monto que deseas aportar:</p>

        <div class="amt-chips-grid">
          <button class="amt-chip-btn active" data-amt="20" onclick="selectAmtChip(20, this)">$20 MXN</button>
          <button class="amt-chip-btn" data-amt="30" onclick="selectAmtChip(30, this)">$30 MXN</button>
          <button class="amt-chip-btn" data-amt="50" onclick="selectAmtChip(50, this)">$50 MXN</button>
        </div>

        <input type="number" id="amtCustomInput" class="amt-custom-input" placeholder="Otro monto (ej. 40, 80, 150)..." min="10" max="10000" oninput="clearAmtChips()">

        <div id="amtErrorMsg" style="display:none;color:#DC2626;font-size:12px;font-weight:600;margin:-8px 0 14px;text-align:center;">
          <i class="ti ti-alert-triangle"></i> El monto mínimo es de $10 MXN y el máximo de $10,000 MXN.
        </div>

        <button class="amt-confirm-btn" onclick="confirmPaymentWithAmount()">
          <span>Continuar a Google Pay</span>
          <i class="ti ti-arrow-right"></i>
        </button>
      </div>
    `;

    document.body.appendChild(div);
    requestAnimationFrame(() => div.classList.add('show'));
  }

  window.selectAmtChip = function(amt, btn) {
    selectedPromptAmount = amt;
    const inp = document.getElementById('amtCustomInput');
    const err = document.getElementById('amtErrorMsg');
    if (inp) inp.value = '';
    if (err) err.style.display = 'none';
    document.querySelectorAll('.amt-chip-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
  };

  window.clearAmtChips = function() {
    const err = document.getElementById('amtErrorMsg');
    if (err) err.style.display = 'none';
    document.querySelectorAll('.amt-chip-btn').forEach(b => b.classList.remove('active'));
  };

  window.closeAmountPromptModal = function() {
    const ov = document.getElementById('amtPromptOverlay');
    if (!ov) return;
    ov.classList.remove('show');
    setTimeout(() => ov.remove(), 200);
  };

  window.confirmPaymentWithAmount = function() {
    const inp = document.getElementById('amtCustomInput');
    const errDiv = document.getElementById('amtErrorMsg');
    let finalAmount = selectedPromptAmount;

    if (inp && inp.value.trim() !== '') {
      const customVal = parseFloat(inp.value);
      if (isNaN(customVal) || customVal < 10 || customVal > 10000) {
        if (errDiv) errDiv.style.display = 'block';
        inp.focus();
        return;
      }
      finalAmount = customVal;
    }

    if (errDiv) errDiv.style.display = 'none';
    closeAmountPromptModal();
    executeStripePaymentRequest('google', finalAmount);
  };

  function executeStripePaymentRequest(method, amountMxn) {
    if (!stripeObj && window.Stripe) {
      stripeObj = Stripe(STRIPE_PUBLISHABLE_KEY);
    }

    if (stripeObj) {
      try {
        const pr = stripeObj.paymentRequest({
          country: 'MX',
          currency: 'mxn',
          total: {
            label: 'Donación ProfesUdG',
            amount: Math.round(amountMxn * 100),
          },
          requestPayerName: false,
        });

        const isAppleDevice = /Mac|iPhone|iPad|iPod/i.test(navigator.userAgent);

        pr.canMakePayment().then(function (res) {
          if (res && ((method === 'apple' && res.applePay && isAppleDevice) || (method === 'google' && res.googlePay) || res.applePay || res.googlePay)) {
            pr.show();
          } else {
            openStripePopup();
          }
        }).catch(openStripePopup);

        pr.on('paymentmethod', function (ev) {
          ev.complete('success');
          if (typeof window.closeFullDonationModal === 'function') {
            window.closeFullDonationModal();
          }
          showDonationThankYouToast();
        });
        return;
      } catch (e) {
        console.warn('[Stripe] Error:', e);
      }
    }
    openStripePopup();
  }

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
      Mantengo el servidor y dominio <strong>de mi bolsillo</strong>. Una pequeña donación ayuda a mantener la plataforma activa.
    </p>

    <div class="dfull-pay-methods" style="margin-bottom:12px;">
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
    <a class="dfull-kofi-subtle-btn" href="${KOFI_URL}" target="_blank" rel="noopener" onclick="closeDonationModal()" style="margin-top:8px;">
      <i class="ti ti-coffee"></i> Donar vía Ko-fi / PayPal
    </a>

    <div class="donation-footer-btns" style="margin-top:14px;">
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
      gsap.set(modal, { opacity: 0, y: 8, scale: 0.98 });

      gsap.to(ov, { opacity: 1, duration: 0.1, ease: 'power1.out' });
      gsap.to(modal, { opacity: 1, y: 0, scale: 1, duration: 0.12, ease: 'power2.out' });
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
      gsap.to(ov, { opacity: 0, duration: 0.08, ease: 'power1.in' });
      gsap.to(modal, {
        opacity: 0, y: 6, scale: 0.98, duration: 0.08, ease: 'power1.in',
        onComplete: () => { ov.style.display = 'none'; }
      });
    } else {
      ov.classList.remove('show');
      setTimeout(() => { ov.style.display = 'none'; }, 100);
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

  /* ── Manejo de redirección después del pago exitoso (?donado=1) ── */
  const urlParams = new URLSearchParams(window.location.search);
  if (urlParams.get('donado') === '1') {
    if (window.opener && !window.opener.closed) {
      try {
        window.opener.postMessage({ type: 'stripe-donation-success' }, '*');
      } catch (e) {}
    }
    document.write(`<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>¡Gracias por tu donación! — ProfesUdG</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #F8FAFC; color: #042C53; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; padding: 20px; text-align: center; }
    .card { background: white; border-radius: 16px; padding: 32px 24px; max-width: 400px; box-shadow: 0 10px 30px rgba(0,0,0,0.08); border: 1px solid #E2E8F0; }
    .icon { width: 68px; height: 68px; background: #E6F4F1; border-radius: 50%; display: flex; align-items: center; justify-content: center; margin: 0 auto 16px; font-size: 32px; }
    h1 { font-size: 22px; font-weight: 700; margin: 0 0 10px; color: #042C53; }
    p { font-size: 14px; color: #525252; line-height: 1.55; margin: 0 0 20px; }
    .badge { display: inline-block; font-size: 12px; font-weight: 600; color: #185FA5; background: #E6F1FB; padding: 6px 14px; border-radius: 999px; }
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">❤️</div>
    <h1>¡Muchas gracias por tu apoyo!</h1>
    <p>Tu donación ayuda directamente a mantener el servidor y el dominio activos para todos los estudiantes UdG.</p>
    <div class="badge">Esta ventana se cerrará en <span id="sec">6</span>s</div>
  </div>
  <script>
    let s = 6;
    setInterval(function() {
      s--;
      var el = document.getElementById('sec');
      if (el) el.textContent = s;
      if (s <= 0) { window.close(); }
    }, 1000);
  </script>
</body>
</html>`);
    document.close();
    return;
  }

  // Listener en la ventana principal para mostrar toast al recibir notificación de pago exitoso
  window.addEventListener('message', function (e) {
    if (e.data && e.data.type === 'stripe-donation-success') {
      if (typeof window.closeFullDonationModal === 'function') {
        window.closeFullDonationModal();
      }
      showDonationThankYouToast();
    }
  });

  function showDonationThankYouToast() {
    const toast = document.createElement('div');
    toast.innerHTML = `
      <div style="position:fixed;bottom:28px;left:50%;transform:translateX(-50%);background:#042C53;color:white;padding:14px 24px;border-radius:14px;font-size:14px;font-weight:600;box-shadow:0 10px 30px rgba(0,0,0,0.25);z-index:99999;display:flex;align-items:center;gap:10px;">
        <span style="font-size:22px;">❤️</span>
        <span>¡Donación recibida! Muchísimas gracias por apoyar a ProfesUdG.</span>
      </div>
    `;
    document.body.appendChild(toast.firstElementChild);
    setTimeout(() => { toast.firstElementChild?.remove(); }, 7000);
  }

  // Contador de clics
  let clicks = 0;
  document.addEventListener('click', function () {
    clicks++;
    if (clicks === 25) setTimeout(window.showDonationPopup, 600);
  }, { passive: true });
})();


