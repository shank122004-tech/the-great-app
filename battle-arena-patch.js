/**
 * battle-arena-patch.js — CrackAI Online Battle Arena v3.0
 * ═══════════════════════════════════════════════════════════════════
 *  FEATURES:
 *  1. Public Online Battle Arena — battles visible to ALL users
 *  2. Battle Creator gate — only ₹99/month Battle plan (or promo code)
 *  3. 10 battles/month limit per creator
 *  4. Max 10 players per battle
 *  5. 3-2-1 countdown before quiz starts
 *  6. Real-time polling (no onSnapshot = no Firebase billing spike)
 *  7. Winner announcement when battle ends
 *  8. Global Leaderboard — weekly XP, ranks, levels
 *  9. Weekly top XP user gets free 1-month premium (₹1299 value)
 * 10. Promo code CRACKBATTLE — unlocks battle creator for free
 * 11. User level system (Level 1–100 with titles)
 * 12. Dark/Light mode support in leaderboard
 * 13. ELO ranking system (Bronze → Legend)
 * 14. Instant Answer Race speed points
 * 15. Live emoji reactions during battle
 * 16. Battle highlights (Fastest / Accuracy King / Comeback)
 * 17. Coins economy — Arena wins only, top-3-of-10 prize model
 * 18. Cosmetics shop (avatars, name colours, profile frames)
 * 19. Quit battle → never shown again + slot freed in Firestore
 * 20. Group Study: auto-delete messages when ALL members have read them
 *
 *  FIREBASE COST NOTES:
 *  - Uses getDoc polling (5s interval) NOT onSnapshot listeners
 *  - Battle documents are small (<5KB each)
 *  - Public battle list polls every 8s (only when arena is open)
 *  - XP writes batched: only on answer submit
 *  - Weekly leaderboard reads once per open, not continuous
 * ═══════════════════════════════════════════════════════════════════
 */

