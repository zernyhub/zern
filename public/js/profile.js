(function () {
  'use strict';

  const $ = (sel) => document.querySelector(sel);
  let CFG = null;
  let audioCtx = null, analyser = null, sourceNode = null;
  let renderGen = 0;
  let liveIntervals = [];
  const isPreview = new URLSearchParams(location.search).get('preview') === '1';

  function trackedInterval(fn, ms) {
    const id = setInterval(fn, ms);
    liveIntervals.push(id);
    return id;
  }

  async function loadProfile() {
    const res = await fetch('/api/profile', { cache: 'no-store' });
    CFG = await res.json();
    render();
    if (isPreview) {
      window.addEventListener('message', (e) => {
        if (e.data && e.data.type === 'ADB_SET_PROFILE') {
          CFG = e.data.profile;
          render();
        } else if (e.data && e.data.type === 'ADB_SELECT_ELEMENT') {
          highlightElement(e.data.selector);
        }
      });
      document.body.addEventListener('click', (e) => {
        const target = e.target.closest('[data-editable]');
        if (target) {
          parent.postMessage({ type: 'ADB_ELEMENT_CLICKED', editable: target.dataset.editable }, '*');
        }
      }, true);
    }
  }

  function highlightElement(key) {
    document.querySelectorAll('.adb-selected').forEach((el) => el.classList.remove('adb-selected'));
    if (key) {
      const el = document.querySelector(`[data-editable="${key}"]`);
      if (el) el.classList.add('adb-selected');
    }
  }

  function render() {
    renderGen++;
    liveIntervals.forEach(clearInterval);
    liveIntervals = [];
    applyMeta();
    applyTheme();
    applyLayout();
    applyBackground();
    applyEnterScreen();
    applyAvatar();
    applyUsername();
    applyBio();
    applyBadges();
    applySocials();
    applyGallery();
    applyVisitorCounter();
    applySkills();
    applyCursor();
    applyCustomCss();
    setupMusic();
    setupTilt();
  }

  // ---------------- meta / theme / layout ----------------
  function applyMeta() {
    document.title = CFG.meta?.pageTitle || 'profile';
    if (CFG.meta?.favicon) $('#favicon').href = CFG.meta.favicon;
  }

  function applyTheme() {
    const t = CFG.theme || {};
    document.body.className = document.body.className.replace(/theme-\S+/g, '');
    document.body.classList.add(`theme-${t.preset || 'midnight'}`);
    const root = document.documentElement.style;
    if (t.primaryColor) root.setProperty('--primary', t.primaryColor);
    if (t.secondaryColor) root.setProperty('--secondary', t.secondaryColor);
    if (t.backgroundDark) root.setProperty('--bg-dark', t.backgroundDark);
    if (t.textColor) root.setProperty('--text-color', t.textColor);
    if (t.cardOpacity != null) root.setProperty('--card-bg-opacity', t.cardOpacity);
    if (t.cardBlur != null) root.setProperty('--card-blur', t.cardBlur + 'px');
    if (t.cardBorderColor) root.setProperty('--card-border', t.cardBorderColor);
    if (t.cardRadius != null) root.setProperty('--card-radius', t.cardRadius + 'px');
  }

  function applyLayout() {
    document.body.className = document.body.className.replace(/layout-\S+/g, '');
    document.body.classList.add(`layout-${CFG.layout?.preset || 'classic'}`);
  }

  // ---------------- background ----------------
  function applyBackground() {
    const b = CFG.background || {};
    const video = $('#bg-video'), image = $('#bg-image'), color = $('#bg-color'), particles = $('#bg-particles'), overlay = $('#bg-overlay');
    [video, image, color, particles].forEach((el) => el.classList.add('hidden'));
    video.pause();

    if (b.type === 'video' && b.videoUrl) {
      video.src = b.videoUrl; video.classList.remove('hidden'); video.play().catch(() => {});
    } else if (b.type === 'image' && b.imageUrl) {
      image.src = b.imageUrl; image.classList.remove('hidden');
    } else if (b.type === 'slideshow' && b.slideshow?.images?.length) {
      image.classList.remove('hidden');
      let i = 0;
      const show = () => { image.src = b.slideshow.images[i % b.slideshow.images.length]; i++; };
      show();
      setInterval(show, b.slideshow.intervalMs || 6000);
    } else if (b.type === 'gradient') {
      color.style.background = `linear-gradient(135deg, ${b.gradient?.from || '#0b0c10'}, ${b.gradient?.to || '#1a1230'})`;
      color.classList.remove('hidden');
    } else if (['particles', 'stars', 'snow', 'rain', 'grid', 'noise'].includes(b.type)) {
      particles.classList.remove('hidden');
      startBackgroundParticles(particles, b.type, b.animationSpeed || 1);
    } else {
      color.style.background = b.color || '#000';
      color.classList.remove('hidden');
    }

    const filterParts = [];
    if (b.blur) filterParts.push(`blur(${b.blur}px)`);
    if (b.brightness != null) filterParts.push(`brightness(${b.brightness}%)`);
    if (b.contrast != null) filterParts.push(`contrast(${b.contrast}%)`);
    if (b.saturation != null) filterParts.push(`saturate(${b.saturation}%)`);
    $('#bg-layer').style.filter = filterParts.join(' ');
    $('#bg-layer').style.opacity = b.opacity != null ? b.opacity : 1;
    overlay.style.background = b.overlay?.color || '#000';
    overlay.style.opacity = b.overlay?.opacity != null ? b.overlay.opacity : 0;
  }

  function startBackgroundParticles(canvas, type, speed) {
    const myGen = renderGen;
    const ctx = canvas.getContext('2d');
    function resize() { canvas.width = window.innerWidth; canvas.height = window.innerHeight; }
    resize(); window.addEventListener('resize', resize);
    const count = type === 'grid' ? 0 : 120;
    const dots = Array.from({ length: count }, () => ({
      x: Math.random() * canvas.width,
      y: Math.random() * canvas.height,
      r: type === 'stars' ? Math.random() * 1.4 + 0.3 : Math.random() * 2 + 1,
      vy: (type === 'snow' ? 0.4 + Math.random() * 0.6 : type === 'rain' ? 4 + Math.random() * 5 : 0.1 + Math.random() * 0.2) * speed,
      vx: type === 'rain' ? -1.2 * speed : (Math.random() - 0.5) * 0.3 * speed,
      tw: Math.random() * Math.PI * 2,
    }));
    function draw() {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      if (type === 'grid') {
        ctx.strokeStyle = 'rgba(255,255,255,0.08)';
        const gap = 40;
        for (let x = 0; x < canvas.width; x += gap) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, canvas.height); ctx.stroke(); }
        for (let y = 0; y < canvas.height; y += gap) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(canvas.width, y); ctx.stroke(); }
      } else if (type === 'noise') {
        const imgData = ctx.createImageData(canvas.width, canvas.height);
        for (let i = 0; i < imgData.data.length; i += 4) {
          const v = Math.random() * 40;
          imgData.data[i] = imgData.data[i + 1] = imgData.data[i + 2] = v;
          imgData.data[i + 3] = 18;
        }
        ctx.putImageData(imgData, 0, 0);
      } else {
        ctx.fillStyle = type === 'rain' ? 'rgba(180,200,255,0.5)' : 'rgba(255,255,255,0.85)';
        for (const d of dots) {
          d.y += d.vy; d.x += d.vx; d.tw += 0.02;
          if (d.y > canvas.height) { d.y = -5; d.x = Math.random() * canvas.width; }
          if (d.x < -5) d.x = canvas.width + 5;
          const alpha = type === 'stars' ? (Math.sin(d.tw) + 1) / 2 : 1;
          ctx.globalAlpha = alpha;
          if (type === 'rain') {
            ctx.beginPath(); ctx.moveTo(d.x, d.y); ctx.lineTo(d.x - d.vx * 2, d.y - d.vy * 2); ctx.strokeStyle = ctx.fillStyle; ctx.stroke();
          } else {
            ctx.beginPath(); ctx.arc(d.x, d.y, d.r, 0, Math.PI * 2); ctx.fill();
          }
        }
        ctx.globalAlpha = 1;
      }
      if (myGen === renderGen) requestAnimationFrame(draw);
    }
    draw();
  }

  // ---------------- click to enter ----------------
  function applyEnterScreen() {
    const c = CFG.clickToEnter || {};
    const screen = $('#enter-screen');
    if (!c.enabled) { screen.classList.add('hidden'); revealProfile(); return; }

    screen.style.setProperty('--primary', CFG.theme?.primaryColor || '#8B5CF6');
    $('#enter-text').style.font = `${c.fontSize || 24}px ${c.font || "'Space Mono', monospace"}`;
    $('#enter-text').style.color = c.textColor || '#fff';
    if (c.glow) screen.classList.add('glow');

    const bgWrap = $('#enter-bg');
    bgWrap.innerHTML = '';
    if (c.background?.type === 'image' && c.background.imageUrl) {
      const img = document.createElement('img'); img.src = c.background.imageUrl; bgWrap.appendChild(img);
    } else if (c.background?.type === 'video' && c.background.videoUrl) {
      const vid = document.createElement('video'); vid.src = c.background.videoUrl; vid.autoplay = true; vid.loop = true; vid.muted = true; vid.playsInline = true; bgWrap.appendChild(vid);
    } else {
      bgWrap.style.background = c.background?.color || '#000';
    }
    screen.style.backdropFilter = c.blur ? `blur(${c.blur}px)` : '';
    $('#enter-overlay').style.background = c.overlay?.color || '#000';
    $('#enter-overlay').style.opacity = c.overlay?.opacity != null ? c.overlay.opacity : 0.5;

    if (c.particles?.enabled) {
      const canvas = $('#enter-particles');
      startBackgroundParticles(canvas, c.particles.style || 'stars', 1);
    }

    // typewriter start message
    const phrases = c.phrases?.length ? c.phrases : ['click to enter'];
    const phrase = phrases[Math.floor(Math.random() * phrases.length)];
    let i = 0, cursorOn = true, text = '';
    function type() {
      if (i < phrase.length) { text = phrase.slice(0, i + 1); i++; }
      $('#enter-text').textContent = text + (cursorOn ? '|' : ' ');
      setTimeout(type, c.typingSpeedMs || 90);
    }
    trackedInterval(() => { cursorOn = !cursorOn; $('#enter-text').textContent = text + (cursorOn ? '|' : ' '); }, 500);
    type();

    if (c.button?.show) {
      const btn = $('#enter-button');
      btn.textContent = c.button.text || 'Enter';
      btn.classList.remove('hidden');
    }

    const enter = () => {
      const style = c.transition?.style || 'fade';
      screen.classList.add(`exit-${style}`);
      setTimeout(() => { screen.classList.add('hidden'); revealProfile(); }, c.transition?.durationMs || 700);
    };
    screen.addEventListener('click', enter, { once: true });
    screen.addEventListener('touchstart', (e) => { e.preventDefault(); enter(); }, { once: true, passive: false });
  }

  function revealProfile() {
    const block = $('#profile-block');
    block.classList.remove('hidden');
    requestAnimationFrame(() => {
      block.classList.add('entered');
      if (window.gsap) {
        gsap.fromTo(block, { y: -40, opacity: 0 }, { y: 0, opacity: 1, duration: 0.9, ease: 'power2.out' });
      }
      $('#profile-container').classList.add(CFG.avatar?.animation === 'orbit' ? 'orbit' : '');
    });
    startTypewriters();
    if (CFG.music?.enabled && CFG.music.autoplayAfterEnter) playMusic();
  }

  // ---------------- avatar ----------------
  function applyAvatar() {
    const a = CFG.avatar || {};
    const img = $('#profile-picture');
    img.dataset.editable = 'avatar';
    $('#profile-container').dataset.editable = 'avatar';
    img.src = a.url || '/assets/profile.gif';
    img.style.width = (a.size || 150) + 'px';
    img.style.height = (a.size || 150) + 'px';
    img.style.borderRadius = (a.radius != null ? a.radius : 50) + '%';
    img.style.border = a.border?.width ? `${a.border.width}px solid ${a.border.color || '#fff'}` : 'none';
    img.classList.toggle('has-glow', !!a.glow);
    img.classList.toggle('has-shadow', !!a.shadow);
    const deco = $('#avatar-decoration');
    if (a.decorationUrl) { deco.src = a.decorationUrl; deco.classList.remove('hidden'); } else { deco.classList.add('hidden'); }

    img.addEventListener('click', () => {
      const c = $('#profile-container');
      c.classList.remove('orbit'); c.classList.remove('fast-orbit'); void c.offsetWidth;
      c.classList.add('fast-orbit');
      setTimeout(() => { c.classList.remove('fast-orbit'); c.classList.add('orbit'); }, 520);
    });
  }

  // ---------------- typewriters (username + bio) ----------------
  let usernameTimer = null, bioTimer = null;
  function applyUsername() {
    const u = CFG.username || {};
    const el = $('#profile-name');
    el.dataset.editable = 'username';
    el.style.fontFamily = u.font || "'Orbitron', sans-serif";
    el.style.fontSize = (u.size || 32) + 'px';
    el.style.fontWeight = u.weight || 700;
    el.style.letterSpacing = (u.letterSpacing || 0) + 'px';
    el.style.color = u.color || '#fff';
    el.classList.toggle('has-glow', !!u.glow);
    if (u.gradient) {
      el.style.background = `linear-gradient(90deg, ${CFG.theme?.primaryColor || '#8B5CF6'}, ${CFG.theme?.secondaryColor || '#EC4899'})`;
      el.style.webkitBackgroundClip = 'text'; el.style.backgroundClip = 'text'; el.style.color = 'transparent';
    }
    if (!u.typewriter) el.textContent = (u.phrases && u.phrases[0]) || 'user';
  }

  function applyBio() {
    const b = CFG.bio || {};
    const el = $('#profile-bio');
    el.dataset.editable = 'bio';
    el.style.fontFamily = b.font || "'Courier New', monospace";
    el.style.fontSize = (b.size || 18) + 'px';
    el.style.color = b.color || 'rgba(255,255,255,0.8)';
    el.style.textAlign = b.align || 'left';
    if (!b.typewriter) el.textContent = (b.phrases && b.phrases[0]) || '';
  }

  function startTypewriters() {
    const u = CFG.username || {}, b = CFG.bio || {};
    if (u.typewriter && u.phrases?.length) startCycler($('#profile-name'), u.phrases, u.typingSpeedMs || 70, u.deleteSpeedMs || 50, u.pauseMs || 2000);
    if (b.typewriter && b.phrases?.length) startCycler($('#profile-bio'), b.phrases, b.typingSpeedMs || 60, b.deleteSpeedMs || 20, b.pauseMs || 2000);
  }

  function startCycler(el, phrases, typeMs, delMs, pauseMs) {
    let idx = Math.floor(Math.random() * phrases.length);
    let text = '', pos = 0, deleting = false, cursorOn = true;
    function tick() {
      const target = phrases[idx];
      if (!deleting && pos < target.length) { pos++; text = target.slice(0, pos); }
      else if (deleting && pos > 0) { pos--; text = target.slice(0, pos); }
      else if (!deleting && pos === target.length) { deleting = true; setTimeout(tick, pauseMs); return; }
      else if (deleting && pos === 0) { deleting = false; idx = (idx + 1) % phrases.length; }
      el.textContent = text + (cursorOn ? '|' : ' ');
      setTimeout(tick, deleting ? delMs : typeMs);
    }
    trackedInterval(() => { cursorOn = !cursorOn; el.textContent = text + (cursorOn ? '|' : ' '); }, 500);
    tick();
  }

  // ---------------- badges ----------------
  function applyBadges() {
    const group = $('#badge-group');
    group.dataset.editable = 'badges';
    group.innerHTML = '';
    const badges = [...(CFG.badges || [])].sort((a, b) => (a.order || 0) - (b.order || 0));
    badges.forEach((b) => {
      const wrap = document.createElement('div');
      wrap.className = `badge-item anim-${b.animation || 'none'}`;
      wrap.style.color = b.color || '#fff';
      const img = document.createElement('img');
      img.src = b.icon; img.alt = b.name || '';
      img.style.width = (b.size || 22) + 'px'; img.style.height = (b.size || 22) + 'px';
      if (b.glow) img.style.filter = `drop-shadow(0 0 6px ${b.color || '#fff'})`;
      if (b.shadow) img.style.boxShadow = '0 2px 6px rgba(0,0,0,0.5)';
      wrap.appendChild(img);
      if (b.tooltip || b.name) {
        const tip = document.createElement('span'); tip.className = 'tooltip'; tip.textContent = b.tooltip || b.name;
        wrap.appendChild(tip);
      }
      group.appendChild(wrap);
    });
  }

  // ---------------- socials ----------------
  function applySocials() {
    const wrap = $('#social-links');
    wrap.dataset.editable = 'socials';
    wrap.innerHTML = '';
    const socials = [...(CFG.socials || [])].sort((a, b) => (a.order || 0) - (b.order || 0));
    socials.forEach((s) => {
      const a = document.createElement('a');
      a.href = s.url || '#'; a.target = '_blank'; a.rel = 'noopener noreferrer';
      a.className = 'social-icon-link';
      a.style.width = (s.size || 36) + 'px'; a.style.height = (s.size || 36) + 'px';
      const img = document.createElement('img');
      img.src = s.icon || iconFallback(s.platform);
      img.alt = s.name || s.platform;
      img.style.filter = s.glow ? `drop-shadow(0 0 8px ${s.color || '#fff'})` : '';
      a.appendChild(img);
      wrap.appendChild(a);
    });
  }
  function iconFallback() { return '/assets/imghost.gif'; }

  // ---------------- gallery ----------------
  function applyGallery() {
    const g = CFG.gallery || {};
    const block = $('#gallery-block');
    block.dataset.editable = 'gallery';
    if (!g.enabled || !g.items?.length) { block.classList.add('hidden'); return; }
    block.classList.remove('hidden');
    block.className = `gallery-block layout-${g.layout || 'grid'}`;
    block.innerHTML = '';
    g.items.forEach((item) => {
      const cell = document.createElement('div'); cell.className = 'gallery-item';
      if (item.type === 'video') {
        const v = document.createElement('video'); v.src = item.url; v.controls = true; v.muted = true; cell.appendChild(v);
      } else {
        const img = document.createElement('img'); img.src = item.url; img.alt = item.caption || ''; cell.appendChild(img);
      }
      block.appendChild(cell);
    });
  }

  // ---------------- visitor counter ----------------
  function applyVisitorCounter() {
    const w = (CFG.widgets || []).find((x) => x.type === 'visitorCounter');
    const el = $('#visitor-counter');
    if (w?.hidden) { el.classList.add('hidden'); return; }
    const start = w?.config?.startAt || 100000;
    let count = parseInt(localStorage.getItem('adb_visits') || '0', 10);
    if (!count) { count = start + Math.floor(Math.random() * 5000); }
    count += 1;
    localStorage.setItem('adb_visits', String(count));
    $('#visitor-count').textContent = count.toLocaleString();
  }

  // ---------------- skills panel ----------------
  function applySkills() {
    const s = CFG.skillsPanel || {};
    const btnWrap = $('#results-button-container');
    if (!s.enabled) { btnWrap.classList.add('hidden'); return; }
    btnWrap.classList.remove('hidden');
    $('#results-theme').textContent = s.buttonText || 'Skills';
    const block = $('#skills-block');
    block.innerHTML = `<h2 class="skills-title">${escapeHtml(s.title || 'Skills')}</h2>`;
    (s.skills || []).forEach((sk) => {
      const row = document.createElement('div'); row.className = 'skill-row';
      row.innerHTML = `
        <div class="skill-name"><img src="${sk.icon || ''}" alt=""><span>${escapeHtml(sk.name)}</span><span>${sk.percent}%</span></div>
        <div class="skill-bar-container"><div class="skill-bar"></div></div>`;
      block.appendChild(row);
    });

    let showing = false;
    $('#results-theme').addEventListener('click', () => {
      const profileBlock = $('#profile-block');
      if (!showing) {
        profileBlock.classList.add('hidden');
        block.classList.remove('hidden');
        requestAnimationFrame(() => {
          block.querySelectorAll('.skill-bar').forEach((bar, i) => {
            setTimeout(() => { bar.style.width = (s.skills[i]?.percent || 0) + '%'; }, 60);
          });
        });
        $('#results-hint').classList.remove('hidden');
      } else {
        block.classList.add('hidden');
        profileBlock.classList.remove('hidden');
        block.querySelectorAll('.skill-bar').forEach((bar) => (bar.style.width = '0%'));
        $('#results-hint').classList.add('hidden');
      }
      showing = !showing;
    });
  }

  // ---------------- cursor ----------------
  function applyCursor() {
    const c = CFG.cursor || {};
    if (c.type === 'default') return;
    document.body.classList.add('cursor-hidden');
    const cur = $('#custom-cursor');
    cur.classList.remove('hidden');
    cur.classList.add(`style-${c.type}`);
    if (c.type === 'image' && c.imageUrl) {
      cur.style.backgroundImage = `url(${c.imageUrl})`;
      cur.style.width = '28px'; cur.style.height = '28px';
    } else {
      cur.style.background = c.type === 'circle' ? 'transparent' : (c.color || 'var(--primary)');
      cur.style.borderColor = c.color || 'var(--primary)';
    }
    let tx = 0, ty = 0, mx = 0, my = 0;
    const cursorGen = renderGen;
    window.addEventListener('mousemove', (e) => { mx = e.clientX; my = e.clientY; });
    (function loop() {
      tx += (mx - tx) * 0.25; ty += (my - ty) * 0.25;
      cur.style.transform = `translate(${tx}px, ${ty}px) translate(-50%,-50%)`;
      if (cursorGen === renderGen) requestAnimationFrame(loop);
    })();
    if (c.clickEffect) {
      window.addEventListener('mousedown', () => cur.classList.add('clicked'));
      window.addEventListener('mouseup', () => cur.classList.remove('clicked'));
    }
    if (c.trail) {
      const canvas = $('#cursor-trail-canvas'); canvas.classList.remove('hidden');
      const ctx = canvas.getContext('2d');
      function resize() { canvas.width = innerWidth; canvas.height = innerHeight; }
      resize(); window.addEventListener('resize', resize);
      const dots = [];
      const trailGen = renderGen;
      window.addEventListener('mousemove', (e) => dots.push({ x: e.clientX, y: e.clientY, life: 1 }));
      (function draw() {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        for (let i = dots.length - 1; i >= 0; i--) {
          const d = dots[i]; d.life -= 0.04;
          if (d.life <= 0) { dots.splice(i, 1); continue; }
          ctx.globalAlpha = d.life;
          ctx.fillStyle = c.color || 'var(--primary)';
          ctx.beginPath(); ctx.arc(d.x, d.y, 4 * d.life, 0, Math.PI * 2); ctx.fill();
        }
        ctx.globalAlpha = 1;
        if (trailGen === renderGen) requestAnimationFrame(draw);
      })();
    }
  }

  // ---------------- custom css ----------------
  function applyCustomCss() {
    const css = CFG.advanced?.customCss || '';
    let tag = document.getElementById('custom-css-tag');
    if (!tag) { tag = document.createElement('style'); tag.id = 'custom-css-tag'; document.head.appendChild(tag); }
    tag.textContent = css;
  }

  // ---------------- music ----------------
  function setupMusic() {
    const m = CFG.music || {};
    const audio = $('#audio-player');
    audio.loop = false;
    audio.volume = m.volume != null ? m.volume : 0.3;
    const playlist = m.playlist || [];
    let order = playlist.map((_, i) => i);
    if (m.shuffle) order = shuffle(order);
    let cursor = 0;

    function loadTrack(i) {
      const t = playlist[order[i % order.length]];
      if (!t) return;
      audio.src = t.url;
      $('#music-mini-art').src = t.artworkUrl || '/assets/profile.gif';
      $('#music-mini-title').textContent = `${t.title} — ${t.artist}`;
    }
    function next() { cursor = (cursor + 1) % order.length; loadTrack(cursor); if (!audio.paused || playing) audio.play().catch(() => {}); }
    audio.addEventListener('ended', () => { if (m.loop || cursor < order.length - 1) next(); });

    let playing = false;
    window.playMusicFromUI = () => togglePlay();
    if (playlist.length) loadTrack(0);

    $('#music-toggle').addEventListener('click', togglePlay);
    $('#volume-slider').value = audio.volume;
    $('#volume-slider').addEventListener('input', (e) => { audio.volume = parseFloat(e.target.value); });

    function togglePlay() {
      if (!playlist.length) return;
      if (audio.paused) { playMusic(); } else { audio.pause(); playing = false; $('#music-toggle').textContent = '▶'; }
    }

    window.__playMusic = function () {
      if (!playlist.length || !m.enabled) return;
      audio.play().then(() => {
        playing = true; $('#music-toggle').textContent = '⏸';
        setupVisualizer(audio);
      }).catch(() => {});
    };
  }
  function playMusic() { if (window.__playMusic) window.__playMusic(); }

  function setupVisualizer(audio) {
    const m = CFG.music || {};
    if (!m.visualizer?.enabled) return;
    if (!audioCtx) {
      try {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        sourceNode = audioCtx.createMediaElementSource(audio);
        analyser = audioCtx.createAnalyser();
        analyser.fftSize = 64;
        sourceNode.connect(analyser);
        analyser.connect(audioCtx.destination);
      } catch (e) { return; }
    }
    if (audioCtx.state === 'suspended') audioCtx.resume();
    const canvas = $('#music-viz'), ctx = canvas.getContext('2d');
    const data = new Uint8Array(analyser.frequencyBinCount);
    const vizGen = renderGen;
    (function draw() {
      if (vizGen !== renderGen) return;
      requestAnimationFrame(draw);
      analyser.getByteFrequencyData(data);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const barW = canvas.width / 12;
      for (let i = 0; i < 12; i++) {
        const v = data[i] / 255;
        ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--primary') || '#8B5CF6';
        ctx.fillRect(i * barW, canvas.height - v * canvas.height, barW - 2, v * canvas.height);
      }
    })();
  }

  function shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1));[a[i], a[j]] = [a[j], a[i]]; }
    return a;
  }

  // ---------------- tilt on hover ----------------
  function setupTilt() {
    if (!CFG.animations?.tiltOnHover || !window.gsap) return;
    [$('#profile-block'), $('#skills-block')].forEach((el) => {
      el.addEventListener('mousemove', (e) => {
        const r = el.getBoundingClientRect();
        const rx = ((e.clientY - r.top - r.height / 2) / r.height) * 10;
        const ry = -((e.clientX - r.left - r.width / 2) / r.width) * 10;
        gsap.to(el, { rotationX: rx, rotationY: ry, duration: 0.3, ease: 'power2.out', transformPerspective: 1000 });
      });
      el.addEventListener('mouseleave', () => gsap.to(el, { rotationX: 0, rotationY: 0, duration: 0.5 }));
    });
  }

  function escapeHtml(str) {
    return String(str || '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  document.addEventListener('DOMContentLoaded', loadProfile);
})();
