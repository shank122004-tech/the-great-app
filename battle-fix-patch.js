/**
 * battle-fix-patch.js — CrackAI Battle Fix v1.0
 * Fixes:
 *   1. Battle lag (double reads, poll racing animation, redundant re-renders)
 *   2. No quit/end battle option for users or admin
 *
 * HOW TO LOAD:
 *   Add this AFTER crackai-features.js in your index.html:
 *   <script src="battle-fix-patch.js" defer></script>
 */
(function () {
  'use strict';

  /* ─────────────────────────────────────────────────────────────
   * Wait for CF object to be ready
   * ───────────────────────────────────────────────────────────── */
  function waitForCF(cb) {
    if (window.CF && typeof window.CF._openGroupChat === 'function') { cb(); return; }
    setTimeout(function () { waitForCF(cb); }, 100);
  }

  waitForCF(function () {

    /* ─────────────────────────────────────────────────────────────
     * FIX 1 — FLAG: suppress poll re-render during answer animation
     *   CF._answerAnimating = true for 2000ms after every answer
     *   The poller checks this flag and skips re-rendering the quiz
     *   area while animation is running, eliminating the flicker.
     * ───────────────────────────────────────────────────────────── */
    CF._answerAnimating = false;

    /* ─────────────────────────────────────────────────────────────
     * FIX 2 — PATCH THE POLLER
     *   Replace the 3s setInterval inside _openGroupChat so it:
     *   - Skips quiz re-render while _answerAnimating is true
     *   - Skips ALL rendering if groupId no longer matches
     *   - Does not accumulate multiple intervals (guard already exists,
     *     but we reinforce it)
     * ───────────────────────────────────────────────────────────── */
    var _origOpenGroupChat = CF._openGroupChat.bind(CF);

    CF._openGroupChat = async function (groupId) {
      // Let original function run (it sets up HTML + initial render)
      await _origOpenGroupChat(groupId);

      // Now replace the interval it created with our patched version.
      // The original already set CF._chatPollInterval — clear it and
      // replace with one that respects the animation flag.
      if (CF._chatPollInterval) {
        clearInterval(CF._chatPollInterval);
        CF._chatPollInterval = null;
      }

      var db = window._firebaseDb;
      var fns = window._firebaseFns;

      CF._chatPollInterval = setInterval(async function () {
        if (!CF._currentGroupId) return;
        // Don't fight the answer animation
        if (CF._answerAnimating) return;

        try {
          var s = await fns.getDoc(fns.doc(db, 'studyGroups', CF._currentGroupId));
          if (!s.exists()) { CF._stopChatPolling(); return; }
          var data = s.data();

          var newHash = JSON.stringify({
            msgs: (data.messages || []).length,
            quiz: data.quiz ? data.quiz.current : null,
            qstatus: data.quiz ? data.quiz.status : null,
            qanswers: data.quiz ? Object.keys(data.quiz.answers || {}).length : 0
          });

          if (newHash !== CF._chatPollHash) {
            CF._chatPollHash = newHash;
            CF._currentGroupData = data;

            // Re-render chat messages
            CF._renderChatMessages(data.messages || []);

            // Re-render quiz area (only if not animating — double-checked here)
            if (!CF._answerAnimating) {
              var status = data.quiz ? data.quiz.status : null;
              if (status === 'active') {
                CF._renderQuizQuestion(data.quiz, CF._currentGroupId, data.memberNames);
              } else if (status === 'finished') {
                CF._renderQuizResults(data.quiz, data.memberNames);
              } else if (status === 'abandoned') {
                // Admin ended the battle — clear the quiz area for everyone
                var qa = document.getElementById('cf-quiz-area');
                if (qa) {
                  qa.innerHTML = '<div style="text-align:center;padding:16px;color:rgba(200,195,255,0.5);font-size:13px">🚫 Battle ended by admin.</div>';
                  setTimeout(function () { if (qa) qa.innerHTML = ''; }, 3000);
                }
              } else {
                var qa2 = document.getElementById('cf-quiz-area');
                if (qa2) qa2.innerHTML = '';
              }
            }

            // Refresh admin bar to show End Battle button if a battle is now active
            _refreshAdminBar(CF._currentGroupId, data);
          }
        } catch (e) {
          // Silently ignore transient network errors
        }
      }, 3000);
    };

    /* ─────────────────────────────────────────────────────────────
     * FIX 3 — PATCH _submitQuizAnswer
     *   - Set _answerAnimating = true immediately, clear after 2s
     *   - Remove the redundant getDoc() call after the Firestore write
     *     (the next poller cycle will pick up any changes from other
     *     players; we don't need an immediate re-read for our own answer
     *     because we already rendered it optimistically)
     * ───────────────────────────────────────────────────────────── */
    CF._submitQuizAnswer = async function (groupId, qIdx, chosenIdx) {
      var g = CF._currentGroupData;
      if (!g || !g.quiz) return;
      if (g.quiz.answers && g.quiz.answers[qIdx]) return; // already answered

      var myUid = (typeof uid === 'function') ? uid() : (window._firebaseAuth && window._firebaseAuth.currentUser ? window._firebaseAuth.currentUser.uid : 'anon');
      var myName = (typeof getMyName === 'function') ? getMyName() : 'You';
      var q = g.quiz.questions[qIdx];
      var correct = (chosenIdx === q.ans);
      var nextIdx = qIdx + 1;
      var isLast = nextIdx >= g.quiz.questions.length;

      // ── OPTIMISTIC UPDATE ──
      var optimisticQuiz = JSON.parse(JSON.stringify(g.quiz));
      optimisticQuiz.answers = optimisticQuiz.answers || {};
      optimisticQuiz.answers[qIdx] = { uid: myUid, name: myName, chosen: chosenIdx, correct: correct, ts: Date.now() };
      optimisticQuiz.xp = optimisticQuiz.xp || {};
      optimisticQuiz.xp[myUid] = (optimisticQuiz.xp[myUid] || 0) + (correct ? 10 : 0);
      optimisticQuiz.current = isLast ? qIdx : nextIdx;
      optimisticQuiz.status = isLast ? 'finished' : 'active';

      CF._currentGroupData = Object.assign({}, g, { quiz: optimisticQuiz });

      // ── SET ANIMATION FLAG — suppresses poller for 2s ──
      CF._answerAnimating = true;
      CF._renderQuizQuestion(optimisticQuiz, groupId, g.memberNames);

      if (correct) {
        if (typeof toast === 'function') toast('✅ Correct! +10 XP 🔥', 1800);
        if (typeof XP !== 'undefined') XP.add(10);
      } else {
        if (typeof toast === 'function') toast('❌ Wrong answer!', 1800);
      }

      if (isLast) {
        setTimeout(function () {
          CF._answerAnimating = false;
          CF._renderQuizResults(optimisticQuiz, g.memberNames);
        }, 1800);
      } else {
        setTimeout(function () {
          CF._answerAnimating = false;
          // Render next question from current (possibly server-updated) data
          var currentQuiz = CF._currentGroupData && CF._currentGroupData.quiz;
          CF._renderQuizQuestion(currentQuiz || optimisticQuiz, groupId, (CF._currentGroupData || g).memberNames);
        }, 1800);
      }

      // ── BACKGROUND SYNC — fire and forget, NO follow-up getDoc ──
      var StudyGroups = (window._CrackAI && window._CrackAI.StudyGroups) ? window._CrackAI.StudyGroups : window.StudyGroups;
      StudyGroups.submitAnswer(groupId, g.quiz, qIdx, chosenIdx).then(function () {
        // Update poll hash to reflect our write so the next poll cycle
        // doesn't re-render unnecessarily
        CF._chatPollHash = JSON.stringify({
          msgs: ((CF._currentGroupData && CF._currentGroupData.messages) || []).length,
          quiz: optimisticQuiz.current,
          qstatus: optimisticQuiz.status,
          qanswers: Object.keys(optimisticQuiz.answers || {}).length
        });
      }).catch(function () {});
    };

    /* ─────────────────────────────────────────────────────────────
     * FIX 3b — PATCH _startQuizBattle with 3-2-1 countdown overlay
     *   Shows a fullscreen countdown (3→2→1→GO!) to ALL group members
     *   by writing a 'countdown' field to Firestore that the poller picks up.
     *   Admin sees it immediately via local overlay; others see it via poll.
     * ───────────────────────────────────────────────────────────── */
    var _origStartQuizBattle = CF._startQuizBattle.bind(CF);

    /* Helper — renders the countdown overlay locally */
    function _showCountdownOverlay(onDone) {
      // Remove any existing overlay
      var old = document.getElementById('cf-battle-countdown-overlay');
      if (old) old.remove();

      var overlay = document.createElement('div');
      overlay.id = 'cf-battle-countdown-overlay';
      overlay.style.cssText = [
        'position:fixed', 'inset:0', 'z-index:99998',
        'display:flex', 'flex-direction:column',
        'align-items:center', 'justify-content:center',
        'background:rgba(10,10,20,0.88)',
        'backdrop-filter:blur(6px)',
        '-webkit-backdrop-filter:blur(6px)',
        'pointer-events:none'
      ].join(';');

      var numEl = document.createElement('div');
      numEl.style.cssText = [
        'font-size:96px', 'font-weight:900',
        'color:#6C63FF',
        'text-shadow:0 0 40px rgba(108,99,255,0.8)',
        'transition:transform 0.25s cubic-bezier(.34,1.56,.64,1),opacity 0.25s ease',
        'transform:scale(1)', 'opacity:1'
      ].join(';');

      var labelEl = document.createElement('div');
      labelEl.style.cssText = 'font-size:16px;font-weight:600;color:rgba(200,195,255,0.7);margin-top:12px;letter-spacing:2px;text-transform:uppercase';
      labelEl.textContent = 'Battle starting…';

      overlay.appendChild(numEl);
      overlay.appendChild(labelEl);

      // Mount inside the chat panel if possible, else body
      var panel = document.getElementById('cf-chat-panel') || document.body;
      if (panel !== document.body) {
        overlay.style.position = 'absolute';
      }
      panel.appendChild(overlay);

      var steps = ['3', '2', '1', 'GO!'];
      var colors = ['#f59e0b', '#f97316', '#ef4444', '#22c55e'];
      var i = 0;

      function tick() {
        if (i >= steps.length) {
          overlay.style.opacity = '0';
          overlay.style.transition = 'opacity 0.3s ease';
          setTimeout(function () { overlay.remove(); if (onDone) onDone(); }, 300);
          return;
        }
        numEl.style.opacity = '0';
        numEl.style.transform = 'scale(0.6)';
        numEl.style.color = colors[i];
        numEl.style.textShadow = '0 0 40px ' + colors[i] + '99';
        labelEl.textContent = steps[i] === 'GO!' ? '⚔️ Battle!' : 'Battle starting…';

        setTimeout(function () {
          numEl.textContent = steps[i];
          numEl.style.opacity = '1';
          numEl.style.transform = 'scale(1)';
          i++;
          setTimeout(tick, 900);
        }, 50);
      }
      tick();
    }

    /* Patch _startQuizBattle */
    CF._startQuizBattle = async function (groupId, exam, type) {
      var bar = document.getElementById('cf-admin-bar');
      if (bar) bar.innerHTML = '<span style="font-size:12px;color:rgba(200,195,255,0.5)">⏳ Generating ' + (type === 'pyq' ? 'PYQ' : 'Mock') + ' questions with AI…</span>';

      // Step 1: Generate questions first — AI call, may take a few seconds
      var SG = (window._CrackAI && window._CrackAI.StudyGroups) ? window._CrackAI.StudyGroups : window.StudyGroups;
      await SG.startQuiz(groupId, type, exam);

      // Step 2: Questions are ready — write countdown signal so ALL members see 3-2-1
      try {
        var db = window._firebaseDb;
        var fns = window._firebaseFns;
        await fns.updateDoc(fns.doc(db, 'studyGroups', groupId), {
          'countdown': { active: true, startedAt: Date.now(), startedBy: (window._firebaseAuth && window._firebaseAuth.currentUser ? window._firebaseAuth.currentUser.uid : 'admin') }
        });
      } catch (e) { /* non-fatal */ }

      // Step 3: Show 3-2-1 overlay to admin and wait for it to finish
      await new Promise(function (resolve) {
        _showCountdownOverlay(resolve);
      });

      // Step 4: Clear countdown flag — other members' overlays will dismiss on next poll
      try {
        var db2 = window._firebaseDb;
        var fns2 = window._firebaseFns;
        await fns2.updateDoc(fns2.doc(db2, 'studyGroups', groupId), { 'countdown': null });
      } catch (e) { /* non-fatal */ }

      if (typeof CF._resetAdminBar === 'function') CF._resetAdminBar(groupId, exam);
    };

    /* ── Poller hook: detect countdown signal and show overlay to other members ── */
    var _origOpenGroupChat2 = CF._openGroupChat.bind(CF);
    CF._openGroupChat = async function (groupId) {
      await _origOpenGroupChat2(groupId);

      /* Intercept poller ticks to watch for countdown field */
      var _patchedInterval = CF._chatPollInterval;
      if (_patchedInterval) clearInterval(_patchedInterval);

      var db = window._firebaseDb;
      var fns = window._firebaseFns;
      var _countdownShown = false;

      CF._chatPollInterval = setInterval(async function () {
        if (!CF._currentGroupId) return;
        if (CF._answerAnimating) return;
        try {
          var s = await fns.getDoc(fns.doc(db, 'studyGroups', CF._currentGroupId));
          if (!s.exists()) { CF._stopChatPolling && CF._stopChatPolling(); return; }
          var data = s.data();

          // Countdown signal for non-admin members
          var myUid = window._firebaseAuth && window._firebaseAuth.currentUser ? window._firebaseAuth.currentUser.uid : null;
          var isAdmin = data.adminUid && data.adminUid === myUid;
          if (!isAdmin && data.countdown && data.countdown.active && !_countdownShown) {
            _countdownShown = true;
            _showCountdownOverlay(function () { _countdownShown = false; });
          }
          if (!data.countdown || !data.countdown.active) {
            _countdownShown = false;
          }

          var newHash = JSON.stringify({
            msgs: (data.messages || []).length,
            quiz: data.quiz ? data.quiz.current : null,
            qstatus: data.quiz ? data.quiz.status : null,
            qanswers: data.quiz ? Object.keys(data.quiz.answers || {}).length : 0
          });

          if (newHash !== CF._chatPollHash) {
            CF._chatPollHash = newHash;
            CF._currentGroupData = data;
            CF._renderChatMessages(data.messages || []);
            if (!CF._answerAnimating) {
              var status = data.quiz ? data.quiz.status : null;
              if (status === 'active') {
                CF._renderQuizQuestion(data.quiz, CF._currentGroupId, data.memberNames);
              } else if (status === 'finished') {
                CF._renderQuizResults(data.quiz, data.memberNames);
              } else if (status === 'abandoned') {
                var qa = document.getElementById('cf-quiz-area');
                if (qa) {
                  qa.innerHTML = '<div style="text-align:center;padding:16px;color:rgba(200,195,255,0.5);font-size:13px">🚫 Battle ended by admin.</div>';
                  setTimeout(function () { if (qa) qa.innerHTML = ''; }, 3000);
                }
              } else {
                var qa2 = document.getElementById('cf-quiz-area');
                if (qa2) qa2.innerHTML = '';
              }
            }
            if (typeof _refreshAdminBar === 'function') _refreshAdminBar(CF._currentGroupId, data);
          }
        } catch (e) { /* ignore */ }
      }, 3000);
    };

    /* ─────────────────────────────────────────────────────────────
     * FIX 4 — ADD endBattle() — sets quiz.status = 'abandoned'
     * ───────────────────────────────────────────────────────────── */
    CF._endBattle = async function (groupId) {
      if (!confirm('End the battle for everyone?')) return;
      try {
        var db = window._firebaseDb;
        var fns = window._firebaseFns;
        await fns.updateDoc(fns.doc(db, 'studyGroups', groupId), { 'quiz.status': 'abandoned' });
        if (typeof toast === 'function') toast('🚫 Battle ended.', 2000);
        var qa = document.getElementById('cf-quiz-area');
        if (qa) qa.innerHTML = '';
        // Restore admin bar
        if (CF._currentGroupData) {
          _refreshAdminBar(groupId, CF._currentGroupData);
        }
      } catch (e) {
        if (typeof toast === 'function') toast('❌ Could not end battle.', 2000);
      }
    };

    /* ─────────────────────────────────────────────────────────────
     * FIX 5 — ADD quitBattle() — for non-admin users
     *   Just clears the quiz UI locally and stops them from seeing it.
     *   Does NOT touch Firestore (battle continues for others).
     * ───────────────────────────────────────────────────────────── */
    CF._quitBattle = function () {
      if (!confirm('Leave the battle? Other players will continue.')) return;
      CF._answerAnimating = false;
      var qa = document.getElementById('cf-quiz-area');
      if (qa) {
        qa.innerHTML = '<div style="text-align:center;padding:16px;color:rgba(200,195,255,0.5);font-size:13px">You left the battle.</div>';
        setTimeout(function () { if (qa) qa.innerHTML = ''; }, 3000);
      }
      // Freeze the quiz area by marking current question as answered locally
      // so the poller won't re-inject the question for this user
      if (CF._currentGroupData && CF._currentGroupData.quiz) {
        CF._currentGroupData._userQuit = true;
      }
      if (typeof toast === 'function') toast('👋 You left the battle.', 2000);
    };

    /* ─────────────────────────────────────────────────────────────
     * FIX 6 — PATCH _renderQuizQuestion to inject Quit button
     *   and respect _userQuit flag
     * ───────────────────────────────────────────────────────────── */
    var _origRenderQuizQuestion = CF._renderQuizQuestion.bind(CF);

    CF._renderQuizQuestion = function (quiz, groupId, memberNames) {
      // If this user already quit, don't re-inject the question
      if (CF._currentGroupData && CF._currentGroupData._userQuit && quiz && quiz.status === 'active') return;

      _origRenderQuizQuestion(quiz, groupId, memberNames);

      // Inject the "Quit Battle" button after rendering (only when active)
      if (!quiz || quiz.status !== 'active') return;
      var wrap = document.querySelector('.cf-quiz-battle-wrap');
      if (!wrap || wrap.querySelector('.cf-quit-battle-btn')) return; // already injected

      var quitRow = document.createElement('div');
      quitRow.style.cssText = 'display:flex;justify-content:flex-end;margin-top:8px;';

      var myUid = (typeof uid === 'function') ? uid() : '';
      var isAdmin = CF._currentGroupData && CF._currentGroupData.adminUid === myUid;

      if (isAdmin) {
        // Admin gets "End Battle" button
        quitRow.innerHTML = '<button class="cf-quit-battle-btn" onclick="CF._endBattle(\'' + groupId + '\')" style="background:rgba(239,68,68,0.15);border:1px solid rgba(239,68,68,0.4);color:#f87171;border-radius:8px;padding:6px 14px;font-size:12px;cursor:pointer;font-weight:600">🛑 End Battle for All</button>';
      } else {
        // Regular user gets "Quit Battle" button
        quitRow.innerHTML = '<button class="cf-quit-battle-btn" onclick="CF._quitBattle()" style="background:rgba(239,68,68,0.10);border:1px solid rgba(239,68,68,0.3);color:#f87171;border-radius:8px;padding:6px 14px;font-size:12px;cursor:pointer;font-weight:600">🚪 Quit Battle</button>';
      }

      wrap.appendChild(quitRow);
    };

    /* ─────────────────────────────────────────────────────────────
     * FIX 7 — PATCH ADMIN BAR to show "End Battle" during active quiz
     * ───────────────────────────────────────────────────────────── */
    function _refreshAdminBar(groupId, data) {
      var bar = document.getElementById('cf-admin-bar');
      if (!bar) return;
      var myUid = (typeof uid === 'function') ? uid() : '';
      if (!data || data.adminUid !== myUid) return;

      var isActive = data.quiz && data.quiz.status === 'active';
      if (isActive) {
        bar.innerHTML = '<span style="font-size:11px;font-weight:700;color:#f59e0b;margin-right:4px">👑 Admin</span>'
          + '<button class="cf-btn cf-btn-sm" style="background:rgba(239,68,68,0.15);border:1px solid rgba(239,68,68,0.4);color:#f87171;border-radius:8px;padding:6px 12px;font-size:12px;cursor:pointer;font-weight:600" onclick="CF._endBattle(\'' + groupId + '\')">🛑 End Battle</button>';
      }
      // If not active, leave the bar as-is (original code handles it)
    }

    /* ─────────────────────────────────────────────────────────────
     * FIX 8 — PATCH poller render to respect _userQuit flag
     * ───────────────────────────────────────────────────────────── */
    var _origRenderQuizResults = CF._renderQuizResults.bind(CF);
    CF._renderQuizResults = function (quiz, memberNames) {
      // Clear quit flag when battle is truly over — show results to everyone
      if (CF._currentGroupData) CF._currentGroupData._userQuit = false;
      _origRenderQuizResults(quiz, memberNames);
      // battle-arena-patch.js v2.0 will further enhance results with ELO/coins/highlights
    };

    console.info('[BattleFix] v1.1 — lag fix + quit/end battle applied (compatible with v2.0 ELO patch)');
  });

})();