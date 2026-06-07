/**
 * strict-gate-patch.js — CrackAI Hard Paywall v1.2
 * Loads last (defer). Overrides all canSend*, model gates,
 * teacher gate, companion gate, reward bypass.
 */
(function () {
  'use strict';

  var FREE_TEXT  = 15;
  var FREE_IMAGE = 2;
  var FREE_PDF   = 1;

  /* ── Safe isPremium check ─────────────────────────────────── */
  // SOURCE OF TRUTH: per-user localStorage key written by payment.js.
  // We do NOT gate on state.isPremium first — that in-memory value may
  // be stale (e.g. payment just completed in another tab, or activatePlan
  // ran but state object reference differs). localStorage is always current.
  function isPremium() {
    try {
      var uid = window._firebaseAuth && window._firebaseAuth.currentUser
                  ? window._firebaseAuth.currentUser.uid : null;
      var p = uid ? ('sscai_u:' + uid + ':') : 'sscai_guest:';
      if (localStorage.getItem(p + 'premium') === 'true') {
        // Sync in-memory state so everything stays consistent
        if (typeof state !== 'undefined') state.isPremium = true;
        return true;
      }
      // ⚠️ Do NOT read global 'sscai_premium' — it has no UID and leaks
      // premium to every other user who opens the app on this device.
      return false;
    } catch (e) { return false; }
  }

  /* ── Open premium modal safely ────────────────────────────── */
  function openPremium() {
    try {
      if (typeof openPremiumModal === 'function') { openPremiumModal(); return; }
      if (typeof window.showPremiumModal === 'function') { window.showPremiumModal(); return; }
      var m = document.getElementById('premiumModal');
      if (m) m.classList.add('active');
    } catch (e) {}
  }

  /* ── Disable reward / ad bypass ──────────────────────────── */
  window.isRewardActive      = function () { return false; };
  window.rewardRemainingMs   = function () { return 0; };
  window.rewardRemainingLabel= function () { return '0:00'; };
  window.showRewardPopup     = function () { openPremium(); };
  window.activateReward      = function () {};

  /* ── canSend* functions ───────────────────────────────────── */
  function canText()  {
    if (isPremium()) return true;
    return typeof state !== 'undefined' && state.textCount  < FREE_TEXT;
  }
  function canImage() {
    if (isPremium()) return true;
    return typeof state !== 'undefined' && state.imageCount < FREE_IMAGE;
  }
  function canPdf()   {
    if (isPremium()) return true;
    return typeof state !== 'undefined' && state.pdfCount   < FREE_PDF;
  }

  window.canSendText  = canText;
  window.canSendImage = canImage;
  window.canSendPdf   = canPdf;

  /* ── handleLimitHit → always open premium modal ─────────── */
  window.handleLimitHit = function (type) {
    var labels = { text: 'Daily text limit reached', image: 'Daily image limit reached', pdf: 'Daily PDF limit reached' };
    try { if (typeof showToast === 'function') showToast('🔒 ' + (labels[type] || 'Limit reached') + ' — Upgrade to Premium ₹199/month'); } catch(e){}
    openPremium();
  };

  /* ── Patch sendMessage ────────────────────────────────────── */
  function patchSendMessage() {
    var _orig = window.sendMessage;
    if (typeof _orig !== 'function') { setTimeout(patchSendMessage, 150); return; }
    if (_orig._sgPatched) return;
    function patched() {
      try {
        var hasImages = typeof pendingImageFiles !== 'undefined' && pendingImageFiles.length > 0;
        var hasPdf    = typeof pendingPdfFile    !== 'undefined' && !!pendingPdfFile;
        if (hasImages && !canImage()) { window.handleLimitHit('image'); return; }
        if (hasPdf    && !canPdf())   { window.handleLimitHit('pdf');   return; }
        if (!canText())               { window.handleLimitHit('text');  return; }
      } catch(e) {}
      return _orig.apply(this, arguments);
    }
    patched._sgPatched = true;
    window.sendMessage = patched;
  }
  patchSendMessage();

  /* ── Model selection gate ─────────────────────────────────── */
  var GATED_MODELS = ['pro', 'vision-pro', 'v4-pro'];

  document.addEventListener('click', function (e) {
    try {
      var opt = e.target.closest && e.target.closest('.model-option[data-model]');
      if (!opt) return;
      var model = opt.dataset.model;
      if (GATED_MODELS.indexOf(model) === -1) return;
      if (isPremium()) return;
      e.stopImmediatePropagation();
      try { if (typeof showToast === 'function') showToast('🔒 ' + model + ' requires Premium — ₹199/month'); } catch(ex){}
      openPremium();
      document.querySelectorAll('.model-selector-dropdown').forEach(function(d){ d.classList.remove('open'); });
    } catch(e) {}
  }, true);

  /* ── Teacher / Voice-AI gate ─────────────────────────────── */
  function restoreTeacherGate() {
    try {
      window.__teacherAlwaysFree = false;
      if (!isPremium()) localStorage.removeItem('sscai_teacher_unlocked');
      window.openTeacherPaywall = function () {
        try { if (typeof showToast === 'function') showToast('🔒 Teacher Voice Mode requires Premium — ₹199/month'); } catch(ex){}
        openPremium();
      };
    } catch(e) {}
  }
  restoreTeacherGate();
  setTimeout(restoreTeacherGate, 500);
  setTimeout(restoreTeacherGate, 2500);
  window.addEventListener('load', restoreTeacherGate);


  /* ── Upload button gates ─────────────────────────────────── */
  function patchUploadBtns() {
    function gateBtn(id, limitFn, type) {
      var btn = document.getElementById(id);
      if (!btn || btn._sgBound) return;
      btn._sgBound = true;
      btn.addEventListener('click', function (e) {
        if (!limitFn()) {
          e.stopImmediatePropagation();
          try {
            var sub  = document.getElementById('uploadSubMenu');
            var wrap = document.getElementById('uploadBtnWrap');
            if (sub)  sub.style.display = 'none';
            if (wrap) wrap.classList.remove('open');
          } catch(ex){}
          window.handleLimitHit(type);
        }
      }, true);
    }
    gateBtn('imageUploadBtn', canImage, 'image');
    gateBtn('pdfUploadBtn',   canPdf,   'pdf');
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', patchUploadBtns);
  } else {
    patchUploadBtns();
  }
  setTimeout(patchUploadBtns, 800);
  setTimeout(patchUploadBtns, 2500);

  /* ── Limit UI text ───────────────────────────────────────── */
  var _origUpdateLimitUI = window.updateLimitUI;
  window.updateLimitUI = function () {
    try { if (typeof _origUpdateLimitUI === 'function') _origUpdateLimitUI(); } catch(e){}
    try {
      var el = document.getElementById('messageLimitInfo');
      if (!el || isPremium()) return;
      var used = typeof state !== 'undefined' ? (state.textCount || 0) : 0;
      var rem = Math.max(0, FREE_TEXT - used);
      var color = rem <= 3 ? '#ef4444' : rem <= 7 ? '#f59e0b' : 'rgba(200,195,255,0.6)';
      el.innerHTML = rem > 0
        ? '<span style="color:' + color + ';font-size:11px;">🤖 Free: <strong>' + rem + '</strong>/' + FREE_TEXT + ' messages left today · <a href="#" onclick="openPremiumModal&&openPremiumModal();return false;" style="color:#6C63FF;text-decoration:none;">Upgrade ⭐</a></span>'
        : '<span style="color:#ef4444;font-size:11px;">🔒 Daily limit reached · <a href="#" onclick="openPremiumModal&&openPremiumModal();return false;" style="color:#f59e0b;text-decoration:none;font-weight:600;">Upgrade to Premium ₹199/mo ⭐</a></span>';
    } catch(e) {}
  };

  /* ── Periodic re-enforcement every 5s ───────────────────── */
  setInterval(function () {
    // Always re-check localStorage so a just-completed payment
    // is picked up within 5 seconds without a page reload.
    var prem = isPremium(); // also syncs state.isPremium as a side-effect

    if (window.canSendText  !== canText)  window.canSendText  = canText;
    if (window.canSendImage !== canImage) window.canSendImage = canImage;
    if (window.canSendPdf   !== canPdf)   window.canSendPdf   = canPdf;
    window.isRewardActive = function () { return false; };

    // Only strip teacher unlock for non-premium users
    if (!prem && localStorage.getItem('sscai_teacher_unlocked') === 'true') {
      localStorage.removeItem('sscai_teacher_unlocked');
    }

    // If user just became premium, refresh UI once
    if (prem && typeof updateLimitUI === 'function') updateLimitUI();
  }, 5000);

  console.info('[StrictGate] v2.0 — companion removed, new plans active');

})();