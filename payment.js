/**
 * payment.js — CrackAI Payment Module v2.1
 * ──────────────────────────────────────────
 * Uses your already-deployed Cloud Run backend for order creation
 * (Cashfree blocks direct browser API calls via CORS).
 * Verification also goes through your backend for security.
 *
 * Your live endpoints (from app.js):
 *   ORDER:  https://createcashfreeorder-419137308157.us-central1.run.app
 *   VERIFY: https://verifypayment-419137308157.us-central1.run.app
 *
 * Drop in AFTER app.js — auto-overrides all payment functions.
 */

(function () {
  'use strict';

  /* ─── CONFIG ────────────────────────────────────────────────── */
  // Switch to 'sandbox' for testing, 'production' for real payments
  const CF_ENV = 'production';

  // Always use the new Cloud Run URLs — they have CORS open for all origins
  const ORDER_URL  = 'https://createcashfreeorder-56khnynjia-uc.a.run.app';
  const VERIFY_URL = 'https://verifypayment-56khnynjia-uc.a.run.app';

  const PLANS = {
    premium:          { id: 'premium',          name: 'Premium',                price: 199,  emoji: '⭐' },
    ssc:              { id: 'ssc',              name: 'SSC Pro',                 price: 199,  emoji: '🎯' },
    class10:          { id: 'class10',          name: 'Class Pro',               price: 129,  emoji: '📖' },
    class10_yearly:   { id: 'class10_yearly',   name: 'Class Pro Yearly',        price: 1299, emoji: '📖' },
    semiannual:       { id: 'semiannual',        name: 'SSC 6-Month Plan',        price: 499,  emoji: '🔥' },
    yearly:           { id: 'yearly',           name: 'All-in-One Yearly',       price: 999,  emoji: '🌟' },
    // Battle Creator tiers
    battle:           { id: 'battle',           name: 'Battle Creator Basic',    price: 99,   emoji: '⚔️', battleMonthly: 10 },
    battle_pro:       { id: 'battle_pro',       name: 'Battle Creator Pro',      price: 299,  emoji: '⚔️', battleMonthly: 100 },
    battle_academy:   { id: 'battle_academy',   name: 'Battle Creator Academy',  price: 499,  emoji: '⚔️', battleMonthly: 999 },
    battle_extra_10:  { id: 'battle_extra_10',  name: '+10 Battle Creations',    price: 49,   emoji: '⚔️', isAddon: true, battleCredits: 10 },
    battle_extra_25:  { id: 'battle_extra_25',  name: '+25 Battle Creations',    price: 99,   emoji: '⚔️', isAddon: true, battleCredits: 25 },
    // Study Group & Coaching plans (admin pays, members join free)
    group_leader:     { id: 'group_leader',     name: 'Group Leader',            price: 99,   emoji: '👥' },
    coaching_basic:   { id: 'coaching_basic',   name: 'Coaching Plan Basic',     price: 499,  emoji: '🎓' },
    coaching_pro:     { id: 'coaching_pro',     name: 'Coaching Plan Pro',       price: 999,  emoji: '🎓' },
  };

  const ADDONS = {
    vision_pro_addon: { name: 'PrepAI Vision Pro',   price: 49,  emoji: '🔬' },
    prepaipro_addon:  { name: 'PrepAI Pro',           price: 49,  emoji: '✨' },
    v4pro_addon:      { name: 'PrepAI V4 Pro',         price: 149, emoji: '🚀' },
    battle_extra_10:  { name: '+10 Battle Creations', price: 49,  emoji: '⚔️', isAddon: true, battleCredits: 10 },
    battle_extra_25:  { name: '+25 Battle Creations', price: 99,  emoji: '⚔️', isAddon: true, battleCredits: 25 },
  };

  /* ── Battle Extra Credits helpers ── */
  function getBattleExtraCredits() {
    try {
      const key = 'sscai_battle_extra_credits';
      const data = JSON.parse(localStorage.getItem(key) || '{"credits":0}');
      return data.credits || 0;
    } catch(e) { return 0; }
  }
  function addBattleExtraCreditsToStorage(n) {
    try {
      const key = 'sscai_battle_extra_credits';
      const data = JSON.parse(localStorage.getItem(key) || '{"credits":0}');
      data.credits = (data.credits || 0) + n;
      localStorage.setItem(key, JSON.stringify(data));
    } catch(e) {}
  }
  function useBattleExtraCredit() {
    try {
      const key = 'sscai_battle_extra_credits';
      const data = JSON.parse(localStorage.getItem(key) || '{"credits":0}');
      if ((data.credits || 0) <= 0) return false;
      data.credits = data.credits - 1;
      localStorage.setItem(key, JSON.stringify(data));
      return true;
    } catch(e) { return false; }
  }
  window._battleExtra = { getBattleExtraCredits, useBattleExtraCredit };

  /* ─── HELPERS ───────────────────────────────────────────────── */
  function currentUser()  { return window._firebaseAuth?.currentUser || null; }
  function uid()          { return currentUser()?.uid || ('guest_' + Date.now()); }
  function userEmail()    { return currentUser()?.email || 'student@crackai.in'; }
  function userName()     { return currentUser()?.displayName || 'Student'; }

  async function getToken() {
    try { return await currentUser()?.getIdToken() || null; } catch { return null; }
  }

  function toast(msg, duration = 3000) {
    if (typeof showToast === 'function') showToast(msg, duration);
  }

  /* ─── LAZY-LOAD CASHFREE SDK (only when user clicks Pay) ───── */
  let _cfSdkLoading = null;
  function loadCashfreeSDK() {
    if (typeof Cashfree === 'function') return Promise.resolve(); // already loaded
    if (_cfSdkLoading) return _cfSdkLoading;                     // load in progress
    _cfSdkLoading = new Promise(function(resolve, reject) {
      var s = document.createElement('script');
      s.src = 'https://sdk.cashfree.com/js/v3/cashfree.js';
      s.onload = function() { resolve(); };
      s.onerror = function() { reject(new Error('Cashfree SDK failed to load. Check your internet connection.')); };
      document.head.appendChild(s);
    });
    return _cfSdkLoading;
  }

  async function getCF() {
    await loadCashfreeSDK();
    if (typeof Cashfree === 'function') return Cashfree({ mode: CF_ENV });
    throw new Error('Cashfree SDK not available.');
  }

  /* ─── ORDER CREATION via your Cloud Run backend ─────────────── */
  async function createOrder({ orderId, amount, planId, note }) {
    const token = await getToken();
    const res = await fetch(ORDER_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({
        order_id:       orderId,
        amount,
        currency:       'INR',
        plan:           planId,
        order_note:     note || planId,
        customer_id:    uid(),
        customer_name:  userName(),
        customer_email: userEmail(),
        customer_phone: currentUser()?.phoneNumber?.replace(/\D/g,'').slice(-10) || '9000000000',
        uid:            uid(),
        name:           userName(),
        email:          userEmail(),
      }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || err.message || `Order failed (${res.status})`);
    }

    const data = await res.json();
    if (!data.payment_session_id) throw new Error('No payment session returned from server');
    return data; // { order_id, payment_session_id }
  }

  /* ─── PAYMENT VERIFICATION via your Cloud Run backend ───────── */
  async function verifyOrder(orderId) {
    try {
      const token = await getToken();
      const res = await fetch(VERIFY_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ order_id: orderId }),
      });
      if (!res.ok) return null;
      const data = await res.json();
      return data; // { status: 'PAID' | 'FAILED' | ... }
    } catch { return null; }
  }

  /* ─── POLL UNTIL PAID ───────────────────────────────────────── */
  function pollUntilPaid(orderId, { onPaid, onFailed, maxAttempts = 24, interval = 5000 }) {
    let attempt = 0;
    const timer = setInterval(async () => {
      attempt++;
      const result = await verifyOrder(orderId);
      if (result?.status === 'PAID') {
        clearInterval(timer);
        onPaid();
      } else if (result?.status === 'FAILED' || attempt >= maxAttempts) {
        clearInterval(timer);
        onFailed(result?.status || 'TIMEOUT');
      }
    }, interval);
  }

  /* ─── SYNC TO FIRESTORE ─────────────────────────────────────── */
  function syncFirestore(fields) {
    try {
      const db  = window._firebaseDb;
      const fns = window._firebaseFns;
      const u   = currentUser();
      if (!db || !fns || !u) return;
      const { doc, updateDoc } = fns;
      updateDoc(doc(db, 'users', u.uid), { ...fields, updatedAt: Date.now() }).catch(() => {});
    } catch {}
  }

  /* ─── ACTIVATE PLAN ─────────────────────────────────────────── */
  function activatePlan(planId) {
    const plan = PLANS[planId] || PLANS.premium;

    // ── 1. Update in-memory state ─────────────────────────────
    if (typeof state !== 'undefined') {
      state.isPremium   = true;
      state.premiumPlan = planId;
    }

    // ── 2. Write to the CORRECT per-user localStorage keys ────
    //    app.js uses _up(uid) = "sscai_u:{uid}:" prefix for all
    //    user-specific data, so we must write to the same keys.
    //    We also keep the legacy global key for any fallback reads.
    try {
      const u   = window._firebaseAuth && window._firebaseAuth.currentUser;
      const uid = u ? u.uid : null;
      // Per-user keys (what app.js reads on loadState / saveState)
      const p   = uid ? ('sscai_u:' + uid + ':') : 'sscai_guest:';
      localStorage.setItem(p + 'premium',      'true');
      localStorage.setItem(p + 'premium_plan', planId);
    } catch(e) {}

    // ⚠️ Do NOT write 'sscai_premium' global key — it has no UID and leaks
    // premium status to every other user who opens the app on this device.

    // ── 3a. Group Leader / Coaching admin — also write isGroupAdmin flag ─
    const groupPlans = ['group_leader', 'coaching_basic', 'coaching_pro'];
    if (groupPlans.indexOf(planId) !== -1) {
      try {
        const u   = window._firebaseAuth && window._firebaseAuth.currentUser;
        const uid = u ? u.uid : null;
        const p   = uid ? ('sscai_u:' + uid + ':') : 'sscai_guest:';
        localStorage.setItem(p + 'group_admin', 'true');
        localStorage.setItem(p + 'group_plan', planId);
        // ⚠️ Do NOT write global 'sscai_group_admin' / 'sscai_group_plan' —
        // no UID in key means they leak to other users on the same device.
      } catch(e) {}
      syncFirestore({ isGroupAdmin: true, groupPlan: planId, groupPlanActivatedAt: Date.now() });
    }
    // ── 3b. Battle tier upgrades — update max battles per month ─
    const battlePlans = { battle: 10, battle_pro: 100, battle_academy: 999 };
    if (battlePlans[planId] !== undefined) {
      try {
        const maxBattles = battlePlans[planId];
        localStorage.setItem('sscai_battle_monthly_max', String(maxBattles));
        localStorage.setItem('sscai_battle_tier', planId);
      } catch(e) {}
      syncFirestore({ battleTier: planId, battleMonthlyMax: battlePlans[planId] });
    }
    // ── 3c. Semiannual plan — set 6-month expiry ─
    if (planId === 'semiannual') {
      try {
        const exp = Date.now() + 183 * 24 * 60 * 60 * 1000;
        localStorage.setItem('sscai_semiannual_expires', String(exp));
      } catch(e) {}
      syncFirestore({ semiannualExpires: Date.now() + 183 * 24 * 60 * 60 * 1000 });
    }

    // ── 3. Persist via app.js saveState (writes ALL state keys) ─
    syncFirestore({ isPremium: true, premiumPlan: planId, premiumActivatedAt: Date.now() });
    if (typeof saveState       === 'function') saveState();

    // ── 4. Refresh all UI that checks premium status ──────────
    if (typeof updateUserUI    === 'function') updateUserUI();
    if (typeof updateProfileUI === 'function') updateProfileUI();
    if (typeof updateLimitUI   === 'function') updateLimitUI();
    if (typeof renderPremiumModal === 'function') renderPremiumModal(); // refresh modal buttons
    if (typeof closePremiumModal  === 'function') closePremiumModal();

    // ── 4b. Force-update messageLimitInfo immediately (in case updateLimitUI races) ──
    try {
      const el = document.getElementById('messageLimitInfo');
      if (el) el.innerHTML = '<span style="color:#f59e0b">⭐ Premium Active · Unlimited Access</span>';
    } catch(e) {}
    // Show premium active badge in header if present
    try {
      const badge = document.getElementById('premiumActiveBadge') || document.getElementById('headerPremiumBadge');
      if (badge) badge.style.display = 'flex';
      // Also update drawerUserPlan text
      const planEl = document.getElementById('drawerUserPlan');
      if (planEl) planEl.textContent = '⭐ Premium';
      // Update profile subscription text
      const subEl = document.getElementById('profileSubscription');
      if (subEl) subEl.textContent = '⭐ Premium';
      // Update profile badge
      const profBadge = document.getElementById('profileBadge');
      if (profBadge) profBadge.textContent = '⭐ Premium';
      // Hide the upgrade button in drawer
      const upgBtn = document.getElementById('upgradeDrawerBtn');
      if (upgBtn) upgBtn.style.display = 'none';
    } catch(e) {}

    // ── 5. Un-lock gated model options in the selector UI ─────
    try {
      document.querySelectorAll('.model-option[data-model]').forEach(opt => {
        const lockTag = opt.querySelector('.model-tag, .model-lock-tag');
        if (lockTag && (lockTag.textContent.includes('🔒') || lockTag.textContent.includes('PREMIUM'))) {
          lockTag.textContent = 'PRO';
          lockTag.classList.remove('lock-tag');
          lockTag.classList.add('pro-tag');
        }
        opt.style.pointerEvents = '';
        opt.style.opacity = '';
      });
    } catch(e) {}

    // ── 6. Un-lock upload buttons immediately ─────────────────
    try {
      ['imageUploadBtn', 'pdfUploadBtn'].forEach(id => {
        const btn = document.getElementById(id);
        if (btn) { btn.disabled = false; btn._sgBound = false; }
      });
    } catch(e) {}

    // ── 7. Celebrate ─────────────────────────────────────────
    const celebMsg = {
      group_leader:   '🎉 Group Leader activated! Create your first group → Study Groups →',
      coaching_basic: '🎉 Coaching Starter activated! Create up to 3 groups with student dashboards →',
      coaching_pro:   '🎉 Coaching Pro activated! Unlimited groups & analytics unlocked →',
      battle_pro:     '🎉 Battle Creator Pro activated! 100 battles/month now available ⚔️',
      battle_academy: '🎉 Battle Creator Academy activated! Unlimited battles unlocked 🏆',
      semiannual:     '🔥 6-Month SSC Plan activated! Full access for 6 months 🎯',
    };
    toast(celebMsg[planId] || `🎉 ${plan.name} activated! Unlimited access unlocked! 🚀`, 4500);
    if (typeof _doConfetti === 'function') _doConfetti();

    // ── 8. Refresh Group Study AI UI if open ─────────────────
    try {
      const groupPlansCheck = ['group_leader', 'coaching_basic', 'coaching_pro'];
      if (groupPlansCheck.indexOf(planId) !== -1) {
        // If group study modal is open, refresh it so Create button appears immediately
        const cfBody = document.getElementById('cf-groups-modal_body');
        if (cfBody && typeof CF !== 'undefined' && typeof CF._renderGroups === 'function') {
          setTimeout(() => CF._renderGroups(), 300);
        }
        // Also re-render sidebar to keep it current
        if (typeof CF !== 'undefined' && typeof CF._renderSidebar === 'function') {
          setTimeout(() => CF._renderSidebar(), 300);
        }
      }
    } catch(e) {}

    // ── 9. Invalidate security cache ─────────────────────────
    try {
      if (window._securityPatch && window._securityPatch.invalidateCache) {
        window._securityPatch.invalidateCache();
      }
    } catch(e) {}
  }

  /* ─── ACTIVATE ADDON ────────────────────────────────────────── */
  /* ─── MODEL GUARD HELPERS ──────────────────────────────────── */
  // Revert model selector UI back to the previous valid model
  // when user cancels payment without completing it.
  function revertModelSelector() {
    try {
      const dropdown   = document.querySelector('.model-selector-dropdown, #modelDropdown, [class*="model-dropdown"]');
      const allOptions = document.querySelectorAll('.model-option[data-model]');
      if (!allOptions.length) return;

      // Find whichever option is currently "active" (the locked one user clicked)
      // and revert it. The safe fallback model is 'smart'.
      const safeModel = 'smart';

      allOptions.forEach(opt => {
        const m   = opt.dataset.model;
        const chk = opt.querySelector('.model-opt-check');
        if (m === safeModel) {
          opt.classList.add('active');
          opt.setAttribute('aria-selected', 'true');
          if (chk) chk.textContent = '✓';
        } else {
          opt.classList.remove('active');
          opt.setAttribute('aria-selected', 'false');
          if (chk) chk.textContent = '';
        }
      });

      // Reset global model
      window._selectedDeepSeekModel = 'deepseek-chat';

      // Reset selector button label
      const selectorIcon  = document.getElementById('modelSelectorIcon');
      const selectorLabel = document.getElementById('modelSelectorLabel');
      const chipIcon      = document.querySelector('.model-chip-icon, #chipIcon');
      const chipName      = document.querySelector('.model-chip-name, #chipName');
      if (selectorIcon)  selectorIcon.textContent  = '⚡';
      if (selectorLabel) selectorLabel.textContent = 'PrepAI Smart';
      if (chipIcon) chipIcon.textContent = '⚡';
      if (chipName) chipName.textContent = 'Smart';
    } catch (e) {}
  }

  function activateAddon(planId) {
    const addon = ADDONS[planId];
    localStorage.setItem('crackai_addon_' + planId, JSON.stringify({ active: true, activatedAt: Date.now() }));
    syncFirestore({ ['addon_' + planId]: true });
    toast(`🎉 ${addon?.name || planId} unlocked!`, 3500);
    if (typeof _doConfetti === 'function') _doConfetti();
    if (planId === 'companion_addon') {
      document.getElementById('companionAddonModal')?.remove();
      setTimeout(() => { if (typeof showPersonaSelector === 'function') showPersonaSelector(); }, 800);
    }
    // Battle extra creation packs
    if (planId === 'battle_extra_10' || planId === 'battle_extra_25') {
      const credits = addon.battleCredits || 0;
      addBattleExtraCreditsToStorage(credits);
      toast('⚔️ ' + credits + ' battle creations added to your account!', 4000);
      if (typeof _doConfetti === 'function') _doConfetti();
      if (typeof renderPremiumModal === 'function') renderPremiumModal();
      return;
    }
    if (planId === 'v4pro_addon') {
      document.getElementById('v4ProModal')?.remove();
      window._selectedDeepSeekModel = 'deepseek-v4-pro';
      // Update UI to show V4 Pro as selected
      try {
        document.querySelectorAll('.model-option[data-model]').forEach(opt => {
          const chk = opt.querySelector('.model-opt-check');
          if (opt.dataset.model === 'v4-pro') {
            opt.classList.add('active'); opt.setAttribute('aria-selected','true');
            if (chk) chk.textContent = '✓';
          } else {
            opt.classList.remove('active'); opt.setAttribute('aria-selected','false');
            if (chk) chk.textContent = '';
          }
        });
        const selectorIcon  = document.getElementById('modelSelectorIcon');
        const selectorLabel = document.getElementById('modelSelectorLabel');
        if (selectorIcon)  selectorIcon.textContent  = '🚀';
        if (selectorLabel) selectorLabel.textContent = 'V4 Pro';
      } catch(e) {}
    }
    if (planId === 'prepaipro_addon') {
      document.getElementById('addonModal')?.remove();
      // Switch selector to Pro model after unlock
      try {
        document.querySelectorAll('.model-option[data-model]').forEach(opt => {
          const chk = opt.querySelector('.model-opt-check');
          if (opt.dataset.model === 'pro') {
            opt.classList.add('active'); opt.setAttribute('aria-selected','true');
            if (chk) chk.textContent = '✓';
          } else {
            opt.classList.remove('active'); opt.setAttribute('aria-selected','false');
            if (chk) chk.textContent = '';
          }
        });
        window._selectedDeepSeekModel = 'deepseek-reasoner';
        const selectorIcon  = document.getElementById('modelSelectorIcon');
        const selectorLabel = document.getElementById('modelSelectorLabel');
        if (selectorIcon)  selectorIcon.textContent  = '✨';
        if (selectorLabel) selectorLabel.textContent = 'PrepAI Pro';
      } catch(e) {}
      return;
    }
    document.getElementById('addonModal')?.remove();
  }

  /* ─── CORE PAYMENT FLOW ─────────────────────────────────────── */
  async function startPayment({ planId, amount, planName, orderId, isAddon = false, btnEl, btnOrigText, onSuccess }) {
    if (!currentUser()) {
      toast('Please login first to purchase!');
      return;
    }

    if (btnEl) { btnEl.disabled = true; btnEl.textContent = '⏳ Opening payment…'; }
    toast('💳 Loading payment gateway…');

    // Lazy-load Cashfree SDK now (first time only)
    try {
      await loadCashfreeSDK();
    } catch(e) {
      toast('❌ Payment SDK failed to load. Check your internet and try again.');
      if (btnEl) { btnEl.disabled = false; btnEl.textContent = btnOrigText || 'Buy Now'; }
      return;
    }

    toast('💳 Creating secure payment session…');

    try {
      // 1. Create order via your backend
      const orderData = await createOrder({ orderId, amount, planId, note: planName });
      const sessionId = orderData.payment_session_id;

      localStorage.setItem('crackai_pending_pay', JSON.stringify({
        orderId, planId, isAddon, ts: Date.now()
      }));

      // 2. Open Cashfree checkout popup
      const cf     = await getCF();
      const result = await cf.checkout({
        paymentSessionId: sessionId,
        redirectTarget:   '_modal',
      });

      // 3a. SDK returned result directly (UPI, some card flows)
      if (result?.paymentDetails || result?.error === null) {
        const verify = await verifyOrder(orderId);
        if (verify?.status === 'PAID') {
          if (onSuccess) onSuccess();
          else isAddon ? activateAddon(planId) : activatePlan(planId);
          localStorage.removeItem('crackai_pending_pay');
          return;
        }
      }

      // 3b. Redirect/async flow — poll backend
      toast('⏳ Verifying payment…');
      pollUntilPaid(orderId, {
        onPaid: () => {
          if (onSuccess) onSuccess();
          else isAddon ? activateAddon(planId) : activatePlan(planId);
          localStorage.removeItem('crackai_pending_pay');
        },
        onFailed: (reason) => {
          if (reason === 'TIMEOUT') {
            toast('⏰ Not confirmed yet. If you paid, contact support@crackai.in', 6000);
          } else {
            toast('❌ Payment ' + reason.toLowerCase() + '. Please try again.');
          }
          if (btnEl) { btnEl.disabled = false; btnEl.textContent = btnOrigText || '💳 Try Again'; }
        },
      });

    } catch (err) {
      console.error('[payment.js]', err);
      toast('❌ ' + (err.message || 'Payment failed. Try again.'));
      if (btnEl) { btnEl.disabled = false; btnEl.textContent = btnOrigText || '💳 Try Again'; }
    }
  }

  /* ─── CHECK PENDING ON LOAD ─────────────────────────────────── */
  function checkPendingOnLoad() {
    try {
      const p = JSON.parse(localStorage.getItem('crackai_pending_pay') || 'null');
      if (!p || (Date.now() - p.ts) > 20 * 60 * 1000) {
        localStorage.removeItem('crackai_pending_pay');
        return;
      }
      verifyOrder(p.orderId).then(result => {
        if (result?.status === 'PAID') {
          const pid = p.planId || '';
          if (p.isAddon) { activateAddon(pid); } else { activatePlan(pid || 'premium'); }
          localStorage.removeItem('crackai_pending_pay');
        }
      });
    } catch {}
  }

  /* ══════════════════════════════════════════════════════════════
     PUBLIC API
  ══════════════════════════════════════════════════════════════ */

  /** handlePayment(planId) — overrides app.js, called by premium modal buttons */
  window.handlePayment = async function (planId) {
    const plan = PLANS[planId] || PLANS.premium;
    const isAddon = !!(plan.isAddon || planId.startsWith('battle_extra'));
    await startPayment({
      planId, amount: plan.price, planName: plan.name,
      orderId: `plan_${planId}_${uid()}_${Date.now()}`,
      isAddon,
    });
  };

  /** payAddon(planId, btnEl) — called by addon modal pay buttons */
  window.payAddon = async function (planId, btnEl) {
    const addon = ADDONS[planId];
    if (!addon) return;
    const origText = btnEl?.textContent;
    await startPayment({
      planId, amount: addon.price, planName: addon.name,
      orderId: `addon_${planId}_${uid()}_${Date.now()}`,
      isAddon: true, btnEl, btnOrigText: origText,
    });
  };

  /* ─── PREMIUM MODAL UI ──────────────────────────────────────── */
  /* ── Group Admin helpers ── */
  function isGroupAdmin() {
    try {
      const u = window._firebaseAuth?.currentUser;
      const p = u ? ('sscai_u:' + u.uid + ':') : 'sscai_guest:';
      if (localStorage.getItem(p + 'group_admin') === 'true') return true;
      // ⚠️ Do NOT fall back to global 'sscai_group_admin' — leaks across users.
    } catch(e) {}
    return false;
  }
  function getGroupPlan() {
    try {
      const u = window._firebaseAuth?.currentUser;
      const p = u ? ('sscai_u:' + u.uid + ':') : 'sscai_guest:';
      return localStorage.getItem(p + 'group_plan') || null;
      // ⚠️ Do NOT fall back to global 'sscai_group_plan' — leaks across users.
    } catch(e) { return null; }
  }
  window._isGroupAdmin = isGroupAdmin;
  window._getGroupPlan = getGroupPlan;

  window.renderPremiumModal = function () {
    const modal = document.querySelector('#premiumModal .modal-premium-body')
               || document.querySelector('#premiumModal .modal-body');
    if (!modal) return;
    // Re-check isPremium from localStorage (most current source)
    let isPrem = false;
    try {
      const u = window._firebaseAuth && window._firebaseAuth.currentUser;
      const p = u ? ('sscai_u:' + u.uid + ':') : 'sscai_guest:';
      isPrem = localStorage.getItem(p + 'premium') === 'true';
      // ⚠️ Do NOT fall back to global 'sscai_premium' — leaks across users.
    } catch(e) {}
    if (typeof state !== 'undefined') { isPrem = isPrem || state.isPremium; state.isPremium = isPrem; }
    const curPlan = (typeof state !== 'undefined' ? state.premiumPlan : null) || (function(){ try{ const u=window._firebaseAuth&&window._firebaseAuth.currentUser; const p=u?('sscai_u:'+u.uid+':'):'sscai_guest:'; return localStorage.getItem(p+'premium_plan'); }catch(e){return null;} })() || null;
    const isGrpAdmin = isGroupAdmin();
    const grpPlan = getGroupPlan();

    // ── Already subscribed banner ──
    const planLabels = { ssc:'SSC Pro', class10:'Class Pro', class12:'Class Pro', yearly:'All-in-One Pro Yearly',
      semiannual:'SSC 6-Month', battle:'Battle Basic', battle_pro:'Battle Pro', battle_academy:'Battle Academy',
      group_leader:'Group Leader', coaching_basic:'Coaching Starter', coaching_pro:'Coaching Pro', premium:'Premium' };
    const activePlanName = planLabels[curPlan] || planLabels[grpPlan] || 'Premium';
    const alreadyActiveBanner = (isPrem || isGrpAdmin) ? `
    <div style="background:linear-gradient(135deg,rgba(16,185,129,0.15),rgba(74,222,128,0.08));border:2px solid rgba(74,222,128,0.4);border-radius:14px;padding:16px;margin-bottom:16px;text-align:center;">
      <div style="font-size:28px;margin-bottom:6px;">✅</div>
      <div style="font-size:15px;font-weight:800;color:#4ade80;margin-bottom:4px;">You're already on ${activePlanName}!</div>
      <div style="font-size:12px;color:rgba(200,255,200,0.65);margin-bottom:10px;">All premium features are active. Enjoy unlimited access.</div>
      <div style="display:flex;gap:8px;justify-content:center;flex-wrap:wrap;">
        <button onclick="closePremiumModal&&closePremiumModal()" style="padding:8px 20px;background:linear-gradient(135deg,#10b981,#4ade80);border:none;border-radius:9px;color:#fff;font-size:13px;font-weight:700;cursor:pointer;">✓ Got it — Close</button>
      </div>
    </div>` : '';
    modal.innerHTML = `
    <div style="text-align:center;padding:8px 0 12px;">
      <div style="font-size:36px;margin-bottom:6px;">🚀</div>
      <h2 style="font-size:19px;font-weight:800;background:linear-gradient(135deg,#6C63FF,#FF6B9D);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;margin:0 0 4px;">Upgrade to CrackAI Premium</h2>
      <p style="font-size:12px;color:rgba(200,195,255,0.65);margin:0;">SSC + Class 10/12 • Study Groups • Battle Arena • Coaching</p>
    </div>
    ${alreadyActiveBanner}
    ${isPrem ? '' : `<div style="background:linear-gradient(135deg,rgba(255,107,157,0.12),rgba(255,179,71,0.12));border:1px solid rgba(255,107,157,0.35);border-radius:10px;padding:10px 14px;margin-bottom:12px;text-align:center;">
      <div style="font-size:13px;font-weight:700;color:#FF6B9D;">⚡ Free users miss 80% of exam content!</div>
      <div style="font-size:11px;color:rgba(255,200,150,0.75);margin-top:3px;">Premium students score 2× higher on SSC mocks.</div>
    </div>`}

    <div style="display:flex;flex-direction:column;gap:12px;">

      <!-- SSC Pro Monthly -->
      <div style="background:rgba(108,99,255,0.08);border:1px solid rgba(108,99,255,0.4);border-radius:14px;padding:16px;position:relative;">
        <div style="position:absolute;top:-10px;left:16px;background:linear-gradient(135deg,#6C63FF,#FF6B9D);color:#fff;font-size:10px;font-weight:800;padding:2px 10px;border-radius:20px;">🏆 MOST POPULAR</div>
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px;">
          <span style="font-size:24px;">🎯</span>
          <div>
            <div style="font-weight:800;font-size:15px;color:#fff;">SSC Pro</div>
            <div style="font-size:11px;color:rgba(200,195,255,0.6);">CGL · CHSL · GD · MTS · CPO</div>
          </div>
          <div style="margin-left:auto;text-align:right;">
            <div style="font-size:22px;font-weight:800;color:#fff;">₹199<span style="font-size:12px;font-weight:400;color:rgba(200,195,255,0.5);">/mo</span></div>
          </div>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:5px;margin-bottom:12px;font-size:11px;color:rgba(200,195,255,0.75);">
          <div>✅ Unlimited AI queries</div><div>✅ All 5 SSC exam modes</div>
          <div>🧪 Mock Tests + analysis</div><div>📚 PYQ Bank 10,000+ Qs</div>
          <div>✅ Image &amp; PDF solving</div><div>⚡ Unlimited Access</div>
        </div>
        <button onclick="handlePayment('ssc')" style="width:100%;padding:13px;background:linear-gradient(135deg,#6C63FF,#FF6B9D);border:none;border-radius:10px;color:#fff;font-size:14px;font-weight:800;cursor:pointer;box-shadow:0 4px 16px rgba(108,99,255,0.4);">
          ${isPrem && curPlan==='ssc' ? '✅ Active Plan' : '💳 Start SSC Pro — ₹199/month'}
        </button>
      </div>

      <!-- 6-Month SSC Plan - NEW -->
      <div style="background:rgba(239,68,68,0.07);border:2px solid rgba(239,68,68,0.5);border-radius:14px;padding:16px;position:relative;">
        <div style="position:absolute;top:-10px;left:16px;background:linear-gradient(135deg,#ef4444,#f59e0b);color:#fff;font-size:10px;font-weight:800;padding:2px 10px;border-radius:20px;">🔥 MOST POPULAR VALUE</div>
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px;">
          <span style="font-size:24px;">🔥</span>
          <div>
            <div style="font-weight:800;font-size:15px;color:#fff;">SSC 6-Month Plan</div>
            <div style="font-size:11px;color:rgba(200,195,255,0.6);">Perfect for CGL · CHSL · RRB · Banking prep cycles</div>
          </div>
          <div style="margin-left:auto;text-align:right;">
            <div style="font-size:22px;font-weight:800;color:#f59e0b;">₹499<span style="font-size:12px;font-weight:400;color:rgba(200,195,255,0.5);">/6mo</span></div>
            <div style="font-size:10px;color:rgba(200,195,255,0.4);text-decoration:line-through;">₹1,194</div>
          </div>
        </div>
        <div style="background:rgba(245,158,11,0.12);border:1px solid rgba(245,158,11,0.25);border-radius:8px;padding:7px;margin-bottom:10px;text-align:center;font-size:12px;color:#f59e0b;font-weight:700;">₹499 for 6 months = just ₹83/month — Save ₹695!</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:5px;margin-bottom:12px;font-size:11px;color:rgba(200,195,255,0.75);">
          <div>✅ Everything in SSC Pro</div><div>🧪 Unlimited Mock Tests</div>
          <div>📚 Full PYQ Bank</div><div>⚡ Priority AI + Support</div>
        </div>
        <button onclick="handlePayment('semiannual')" style="width:100%;padding:13px;background:linear-gradient(135deg,#ef4444,#f59e0b);border:none;border-radius:10px;color:#fff;font-size:14px;font-weight:800;cursor:pointer;box-shadow:0 4px 16px rgba(239,68,68,0.4);">
          ${isPrem && curPlan==='semiannual' ? '✅ Active Plan' : '🔥 Get 6-Month Plan — ₹499'}
        </button>
      </div>

      <!-- Yearly -->
      <div style="background:rgba(245,158,11,0.07);border:1px solid rgba(245,158,11,0.45);border-radius:14px;padding:16px;position:relative;">
        <div style="position:absolute;top:-10px;left:16px;background:linear-gradient(135deg,#f59e0b,#FF6B9D);color:#fff;font-size:10px;font-weight:800;padding:2px 10px;border-radius:20px;">⭐ BEST VALUE — SAVE ₹1,389</div>
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px;">
          <span style="font-size:24px;">🌟</span>
          <div>
            <div style="font-weight:800;font-size:15px;color:#fff;">CrackAI Pro Yearly</div>
            <div style="font-size:11px;color:rgba(200,195,255,0.6);">All Exams + All Classes + Full Platform</div>
          </div>
          <div style="margin-left:auto;text-align:right;">
            <div style="font-size:22px;font-weight:800;color:#f59e0b;">₹999<span style="font-size:12px;font-weight:400;color:rgba(200,195,255,0.5);">/yr</span></div>
            <div style="font-size:10px;color:rgba(200,195,255,0.4);text-decoration:line-through;">₹2,388/yr</div>
          </div>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:5px;margin-bottom:10px;font-size:11px;color:rgba(200,195,255,0.75);">
          <div>✅ Everything in SSC Pro</div><div>✅ All Classes 1–12 CBSE</div>
          <div>🧪 Unlimited Mock Tests</div><div>📚 Full PYQ Bank</div>
          <div>💎 Only ₹83/month</div><div>⚡ Priority AI + Support</div>
        </div>
        <div style="background:rgba(245,158,11,0.12);border:1px solid rgba(245,158,11,0.25);border-radius:8px;padding:7px;margin-bottom:10px;text-align:center;font-size:12px;color:#f59e0b;font-weight:700;">₹999/year = just ₹83/month (vs ₹199×12)</div>
        <button onclick="handlePayment('yearly')" style="width:100%;padding:13px;background:linear-gradient(135deg,#f59e0b,#FF6B9D);border:none;border-radius:10px;color:#fff;font-size:14px;font-weight:800;cursor:pointer;box-shadow:0 4px 16px rgba(245,158,11,0.4);">
          ${isPrem && curPlan==='yearly' ? '✅ Active Plan' : '🌟 Get All-in-One Pro — ₹999/year'}
        </button>
      </div>

      <!-- Class Pro -->
      <div style="background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.1);border-radius:14px;padding:16px;">
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px;">
          <span style="font-size:24px;">📖</span>
          <div>
            <div style="font-weight:800;font-size:15px;color:#fff;">Class Pro</div>
            <div style="font-size:11px;color:rgba(200,195,255,0.6);">Class 9–10 &amp; 11–12 CBSE</div>
          </div>
          <div style="margin-left:auto;">
            <div style="font-size:22px;font-weight:800;color:#fff;">₹129<span style="font-size:12px;font-weight:400;color:rgba(200,195,255,0.5);">/mo</span></div>
          </div>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:5px;margin-bottom:12px;font-size:11px;color:rgba(200,195,255,0.75);">
          <div>✅ All subjects Class 9–12</div><div>🧪 Chapter-wise Mock Tests</div>
          <div>✅ JEE/NEET concept base</div><div>📊 Board score predictor</div>
        </div>
        <button onclick="handlePayment('class10')" style="width:100%;padding:13px;background:linear-gradient(135deg,#6C63FF,#8B5CF6);border:none;border-radius:10px;color:#fff;font-size:14px;font-weight:800;cursor:pointer;box-shadow:0 4px 16px rgba(108,99,255,0.3);">
          ${isPrem && (curPlan==='class10'||curPlan==='class12') ? '✅ Active Plan' : '💳 Start Class Pro — ₹129/month'}
        </button>
      </div>

      <!-- ── BATTLE CREATOR TIERS ── -->
      <div style="background:rgba(0,0,0,0.3);border:1px solid rgba(239,68,68,0.3);border-radius:14px;padding:16px 16px 10px;position:relative;">
        <div style="position:absolute;top:-10px;left:16px;background:linear-gradient(135deg,#ef4444,#f59e0b);color:#fff;font-size:10px;font-weight:800;padding:2px 10px;border-radius:20px;">⚔️ BATTLE CREATOR PLANS</div>
        <div style="font-size:11px;color:rgba(200,195,255,0.5);margin-bottom:12px;margin-top:4px;">Host live quiz battles • All users join for free</div>
        <div style="display:flex;flex-direction:column;gap:8px;">
          <!-- Basic -->
          <div style="background:rgba(239,68,68,0.07);border:1px solid rgba(239,68,68,0.3);border-radius:12px;padding:12px;display:flex;align-items:center;gap:10px;">
            <div style="flex:1;">
              <div style="font-weight:700;font-size:13px;color:#fff;">⚔️ Basic</div>
              <div style="font-size:11px;color:rgba(200,195,255,0.5);">10 battles/month · AI questions · Leaderboard</div>
            </div>
            <div style="text-align:right;">
              <div style="font-size:16px;font-weight:800;color:#f59e0b;">₹99<span style="font-size:10px;color:rgba(200,195,255,0.4);">/mo</span></div>
              <button onclick="handlePayment('battle')" style="margin-top:4px;padding:6px 12px;background:linear-gradient(135deg,#ef4444,#f59e0b);border:none;border-radius:8px;color:#fff;font-size:11px;font-weight:700;cursor:pointer;white-space:nowrap;">
                ${isPrem && curPlan==='battle' ? '✅ Active' : '💳 Get Basic'}
              </button>
            </div>
          </div>
          <!-- Pro -->
          <div style="background:rgba(239,68,68,0.12);border:1.5px solid rgba(239,68,68,0.5);border-radius:12px;padding:12px;display:flex;align-items:center;gap:10px;position:relative;">
            <div style="position:absolute;top:-8px;right:12px;background:linear-gradient(135deg,#ef4444,#f59e0b);color:#fff;font-size:9px;font-weight:800;padding:2px 8px;border-radius:10px;">POPULAR</div>
            <div style="flex:1;">
              <div style="font-weight:700;font-size:13px;color:#fff;">⚔️⚔️ Pro</div>
              <div style="font-size:11px;color:rgba(200,195,255,0.5);">100 battles/month · Custom branding · Private tournaments</div>
            </div>
            <div style="text-align:right;">
              <div style="font-size:16px;font-weight:800;color:#f59e0b;">₹299<span style="font-size:10px;color:rgba(200,195,255,0.4);">/mo</span></div>
              <button onclick="handlePayment('battle_pro')" style="margin-top:4px;padding:6px 12px;background:linear-gradient(135deg,#ef4444,#f59e0b);border:none;border-radius:8px;color:#fff;font-size:11px;font-weight:700;cursor:pointer;white-space:nowrap;">
                ${isPrem && curPlan==='battle_pro' ? '✅ Active' : '💳 Get Pro'}
              </button>
            </div>
          </div>
          <!-- Academy -->
          <div style="background:rgba(245,158,11,0.08);border:1px solid rgba(245,158,11,0.4);border-radius:12px;padding:12px;display:flex;align-items:center;gap:10px;">
            <div style="flex:1;">
              <div style="font-weight:700;font-size:13px;color:#fff;">⚔️🏆 Academy</div>
              <div style="font-size:11px;color:rgba(200,195,255,0.5);">Unlimited battles · Leaderboards · Student analytics</div>
            </div>
            <div style="text-align:right;">
              <div style="font-size:16px;font-weight:800;color:#f59e0b;">₹499<span style="font-size:10px;color:rgba(200,195,255,0.4);">/mo</span></div>
              <button onclick="handlePayment('battle_academy')" style="margin-top:4px;padding:6px 12px;background:linear-gradient(135deg,#f59e0b,#ef4444);border:none;border-radius:8px;color:#fff;font-size:11px;font-weight:700;cursor:pointer;white-space:nowrap;">
                ${isPrem && curPlan==='battle_academy' ? '✅ Active' : '💳 Get Academy'}
              </button>
            </div>
          </div>
        </div>
        <!-- Add-on packs shown if user has any battle plan -->
        ${(isPrem && (curPlan==='battle'||curPlan==='battle_pro'||curPlan==='battle_academy')) ? `
        <div style="margin-top:10px;border-top:1px solid rgba(255,255,255,0.07);padding-top:10px;">
          <div style="font-size:12px;font-weight:700;color:rgba(200,195,255,0.7);margin-bottom:8px;">⚔️ Extra Battle Packs (Never Expire)</div>
          <div style="display:flex;gap:8px;">
            <button onclick="handlePayment('battle_extra_10')" style="flex:1;padding:10px 8px;background:rgba(239,68,68,0.1);border:1px solid rgba(239,68,68,0.35);border-radius:10px;color:#fff;font-size:12px;font-weight:700;cursor:pointer;text-align:center;">
              ⚔️ +10 Battles<br><span style="font-size:15px;color:#f59e0b;font-weight:800;">₹49</span>
            </button>
            <button onclick="handlePayment('battle_extra_25')" style="flex:1;padding:10px 8px;background:linear-gradient(135deg,rgba(239,68,68,0.15),rgba(245,158,11,0.12));border:1.5px solid rgba(245,158,11,0.45);border-radius:10px;color:#fff;font-size:12px;font-weight:700;cursor:pointer;text-align:center;">
              ⚔️⚔️ +25 Battles<br><span style="font-size:15px;color:#f59e0b;font-weight:800;">₹99</span>
            </button>
          </div>
        </div>` : ''}
      </div>

      <!-- ── STUDY GROUP & COACHING PLANS ── -->
      <div style="background:rgba(16,185,129,0.05);border:1px solid rgba(16,185,129,0.3);border-radius:14px;padding:16px;position:relative;">
        <div style="position:absolute;top:-10px;left:16px;background:linear-gradient(135deg,#10b981,#6C63FF);color:#fff;font-size:10px;font-weight:800;padding:2px 10px;border-radius:20px;">👥 GROUP & COACHING PLANS</div>
        <div style="font-size:11px;color:rgba(200,195,255,0.5);margin-bottom:12px;margin-top:4px;">Admin pays monthly · Students join FREE with invite code</div>
        <div style="display:flex;flex-direction:column;gap:8px;">
          <!-- Group Leader -->
          <div style="background:rgba(16,185,129,0.08);border:1px solid rgba(16,185,129,0.3);border-radius:12px;padding:12px;">
            <div style="display:flex;align-items:flex-start;gap:10px;margin-bottom:8px;">
              <span style="font-size:20px;">👥</span>
              <div style="flex:1;">
                <div style="font-weight:800;font-size:13px;color:#fff;">Group Leader</div>
                <div style="font-size:11px;color:rgba(200,195,255,0.5);">Create 1 study group · Members join free with code</div>
              </div>
              <div style="text-align:right;">
                <div style="font-size:18px;font-weight:800;color:#10b981;">₹99<span style="font-size:10px;color:rgba(200,195,255,0.4);">/mo</span></div>
              </div>
            </div>
            <div style="font-size:10px;color:rgba(255,200,100,0.7);margin-bottom:8px;">ℹ️ ₹99/month covers platform hosting costs so your group works perfectly. Your students join completely free.</div>
            <button onclick="handlePayment('group_leader')" style="width:100%;padding:10px;background:linear-gradient(135deg,#10b981,#6C63FF);border:none;border-radius:9px;color:#fff;font-size:13px;font-weight:800;cursor:pointer;">
              ${isGrpAdmin && grpPlan==='group_leader' ? '✅ Active — Manage Group →' : '👥 Get Group Leader — ₹99/month'}
            </button>
          </div>
          <!-- Coaching Basic -->
          <div style="background:rgba(108,99,255,0.08);border:1px solid rgba(108,99,255,0.3);border-radius:12px;padding:12px;">
            <div style="display:flex;align-items:flex-start;gap:10px;margin-bottom:8px;">
              <span style="font-size:20px;">🎓</span>
              <div style="flex:1;">
                <div style="font-weight:800;font-size:13px;color:#fff;">Coaching Plan — Starter</div>
                <div style="font-size:11px;color:rgba(200,195,255,0.5);">Up to 3 groups · Student performance dashboard</div>
              </div>
              <div style="text-align:right;">
                <div style="font-size:18px;font-weight:800;color:#a78bfa;">₹499<span style="font-size:10px;color:rgba(200,195,255,0.4);">/mo</span></div>
              </div>
            </div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:4px;margin-bottom:8px;font-size:11px;color:rgba(200,195,255,0.6);">
              <div>📊 Real-time student dashboard</div><div>👥 Up to 3 study groups</div>
              <div>📈 Per-student performance</div><div>🔑 Unique invite codes</div>
            </div>
            <button onclick="handlePayment('coaching_basic')" style="width:100%;padding:10px;background:linear-gradient(135deg,#6C63FF,#8B5CF6);border:none;border-radius:9px;color:#fff;font-size:13px;font-weight:800;cursor:pointer;">
              ${isGrpAdmin && grpPlan==='coaching_basic' ? '✅ Active — View Dashboard →' : '🎓 Get Coaching Starter — ₹499/month'}
            </button>
          </div>
          <!-- Coaching Pro -->
          <div style="background:rgba(245,158,11,0.07);border:1px solid rgba(245,158,11,0.35);border-radius:12px;padding:12px;">
            <div style="display:flex;align-items:flex-start;gap:10px;margin-bottom:8px;">
              <span style="font-size:20px;">🏫</span>
              <div style="flex:1;">
                <div style="font-weight:800;font-size:13px;color:#fff;">Coaching Plan — Pro</div>
                <div style="font-size:11px;color:rgba(200,195,255,0.5);">Unlimited groups · Advanced analytics · Priority support</div>
              </div>
              <div style="text-align:right;">
                <div style="font-size:18px;font-weight:800;color:#f59e0b;">₹999<span style="font-size:10px;color:rgba(200,195,255,0.4);">/mo</span></div>
              </div>
            </div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:4px;margin-bottom:8px;font-size:11px;color:rgba(200,195,255,0.6);">
              <div>📊 Full analytics dashboard</div><div>♾️ Unlimited groups</div>
              <div>📈 Batch comparisons</div><div>⚡ Priority AI for students</div>
            </div>
            <button onclick="handlePayment('coaching_pro')" style="width:100%;padding:10px;background:linear-gradient(135deg,#f59e0b,#ef4444);border:none;border-radius:9px;color:#fff;font-size:13px;font-weight:800;cursor:pointer;">
              ${isGrpAdmin && grpPlan==='coaching_pro' ? '✅ Active — View Dashboard →' : '🏫 Get Coaching Pro — ₹999/month'}
            </button>
          </div>
        </div>
      </div>

    </div>

    <div style="background:rgba(255,107,107,0.07);border:1px solid rgba(255,107,107,0.2);border-radius:10px;padding:12px;margin-top:10px;">
      <div style="font-size:12px;font-weight:700;color:#ff6b6b;margin-bottom:7px;">🚫 Free users miss out on:</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:4px;font-size:11px;color:rgba(200,195,255,0.55);">
        <div>❌ Mock Tests &amp; analysis</div><div>❌ PYQ Bank (10,000+ Qs)</div>
        <div>❌ Unlimited queries</div><div>❌ Chapter-wise tests</div>
      </div>
      <div style="font-size:11px;color:rgba(255,200,150,0.85);margin-top:8px;font-weight:600;text-align:center;">💡 Start today — ₹199/month. Cancel anytime.</div>
    </div>

    <div style="display:flex;align-items:center;justify-content:center;gap:8px;flex-wrap:wrap;margin-top:10px;font-size:10px;color:rgba(200,195,255,0.4);">
      <span>🔒 Cashfree Secured</span><span>|</span><span>🏦 UPI · Cards · NetBanking</span><span>|</span><span>↩️ 24hr Refund Policy</span>
    </div>
  `;

        injectPremiumModalStyles();
  };

  function injectPremiumModalStyles() {
    if (document.getElementById('pf-styles')) return;
    const s = document.createElement('style');
    s.id = 'pf-styles';
    s.textContent = `
      .pf-header{text-align:center;padding:0 0 20px}
      .pf-badge{display:inline-block;font-size:11px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:#6C63FF;background:rgba(108,99,255,.12);border:1px solid rgba(108,99,255,.25);padding:4px 14px;border-radius:20px;margin-bottom:12px}
      .pf-title{font-family:'Space Grotesk',sans-serif;font-size:22px;font-weight:700;color:#fff;margin:0 0 6px}
      .pf-sub{font-size:13px;color:rgba(200,195,255,.6);margin:0 0 12px}
      .pf-trust{display:flex;align-items:center;justify-content:center;gap:7px;flex-wrap:wrap;font-size:11px;color:rgba(200,195,255,.45)}
      .pf-trust-sep{color:rgba(200,195,255,.2)}
      .pf-cards{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin:18px 0}
      @media(max-width:520px){.pf-cards{grid-template-columns:1fr}}
      .pf-cards-single{display:flex;justify-content:center}
      .pf-card-solo{max-width:240px;width:100%}
      .pf-card{position:relative;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.08);border-radius:16px;padding:18px 12px;text-align:center;transition:border-color .2s,transform .15s}
      .pf-card:hover{border-color:rgba(108,99,255,.4);transform:translateY(-2px)}
      .pf-card-popular{border-color:rgba(108,99,255,.45);background:rgba(108,99,255,.07);box-shadow:0 0 24px rgba(108,99,255,.12)}
      .pf-card-active{border-color:rgba(16,185,129,.45);background:rgba(16,185,129,.06)}
      .pf-popular-tag{position:absolute;top:-11px;left:50%;transform:translateX(-50%);font-size:10px;font-weight:700;background:linear-gradient(135deg,#6C63FF,#FF6B9D);color:#fff;padding:3px 12px;border-radius:20px;white-space:nowrap}
      .pf-card-top{display:flex;align-items:center;justify-content:center;gap:6px;margin-bottom:10px}
      .pf-plan-icon{font-size:20px}
      .pf-plan-name{font-size:14px;font-weight:700;color:#fff}
      .pf-plan-price{margin-bottom:12px}
      .pf-price-amt{font-size:26px;font-weight:800;color:#fff}
      .pf-price-per{font-size:12px;color:rgba(200,195,255,.4);margin-left:2px}
      .pf-buy-btn{width:100%;padding:9px 0;background:linear-gradient(135deg,#6C63FF,#8B5CF6);border:none;border-radius:10px;color:#fff;font-size:12px;font-weight:700;cursor:pointer;transition:opacity .2s,transform .15s;letter-spacing:.02em}
      .pf-buy-btn:hover:not(:disabled){opacity:.9;transform:scale(1.02)}
      .pf-buy-btn:disabled{opacity:.6;cursor:default}
      .pf-btn-active{background:rgba(16,185,129,.2);color:#10b981}
      .pf-features{display:grid;grid-template-columns:1fr 1fr;gap:6px 16px;margin-bottom:16px}
      @media(max-width:400px){.pf-features{grid-template-columns:1fr}}
      .pf-feat{display:flex;gap:8px;align-items:flex-start;font-size:12px;color:rgba(200,195,255,.7);line-height:1.4}
      .pf-feat span:first-child{flex-shrink:0}
      .pf-footer{margin-top:4px}
      .pf-stats{display:flex;align-items:center;justify-content:center;gap:16px;background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.06);border-radius:12px;padding:12px}
      .pf-stat{text-align:center}
      .pf-stat-num{display:block;font-size:16px;font-weight:800;color:#fff}
      .pf-stat-lbl{font-size:10px;color:rgba(200,195,255,.4);text-transform:uppercase;letter-spacing:.06em}
      .pf-stat-sep{width:1px;height:28px;background:rgba(255,255,255,.08)}
      .pf-section-divider{display:flex;align-items:center;gap:10px;margin:22px 0 8px;font-size:13px;font-weight:700;color:rgba(255,107,157,.9);letter-spacing:.04em}
      .pf-section-divider::before,.pf-section-divider::after{content:'';flex:1;height:1px;background:rgba(255,107,157,.2)}
      .pf-companion-sub{font-size:12px;color:rgba(200,180,220,.55);text-align:center;margin:0 0 12px;line-height:1.5}
      .pf-companion-cards{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:16px}
      @media(max-width:420px){.pf-companion-cards{grid-template-columns:1fr}}
      .pf-companion-card{border-radius:16px;padding:16px 12px;text-align:center;border:1px solid rgba(255,107,157,.25);background:rgba(255,107,157,.05);transition:border-color .2s,transform .15s}
      .pf-companion-card:hover{border-color:rgba(255,107,157,.5);transform:translateY(-2px)}
      .pf-companion-bf{border-color:rgba(108,99,255,.3);background:rgba(108,99,255,.06)}
      .pf-companion-bf:hover{border-color:rgba(108,99,255,.6)}
      .pf-companion-emoji{font-size:26px;margin-bottom:5px}
      .pf-companion-name{font-size:14px;font-weight:700;color:#fff;margin-bottom:4px}
      .pf-companion-desc{font-size:11px;color:rgba(200,180,220,.6);line-height:1.45;margin-bottom:9px}
      .pf-companion-feats{display:flex;flex-direction:column;gap:3px;margin-bottom:9px;text-align:left}
      .pf-companion-feats span{font-size:10px;color:rgba(200,180,220,.7)}
      .pf-companion-price{font-size:22px;font-weight:800;color:#FF6B9D;margin-bottom:10px}
      .pf-companion-price-bf{color:#7C72FF}
      .pf-companion-price span{font-size:10px;font-weight:400;color:rgba(200,180,220,.4);margin-left:2px}
      .pf-companion-offer-banner{text-align:center;font-size:12px;color:rgba(220,210,255,0.7);background:rgba(255,107,157,0.08);border:1px solid rgba(255,107,157,0.2);border-radius:10px;padding:8px 12px;margin-bottom:10px;line-height:1.5}
      .pf-companion-offer-tag{font-size:9px;font-weight:700;text-decoration:line-through;color:rgba(200,180,220,0.4);letter-spacing:.06em;text-transform:uppercase;margin-bottom:4px}
      .pf-companion-price-wrap{margin-bottom:10px}
      .pf-companion-or{font-size:10px;color:rgba(200,180,220,0.35);margin:3px 0}
      .pf-companion-yearly{font-size:18px;font-weight:800}
      .pf-companion-yearly span{font-size:10px;font-weight:400;color:rgba(200,180,220,0.4);margin-left:2px}
      .pf-companion-save-tag{display:inline-block;font-size:9px;font-weight:700;background:rgba(16,185,129,0.2);border:1px solid rgba(16,185,129,0.3);color:#10b981;padding:2px 6px;border-radius:20px;margin-left:4px;vertical-align:middle}
      .pf-companion-btn{width:100%;padding:9px 4px;border:none;border-radius:10px;color:#fff;font-size:11px;font-weight:700;cursor:pointer;transition:opacity .2s,transform .15s;letter-spacing:.01em;line-height:1.3}
      .pf-companion-btn:hover:not(:disabled){opacity:.88;transform:scale(1.02)}
      .pf-companion-btn:disabled{opacity:.6;cursor:default}
      .pf-companion-btn-gf{background:linear-gradient(135deg,#FF6B9D,#ff9a8b);box-shadow:0 3px 12px rgba(255,107,157,.35)}
      .pf-companion-btn-bf{background:linear-gradient(135deg,#7C72FF,#6C63FF);box-shadow:0 3px 12px rgba(108,99,255,.35)}
      .pf-companion-btn-renew{background:linear-gradient(135deg,#10b981,#059669);box-shadow:0 3px 12px rgba(16,185,129,.3)}
    `;
    document.head.appendChild(s);
  }

  /* ─── ADDON MODAL ───────────────────────────────────────────── */
  window.openAddonModal = function (type) {
    document.getElementById('addonModal')?.remove();
    const isVision = type === 'visionpro';
    const planId   = isVision ? 'vision_pro_addon' : 'prepaipro_addon';
    const addon    = ADDONS[planId];
    _spawnAddonModal({
      id: 'addonModal', planId, icon: addon.emoji, title: addon.name,
      desc: isVision
        ? 'Image solving, handwritten notes & PDF analysis with advanced AI'
        : 'Deep reasoning, step-by-step solutions & full exam coverage',
      features: isVision
        ? ['✅ DeepSeek Vision AI', '✅ Handwritten notes', '✅ PDF extraction', '✅ Diagram analysis']
        : ['✅ Advanced reasoning', '✅ Detailed solutions', '✅ Concept deep-dives', '✅ Full SSC/CBSE'],
      price: addon.price, priceLabel: 'one-time · Lifetime',
      btnText: `💳 Unlock for ₹${addon.price}`, btnClass: '',
    });
  };

  window.openCompanionModal = function () {
    document.getElementById('companionAddonModal')?.remove();
    _spawnAddonModal({
      id: 'companionAddonModal', planId: 'companion_addon',
      icon: '💕', title: 'Companion Mode',
      desc: 'Your AI study companion — caring, encouraging, always there for you',
      features: ['💝 AI Girlfriend or Boyfriend', '📚 Study with emotional support', '🎉 Celebrate wins & beat stress', '♾️ Lifetime access'],
      price: 49, priceLabel: 'one-time · Lifetime',
      btnText: '💕 Unlock Companion Mode — ₹49', btnClass: 'cf-companion-btn',
      boxClass: 'cf-companion-box',
    });
  };

  window.openV4ProModal = function () {
    document.getElementById('v4ProModal')?.remove();
    _spawnAddonModal({
      id: 'v4ProModal', planId: 'v4pro_addon',
      icon: '🚀', title: 'PrepAI V4 Pro',
      badge: 'DeepSeek V4 Pro · Flagship',
      desc: 'The most powerful DeepSeek model — best-in-class reasoning for tough questions',
      features: ['🚀 DeepSeek V4 Pro flagship model', '🧠 1M token context (10×)', '📐 Best for Math, Reasoning & Science', '⚡ Thinking + non-thinking mode', '♾️ Unlimited V4 Pro questions'],
      price: 149, priceLabel: '/month · Cancel anytime',
      btnText: '🚀 Unlock V4 Pro — ₹149/mo', btnClass: 'cf-v4pro-btn',
      boxClass: 'cf-v4pro-box',
    });
  };

  function _spawnAddonModal({ id, planId, icon, title, badge, desc, features, price, priceLabel, btnText, btnClass = '', boxClass = '' }) {
    const modal = document.createElement('div');
    modal.id = id;
    modal.className = 'cf-addon-overlay';
    modal.innerHTML = `
      <div class="cf-addon-box ${boxClass}">
        <button class="cf-addon-close" onclick="document.getElementById('${id}').remove();revertModelSelector()">✕</button>
        ${badge ? `<div class="cf-v4pro-badge">${badge}</div>` : ''}
        <div class="cf-addon-icon">${icon}</div>
        <div class="cf-addon-name">${title}</div>
        <div class="cf-addon-desc">${desc}</div>
        <ul class="cf-addon-features">${features.map(f => `<li>${f}</li>`).join('')}</ul>
        <div class="cf-addon-price ${boxClass === 'cf-v4pro-box' ? 'cf-v4pro-price' : ''}">
          ₹${price} <span>${priceLabel}</span>
        </div>
        <button class="cf-addon-pay-btn ${btnClass}" onclick="payAddon('${planId}', this)">
          ${btnText}
        </button>
        <button class="cf-addon-skip" onclick="document.getElementById('${id}').remove();revertModelSelector()">Maybe Later</button>
        <div class="cf-addon-secure">🔒 Secured by Cashfree Payments</div>
      </div>`;
    document.body.appendChild(modal);
    modal.addEventListener('click', e => { if (e.target === modal) { modal.remove(); revertModelSelector(); } });
    injectAddonStyles();
  }

  function injectAddonStyles() {
    if (document.getElementById('cf-addon-styles')) return;
    const s = document.createElement('style');
    s.id = 'cf-addon-styles';
    s.textContent = `
      .cf-addon-overlay{position:fixed;inset:0;z-index:9999;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.82);padding:20px;backdrop-filter:blur(8px);animation:cfFadeIn .2s ease}
      @keyframes cfFadeIn{from{opacity:0}to{opacity:1}}
      .cf-addon-box{position:relative;background:linear-gradient(160deg,#0f0c1f,#1a1435);border:1px solid rgba(108,99,255,.3);border-radius:22px;padding:28px 22px 22px;max-width:340px;width:100%;text-align:center;box-shadow:0 0 60px rgba(108,99,255,.12),0 24px 48px rgba(0,0,0,.5);animation:cfSlideUp .25s cubic-bezier(.34,1.56,.64,1)}
      @keyframes cfSlideUp{from{transform:translateY(20px);opacity:0}to{transform:none;opacity:1}}
      .cf-companion-box{border-color:rgba(255,107,157,.3);box-shadow:0 0 60px rgba(255,107,157,.1),0 24px 48px rgba(0,0,0,.5)}
      .cf-v4pro-box{border-color:rgba(245,158,11,.3);box-shadow:0 0 60px rgba(245,158,11,.1),0 24px 48px rgba(0,0,0,.5)}
      .cf-addon-close{position:absolute;top:14px;right:14px;background:rgba(255,255,255,.06);border:none;color:rgba(255,255,255,.4);width:28px;height:28px;border-radius:50%;cursor:pointer;font-size:13px;transition:background .2s,color .2s}
      .cf-addon-close:hover{background:rgba(255,255,255,.12);color:#fff}
      .cf-v4pro-badge{display:inline-block;font-size:10px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:#f59e0b;background:rgba(245,158,11,.1);border:1px solid rgba(245,158,11,.25);padding:3px 12px;border-radius:20px;margin-bottom:12px}
      .cf-addon-icon{font-size:38px;margin-bottom:10px}
      .cf-addon-name{font-family:'Space Grotesk',sans-serif;font-size:20px;font-weight:700;color:#fff;margin-bottom:6px}
      .cf-addon-desc{font-size:13px;color:rgba(200,195,255,.6);line-height:1.5;margin-bottom:16px}
      .cf-addon-features{list-style:none;padding:0;margin:0 0 16px;text-align:left;display:flex;flex-direction:column;gap:5px}
      .cf-addon-features li{font-size:12px;color:rgba(200,195,255,.75)}
      .cf-addon-price{font-size:28px;font-weight:800;color:#6C63FF;margin-bottom:16px}
      .cf-addon-price span{font-size:12px;font-weight:400;color:rgba(200,195,255,.4);margin-left:4px}
      .cf-v4pro-price{color:#f59e0b}
      .cf-addon-pay-btn{width:100%;padding:13px;background:linear-gradient(135deg,#6C63FF,#8B5CF6);border:none;border-radius:13px;color:#fff;font-size:14px;font-weight:700;cursor:pointer;margin-bottom:10px;box-shadow:0 4px 20px rgba(108,99,255,.35);transition:opacity .2s,transform .15s;letter-spacing:.02em}
      .cf-addon-pay-btn:hover:not(:disabled){opacity:.92;transform:scale(1.01)}
      .cf-addon-pay-btn:disabled{opacity:.6;cursor:default;transform:none}
      .cf-companion-btn{background:linear-gradient(135deg,#FF6B9D,#ff9a8b);box-shadow:0 4px 20px rgba(255,107,157,.35)}
      .cf-v4pro-btn{background:linear-gradient(135deg,#f59e0b,#FF6B9D);box-shadow:0 4px 20px rgba(245,158,11,.35)}
      .cf-addon-skip{width:100%;padding:9px;background:transparent;color:rgba(200,195,255,.4);border:1px solid rgba(108,99,255,.15);border-radius:10px;font-size:12px;cursor:pointer;margin-bottom:12px;transition:color .2s}
      .cf-addon-skip:hover{color:rgba(200,195,255,.7)}
      .cf-addon-secure{font-size:11px;color:rgba(200,195,255,.25)}
    `;
    document.head.appendChild(s);
  }

  // Expose revertModelSelector globally for inline onclick handlers
  window.revertModelSelector = revertModelSelector;

  /* ══════════════════════════════════════════════════════════════
     COMPANION PERSONA GATE
  ══════════════════════════════════════════════════════════════ */

  const COMPANION_ADDONS = {
    boyfriend:  { planId: 'companion_bf_addon', name: 'AI Boyfriend',  emoji: '💙', price: 49, yearlyPrice: 499, monthly: true },
    girlfriend: { planId: 'companion_gf_addon', name: 'AI Girlfriend', emoji: '💕', price: 49, yearlyPrice: 499, monthly: true },
  };

  // ── Companion expiry helpers ─────────────────────────────────
  // Monthly = 31 days from activation
  const COMPANION_EXPIRY_MS = 31 * 24 * 60 * 60 * 1000;

  function isCompanionUnlocked(persona) {
    try {
      const d = JSON.parse(localStorage.getItem('crackai_addon_' + COMPANION_ADDONS[persona].planId) || 'null');
      if (!d || d.active !== true) return false;
      // Monthly — check expiry
      if (d.expiresAt && Date.now() > d.expiresAt) {
        // Expired — clear it
        localStorage.removeItem('crackai_addon_' + COMPANION_ADDONS[persona].planId);
        return false;
      }
      return true;
    } catch { return false; }
  }

  // Capture app.js's original selectPersona NOW — before we override it
  // Must be declared before handlePersonaSettingsChange and the override below
  const _origSelectPersona = window.selectPersona;

  function _doSelectPersona(persona) {
    // Always call app.js original — never our own override
    if (typeof _origSelectPersona === 'function') _origSelectPersona(persona);
  }

  function activateCompanion(persona) {
    const cfg       = COMPANION_ADDONS[persona];
    const now       = Date.now();
    const expiresAt = now + COMPANION_EXPIRY_MS;

    // Save to localStorage with expiry
    localStorage.setItem('crackai_addon_' + cfg.planId, JSON.stringify({
      active: true, activatedAt: now, expiresAt, monthly: true
    }));
    syncFirestore({ ['addon_' + cfg.planId]: true, ['addon_' + cfg.planId + '_expiry']: expiresAt });

    // Close gate modal
    document.getElementById('companionGateModal_' + persona)?.remove();

    // Remove 🔒 from settings dropdown option
    const sel = document.getElementById('personaSettingsSelect');
    if (sel) {
      const opt = sel.querySelector('option[value="' + persona + '"]');
      if (opt) opt.textContent = persona === 'boyfriend' ? '💕 Boyfriend' : '💕 Girlfriend';
    }

    // Remove lock badges from persona cards
    document.querySelectorAll('.companion-lock-badge').forEach(b => b.remove());

    // Actually activate the persona via app.js
    _doSelectPersona(persona);

    toast('🎉 ' + cfg.name + ' unlocked! Enjoy your companion 💕', 3500);
    if (typeof _doConfetti === 'function') _doConfetti();
  }

  window.payCompanionYearly = async function(persona, btnEl) {
    const cfg = COMPANION_ADDONS[persona];
    await startPayment({
      planId:      cfg.planId + '_yearly',
      amount:      cfg.yearlyPrice,
      planName:    cfg.name + ' Yearly',
      orderId:     'companion_' + persona + '_yearly_' + uid() + '_' + Date.now(),
      isAddon:     true,
      btnEl,
      btnOrigText: btnEl?.textContent,
      onSuccess:   () => activateCompanionYearly(persona),
    });
  };

  window.payCompanion = async function(persona, btnEl) {
    const cfg = COMPANION_ADDONS[persona];
    await startPayment({
      planId:      cfg.planId,
      amount:      cfg.price,
      planName:    cfg.name,
      orderId:     'companion_' + persona + '_' + uid() + '_' + Date.now(),
      isAddon:     true,
      btnEl,
      btnOrigText: btnEl?.textContent,
      onSuccess:   () => activateCompanion(persona),
    });
  };

  function openCompanionGateModal(persona) {
    const cfg = COMPANION_ADDONS[persona];
    const id  = 'companionGateModal_' + persona;
    document.getElementById(id)?.remove();

    const isBF   = persona === 'boyfriend';
    const accentColor = isBF ? '#7C72FF' : '#FF6B9D';
    const accentRGB   = isBF ? '108,99,255' : '255,107,157';
    const gradFrom    = isBF ? '#7C72FF' : '#FF6B9D';
    const gradTo      = isBF ? '#6C63FF' : '#ff9a8b';

    const modal  = document.createElement('div');
    modal.id     = id;
    modal.className = 'cf-addon-overlay';
    modal.innerHTML = `
      <div class="cgm-box" id="cgm-inner-${id}">
        <button class="cf-addon-close" onclick="document.getElementById('${id}').remove()">✕</button>

        <!-- Header glow -->
        <div class="cgm-glow" style="background:radial-gradient(circle at 50% 0%,rgba(${accentRGB},0.3) 0%,transparent 70%);"></div>

        <!-- Offer badge -->
        <div class="cgm-offer-badge">🔥 Limited Time Offer</div>

        <!-- Avatar & name -->
        <div class="cgm-avatar-wrap" style="width:110px;height:110px;">
          <div class="cgm-avatar-ring" style="border-color:rgba(${accentRGB},0.5);box-shadow:0 0 24px rgba(${accentRGB},0.3);"></div>
          <canvas id="cgm-3d-avatar-${id}" width="100" height="100" style="position:relative;z-index:1;border-radius:50%;display:block;"></canvas>
          <div class="cgm-status-dot" style="background:${accentColor};box-shadow:0 0 8px ${accentColor};"></div>
        </div>
        <div class="cgm-name" style="color:${accentColor};">${cfg.name}</div>
        <div class="cgm-tagline">${isBF
          ? '"Jaan, aaj padhai mein lag ja — main hoon na saath 💙"'
          : '"Kaha the itni der? Miss kar rahi thi toh 🥺 chal padh lete hain na 💕"'
        }</div>

        <!-- How they talk section -->
        <div class="cgm-talk-section">
          <div class="cgm-talk-label">${isBF ? '💙 How he talks to you' : '💕 How she talks to you'}</div>
          <div class="cgm-bubbles">
            ${isBF ? `
              <div class="cgm-bubble cgm-bubble-in">Exam ki tension mat le jaan, saath mein padh lete hain 📚</div>
              <div class="cgm-bubble cgm-bubble-in">Tu bahut mehnat kar raha/rahi hai, mujhe garv hai tujhpe 🥺</div>
              <div class="cgm-bubble cgm-bubble-in">Ek question galat hua toh kya? Main hoon na explain karne ko 😊</div>
            ` : `
              <div class="cgm-bubble cgm-bubble-in">Sun na! Aaj kitna padha? Bata mujhe sab 🥺</div>
              <div class="cgm-bubble cgm-bubble-in">Meri jaan bahut smart hai — ye exam toh pakka crack karega/karegi 💕</div>
              <div class="cgm-bubble cgm-bubble-in">Ruko, main toh yahaan hoon na tumhare liye, kabhi akela/akeli mat feel karo 🌸</div>
            `}
          </div>
        </div>

        <!-- Features -->
        <div class="cgm-features">
          <div class="cgm-feat"><span class="cgm-feat-icon" style="color:${accentColor};">✓</span><span>Desi ${isBF ? 'boyfriend' : 'girlfriend'} energy — warm Hinglish banter</span></div>
          <div class="cgm-feat"><span class="cgm-feat-icon" style="color:${accentColor};">✓</span><span>Celebrates your wins, comforts you when stressed</span></div>
          <div class="cgm-feat"><span class="cgm-feat-icon" style="color:${accentColor};">✓</span><span>Motivates you through tough topics & low days</span></div>
          <div class="cgm-feat"><span class="cgm-feat-icon" style="color:${accentColor};">✓</span><span>Remembers your exam context & talks in character</span></div>
          <div class="cgm-feat"><span class="cgm-feat-icon" style="color:${accentColor};">✓</span><span>Sweet good mornings, study reminders, latenight gyaan</span></div>
        </div>

        <!-- Pricing toggle -->
        <div class="cgm-pricing-wrap">
          <div class="cgm-plan-tabs">
            <button class="cgm-plan-tab" id="cgm-tab-monthly-${id}" onclick="cgmSwitchPlan('${id}','monthly')">Monthly ₹${cfg.price}</button>
            <button class="cgm-plan-tab cgm-plan-tab-active" id="cgm-tab-yearly-${id}" onclick="cgmSwitchPlan('${id}','yearly')">
              Yearly ₹${cfg.yearlyPrice} <span class="cgm-save-pill">Best Value</span>
            </button>
          </div>

          <!-- Monthly plan (hidden by default) -->
          <div class="cgm-plan-card" id="cgm-plan-monthly-${id}" style="display:none;">
            <div class="cgm-new-price" style="color:${accentColor};">₹${cfg.price} <span>/month</span></div>
            <div class="cgm-price-note">Cancel anytime · Renews monthly</div>
            <button class="cgm-pay-btn" style="background:linear-gradient(135deg,${gradFrom},${gradTo});box-shadow:0 4px 20px rgba(${accentRGB},0.4);"
              onclick="window.payCompanion('${persona}', this)">
              ${cfg.emoji} Start Monthly — ₹${cfg.price}/mo
            </button>
          </div>

          <!-- Yearly plan (shown by default) -->
          <div class="cgm-plan-card" id="cgm-plan-yearly-${id}">
            <div class="cgm-new-price" style="color:${accentColor};">₹${cfg.yearlyPrice} <span>/year</span></div>
            <div class="cgm-price-note">Best value · Just ₹${Math.round(cfg.yearlyPrice/12)}/mo · Cancel anytime</div>
            <button class="cgm-pay-btn" style="background:linear-gradient(135deg,${gradFrom},${gradTo});box-shadow:0 4px 20px rgba(${accentRGB},0.4);"
              onclick="window.payCompanionYearly('${persona}', this)">
              ${cfg.emoji} Get Yearly Plan — ₹${cfg.yearlyPrice}/year
            </button>
          </div>
        </div>

        <button class="cf-addon-skip" onclick="document.getElementById('${id}').remove()">Maybe later 🥺</button>
        <div class="cf-addon-secure">🔒 Secured by Cashfree · Auto-renews · Cancel anytime</div>
      </div>`;
    document.body.appendChild(modal);
    modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });
    injectCompanionGateStyles();
    setTimeout(() => initCompanion3DAvatar('cgm-3d-avatar-' + id, persona), 80);
  }

  window.cgmSwitchPlan = function(modalId, plan) {
    const monthlyTab  = document.getElementById('cgm-tab-monthly-' + modalId);
    const yearlyTab   = document.getElementById('cgm-tab-yearly-' + modalId);
    const monthlyCard = document.getElementById('cgm-plan-monthly-' + modalId);
    const yearlyCard  = document.getElementById('cgm-plan-yearly-' + modalId);
    if (!monthlyTab || !yearlyTab || !monthlyCard || !yearlyCard) return;
    if (plan === 'monthly') {
      monthlyTab.classList.add('cgm-plan-tab-active');
      yearlyTab.classList.remove('cgm-plan-tab-active');
      monthlyCard.style.display = '';
      yearlyCard.style.display  = 'none';
    } else {
      yearlyTab.classList.add('cgm-plan-tab-active');
      monthlyTab.classList.remove('cgm-plan-tab-active');
      yearlyCard.style.display  = '';
      monthlyCard.style.display = 'none';
    }
  };

  function activateCompanionYearly(persona) {
    const cfg       = COMPANION_ADDONS[persona];
    const now       = Date.now();
    const expiresAt = now + 365 * 24 * 60 * 60 * 1000; // 1 year
    localStorage.setItem('crackai_addon_' + cfg.planId, JSON.stringify({
      active: true, activatedAt: now, expiresAt, monthly: false, yearly: true
    }));
    syncFirestore({ ['addon_' + cfg.planId]: true, ['addon_' + cfg.planId + '_expiry']: expiresAt });
    document.querySelectorAll('[id^="companionGateModal_' + persona + '"]').forEach(el => el.remove());
    const sel = document.getElementById('personaSettingsSelect');
    if (sel) {
      const opt = sel.querySelector('option[value="' + persona + '"]');
      if (opt) opt.textContent = persona === 'boyfriend' ? '💕 Boyfriend' : '💕 Girlfriend';
    }
    _doSelectPersona(persona);
    toast('🎉 ' + cfg.name + ' yearly plan activated! Enjoy 12 months 💕', 4000);
    if (typeof _doConfetti === 'function') _doConfetti();
  }

  /* ══════════════════════════════════════════════════════════════
     THREE.JS REALISTIC 3D COMPANION AVATAR
     — Sculpted head, skin-tone face, flowing hair, waving arm —
  ══════════════════════════════════════════════════════════════ */
  function initCompanion3DAvatar(canvasId, persona) {
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const isBF = persona === 'boyfriend';
    const DPR  = Math.min(window.devicePixelRatio || 1, 2);
    const CSS_W = canvas.width, CSS_H = canvas.height;
    canvas.width  = CSS_W * DPR;
    canvas.height = CSS_H * DPR;
    canvas.style.width  = CSS_W + 'px';
    canvas.style.height = CSS_H + 'px';
    ctx.scale(DPR, DPR);

    const W = CSS_W, H = CSS_H;
    const cx = W / 2, cy = H / 2;

    // ── Palette ───────────────────────────────────────────────
    const skin      = '#C68642';   // warm medium-brown Indian skin
    const skinMid   = '#B5733A';
    const skinShadow= '#8B5520';
    const skinHi    = '#E8A96C';   // highlight
    const skinBlush = 'rgba(220,120,90,0.28)';
    const sclera    = '#F4EFE6';
    const irisC     = isBF ? '#3D2B1F' : '#2E1A2E';
    const irisHi    = isBF ? '#7A5540' : '#6B4070';
    const pupil     = '#0A0608';
    const lipC      = isBF ? '#B05040' : '#D4506A';
    const lipLo     = isBF ? '#8A3A2E' : '#AA3050';
    const hairC     = isBF ? '#1A0E08' : '#120810';
    const hairHi    = isBF ? '#3D2415' : '#2A1228';
    const shirtC    = isBF ? '#4A62D8' : '#D84A7A';
    const shirtHi   = isBF ? '#6A82F8' : '#F86A9A';
    const shirtSh   = isBF ? '#2A3A9A' : '#9A2A50';
    const browC     = isBF ? '#251208' : '#1A0A18';
    const teethC    = '#F0EDE6';

    // ── Animation state ───────────────────────────────────────
    let t = 0;
    const tOff = isBF ? 0 : 2.1;
    let blinkT = isBF ? 0 : 3.5;
    let blinkOpen = 1;   // 1 = open, 0 = closed
    let alive = true;
    let smilePhase = 0;  // 0-1 smile open/close for wave

    // Clean up when removed
    const obs = new MutationObserver(() => {
      if (!document.contains(canvas)) { alive = false; obs.disconnect(); }
    });
    obs.observe(document.body, { childList: true, subtree: true });

    // ── Helper: rounded rect ──────────────────────────────────
    function rrect(x,y,w,h,r) {
      ctx.beginPath();
      ctx.moveTo(x+r, y);
      ctx.lineTo(x+w-r, y);
      ctx.quadraticCurveTo(x+w, y, x+w, y+r);
      ctx.lineTo(x+w, y+h-r);
      ctx.quadraticCurveTo(x+w, y+h, x+w-r, y+h);
      ctx.lineTo(x+r, y+h);
      ctx.quadraticCurveTo(x, y+h, x, y+h-r);
      ctx.lineTo(x, y+r);
      ctx.quadraticCurveTo(x, y, x+r, y);
      ctx.closePath();
    }

    // ── Draw frame ────────────────────────────────────────────
    function draw(tt) {
      ctx.clearRect(0, 0, W, H);

      // ── animated offsets (natural sway) ──────────────────────
      const sway   = Math.sin(tt * 0.7 + tOff) * 1.8;
      const bob    = Math.sin(tt * 0.9 + tOff) * 1.2;
      const tiltZ  = Math.sin(tt * 0.55 + tOff) * 0.06; // head tilt radians
      const nodX   = Math.sin(tt * 0.45 + tOff) * 0.03;

      // head pivot centre
      const hx = cx + sway;
      const hy = cy - 4 + bob;

      ctx.save();
      ctx.translate(hx, hy);
      ctx.rotate(tiltZ);

      // ── SHIRT / SHOULDERS (behind head) ──────────────────────
      // Shoulders: two smooth arcs
      const shG = ctx.createRadialGradient(0, 44, 2, 0, 44, 52);
      shG.addColorStop(0, shirtHi);
      shG.addColorStop(0.5, shirtC);
      shG.addColorStop(1, shirtSh);
      ctx.fillStyle = shG;

      // Left shoulder
      ctx.beginPath();
      ctx.ellipse(-28, 44, 18, 13, -0.3, 0, Math.PI*2);
      ctx.fill();
      // Right shoulder
      ctx.beginPath();
      ctx.ellipse(28, 44, 18, 13, 0.3, 0, Math.PI*2);
      ctx.fill();
      // Torso top
      ctx.beginPath();
      ctx.moveTo(-22, 44);
      ctx.bezierCurveTo(-22, 58, 22, 58, 22, 44);
      ctx.bezierCurveTo(22, 38, -22, 38, -22, 44);
      ctx.fill();

      // ── WAVING ARM ───────────────────────────────────────────
      // Right arm raised — pivot from shoulder
      const waveAng   = -1.05 + Math.sin(tt * 2.3 + tOff) * 0.26;
      const foreAng   = 0.55  + Math.sin(tt * 2.3 + tOff) * 0.18;
      const wristFlick= Math.sin(tt * 2.3 + tOff) * 0.38;

      ctx.save();
      ctx.translate(28, 38); // shoulder pivot
      ctx.rotate(waveAng);

      // upper arm
      const uaG = ctx.createLinearGradient(-5, 0, 5, 0);
      uaG.addColorStop(0, skinShadow); uaG.addColorStop(0.4, skin); uaG.addColorStop(1, skinMid);
      ctx.fillStyle = uaG;
      ctx.beginPath();
      ctx.ellipse(0, -14, 5.5, 14, 0, 0, Math.PI*2);
      ctx.fill();

      ctx.translate(0, -28); // elbow pivot
      ctx.rotate(foreAng);

      // forearm
      const faG = ctx.createLinearGradient(-4, 0, 4, 0);
      faG.addColorStop(0, skinShadow); faG.addColorStop(0.45, skinHi); faG.addColorStop(1, skinMid);
      ctx.fillStyle = faG;
      ctx.beginPath();
      ctx.ellipse(0, -11, 4.5, 12, 0, 0, Math.PI*2);
      ctx.fill();

      ctx.translate(0, -23); // wrist pivot
      ctx.rotate(wristFlick);

      // Hand palm
      const hndG = ctx.createRadialGradient(0, 0, 1, 0, 0, 9);
      hndG.addColorStop(0, skinHi); hndG.addColorStop(0.6, skin); hndG.addColorStop(1, skinMid);
      ctx.fillStyle = hndG;
      ctx.beginPath();
      ctx.ellipse(0, -3, 6, 7, 0, 0, Math.PI*2);
      ctx.fill();

      // Fingers (4 rounded stubs)
      ctx.fillStyle = skin;
      const fSpacing = [-5.5, -2, 1.5, 5];
      fSpacing.forEach((fx, fi) => {
        ctx.beginPath();
        const fLen = fi === 0 || fi === 3 ? 5.5 : 7;
        ctx.ellipse(fx, -10 - fLen * 0.4, 2.3, fLen * 0.5, 0.05*(fi-1.5), 0, Math.PI*2);
        ctx.fill();
        // knuckle line
        ctx.strokeStyle = 'rgba(0,0,0,0.1)'; ctx.lineWidth = 0.5;
        ctx.beginPath(); ctx.arc(fx, -10, 2, 0, Math.PI); ctx.stroke();
      });
      // Thumb
      ctx.fillStyle = skin;
      ctx.beginPath(); ctx.ellipse(-9, -5, 2.5, 5, -0.7, 0, Math.PI*2); ctx.fill();

      ctx.restore(); // wrist/forearm/shoulder

      // ── NECK ─────────────────────────────────────────────────
      const nkG = ctx.createLinearGradient(-7, 26, 7, 26);
      nkG.addColorStop(0, skinShadow); nkG.addColorStop(0.5, skin); nkG.addColorStop(1, skinMid);
      ctx.fillStyle = nkG;
      ctx.beginPath();
      ctx.moveTo(-7, 26);
      ctx.bezierCurveTo(-7, 38, 7, 38, 7, 26);
      ctx.bezierCurveTo(7, 20, -7, 20, -7, 26);
      ctx.fill();

      // ── HEAD SHAPE ───────────────────────────────────────────
      // Soft jaw shadow
      const jawShad = ctx.createRadialGradient(0, 18, 8, 0, 18, 28);
      jawShad.addColorStop(0, 'rgba(0,0,0,0)');
      jawShad.addColorStop(1, 'rgba(60,25,10,0.22)');
      ctx.fillStyle = jawShad;
      ctx.beginPath();
      ctx.ellipse(0, 16, 26, 12, 0, 0, Math.PI*2);
      ctx.fill();

      // Face base — warm gradient simulating light from upper-left
      const faceG = ctx.createRadialGradient(-6, -12, 4, 0, -4, 26);
      faceG.addColorStop(0,   skinHi);
      faceG.addColorStop(0.35, skin);
      faceG.addColorStop(0.7,  skinMid);
      faceG.addColorStop(1,    skinShadow);
      ctx.fillStyle = faceG;
      ctx.beginPath();
      // Head silhouette: wider at temples, tapers to chin
      ctx.moveTo(0, -26);
      ctx.bezierCurveTo(26, -26, 28, -8, 26, 4);
      ctx.bezierCurveTo(24, 14, 16, 22, 0, 26);
      ctx.bezierCurveTo(-16, 22, -24, 14, -26, 4);
      ctx.bezierCurveTo(-28, -8, -26, -26, 0, -26);
      ctx.fill();

      // Temple shadows (depth)
      ['left','right'].forEach(side => {
        const sx = side === 'left' ? -22 : 22;
        const tSh = ctx.createRadialGradient(sx, -4, 0, sx, -4, 14);
        tSh.addColorStop(0, 'rgba(60,25,10,0.20)');
        tSh.addColorStop(1, 'rgba(60,25,10,0)');
        ctx.fillStyle = tSh;
        ctx.beginPath();
        ctx.ellipse(sx, -4, 10, 18, 0, 0, Math.PI*2);
        ctx.fill();
      });

      // Forehead highlight
      const foreHi = ctx.createRadialGradient(-4, -18, 0, -4, -18, 13);
      foreHi.addColorStop(0, 'rgba(255,220,180,0.35)');
      foreHi.addColorStop(1, 'rgba(255,220,180,0)');
      ctx.fillStyle = foreHi;
      ctx.beginPath(); ctx.ellipse(-4, -18, 12, 9, 0, 0, Math.PI*2); ctx.fill();

      // Cheekbone highlight
      [-15, 15].forEach(cx2 => {
        const ckHi = ctx.createRadialGradient(cx2, 6, 0, cx2, 6, 10);
        ckHi.addColorStop(0, 'rgba(255,210,170,0.25)');
        ckHi.addColorStop(1, 'rgba(255,210,170,0)');
        ctx.fillStyle = ckHi; ctx.beginPath(); ctx.ellipse(cx2, 6, 8, 6, 0, 0, Math.PI*2); ctx.fill();
      });

      // Blush
      ctx.fillStyle = skinBlush;
      ctx.beginPath(); ctx.ellipse(-16, 8, 7, 4.5, -0.15, 0, Math.PI*2); ctx.fill();
      ctx.beginPath(); ctx.ellipse( 16, 8, 7, 4.5,  0.15, 0, Math.PI*2); ctx.fill();

      // ── EARS ─────────────────────────────────────────────────
      ['left','right'].forEach(side => {
        const ex = side === 'left' ? -26 : 26;
        const earG = ctx.createRadialGradient(ex, 0, 0, ex, 0, 7);
        earG.addColorStop(0, skinMid);
        earG.addColorStop(1, skinShadow);
        ctx.fillStyle = earG;
        ctx.beginPath();
        ctx.ellipse(ex, 0, 4.5, 7, 0, 0, Math.PI*2);
        ctx.fill();
        // inner ear
        ctx.fillStyle = 'rgba(120,60,30,0.25)';
        ctx.beginPath(); ctx.ellipse(ex, 0, 2.5, 4, 0, 0, Math.PI*2); ctx.fill();
      });

      // ── HAIR ─────────────────────────────────────────────────
      if (isBF) {
        // Short fade — dark cap sitting naturally above forehead
        const hG = ctx.createLinearGradient(0, -30, 0, -14);
        hG.addColorStop(0, hairHi); hG.addColorStop(0.6, hairC);
        ctx.fillStyle = hG;
        ctx.beginPath();
        ctx.moveTo(-26, -16);
        ctx.bezierCurveTo(-27, -30, -14, -36, 0, -36);
        ctx.bezierCurveTo(14, -36, 27, -30, 26, -16);
        ctx.bezierCurveTo(20, -20, -20, -20, -26, -16);
        ctx.fill();

        // Subtle fringe strands
        ctx.strokeStyle = hairC; ctx.lineWidth = 1.8;
        [[-8,-18,-4,-23],[-2,-20,2,-26],[5,-17,10,-22]].forEach(([x1,y1,x2,y2]) => {
          ctx.beginPath(); ctx.moveTo(x1, y1); ctx.quadraticCurveTo((x1+x2)/2-2, y1+1, x2, y2); ctx.stroke();
        });

        // Side fade (temples)
        ['left','right'].forEach(s => {
          const sx = s === 'left' ? -22 : 22;
          const tfG = ctx.createRadialGradient(sx, -14, 0, sx, -14, 10);
          tfG.addColorStop(0, hairC); tfG.addColorStop(1, 'transparent');
          ctx.fillStyle = tfG;
          ctx.beginPath(); ctx.ellipse(sx, -15, 7, 9, 0, 0, Math.PI*2); ctx.fill();
        });

      } else {
        // Long silky hair — center part, flowing sides
        const hG = ctx.createLinearGradient(-5, -38, 8, -10);
        hG.addColorStop(0, hairHi); hG.addColorStop(0.5, hairC); hG.addColorStop(1, hairC);
        ctx.fillStyle = hG;

        // Left side hair flowing down
        ctx.beginPath();
        ctx.moveTo(-2, -35);
        ctx.bezierCurveTo(-10, -34, -26, -24, -28, -8);
        ctx.bezierCurveTo(-30, 4, -28, 18, -26, 28);
        ctx.bezierCurveTo(-22, 32, -18, 30, -16, 26);
        ctx.bezierCurveTo(-20, 16, -22, 4, -22, -6);
        ctx.bezierCurveTo(-21, -18, -16, -26, -4, -32);
        ctx.closePath();
        ctx.fill();

        // Right side hair
        ctx.beginPath();
        ctx.moveTo(2, -35);
        ctx.bezierCurveTo(10, -34, 26, -24, 28, -8);
        ctx.bezierCurveTo(30, 4, 28, 18, 26, 28);
        ctx.bezierCurveTo(22, 32, 18, 30, 16, 26);
        ctx.bezierCurveTo(20, 16, 22, 4, 22, -6);
        ctx.bezierCurveTo(21, -18, 16, -26, 4, -32);
        ctx.closePath();
        ctx.fill();

        // Top cap
        ctx.beginPath();
        ctx.moveTo(-4, -35);
        ctx.bezierCurveTo(-18, -36, -26, -26, -26, -16);
        ctx.bezierCurveTo(-20, -20, -10, -22, 0, -22);
        ctx.bezierCurveTo(10, -22, 20, -20, 26, -16);
        ctx.bezierCurveTo(26, -26, 18, -36, 4, -35);
        ctx.fill();

        // Center parting line
        ctx.strokeStyle = 'rgba(5,2,10,0.7)';
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.moveTo(0, -35); ctx.lineTo(0, -22);
        ctx.stroke();

        // Hair strand highlights
        const hHiG = ctx.createLinearGradient(-20, -30, -14, 10);
        hHiG.addColorStop(0, 'rgba(80,40,60,0.0)');
        hHiG.addColorStop(0.4, 'rgba(90,50,70,0.45)');
        hHiG.addColorStop(1, 'rgba(80,40,60,0.0)');
        ctx.fillStyle = hHiG;
        ctx.beginPath();
        ctx.moveTo(-18, -30); ctx.lineTo(-12, -30);
        ctx.lineTo(-8, 20); ctx.lineTo(-14, 20);
        ctx.closePath();
        ctx.fill();

        // GF earring (subtle dot)
        ctx.fillStyle = '#FFD700';
        ctx.beginPath(); ctx.arc(-25, 6, 2, 0, Math.PI*2); ctx.fill();
        ctx.beginPath(); ctx.arc( 25, 6, 2, 0, Math.PI*2); ctx.fill();
      }

      // ── EYEBROWS ─────────────────────────────────────────────
      // Natural arched brows
      [[-12, -16, isBF ? 0.18 : 0.25], [12, -16, isBF ? -0.18 : -0.25]].forEach(([bx, by, tilt]) => {
        ctx.save();
        ctx.translate(bx, by);
        ctx.rotate(tilt);
        // Brow fill — tapers at ends
        ctx.fillStyle = browC;
        ctx.beginPath();
        ctx.moveTo(-7, 0);
        ctx.bezierCurveTo(-6, -2.2, 6, -2.2, 7, 0);
        ctx.bezierCurveTo(6, 1.2, -6, 1.2, -7, 0);
        ctx.fill();

        // Fine hair texture
        ctx.strokeStyle = 'rgba(10,4,2,0.5)';
        ctx.lineWidth = 0.5;
        for (let i = -3; i <= 3; i++) {
          ctx.beginPath();
          ctx.moveTo(i*2, 0.5);
          ctx.lineTo(i*2 + (bx < 0 ? 1 : -1), -1.5);
          ctx.stroke();
        }
        ctx.restore();
      });

      // ── EYES ─────────────────────────────────────────────────
      [[-12, -6], [12, -6]].forEach(([ex, ey], ei) => {
        ctx.save();
        ctx.translate(ex, ey);

        // Eye socket shadow
        const sockSh = ctx.createRadialGradient(0, 0, 1, 0, 0, 11);
        sockSh.addColorStop(0, 'rgba(0,0,0,0)');
        sockSh.addColorStop(1, 'rgba(40,15,5,0.18)');
        ctx.fillStyle = sockSh;
        ctx.beginPath(); ctx.ellipse(0, 0, 10, 8, 0, 0, Math.PI*2); ctx.fill();

        // Sclera
        ctx.fillStyle = sclera;
        ctx.beginPath();
        ctx.ellipse(0, 0, 8.5, 6.5, 0, 0, Math.PI*2);
        ctx.fill();

        // Iris gradient
        const irisG = ctx.createRadialGradient(-1.5, -1.5, 0.5, 0, 0, 6.5);
        irisG.addColorStop(0, irisHi);
        irisG.addColorStop(0.4, irisC);
        irisG.addColorStop(1, '#000000');
        ctx.fillStyle = irisG;
        ctx.beginPath();
        ctx.arc(0, 0, 5.5, 0, Math.PI*2);
        ctx.fill();

        // Pupil
        ctx.fillStyle = pupil;
        ctx.beginPath(); ctx.arc(0, 0, 3, 0, Math.PI*2); ctx.fill();

        // Catchlight (makes eyes alive!)
        ctx.fillStyle = 'rgba(255,255,255,0.88)';
        ctx.beginPath(); ctx.ellipse(-2, -2, 1.8, 1.4, -0.5, 0, Math.PI*2); ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,0.4)';
        ctx.beginPath(); ctx.arc(2, 2, 0.8, 0, Math.PI*2); ctx.fill();

        // Eyelid crease
        ctx.strokeStyle = 'rgba(80,35,15,0.25)'; ctx.lineWidth = 0.8;
        ctx.beginPath();
        ctx.moveTo(-8, -1);
        ctx.bezierCurveTo(-5, -6, 5, -6, 8, -1);
        ctx.stroke();

        // Upper eyelid (skin flap — covers top of iris)
        const lidG = ctx.createLinearGradient(0, -8, 0, -2);
        lidG.addColorStop(0, skinMid);
        lidG.addColorStop(1, 'rgba(180,110,60,0)');
        ctx.fillStyle = lidG;
        ctx.beginPath();
        ctx.moveTo(-9, -1);
        ctx.bezierCurveTo(-7, -8, 7, -8, 9, -1);
        ctx.bezierCurveTo(5, -3, -5, -3, -9, -1);
        ctx.fill();

        // Blink: lower lid rises
        if (blinkOpen < 1) {
          const blinkH = (1 - blinkOpen) * 6.5;
          const lidSkinG = ctx.createLinearGradient(0, 0, 0, blinkH);
          lidSkinG.addColorStop(0, skin); lidSkinG.addColorStop(1, skinMid);
          ctx.fillStyle = lidSkinG;
          ctx.beginPath();
          ctx.moveTo(-8.5, 6.5);
          ctx.bezierCurveTo(-5, 6.5 - blinkH, 5, 6.5 - blinkH, 8.5, 6.5);
          ctx.bezierCurveTo(5, 7.5, -5, 7.5, -8.5, 6.5);
          ctx.fill();
        }

        // Lower lash line
        ctx.strokeStyle = 'rgba(30,10,5,0.35)'; ctx.lineWidth = 0.7;
        ctx.beginPath(); ctx.moveTo(-8, 5); ctx.bezierCurveTo(-5, 7.5, 5, 7.5, 8, 5); ctx.stroke();

        // Upper lashes — short strokes
        ctx.strokeStyle = hairC; ctx.lineWidth = 1.2;
        for (let i = -3; i <= 3; i++) {
          const lx = i * 2.5;
          const ly = -Math.sqrt(Math.max(0, 56 - lx*lx)) + 0.5;
          ctx.beginPath();
          ctx.moveTo(lx, ly);
          ctx.lineTo(lx + (i < 0 ? -1 : i > 0 ? 1 : 0), ly - 2.5);
          ctx.stroke();
        }

        // GF: eyeliner flick
        if (!isBF) {
          ctx.strokeStyle = 'rgba(10,5,20,0.75)'; ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(ei === 0 ? -8 : 8, -1.5);
          ctx.lineTo(ei === 0 ? -11 : 11, -4);
          ctx.stroke();
        }

        ctx.restore();
      });

      // ── NOSE ─────────────────────────────────────────────────
      // Bridge shadow
      const noseG = ctx.createLinearGradient(-2, -4, 2, 8);
      noseG.addColorStop(0, 'rgba(100,50,20,0.12)');
      noseG.addColorStop(0.6, 'rgba(100,50,20,0.25)');
      noseG.addColorStop(1, 'rgba(100,50,20,0)');
      ctx.fillStyle = noseG;
      ctx.beginPath();
      ctx.moveTo(-1.5, -5);
      ctx.bezierCurveTo(-2.5, 0, -5, 8, -4, 10);
      ctx.bezierCurveTo(-2, 12, 2, 12, 4, 10);
      ctx.bezierCurveTo(5, 8, 2.5, 0, 1.5, -5);
      ctx.fill();

      // Nose tip
      const noseTipG = ctx.createRadialGradient(-1, 9, 0, 0, 10, 7);
      noseTipG.addColorStop(0, skinHi); noseTipG.addColorStop(0.5, skin); noseTipG.addColorStop(1, skinShadow);
      ctx.fillStyle = noseTipG;
      ctx.beginPath();
      ctx.ellipse(0, 10, 6, 4.5, 0, 0, Math.PI*2);
      ctx.fill();

      // Nostrils
      ctx.fillStyle = 'rgba(70,30,10,0.45)';
      ctx.beginPath(); ctx.ellipse(-4, 11, 2.5, 2, 0.3, 0, Math.PI*2); ctx.fill();
      ctx.beginPath(); ctx.ellipse( 4, 11, 2.5, 2, -0.3, 0, Math.PI*2); ctx.fill();

      // Nose highlight
      ctx.fillStyle = 'rgba(255,220,180,0.38)';
      ctx.beginPath(); ctx.ellipse(-1, 9, 1.8, 2, 0, 0, Math.PI*2); ctx.fill();

      // ── MOUTH ────────────────────────────────────────────────
      // Smile driven by wave animation — slight open during wave peak
      smilePhase = (Math.sin(tt * 2.3 + tOff) + 1) / 2;  // 0-1
      const smileW = 11 + smilePhase * 2;
      const smileD = 2.5 + smilePhase * 1.5;
      const mouthOpen = smilePhase > 0.6 ? (smilePhase - 0.6) * 8 : 0; // slight open

      // Mouth shadow
      ctx.fillStyle = 'rgba(60,20,10,0.22)';
      ctx.beginPath();
      ctx.ellipse(0, 19, smileW + 2, 4, 0, 0, Math.PI*2);
      ctx.fill();

      if (mouthOpen > 0.5) {
        // Open mouth — show teeth
        ctx.fillStyle = skinShadow;
        ctx.beginPath();
        ctx.moveTo(-smileW, 18);
        ctx.bezierCurveTo(-smileW + 2, 18 + smileD, smileW - 2, 18 + smileD, smileW, 18);
        ctx.bezierCurveTo(smileW - 2, 18 + smileD + mouthOpen, -smileW + 2, 18 + smileD + mouthOpen, -smileW, 18);
        ctx.fill();

        // Teeth strip
        ctx.fillStyle = teethC;
        ctx.beginPath();
        ctx.moveTo(-smileW + 1, 18.5);
        ctx.bezierCurveTo(-smileW + 3, 18 + smileD - 0.5, smileW - 3, 18 + smileD - 0.5, smileW - 1, 18.5);
        ctx.bezierCurveTo(smileW - 3, 18 + smileD + 2, -smileW + 3, 18 + smileD + 2, -smileW + 1, 18.5);
        ctx.fill();
      }

      // Upper lip
      const ulG = ctx.createLinearGradient(0, 15, 0, 20);
      ulG.addColorStop(0, lipC); ulG.addColorStop(1, lipLo);
      ctx.fillStyle = ulG;
      ctx.beginPath();
      ctx.moveTo(-smileW, 18);
      ctx.bezierCurveTo(-smileW + 2, 16, -4, 15.5, 0, 16);
      ctx.bezierCurveTo(4, 15.5, smileW - 2, 16, smileW, 18);
      ctx.bezierCurveTo(smileW - 2, 18 + smileD, -smileW + 2, 18 + smileD, -smileW, 18);
      ctx.fill();

      // Lip highlight
      ctx.fillStyle = 'rgba(255,200,180,0.3)';
      ctx.beginPath(); ctx.ellipse(-2, 17, 5, 1.2, 0.1, 0, Math.PI*2); ctx.fill();

      // Lower lip
      const llG = ctx.createLinearGradient(0, 20, 0, 24);
      llG.addColorStop(0, lipC); llG.addColorStop(1, lipLo);
      ctx.fillStyle = llG;
      ctx.beginPath();
      ctx.moveTo(-smileW, 18);
      ctx.bezierCurveTo(-smileW + 2, 18 + smileD, smileW - 2, 18 + smileD, smileW, 18);
      ctx.bezierCurveTo(smileW - 1, 20 + smileD + 1, -smileW + 1, 20 + smileD + 1, -smileW, 18);
      ctx.fill();

      // Lower lip highlight
      ctx.fillStyle = 'rgba(255,200,180,0.32)';
      ctx.beginPath(); ctx.ellipse(0, 21, 5, 1.5, 0, 0, Math.PI*2); ctx.fill();

      // Chin dimple (subtle)
      ctx.strokeStyle = 'rgba(80,35,15,0.15)'; ctx.lineWidth = 0.8;
      ctx.beginPath(); ctx.arc(0, 26, 3, 0.2, Math.PI - 0.2); ctx.stroke();

      ctx.restore(); // head pivot

      // ── UPDATE BLINK ─────────────────────────────────────────
      blinkT += 0.016;
      // Blink every ~4s, quick
      if (blinkT > 4.0) {
        blinkT = 0;
        blinkOpen = 0;
      }
      if (blinkOpen < 1) {
        blinkOpen = Math.min(1, blinkOpen + 0.18);
      }
    }

    // ── RAF loop ─────────────────────────────────────────────
    function loop() {
      if (!alive) return;
      requestAnimationFrame(loop);
      t += 0.016;
      draw(t);
    }
    loop();
  }

  function injectCompanionGateStyles() {
    if (document.getElementById('cgm-styles')) return;
    const s = document.createElement('style');
    s.id = 'cgm-styles';
    s.textContent = `
      .cgm-box{position:relative;background:linear-gradient(160deg,#0f0c1f,#1a1235);border:1px solid rgba(255,107,157,0.3);border-radius:24px;padding:28px 20px 20px;max-width:350px;width:100%;text-align:center;box-shadow:0 0 80px rgba(255,107,157,0.12),0 28px 56px rgba(0,0,0,0.6);animation:cfSlideUp .28s cubic-bezier(.34,1.56,.64,1);overflow:hidden;}
      .cgm-glow{position:absolute;inset:0;pointer-events:none;}
      .cgm-offer-badge{display:inline-block;font-size:10px;font-weight:800;letter-spacing:.12em;text-transform:uppercase;color:#FF6B9D;background:rgba(255,107,157,0.15);border:1px solid rgba(255,107,157,0.35);padding:4px 14px;border-radius:20px;margin-bottom:16px;}
      .cgm-avatar-wrap{position:relative;width:80px;height:80px;margin:0 auto 10px;display:flex;align-items:center;justify-content:center;}
      .cgm-avatar-ring{position:absolute;inset:-4px;border-radius:50%;border:2px solid;animation:introRingPulse 2.5s ease-in-out infinite;}
      .cgm-avatar{font-size:44px;position:relative;z-index:1;filter:drop-shadow(0 4px 12px rgba(0,0,0,0.4));}
      .cgm-status-dot{position:absolute;bottom:4px;right:4px;width:14px;height:14px;border-radius:50%;border:2px solid #0f0c1f;z-index:2;}
      .cgm-name{font-family:'Space Grotesk',sans-serif;font-size:20px;font-weight:800;margin-bottom:6px;}
      .cgm-tagline{font-size:12px;color:rgba(220,210,255,0.6);font-style:italic;line-height:1.5;margin-bottom:16px;padding:0 8px;}
      .cgm-talk-section{background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.07);border-radius:14px;padding:12px 14px;margin-bottom:14px;text-align:left;}
      .cgm-talk-label{font-size:10px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:rgba(200,180,255,0.5);margin-bottom:8px;}
      .cgm-bubbles{display:flex;flex-direction:column;gap:6px;}
      .cgm-bubble{font-size:11.5px;line-height:1.5;color:rgba(230,225,255,0.85);background:rgba(108,99,255,0.1);border:1px solid rgba(108,99,255,0.18);border-radius:12px 12px 12px 4px;padding:7px 11px;}
      .cgm-features{display:flex;flex-direction:column;gap:6px;margin-bottom:16px;text-align:left;}
      .cgm-feat{display:flex;align-items:flex-start;gap:8px;font-size:12px;color:rgba(210,205,255,0.75);line-height:1.45;}
      .cgm-feat-icon{font-weight:800;flex-shrink:0;margin-top:1px;}
      .cgm-pricing-wrap{background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);border-radius:16px;padding:14px 14px 12px;margin-bottom:12px;}
      .cgm-plan-tabs{display:flex;gap:6px;margin-bottom:12px;}
      .cgm-plan-tab{flex:1;padding:8px 4px;border-radius:10px;border:1px solid rgba(255,255,255,0.1);background:transparent;color:rgba(200,195,255,0.45);font-size:12px;font-weight:600;cursor:pointer;transition:all .2s;position:relative;}
      .cgm-plan-tab-active{background:rgba(108,99,255,0.2);border-color:rgba(108,99,255,0.4);color:#a89cff;}
      .cgm-save-pill{display:inline-block;font-size:9px;font-weight:700;background:rgba(16,185,129,0.2);border:1px solid rgba(16,185,129,0.3);color:#10b981;padding:2px 6px;border-radius:20px;margin-left:5px;vertical-align:middle;}
      .cgm-plan-card{text-align:center;}
      .cgm-old-price{font-size:11px;color:rgba(200,180,220,0.4);text-decoration:line-through;margin-bottom:2px;}
      .cgm-new-price{font-size:30px;font-weight:800;margin-bottom:4px;line-height:1;}
      .cgm-new-price span{font-size:13px;font-weight:400;color:rgba(200,180,220,0.5);margin-left:2px;}
      .cgm-price-note{font-size:10px;color:rgba(200,180,220,0.4);margin-bottom:12px;}
      .cgm-pay-btn{width:100%;padding:13px;border:none;border-radius:13px;color:#fff;font-size:14px;font-weight:700;cursor:pointer;transition:opacity .2s,transform .15s;letter-spacing:.02em;}
      .cgm-pay-btn:hover:not(:disabled){opacity:.9;transform:scale(1.01);}
      .cgm-pay-btn:disabled{opacity:.6;cursor:default;}
    `;
    document.head.appendChild(s);
  }

  // ── Settings dropdown handler ─────────────────────────────────
  window.handlePersonaSettingsChange = function(selectEl) {
    const persona   = selectEl.value;
    const prevValue = (typeof state !== 'undefined' ? state.aiPersona : null) || '';
    // companion check removed
    _doSelectPersona(persona);
  };

  // ── Persona modal card click interceptor ──────────────────────
  window.selectPersona = function(persona) {
    // companion check removed
    _doSelectPersona(persona);
  };

  // Expose globals AFTER all functions are defined
  window.openCompanionGateModal = openCompanionGateModal;

  // ── Patch openPremiumModal to always use payment.js's renderPremiumModal ──
  // Capture the real function NOW, before anything overwrites window.renderPremiumModal.
  const _paymentRenderPremiumModal = window.renderPremiumModal;
  window.openPremiumModal = window.showPremiumModal = function() {
    _paymentRenderPremiumModal();
    const modal = document.getElementById('premiumModal');
    if (modal) modal.classList.add('active');
    if (typeof window._rewirePvsPlayer === 'function') setTimeout(window._rewirePvsPlayer, 0);
  };

  /* ─── INIT ──────────────────────────────────────────────────── */
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => setTimeout(checkPendingOnLoad, 1500));
  } else {
    setTimeout(checkPendingOnLoad, 1500);
  }

  // ── Add lock badges to BF/GF persona cards on load ─────────────
  function refreshCompanionLockUI() {
    const bfUnlocked = isCompanionUnlocked('boyfriend');
    const gfUnlocked = isCompanionUnlocked('girlfriend');

    // Persona modal cards
    document.querySelectorAll('[data-companion-lock="true"]').forEach(card => {
      const isBF = card.onclick?.toString().includes('boyfriend') ||
                   card.getAttribute('onclick')?.includes('boyfriend');
      const unlocked = isBF ? bfUnlocked : gfUnlocked;

      // Remove existing badge first
      card.querySelector('.companion-lock-badge')?.remove();

      if (!unlocked) {
        const badge = document.createElement('span');
        badge.className = 'companion-lock-badge';
        badge.textContent = '🔒 ₹49';
        badge.style.cssText = `
          position:absolute; top:8px; right:8px;
          font-size:10px; font-weight:700;
          background:rgba(255,107,157,0.2);
          border:1px solid rgba(255,107,157,0.4);
          color:#FF6B9D; padding:2px 7px;
          border-radius:20px; pointer-events:none;
        `;
        card.style.position = 'relative';
        card.appendChild(badge);
      }
    });

    // Settings dropdown options — update lock text
    const sel = document.getElementById('personaSettingsSelect');
    if (sel) {
      const bfOpt = sel.querySelector('option[value="boyfriend"]');
      const gfOpt = sel.querySelector('option[value="girlfriend"]');
      if (bfOpt) bfOpt.textContent = bfUnlocked ? '💕 Boyfriend' : '💕 Boyfriend 🔒';
      if (gfOpt) gfOpt.textContent = gfUnlocked ? '💕 Girlfriend' : '💕 Girlfriend 🔒';
    }
  }

  // Run on load + whenever persona modal opens
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => setTimeout(refreshCompanionLockUI, 800));
  } else {
    setTimeout(refreshCompanionLockUI, 800);
  }

  // Patch showPersonaSelector to refresh lock badges each time modal opens
  const _origShowPersonaSelector = window.showPersonaSelector;
  window.showPersonaSelector = function() {
    if (typeof _origShowPersonaSelector === 'function') _origShowPersonaSelector();
    else {
      const m = document.getElementById('personaSelectorModal');
      if (m) m.classList.add('active');
    }
    setTimeout(refreshCompanionLockUI, 80);
  };

  // ── Teacher Mode is now FREE — patch all gates ───────────────
  // Override _isTeacherPremium so voice-ai.js always returns true
  // This runs after voice-ai.js loads (deferred), so we patch on a delay too
  function patchTeacherFree() {
    // Mark as unlocked in localStorage
    localStorage.setItem('sscai_teacher_unlocked', 'true');
    // Override the check function if accessible
    if (typeof window._isTeacherPremiumOverride === 'undefined') {
      window._isTeacherPremiumOverride = true;
      // Patch voice-ai internal function via a global that voice-ai.js checks
      window.__teacherAlwaysFree = true;
    }
    // Override openTeacherPaywall to be a no-op
    window.openTeacherPaywall = function() {
      // Teacher is free — just unlock
      localStorage.setItem('sscai_teacher_unlocked', 'true');
      // Try to close any open paywall
      const pw = document.getElementById('teacherPaywallModal');
      if (pw) { pw.classList.remove('active'); pw.style.display = 'none'; }
    };
    // Override openTeacherAdModal to also be a no-op
    if (typeof window.openTeacherAdModal !== 'undefined') {
      window.openTeacherAdModal = function() {
        localStorage.setItem('sscai_teacher_unlocked', 'true');
        showToast('🎓 Teacher Mode is now FREE! Enjoy unlimited voice answers 🎉', 3000);
      };
    }
    // Remove lock badge from teacher model option if present
    const teacherOpt = document.querySelector('[data-model="teacher"] .model-opt-name');
    if (teacherOpt) {
      const tag = teacherOpt.querySelector('.model-tag');
      if (tag && (tag.textContent.includes('₹') || tag.textContent.includes('PREMIUM'))) {
        tag.textContent = 'FREE';
        tag.className = 'model-tag free-tag';
      }
    }
  }

  // Patch immediately and after scripts load
  patchTeacherFree();
  window.addEventListener('load', patchTeacherFree);
  setTimeout(patchTeacherFree, 2000);

  console.log('[payment.js] v2.1 loaded — using Cloud Run backend for order creation');

})();