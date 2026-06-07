/**
 * intro.js — CrackAI v15.0  "IMPACT"
 * A blazing 3D AI orb emerges from deep center,
 * accelerates toward the viewer, SMASHES full-screen
 * in a blinding shockwave before the home screen reveals.
 *
 * Phases:
 *   0. VOID   — Black screen, tiny distant glow
 *   1. EMERGE — Orb materialises from depth
 *   2. CHARGE — Orb pulses, energy builds
 *   3. LAUNCH — Orb rockets at camera (perspective zoom)
 *   4. IMPACT — Full-screen white/orange blast
 *   5. BRAND  — CrackAI name + tagline + stats
 *   6. EXIT   — Dissolve to app
 *
 * Zero external dependencies. Pure Canvas 2D + CSS.
 */
(function () {
  'use strict';

  if (document.getElementById('sscIntroOverlay')) return;
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  /* CSS */
  const ST = document.createElement('style');
  ST.textContent = `
    @import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@300;400;600;700;800&family=JetBrains+Mono:wght@300;400;600&display=swap');
    #sscIntroOverlay {
      position:fixed;inset:0;z-index:99999;overflow:hidden;touch-action:none;
      background:#000;will-change:opacity;
    }
    #ni-canvas { position:absolute;inset:0;width:100%;height:100%;display:block; }
    #ni-hud {
      position:absolute;inset:0;display:flex;flex-direction:column;
      align-items:center;justify-content:center;pointer-events:none;z-index:10;
    }
    #ni-brand {
      font-family:'Space Grotesk',sans-serif;
      font-size:clamp(52px,13vw,104px);font-weight:800;
      letter-spacing:-0.03em;line-height:1;opacity:0;color:#fff;
      transform:scale(0.55) translateY(40px);
      transition:opacity 0.55s ease,transform 0.65s cubic-bezier(0.22,1,0.36,1);
      filter:drop-shadow(0 0 40px rgba(249,115,22,0.9));
    }
    #ni-brand.show { opacity:1;transform:scale(1) translateY(0); }
    #ni-brand .crack { color:#fff; }
    #ni-brand .ai-txt {
      background:linear-gradient(135deg,#f97316 0%,#ec4899 45%,#8b5cf6 100%);
      -webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;
    }
    #ni-tagline {
      font-family:'JetBrains Mono',monospace;font-size:clamp(10px,2.2vw,13px);
      font-weight:300;letter-spacing:0.22em;text-transform:uppercase;
      color:rgba(249,115,22,0.75);margin-top:12px;opacity:0;
      transition:opacity 0.6s ease 0.3s;
    }
    #ni-tagline.show { opacity:1; }
    #ni-cursor {
      display:inline-block;width:2px;height:1em;background:#f97316;
      margin-left:3px;vertical-align:text-bottom;
      animation:niCurBlink 0.6s step-end infinite;
    }
    @keyframes niCurBlink { 0%,100%{opacity:1} 50%{opacity:0} }
    #ni-stats {
      display:flex;gap:clamp(10px,2.5vw,24px);
      margin-top:clamp(22px,4vw,36px);opacity:0;transition:opacity 0.7s ease;
    }
    .ni-stat {
      display:flex;flex-direction:column;align-items:center;
      padding:clamp(8px,1.5vw,12px) clamp(14px,2.5vw,22px);
      border:1px solid rgba(249,115,22,0.25);border-radius:12px;
      background:rgba(249,115,22,0.05);backdrop-filter:blur(8px);
      -webkit-backdrop-filter:blur(8px);position:relative;overflow:hidden;
    }
    .ni-stat::before {
      content:'';position:absolute;top:0;left:-100%;width:100%;height:100%;
      background:linear-gradient(90deg,transparent,rgba(249,115,22,0.1),transparent);
      animation:niShimmer 2.5s ease infinite;
    }
    @keyframes niShimmer { to{left:200%;} }
    .ni-stat-val {
      font-family:'Space Grotesk',sans-serif;font-size:clamp(16px,3.5vw,24px);font-weight:700;
      background:linear-gradient(135deg,#f97316,#ec4899);
      -webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;
    }
    .ni-stat-lbl {
      font-family:'JetBrains Mono',monospace;font-size:clamp(7px,1.3vw,9px);
      letter-spacing:0.14em;text-transform:uppercase;color:rgba(255,255,255,0.3);margin-top:3px;
    }
    .ni-corner { position:absolute;width:clamp(18px,3vw,28px);height:clamp(18px,3vw,28px);opacity:0;transition:opacity 0.6s ease; }
    .ni-corner.show { opacity:1; }
    .ni-tl{top:clamp(16px,3vw,32px);left:clamp(16px,3vw,32px);}
    .ni-tr{top:clamp(16px,3vw,32px);right:clamp(16px,3vw,32px);transform:scaleX(-1);}
    .ni-bl{bottom:clamp(16px,3vw,32px);left:clamp(16px,3vw,32px);transform:scaleY(-1);}
    .ni-br{bottom:clamp(16px,3vw,32px);right:clamp(16px,3vw,32px);transform:scale(-1,-1);}
    #ni-sys {
      position:absolute;bottom:clamp(16px,3vw,28px);left:50%;transform:translateX(-50%);
      font-family:'JetBrains Mono',monospace;font-size:clamp(7px,1.4vw,9px);
      letter-spacing:0.20em;text-transform:uppercase;color:rgba(255,255,255,0.18);
      opacity:0;transition:opacity 1s ease 0.5s;white-space:nowrap;
    }
    #ni-sys.show { opacity:1; }
    #ni-ver {
      position:absolute;top:clamp(16px,3vw,28px);right:clamp(16px,3vw,32px);
      font-family:'JetBrains Mono',monospace;font-size:clamp(7px,1.3vw,9px);
      letter-spacing:0.18em;text-transform:uppercase;color:rgba(249,115,22,0.35);
      opacity:0;transition:opacity 0.8s ease 0.4s;
    }
    #ni-ver.show { opacity:1; }
    #ni-prog { position:absolute;bottom:0;left:0;right:0;height:2px;background:rgba(255,255,255,0.05); }
    #ni-prog-fill {
      height:100%;width:0%;
      background:linear-gradient(90deg,#f97316,#ec4899,#8b5cf6);background-size:300% 100%;
      animation:niProgGrad 1.5s linear infinite;
      box-shadow:0 0 12px rgba(249,115,22,0.8);transition:width 0.08s linear;
    }
    @keyframes niProgGrad { 0%{background-position:0% 0;} 100%{background-position:300% 0;} }
    #ni-flash {
      position:absolute;inset:0;z-index:25;opacity:0;pointer-events:none;
      background:radial-gradient(circle at 50% 50%,#ffffff 0%,rgba(249,115,22,0.95) 20%,rgba(139,92,246,0.7) 50%,rgba(0,0,0,0) 80%);
    }
    @media(max-width:480px){ #ni-stats{flex-wrap:wrap;justify-content:center;gap:8px;} .ni-stat{padding:8px 14px;min-width:80px;} }
    @media(max-height:500px) and (orientation:landscape){ #ni-stats{display:none;} #ni-brand{font-size:36px;} }
  `;
  document.head.appendChild(ST);

  /* DOM */
  const cornerSVG = `<svg viewBox="0 0 28 28" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M2 14V2H14" stroke="rgba(249,115,22,0.6)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><circle cx="2" cy="2" r="1.5" fill="rgba(249,115,22,0.8)"/></svg>`;
  const ov = document.createElement('div');
  ov.id = 'sscIntroOverlay';
  ov.innerHTML = `
    <canvas id="ni-canvas"></canvas>
    <div class="ni-corner ni-tl">${cornerSVG}</div>
    <div class="ni-corner ni-tr">${cornerSVG}</div>
    <div class="ni-corner ni-bl">${cornerSVG}</div>
    <div class="ni-corner ni-br">${cornerSVG}</div>
    <div id="ni-hud">
      <div id="ni-brand"><span class="crack">Crack</span><span class="ai-txt">AI</span></div>
      <div id="ni-tagline"><span id="ni-typed"></span><span id="ni-cursor"></span></div>
      <div id="ni-stats">
        <div class="ni-stat"><div class="ni-stat-val" id="ns-q">0</div><div class="ni-stat-lbl">Questions</div></div>
        <div class="ni-stat"><div class="ni-stat-val" id="ns-a">0</div><div class="ni-stat-lbl">AI Accuracy</div></div>
        <div class="ni-stat"><div class="ni-stat-val" id="ns-s">0</div><div class="ni-stat-lbl">Students</div></div>
      </div>
    </div>
    <div id="ni-sys">CrackAI Neural Engine · India's #1 Study AI</div>
    <div id="ni-ver">v15.0 · IMPACT</div>
    <div id="ni-prog"><div id="ni-prog-fill"></div></div>
    <div id="ni-flash"></div>
  `;
  document.body.insertBefore(ov, document.body.firstChild);

  /* CANVAS */
  const canvas = document.getElementById('ni-canvas');
  const ctx    = canvas.getContext('2d');
  const MB     = window.innerWidth < 620;
  const DPR    = Math.min(window.devicePixelRatio || 1, MB ? 1.5 : 2);
  let W, H, CX, CY;

  function resize() {
    W = window.innerWidth; H = window.innerHeight;
    CX = W / 2; CY = H / 2;
    canvas.width  = W * DPR; canvas.height = H * DPR;
    canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
    ctx.scale(DPR, DPR);
  }
  resize();
  window.addEventListener('resize', resize);

  /* UTILS */
  const lerp    = (a,b,t)  => a + (b-a)*t;
  const clamp   = (v,lo,hi)=> Math.max(lo,Math.min(hi,v));
  const eOut3   = t => 1 - Math.pow(1-t,3);
  const eOut5   = t => 1 - Math.pow(1-t,5);
  const eIn5    = t => t*t*t*t*t;
  const eInOut5 = t => t<0.5 ? 16*t*t*t*t*t : 1-Math.pow(-2*t+2,5)/2;
  const rand    = (lo,hi)  => lo + Math.random()*(hi-lo);
  const TAU     = Math.PI*2;

  /* ORB STATE */
  let orbZ=1.0, orbAlpha=0, orbEnergy=0, orbX=0, orbY=0;

  function orbRadius(z) {
    return (Math.min(W,H) * 0.038) / Math.max(z, 0.001);
  }

  /* PARTICLES */
  const particles = [];
  function spawnParticle(x,y,r,type) {
    const angle = rand(0,TAU);
    const speed = type==='charge' ? rand(r*0.4,r*1.2) : rand(r*0.8,r*3.5);
    const colors= ['#f97316','#ec4899','#8b5cf6','#06b6d4','#fff','#ffd700'];
    particles.push({
      x,y,
      vx:Math.cos(angle)*speed, vy:Math.sin(angle)*speed,
      alpha:rand(0.6,1), size:type==='impact'?rand(2,7):rand(1,3.5),
      life:0, maxLife:type==='impact'?rand(0.4,1.1):rand(0.3,0.8),
      color:colors[Math.floor(rand(0,colors.length))], type
    });
  }
  function updateParticles(dt) {
    for(let i=particles.length-1;i>=0;i--){
      const p=particles[i];
      p.life+=dt; p.x+=p.vx*dt; p.y+=p.vy*dt;
      p.vx*=0.92; p.vy*=0.92;
      if(p.type!=='impact') p.vy-=30*dt;
      if(p.life>p.maxLife) particles.splice(i,1);
    }
  }
  function drawParticles() {
    particles.forEach(p=>{
      const t=p.life/p.maxLife;
      const a=p.alpha*(1-eOut3(t));
      if(a<0.01) return;
      ctx.save(); ctx.globalAlpha=a;
      ctx.fillStyle=p.color; ctx.shadowColor=p.color;
      ctx.shadowBlur=p.type==='impact'?16:8;
      ctx.beginPath(); ctx.arc(p.x,p.y,p.size*(1-t*0.5),0,TAU); ctx.fill();
      ctx.restore();
    });
  }

  /* SHOCKWAVES */
  const shockwaves=[];
  function spawnShockwave(delay) {
    shockwaves.push({
      r:0, maxR:Math.max(W,H)*1.5,
      speed:rand(900,1400),
      alpha:rand(0.7,1.0), width:rand(3,8),
      color:['#f97316','#ec4899','#8b5cf6','#fff'][Math.floor(rand(0,4))],
      delay, life:-delay
    });
  }
  function updateShockwaves(dt) {
    shockwaves.forEach(sw=>{ sw.life+=dt; if(sw.life>0) sw.r+=sw.speed*dt; });
  }
  function drawShockwaves() {
    shockwaves.forEach(sw=>{
      if(sw.life<=0||sw.r<=0) return;
      const prog=sw.r/sw.maxR;
      const alpha=sw.alpha*(1-eOut3(prog));
      if(alpha<0.005) return;
      ctx.save(); ctx.globalAlpha=alpha;
      ctx.beginPath(); ctx.arc(CX,CY,sw.r,0,TAU);
      ctx.strokeStyle=sw.color; ctx.lineWidth=sw.width*(1-prog*0.7);
      ctx.shadowColor=sw.color; ctx.shadowBlur=30; ctx.stroke();
      ctx.restore();
    });
  }

  /* DEBRIS */
  const debris=[];
  function spawnDebris() {
    const count=MB?40:80;
    for(let i=0;i<count;i++){
      const angle=rand(0,TAU); const speed=rand(200,800);
      debris.push({
        x:CX,y:CY,
        vx:Math.cos(angle)*speed, vy:Math.sin(angle)*speed,
        len:rand(20,120), alpha:rand(0.5,1),
        life:0, maxLife:rand(0.3,0.9),
        color:['#f97316','#ec4899','#8b5cf6','#06b6d4','#fff','#ffd700'][Math.floor(rand(0,6))]
      });
    }
  }
  function updateDebris(dt) {
    for(let i=debris.length-1;i>=0;i--){
      const d=debris[i];
      d.life+=dt; d.x+=d.vx*dt; d.y+=d.vy*dt;
      d.vx*=0.88; d.vy*=0.88;
      if(d.life>d.maxLife) debris.splice(i,1);
    }
  }
  function drawDebris() {
    debris.forEach(d=>{
      const t=d.life/d.maxLife;
      const a=d.alpha*(1-eOut3(t));
      if(a<0.01) return;
      const spd=Math.hypot(d.vx,d.vy)||1;
      const nx=d.vx/spd, ny=d.vy/spd;
      ctx.save(); ctx.globalAlpha=a;
      ctx.strokeStyle=d.color; ctx.lineWidth=rand(0.5,2);
      ctx.shadowColor=d.color; ctx.shadowBlur=10; ctx.lineCap='round';
      ctx.beginPath();
      ctx.moveTo(d.x-nx*d.len*0.3, d.y-ny*d.len*0.3);
      ctx.lineTo(d.x+nx*d.len*0.1, d.y+ny*d.len*0.1);
      ctx.stroke(); ctx.restore();
    });
  }

  /* BACKGROUND */
  let bgAlpha=0;
  function drawBG(t) {
    ctx.fillStyle='#000'; ctx.fillRect(0,0,W,H);
    if(bgAlpha<0.01) return;
    const grd=ctx.createRadialGradient(CX,CY,0,CX,CY,Math.max(W,H)*0.8);
    grd.addColorStop(0,`rgba(12,5,28,${bgAlpha})`);
    grd.addColorStop(0.5,`rgba(5,2,14,${bgAlpha})`);
    grd.addColorStop(1,`rgba(0,0,0,${bgAlpha})`);
    ctx.fillStyle=grd; ctx.fillRect(0,0,W,H);
    [{x:CX+Math.sin(t*0.4)*W*0.2,y:CY-H*0.25,r:W*0.3,c:[249,115,22],a:0.05},
     {x:CX-Math.cos(t*0.3)*W*0.22,y:CY+H*0.2,r:W*0.35,c:[139,92,246],a:0.04}
    ].forEach(p=>{
      const g2=ctx.createRadialGradient(p.x,p.y,0,p.x,p.y,p.r);
      g2.addColorStop(0,`rgba(${p.c[0]},${p.c[1]},${p.c[2]},${p.a*bgAlpha})`);
      g2.addColorStop(1,'rgba(0,0,0,0)');
      ctx.fillStyle=g2; ctx.fillRect(0,0,W,H);
    });
  }

  /* DRAW ORB — multi-layer 3D sphere */
  function drawOrb(t,z,energy) {
    const r=orbRadius(z);
    const cx=CX+orbX, cy=CY+orbY;
    if(r<1||orbAlpha<0.01) return;
    const depthFade=clamp(1-z*0.35,0.3,1);

    ctx.save(); ctx.globalAlpha=orbAlpha*depthFade;

    // 1. Wide halo
    const haloR=r*(2.8+energy*2.0);
    const halo=ctx.createRadialGradient(cx,cy,r*0.4,cx,cy,haloR);
    halo.addColorStop(0,`rgba(249,115,22,${0.18+energy*0.28})`);
    halo.addColorStop(0.3,`rgba(139,92,246,${0.10+energy*0.18})`);
    halo.addColorStop(0.6,`rgba(236,72,153,${0.05+energy*0.10})`);
    halo.addColorStop(1,'rgba(0,0,0,0)');
    ctx.fillStyle=halo;
    ctx.beginPath(); ctx.arc(cx,cy,haloR,0,TAU); ctx.fill();

    // 2. Atmosphere
    const atmoR=r*1.48;
    const atmo=ctx.createRadialGradient(cx,cy,r*0.7,cx,cy,atmoR);
    atmo.addColorStop(0,`rgba(255,160,80,${0.5+energy*0.35})`);
    atmo.addColorStop(0.5,`rgba(200,80,200,${0.25+energy*0.22})`);
    atmo.addColorStop(1,'rgba(0,0,0,0)');
    ctx.fillStyle=atmo;
    ctx.beginPath(); ctx.arc(cx,cy,atmoR,0,TAU); ctx.fill();

    // 3. Sphere body (dark core gradient)
    const body=ctx.createRadialGradient(cx-r*0.25,cy-r*0.28,r*0.05,cx,cy,r);
    body.addColorStop(0,'#fff8f0');
    body.addColorStop(0.12,'#ffd080');
    body.addColorStop(0.3,'#f97316');
    body.addColorStop(0.6,'#7c3aed');
    body.addColorStop(0.82,'#1a0a2e');
    body.addColorStop(1,'#050010');
    ctx.fillStyle=body;
    ctx.beginPath(); ctx.arc(cx,cy,r,0,TAU); ctx.fill();

    // 4. Specular highlight (top-left)
    const hlR=r*0.35;
    const hl=ctx.createRadialGradient(cx-r*0.28,cy-r*0.30,0,cx-r*0.20,cy-r*0.22,hlR);
    hl.addColorStop(0,'rgba(255,255,255,0.95)');
    hl.addColorStop(0.4,'rgba(255,230,180,0.45)');
    hl.addColorStop(1,'rgba(255,255,255,0)');
    ctx.fillStyle=hl;
    ctx.beginPath(); ctx.arc(cx-r*0.20,cy-r*0.22,hlR,0,TAU); ctx.fill();

    // 5. Bounce light (bottom-right purple)
    const hl2=ctx.createRadialGradient(cx+r*0.3,cy+r*0.32,0,cx+r*0.3,cy+r*0.32,r*0.22);
    hl2.addColorStop(0,'rgba(139,92,246,0.38)');
    hl2.addColorStop(1,'rgba(0,0,0,0)');
    ctx.fillStyle=hl2;
    ctx.beginPath(); ctx.arc(cx+r*0.3,cy+r*0.32,r*0.22,0,TAU); ctx.fill();

    // 6. Equatorial ring (rotating)
    const ringRx=r*1.15, ringRy=r*0.22;
    const ringAlpha=0.3+energy*0.6;
    ctx.save();
    ctx.translate(cx,cy); ctx.rotate(t*1.1);
    ctx.scale(1,ringRy/ringRx);
    ctx.strokeStyle=`rgba(249,115,22,${ringAlpha})`;
    ctx.lineWidth=Math.max(1,r*0.04);
    ctx.shadowColor='#f97316'; ctx.shadowBlur=r*0.28;
    ctx.beginPath(); ctx.arc(0,0,ringRx,0,TAU); ctx.stroke();
    ctx.rotate(Math.PI/3);
    ctx.strokeStyle=`rgba(139,92,246,${ringAlpha*0.7})`;
    ctx.shadowColor='#8b5cf6';
    ctx.beginPath(); ctx.arc(0,0,ringRx*0.88,0,TAU); ctx.stroke();
    ctx.restore();

    // 7. Energy charge pulse
    if(energy>0.25) {
      const pulseT=((t*2)%1);
      const pulseR=r*(1+pulseT*2.8);
      const pulseA=(1-pulseT)*(energy-0.25)*0.85;
      ctx.save(); ctx.globalAlpha=orbAlpha*pulseA;
      ctx.beginPath(); ctx.arc(cx,cy,pulseR,0,TAU);
      ctx.strokeStyle='#f97316'; ctx.lineWidth=2;
      ctx.shadowColor='#f97316'; ctx.shadowBlur=22; ctx.stroke();
      ctx.restore();
    }

    ctx.restore();
  }

  /* SPEED LINES — during launch */
  const speedLines=[];
  function initSpeedLines() {
    speedLines.length=0;
    const count=MB?35:70;
    for(let i=0;i<count;i++){
      const angle=rand(0,TAU);
      speedLines.push({
        angle, dist:rand(0.12,0.65), len:rand(0.04,0.18),
        alpha:rand(0.3,0.9), speed:rand(0.9,2.2),
        color:['#f97316','#ec4899','#8b5cf6','#06b6d4','#fff'][Math.floor(rand(0,5))]
      });
    }
  }
  function drawSpeedLines(progress) {
    if(!speedLines.length) return;
    const maxR=Math.max(W,H)*0.88;
    speedLines.forEach(sl=>{
      const r1=maxR*sl.dist*(0.5+progress*0.8);
      const r2=r1+maxR*sl.len*(0.5+progress*1.6);
      ctx.save(); ctx.globalAlpha=sl.alpha*progress*0.9;
      ctx.strokeStyle=sl.color; ctx.lineWidth=1;
      ctx.shadowColor=sl.color; ctx.shadowBlur=6;
      ctx.beginPath();
      ctx.moveTo(CX+Math.cos(sl.angle)*r1, CY+Math.sin(sl.angle)*r1);
      ctx.lineTo(CX+Math.cos(sl.angle)*r2, CY+Math.sin(sl.angle)*r2);
      ctx.stroke(); ctx.restore();
    });
  }

  /* HUD REFS */
  const brandEl  = document.getElementById('ni-brand');
  const taglineEl= document.getElementById('ni-tagline');
  const typedEl  = document.getElementById('ni-typed');
  const statsEl  = document.getElementById('ni-stats');
  const sysEl    = document.getElementById('ni-sys');
  const verEl    = document.getElementById('ni-ver');
  const progFill = document.getElementById('ni-prog-fill');
  const flashEl  = document.getElementById('ni-flash');
  const corners  = document.querySelectorAll('.ni-corner');

  const TAGLINE_TEXT = "India's #1 AI Study Engine";
  let typeIdx=0, typeTimer=0;
  const TYPE_SPEED=0.048;
  let hudShown=false, typeStarted=false, statsShown=false, cornersShown=false, impactFired=false;

  function showBrand() {
    brandEl.classList.add('show');
    setTimeout(()=>{ taglineEl.classList.add('show'); typeStarted=true; }, 200);
  }
  function tickTypewriter(dt) {
    if(!typeStarted) return;
    typeTimer+=dt;
    if(typeTimer>TYPE_SPEED && typeIdx<TAGLINE_TEXT.length){
      typeTimer=0; typeIdx++;
      typedEl.textContent=TAGLINE_TEXT.substring(0,typeIdx);
    }
  }
  function animCount(el,target,dur,suffix) {
    const start=Date.now();
    const tick=()=>{
      const p=Math.min((Date.now()-start)/(dur*1000),1);
      const val=Math.floor(eOut3(p)*target);
      if(suffix){ el.textContent=Math.floor(eOut3(p)*target)+suffix; }
      else { el.textContent=val>=1000?(val>=100000?Math.floor(val/1000)+'K':val.toLocaleString('en-IN')):String(val); }
      if(p<1) requestAnimationFrame(tick);
    };
    tick();
  }
  function setProgress(pct){ progFill.style.width=pct+'%'; }

  /* MAIN LOOP */
  let elapsed=0, phase=0, phaseT=0, rafId=null, lastTs=null;

  function animate(ts) {
    rafId=requestAnimationFrame(animate);
    if(!lastTs) lastTs=ts;
    const dt=Math.min((ts-lastTs)/1000,0.05);
    lastTs=ts; elapsed+=dt; phaseT+=dt;

    ctx.clearRect(0,0,W,H);
    ctx.fillStyle='#000'; ctx.fillRect(0,0,W,H);

    /* PHASE 0 — VOID (0–0.4s) */
    if(phase===0) {
      bgAlpha=eOut3(clamp(phaseT/0.4,0,1))*0.4;
      orbAlpha=eOut5(clamp(phaseT/0.35,0,1))*0.25;
      orbZ=1.0; orbEnergy=0; orbX=orbY=0;
      drawBG(elapsed); drawOrb(elapsed,orbZ,orbEnergy);
      setProgress(5);
      if(phaseT>0.4){ phase=1; phaseT=0; }
    }
    /* PHASE 1 — EMERGE (0.4–1.2s) */
    else if(phase===1) {
      const t=clamp(phaseT/0.8,0,1);
      bgAlpha=lerp(0.4,1,eOut3(t));
      orbAlpha=lerp(0.25,1,eOut3(t));
      orbZ=lerp(1.0,0.55,eOut3(t));
      orbEnergy=0;
      orbX=Math.sin(elapsed*1.8)*4; orbY=Math.cos(elapsed*2.1)*4;
      if(Math.random()>0.75) spawnParticle(CX+orbX,CY+orbY,orbRadius(orbZ),'charge');
      drawBG(elapsed); updateParticles(dt); drawParticles();
      drawOrb(elapsed,orbZ,orbEnergy);
      setProgress(5+Math.floor(t*20));
      if(phaseT>0.8){ phase=2; phaseT=0; }
    }
    /* PHASE 2 — CHARGE (1.2–2.4s) */
    else if(phase===2) {
      const t=clamp(phaseT/1.2,0,1);
      bgAlpha=1; orbAlpha=1;
      orbZ=lerp(0.55,0.42,eOut3(t));
      orbEnergy=eInOut5(t);
      const wobble=6+orbEnergy*14;
      orbX=Math.sin(elapsed*2.4)*wobble; orbY=Math.cos(elapsed*3.1)*wobble*0.6;
      for(let i=0;i<(orbEnergy>0.6?3:1);i++){
        if(Math.random()>0.4) spawnParticle(CX+orbX,CY+orbY,orbRadius(orbZ),'charge');
      }
      drawBG(elapsed); updateParticles(dt); drawParticles();
      drawOrb(elapsed,orbZ,orbEnergy);
      setProgress(25+Math.floor(t*25));
      if(phaseT>1.2){ phase=3; phaseT=0; initSpeedLines(); }
    }
    /* PHASE 3 — LAUNCH (2.4–3.1s) — exponential zoom */
    else if(phase===3) {
      const t=clamp(phaseT/0.7,0,1);
      const zoom=eIn5(t);
      orbZ=lerp(0.42,0.003,zoom);
      orbAlpha=lerp(1,0.55,zoom*0.5);
      orbEnergy=lerp(1,1.5,zoom);
      bgAlpha=1;
      orbX=lerp(Math.sin(elapsed*2.4)*6,0,zoom);
      orbY=lerp(Math.cos(elapsed*3.1)*4,0,zoom);
      drawBG(elapsed);
      updateShockwaves(dt); drawShockwaves();
      drawSpeedLines(zoom);
      updateParticles(dt); drawParticles();
      drawOrb(elapsed,orbZ,orbEnergy);
      setProgress(50+Math.floor(zoom*25));
      if(t>=1){ phase=4; phaseT=0; }
    }
    /* PHASE 4 — IMPACT (3.1–3.6s) */
    else if(phase===4) {
      const t=clamp(phaseT/0.5,0,1);
      if(!impactFired){
        impactFired=true;
        for(let i=0;i<(MB?4:7);i++) spawnShockwave(i*0.04);
        spawnDebris();
        for(let i=0;i<(MB?25:60);i++) spawnParticle(CX,CY,200,'impact');
      }
      drawBG(elapsed);
      updateShockwaves(dt); drawShockwaves();
      updateDebris(dt); drawDebris();
      updateParticles(dt); drawParticles();
      const flashPeak=clamp(phaseT/0.08,0,1);
      const flashFade=1-clamp((phaseT-0.08)/0.42,0,1);
      flashEl.style.opacity=String(flashPeak*flashFade);
      setProgress(75+Math.floor(t*5));
      if(t>=1){ phase=5; phaseT=0; flashEl.style.opacity='0'; }
    }
    /* PHASE 5 — BRAND (3.6–5.6s) */
    else if(phase===5) {
      const t=clamp(phaseT/2.0,0,1);
      bgAlpha=1;
      drawBG(elapsed);
      updateShockwaves(dt); drawShockwaves();
      updateDebris(dt); drawDebris();
      updateParticles(dt); drawParticles();
      if(!hudShown){
        hudShown=true; showBrand();
        setTimeout(()=>{ corners.forEach(c=>c.classList.add('show')); sysEl.classList.add('show'); verEl.classList.add('show'); },400);
      }
      tickTypewriter(dt);
      if(!statsShown && typeIdx>=TAGLINE_TEXT.length){
        statsShown=true; statsEl.style.opacity='1';
        animCount(document.getElementById('ns-q'),284600,2.0);
        animCount(document.getElementById('ns-a'),98,1.8,'%');
        animCount(document.getElementById('ns-s'),51200,2.2);
      }
      setProgress(80+Math.floor(t*20));
      if(t>=1){ setProgress(100); phase=6; phaseT=0; }
    }
    /* PHASE 6 — EXIT */
    else if(phase===6) {
      const t=clamp(phaseT/0.7,0,1);
      drawBG(elapsed); updateParticles(dt); drawParticles();
      tickTypewriter(dt);
      if(t>=1 && !exited){ cancelAnimationFrame(rafId); doExit(0); }
    }
  }

  animate(0);

  /* EXIT */
  let exited=false;
  function doExit(delay) {
    if(exited) return; exited=true;
    setTimeout(()=>{
      ov.style.transition='opacity 0.55s cubic-bezier(.4,0,.2,1)';
      ov.style.opacity='0';
      setTimeout(()=>{ ov.style.display='none'; try{ov.parentNode.removeChild(ov);}catch(e){} },600);
    }, delay);
  }

  window._niStartExit=()=>{ if(phase<6){ phase=6; phaseT=0; } };

  const startTs=Date.now();
  const MIN_SHOW=5600;
  function triggerExit() {
    const waited=Date.now()-startTs;
    setTimeout(()=>{ if(window._niStartExit) window._niStartExit(); else doExit(0); }, Math.max(0,MIN_SHOW-waited));
  }
  if(document.readyState==='complete'){ triggerExit(); }
  else { window.addEventListener('load',triggerExit,{once:true}); }
  setTimeout(()=>{ if(!exited) doExit(0); },8000);

})();