(function (global) {
  'use strict';

  /* ─── CONSTANTS ───────────────────────────────────────────── */
  const DS_URL           = 'https://deepseek-56khnynjia-uc.a.run.app';
  const MAX_PLAYERS      = 10;
  const MAX_BATTLES_MONTH= 10;
  const BATTLE_PROMO     = 'MU1R43PNZ889VKSZ';   // promo code for free battle access
  const QUESTIONS_PER_BATTLE = 10;
  const POLL_BATTLE_LIST = 4000;            // ms — public battle list refresh
  const POLL_ACTIVE_GAME = 3000;            // ms — active battle question poll
  const LS_PROMO_KEY     = 'sscai_battle_promo_unlocked';
  const LS_XP_BATTLE_KEY = 'sscai_battle_weekly_xp';
  const WEEKLY_REWARD_PLAN = 'battle_weekly_reward';

  /* ─── LEVEL SYSTEM ────────────────────────────────────────── */
  const LEVEL_TITLES = [
    { min: 0,   max: 9,   title: 'Beginner',    emoji: '🌱', color: '#4ade80' },
    { min: 10,  max: 24,  title: 'Aspirant',    emoji: '📘', color: '#38bdf8' },
    { min: 25,  max: 49,  title: 'Expert',      emoji: '⚡', color: '#a78bfa' },
    { min: 50,  max: 74,  title: 'SSC Master',  emoji: '🏆', color: '#f59e0b' },
    { min: 75,  max: 99,  title: 'Champion',    emoji: '👑', color: '#FF6B9D' },
    { min: 100, max: 999, title: 'Legend',      emoji: '🌟', color: '#fff' },
  ];

  function getLevelTitle(level) {
    return LEVEL_TITLES.find(l => level >= l.min && level <= l.max) || LEVEL_TITLES[0];
  }

  /* ─── ADMIN ──────────────────────────────────────────────── */
  // Add your admin email(s) here — admin always bypasses all paywalls
  var ADMIN_EMAILS = ['shank122004@gmail.com'];

  function isAdmin() {
    try {
      var cu = global._firebaseAuth?.currentUser;
      if (cu && cu.email && ADMIN_EMAILS.indexOf(cu.email) !== -1) return true;
    } catch(e) {}
    return false;
  }

  /* ─── UTILITIES ──────────────────────────────────────────── */
  function uid()     { return global._firebaseAuth?.currentUser?.uid || 'guest'; }
  function _p()      { return 'sscai_u:' + uid() + ':'; }
  function lsGet(k)  { try { return JSON.parse(localStorage.getItem(_p()+k) || 'null'); } catch { return null; } }
  function lsSet(k,v){ try { localStorage.setItem(_p()+k, JSON.stringify(v)); } catch {} }
  function toast(m,d){ if (typeof showToast === 'function') showToast(m, d||2800); }

  function getMyName() {
    try {
      const cu = global._firebaseAuth?.currentUser;
      if (cu) {
        if (cu.displayName && cu.displayName.trim()) return cu.displayName.trim();
        // Fallback: use email prefix (e.g. "john.doe" from "john.doe@gmail.com")
        if (cu.email) {
          const prefix = cu.email.split('@')[0];
          // Capitalize first letter
          return prefix.charAt(0).toUpperCase() + prefix.slice(1);
        }
      }
    } catch(e) {}
    try { if (typeof state !== 'undefined' && state.user) return state.user.displayName || state.user.name || state.user.email?.split('@')[0] || 'Student'; } catch(e) {}
    return 'Student';
  }

  function isPremium() {
    try {
      const u = global._firebaseAuth?.currentUser;
      if (u) {
        if (localStorage.getItem('sscai_u:'+u.uid+':premium') === 'true') return true;
      }
      if (localStorage.getItem('sscai_premium') === 'true') return true;
      return false;
    } catch(e) { return false; }
  }

  const BATTLE_PLANS = ['battle', 'battle_pro', 'battle_academy'];
  const BATTLE_PLAN_LIMITS = { battle: 10, battle_pro: 100, battle_academy: 999999 };

  function hasBattlePlan() {
    // Promo code check
    const myUid = global._firebaseAuth?.currentUser?.uid;
    const perUserPromoKey = myUid ? ('sscai_u:' + myUid + ':' + LS_PROMO_KEY) : null;
    if (perUserPromoKey && localStorage.getItem(perUserPromoKey) === 'true') return true;
    try {
      const u = global._firebaseAuth?.currentUser;
      if (u) {
        const plan = localStorage.getItem('sscai_u:'+u.uid+':premium_plan');
        if (BATTLE_PLANS.indexOf(plan) !== -1) return true;
      }
      const gPlan = localStorage.getItem('sscai_premium_plan');
      if (BATTLE_PLANS.indexOf(gPlan) !== -1) return true;
    } catch(e) {}
    return false;
  }

  function getBattleTier() {
    try {
      const u = global._firebaseAuth?.currentUser;
      if (u) {
        const plan = localStorage.getItem('sscai_u:'+u.uid+':premium_plan');
        if (BATTLE_PLANS.indexOf(plan) !== -1) return plan;
      }
      const gPlan = localStorage.getItem('sscai_premium_plan');
      if (BATTLE_PLANS.indexOf(gPlan) !== -1) return gPlan;
    } catch(e) {}
    // Check stored tier separately (set by payment.js activatePlan)
    return localStorage.getItem('sscai_battle_tier') || 'battle';
  }

  function getMaxBattlesPerMonth() {
    if (isAdmin()) return 999999;
    const tier = getBattleTier();
    // Also check localStorage override set by payment.js
    const stored = parseInt(localStorage.getItem('sscai_battle_monthly_max') || '0', 10);
    return stored || BATTLE_PLAN_LIMITS[tier] || 10;
  }

  function isBattleCreator() {
    if (isAdmin()) return true;
    return hasBattlePlan();
  }

  /* ─── GROUP ADMIN CHECK ──────────────────────────────────── */
  function isGroupAdmin() {
    try {
      const u = global._firebaseAuth?.currentUser;
      const p = u ? ('sscai_u:' + u.uid + ':') : 'sscai_guest:';
      if (localStorage.getItem(p + 'group_admin') === 'true') return true;
      if (localStorage.getItem('sscai_group_admin') === 'true') return true;
    } catch(e) {}
    return isAdmin();
  }

  function getGroupAdminPlan() {
    try {
      const u = global._firebaseAuth?.currentUser;
      const p = u ? ('sscai_u:' + u.uid + ':') : 'sscai_guest:';
      return localStorage.getItem(p + 'group_plan') || localStorage.getItem('sscai_group_plan') || null;
    } catch(e) { return null; }
  }

  function getMaxGroups() {
    const plan = getGroupAdminPlan();
    if (plan === 'coaching_pro') return 999;
    if (plan === 'coaching_basic') return 3;
    if (plan === 'group_leader') return 1;
    if (isAdmin()) return 999;
    return 0;
  }

  function getBattleExtraCredits() {
    if (window._battleExtra) return window._battleExtra.getBattleExtraCredits();
    try {
      const data = JSON.parse(localStorage.getItem('sscai_battle_extra_credits') || '{"credits":0}');
      return data.credits || 0;
    } catch(e) { return 0; }
  }

  function useBattleExtraCredit() {
    if (window._battleExtra) return window._battleExtra.useBattleExtraCredit();
    try {
      const key = 'sscai_battle_extra_credits';
      const data = JSON.parse(localStorage.getItem(key) || '{"credits":0}');
      if ((data.credits || 0) <= 0) return false;
      data.credits = data.credits - 1;
      localStorage.setItem(key, JSON.stringify(data));
      return true;
    } catch(e) { return false; }
  }

  // Total battles available = tier limit + extra credits
  function canCreateBattle() {
    if (isAdmin()) return true;
    if (!isBattleCreator()) return false;
    const usage = getBattleCreatorUsage();
    const maxAllowed = getMaxBattlesPerMonth();
    if (usage < maxAllowed) return true;             // tier quota available
    return getBattleExtraCredits() > 0;              // extra credits banked
  }

  /* Battle XP for this week */
  function getWeekKey() {
    const now = new Date();
    const startOfYear = new Date(now.getFullYear(), 0, 1);
    const week = Math.ceil(((now - startOfYear) / 86400000 + startOfYear.getDay() + 1) / 7);
    return now.getFullYear() + '_W' + week;
  }

  function getBattleXP() {
    const data = lsGet('battle_xp') || { xp: 0, week: '' };
    if (data.week !== getWeekKey()) return 0;
    return data.xp || 0;
  }

  function addBattleXP(n) {
    const data = lsGet('battle_xp') || { xp: 0, week: '' };
    const thisWeek = getWeekKey();
    const xp = data.week === thisWeek ? (data.xp || 0) + n : n;
    lsSet('battle_xp', { xp, week: thisWeek });
    // Also update global XP
    if (typeof XP !== 'undefined' && XP.add) XP.add(n);
    return xp;
  }

  function getBattleCreatorUsage() {
    const data = lsGet('battle_creator_usage') || { count: 0, month: '' };
    const thisMonth = new Date().getFullYear() + '_' + new Date().getMonth();
    if (data.month !== thisMonth) return 0;
    return data.count || 0;
  }

  function incrementBattleUsage() {
    const thisMonth = new Date().getFullYear() + '_' + new Date().getMonth();
    const data = lsGet('battle_creator_usage') || { count: 0, month: '' };
    const count = data.month === thisMonth ? (data.count || 0) + 1 : 1;
    lsSet('battle_creator_usage', { count, month: thisMonth });
    return count;
  }

  /* ─── STYLES ─────────────────────────────────────────────── */
  function injectStyles() {
    if (document.getElementById('ba-styles')) return;
    const s = document.createElement('style');
    s.id = 'ba-styles';
    s.textContent = `
      /* ── Battle Arena Modal ── */
      #ba-modal, #lb-modal {
        position: fixed; inset: 0; z-index: 99990;
        background: rgba(0,0,0,0.85); backdrop-filter: blur(8px);
        display: none; align-items: flex-start; justify-content: center;
        overflow-y: auto; padding: 0;
      }
      #ba-modal.open, #lb-modal.open { display: flex; }
      .ba-box, .lb-box {
        background: var(--bg-secondary, #13131a);
        border: 1px solid rgba(108,99,255,0.25);
        border-radius: 20px; width: 100%; max-width: 520px;
        margin: 0 auto; min-height: 100dvh;
        display: flex; flex-direction: column;
        font-family: 'Space Grotesk', -apple-system, sans-serif;
      }
      .ba-hdr, .lb-hdr {
        display: flex; align-items: center; justify-content: space-between;
        padding: 14px 16px; border-bottom: 1px solid rgba(108,99,255,0.15);
        position: sticky; top: 0; background: var(--bg-secondary, #13131a);
        z-index: 2; border-radius: 20px 20px 0 0;
      }
      .ba-title, .lb-title {
        font-size: 17px; font-weight: 800; color: #fff; letter-spacing: -0.01em;
      }
      .ba-close, .lb-close {
        background: rgba(255,255,255,0.08); border: none; color: rgba(200,195,255,0.6);
        width: 32px; height: 32px; border-radius: 50%; cursor: pointer;
        font-size: 16px; display: flex; align-items: center; justify-content: center;
      }
      .ba-close:hover, .lb-close:hover { background: rgba(255,255,255,0.14); color: #fff; }
      .ba-body, .lb-body { padding: 14px 14px 24px; flex: 1; }

      /* ── Battle cards ── */
      .ba-battle-card {
        background: rgba(255,255,255,0.04); border: 1px solid rgba(108,99,255,0.2);
        border-radius: 14px; padding: 14px; margin-bottom: 10px;
        transition: border-color 0.2s;
      }
      .ba-battle-card:hover { border-color: rgba(108,99,255,0.5); }
      .ba-battle-card.full { border-color: rgba(239,68,68,0.3); opacity: 0.7; }
      .ba-card-top { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 8px; }
      .ba-card-name { font-size: 15px; font-weight: 700; color: #fff; }
      .ba-card-exam { font-size: 11px; color: rgba(200,195,255,0.5); margin-top: 2px; }
      .ba-card-slots { font-size: 12px; font-weight: 700; padding: 3px 9px; border-radius: 20px; }
      .ba-slots-open { background: rgba(74,222,128,0.15); color: #4ade80; }
      .ba-slots-full { background: rgba(239,68,68,0.15); color: #f87171; }
      .ba-card-bottom { display: flex; align-items: center; justify-content: space-between; }
      .ba-card-players { font-size: 11px; color: rgba(200,195,255,0.45); }
      .ba-join-btn {
        padding: 7px 16px; background: linear-gradient(135deg,#6C63FF,#FF6B9D);
        border: none; border-radius: 8px; color: #fff; font-size: 12px;
        font-weight: 700; cursor: pointer; letter-spacing: 0.02em;
        transition: opacity 0.15s;
      }
      .ba-join-btn:hover { opacity: 0.85; }
      .ba-join-btn:disabled { opacity: 0.4; cursor: not-allowed; }

      /* ── Create battle form ── */
      .ba-create-btn {
        width: 100%; padding: 13px; margin-bottom: 16px;
        background: linear-gradient(135deg,#f59e0b,#ef4444);
        border: none; border-radius: 12px; color: #fff;
        font-size: 14px; font-weight: 800; cursor: pointer;
        box-shadow: 0 4px 18px rgba(245,158,11,0.3); letter-spacing: 0.02em;
      }
      .ba-input {
        width: 100%; padding: 10px 14px; background: rgba(255,255,255,0.06);
        border: 1px solid rgba(108,99,255,0.25); border-radius: 10px;
        color: #fff; font-size: 13px; margin-bottom: 10px;
        font-family: inherit; box-sizing: border-box;
      }
      .ba-input:focus { outline: none; border-color: rgba(108,99,255,0.6); }
      .ba-select {
        width: 100%; padding: 10px 14px; background: rgba(10,10,20,0.9);
        border: 1px solid rgba(108,99,255,0.25); border-radius: 10px;
        color: #fff; font-size: 13px; margin-bottom: 10px; font-family: inherit;
      }
      .ba-section-title {
        font-size: 11px; font-weight: 700; letter-spacing: 0.08em;
        color: rgba(200,195,255,0.4); text-transform: uppercase; margin-bottom: 10px; margin-top: 4px;
      }

      /* ── Active battle ── */
      .ba-active-wrap { padding: 0; }
      .ba-countdown-overlay {
        position: fixed; inset: 0; z-index: 99999;
        background: rgba(0,0,0,0.95); display: flex;
        align-items: center; justify-content: center; flex-direction: column;
      }
      .ba-countdown-num {
        font-size: 120px; font-weight: 900; line-height: 1;
        background: linear-gradient(135deg,#f59e0b,#FF6B9D);
        -webkit-background-clip: text; -webkit-text-fill-color: transparent;
        background-clip: text; animation: ba-countpop 0.6s ease;
      }
      @keyframes ba-countpop {
        0%{transform:scale(2);opacity:0} 40%{transform:scale(1.1);opacity:1} 100%{transform:scale(1)}
      }
      .ba-countdown-label { font-size: 16px; color: rgba(200,195,255,0.5); margin-top: 12px; }

      /* ── Quiz battle UI ── */
      .ba-quiz-progress { font-size: 12px; color: rgba(200,195,255,0.5); margin-bottom: 6px; display:flex; justify-content:space-between; }
      .ba-quiz-bar { height: 3px; background: rgba(108,99,255,0.15); border-radius: 3px; margin-bottom: 16px; }
      .ba-quiz-bar-fill { height: 100%; background: linear-gradient(90deg,#6C63FF,#FF6B9D); border-radius: 3px; transition: width 0.4s; }
      .ba-quiz-q { font-size: 16px; font-weight: 700; color: #fff; line-height: 1.5; margin-bottom: 16px; }
      .ba-quiz-opts { display: flex; flex-direction: column; gap: 8px; margin-bottom: 14px; }
      .ba-quiz-opt {
        width: 100%; padding: 12px 14px; background: rgba(255,255,255,0.05);
        border: 1.5px solid rgba(108,99,255,0.2); border-radius: 11px;
        color: rgba(240,240,245,0.9); font-size: 13.5px; font-weight: 600;
        cursor: pointer; text-align: left; transition: all 0.15s; display: flex; gap: 10px;
        font-family: inherit;
      }
      .ba-quiz-opt:hover:not(:disabled) { border-color: rgba(108,99,255,0.6); background: rgba(108,99,255,0.1); }
      .ba-quiz-opt.correct { border-color: #4ade80; background: rgba(74,222,128,0.12); color: #4ade80; }
      .ba-quiz-opt.wrong   { border-color: #f87171; background: rgba(248,113,113,0.10); color: #f87171; }
      .ba-quiz-opt.dim     { opacity: 0.4; }
      .ba-quiz-opt:disabled { cursor: not-allowed; }
      .ba-opt-letter { min-width: 22px; height: 22px; background: rgba(108,99,255,0.2); border-radius: 6px; display:flex; align-items:center; justify-content:center; font-size:12px; font-weight:800; }
      .ba-quiz-answered-banner {
        padding: 10px 14px; border-radius: 10px; margin-bottom: 10px;
        font-size: 13px; font-weight: 700; text-align: center;
      }
      .ba-quiz-answered-banner.correct { background: rgba(74,222,128,0.15); color: #4ade80; border: 1px solid rgba(74,222,128,0.3); }
      .ba-quiz-answered-banner.wrong   { background: rgba(248,113,113,0.12); color: #f87171; border: 1px solid rgba(248,113,113,0.25); }
      .ba-quiz-exp { font-size: 12px; color: rgba(200,195,255,0.6); padding: 9px 12px; background: rgba(108,99,255,0.08); border-radius: 9px; margin-bottom: 10px; line-height: 1.5; }
      .ba-quiz-waiting { text-align: center; font-size: 13px; color: rgba(200,195,255,0.5); padding: 10px; }

      /* ── XP board ── */
      .ba-xp-board { background: rgba(255,255,255,0.04); border-radius: 12px; padding: 12px; margin-top: 10px; }
      .ba-xp-row { display: flex; align-items: center; gap: 8px; padding: 6px 4px; border-bottom: 1px solid rgba(255,255,255,0.05); }
      .ba-xp-row:last-child { border: none; }
      .ba-xp-row.me { background: rgba(108,99,255,0.1); border-radius: 8px; }
      .ba-xp-rank { font-size: 16px; min-width: 24px; }
      .ba-xp-name { flex: 1; font-size: 12px; color: rgba(200,195,255,0.8); font-weight: 600; }
      .ba-xp-val { font-size: 13px; font-weight: 800; color: #f59e0b; }

      /* ── Winner screen ── */
      .ba-winner-wrap { text-align: center; padding: 24px 0 16px; }
      .ba-winner-trophy { font-size: 64px; margin-bottom: 8px; }
      .ba-winner-title { font-size: 22px; font-weight: 900; background: linear-gradient(135deg,#f59e0b,#FF6B9D); -webkit-background-clip:text; -webkit-text-fill-color:transparent; background-clip:text; margin-bottom: 6px; }
      .ba-winner-name { font-size: 16px; color: rgba(200,195,255,0.7); margin-bottom: 20px; }
      .ba-results-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-bottom: 16px; }
      .ba-result-stat { background: rgba(255,255,255,0.04); border-radius: 12px; padding: 10px; text-align: center; }
      .ba-result-stat-val { font-size: 18px; font-weight: 800; color: #f59e0b; }
      .ba-result-stat-lbl { font-size: 11px; color: rgba(200,195,255,0.5); margin-top: 3px; }

      /* ── Leaderboard ── */
      .lb-tab-row { display: flex; gap: 8px; margin-bottom: 14px; }
      .lb-tab {
        flex: 1; padding: 8px; background: rgba(255,255,255,0.05);
        border: 1px solid rgba(108,99,255,0.2); border-radius: 10px;
        color: rgba(200,195,255,0.6); font-size: 12px; font-weight: 700;
        cursor: pointer; text-align: center; transition: all 0.15s; font-family: inherit;
      }
      .lb-tab.active { background: rgba(108,99,255,0.2); border-color: rgba(108,99,255,0.5); color: #fff; }
      .lb-row {
        display: flex; align-items: center; gap: 12px; padding: 12px;
        background: rgba(255,255,255,0.03); border-radius: 12px; margin-bottom: 8px;
        border: 1px solid rgba(108,99,255,0.1);
      }
      .lb-row.me { border-color: rgba(108,99,255,0.4); background: rgba(108,99,255,0.08); }
      .lb-row.top3 { border-color: rgba(245,158,11,0.35); }
      .lb-rank { font-size: 20px; min-width: 28px; text-align: center; }
      .lb-avatar { width: 38px; height: 38px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 15px; font-weight: 800; flex-shrink: 0; }
      .lb-info { flex: 1; }
      .lb-name { font-size: 13px; font-weight: 700; color: #fff; }
      .lb-level { font-size: 11px; margin-top: 2px; }
      .lb-xp-col { text-align: right; }
      .lb-xp-val { font-size: 15px; font-weight: 800; color: #f59e0b; }
      .lb-xp-lbl { font-size: 10px; color: rgba(200,195,255,0.4); margin-top: 1px; }
      .lb-weekly-notice {
        background: linear-gradient(135deg,rgba(245,158,11,0.12),rgba(255,107,157,0.08));
        border: 1px solid rgba(245,158,11,0.3); border-radius: 12px; padding: 12px 14px; margin-bottom: 16px;
        font-size: 12px; line-height: 1.6; color: rgba(255,220,150,0.9);
      }
      .lb-theme-toggle {
        padding: 6px 14px; background: rgba(255,255,255,0.06); border: 1px solid rgba(108,99,255,0.2);
        border-radius: 8px; color: rgba(200,195,255,0.7); font-size: 12px; cursor: pointer;
        font-family: inherit;
      }

      /* ── Players list ── */
      .ba-players-list { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 10px; }
      .ba-player-chip {
        padding: 4px 10px; background: rgba(108,99,255,0.15); border: 1px solid rgba(108,99,255,0.3);
        border-radius: 20px; font-size: 11px; color: rgba(200,195,255,0.8); font-weight: 600;
      }

      /* ── Promo code ── */
      .ba-promo-row { display: flex; gap: 8px; margin-bottom: 14px; }
      .ba-promo-input {
        flex: 1; padding: 10px 14px; background: rgba(255,255,255,0.06);
        border: 1px solid rgba(108,99,255,0.25); border-radius: 10px;
        color: #fff; font-size: 13px; font-family: inherit; text-transform: uppercase;
      }
      .ba-promo-btn {
        padding: 10px 16px; background: rgba(108,99,255,0.2); border: 1px solid rgba(108,99,255,0.4);
        border-radius: 10px; color: #6C63FF; font-size: 13px; font-weight: 700;
        cursor: pointer; font-family: inherit;
      }
      .ba-gate-box {
        background: rgba(245,158,11,0.06); border: 1px solid rgba(245,158,11,0.3);
        border-radius: 14px; padding: 18px; text-align: center; margin-bottom: 16px;
      }

      /* ── Loading & empty ── */
      .ba-loading { text-align: center; padding: 40px 0; color: rgba(200,195,255,0.4); font-size: 13px; }
      .ba-spinner { width: 28px; height: 28px; border: 3px solid rgba(108,99,255,0.2); border-top-color: #6C63FF; border-radius: 50%; animation: ba-spin 0.8s linear infinite; margin: 0 auto 12px; }
      @keyframes ba-spin { to { transform: rotate(360deg); } }
      .ba-empty { text-align: center; padding: 40px 16px; color: rgba(200,195,255,0.4); font-size: 13px; }

      /* ── Usage badge ── */
      .ba-usage-badge {
        display: inline-flex; align-items: center; gap: 5px; padding: 4px 10px;
        background: rgba(108,99,255,0.12); border: 1px solid rgba(108,99,255,0.25);
        border-radius: 20px; font-size: 11px; color: rgba(200,195,255,0.7);
        margin-bottom: 14px;
      }

      /* ── Leaderboard light mode ── */
      .lb-light .lb-box { background: #f8f8ff; border-color: rgba(108,99,255,0.2); }
      .lb-light .lb-hdr { background: #f8f8ff; border-color: rgba(108,99,255,0.1); }
      .lb-light .lb-title { color: #1a1a2e; }
      .lb-light .lb-close { background: rgba(0,0,0,0.06); color: #555; }
      .lb-light .lb-tab { background: rgba(0,0,0,0.04); color: #555; border-color: rgba(108,99,255,0.15); }
      .lb-light .lb-tab.active { background: rgba(108,99,255,0.15); color: #4a44b5; }
      .lb-light .lb-row { background: rgba(0,0,0,0.02); border-color: rgba(108,99,255,0.1); }
      .lb-light .lb-row.me { background: rgba(108,99,255,0.07); }
      .lb-light .lb-name { color: #1a1a2e; }
      .lb-light .lb-xp-val { color: #c27a00; }
      .lb-light .lb-xp-lbl { color: rgba(0,0,0,0.4); }
      .lb-light .lb-weekly-notice { background: rgba(245,158,11,0.08); }
      .lb-light .lb-body { color: #333; }
    `;
    document.head.appendChild(s);
  }

  /* ─── CREATE MODALS ──────────────────────────────────────── */
  function createModals() {
    // Battle Arena Modal
    if (!document.getElementById('ba-modal')) {
      const m = document.createElement('div');
      m.id = 'ba-modal';
      m.innerHTML = `
        <div class="ba-box">
          <div class="ba-hdr">
            <span class="ba-title">⚔️ Battle Arena</span>
            <div style="display:flex;gap:8px;align-items:center;">
              <span id="ba-online-dot" style="font-size:11px;color:#4ade80;">● Live</span>
              <button class="ba-close" onclick="BA.close()">✕</button>
            </div>
          </div>
          <div class="ba-body" id="ba-body"></div>
        </div>`;
      document.body.appendChild(m);
    }

    // Leaderboard Modal
    if (!document.getElementById('lb-modal')) {
      const m = document.createElement('div');
      m.id = 'lb-modal';
      m.innerHTML = `
        <div class="lb-box" id="lb-box">
          <div class="lb-hdr">
            <span class="lb-title">🏆 Leaderboard</span>
            <div style="display:flex;gap:8px;align-items:center;">
              <button class="lb-theme-toggle" id="lb-theme-btn" onclick="BA.toggleLbTheme()">🌙 Dark</button>
              <button class="lb-close" onclick="BA.closeLb()">✕</button>
            </div>
          </div>
          <div class="lb-body" id="lb-body"></div>
        </div>`;
      document.body.appendChild(m);
    }
  }

  /* ─── BATTLE ARENA CONTROLLER ────────────────────────────── */
  window.BA = {
    _pollListInterval: null,
    _pollGameInterval: null,
    _activeBattleId: null,
    _lbTheme: 'dark',

    open() {
      injectStyles();
      createModals();
      document.getElementById('ba-modal').classList.add('open');
      this._renderArena();
    },

    close() {
      document.getElementById('ba-modal')?.classList.remove('open');
      this._stopPolling();
      this._activeBattleId = null;
    },

    closeLb() {
      document.getElementById('lb-modal')?.classList.remove('open');
    },

    toggleLbTheme() {
      this._lbTheme = this._lbTheme === 'dark' ? 'light' : 'dark';
      const modal = document.getElementById('lb-modal');
      const btn = document.getElementById('lb-theme-btn');
      if (this._lbTheme === 'light') {
        modal.classList.add('lb-light');
        if (btn) btn.textContent = '☀️ Light';
      } else {
        modal.classList.remove('lb-light');
        if (btn) btn.textContent = '🌙 Dark';
      }
    },

    _stopPolling() {
      if (this._pollListInterval) { clearInterval(this._pollListInterval); this._pollListInterval = null; }
      if (this._pollGameInterval) { clearInterval(this._pollGameInterval); this._pollGameInterval = null; }
      if (this._genTimerInterval) { clearInterval(this._genTimerInterval); this._genTimerInterval = null; }
    },

    /* ── ARENA HOME — list of open battles ── */
    async _renderArena() {
      const body = document.getElementById('ba-body');
      if (!body) return;
      body.innerHTML = `<div class="ba-loading"><div class="ba-spinner"></div>Loading battles...</div>`;
      this._stopPolling();
      this._activeBattleId = null;

      // Start polling the public battle list
      await this._refreshBattleList();
      this._pollListInterval = setInterval(() => this._refreshBattleList(), POLL_BATTLE_LIST);
    },

    async _refreshBattleList() {
      const body = document.getElementById('ba-body');
      if (!body || this._activeBattleId) return;

      if (!window._firebaseDb || !window._firebaseFns) {
        setTimeout(() => this._refreshBattleList(), 1000);
        return;
      }

      const ACTIVE_STATUSES = ['waiting', 'generating', 'countdown', 'active'];
      let battles = null;

      // Attempt 1: composite index query (fastest, requires index)
      try {
        const db = window._firebaseDb;
        const { collection, query, where, getDocs, orderBy, limit } = window._firebaseFns;
        const q = query(
          collection(db, 'publicBattles'),
          where('status', 'in', ACTIVE_STATUSES),
          orderBy('createdAt', 'desc'),
          limit(20)
        );
        const snap = await getDocs(q);
        battles = snap.docs.map(d => ({ ...d.data(), id: d.id }));
      } catch(e) { /* index not ready — try next */ }

      // Attempt 2: where-only query, no orderBy (works without composite index)
      if (battles === null) {
        try {
          const db = window._firebaseDb;
          const { collection, query, where, getDocs } = window._firebaseFns;
          const q = query(
            collection(db, 'publicBattles'),
            where('status', 'in', ACTIVE_STATUSES)
          );
          const snap = await getDocs(q);
          battles = snap.docs.map(d => ({ ...d.data(), id: d.id }))
            .sort((a,b) => (b.createdAt||0) - (a.createdAt||0))
            .slice(0, 20);
        } catch(e) { /* still failing — try full scan */ }
      }

      // Attempt 3: full collection scan, filter client-side
      // Always works as long as Firestore rules allow read for signed-in users
      if (battles === null) {
        try {
          const db = window._firebaseDb;
          const { collection, getDocs } = window._firebaseFns;
          const snap = await getDocs(collection(db, 'publicBattles'));
          battles = snap.docs
            .map(d => ({ ...d.data(), id: d.id }))
            .filter(b => ACTIVE_STATUSES.includes(b.status))
            .sort((a,b) => (b.createdAt||0) - (a.createdAt||0))
            .slice(0, 20);
        } catch(e) { /* all attempts failed */ }
      }

      this._renderBattleList(battles || []);
    },

    _renderBattleList(battles) {
      if (this._activeBattleId) return;
      const body = document.getElementById('ba-body');
      if (!body) return;

      // Filter out battles the user has quit — never show them again
      battles = (battles || []).filter(b => !window._hasQuitBattle(b.id));

      const isCreator = isBattleCreator();
      const usage = getBattleCreatorUsage();
      const myUid = uid();
      const maxAllowed = getMaxBattlesPerMonth();
      const battleTier = getBattleTier();
      const tierLabel = battleTier === 'battle_academy' ? 'Academy' : battleTier === 'battle_pro' ? 'Pro' : 'Basic';

      let html = '';

      // Creator section
      if (isCreator) {
        const baseRemaining = Math.max(0, maxAllowed - usage);
        const extraCredits = getBattleExtraCredits();
        const totalRemaining = baseRemaining + extraCredits;
        html += `
          <div class="ba-usage-badge">
            ⚔️ Battle Creator ${tierLabel} · <strong>${maxAllowed === 999999 ? '∞' : baseRemaining + '/' + maxAllowed}</strong> left this month
            ${extraCredits > 0 ? `<span style="margin-left:6px;background:rgba(245,158,11,0.2);color:#f59e0b;padding:2px 8px;border-radius:10px;font-size:11px;">+${extraCredits} extra ⚔️</span>` : ''}
          </div>
          <button class="ba-create-btn" onclick="BA._showCreateForm()" ${totalRemaining <= 0 ? 'style="opacity:0.5;"' : ''}>
            ⚔️ Create New Battle ${totalRemaining <= 0 ? '(Buy More →)' : `(${maxAllowed === 999999 ? '∞' : totalRemaining} left)`}
          </button>`;
      } else {
        html += `
          <div class="ba-gate-box">
            <div style="font-size:28px;margin-bottom:8px;">⚔️</div>
            <div style="font-size:15px;font-weight:800;color:#fff;margin-bottom:6px;">Want to Create Battles?</div>
            <div style="font-size:12px;color:rgba(200,195,255,0.6);margin-bottom:14px;line-height:1.5;">
              Choose a Battle Creator plan and host live quiz battles.<br>All users can join your battles for free!
            </div>
            <div style="display:flex;flex-direction:column;gap:8px;margin-bottom:12px;">
              <div style="display:flex;align-items:center;justify-content:space-between;background:rgba(239,68,68,0.08);border:1px solid rgba(239,68,68,0.3);border-radius:10px;padding:10px 12px;">
                <div><div style="font-size:13px;font-weight:700;color:#fff;">⚔️ Basic</div><div style="font-size:11px;color:rgba(200,195,255,0.5);">10 battles/month</div></div>
                <span style="font-size:15px;font-weight:800;color:#f59e0b;">₹99/mo</span>
              </div>
              <div style="display:flex;align-items:center;justify-content:space-between;background:rgba(239,68,68,0.12);border:1.5px solid rgba(239,68,68,0.5);border-radius:10px;padding:10px 12px;position:relative;">
                <div style="position:absolute;top:-8px;right:10px;background:linear-gradient(135deg,#ef4444,#f59e0b);color:#fff;font-size:9px;font-weight:800;padding:2px 8px;border-radius:10px;">POPULAR</div>
                <div><div style="font-size:13px;font-weight:700;color:#fff;">⚔️⚔️ Pro</div><div style="font-size:11px;color:rgba(200,195,255,0.5);">100 battles/month · Custom branding</div></div>
                <span style="font-size:15px;font-weight:800;color:#f59e0b;">₹299/mo</span>
              </div>
              <div style="display:flex;align-items:center;justify-content:space-between;background:rgba(245,158,11,0.07);border:1px solid rgba(245,158,11,0.35);border-radius:10px;padding:10px 12px;">
                <div><div style="font-size:13px;font-weight:700;color:#fff;">⚔️🏆 Academy</div><div style="font-size:11px;color:rgba(200,195,255,0.5);">Unlimited · Analytics · Leaderboards</div></div>
                <span style="font-size:15px;font-weight:800;color:#f59e0b;">₹499/mo</span>
              </div>
            </div>
            <div class="ba-promo-row">
              <input class="ba-promo-input" id="ba-promo-in" placeholder="Have a promo code?" maxlength="20" />
              <button class="ba-promo-btn" onclick="BA._applyPromo()">Apply</button>
            </div>
            <button onclick="BA._openBattlePlanModal();" style="width:100%;padding:12px;background:linear-gradient(135deg,#f59e0b,#ef4444);border:none;border-radius:10px;color:#fff;font-size:13px;font-weight:800;cursor:pointer;">
              ⚔️ View Battle Creator Plans →
            </button>
          </div>`;
      }

      html += `<div class="ba-section-title">🔴 Live & Open Battles</div>`;

      if (!battles || battles.length === 0) {
        html += `<div class="ba-empty">😴 No battles right now.<br>${isCreator ? 'Create one above!' : 'Check back soon or ask a friend to create one!'}</div>`;
      } else {
        battles.forEach(b => {
          const playerCount = (b.players || []).length;
          const isFull = playerCount >= MAX_PLAYERS;
          const alreadyIn = (b.players || []).includes(myUid);
          const examLabel = b.exam || 'General';
          const slotsLeft = MAX_PLAYERS - playerCount;

          // Show player names
          const playerNames = Object.values(b.playerNames || {}).slice(0, 5);
          const playersStr = playerNames.length > 0
            ? playerNames.join(', ') + (playerCount > 5 ? ` +${playerCount-5} more` : '')
            : 'Waiting for players...';

          const statusBadge = b.status === 'active'
            ? `<span style="font-size:11px;background:rgba(239,68,68,0.2);color:#f87171;padding:2px 8px;border-radius:10px;font-weight:700;">🔴 LIVE</span>`
            : b.status === 'countdown'
            ? `<span style="font-size:11px;background:rgba(245,158,11,0.2);color:#f59e0b;padding:2px 8px;border-radius:10px;font-weight:700;">⏳ Starting</span>`
            : b.status === 'generating'
            ? `<span style="font-size:11px;background:rgba(108,99,255,0.2);color:#a78bfa;padding:2px 8px;border-radius:10px;font-weight:700;">🤖 AI Generating</span>`
            : `<span style="font-size:11px;background:rgba(74,222,128,0.15);color:#4ade80;padding:2px 8px;border-radius:10px;font-weight:700;">🟢 Open</span>`;

          html += `
            <div class="ba-battle-card ${isFull && !alreadyIn ? 'full' : ''}" id="ba-card-${b.id}">
              <div class="ba-card-top">
                <div>
                  <div class="ba-card-name">${b.name || 'Quiz Battle'}</div>
                  <div class="ba-card-exam">📚 ${examLabel} &nbsp;·&nbsp; ${statusBadge}</div>
                </div>
                <span class="ba-card-slots ${isFull ? 'ba-slots-full' : 'ba-slots-open'}">
                  ${isFull ? '👥 Full' : `${playerCount}/${MAX_PLAYERS} joined`}
                </span>
              </div>
              <div style="font-size:11px;color:rgba(200,195,255,0.45);margin-bottom:10px;">
                👥 ${playersStr}
              </div>
              <div class="ba-card-bottom">
                <div class="ba-card-players">
                  Created by <strong style="color:rgba(200,195,255,0.7)">${b.creatorName || 'Admin'}</strong>
                </div>
                ${alreadyIn
                  ? `<button class="ba-join-btn" onclick="BA._rejoinBattle('${b.id}')">▶ Rejoin</button>`
                  : isFull
                  ? `<button class="ba-join-btn" disabled id="full-btn-${b.id}">Full</button>`
                  : `<button class="ba-join-btn" onclick="BA._joinBattle('${b.id}')">⚔️ Join</button>`
                }
              </div>
            </div>`;
        });
      }

      body.innerHTML = html;

      // Auto-show full then disappear after 3s
      battles.forEach(b => {
        if ((b.players || []).length >= MAX_PLAYERS) {
          const card = document.getElementById(`ba-card-${b.id}`);
          if (card) {
            setTimeout(() => {
              if (card && card.parentNode) {
                card.style.transition = 'opacity 0.5s';
                card.style.opacity = '0';
                setTimeout(() => card.remove(), 500);
              }
            }, 3000);
          }
        }
      });
    },

    /* ── Promo code apply ── */
    _applyPromo() {
      const input = document.getElementById('ba-promo-in');
      if (!input) return;
      const code = (input.value || '').trim().toUpperCase();
      if (code === BATTLE_PROMO) {
        // Save under per-user key so only THIS account gets the unlock
        const myUid = global._firebaseAuth?.currentUser?.uid;
        if (!myUid) {
          toast('❌ Please sign in before redeeming a promo code.', 3000);
          return;
        }
        const perUserPromoKey = 'sscai_u:' + myUid + ':' + LS_PROMO_KEY;
        localStorage.setItem(perUserPromoKey, 'true');
        toast('🎉 Promo code accepted! Battle Creator unlocked FREE!', 4000);
        this._renderArena();
      } else {
        toast('❌ Invalid promo code. Try again.', 2500);
        input.style.borderColor = 'rgba(239,68,68,0.5)';
        setTimeout(() => { if (input) input.style.borderColor = ''; }, 2000);
      }
    },

    /* ── Open Premium Modal scrolled to Battle Creator section ── */
    _openBattlePlanModal() {
      // 1. Open the premium modal
      if (typeof openPremiumModal === 'function') openPremiumModal();
      else if (typeof window.showPremiumModal === 'function') window.showPremiumModal();
      else {
        const m = document.getElementById('premiumModal');
        if (m) m.classList.add('active');
      }
      // 2. After modal renders, scroll to the Battle Creator card
      setTimeout(function () {
        try {
          // Find the Battle Creator card by its label badge text
          const allEls = document.querySelectorAll('#premiumModal *');
          for (let i = 0; i < allEls.length; i++) {
            const el = allEls[i];
            if (el.textContent.trim() === '⚔️ BATTLE CREATOR' && el.scrollIntoView) {
              el.scrollIntoView({ behavior: 'smooth', block: 'center' });
              // Briefly highlight the card
              const card = el.closest('[style]') || el.parentElement;
              if (card) {
                const orig = card.style.boxShadow || '';
                card.style.boxShadow = '0 0 0 2px #f59e0b, 0 0 24px rgba(245,158,11,0.4)';
                card.style.transition = 'box-shadow 0.3s';
                setTimeout(function () { card.style.boxShadow = orig; }, 2000);
              }
              break;
            }
          }
        } catch (e) {}
      }, 320);
    },

    /* ── Create Battle Form ── */
    _showCreateForm() {
      if (!isBattleCreator()) { toast('🔒 Battle Creator plan required.'); return; }
      if (!isAdmin() && !canCreateBattle()) {
        // Monthly base used up — show buy-more UI
        const extraCredits = getBattleExtraCredits();
        const maxAllowed = getMaxBattlesPerMonth();
        const body = document.getElementById('ba-body');
        if (body) {
          this._stopPolling();
          body.innerHTML = `
            <button class="ba-promo-btn" style="margin-bottom:14px;" onclick="BA._renderArena()">← Back</button>
            <div style="text-align:center;padding:20px 0 14px;">
              <div style="font-size:36px;margin-bottom:8px;">⚔️</div>
              <div style="font-size:16px;font-weight:800;color:#fff;margin-bottom:6px;">Monthly Limit Reached</div>
              <div style="font-size:12px;color:rgba(200,195,255,0.55);margin-bottom:16px;line-height:1.6;">
                You've used all ${maxAllowed} battle creations this month.<br>
                Your quota resets on the 1st of next month.
              </div>
              <div style="background:rgba(108,99,255,0.08);border:1px solid rgba(108,99,255,0.3);border-radius:12px;padding:12px;margin-bottom:10px;text-align:left;">
                <div style="font-size:12px;font-weight:700;color:#a78bfa;margin-bottom:8px;">⬆️ Upgrade for more battles/month</div>
                <div style="display:flex;flex-direction:column;gap:6px;">
                  <div style="display:flex;align-items:center;justify-content:space-between;background:rgba(255,255,255,0.04);border-radius:8px;padding:8px 10px;">
                    <span style="font-size:12px;color:#fff;">⚔️⚔️ Pro — 100 battles/mo</span>
                    <button onclick="if(typeof handlePayment==='function')handlePayment('battle_pro')" style="padding:5px 10px;background:linear-gradient(135deg,#ef4444,#f59e0b);border:none;border-radius:7px;color:#fff;font-size:11px;font-weight:700;cursor:pointer;">₹299/mo</button>
                  </div>
                  <div style="display:flex;align-items:center;justify-content:space-between;background:rgba(245,158,11,0.06);border-radius:8px;padding:8px 10px;">
                    <span style="font-size:12px;color:#fff;">⚔️🏆 Academy — Unlimited</span>
                    <button onclick="if(typeof handlePayment==='function')handlePayment('battle_academy')" style="padding:5px 10px;background:linear-gradient(135deg,#f59e0b,#ef4444);border:none;border-radius:7px;color:#fff;font-size:11px;font-weight:700;cursor:pointer;">₹499/mo</button>
                  </div>
                </div>
              </div>
              <div style="background:rgba(239,68,68,0.08);border:1px solid rgba(239,68,68,0.3);border-radius:14px;padding:16px;margin-bottom:14px;">
                <div style="font-size:13px;font-weight:700;color:#f59e0b;margin-bottom:12px;">⚡ Or Buy Extra Battle Packs</div>
                <div style="display:flex;gap:10px;justify-content:center;">
                  <button onclick="if(typeof handlePayment==='function')handlePayment('battle_extra_10');" style="flex:1;padding:14px 8px;background:rgba(239,68,68,0.12);border:1.5px solid rgba(239,68,68,0.4);border-radius:12px;color:#fff;font-size:13px;font-weight:700;cursor:pointer;">
                    <div style="font-size:22px;margin-bottom:4px;">⚔️</div>
                    <div>+10 Battles</div>
                    <div style="font-size:18px;font-weight:800;color:#f59e0b;margin-top:4px;">₹49</div>
                    <div style="font-size:10px;color:rgba(200,195,255,0.4);">₹4.9 per battle</div>
                  </button>
                  <button onclick="if(typeof handlePayment==='function')handlePayment('battle_extra_25');" style="flex:1;padding:14px 8px;background:linear-gradient(135deg,rgba(239,68,68,0.16),rgba(245,158,11,0.14));border:2px solid rgba(245,158,11,0.55);border-radius:12px;color:#fff;font-size:13px;font-weight:700;cursor:pointer;position:relative;">
                    <div style="position:absolute;top:-9px;left:50%;transform:translateX(-50%);background:linear-gradient(135deg,#ef4444,#f59e0b);color:#fff;font-size:9px;font-weight:800;padding:2px 10px;border-radius:10px;white-space:nowrap;">BEST VALUE</div>
                    <div style="font-size:22px;margin-bottom:4px;">⚔️⚔️</div>
                    <div>+25 Battles</div>
                    <div style="font-size:18px;font-weight:800;color:#f59e0b;margin-top:4px;">₹99</div>
                    <div style="font-size:10px;color:rgba(200,195,255,0.4);">₹3.96 per battle</div>
                  </button>
                </div>
                <div style="margin-top:10px;font-size:11px;color:rgba(200,195,255,0.45);text-align:center;">Credits never expire · Add-ons stack on top of your monthly quota</div>
              </div>
            </div>`;
        }
        return;
      }
      const usage = getBattleCreatorUsage();

      const body = document.getElementById('ba-body');
      if (!body) return;
      this._stopPolling();

      body.innerHTML = `
        <button class="ba-promo-btn" style="margin-bottom:14px;" onclick="BA._renderArena()">← Back</button>
        <div class="ba-section-title">⚔️ Create New Battle</div>
        <input class="ba-input" id="ba-new-name" placeholder="Battle name (e.g. SSC CGL Showdown)" maxlength="40" />
        <select class="ba-select" id="ba-new-exam">
          <optgroup label="── SSC Exams ──">
            <option value="cgl">SSC CGL</option>
            <option value="chsl">SSC CHSL</option>
            <option value="gd">SSC GD Constable</option>
            <option value="mts">SSC MTS</option>
            <option value="cpo">SSC CPO/SI</option>
          </optgroup>
          <optgroup label="── Competitive ──">
            <option value="upsc">UPSC</option>
            <option value="jee">JEE</option>
            <option value="neet">NEET</option>
            <option value="gate">GATE</option>
            <option value="ibps">IBPS PO</option>
            <option value="cat">CAT/MBA</option>
          </optgroup>
          <optgroup label="── Classes ──">
            <option value="class10">Class 10</option>
            <option value="class12_sci">Class 12 Science</option>
            <option value="class12_com">Class 12 Commerce</option>
          </optgroup>
          <optgroup label="── Engineering ──">
            <option value="btech_cs">B.Tech CS</option>
            <option value="btech_ai">B.Tech AI/ML</option>
            <option value="btech_ec">B.Tech ECE</option>
          </optgroup>
          <optgroup label="── General ──">
            <option value="general">General Knowledge</option>
            <option value="reasoning">Logical Reasoning</option>
            <option value="maths">Mathematics</option>
          </optgroup>
        </select>
        <div style="font-size:11px;color:rgba(200,195,255,0.4);margin-bottom:10px;">
          Questions will be generated by DeepSeek AI. Max 10 players per battle.
        </div>
        <button class="ba-create-btn" id="ba-create-go-btn" onclick="BA._createBattle()">
          ⚔️ Create Battle & Go Live
        </button>
        <div id="ba-create-status" style="text-align:center;font-size:12px;color:rgba(200,195,255,0.5);"></div>`;
    },

    async _createBattle() {
      if (!isBattleCreator()) { toast('🔒 Battle Creator plan required.'); return; }
      if (!isAdmin() && !canCreateBattle()) {
        toast('⛔ No battle creations left. Buy more from the Premium page.'); return;
      }

      const nameEl = document.getElementById('ba-new-name');
      const examEl = document.getElementById('ba-new-exam');
      const statusEl = document.getElementById('ba-create-status');
      const btn    = document.getElementById('ba-create-go-btn');

      const name = nameEl?.value?.trim();
      const exam = examEl?.value;
      if (!name) { toast('Please enter a battle name.'); return; }

      if (btn) { btn.disabled = true; btn.textContent = '⚔️ Creating...'; }
      if (statusEl) statusEl.textContent = '⚡ Setting up battle room...';

      const db     = window._firebaseDb;
      const { collection, doc, setDoc } = window._firebaseFns;
      const myUid  = uid();
      const myName = getMyName();

      const battleId = 'battle_' + Date.now() + '_' + Math.random().toString(36).slice(2,7);
      const battle = {
        id: battleId,
        name,
        exam,
        creatorUid: myUid,
        creatorName: myName,
        players: [myUid],
        playerNames: { [myUid]: myName },
        questions: null,
        status: 'waiting',
        quiz: { current: 0, answers: {}, xp: {}, status: 'waiting' },
        createdAt: Date.now(),
        startedAt: null,
        countdownAt: null,
        preGenerating: false,
      };

      try {
        // Write to Firestore with a 6s timeout — must exist before opening room
        // so other users can see it and Start button can read it
        const writePromise = setDoc(doc(collection(db, 'publicBattles'), battleId), battle);
        const timeoutPromise = new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 6000));
        await Promise.race([writePromise, timeoutPromise]);

        // Deduct quota
        const currentUsage = getBattleCreatorUsage();
        if (!isAdmin() && currentUsage >= MAX_BATTLES_MONTH) {
          useBattleExtraCredit();
        } else {
          incrementBattleUsage();
        }

        toast('⚔️ Battle room live! AI is preparing questions...', 3000);

        // Open room for admin (Firestore doc confirmed written)
        this._openBattle(battleId, battle);

        // Pre-generate questions silently in background
        this._pregenerateQuestions(battleId, exam);

      } catch(e) {
        toast('❌ Error creating battle: ' + (e.message || 'Check connection'), 4000);
        if (btn) { btn.disabled = false; btn.textContent = '⚔️ Create Battle & Go Live'; }
        if (statusEl) statusEl.textContent = '';
      }
    },

    /* ── Join a battle ── */
    async _joinBattle(battleId) {
      const db = window._firebaseDb;
      const { doc, getDoc, updateDoc, arrayUnion } = window._firebaseFns;
      const myUid = uid();
      const myName = getMyName();

      try {
        const snap = await getDoc(doc(db, 'publicBattles', battleId));
        if (!snap.exists()) { toast('❌ Battle not found.'); return; }
        const battle = snap.data();

        if ((battle.players || []).length >= MAX_PLAYERS) {
          toast('❌ This battle is full!');
          // Auto-hide the card
          const card = document.getElementById(`ba-card-${battleId}`);
          if (card) {
            card.classList.add('full');
            setTimeout(() => { card.style.transition='opacity 0.5s'; card.style.opacity='0'; setTimeout(()=>card.remove(),500); }, 3000);
          }
          return;
        }

        await updateDoc(doc(db, 'publicBattles', battleId), {
          players: arrayUnion(myUid),
          ['playerNames.' + myUid]: myName
        });

        const updatedPlayers = [...(battle.players||[]), myUid];
        const updatedBattle = { ...battle, players: updatedPlayers, playerNames: { ...(battle.playerNames||{}), [myUid]: myName } };

        this._openBattle(battleId, updatedBattle);

        // ── Auto-start: slot is now full — the user who filled the last slot
        //    triggers AI generation. Race condition is safe: _generateAndStart
        //    checks for 'generating' status in Firestore first, so only one
        //    client will actually call the AI.
        if (updatedPlayers.length >= MAX_PLAYERS) {
          toast('🔥 Battle slot full! AI is generating questions for all players...', 4000);
          await this._generateAndStart(battleId, battle.exam);
        }

      } catch(e) {
        toast('❌ Could not join battle: ' + (e.message||'Error'));
      }
    },

    _rejoinBattle(battleId) {
      this._activeBattleId = battleId;
      this._pollGameBattle(battleId);
    },

    /* ── Open battle room ── */
    _openBattle(battleId, battleData) {
      this._stopPolling();
      this._activeBattleId = battleId;
      this._lastBattleData = battleData;  // stored so _backToList can check creator
      this._renderBattleRoom(battleData);
      // Start polling this battle
      this._pollGameInterval = setInterval(() => this._pollGameBattle(battleId), POLL_ACTIVE_GAME);
    },

    async _pollGameBattle(battleId) {
      const db = window._firebaseDb;
      const { doc, getDoc } = window._firebaseFns;
      try {
        const snap = await getDoc(doc(db, 'publicBattles', battleId));
        // Doc may not exist yet if Firestore write is still in flight — keep polling
        if (!snap.exists()) return;
        const data = snap.data();

        if (data.status === 'generating') {
          this._renderGeneratingScreen();
        } else if (data.status === 'countdown') {
          this._handleCountdown(data, battleId);
        } else if (data.status === 'active') {
          this._renderBattleRoom(data);
        } else if (data.status === 'finished') {
          this._stopPolling();
          this._renderBattleWinner(data);
        } else {
          this._renderBattleRoom(data);
        }
      } catch(e) {}
    },

    /* ── Generating screen shown to all players while AI works ── */
    _genScreenStart: null,
    _genTimerInterval: null,
    _renderGeneratingScreen() {
      if (!this._activeBattleId) return;
      const body = document.getElementById('ba-body');
      if (!body) return;

      // Only inject HTML once so the timer element can update in-place
      if (!document.getElementById('ba-gen-elapsed')) {
        this._genScreenStart = Date.now();
        body.innerHTML = `
          <div style="text-align:center;padding:48px 16px;">
            <div class="ba-spinner" style="width:48px;height:48px;border-width:4px;margin:0 auto 20px;"></div>
            <div style="font-size:20px;font-weight:800;color:#fff;margin-bottom:8px;">🤖 AI is generating questions...</div>
            <div style="font-size:13px;color:rgba(200,195,255,0.55);line-height:1.6;">
              DeepSeek AI is crafting ${QUESTIONS_PER_BATTLE} unique questions for this battle.<br>
              All players will receive the <strong style="color:#a78bfa;">same questions</strong> at the same time.
            </div>
            <div id="ba-gen-elapsed" style="margin-top:14px;font-size:13px;color:rgba(200,195,255,0.4);">⏱ Working... 0s</div>
            <div id="ba-gen-hint" style="margin-top:8px;font-size:12px;color:rgba(200,195,255,0.28);min-height:18px;"></div>
          </div>`;

        // Live elapsed counter
        if (this._genTimerInterval) clearInterval(this._genTimerInterval);
        this._genTimerInterval = setInterval(() => {
          const el = document.getElementById('ba-gen-elapsed');
          const hint = document.getElementById('ba-gen-hint');
          if (!el) { clearInterval(this._genTimerInterval); return; }
          const secs = Math.floor((Date.now() - this._genScreenStart) / 1000);
          el.textContent = `⏱ Working... ${secs}s`;
          if (hint) {
            if (secs >= 30) hint.textContent = '☕ AI server is warming up — almost there!';
            else if (secs >= 15) hint.textContent = '🔄 Taking a bit longer than usual, please wait...';
            else hint.textContent = 'This usually takes 5–20 seconds.';
          }
        }, 1000);
      }
    },

    _renderBattleRoom(battle) {
      if (!this._activeBattleId) return;
      const body = document.getElementById('ba-body');
      if (!body) return;

      const myUid = uid();
      const isCreator = battle.creatorUid === myUid;
      const playerCount = (battle.players || []).length;
      const playerNames = Object.values(battle.playerNames || {});

      if (battle.status === 'generating') {
        this._renderGeneratingScreen();
        return;
      }

      if (battle.status === 'waiting') {
        // Waiting room
        const slotsLeft = MAX_PLAYERS - playerCount;
        body.innerHTML = `
          <button class="ba-promo-btn" style="margin-bottom:14px;" onclick="BA._backToList()">← Leave</button>
          <div style="text-align:center;padding:16px 0 8px;">
            <div style="font-size:32px;margin-bottom:8px;">⚔️</div>
            <div style="font-size:18px;font-weight:800;color:#fff;margin-bottom:4px;">${battle.name || 'Quiz Battle'}</div>
            <div style="font-size:12px;color:rgba(200,195,255,0.5);">📚 ${battle.exam || 'General'}</div>
          </div>
          <div style="background:rgba(74,222,128,0.08);border:1px solid rgba(74,222,128,0.2);border-radius:12px;padding:14px;margin:12px 0;text-align:center;">
            <div style="font-size:13px;color:#4ade80;font-weight:700;">🟢 Waiting for players...</div>
            <div style="font-size:12px;color:rgba(200,195,255,0.5);margin-top:4px;">${playerCount}/${MAX_PLAYERS} joined · ${slotsLeft} slot${slotsLeft!==1?'s':''} left</div>
          </div>
          <div class="ba-section-title">👥 Players Joined</div>
          <div class="ba-players-list">
            ${playerNames.map(n => `<div class="ba-player-chip">${n}</div>`).join('')}
          </div>
          ${(() => {
            if (isCreator) {
              const questionsReady = battle.questions && battle.questions.length >= QUESTIONS_PER_BATTLE;
              const preGenerating = battle.preGenerating;
              const btnLabel = questionsReady
                ? '🚀 Start Battle Now! (' + playerCount + ' player' + (playerCount!==1?'s':'') + ')'
                : '⚔️ Start Battle (' + playerCount + ' player' + (playerCount!==1?'s':'') + ')';
              const statusLine = questionsReady
                ? '<div style="font-size:11px;color:#4ade80;text-align:center;margin-top:6px;">✅ Questions ready — battle starts instantly!</div>'
                : preGenerating
                ? '<div style="font-size:11px;color:#a78bfa;text-align:center;margin-top:6px;"><span class="ba-spinner" style="width:10px;height:10px;border-width:2px;display:inline-block;vertical-align:middle;margin-right:4px;"></span>AI preparing questions in background...</div>'
                : '<div style="font-size:11px;color:rgba(200,195,255,0.4);text-align:center;margin-top:6px;">Battle auto-starts when all ' + MAX_PLAYERS + ' slots are filled.</div>';
              const bid = BA._activeBattleId || battle.id || '';
              return '<button class="ba-create-btn" onclick="BA._startCountdown(\'' + bid + '\')">' + btnLabel + '</button>' + statusLine;
            } else {
              return '<div style="text-align:center;padding:16px;color:rgba(200,195,255,0.4);font-size:13px;">⏳ Waiting for the battle creator to start...<br><span style="font-size:11px;opacity:0.6;">Battle also auto-starts when all ' + MAX_PLAYERS + ' slots are filled.</span></div>';
            }
          })()}`;

      } else if (battle.status === 'active') {
        this._renderActiveQuiz(battle);
      }
    },

    /* ── Start countdown (creator / admin only) ── */
    async _startCountdown(battleId) {
      if (!battleId) { toast('❌ Battle ID missing — please recreate the battle.'); return; }
      const db = window._firebaseDb;
      const { doc, getDoc, updateDoc } = window._firebaseFns;

      // Disable the start button immediately to prevent double-clicks
      const startBtn = document.querySelector('.ba-create-btn');
      if (startBtn) { startBtn.disabled = true; startBtn.textContent = '⏳ Starting...'; }

      try {
        const snap = await getDoc(doc(db, 'publicBattles', battleId));
        if (!snap.exists()) {
          toast('❌ Battle room not found in database. Please recreate.', 4000);
          if (startBtn) { startBtn.disabled = false; startBtn.textContent = '⚔️ Start Battle'; }
          return;
        }
        const battle = snap.data();

        // If already generating/countdown/active/finished — do not double-trigger
        if (['generating','countdown','active','finished'].includes(battle.status)) return;

        // ── FAST PATH: questions already pre-generated in background ──
        if (battle.questions && battle.questions.length >= QUESTIONS_PER_BATTLE) {
          toast('🚀 Starting battle!', 2000);
          await updateDoc(doc(db, 'publicBattles', battleId), {
            status: 'countdown',
            countdownAt: Date.now()
          });
          this._handleCountdown({ ...battle, countdownAt: Date.now() }, battleId);
          return;
        }

        // ── SLOW PATH: questions not ready yet — generate now ──
        toast('⏳ Generating questions... almost ready!', 3000);
        await this._generateAndStart(battleId, battle.exam);
      } catch(e) {
        toast('❌ Could not start: ' + (e.message || 'Check connection'));
        if (startBtn) { startBtn.disabled = false; startBtn.textContent = '⚔️ Start Battle'; }
      }
    },

    /* ── Silent background pre-generation — called at room creation ── */
    async _pregenerateQuestions(battleId, exam) {
      // Runs silently — no UI changes. Just fills questions[] in Firestore
      // so _startCountdown can use the fast path.
      try {
        const db = window._firebaseDb;
        const { doc, getDoc, updateDoc } = window._firebaseFns;

        // Mark as pre-generating (custom internal flag, not changing visible status)
        await updateDoc(doc(db, 'publicBattles', battleId), { preGenerating: true });

        const questions = await _generateBattleQuestions(exam, QUESTIONS_PER_BATTLE);

        if (questions && questions.length > 0) {
          // Write questions but keep status as 'waiting' — room stays open for joins
          await updateDoc(doc(db, 'publicBattles', battleId), {
            questions,
            preGenerating: false
          });
          // Flash a subtle indicator for the creator
          try { if (typeof showToast === 'function') showToast('✅ Questions ready! Hit Start anytime.', 3000); } catch(e) {}
        } else {
          // Pre-gen failed silently — _startCountdown slow path will handle it
          await updateDoc(doc(db, 'publicBattles', battleId), { preGenerating: false });
        }
      } catch(e) {
        // Swallow — slow path in _startCountdown is the fallback
      }
    },

    /* ── Core: generate questions via DeepSeek, write to Firestore, then begin countdown ── */
    async _generateAndStart(battleId, examHint) {
      const db = window._firebaseDb;
      const { doc, getDoc, updateDoc } = window._firebaseFns;

      try {
        // Race guard: mark status 'generating' — if another client already did this, abort.
        const snap = await getDoc(doc(db, 'publicBattles', battleId));
        if (!snap.exists()) return;
        const battle = snap.data();

        // If already generating/countdown/active/finished — do not call AI again
        if (['generating','countdown','active','finished'].includes(battle.status)) return;

        // Claim the generation slot
        await updateDoc(doc(db, 'publicBattles', battleId), { status: 'generating' });

        const exam = examHint || battle.exam;
        const questions = await _generateBattleQuestions(exam, QUESTIONS_PER_BATTLE);

        if (!questions || questions.length === 0) {
          // Revert so creator can retry
          await updateDoc(doc(db, 'publicBattles', battleId), { status: 'waiting' });
          toast('❌ AI question generation failed. Creator can retry starting the battle.', 4000);
          return;
        }

        // Write questions + kick off countdown — all players see identical questions
        await updateDoc(doc(db, 'publicBattles', battleId), {
          questions,
          status: 'countdown',
          countdownAt: Date.now()
        });

        // Show countdown on this client immediately
        this._handleCountdown({ ...battle, questions, countdownAt: Date.now(), creatorUid: battle.creatorUid }, battleId);

      } catch(e) {
        toast('❌ Could not start battle: ' + (e.message || 'Error'));
        try {
          const { doc, updateDoc } = window._firebaseFns;
          await updateDoc(doc(window._firebaseDb, 'publicBattles', battleId), { status: 'waiting' });
        } catch(_) {}
      }
    },

    /* ── Countdown 3-2-1 overlay ── */
    _countdownShown: false,
    _handleCountdown(data, battleId) {
      if (this._countdownShown) return;
      this._countdownShown = true;

      // Show fullscreen overlay
      const overlay = document.createElement('div');
      overlay.className = 'ba-countdown-overlay';
      overlay.id = 'ba-countdown-overlay';
      overlay.innerHTML = `
        <div class="ba-countdown-num" id="ba-cdown-num">3</div>
        <div class="ba-countdown-label">Get ready to battle!</div>`;
      document.body.appendChild(overlay);

      let count = 3;
      const numEl = overlay.querySelector('#ba-cdown-num');

      const tick = () => {
        count--;
        if (count > 0) {
          if (numEl) {
            numEl.textContent = count;
            // Re-trigger animation
            numEl.style.animation = 'none';
            void numEl.offsetWidth;
            numEl.style.animation = 'ba-countpop 0.6s ease';
          }
          setTimeout(tick, 1000);
        } else {
          // Show "GO!"
          if (numEl) {
            numEl.textContent = 'GO!';
            numEl.style.animation = 'none';
            void numEl.offsetWidth;
            numEl.style.animation = 'ba-countpop 0.6s ease';
          }
          // Activate battle in Firestore (creator only)
          const myUid = uid();
          if (data.creatorUid === myUid) {
            const db = window._firebaseDb;
            const { doc, updateDoc } = window._firebaseFns;
            updateDoc(doc(db, 'publicBattles', battleId), {
              status: 'active',
              startedAt: Date.now(),
              'quiz.status': 'active'
            }).catch(()=>{});
          }
          setTimeout(() => {
            overlay.remove();
            this._countdownShown = false;
            this._pollGameBattle(battleId);
          }, 800);
        }
      };

      setTimeout(tick, 1000);
    },

    /* ── Active Quiz UI ── */
    _renderActiveQuiz(battle) {
      const body = document.getElementById('ba-body');
      if (!body) return;

      const quiz = battle.quiz || {};
      const qi = quiz.current || 0;
      const questions = battle.questions || [];
      const q = questions[qi];
      if (!q) { this._renderBattleWinner(battle); return; }

      const answered = quiz.answers && quiz.answers[qi];
      const myUid = uid();
      const iAnswered = answered && answered.uid === myUid;

      const battleId = battle.id || this._activeBattleId;

      body.innerHTML = `
        <div class="ba-active-wrap">
          <div class="ba-quiz-progress">
            <span>Question ${qi+1} / ${questions.length}</span>
            <span style="color:#f59e0b;">${quiz.xp && quiz.xp[myUid] ? '⚡ '+quiz.xp[myUid]+' XP' : '⚡ 0 XP'}</span>
          </div>
          <div class="ba-quiz-bar"><div class="ba-quiz-bar-fill" style="width:${(qi/questions.length)*100}%"></div></div>
          <div class="ba-quiz-q">${q.q}</div>
          <div class="ba-quiz-opts">
            ${q.opts.map((o,j) => {
              let cls = 'ba-quiz-opt';
              if (answered) {
                if (j === q.ans) cls += ' correct';
                else if (j === (answered.chosen) && j !== q.ans) cls += ' wrong';
                else cls += ' dim';
              }
              return `<button class="${cls}" ${answered ? 'disabled' : ''}
                onclick="${answered ? '' : `BA._submitAnswer('${battleId}',${qi},${j})`}">
                <span class="ba-opt-letter">${String.fromCharCode(65+j)}</span>
                <span>${o}</span>
              </button>`;
            }).join('')}
          </div>
          ${answered
            ? `<div class="ba-quiz-answered-banner ${answered.correct ? 'correct' : 'wrong'}">
                ${answered.correct ? '✅ Correct!' : '❌ Wrong!'} 
                <strong>${answered.name}</strong> answered first
                ${answered.correct ? ' — <b>+10 XP</b>' : ''}
              </div>
              <div class="ba-quiz-exp">💡 ${q.exp || 'Great work!'}</div>`
            : `<div class="ba-quiz-waiting">⚡ Be first to answer and earn <b>+10 XP</b>!</div>`
          }
          ${this._renderXPBoard(quiz, battle.playerNames)}
        </div>`;
    },

    _renderXPBoard(quiz, playerNames) {
      const xp = quiz.xp || {};
      const entries = Object.entries(xp).sort((a,b) => b[1]-a[1]);
      if (!entries.length) return '';
      const myUid = uid();
      return `<div class="ba-xp-board">
        <div style="font-size:11px;font-weight:700;letter-spacing:0.08em;color:rgba(200,195,255,0.4);text-transform:uppercase;margin-bottom:8px;">⚡ Live XP Board</div>
        ${entries.map(([u,x],i) => `
          <div class="ba-xp-row ${u===myUid?'me':''}">
            <span class="ba-xp-rank">${['🥇','🥈','🥉'][i]||'#'+(i+1)}</span>
            <span class="ba-xp-name">${(playerNames&&playerNames[u])||'Player'}</span>
            <span class="ba-xp-val">${x} XP</span>
          </div>`).join('')}
      </div>`;
    },

    async _submitAnswer(battleId, qi, chosenIdx) {
      const db = window._firebaseDb;
      const { doc, getDoc, updateDoc } = window._firebaseFns;
      const myUid = uid();
      const myName = getMyName();

      try {
        const snap = await getDoc(doc(db, 'publicBattles', battleId));
        if (!snap.exists()) return;
        const battle = snap.data();
        const quiz = battle.quiz || {};

        if (quiz.answers && quiz.answers[qi]) return; // already answered
        if (quiz.current !== qi) return; // stale

        const q = battle.questions[qi];
        const correct = chosenIdx === q.ans;
        const xpEarned = correct ? 10 : 0;
        const currentXP = (quiz.xp && quiz.xp[myUid]) || 0;
        const nextIdx = qi + 1;
        const isLast = nextIdx >= battle.questions.length;

        // Optimistic UI
        if (correct) {
          toast('✅ Correct! +10 XP', 2000);
          addBattleXP(10);
        } else {
          toast('❌ Wrong! Better luck next question.', 2000);
        }

        const updates = {
          ['quiz.answers.' + qi]: { uid: myUid, name: myName, chosen: chosenIdx, correct, ts: Date.now() },
          ['quiz.xp.' + myUid]: currentXP + xpEarned,
          ['quiz.current']: isLast ? qi : nextIdx,
          ['quiz.status']: isLast ? 'finished' : 'active',
        };

        if (isLast) {
          updates.status = 'finished';
        }

        await updateDoc(doc(db, 'publicBattles', battleId), updates);

        // If last question, save to leaderboard
        if (isLast) {
          const finalXP = currentXP + xpEarned;
          await this._saveToLeaderboard(myUid, myName, finalXP);
        }

      } catch(e) {
        toast('❌ Submit error. Check connection.', 2000);
      }
    },

    /* ── Winner screen ── */
    _renderBattleWinner(battle) {
      const body = document.getElementById('ba-body');
      if (!body) return;

      const xp = battle.quiz?.xp || {};
      const sorted = Object.entries(xp).sort((a,b) => b[1]-a[1]);
      const winner = sorted[0];
      const myUid = uid();
      const playerNames = battle.playerNames || {};

      body.innerHTML = `
        <div class="ba-winner-wrap">
          <div class="ba-winner-trophy">${winner && winner[0] === myUid ? '🏆' : '🎯'}</div>
          <div class="ba-winner-title">Battle Over!</div>
          <div class="ba-winner-name">
            ${winner
              ? `🥇 Winner: <strong style="color:#f59e0b">${playerNames[winner[0]]||'Player'}</strong> with ${winner[1]} XP`
              : 'No scores yet'}
          </div>
        </div>
        <div class="ba-results-grid">
          ${sorted.slice(0,6).map(([u,x],i) => `
            <div class="ba-result-stat">
              <div class="ba-result-stat-val">${['🥇','🥈','🥉'][i]||'#'+(i+1)} ${x}</div>
              <div class="ba-result-stat-lbl">${(playerNames[u]||'Player')} XP</div>
            </div>`).join('')}
        </div>
        <div style="text-align:center;margin-top:16px;display:flex;gap:8px;justify-content:center;flex-wrap:wrap;">
          <button class="ba-join-btn" onclick="BA._backToList()">← Back to Arena</button>
          <button class="ba-join-btn" style="background:linear-gradient(135deg,#6C63FF,#a78bfa);" onclick="BA.openLeaderboard()">🏆 Leaderboard</button>
        </div>`;
    },

    _backToList() {
      const battleId = this._activeBattleId;
      if (battleId) {
        const myUid = uid();
        // Creators leaving should NOT hide their battle from the arena list.
        // Only non-creators get their slot freed and the battle hidden from them.
        const isCreator = this._lastBattleData && this._lastBattleData.creatorUid === myUid;
        if (!isCreator) {
          window._markBattleQuit(battleId);
          window._removePlayerFromBattle(battleId);
        }
      }
      this._stopPolling();
      this._activeBattleId = null;
      this._countdownShown = false;
      this._renderArena();
    },

    /* ── Save XP to Leaderboard ── */
    async _saveToLeaderboard(userUid, userName, battleXP) {
      try {
        const db = window._firebaseDb;
        const { doc, getDoc, setDoc, updateDoc } = window._firebaseFns;
        const weekKey = getWeekKey();
        const docId = weekKey + '_' + userUid;

        const snap = await getDoc(doc(db, 'battleLeaderboard', docId));
        const existing = snap.exists() ? snap.data() : null;

        const totalXP = (existing?.xp || 0) + battleXP;
        const battles = (existing?.battles || 0) + 1;
        const wins = existing?.wins || 0;

        await setDoc(doc(db, 'battleLeaderboard', docId), {
          uid: userUid,
          name: userName,
          xp: totalXP,
          battles,
          wins,
          weekKey,
          updatedAt: Date.now()
        });

        // Check if this user should get weekly free premium
        this._checkWeeklyReward(weekKey);

      } catch(e) {}
    },

    async _saveWin(battleId) {
      try {
        const db = window._firebaseDb;
        const { doc, getDoc, updateDoc } = window._firebaseFns;
        const weekKey = getWeekKey();
        const myUid = uid();
        const docId = weekKey + '_' + myUid;
        const snap = await getDoc(doc(db, 'battleLeaderboard', docId));
        if (snap.exists()) {
          await updateDoc(doc(db, 'battleLeaderboard', docId), { wins: (snap.data().wins||0)+1 });
        }
      } catch(e) {}
    },

    /* ── Weekly Reward Check ── */
    async _checkWeeklyReward(weekKey) {
      // This runs client-side only as a best-effort — real enforcement should be server-side
      // For now, identify the top user and mark them for premium in the DB
      try {
        const db = window._firebaseDb;
        const { collection, query, where, orderBy, limit, getDocs, doc, updateDoc } = window._firebaseFns;
        const q = query(
          collection(db, 'battleLeaderboard'),
          where('weekKey', '==', weekKey),
          orderBy('xp', 'desc'),
          limit(1)
        );
        const snap = await getDocs(q);
        if (!snap.empty) {
          const topUser = snap.docs[0].data();
          // Update the top user's record with weekly winner flag
          await updateDoc(snap.docs[0].ref, { weeklyWinner: true });

          // If this device is the top user — grant them free premium
          if (topUser.uid === uid()) {
            const alreadyRewarded = localStorage.getItem('sscai_weekly_reward_week') === weekKey;
            if (!alreadyRewarded) {
              localStorage.setItem('sscai_weekly_reward_week', weekKey);
              // Grant premium
              const u = window._firebaseAuth?.currentUser;
              const p = u ? ('sscai_u:' + u.uid + ':') : 'sscai_guest:';
              localStorage.setItem(p + 'premium', 'true');
              localStorage.setItem(p + 'premium_plan', 'battle_weekly_reward');
              localStorage.setItem('sscai_premium', 'true');
              if (typeof state !== 'undefined') state.isPremium = true;
              if (typeof updateUserUI === 'function') updateUserUI();
              if (typeof updateLimitUI === 'function') updateLimitUI();
              toast('🏆 YOU ARE THIS WEEK\'S TOP FIGHTER! 🎉 FREE Premium (1 month) unlocked — ₹1299 value!', 7000);
            }
          }
        }
      } catch(e) {}
    },

    /* ─────────────────────────────────────────────────────────
     * LEADERBOARD
     * ───────────────────────────────────────────────────────── */
    _lbTab: 'weekly',

    async openLeaderboard() {
      injectStyles();
      createModals();
      document.getElementById('lb-modal').classList.add('open');
      this._lbTab = 'weekly';
      await this._renderLeaderboard();
    },

    async _renderLeaderboard() {
      const body = document.getElementById('lb-body');
      if (!body) return;

      body.innerHTML = `<div class="ba-loading"><div class="ba-spinner"></div>Loading leaderboard...</div>`;

      // Guard: firebase not ready
      if (!window._firebaseDb || !window._firebaseFns) {
        body.innerHTML = `<div class="ba-empty">⏳ Connecting... please reopen in a moment.</div>`;
        return;
      }

      try {
        const db = window._firebaseDb;
        const { collection, query, where, orderBy, limit, getDocs } = window._firebaseFns;
        const weekKey = getWeekKey();
        const myUid = uid();

        // Fetch weekly top 50
        let weeklyEntries = [];
        try {
          const q = query(collection(db, 'battleLeaderboard'), where('weekKey','==',weekKey), orderBy('xp','desc'), limit(50));
          const snap = await getDocs(q);
          weeklyEntries = snap.docs.map(d => d.data());
        } catch(e) {
          // Fallback without orderBy (composite index not ready yet)
          try {
            const q2 = query(collection(db, 'battleLeaderboard'), where('weekKey','==',weekKey));
            const snap2 = await getDocs(q2);
            weeklyEntries = snap2.docs.map(d => d.data()).sort((a,b)=>b.xp-a.xp).slice(0,50);
          } catch(e2) {
            // Collection may not exist yet — treat as empty, show empty state
            weeklyEntries = [];
          }
        }

        // My local XP (in case I haven't finished a battle yet)
        const myBattleXP = getBattleXP();

        // Merge my local XP if not in list
        const myInList = weeklyEntries.find(e => e.uid === myUid);
        if (!myInList && myBattleXP > 0) {
          weeklyEntries.push({ uid: myUid, name: getMyName(), xp: myBattleXP, battles: 1, wins: 0, weekKey, _local: true });
          weeklyEntries.sort((a,b) => b.xp - a.xp);
        }

        this._renderLbContent(body, weeklyEntries, weekKey, myUid);

      } catch(e) {
        // Render empty leaderboard instead of error (collection may not exist yet)
        try {
          this._renderLbContent(body, [], getWeekKey(), uid());
        } catch(e2) {
          body.innerHTML = `<div class="ba-empty">📭 No battles played yet this week.<br>Be the first to compete! ⚔️</div>`;
        }
      }
    },

    _renderLbContent(body, entries, weekKey, myUid) {
      const myRank = entries.findIndex(e => e.uid === myUid) + 1;
      const myData = entries.find(e => e.uid === myUid);

      let html = `
        <div class="lb-weekly-notice">
          🏆 <strong>Weekly Battle XP Race</strong><br>
          The user with the most XP this week wins <strong>FREE Premium (1 month — ₹1299 value)</strong>! 
          Includes unlimited queries, image & PDF uploads, Vision Pro.<br>
          <span style="font-size:10px;opacity:0.7;">Week resets every Monday. Winner auto-gets premium.</span>
        </div>

        <div class="lb-tab-row">
          <button class="lb-tab active" onclick="BA._switchLbTab('weekly', this)">📅 This Week</button>
          <button class="lb-tab" onclick="BA._switchLbTab('all', this)">🌐 All Time</button>
        </div>`;

      if (myRank > 0 && myData) {
        const levelData = getLevelTitle(Math.floor(myData.xp / 10));
        html += `
          <div style="background:rgba(108,99,255,0.1);border:1px solid rgba(108,99,255,0.3);border-radius:12px;padding:12px 14px;margin-bottom:14px;display:flex;align-items:center;gap:12px;">
            <div style="font-size:24px;">${levelData.emoji}</div>
            <div style="flex:1;">
              <div style="font-size:13px;font-weight:700;color:#fff;">Your Rank: #${myRank}</div>
              <div style="font-size:11px;color:rgba(200,195,255,0.5);">Level ${Math.floor(myData.xp/10)} ${levelData.title} · ${myData.xp} XP</div>
            </div>
            <div style="text-align:right;">
              <div style="font-size:14px;font-weight:800;color:#f59e0b;">${myData.xp} XP</div>
              <div style="font-size:10px;color:rgba(200,195,255,0.4);">${myData.battles||0} battles</div>
            </div>
          </div>`;
      }

      if (entries.length === 0) {
        html += `<div class="ba-empty">📭 No battles this week yet.<br>Be the first to compete! ⚔️</div>`;
      } else {
        entries.forEach((e, i) => {
          const isMe = e.uid === myUid;
          const rank = i + 1;
          const rankEmoji = ['🥇','🥈','🥉'][i] || `#${rank}`;
          const level = Math.floor((e.xp || 0) / 10);
          const levelData = getLevelTitle(level);
          const initial = (e.name||'?').charAt(0).toUpperCase();

          html += `
            <div class="lb-row ${isMe?'me':''} ${rank<=3?'top3':''}">
              <div class="lb-rank">${rankEmoji}</div>
              <div class="lb-avatar" style="background:linear-gradient(135deg,${levelData.color}44,${levelData.color}22);color:${levelData.color};">${initial}</div>
              <div class="lb-info">
                <div class="lb-name">${e.name||'Student'} ${isMe?'<span style="font-size:10px;background:rgba(108,99,255,0.2);color:#a78bfa;padding:1px 6px;border-radius:10px;">You</span>':''}</div>
                <div class="lb-level" style="color:${levelData.color};">${levelData.emoji} Lv.${level} ${levelData.title}</div>
              </div>
              <div class="lb-xp-col">
                <div class="lb-xp-val">${e.xp||0}</div>
                <div class="lb-xp-lbl">${e.battles||0} battles</div>
              </div>
            </div>`;
        });
      }

      body.innerHTML = html;
    },

    _switchLbTab(tab, btn) {
      this._lbTab = tab;
      document.querySelectorAll('.lb-tab').forEach(b => b.classList.remove('active'));
      if (btn) btn.classList.add('active');
      // For now both tabs show same data (weekly). All-time would need a separate collection.
      this._renderLeaderboard();
    }
  };

  /* ─── AI QUESTION GENERATOR for battles ─────────────────── */
  const BATTLE_EXAM_LABELS = {
    cgl: 'SSC CGL (Quantitative Aptitude, Reasoning, English, GK)',
    chsl: 'SSC CHSL (10+2 level exam)',
    gd: 'SSC GD Constable (Basic Maths, GK, Reasoning)',
    mts: 'SSC MTS (10th level)',
    cpo: 'SSC CPO/SI',
    upsc: 'UPSC General Studies',
    jee: 'JEE Mains (Physics, Chemistry, Maths)',
    neet: 'NEET (Biology, Physics, Chemistry)',
    gate: 'GATE CS (DSA, OS, DBMS, Networks)',
    ibps: 'IBPS PO (Quant, Reasoning, English)',
    cat: 'CAT MBA Entrance (Quant, DILR, VARC)',
    class10: 'Class 10 CBSE (Maths, Science, Social)',
    class12_sci: 'Class 12 Science (Physics, Chemistry, Maths)',
    class12_com: 'Class 12 Commerce (Accounts, Economics, Business)',
    btech_cs: 'B.Tech CS (DSA, OS, DBMS, Networks, OOP)',
    btech_ai: 'B.Tech AI/ML (Machine Learning, Deep Learning, Python)',
    btech_ec: 'B.Tech ECE (Electronics, Signals, Communication)',
    general: 'General Knowledge (India, Science, Current Affairs)',
    reasoning: 'Logical Reasoning (Series, Analogies, Coding)',
    maths: 'Mathematics (Arithmetic, Algebra, Geometry)',
  };

  async function _generateBattleQuestions(exam, count) {
    const label = BATTLE_EXAM_LABELS[exam] || exam;
    const prompt = `Generate exactly ${count} MCQ questions for an online quiz battle on: ${label}. 
Mix easy (30%), medium (50%), hard (20%) difficulty.
Return ONLY a valid JSON array, no markdown, no explanation:
[{"q":"question text","opts":["A text","B text","C text","D text"],"ans":0,"topic":"Topic","exp":"Brief explanation"}]
"ans" is the 0-based index of the correct option.`;

    // 50-second timeout — prevents silent hang on Cloud Run cold starts
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 50000);

    try {
      const res = await fetch(DS_URL, {
        method: 'POST',
        signal: controller.signal,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [{ role: 'user', content: prompt }],
          max_tokens: 2000,
          temperature: 0.7,
          model: 'deepseek-chat',
          mode: 'cgl',
          lang: 'english'
        })
      });
      clearTimeout(timer);
      const d = await res.json();
      const raw = d.choices?.[0]?.message?.content || null;
      if (!raw) return [];
      return extractJsonArray(raw) || [];
    } catch(e) {
      clearTimeout(timer);
      return [];
    }
  }

  function extractJsonArray(text) {
    if (!text) return null;
    let s = text.replace(/```json|```/gi, '').trim();
    try { const r = JSON.parse(s); if (Array.isArray(r) && r.length) return r; } catch {}
    const start = s.indexOf('[');
    if (start === -1) return null;
    let depth = 0, inStr = false, esc = false, end = -1;
    for (let i = start; i < s.length; i++) {
      const c = s[i];
      if (esc) { esc = false; continue; }
      if (c === '\\' && inStr) { esc = true; continue; }
      if (c === '"') { inStr = !inStr; continue; }
      if (inStr) continue;
      if (c === '[' || c === '{') depth++;
      else if (c === ']' || c === '}') { depth--; if (!depth) { end = i; break; } }
    }
    if (end !== -1) {
      try { const r = JSON.parse(s.slice(start, end+1)); if (Array.isArray(r) && r.length) return r; } catch {}
    }
    return null;
  }

  /* ─── WIRE UP SIDEBAR BUTTONS ────────────────────────────── */
  function wireSidebarButtons() {
    const battleBtn = document.getElementById('openBattleArenaBtn');
    if (battleBtn && !battleBtn._baBound) {
      battleBtn._baBound = true;
      battleBtn.addEventListener('click', () => {
        // Close drawer first
        if (typeof closeDrawer === 'function') closeDrawer();
        setTimeout(() => BA.open(), 200);
      });
    }

    const lbBtn = document.getElementById('openLeaderboardBtn');
    if (lbBtn && !lbBtn._lbBound) {
      lbBtn._lbBound = true;
      lbBtn.addEventListener('click', () => {
        if (typeof closeDrawer === 'function') closeDrawer();
        setTimeout(() => BA.openLeaderboard(), 200);
      });
    }
  }

  /* ─── INIT ───────────────────────────────────────────────── */
  function init() {
    injectStyles();
    createModals();
    wireSidebarButtons();

    // Re-wire after DOM updates
    document.addEventListener('click', () => {
      setTimeout(wireSidebarButtons, 100);
    });

    console.info('[BattleArena] v1.0 — Public battle system loaded');
  }

  // Wait for Firebase to be ready
  if (window._firebaseDb && window._firebaseFns) {
    init();
  } else {
    let tries = 0;
    const check = setInterval(() => {
      tries++;
      if (window._firebaseDb && window._firebaseFns) {
        clearInterval(check);
        init();
      } else if (tries > 60) {
        clearInterval(check);
        // Init anyway for UI (Firebase calls will fail gracefully)
        init();
      }
    }, 500);
  }

})(window);

/* ═══════════════════════════════════════════════════════════════════════════
 * battle-arena-patch.js — ELO RANKING + COINS + COSMETICS + HIGHLIGHTS v2.0
 * Adds:
 *  1. ELO Ranking system (Bronze → Silver → Gold → Platinum → Diamond → Master → Legend)
 *  2. Instant Answer Race (1st=+10, 2nd=+8, 3rd=+6 speed points)
 *  3. Live Chat During Battle (emoji quick-reactions)
 *  4. Battle Highlights (Fastest / Accuracy King / Comeback Player)
 *  5. Coins Economy (win coins, buy avatars / name colors / profile frames)
 *  6. Cosmetic Shop (avatars, name colors, profile frames — status only, no real money)
 *  Both Online Battle Arena (BA) and Group Study battles (CF) are patched.
 * ═══════════════════════════════════════════════════════════════════════════ */
(function (global) {
  'use strict';

  /* ─────────────────────────────────────────────────────────────
   * SHARED HELPERS
   * ───────────────────────────────────────────────────────────── */
  function _uid()    { return global._firebaseAuth?.currentUser?.uid || 'guest'; }
  function _lsKey(k) { return 'sscai_u:' + _uid() + ':' + k; }
  function _lsGet(k) { try { return JSON.parse(localStorage.getItem(_lsKey(k)) || 'null'); } catch { return null; } }
  function _lsSet(k,v){ try { localStorage.setItem(_lsKey(k), JSON.stringify(v)); } catch {} }
  function _toast(m,d){ if (typeof showToast === 'function') showToast(m, d||2800); }

  /* ─────────────────────────────────────────────────────────────
   * 1. ELO SYSTEM
   * ───────────────────────────────────────────────────────────── */
  const ELO_TIERS = [
    { name: 'Bronze',   min: 0,    max: 799,   emoji: '🥉', color: '#cd7f32', bg: 'rgba(205,127,50,0.15)',  kFactor: 32 },
    { name: 'Silver',   min: 800,  max: 1099,  emoji: '🥈', color: '#b0b7c3', bg: 'rgba(176,183,195,0.15)', kFactor: 28 },
    { name: 'Gold',     min: 1100, max: 1399,  emoji: '🥇', color: '#f59e0b', bg: 'rgba(245,158,11,0.15)',  kFactor: 24 },
    { name: 'Platinum', min: 1400, max: 1699,  emoji: '💎', color: '#38bdf8', bg: 'rgba(56,189,248,0.15)',  kFactor: 20 },
    { name: 'Diamond',  min: 1700, max: 1999,  emoji: '💠', color: '#a78bfa', bg: 'rgba(167,139,250,0.15)', kFactor: 16 },
    { name: 'Master',   min: 2000, max: 2299,  emoji: '👑', color: '#FF6B9D', bg: 'rgba(255,107,157,0.15)', kFactor: 12 },
    { name: 'Legend',   min: 2300, max: 99999, emoji: '🌟', color: '#fff',    bg: 'rgba(255,255,255,0.1)',  kFactor: 10 },
  ];
  const DEFAULT_ELO = 800;

  function getEloTier(elo) {
    return ELO_TIERS.find(t => elo >= t.min && elo <= t.max) || ELO_TIERS[0];
  }

  function getMyElo() {
    const d = _lsGet('elo') || { elo: DEFAULT_ELO };
    return d.elo || DEFAULT_ELO;
  }

  function setMyElo(newElo) {
    _lsSet('elo', { elo: Math.max(0, newElo) });
  }

  /* Standard ELO formula — K-factor varies by tier */
  function calcEloChange(myElo, opponentElo, won) {
    const tier = getEloTier(myElo);
    const K = tier.kFactor;
    const expected = 1 / (1 + Math.pow(10, (opponentElo - myElo) / 400));
    const score = won ? 1 : 0;
    return Math.round(K * (score - expected));
  }

  /* Compute ELO delta after a battle: compare vs average opponent ELO */
  function updateEloAfterBattle(myUid, myXP, allXP) {
    const entries = Object.entries(allXP || {});
    if (entries.length < 2) return 0;

    const myElo = getMyElo();
    const opponentElos = entries
      .filter(([u]) => u !== myUid)
      .map(([u]) => {
        // Try to read opponent ELO from localStorage (best-effort)
        return DEFAULT_ELO; // conservative assumption for opponents
      });
    const avgOpponentElo = opponentElos.length
      ? opponentElos.reduce((a,b) => a+b, 0) / opponentElos.length
      : DEFAULT_ELO;

    const sorted = entries.sort((a,b) => b[1]-a[1]);
    const won = sorted[0]?.[0] === myUid;

    const delta = calcEloChange(myElo, avgOpponentElo, won);
    const newElo = myElo + delta;
    setMyElo(newElo);

    return delta;
  }

  /* ─────────────────────────────────────────────────────────────
   * 2. COINS ECONOMY — Arena wins only, top-3-of-10 prize model
   *   10 players → 1st=50, 2nd=30, 3rd=15, rest=0
   *   5–9 players → 1st=50, 2nd=30, rest=0
   *   2–4 players → 1st=50 only
   *   1 player    → 0 (no opponents)
   *   Group Study → 0 (no coins)
   * ───────────────────────────────────────────────────────────── */
  function getCoins() {
    return (_lsGet('coins') || { coins: 0 }).coins || 0;
  }

  function coinPrize(rank0, totalPlayers) {
    if (totalPlayers <= 1) return 0;
    if (totalPlayers >= 10) {
      if (rank0 === 0) return 50;
      if (rank0 === 1) return 30;
      if (rank0 === 2) return 15;
      return 0;
    }
    if (totalPlayers >= 5) {
      if (rank0 === 0) return 50;
      if (rank0 === 1) return 30;
      return 0;
    }
    // 2–4 players: winner only
    return rank0 === 0 ? 50 : 0;
  }

  function _syncCoinsToFirestore(total) {
    try {
      const db  = window._firebaseDb;
      const fns = window._firebaseFns;
      const u   = window._firebaseAuth?.currentUser;
      if (!db || !fns || !u) return;
      const { doc, setDoc } = fns;
      setDoc(doc(db, 'userCoins', u.uid), { coins: total, updatedAt: Date.now() }, { merge: true })
        .catch(() => {});
    } catch (_) {}
  }

  function _loadCoinsFromFirestore() {
    try {
      const db  = window._firebaseDb;
      const fns = window._firebaseFns;
      const u   = window._firebaseAuth?.currentUser;
      if (!db || !fns || !u) return;
      const { doc, getDoc } = fns;
      getDoc(doc(db, 'userCoins', u.uid)).then(snap => {
        if (snap && snap.exists()) {
          const serverCoins = snap.data().coins || 0;
          const localCoins  = getCoins();
          if (serverCoins > localCoins) _lsSet('coins', { coins: serverCoins });
        }
      }).catch(() => {});
    } catch (_) {}
  }

  function addCoins(n, reason) {
    if (n <= 0) return getCoins();
    const current  = getCoins();
    const newTotal = current + n;
    _lsSet('coins', { coins: newTotal });
    _toast(`🪙 +${n} coins! (${reason || 'Battle win'})`, 2500);
    _syncCoinsToFirestore(newTotal);
    return newTotal;
  }

  function spendCoins(n) {
    const current = getCoins();
    if (current < n) return false;
    const newTotal = current - n;
    _lsSet('coins', { coins: newTotal });
    _syncCoinsToFirestore(newTotal);
    return true;
  }

  /* ── Coin help HTML used in shop + winner screen ── */
  function coinHelpHtml() {
    return `<div style="background:rgba(245,158,11,0.06);border:1px solid rgba(245,158,11,0.2);border-radius:12px;padding:12px 14px;font-size:12px;line-height:1.7;color:rgba(255,220,150,0.85);">
      <strong>How to earn coins:</strong><br>
      🏆 <strong>Battle Arena</strong> — winners only:<br>
      &nbsp;&nbsp;• 🥇 1st place (10 players): <strong>+50 coins</strong><br>
      &nbsp;&nbsp;• 🥈 2nd place (10 players): <strong>+30 coins</strong><br>
      &nbsp;&nbsp;• 🥉 3rd place (10 players): <strong>+15 coins</strong><br>
      &nbsp;&nbsp;• With 5–9 players: top 2 win coins<br>
      &nbsp;&nbsp;• With 2–4 players: winner only<br>
      <span style="font-size:10px;color:rgba(200,195,255,0.4);">Coins are for cosmetics only — not real money. Group Study does NOT earn coins.</span>
    </div>`;
  }

  /* ─────────────────────────────────────────────────────────────
   * QUIT BATTLE LIST — hide quit battles from arena list forever
   * ───────────────────────────────────────────────────────────── */
  const QUIT_BATTLES_KEY = 'battle_quit_list';

  function getQuitList() {
    return _lsGet(QUIT_BATTLES_KEY) || [];
  }

  function markBattleQuit(battleId) {
    if (!battleId) return;
    const list = getQuitList();
    if (!list.includes(battleId)) {
      list.push(battleId);
      if (list.length > 200) list.splice(0, list.length - 200);
      _lsSet(QUIT_BATTLES_KEY, list);
    }
  }

  function hasQuitBattle(battleId) {
    return getQuitList().includes(battleId);
  }

  // Expose on window so the first IIFE can call these across scope
  window._hasQuitBattle = hasQuitBattle;
  window._markBattleQuit = markBattleQuit;

  /* Remove player from Firestore when they leave the waiting room */
  async function removePlayerFromBattle(battleId) {
    if (!battleId) return;
    const myUid = uid();
    try {
      const db  = window._firebaseDb;
      const fns = window._firebaseFns;
      if (!db || !fns) return;
      const { doc, getDoc, updateDoc, arrayRemove, deleteField } = fns;
      const snap = await getDoc(doc(db, 'publicBattles', battleId));
      if (!snap.exists()) return;
      const battle = snap.data();
      // Don't remove if already started, or if this user is the creator
      if (['active', 'countdown', 'generating', 'finished'].includes(battle.status)) return;
      if (battle.creatorUid === myUid) return;
      const updates = { players: arrayRemove(myUid) };
      if (typeof deleteField === 'function') {
        updates[`playerNames.${myUid}`] = deleteField();
      }
      await updateDoc(doc(db, 'publicBattles', battleId), updates);
    } catch (_) {}
  }

  window._removePlayerFromBattle = removePlayerFromBattle;

  /* ─────────────────────────────────────────────────────────────
   * 3. COSMETICS STORE DATA
   * ───────────────────────────────────────────────────────────── */
  const AVATARS = [
    { id: 'av_rocket',  label: '🚀 Rocket',   emoji: '🚀', price: 0,   owned: true  },
    { id: 'av_fire',    label: '🔥 Fire',      emoji: '🔥', price: 50,  owned: false },
    { id: 'av_crown',   label: '👑 Crown',     emoji: '👑', price: 100, owned: false },
    { id: 'av_brain',   label: '🧠 Brain',     emoji: '🧠', price: 80,  owned: false },
    { id: 'av_star',    label: '🌟 Star',      emoji: '🌟', price: 120, owned: false },
    { id: 'av_lightning',label:'⚡ Lightning', emoji: '⚡', price: 60,  owned: false },
    { id: 'av_shield',  label: '🛡️ Shield',   emoji: '🛡️', price: 90,  owned: false },
    { id: 'av_gem',     label: '💎 Gem',       emoji: '💎', price: 150, owned: false },
  ];

  const NAME_COLORS = [
    { id: 'nc_white',  label: 'White',   color: '#ffffff',  price: 0,   owned: true  },
    { id: 'nc_gold',   label: 'Gold',    color: '#f59e0b',  price: 80,  owned: false },
    { id: 'nc_purple', label: 'Purple',  color: '#a78bfa',  price: 60,  owned: false },
    { id: 'nc_pink',   label: 'Pink',    color: '#FF6B9D',  price: 60,  owned: false },
    { id: 'nc_cyan',   label: 'Cyan',    color: '#38bdf8',  price: 70,  owned: false },
    { id: 'nc_green',  label: 'Green',   color: '#4ade80',  price: 50,  owned: false },
    { id: 'nc_orange', label: 'Orange',  color: '#fb923c',  price: 50,  owned: false },
    { id: 'nc_legend', label: '🌈 Legend',color:'linear-gradient(90deg,#f59e0b,#FF6B9D,#a78bfa)', price: 200, owned: false },
  ];

  const PROFILE_FRAMES = [
    { id: 'pf_none',    label: 'None',       border: 'none',                                         price: 0,   owned: true  },
    { id: 'pf_gold',    label: '🥇 Gold',    border: '2px solid #f59e0b',                            price: 100, owned: false },
    { id: 'pf_purple',  label: '💜 Royal',   border: '2px solid #a78bfa',                            price: 100, owned: false },
    { id: 'pf_fire',    label: '🔥 Flame',   border: '2px solid #ef4444',                            price: 80,  owned: false },
    { id: 'pf_neon',    label: '💙 Neon',    border: '2px solid #38bdf8',                            price: 80,  owned: false },
    { id: 'pf_rainbow', label: '🌈 Rainbow', border: '2px solid transparent',                        price: 250, owned: false,
      gradient: 'linear-gradient(#13131a,#13131a) padding-box, linear-gradient(135deg,#f59e0b,#FF6B9D,#a78bfa,#38bdf8) border-box' },
  ];

  /* ── cosmetics persistence ── */
  function getCosmeticData() {
    return _lsGet('cosmetics') || {
      activeAvatar: 'av_rocket',
      activeNameColor: 'nc_white',
      activeFrame: 'pf_none',
      owned: ['av_rocket', 'nc_white', 'pf_none'],
    };
  }

  function saveCosmeticData(d) { _lsSet('cosmetics', d); }

  function isOwned(itemId) {
    const d = getCosmeticData();
    const item = [...AVATARS, ...NAME_COLORS, ...PROFILE_FRAMES].find(i => i.id === itemId);
    return item?.owned === true || d.owned.includes(itemId);
  }

  function buyItem(itemId) {
    const item = [...AVATARS, ...NAME_COLORS, ...PROFILE_FRAMES].find(i => i.id === itemId);
    if (!item) return false;
    if (isOwned(itemId)) return true;
    if (!spendCoins(item.price)) {
      _toast(`🪙 Not enough coins! You need ${item.price} coins.`, 2800);
      return false;
    }
    const d = getCosmeticData();
    d.owned = [...new Set([...d.owned, itemId])];
    saveCosmeticData(d);
    _toast(`✅ Unlocked ${item.label}!`, 2500);
    return true;
  }

  function equipItem(itemId) {
    const d = getCosmeticData();
    if (AVATARS.find(i => i.id === itemId))       d.activeAvatar    = itemId;
    if (NAME_COLORS.find(i => i.id === itemId))   d.activeNameColor = itemId;
    if (PROFILE_FRAMES.find(i => i.id === itemId))d.activeFrame     = itemId;
    saveCosmeticData(d);
  }

  function getActiveCosmetics() {
    const d = getCosmeticData();
    const avatar = AVATARS.find(i => i.id === d.activeAvatar) || AVATARS[0];
    const nameColor = NAME_COLORS.find(i => i.id === d.activeNameColor) || NAME_COLORS[0];
    const frame = PROFILE_FRAMES.find(i => i.id === d.activeFrame) || PROFILE_FRAMES[0];
    return { avatar, nameColor, frame };
  }

  /* ─────────────────────────────────────────────────────────────
   * 4. SPEED TRACKING for Instant Answer Race
   * ───────────────────────────────────────────────────────────── */
  // Stored per-battle in window._battleSpeedData
  // { battleId: { qIdx: { answers: [ {uid,name,ts,correct}, ... ] } } }
  function _speedData() {
    if (!global._battleSpeedData) global._battleSpeedData = {};
    return global._battleSpeedData;
  }

  function _recordAnswer(battleId, qIdx, uid, name, ts, correct) {
    const d = _speedData();
    if (!d[battleId]) d[battleId] = {};
    if (!d[battleId][qIdx]) d[battleId][qIdx] = { answers: [] };
    // Only record first answer per user per question
    if (!d[battleId][qIdx].answers.find(a => a.uid === uid)) {
      d[battleId][qIdx].answers.push({ uid, name, ts, correct });
    }
  }

  function _getSpeedPoints(battleId, qIdx, uid) {
    const d = _speedData();
    const answers = d[battleId]?.[qIdx]?.answers || [];
    const correctAnswers = answers.filter(a => a.correct).sort((a,b) => a.ts - b.ts);
    const pos = correctAnswers.findIndex(a => a.uid === uid);
    if (pos === 0) return 10;
    if (pos === 1) return 8;
    if (pos === 2) return 6;
    return 0;
  }

  /* ─────────────────────────────────────────────────────────────
   * 5. BATTLE HIGHLIGHTS computation
   * ───────────────────────────────────────────────────────────── */
  function computeHighlights(battle) {
    const quiz = battle?.quiz || {};
    const answers = quiz.answers || {};
    const xp = quiz.xp || {};
    const playerNames = battle?.playerNames || {};
    const questions = battle?.questions || [];

    // Fastest Answer: player who first answered correctly across all questions
    let fastestUid = null, fastestTs = Infinity;
    Object.values(answers).forEach(a => {
      if (a.correct && a.ts < fastestTs) { fastestTs = a.ts; fastestUid = a.uid; }
    });

    // Accuracy King: player with most correct answers
    const correctCount = {};
    Object.values(answers).forEach(a => {
      if (a.correct) correctCount[a.uid] = (correctCount[a.uid] || 0) + 1;
    });
    const accuracyEntries = Object.entries(correctCount).sort((a,b) => b[1]-a[1]);
    const accuracyKingUid = accuracyEntries[0]?.[0] || null;
    const accuracyKingCount = accuracyEntries[0]?.[1] || 0;

    // Comeback Player: was losing at halfway point but finished higher
    const half = Math.floor(questions.length / 2);
    const halfXP = {};
    for (let i = 0; i < half; i++) {
      const a = answers[i];
      if (a && a.correct) halfXP[a.uid] = (halfXP[a.uid] || 0) + 10;
    }
    const sortedFinal = Object.entries(xp).sort((a,b) => b[1]-a[1]);
    const sortedHalf  = Object.entries(halfXP).sort((a,b) => b[1]-a[1]);
    let comebackUid = null;
    sortedFinal.forEach(([u, fx], finalRank) => {
      const halfRank = sortedHalf.findIndex(([hu]) => hu === u);
      if (halfRank > finalRank + 1 && halfRank !== -1) {
        if (!comebackUid) comebackUid = u;
      }
    });

    return {
      fastest: fastestUid ? playerNames[fastestUid] || 'Unknown' : null,
      fastestTs,
      accuracyKing: accuracyKingUid ? playerNames[accuracyKingUid] || 'Unknown' : null,
      accuracyKingCount,
      totalQ: questions.length,
      comeback: comebackUid ? playerNames[comebackUid] || 'Unknown' : null,
    };
  }

  /* ─────────────────────────────────────────────────────────────
   * 6. INJECT ALL CSS
   * ───────────────────────────────────────────────────────────── */
  function injectEloStyles() {
    if (document.getElementById('elo-styles')) return;
    const s = document.createElement('style');
    s.id = 'elo-styles';
    s.textContent = `
      /* ── ELO Badge ── */
      .elo-badge {
        display: inline-flex; align-items: center; gap: 5px;
        padding: 3px 10px; border-radius: 20px;
        font-size: 11px; font-weight: 800; letter-spacing: 0.02em;
        border: 1px solid;
      }
      .elo-delta-pos { color: #4ade80; font-size: 12px; font-weight: 800; }
      .elo-delta-neg { color: #f87171; font-size: 12px; font-weight: 800; }

      /* ── Elo Tier Progress ── */
      .elo-progress-wrap { background: rgba(255,255,255,0.04); border-radius: 14px; padding: 14px; margin-bottom: 12px; }
      .elo-tier-row { display: flex; align-items: center; gap: 10px; margin-bottom: 8px; }
      .elo-tier-emoji { font-size: 24px; }
      .elo-tier-info { flex: 1; }
      .elo-tier-name { font-size: 14px; font-weight: 800; }
      .elo-tier-sub { font-size: 11px; color: rgba(200,195,255,0.5); margin-top: 2px; }
      .elo-bar-track { height: 6px; background: rgba(255,255,255,0.08); border-radius: 6px; overflow: hidden; }
      .elo-bar-fill { height: 100%; border-radius: 6px; transition: width 0.6s cubic-bezier(0.34,1.56,0.64,1); }

      /* ── Highlights ── */
      .ba-highlights-wrap { margin: 12px 0; }
      .ba-highlights-title { font-size: 11px; font-weight: 700; letter-spacing: 0.08em; color: rgba(200,195,255,0.4); text-transform: uppercase; margin-bottom: 8px; }
      .ba-highlights-grid { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 8px; }
      .ba-highlight-card {
        background: rgba(255,255,255,0.04); border: 1px solid rgba(108,99,255,0.15);
        border-radius: 12px; padding: 10px 8px; text-align: center;
      }
      .ba-highlight-icon { font-size: 22px; margin-bottom: 4px; }
      .ba-highlight-label { font-size: 9px; color: rgba(200,195,255,0.4); text-transform: uppercase; letter-spacing: 0.08em; margin-bottom: 3px; }
      .ba-highlight-name { font-size: 12px; font-weight: 700; color: #fff; word-break: break-word; }

      /* ── Live Chat Reactions ── */
      .ba-chat-bar {
        display: flex; gap: 6px; flex-wrap: wrap; padding: 8px 0; margin-bottom: 6px;
        border-bottom: 1px solid rgba(108,99,255,0.1);
      }
      .ba-chat-btn {
        padding: 4px 10px; background: rgba(255,255,255,0.05);
        border: 1px solid rgba(108,99,255,0.2); border-radius: 20px;
        font-size: 14px; cursor: pointer; transition: all 0.15s;
        display: flex; align-items: center; gap: 4px; color: rgba(200,195,255,0.7);
        font-size: 13px; font-family: inherit;
      }
      .ba-chat-btn:hover { background: rgba(108,99,255,0.15); border-color: rgba(108,99,255,0.4); transform: scale(1.05); }
      .ba-chat-log { max-height: 80px; overflow-y: auto; margin-bottom: 6px; }
      .ba-chat-msg {
        font-size: 12px; color: rgba(200,195,255,0.7); padding: 3px 6px;
        animation: ba-chat-in 0.3s ease;
      }
      .ba-chat-name { color: rgba(108,99,255,0.9); font-weight: 700; }
      @keyframes ba-chat-in { from { opacity:0; transform: translateY(6px); } to { opacity:1; transform:none; } }

      /* ── Coins Display ── */
      .ba-coins-badge {
        display: inline-flex; align-items: center; gap: 4px;
        padding: 3px 10px; background: rgba(245,158,11,0.1);
        border: 1px solid rgba(245,158,11,0.3); border-radius: 20px;
        font-size: 12px; font-weight: 800; color: #f59e0b;
      }

      /* ── Cosmetics Shop ── */
      #ba-shop-modal {
        position: fixed; inset: 0; z-index: 99992;
        background: rgba(0,0,0,0.85); backdrop-filter: blur(8px);
        display: none; align-items: flex-start; justify-content: center;
        overflow-y: auto; padding: 0;
      }
      #ba-shop-modal.open { display: flex; }
      .ba-shop-box {
        background: var(--bg-secondary, #13131a);
        border: 1px solid rgba(108,99,255,0.25);
        border-radius: 20px; width: 100%; max-width: 520px;
        margin: 0 auto; min-height: 100dvh;
        display: flex; flex-direction: column;
        font-family: 'Space Grotesk', -apple-system, sans-serif;
      }
      .ba-shop-hdr {
        display: flex; align-items: center; justify-content: space-between;
        padding: 14px 16px; border-bottom: 1px solid rgba(108,99,255,0.15);
        position: sticky; top: 0; background: var(--bg-secondary, #13131a);
        z-index: 2; border-radius: 20px 20px 0 0;
      }
      .ba-shop-tab-row { display: flex; gap: 8px; margin-bottom: 14px; }
      .ba-shop-tab {
        flex: 1; padding: 8px 4px; background: rgba(255,255,255,0.05);
        border: 1px solid rgba(108,99,255,0.2); border-radius: 10px;
        color: rgba(200,195,255,0.6); font-size: 12px; font-weight: 700;
        cursor: pointer; text-align: center; transition: all 0.15s; font-family: inherit;
      }
      .ba-shop-tab.active { background: rgba(108,99,255,0.2); border-color: rgba(108,99,255,0.5); color: #fff; }
      .ba-shop-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 14px; }
      .ba-shop-item {
        background: rgba(255,255,255,0.04); border: 1.5px solid rgba(108,99,255,0.15);
        border-radius: 14px; padding: 14px 10px; text-align: center;
        transition: all 0.2s; cursor: pointer; position: relative;
      }
      .ba-shop-item.owned { border-color: rgba(74,222,128,0.4); }
      .ba-shop-item.equipped { border-color: #6C63FF; background: rgba(108,99,255,0.1); }
      .ba-shop-item:hover:not(.equipped) { border-color: rgba(108,99,255,0.4); transform: translateY(-1px); }
      .ba-shop-item-icon { font-size: 32px; margin-bottom: 6px; display: block; }
      .ba-shop-item-name { font-size: 12px; font-weight: 700; color: #fff; margin-bottom: 4px; }
      .ba-shop-item-price { font-size: 11px; font-weight: 700; }
      .ba-shop-item-badge {
        position: absolute; top: 6px; right: 6px;
        font-size: 9px; font-weight: 800; padding: 2px 6px; border-radius: 10px;
        letter-spacing: 0.05em; text-transform: uppercase;
      }
      .ba-shop-item-badge.owned-badge { background: rgba(74,222,128,0.2); color: #4ade80; }
      .ba-shop-item-badge.equipped-badge { background: rgba(108,99,255,0.3); color: #a78bfa; }

      /* ── Speed points toast animation ── */
      .speed-toast {
        position: fixed; left: 50%; transform: translateX(-50%);
        top: 20%; z-index: 100000; pointer-events: none;
        font-size: 22px; font-weight: 900; color: #f59e0b;
        text-shadow: 0 2px 12px rgba(245,158,11,0.5);
        animation: speed-pop 1.5s ease forwards;
      }
      @keyframes speed-pop {
        0%  { opacity:0; transform:translateX(-50%) scale(0.6) translateY(0); }
        30% { opacity:1; transform:translateX(-50%) scale(1.2) translateY(-4px); }
        70% { opacity:1; transform:translateX(-50%) scale(1)   translateY(-10px); }
        100%{ opacity:0; transform:translateX(-50%) scale(0.9) translateY(-20px); }
      }

      /* ── Profile preview in battle ── */
      .ba-player-cosmetic {
        display: inline-flex; align-items: center; gap: 6px;
      }
      .ba-player-avatar {
        width: 28px; height: 28px; border-radius: 50%;
        display: flex; align-items: center; justify-content: center;
        font-size: 14px; flex-shrink: 0;
      }
    `;
    document.head.appendChild(s);
  }

  /* ─────────────────────────────────────────────────────────────
   * 7. COSMETICS SHOP MODAL
   * ───────────────────────────────────────────────────────────── */
  function createShopModal() {
    if (document.getElementById('ba-shop-modal')) return;
    const m = document.createElement('div');
    m.id = 'ba-shop-modal';
    m.innerHTML = `
      <div class="ba-shop-box">
        <div class="ba-shop-hdr">
          <div>
            <span style="font-size:17px;font-weight:800;color:#fff;">🏪 Cosmetics Shop</span>
            <div id="ba-shop-coins-display" style="margin-top:3px;"></div>
          </div>
          <button class="ba-close" onclick="CosmeticsShop.close()">✕</button>
        </div>
        <div style="padding:14px 14px 24px;" id="ba-shop-body"></div>
      </div>`;
    document.body.appendChild(m);
  }

  global.CosmeticsShop = {
    _tab: 'avatars',

    open() {
      injectEloStyles();
      createShopModal();
      document.getElementById('ba-shop-modal').classList.add('open');
      this._render();
    },

    close() {
      document.getElementById('ba-shop-modal')?.classList.remove('open');
    },

    _render() {
      const body = document.getElementById('ba-shop-body');
      const coinsEl = document.getElementById('ba-shop-coins-display');
      if (!body) return;

      const coins = getCoins();
      if (coinsEl) coinsEl.innerHTML = `<span class="ba-coins-badge">🪙 ${coins} coins</span>`;

      const d = getCosmeticData();
      const tab = this._tab;

      let tabsHtml = `<div class="ba-shop-tab-row">
        <button class="ba-shop-tab ${tab==='avatars'?'active':''}" onclick="CosmeticsShop._switchTab('avatars')">😊 Avatars</button>
        <button class="ba-shop-tab ${tab==='nameColors'?'active':''}" onclick="CosmeticsShop._switchTab('nameColors')">🎨 Name Color</button>
        <button class="ba-shop-tab ${tab==='frames'?'active':''}" onclick="CosmeticsShop._switchTab('frames')">🖼️ Frame</button>
      </div>`;

      let items, activeKey;
      if (tab === 'avatars')     { items = AVATARS;      activeKey = d.activeAvatar; }
      if (tab === 'nameColors')  { items = NAME_COLORS;  activeKey = d.activeNameColor; }
      if (tab === 'frames')      { items = PROFILE_FRAMES; activeKey = d.activeFrame; }

      const gridHtml = `<div class="ba-shop-grid">
        ${items.map(item => {
          const owned    = isOwned(item.id);
          const equipped = activeKey === item.id;
          let iconHtml;
          if (tab === 'nameColors') {
            iconHtml = `<span class="ba-shop-item-icon" style="font-size:20px;display:flex;align-items:center;justify-content:center;height:32px;">
              <span style="font-size:18px;font-weight:800;background:${item.color};-webkit-background-clip:text;-webkit-text-fill-color:${item.color.startsWith('linear') ? 'transparent' : item.color};background-clip:text;">Abc</span>
            </span>`;
          } else if (tab === 'frames') {
            iconHtml = `<span class="ba-shop-item-icon">
              <span style="display:inline-flex;width:32px;height:32px;border-radius:50%;${item.gradient ? `background:${item.gradient};` : `border:${item.border};background:rgba(108,99,255,0.1);`}align-items:center;justify-content:center;font-size:14px;">A</span>
            </span>`;
          } else {
            iconHtml = `<span class="ba-shop-item-icon">${item.emoji}</span>`;
          }

          const badgeHtml = equipped
            ? `<span class="ba-shop-item-badge equipped-badge">Equipped</span>`
            : owned
            ? `<span class="ba-shop-item-badge owned-badge">Owned</span>`
            : '';

          const actionHtml = equipped
            ? `<div style="font-size:11px;color:#a78bfa;font-weight:700;">✓ Active</div>`
            : owned
            ? `<button onclick="CosmeticsShop._equip('${item.id}')" style="padding:5px 12px;background:rgba(108,99,255,0.2);border:1px solid rgba(108,99,255,0.4);border-radius:8px;color:#a78bfa;font-size:11px;font-weight:700;cursor:pointer;font-family:inherit;">Equip</button>`
            : `<button onclick="CosmeticsShop._buy('${item.id}')" style="padding:5px 12px;background:linear-gradient(135deg,#f59e0b,#ef4444);border:none;border-radius:8px;color:#fff;font-size:11px;font-weight:700;cursor:pointer;font-family:inherit;">🪙 ${item.price}</button>`;

          return `<div class="ba-shop-item ${owned?'owned':''} ${equipped?'equipped':''}">
            ${badgeHtml}
            ${iconHtml}
            <div class="ba-shop-item-name">${item.label}</div>
            ${actionHtml}
          </div>`;
        }).join('')}
      </div>`;

      const helpHtml = coinHelpHtml();

      body.innerHTML = tabsHtml + gridHtml + helpHtml;
    },

    _switchTab(tab) {
      this._tab = tab;
      this._render();
    },

    _buy(itemId) {
      if (buyItem(itemId)) {
        equipItem(itemId);
        this._render();
      }
    },

    _equip(itemId) {
      equipItem(itemId);
      _toast('✅ Cosmetic equipped!', 1800);
      this._render();
    }
  };

  /* ─────────────────────────────────────────────────────────────
   * 8. ELO DISPLAY WIDGET
   * ───────────────────────────────────────────────────────────── */
  global.EloWidget = {
    open() {
      injectEloStyles();
      // Show inside leaderboard if available
      if (typeof BA !== 'undefined') {
        BA.openLeaderboard();
      }
    },

    renderBadge(elo) {
      const tier = getEloTier(elo || getMyElo());
      return `<span class="elo-badge" style="background:${tier.bg};color:${tier.color};border-color:${tier.color}40;">
        ${tier.emoji} ${tier.name} <span style="opacity:0.7;font-size:10px;">${elo || getMyElo()}</span>
      </span>`;
    },

    renderProgress() {
      const elo = getMyElo();
      const tier = getEloTier(elo);
      const nextTier = ELO_TIERS[ELO_TIERS.indexOf(tier) + 1];
      const progress = nextTier
        ? Math.round(((elo - tier.min) / (nextTier.min - tier.min)) * 100)
        : 100;

      return `<div class="elo-progress-wrap">
        <div class="elo-tier-row">
          <div class="elo-tier-emoji">${tier.emoji}</div>
          <div class="elo-tier-info">
            <div class="elo-tier-name" style="color:${tier.color};">${tier.name}</div>
            <div class="elo-tier-sub">${elo} ELO ${nextTier ? `· ${nextTier.min - elo} to ${nextTier.emoji} ${nextTier.name}` : '· MAX RANK'}</div>
          </div>
          <span class="ba-coins-badge">🪙 ${getCoins()}</span>
        </div>
        <div class="elo-bar-track">
          <div class="elo-bar-fill" style="width:${progress}%;background:${tier.color};"></div>
        </div>
      </div>`;
    }
  };

  /* ─────────────────────────────────────────────────────────────
   * 9. PATCH BA._renderBattleWinner — add ELO delta + highlights + coins
   * ───────────────────────────────────────────────────────────── */
  function waitForBA(cb) {
    if (global.BA && global.BA._renderBattleWinner) { cb(); return; }
    setTimeout(() => waitForBA(cb), 200);
  }

  waitForBA(() => {
    injectEloStyles();
    createShopModal();

    const _origWinner = global.BA._renderBattleWinner.bind(global.BA);
    global.BA._renderBattleWinner = function(battle) {
      _origWinner(battle);

      // Append enhanced winner content
      const body = document.getElementById('ba-body');
      if (!body) return;

      const myUid = _uid();
      const xp = battle?.quiz?.xp || {};
      const sorted = Object.entries(xp).sort((a,b) => b[1]-a[1]);
      const playerNames = battle?.playerNames || {};

      // Compute ELO change
      const eloDelta = updateEloAfterBattle(myUid, xp[myUid] || 0, xp);
      const newElo = getMyElo();
      const tier = getEloTier(newElo);

      // Award coins — Arena wins only, correct prize model
      const myRank = sorted.findIndex(([u]) => u === myUid);
      const totalPlayers = sorted.length;
      const coinsEarned = coinPrize(myRank, totalPlayers);
      const coinReason = myRank === 0 ? '🏆 1st place!'
        : myRank === 1 ? '🥈 2nd place!'
        : myRank === 2 ? '🥉 3rd place!'
        : null;
      if (coinsEarned > 0 && coinReason) addCoins(coinsEarned, coinReason);

      // Highlights
      const h = computeHighlights(battle);

      // Build ELO + highlights section
      const eloSection = document.createElement('div');
      eloSection.innerHTML = `
        <!-- ELO Change -->
        <div style="background:rgba(108,99,255,0.08);border:1px solid rgba(108,99,255,0.25);border-radius:14px;padding:14px;margin:10px 0;">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;">
            <div style="font-size:13px;font-weight:700;color:#fff;">📊 ELO Change</div>
            <span class="${eloDelta >= 0 ? 'elo-delta-pos' : 'elo-delta-neg'}">${eloDelta >= 0 ? '+' : ''}${eloDelta} ELO</span>
          </div>
          ${EloWidget.renderProgress()}
          <div style="text-align:center;margin-top:6px;">
            <span class="elo-badge" style="background:${tier.bg};color:${tier.color};border-color:${tier.color}40;">
              ${tier.emoji} ${tier.name} · ${newElo} ELO
            </span>
          </div>
        </div>

        <!-- Coins earned -->
        <div style="text-align:center;margin-bottom:10px;">
          <span class="ba-coins-badge">${coinsEarned > 0 ? `🪙 +${coinsEarned} coins earned · Total: ${getCoins()}` : `🪙 Total: ${getCoins()} coins`}</span>
        </div>

        <!-- Highlights -->
        ${(h.fastest || h.accuracyKing || h.comeback) ? `
        <div class="ba-highlights-wrap">
          <div class="ba-highlights-title">⭐ Battle Highlights</div>
          <div class="ba-highlights-grid">
            ${h.fastest ? `
            <div class="ba-highlight-card">
              <div class="ba-highlight-icon">⚡</div>
              <div class="ba-highlight-label">Fastest</div>
              <div class="ba-highlight-name">${h.fastest}</div>
            </div>` : ''}
            ${h.accuracyKing ? `
            <div class="ba-highlight-card">
              <div class="ba-highlight-icon">🎯</div>
              <div class="ba-highlight-label">Accuracy</div>
              <div class="ba-highlight-name">${h.accuracyKing}</div>
            </div>` : ''}
            ${h.comeback ? `
            <div class="ba-highlight-card">
              <div class="ba-highlight-icon">🔥</div>
              <div class="ba-highlight-label">Comeback</div>
              <div class="ba-highlight-name">${h.comeback}</div>
            </div>` : `
            <div class="ba-highlight-card">
              <div class="ba-highlight-icon">🏅</div>
              <div class="ba-highlight-label">MVP</div>
              <div class="ba-highlight-name">${sorted[0] ? playerNames[sorted[0][0]] || 'Player' : '—'}</div>
            </div>`}
          </div>
        </div>` : ''}

        <!-- Shop button -->
        <div style="text-align:center;margin-top:10px;">
          <button onclick="CosmeticsShop.open()" style="padding:10px 20px;background:linear-gradient(135deg,rgba(245,158,11,0.2),rgba(255,107,157,0.2));border:1px solid rgba(245,158,11,0.4);border-radius:12px;color:#f59e0b;font-size:13px;font-weight:700;cursor:pointer;font-family:inherit;">
            🏪 Spend Coins in Shop
          </button>
        </div>`;

      body.appendChild(eloSection);
    };

    /* ── Patch BA._submitAnswer for speed points ── */
    const _origSubmit = global.BA._submitAnswer.bind(global.BA);
    global.BA._submitAnswer = async function(battleId, qi, chosenIdx) {
      const now = Date.now();
      const myUid = _uid();
      const myName = typeof getMyName === 'function' ? getMyName() : 'You';

      // Call original (which writes to Firestore with +10 if correct)
      await _origSubmit(battleId, qi, chosenIdx);

      // Record for speed tracking and determine position
      try {
        const db = global._firebaseDb;
        const { doc, getDoc } = global._firebaseFns;
        const snap = await getDoc(doc(db, 'publicBattles', battleId));
        if (snap.exists()) {
          const data = snap.data();
          const q = data.questions?.[qi];
          if (q) {
            const correct = chosenIdx === q.ans;
            _recordAnswer(battleId, qi, myUid, myName, now, correct);
            const pos = _getSpeedPoints(battleId, qi, myUid);
            if (correct && pos > 0) {
              _showSpeedToast(pos);
            }
          }
        }
      } catch(e) {}
    };

    /* ── Patch BA._renderActiveQuiz to add live chat + ELO badge + speed labels ── */
    const _origRenderActiveQuiz = global.BA._renderActiveQuiz.bind(global.BA);
    global.BA._renderActiveQuiz = function(battle) {
      _origRenderActiveQuiz(battle);

      // Append live chat bar to quiz body
      const body = document.getElementById('ba-body');
      if (!body) return;

      const cosm = getActiveCosmetics();
      const eloDiv = document.createElement('div');
      eloDiv.innerHTML = `
        <!-- ELO + Coins bar -->
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;flex-wrap:wrap;">
          ${EloWidget.renderBadge()}
          <span class="ba-coins-badge">🪙 ${getCoins()}</span>
          <span style="font-size:12px;color:rgba(200,195,255,0.4);">
            ${cosm.avatar.emoji} <span style="color:${cosm.nameColor.color.startsWith('linear') ? '#fff' : cosm.nameColor.color}">${typeof getMyName === 'function' ? getMyName() : 'You'}</span>
          </span>
        </div>

        <!-- Live Chat Reactions -->
        <div class="ba-chat-bar" id="ba-chat-bar-${battle.id || 'x'}">
          <button class="ba-chat-btn" onclick="BA._sendChat('${battle.id}','😂 Easy question')">😂</button>
          <button class="ba-chat-btn" onclick="BA._sendChat('${battle.id}','🔥 Catch me if you can')">🔥</button>
          <button class="ba-chat-btn" onclick="BA._sendChat('${battle.id}','🏆 I\\'m winning')">🏆</button>
          <button class="ba-chat-btn" onclick="BA._sendChat('${battle.id}','😤 Focus!')">😤</button>
          <button class="ba-chat-btn" onclick="BA._sendChat('${battle.id}','👏 Good one')">👏</button>
          <button class="ba-chat-btn" onclick="BA._sendChat('${battle.id}','🤯 Tricky!')">🤯</button>
        </div>
        <div class="ba-chat-log" id="ba-chat-log-${battle.id || 'x'}"></div>`;

      // Insert before the quiz question
      const firstChild = body.firstChild;
      if (firstChild) {
        body.insertBefore(eloDiv, firstChild);
      } else {
        body.appendChild(eloDiv);
      }

      // Load existing chat messages
      _renderChatLog(battle.id);
    };

    /* Chat send + display */
    global.BA._sendChat = async function(battleId, msg) {
      if (!battleId) return;
      const myName = typeof getMyName === 'function' ? getMyName() : 'You';
      const myUid = _uid();
      const cosm = getActiveCosmetics();

      try {
        const db = global._firebaseDb;
        const { doc, updateDoc, arrayUnion } = global._firebaseFns;
        await updateDoc(doc(db, 'publicBattles', battleId), {
          chatMessages: arrayUnion({
            uid: myUid,
            name: myName,
            avatar: cosm.avatar.emoji,
            nameColor: cosm.nameColor.color,
            msg,
            ts: Date.now()
          })
        });
      } catch(e) {}

      // Optimistic local display
      _appendChatMsg(battleId, myName, msg, cosm.nameColor.color, cosm.avatar.emoji);
    };

    /* Poll chat messages during active battle */
    const _origPollGame = global.BA._pollGameBattle.bind(global.BA);
    global.BA._pollGameBattle = async function(battleId) {
      await _origPollGame(battleId);
      // Re-render chat log
      try {
        const db = global._firebaseDb;
        const { doc, getDoc } = global._firebaseFns;
        const snap = await getDoc(doc(db, 'publicBattles', battleId));
        if (snap.exists()) {
          const msgs = snap.data().chatMessages || [];
          _syncChatLog(battleId, msgs);
        }
      } catch(e) {}
    };

    /* ── Patch _renderLbContent to show ELO + cosmetics ── */
    const _origRenderLbContent = global.BA._renderLbContent.bind(global.BA);
    global.BA._renderLbContent = function(body, entries, weekKey, myUid) {
      _origRenderLbContent(body, entries, weekKey, myUid);

      // Inject ELO progress at top
      const eloHtml = EloWidget.renderProgress();
      const shopBtn = `<div style="display:flex;gap:8px;margin-bottom:12px;flex-wrap:wrap;">
        <button onclick="CosmeticsShop.open()" style="flex:1;padding:10px;background:rgba(245,158,11,0.1);border:1px solid rgba(245,158,11,0.3);border-radius:10px;color:#f59e0b;font-size:12px;font-weight:700;cursor:pointer;font-family:inherit;">🏪 Cosmetics Shop</button>
        <button onclick="BA._renderEloLeaderboard()" style="flex:1;padding:10px;background:rgba(108,99,255,0.1);border:1px solid rgba(108,99,255,0.3);border-radius:10px;color:#a78bfa;font-size:12px;font-weight:700;cursor:pointer;font-family:inherit;">📊 ELO Rankings</button>
      </div>`;

      const topDiv = document.createElement('div');
      topDiv.innerHTML = eloHtml + shopBtn;
      body.insertBefore(topDiv, body.firstChild);
    };

    /* ELO leaderboard view */
    global.BA._renderEloLeaderboard = function() {
      const body = document.getElementById('lb-body');
      if (!body) return;

      // Build ELO tier overview
      const myElo = getMyElo();
      const myTier = getEloTier(myElo);

      let html = `
        <button class="ba-promo-btn" style="margin-bottom:14px;" onclick="BA._renderLeaderboard()">← Back to XP Leaderboard</button>
        <div style="font-size:11px;font-weight:700;letter-spacing:0.08em;color:rgba(200,195,255,0.4);text-transform:uppercase;margin-bottom:12px;">ELO Rank Tiers</div>`;

      ELO_TIERS.slice().reverse().forEach(tier => {
        const isCurrentTier = tier.name === myTier.name;
        html += `<div style="display:flex;align-items:center;gap:12px;padding:10px 12px;background:${isCurrentTier ? tier.bg : 'rgba(255,255,255,0.02)'};border:1px solid ${isCurrentTier ? tier.color+'60' : 'rgba(108,99,255,0.1)'};border-radius:12px;margin-bottom:8px;">
          <span style="font-size:24px;">${tier.emoji}</span>
          <div style="flex:1;">
            <div style="font-size:13px;font-weight:700;color:${tier.color};">${tier.name} ${isCurrentTier ? '<span style="font-size:10px;background:rgba(108,99,255,0.2);color:#a78bfa;padding:1px 6px;border-radius:10px;">YOU</span>' : ''}</div>
            <div style="font-size:11px;color:rgba(200,195,255,0.4);">${tier.min === 2300 ? '2300+' : `${tier.min} – ${tier.max}`} ELO · K-Factor: ${tier.kFactor}</div>
          </div>
          ${isCurrentTier ? `<div style="font-size:14px;font-weight:800;color:${tier.color};">${myElo}</div>` : ''}
        </div>`;
      });

      html += `<div style="background:rgba(108,99,255,0.06);border:1px solid rgba(108,99,255,0.2);border-radius:12px;padding:12px 14px;margin-top:8px;font-size:12px;line-height:1.6;color:rgba(200,195,255,0.7);">
        <strong>How ELO works:</strong><br>
        • Win against stronger players → <strong style="color:#4ade80;">more ELO gained</strong><br>
        • Lose to weaker players → <strong style="color:#f87171;">more ELO lost</strong><br>
        • K-Factor decreases at higher ranks (harder to gain points)<br>
        • Starting ELO: ${DEFAULT_ELO} (Silver)
      </div>`;

      body.innerHTML = html;
    };
  });

  /* ─────────────────────────────────────────────────────────────
   * 10. PATCH CF (Group Study) battles with same features
   * ───────────────────────────────────────────────────────────── */
  function waitForCF(cb) {
    if (global.CF && typeof global.CF._renderQuizResults === 'function') { cb(); return; }
    setTimeout(() => waitForCF(cb), 200);
  }

  waitForCF(() => {
    /* Patch _renderQuizResults for group study — add ELO + highlights (NO coins for group study) */
    const _origGroupResults = global.CF._renderQuizResults.bind(global.CF);
    global.CF._renderQuizResults = function(quiz, memberNames) {
      _origGroupResults(quiz, memberNames);

      const body = document.getElementById('cf-quiz-area');
      if (!body) return;

      const myUid = _uid();
      const xp = quiz?.xp || {};

      const eloDelta = updateEloAfterBattle(myUid, xp[myUid] || 0, xp);
      const newElo = getMyElo();
      const tier = getEloTier(newElo);

      const sorted = Object.entries(xp).sort((a,b) => b[1]-a[1]);

      const h = computeHighlights({ quiz, playerNames: memberNames, questions: quiz?.questions || [] });

      const eloSection = document.createElement('div');
      eloSection.style.cssText = 'margin-top:12px;';
      eloSection.innerHTML = `
        <div style="background:rgba(108,99,255,0.08);border:1px solid rgba(108,99,255,0.25);border-radius:14px;padding:14px;margin-bottom:10px;">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;">
            <span style="font-size:13px;font-weight:700;color:#fff;">📊 ELO Change</span>
            <span class="${eloDelta >= 0 ? 'elo-delta-pos' : 'elo-delta-neg'}">${eloDelta >= 0 ? '+' : ''}${eloDelta} ELO</span>
          </div>
          ${EloWidget.renderProgress()}
        </div>
        ${(h.fastest || h.accuracyKing || h.comeback) ? `
        <div class="ba-highlights-wrap">
          <div class="ba-highlights-title">⭐ Battle Highlights</div>
          <div class="ba-highlights-grid">
            ${h.fastest ? `<div class="ba-highlight-card"><div class="ba-highlight-icon">⚡</div><div class="ba-highlight-label">Fastest Answer</div><div class="ba-highlight-name">${h.fastest}</div></div>` : ''}
            ${h.accuracyKing ? `<div class="ba-highlight-card"><div class="ba-highlight-icon">🎯</div><div class="ba-highlight-label">Accuracy King</div><div class="ba-highlight-name">${h.accuracyKing}</div></div>` : ''}
            ${h.comeback ? `<div class="ba-highlight-card"><div class="ba-highlight-icon">🔥</div><div class="ba-highlight-label">Comeback Player</div><div class="ba-highlight-name">${h.comeback}</div></div>` : `<div class="ba-highlight-card"><div class="ba-highlight-icon">🏅</div><div class="ba-highlight-label">MVP</div><div class="ba-highlight-name">${sorted[0] ? (memberNames?.[sorted[0][0]] || 'Player') : '—'}</div></div>`}
          </div>
        </div>` : ''}
        <div style="text-align:center;margin-top:10px;">
          <button onclick="CosmeticsShop.open()" style="padding:9px 18px;background:linear-gradient(135deg,rgba(245,158,11,0.2),rgba(255,107,157,0.2));border:1px solid rgba(245,158,11,0.4);border-radius:10px;color:#f59e0b;font-size:12px;font-weight:700;cursor:pointer;font-family:inherit;">🏪 Cosmetics Shop</button>
        </div>`;

      body.appendChild(eloSection);
    };

    /* Patch _renderQuizQuestion for group study — add ELO badge + emoji chat + speed labels */
    const _origGroupQuestion = global.CF._renderQuizQuestion.bind(global.CF);
    global.CF._renderQuizQuestion = function(quiz, groupId, memberNames) {
      _origGroupQuestion(quiz, memberNames, groupId);

      const body = document.getElementById('cf-quiz-area');
      if (!body) return;

      const cosm = getActiveCosmetics();
      const eloBar = document.createElement('div');
      eloBar.innerHTML = `
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;flex-wrap:wrap;padding:0 0 6px;border-bottom:1px solid rgba(108,99,255,0.1);">
          ${EloWidget.renderBadge()}
          <span class="ba-coins-badge">🪙 ${getCoins()}</span>
          <span style="font-size:12px;color:${cosm.nameColor.color.startsWith('linear') ? '#fff' : cosm.nameColor.color};">${cosm.avatar.emoji} ${typeof getMyName === 'function' ? getMyName() : 'You'}</span>
        </div>
        <!-- Group chat reactions -->
        <div style="display:flex;gap:5px;flex-wrap:wrap;margin-bottom:6px;">
          <button class="ba-chat-btn" onclick="CF._sendGroupChat('${groupId}','😂 Easy question')">😂</button>
          <button class="ba-chat-btn" onclick="CF._sendGroupChat('${groupId}','🔥 Catch me if you can')">🔥</button>
          <button class="ba-chat-btn" onclick="CF._sendGroupChat('${groupId}','🏆 I\\'m winning')">🏆</button>
          <button class="ba-chat-btn" onclick="CF._sendGroupChat('${groupId}','😤 Focus!')">😤</button>
          <button class="ba-chat-btn" onclick="CF._sendGroupChat('${groupId}','🤯 Tricky!')">🤯</button>
        </div>
        <div class="ba-chat-log" id="cf-chat-log-${groupId}" style="max-height:60px;"></div>`;

      const wrap = body.querySelector('.cf-quiz-battle-wrap');
      if (wrap) {
        wrap.insertBefore(eloBar, wrap.firstChild);
      }
    };

    /* Group study emoji send */
    global.CF._sendGroupChat = async function(groupId, msg) {
      if (!groupId) return;
      const myName = typeof getMyName === 'function' ? getMyName() : 'You';
      const cosm = getActiveCosmetics();
      try {
        const db = global._firebaseDb;
        const { doc, updateDoc, arrayUnion } = global._firebaseFns;
        await updateDoc(doc(db, 'studyGroups', groupId), {
          battleChat: arrayUnion({ uid: _uid(), name: myName, avatar: cosm.avatar.emoji, nameColor: cosm.nameColor.color, msg, ts: Date.now() })
        });
      } catch(e) {}
      _appendChatMsg(groupId, myName, msg, cosm.nameColor.color, cosm.avatar.emoji, 'cf');
    };

    /* Speed-patch group answer submission */
    const _origGroupSubmit = global.CF._submitQuizAnswer.bind(global.CF);
    if (typeof _origGroupSubmit === 'function') {
      global.CF._submitQuizAnswer = async function(groupId, qIdx, chosenIdx) {
        const now = Date.now();
        const myUid = _uid();
        const myName = typeof getMyName === 'function' ? getMyName() : 'You';
        const q = global.CF._currentGroupData?.quiz?.questions?.[qIdx];
        const correct = q ? chosenIdx === q.ans : false;

        await _origGroupSubmit(groupId, qIdx, chosenIdx);

        _recordAnswer(groupId, qIdx, myUid, myName, now, correct);
        const pos = _getSpeedPoints(groupId, qIdx, myUid);
        if (correct && pos > 0) _showSpeedToast(pos);
      };
    }
  });

  /* ─────────────────────────────────────────────────────────────
   * 11. CHAT LOG HELPERS
   * ───────────────────────────────────────────────────────────── */
  function _appendChatMsg(battleId, name, msg, nameColor, avatar, prefix) {
    const logId = (prefix || 'ba') + '-chat-log-' + battleId;
    const log = document.getElementById(logId);
    if (!log) return;
    const el = document.createElement('div');
    el.className = 'ba-chat-msg';
    const nc = nameColor && !nameColor.startsWith('linear') ? nameColor : '#a78bfa';
    el.innerHTML = `<span style="font-size:12px;">${avatar || ''}</span> <span class="ba-chat-name" style="color:${nc};">${name}</span>: ${msg}`;
    log.appendChild(el);
    log.scrollTop = log.scrollHeight;
    // Auto-prune to last 10 messages
    while (log.children.length > 10) log.removeChild(log.firstChild);
  }

  function _renderChatLog(battleId) {
    // Will be populated by poll cycle
  }

  let _lastChatMsgCount = {};
  function _syncChatLog(battleId, msgs) {
    const logId = 'ba-chat-log-' + battleId;
    const log = document.getElementById(logId);
    if (!log) return;
    const lastCount = _lastChatMsgCount[battleId] || 0;
    const newMsgs = msgs.slice(lastCount);
    _lastChatMsgCount[battleId] = msgs.length;
    newMsgs.forEach(m => {
      _appendChatMsg(battleId, m.name, m.msg, m.nameColor, m.avatar, 'ba');
    });
  }

  /* ─────────────────────────────────────────────────────────────
   * 12. SPEED TOAST
   * ───────────────────────────────────────────────────────────── */
  function _showSpeedToast(points) {
    const labels = { 10: '⚡ 1st! +10 pts', 8: '🥈 2nd! +8 pts', 6: '🥉 3rd! +6 pts' };
    const el = document.createElement('div');
    el.className = 'speed-toast';
    el.textContent = labels[points] || `+${points} pts`;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 1500);
  }

  /* ─────────────────────────────────────────────────────────────
   * 13. ADD SHOP + ELO BUTTONS to existing BA leaderboard trigger
   * ───────────────────────────────────────────────────────────── */
  function addShopButton() {
    // Add a cosmetics shop button near existing battle buttons in sidebar
    const lbBtn = document.getElementById('openLeaderboardBtn');
    if (lbBtn && !lbBtn.parentNode.querySelector('#openShopBtn')) {
      const shopBtn = document.createElement('button');
      shopBtn.id = 'openShopBtn';
      shopBtn.className = lbBtn.className;
      shopBtn.innerHTML = lbBtn.innerHTML.replace(/Leaderboard|🏆/g, '').trim()
        ? '🏪 Cosmetics Shop'
        : '🏪 Cosmetics Shop';
      shopBtn.style.cssText = lbBtn.style.cssText || '';
      shopBtn.onclick = () => {
        if (typeof closeDrawer === 'function') closeDrawer();
        setTimeout(() => CosmeticsShop.open(), 200);
      };
      lbBtn.insertAdjacentElement('afterend', shopBtn);
    }
  }

  // Wire on DOM ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => { injectEloStyles(); createShopModal(); addShopButton(); });
  } else {
    injectEloStyles();
    createShopModal();
    addShopButton();
  }

  // Also wire after click (sidebar may rebuild dynamically)
  document.addEventListener('click', () => setTimeout(addShopButton, 300));

  /* ─────────────────────────────────────────────────────────────
   * GROUP STUDY — AUTO-DELETE MESSAGES WHEN ALL MEMBERS HAVE READ
   *
   *   Strategy (Firebase-cost efficient):
   *   • Each message carries a `readBy: [uid, ...]` array
   *   • On each chat render, ONE updateDoc batches all new reads
   *   • Poller checks: readBy.length >= memberCount → delete after 5s
   *   • Deletions are batched into one single updateDoc (rewrite array)
   * ───────────────────────────────────────────────────────────── */

  const _pendingMsgDeletes = {}; // { msgKey: timeoutId }

  function _msgKey(msg) {
    return (msg.uid || 'x') + '_' + (msg.ts || 0);
  }

  async function _markMessagesRead(groupId, messages) {
    if (!groupId || !messages || !messages.length) return;
    const myUid = uid();
    if (!myUid || myUid === 'guest') return;
    const unread = messages.filter(m => !(m.readBy || []).includes(myUid));
    if (!unread.length) return;
    const updated = messages.map(m => {
      const rb = m.readBy || [];
      return rb.includes(myUid) ? m : { ...m, readBy: [...rb, myUid] };
    });
    try {
      const db  = window._firebaseDb;
      const fns = window._firebaseFns;
      if (!db || !fns) return;
      await fns.updateDoc(fns.doc(db, 'studyGroups', groupId), { messages: updated });
    } catch (_) {}
  }

  function _scheduleReadMessageCleanup(groupId, messages, memberCount) {
    if (!groupId || !messages || memberCount < 1) return;
    const fullyRead = messages.filter(m => (m.readBy || []).length >= memberCount);
    if (!fullyRead.length) return;

    fullyRead.forEach(m => {
      const key = _msgKey(m);
      if (_pendingMsgDeletes[key]) return; // already scheduled

      _pendingMsgDeletes[key] = setTimeout(async () => {
        try {
          const db  = window._firebaseDb;
          const fns = window._firebaseFns;
          if (!db || !fns) return;
          const { doc, getDoc, updateDoc } = fns;
          const snap = await getDoc(doc(db, 'studyGroups', groupId));
          if (!snap.exists()) return;
          const current    = snap.data().messages || [];
          const latestCount = snap.data().memberCount
            || Object.keys(snap.data().memberNames || {}).length
            || memberCount;
          // Retain messages that have NOT been fully read yet
          const retained = current.filter(msg => (msg.readBy || []).length < latestCount);
          if (retained.length < current.length) {
            await updateDoc(doc(db, 'studyGroups', groupId), { messages: retained });
          }
        } catch (_) {}
        delete _pendingMsgDeletes[key];
      }, 5000);
    });
  }

  /* Patch StudyGroups.sendMessage to include readBy from creation */
  function _patchStudyGroupsSend() {
    if (!window.StudyGroups?.sendMessage) return;
    if (window.StudyGroups._sendPatched) return;
    const orig = window.StudyGroups.sendMessage.bind(window.StudyGroups);
    window.StudyGroups.sendMessage = async function (groupId, msgObj, ...rest) {
      const myUid = uid();
      const patched = {
        ...msgObj,
        readBy: msgObj.readBy ? [...new Set([...msgObj.readBy, myUid])] : [myUid]
      };
      return orig(groupId, patched, ...rest);
    };
    window.StudyGroups._sendPatched = true;
  }

  /* Patch CF._renderChatMessages to mark messages as read */
  function _patchCFChat() {
    if (!global.CF) return;
    if (global.CF._readTrackingPatched) return;

    const _origRender = global.CF._renderChatMessages?.bind(global.CF);
    if (_origRender) {
      global.CF._renderChatMessages = function (messages) {
        _origRender(messages);
        const gid = global.CF._currentGroupId;
        if (gid && messages && messages.length) {
          _markMessagesRead(gid, messages);
        }
      };
    }

    /* Patch the chat poller to also run cleanup checks */
    const _origOpenGC = global.CF._openGroupChat?.bind(global.CF);
    if (_origOpenGC) {
      global.CF._openGroupChat = async function (groupId) {
        await _origOpenGC(groupId);

        if (global.CF._chatPollInterval) clearInterval(global.CF._chatPollInterval);

        const db  = window._firebaseDb;
        const fns = window._firebaseFns;

        global.CF._chatPollInterval = setInterval(async () => {
          if (!global.CF._currentGroupId) return;
          if (global.CF._answerAnimating) return;

          try {
            const snap = await fns.getDoc(fns.doc(db, 'studyGroups', global.CF._currentGroupId));
            if (!snap.exists()) { global.CF._stopChatPolling?.(); return; }

            const data = snap.data();
            const messages    = data.messages || [];
            const memberCount = data.memberCount
              || Object.keys(data.memberNames || {}).length
              || (data.members || []).length
              || 1;

            const newHash = JSON.stringify({
              msgs:     messages.length,
              quiz:     data.quiz ? data.quiz.current : null,
              qstatus:  data.quiz ? data.quiz.status  : null,
              qanswers: data.quiz ? Object.keys(data.quiz.answers || {}).length : 0
            });

            if (newHash !== global.CF._chatPollHash) {
              global.CF._chatPollHash     = newHash;
              global.CF._currentGroupData = data;
              global.CF._renderChatMessages(messages);

              if (!global.CF._answerAnimating) {
                const status = data.quiz?.status;
                if (status === 'active') {
                  global.CF._renderQuizQuestion(data.quiz, global.CF._currentGroupId, data.memberNames);
                } else if (status === 'finished') {
                  global.CF._renderQuizResults(data.quiz, data.memberNames);
                } else if (status === 'abandoned') {
                  const qa = document.getElementById('cf-quiz-area');
                  if (qa) {
                    qa.innerHTML = '<div style="text-align:center;padding:16px;color:rgba(200,195,255,0.5);font-size:13px">🚫 Battle ended by admin.</div>';
                    setTimeout(() => { if (qa) qa.innerHTML = ''; }, 3000);
                  }
                } else {
                  const qa = document.getElementById('cf-quiz-area');
                  if (qa) qa.innerHTML = '';
                }
              }
            }

            // Schedule deletion for fully-read messages
            _scheduleReadMessageCleanup(global.CF._currentGroupId, messages, memberCount);

          } catch (_) {}
        }, 3000);
      };
    }

    global.CF._readTrackingPatched = true;
  }

  /* Try to apply CF and StudyGroups patches as soon as they are ready */
  function _initV3Patches() {
    _patchStudyGroupsSend();
    _patchCFChat();
    // Load coins from Firestore for cross-device persistence
    _loadCoinsFromFirestore();
  }

  if (window._firebaseDb && window._firebaseFns) {
    _initV3Patches();
  } else {
    let _v3Tries = 0;
    const _v3Check = setInterval(() => {
      _v3Tries++;
      _patchStudyGroupsSend();
      _patchCFChat();
      if (window._firebaseDb && window._firebaseFns) {
        clearInterval(_v3Check);
        _loadCoinsFromFirestore();
      } else if (_v3Tries > 60) {
        clearInterval(_v3Check);
      }
    }, 500);
  }


  /* ── Study Groups: delegate to CF.openStudyGroups() in crackai-features.js ──
   * The full gated system (admin pays, students join free) lives in
   * crackai-features.js (CF object). We just wire up the sidebar button here.
   * ─────────────────────────────────────────────────────────────────────────── */
  function _openStudyGroups() {
    try {
      // Use the gated CF system from crackai-features.js
      if (typeof CF !== 'undefined' && typeof CF.openStudyGroups === 'function') {
        CF.openStudyGroups();
        return;
      }
      // Fallback: look for it on window._CrackAI
      if (window._CrackAI && typeof window._CrackAI.openStudyGroups === 'function') {
        window._CrackAI.openStudyGroups();
        return;
      }
      // Last resort: dispatch a custom event so index.js can handle it
      document.dispatchEvent(new CustomEvent('crackai:openStudyGroups'));
    } catch(e) { console.error('[BA] openStudyGroups error', e); }
  }



  console.info('[BattleArena] v3.2 — Battle tiers (Basic/Pro/Academy) + Group Study bridge loaded');

})(window);
