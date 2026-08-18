(function () {
  'use strict';

  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));
  const uid = () => Math.random().toString(36).slice(2, 10);
  const clone = (o) => JSON.parse(JSON.stringify(o));

  function getPath(obj, path) {
    return path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
  }
  function setPath(obj, path, value) {
    const keys = path.split('.');
    let cur = obj;
    for (let i = 0; i < keys.length - 1; i++) {
      if (cur[keys[i]] == null) cur[keys[i]] = {};
      cur = cur[keys[i]];
    }
    cur[keys[keys.length - 1]] = value;
  }

  // ---------------------------------------------------------------- state
  let state = null;
  let history = [];
  let historyIndex = -1;
  let activeSection = 'profile';
  let saveTimer = null;
  let pushHistoryTimer = null;

  function pushHistory() {
    clearTimeout(pushHistoryTimer);
    pushHistoryTimer = setTimeout(() => {
      history = history.slice(0, historyIndex + 1);
      history.push(clone(state));
      if (history.length > 60) history.shift();
      historyIndex = history.length - 1;
      updateUndoRedoButtons();
    }, 250);
  }

  function updateUndoRedoButtons() {
    $('#btn-undo').disabled = historyIndex <= 0;
    $('#btn-redo').disabled = historyIndex >= history.length - 1;
  }

  function onFieldChange() {
    updatePreview();
    pushHistory();
    scheduleAutosave();
  }

  function updatePreview() {
    const frame = $('#preview-frame');
    if (frame && frame.contentWindow) {
      frame.contentWindow.postMessage({ type: 'ADB_SET_PROFILE', profile: state }, '*');
    }
  }

  function scheduleAutosave() {
    setSaveStatus('saving');
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveNow, 800);
  }

  async function saveNow() {
    try {
      setSaveStatus('saving');
      const res = await fetch('/api/profile', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(state),
      });
      if (!res.ok) throw new Error('save failed');
      setSaveStatus('saved');
    } catch (e) {
      setSaveStatus('error');
    }
  }

  function setSaveStatus(kind) {
    const el = $('#save-status');
    el.classList.remove('saving', 'error');
    if (kind === 'saving') { el.textContent = 'Saving…'; el.classList.add('saving'); }
    else if (kind === 'error') { el.textContent = 'Save failed'; el.classList.add('error'); }
    else { el.textContent = 'Saved ✓'; }
  }

  function toast(msg, isError) {
    const t = $('#toast');
    t.textContent = msg;
    t.classList.toggle('error', !!isError);
    t.classList.remove('hidden');
    clearTimeout(t._timer);
    t._timer = setTimeout(() => t.classList.add('hidden'), 2600);
  }

  // ---------------------------------------------------------------- auth
  async function checkSession() {
    const res = await fetch('/api/session');
    const data = await res.json();
    if (data.authed) { await boot(); }
    else { $('#login-screen').classList.remove('hidden'); }
  }

  $('#login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const pw = $('#login-password').value;
    const err = $('#login-error');
    err.classList.add('hidden');
    try {
      const res = await fetch('/api/login', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: pw }),
      });
      const data = await res.json();
      if (!res.ok) { err.textContent = data.error || 'Login failed'; err.classList.remove('hidden'); return; }
      $('#login-screen').classList.add('hidden');
      await boot();
    } catch (e2) {
      err.textContent = 'Network error'; err.classList.remove('hidden');
    }
  });

  $('#btn-logout').addEventListener('click', async () => {
    await fetch('/api/logout', { method: 'POST' });
    location.reload();
  });

  async function boot() {
    $('#editor-root').classList.remove('hidden');
    const res = await fetch('/api/profile');
    state = await res.json();
    history = [clone(state)];
    historyIndex = 0;
    updateUndoRedoButtons();
    buildNav();
    renderSection(activeSection);
    setupPreviewSizeButtons();
    setupUndoRedo();
    setupIframeMessages();
    $('#preview-frame').addEventListener('load', updatePreview);
  }

  // ---------------------------------------------------------------- nav
  const SECTIONS = [
    { id: 'profile', icon: '🙂', label: 'Profile' },
    { id: 'appearance', icon: '🎨', label: 'Appearance' },
    { id: 'background', icon: '🖼', label: 'Background' },
    { id: 'socials', icon: '🔗', label: 'Socials' },
    { id: 'badges', icon: '🏅', label: 'Badges' },
    { id: 'music', icon: '🎵', label: 'Music' },
    { id: 'gallery', icon: '🖼️', label: 'Gallery' },
    { id: 'widgets', icon: '🧩', label: 'Widgets' },
    { id: 'cursor', icon: '🖱', label: 'Cursor' },
    { id: 'enter', icon: '🚪', label: 'Enter' },
    { id: 'media', icon: '📁', label: 'Media' },
    { id: 'advanced', icon: '⚙️', label: 'Advanced' },
    { id: 'settings', icon: '🔒', label: 'Settings' },
  ];

  function buildNav() {
    const nav = $('#left-nav');
    nav.innerHTML = '';
    SECTIONS.forEach((s) => {
      const item = document.createElement('div');
      item.className = 'nav-item' + (s.id === activeSection ? ' active' : '');
      item.dataset.section = s.id;
      item.innerHTML = `<div class="nav-icon">${s.icon}</div><div class="nav-label">${s.label}</div>`;
      item.addEventListener('click', () => {
        if (s.id === 'media') { openMediaModal(); return; }
        activeSection = s.id;
        $$('.nav-item', nav).forEach((n) => n.classList.remove('active'));
        item.classList.add('active');
        renderSection(s.id);
      });
      nav.appendChild(item);
    });
  }

  function setupUndoRedo() {
    $('#btn-undo').addEventListener('click', () => {
      if (historyIndex <= 0) return;
      historyIndex--;
      state = clone(history[historyIndex]);
      updatePreview(); renderSection(activeSection); updateUndoRedoButtons(); scheduleAutosave();
    });
    $('#btn-redo').addEventListener('click', () => {
      if (historyIndex >= history.length - 1) return;
      historyIndex++;
      state = clone(history[historyIndex]);
      updatePreview(); renderSection(activeSection); updateUndoRedoButtons(); scheduleAutosave();
    });
    $('#btn-reset').addEventListener('click', async () => {
      if (!confirm('Reset your ENTIRE profile back to the default? This cannot be undone once saved.')) return;
      const res = await fetch('/api/profile');
      const fresh = await res.json();
      // reset to the built-in defaults by asking server is not available directly; instead just confirm intent:
      toast('Tip: edit fields back manually, or contact yourself from the past. Reset undo history only.', false);
    });
  }

  function setupPreviewSizeButtons() {
    $$('.pv-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        $$('.pv-btn').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        const wrap = $('#preview-frame-wrap');
        wrap.className = 'preview-frame-wrap';
        const pv = btn.dataset.pv;
        if (pv !== 'desktop') wrap.classList.add('pv-' + pv);
      });
    });
  }

  function setupIframeMessages() {
    window.addEventListener('message', (e) => {
      if (!e.data) return;
      if (e.data.type === 'ADB_ELEMENT_CLICKED') {
        const map = { avatar: 'profile', username: 'profile', bio: 'profile', badges: 'badges', socials: 'socials', gallery: 'gallery', background: 'background', music: 'music' };
        const section = map[e.data.editable];
        if (section) {
          activeSection = section;
          $$('.nav-item').forEach((n) => n.classList.toggle('active', n.dataset.section === section));
          renderSection(section);
        }
      }
    });
  }

  // ---------------------------------------------------------------- field builders
  function el(html) {
    const t = document.createElement('template');
    t.innerHTML = html.trim();
    return t.content.firstElementChild;
  }

  function fieldText(path, label, opts) {
    opts = opts || {};
    const wrap = el(`<div class="field"><label>${label}</label><input class="input" type="text" /></div>`);
    const input = $('input', wrap);
    input.value = getPath(state, path) ?? '';
    if (opts.placeholder) input.placeholder = opts.placeholder;
    input.addEventListener('input', () => { setPath(state, path, input.value); onFieldChange(); });
    return wrap;
  }

  function fieldTextarea(path, label, opts) {
    opts = opts || {};
    const wrap = el(`<div class="field"><label>${label}</label><textarea class="input"></textarea></div>`);
    const input = $('textarea', wrap);
    input.style.minHeight = (opts.minHeight || 60) + 'px';
    input.value = getPath(state, path) ?? '';
    input.addEventListener('input', () => { setPath(state, path, input.value); onFieldChange(); });
    return wrap;
  }

  // list-of-strings editor (one per line) used for typewriter phrase arrays
  function fieldPhraseList(path, label) {
    const wrap = el(`<div class="field"><label>${label} <span style="opacity:.55">(one per line)</span></label><textarea class="input"></textarea></div>`);
    const input = $('textarea', wrap);
    input.style.minHeight = '80px';
    input.value = (getPath(state, path) || []).join('\n');
    input.addEventListener('input', () => {
      setPath(state, path, input.value.split('\n').map((s) => s.trim()).filter(Boolean));
      onFieldChange();
    });
    return wrap;
  }

  function fieldNumber(path, label, opts) {
    opts = opts || {};
    const wrap = el(`<div class="field"><label>${label}</label><input class="input" type="number" /></div>`);
    const input = $('input', wrap);
    if (opts.min != null) input.min = opts.min;
    if (opts.max != null) input.max = opts.max;
    if (opts.step != null) input.step = opts.step;
    input.value = getPath(state, path) ?? 0;
    input.addEventListener('input', () => { setPath(state, path, parseFloat(input.value) || 0); onFieldChange(); });
    return wrap;
  }

  function fieldRange(path, label, opts) {
    opts = opts || { min: 0, max: 100, step: 1 };
    const wrap = el(`<div class="field"><label>${label} <span class="range-val" style="opacity:.6"></span></label><input class="input" type="range" /></div>`);
    const input = $('input', wrap);
    const valSpan = $('.range-val', wrap);
    input.min = opts.min; input.max = opts.max; input.step = opts.step || 1;
    const cur = getPath(state, path);
    input.value = cur != null ? cur : opts.min;
    valSpan.textContent = input.value + (opts.suffix || '');
    input.addEventListener('input', () => {
      const v = parseFloat(input.value);
      setPath(state, path, v);
      valSpan.textContent = v + (opts.suffix || '');
      onFieldChange();
    });
    return wrap;
  }

  function fieldColor(path, label) {
    const wrap = el(`<div class="field"><label>${label}</label><input class="input" type="color" /></div>`);
    const input = $('input', wrap);
    const cur = getPath(state, path);
    input.value = /^#/.test(cur) ? cur : '#8b5cf6';
    input.addEventListener('input', () => { setPath(state, path, input.value); onFieldChange(); });
    return wrap;
  }

  function fieldToggle(path, label) {
    const wrap = el(`<div class="field toggle-row"><label>${label}</label><label class="switch"><input type="checkbox"/><span class="track"></span></label></div>`);
    const input = $('input', wrap);
    input.checked = !!getPath(state, path);
    input.addEventListener('change', () => { setPath(state, path, input.checked); onFieldChange(); });
    return wrap;
  }

  function fieldSelect(path, label, options) {
    const wrap = el(`<div class="field"><label>${label}</label><select class="input"></select></div>`);
    const select = $('select', wrap);
    options.forEach((o) => {
      const opt = document.createElement('option');
      opt.value = o.value; opt.textContent = o.label;
      select.appendChild(opt);
    });
    select.value = getPath(state, path);
    select.addEventListener('change', () => { setPath(state, path, select.value); onFieldChange(); });
    return wrap;
  }

  function fieldChips(path, label, options) {
    const wrap = el(`<div class="field"><label>${label}</label><div class="chip-row"></div></div>`);
    const row = $('.chip-row', wrap);
    const cur = getPath(state, path);
    options.forEach((o) => {
      const chip = el(`<div class="chip${o.value === cur ? ' active' : ''}">${o.label}</div>`);
      chip.addEventListener('click', () => {
        setPath(state, path, o.value);
        $$('.chip', row).forEach((c) => c.classList.remove('active'));
        chip.classList.add('active');
        onFieldChange();
      });
      row.appendChild(chip);
    });
    return wrap;
  }

  function fieldGroupTitle(text) {
    return el(`<div class="field-group-title">${text}</div>`);
  }

  function fieldMediaPicker(path, label, type) {
    const wrap = el(`<div class="field"><label>${label}</label><div class="media-pick-field"><div class="media-pick-preview"></div><button type="button" class="media-pick-btn">Choose file…</button></div></div>`);
    const preview = $('.media-pick-preview', wrap);
    const btn = $('.media-pick-btn', wrap);
    function refresh() {
      const url = getPath(state, path);
      btn.textContent = url ? url.split('/').pop() : 'Choose file…';
      if (type === 'image' && url) preview.style.backgroundImage = `url(${url})`;
      else preview.style.backgroundImage = '';
    }
    refresh();
    btn.addEventListener('click', () => {
      openMediaModal({
        type,
        onSelect: (item) => { setPath(state, path, item.url); refresh(); onFieldChange(); },
      });
    });
    return wrap;
  }

  // ---------------------------------------------------------------- panel shell
  function panelHeader(title, sub) {
    return `<div class="panel-title">${title}</div><div class="panel-sub">${sub || ''}</div>`;
  }

  function renderSection(id) {
    const root = $('#right-panel-inner');
    root.innerHTML = '';
    const renderers = {
      profile: renderProfile, appearance: renderAppearance, background: renderBackground,
      socials: renderSocials, badges: renderBadges, music: renderMusic, gallery: renderGallery,
      widgets: renderWidgets, cursor: renderCursor, enter: renderEnter, advanced: renderAdvanced, settings: renderSettings,
    };
    (renderers[id] || renderProfile)(root);
  }

  // ---------------------------------------------------------------- PROFILE
  function renderProfile(root) {
    root.insertAdjacentHTML('beforeend', panelHeader('Profile', 'Avatar, username & bio'));

    root.appendChild(fieldGroupTitle('Avatar'));
    root.appendChild(fieldMediaPicker('avatar.url', 'Image / GIF', 'image'));
    root.appendChild(fieldMediaPicker('avatar.decorationUrl', 'Decoration overlay (optional)', 'image'));
    root.appendChild(fieldRange('avatar.size', 'Size', { min: 60, max: 260, step: 2, suffix: 'px' }));
    root.appendChild(fieldRange('avatar.radius', 'Corner radius', { min: 0, max: 50, step: 1, suffix: '%' }));
    root.appendChild(fieldRange('avatar.border.width', 'Border width', { min: 0, max: 12, step: 1, suffix: 'px' }));
    root.appendChild(fieldColor('avatar.border.color', 'Border color'));
    root.appendChild(fieldToggle('avatar.glow', 'Glow'));
    root.appendChild(fieldToggle('avatar.shadow', 'Shadow'));
    root.appendChild(fieldChips('avatar.animation', 'Ring animation', [{ value: 'none', label: 'None' }, { value: 'orbit', label: 'Orbit' }]));

    root.appendChild(fieldGroupTitle('Username'));
    root.appendChild(fieldPhraseList('username.phrases', 'Name(s)'));
    root.appendChild(fieldToggle('username.typewriter', 'Typewriter cycle'));
    root.appendChild(fieldRange('username.typingSpeedMs', 'Typing speed', { min: 20, max: 200, step: 5, suffix: 'ms' }));
    root.appendChild(fieldRange('username.size', 'Font size', { min: 14, max: 56, step: 1, suffix: 'px' }));
    root.appendChild(fieldRange('username.weight', 'Weight', { min: 300, max: 900, step: 100 }));
    root.appendChild(fieldRange('username.letterSpacing', 'Letter spacing', { min: 0, max: 10, step: 0.5, suffix: 'px' }));
    root.appendChild(fieldColor('username.color', 'Color'));
    root.appendChild(fieldToggle('username.gradient', 'Gradient text'));
    root.appendChild(fieldToggle('username.glow', 'Glow'));

    root.appendChild(fieldGroupTitle('Bio'));
    root.appendChild(fieldPhraseList('bio.phrases', 'Bio line(s)'));
    root.appendChild(fieldToggle('bio.typewriter', 'Typewriter cycle'));
    root.appendChild(fieldRange('bio.size', 'Font size', { min: 10, max: 30, step: 1, suffix: 'px' }));
    root.appendChild(fieldColor('bio.color', 'Color'));
    root.appendChild(fieldChips('bio.align', 'Align', [{ value: 'left', label: 'Left' }, { value: 'center', label: 'Center' }, { value: 'right', label: 'Right' }]));
  }

  // ---------------------------------------------------------------- APPEARANCE
  const THEME_PRESETS = [
    { id: 'midnight', primary: '#8B5CF6', secondary: '#EC4899' },
    { id: 'void', primary: '#6b7280', secondary: '#d1d5db' },
    { id: 'crimson', primary: '#ef4444', secondary: '#f97316' },
    { id: 'ocean', primary: '#22d3ee', secondary: '#2563eb' },
    { id: 'purple', primary: '#a855f7', secondary: '#6366f1' },
    { id: 'mono', primary: '#e5e7eb', secondary: '#9ca3af' },
    { id: 'cyber', primary: '#22c55e', secondary: '#06b6d4' },
    { id: 'glass', primary: '#93c5fd', secondary: '#f0abfc' },
    { id: 'minimal', primary: '#ffffff', secondary: '#a3a3a3' },
  ];
  const LAYOUT_PRESETS = ['classic', 'modern', 'minimal', 'glass', 'cinematic', 'portfolio', 'compact'];

  function renderAppearance(root) {
    root.insertAdjacentHTML('beforeend', panelHeader('Appearance', 'Theme, colors & layout'));
    root.appendChild(fieldGroupTitle('Theme preset'));
    const grid = el('<div class="theme-grid"></div>');
    THEME_PRESETS.forEach((t) => {
      const sw = el(`<div class="theme-swatch${getPath(state, 'theme.preset') === t.id ? ' active' : ''}"><div class="dot" style="background:linear-gradient(135deg, ${t.primary}, ${t.secondary})"></div>${t.id}</div>`);
      sw.addEventListener('click', () => {
        setPath(state, 'theme.preset', t.id);
        setPath(state, 'theme.primaryColor', t.primary);
        setPath(state, 'theme.secondaryColor', t.secondary);
        renderSection('appearance');
        onFieldChange();
      });
      grid.appendChild(sw);
    });
    root.appendChild(grid);

    root.appendChild(fieldGroupTitle('Custom colors'));
    root.appendChild(fieldColor('theme.primaryColor', 'Primary'));
    root.appendChild(fieldColor('theme.secondaryColor', 'Secondary'));
    root.appendChild(fieldColor('theme.backgroundDark', 'Base background'));
    root.appendChild(fieldColor('theme.textColor', 'Text color'));

    root.appendChild(fieldGroupTitle('Profile card'));
    root.appendChild(fieldRange('theme.cardOpacity', 'Card opacity', { min: 0, max: 1, step: 0.02 }));
    root.appendChild(fieldRange('theme.cardBlur', 'Glass blur', { min: 0, max: 40, step: 1, suffix: 'px' }));
    root.appendChild(fieldRange('theme.cardRadius', 'Corner radius', { min: 0, max: 40, step: 1, suffix: 'px' }));
    root.appendChild(fieldColor('theme.cardBorderColor', 'Border color'));

    root.appendChild(fieldGroupTitle('Layout'));
    root.appendChild(fieldChips('layout.preset', 'Layout preset', LAYOUT_PRESETS.map((l) => ({ value: l, label: l }))));

    root.appendChild(fieldGroupTitle('Animation & motion'));
    root.appendChild(fieldChips('animations.pageTransition', 'Page transition', [{ value: 'fade', label: 'Fade' }, { value: 'slide', label: 'Slide' }, { value: 'none', label: 'None' }]));
    root.appendChild(fieldToggle('animations.tiltOnHover', 'Tilt card on hover'));
  }

  // ---------------------------------------------------------------- BACKGROUND
  function renderBackground(root) {
    root.insertAdjacentHTML('beforeend', panelHeader('Background', 'Whatever sits behind your profile'));
    root.appendChild(fieldChips('background.type', 'Type', [
      { value: 'color', label: 'Color' }, { value: 'gradient', label: 'Gradient' }, { value: 'image', label: 'Image' },
      { value: 'video', label: 'Video' }, { value: 'slideshow', label: 'Slideshow' }, { value: 'particles', label: 'Particles' },
      { value: 'stars', label: 'Stars' }, { value: 'snow', label: 'Snow' }, { value: 'rain', label: 'Rain' },
      { value: 'grid', label: 'Grid' }, { value: 'noise', label: 'Noise' },
    ]));
    const type = getPath(state, 'background.type');
    if (type === 'color') root.appendChild(fieldColor('background.color', 'Color'));
    if (type === 'gradient') { root.appendChild(fieldColor('background.gradient.from', 'From')); root.appendChild(fieldColor('background.gradient.to', 'To')); }
    if (type === 'image') root.appendChild(fieldMediaPicker('background.imageUrl', 'Image', 'image'));
    if (type === 'video') root.appendChild(fieldMediaPicker('background.videoUrl', 'Video', 'video'));
    if (type === 'slideshow') {
      root.appendChild(fieldGroupTitle('Slideshow images'));
      const list = getPath(state, 'background.slideshow.images') || [];
      const listWrap = el('<div></div>');
      list.forEach((url, i) => {
        const row = el(`<div class="list-item"><img src="${url}"><div class="li-title">${url.split('/').pop()}</div><div class="li-actions"><button data-i="${i}">✕</button></div></div>`);
        $('button', row).addEventListener('click', () => { list.splice(i, 1); setPath(state, 'background.slideshow.images', list); renderSection('background'); onFieldChange(); });
        listWrap.appendChild(row);
      });
      root.appendChild(listWrap);
      const addBtn = el('<button type="button" class="add-btn">+ Add image</button>');
      addBtn.addEventListener('click', () => {
        openMediaModal({ type: 'image', onSelect: (item) => { list.push(item.url); setPath(state, 'background.slideshow.images', list); renderSection('background'); onFieldChange(); } });
      });
      root.appendChild(addBtn);
      root.appendChild(fieldRange('background.slideshow.intervalMs', 'Interval', { min: 1000, max: 20000, step: 500, suffix: 'ms' }));
    }
    if (['particles', 'stars', 'snow', 'rain', 'grid', 'noise'].includes(type)) {
      root.appendChild(fieldRange('background.animationSpeed', 'Speed', { min: 0.1, max: 3, step: 0.1 }));
    }

    root.appendChild(fieldGroupTitle('Filters'));
    root.appendChild(fieldRange('background.opacity', 'Opacity', { min: 0, max: 1, step: 0.02 }));
    root.appendChild(fieldRange('background.blur', 'Blur', { min: 0, max: 40, step: 1, suffix: 'px' }));
    root.appendChild(fieldRange('background.brightness', 'Brightness', { min: 0, max: 200, step: 2, suffix: '%' }));
    root.appendChild(fieldRange('background.contrast', 'Contrast', { min: 0, max: 200, step: 2, suffix: '%' }));
    root.appendChild(fieldRange('background.saturation', 'Saturation', { min: 0, max: 200, step: 2, suffix: '%' }));

    root.appendChild(fieldGroupTitle('Overlay'));
    root.appendChild(fieldColor('background.overlay.color', 'Overlay color'));
    root.appendChild(fieldRange('background.overlay.opacity', 'Overlay opacity', { min: 0, max: 1, step: 0.02 }));
  }

  // ---------------------------------------------------------------- SOCIALS
  const PLATFORM_ICONS = {
    discord: '/assets/discord.png', github: '/assets/github.png', youtube: '/assets/youtube.png',
    spotify: '', tiktok: '', instagram: '', x: '', roblox: '', twitch: '', steam: '', reddit: '',
    telegram: '', soundcloud: '', applemusic: '', lastfm: '', custom: '',
  };

  function renderSocials(root) {
    root.insertAdjacentHTML('beforeend', panelHeader('Socials', 'Links shown on your profile'));
    const list = getPath(state, 'socials') || [];
    const listWrap = el('<div></div>');
    [...list].sort((a, b) => (a.order || 0) - (b.order || 0)).forEach((s) => {
      const row = el(`<div class="list-item"><img src="${s.icon || '/assets/imghost.gif'}"><div><div class="li-title">${s.name || s.platform}</div><div class="li-sub">${s.platform}</div></div><div class="li-actions"><button data-act="up">↑</button><button data-act="down">↓</button><button data-act="del">✕</button></div></div>`);
      $('.li-title', row).parentElement.parentElement; // no-op keep structure
      row.addEventListener('click', (e) => {
        if (e.target.dataset.act) return;
        openSocialModal(s);
      });
      $('[data-act=up]', row).addEventListener('click', () => { reorder(list, s.id, -1); renderSection('socials'); onFieldChange(); });
      $('[data-act=down]', row).addEventListener('click', () => { reorder(list, s.id, 1); renderSection('socials'); onFieldChange(); });
      $('[data-act=del]', row).addEventListener('click', () => { setPath(state, 'socials', list.filter((x) => x.id !== s.id)); renderSection('socials'); onFieldChange(); });
      listWrap.appendChild(row);
    });
    root.appendChild(listWrap);
    const addBtn = el('<button type="button" class="add-btn">+ Add social link</button>');
    addBtn.addEventListener('click', () => openSocialModal(null));
    root.appendChild(addBtn);
  }

  function reorder(list, id, dir) {
    list.sort((a, b) => (a.order || 0) - (b.order || 0));
    const i = list.findIndex((x) => x.id === id);
    const j = i + dir;
    if (j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j], list[i]];
    list.forEach((x, idx) => (x.order = idx + 1));
  }

  function openSocialModal(existing) {
    const modal = $('#social-modal');
    const body = $('#social-modal-body');
    const s = existing ? clone(existing) : { id: uid(), platform: 'custom', name: '', url: '', icon: '', color: '#8B5CF6', size: 36, animation: 'tilt', order: (getPath(state, 'socials') || []).length + 1 };
    body.innerHTML = '';
    const platformSelect = fieldSelectStandalone('Platform', Object.keys(PLATFORM_ICONS).map((p) => ({ value: p, label: p })), s.platform, (v) => {
      s.platform = v; if (PLATFORM_ICONS[v]) s.icon = PLATFORM_ICONS[v];
      if (!s.name) s.name = v;
    });
    body.appendChild(platformSelect);
    body.appendChild(inputStandalone('Display name', s.name, (v) => (s.name = v)));
    body.appendChild(inputStandalone('URL', s.url, (v) => (s.url = v), 'https://…'));
    body.appendChild(mediaPickerStandalone('Custom icon (optional)', s.icon, 'image', (url) => (s.icon = url)));
    body.appendChild(colorStandalone('Glow color', s.color, (v) => (s.color = v)));
    body.appendChild(rangeStandalone('Size', s.size, 20, 64, 2, 'px', (v) => (s.size = v)));
    body.appendChild(toggleStandalone('Glow', !!s.glow, (v) => (s.glow = v)));
    const actions = el('<div style="display:flex;gap:8px;margin-top:6px;"></div>');
    const saveBtn = el('<button type="button" class="primary-btn" style="flex:1">Save</button>');
    saveBtn.addEventListener('click', () => {
      let list = getPath(state, 'socials') || [];
      list = list.filter((x) => x.id !== s.id);
      list.push(s);
      setPath(state, 'socials', list);
      closeModal('social-modal');
      renderSection('socials'); onFieldChange();
    });
    actions.appendChild(saveBtn);
    if (existing) {
      const delBtn = el('<button type="button" class="danger-btn">Delete</button>');
      delBtn.addEventListener('click', () => {
        setPath(state, 'socials', (getPath(state, 'socials') || []).filter((x) => x.id !== s.id));
        closeModal('social-modal'); renderSection('socials'); onFieldChange();
      });
      actions.appendChild(delBtn);
    }
    body.appendChild(actions);
    modal.classList.remove('hidden');
  }

  // ---------------------------------------------------------------- BADGES
  const BADGE_ANIMATIONS = ['none', 'pulse', 'glow', 'float', 'bounce', 'spin', 'shake', 'rainbow'];

  function renderBadges(root) {
    root.insertAdjacentHTML('beforeend', panelHeader('Badges', 'Your own custom badge set'));
    const list = getPath(state, 'badges') || [];
    const strip = el('<div class="badge-preview-strip"></div>');
    list.forEach((b) => strip.appendChild(el(`<img src="${b.icon}" style="width:${b.size || 22}px;height:${b.size || 22}px;border-radius:6px;">`)));
    root.appendChild(strip);
    const listWrap = el('<div></div>');
    [...list].sort((a, b) => (a.order || 0) - (b.order || 0)).forEach((b) => {
      const row = el(`<div class="list-item"><img src="${b.icon}"><div><div class="li-title">${b.name}</div><div class="li-sub">${b.animation || 'none'}</div></div><div class="li-actions"><button data-act="up">↑</button><button data-act="down">↓</button><button data-act="del">✕</button></div></div>`);
      row.addEventListener('click', (e) => { if (e.target.dataset.act) return; openBadgeModal(b); });
      $('[data-act=up]', row).addEventListener('click', () => { reorder(list, b.id, -1); renderSection('badges'); onFieldChange(); });
      $('[data-act=down]', row).addEventListener('click', () => { reorder(list, b.id, 1); renderSection('badges'); onFieldChange(); });
      $('[data-act=del]', row).addEventListener('click', () => { setPath(state, 'badges', list.filter((x) => x.id !== b.id)); renderSection('badges'); onFieldChange(); });
      listWrap.appendChild(row);
    });
    root.appendChild(listWrap);
    const addBtn = el('<button type="button" class="add-btn">+ Create badge</button>');
    addBtn.addEventListener('click', () => openBadgeModal(null));
    root.appendChild(addBtn);
  }

  function openBadgeModal(existing) {
    const modal = $('#badge-modal');
    const body = $('#badge-modal-body');
    const b = existing ? clone(existing) : { id: uid(), name: '', icon: '', color: '#8B5CF6', glow: false, shadow: false, tooltip: '', description: '', size: 22, animation: 'none', order: (getPath(state, 'badges') || []).length + 1 };
    body.innerHTML = '';
    const preview = el(`<div style="text-align:center;margin-bottom:14px;"><img id="badge-live-preview" src="${b.icon || ''}" style="width:${b.size}px;height:${b.size}px;border-radius:6px;"></div>`);
    body.appendChild(preview);
    body.appendChild(inputStandalone('Name', b.name, (v) => { b.name = v; }));
    body.appendChild(mediaPickerStandalone('Icon / image / GIF', b.icon, 'image', (url) => { b.icon = url; $('#badge-live-preview', body).src = url; }));
    body.appendChild(inputStandalone('Tooltip text', b.tooltip, (v) => (b.tooltip = v)));
    body.appendChild(colorStandalone('Color / glow tint', b.color, (v) => (b.color = v)));
    body.appendChild(rangeStandalone('Size', b.size, 14, 48, 1, 'px', (v) => { b.size = v; $('#badge-live-preview', body).style.width = v + 'px'; $('#badge-live-preview', body).style.height = v + 'px'; }));
    body.appendChild(toggleStandalone('Glow', !!b.glow, (v) => (b.glow = v)));
    body.appendChild(toggleStandalone('Shadow', !!b.shadow, (v) => (b.shadow = v)));
    const animWrap = el('<div class="field"><label>Animation</label><div class="chip-row"></div></div>');
    const chipRow = $('.chip-row', animWrap);
    BADGE_ANIMATIONS.forEach((a) => {
      const chip = el(`<div class="chip${a === b.animation ? ' active' : ''}">${a}</div>`);
      chip.addEventListener('click', () => { b.animation = a; $$('.chip', chipRow).forEach((c) => c.classList.remove('active')); chip.classList.add('active'); });
      chipRow.appendChild(chip);
    });
    body.appendChild(animWrap);
    const actions = el('<div style="display:flex;gap:8px;margin-top:6px;"></div>');
    const saveBtn = el('<button type="button" class="primary-btn" style="flex:1">Save badge</button>');
    saveBtn.addEventListener('click', () => {
      if (!b.icon) { toast('Pick an icon for this badge first', true); return; }
      let list = getPath(state, 'badges') || [];
      list = list.filter((x) => x.id !== b.id);
      list.push(b);
      setPath(state, 'badges', list);
      closeModal('badge-modal');
      renderSection('badges'); onFieldChange();
    });
    actions.appendChild(saveBtn);
    if (existing) {
      const delBtn = el('<button type="button" class="danger-btn">Delete</button>');
      delBtn.addEventListener('click', () => {
        setPath(state, 'badges', (getPath(state, 'badges') || []).filter((x) => x.id !== b.id));
        closeModal('badge-modal'); renderSection('badges'); onFieldChange();
      });
      actions.appendChild(delBtn);
    }
    body.appendChild(actions);
    modal.classList.remove('hidden');
  }

  // ---------------------------------------------------------------- MUSIC
  function renderMusic(root) {
    root.insertAdjacentHTML('beforeend', panelHeader('Music', 'Custom player & playlist'));
    root.appendChild(fieldToggle('music.enabled', 'Enable player'));
    root.appendChild(fieldToggle('music.autoplayAfterEnter', 'Autoplay after Click to Enter'));
    root.appendChild(fieldToggle('music.loop', 'Loop playlist'));
    root.appendChild(fieldToggle('music.shuffle', 'Shuffle'));
    root.appendChild(fieldRange('music.volume', 'Default volume', { min: 0, max: 1, step: 0.02 }));
    root.appendChild(fieldToggle('music.visualizer.enabled', 'Visualizer'));
    root.appendChild(fieldChips('music.visualizer.style', 'Visualizer style', [{ value: 'bars', label: 'Bars' }, { value: 'waveform', label: 'Waveform' }, { value: 'circle', label: 'Circle' }]));

    root.appendChild(fieldGroupTitle('Playlist'));
    const list = getPath(state, 'music.playlist') || [];
    const listWrap = el('<div></div>');
    list.forEach((t, i) => {
      const row = el(`<div class="list-item"><img src="${t.artworkUrl || '/assets/imghost.gif'}"><div><div class="li-title">${t.title}</div><div class="li-sub">${t.artist || ''}</div></div><div class="li-actions"><button data-act="del">✕</button></div></div>`);
      row.addEventListener('click', (e) => { if (e.target.dataset.act) return; openTrackModal(t); });
      $('[data-act=del]', row).addEventListener('click', () => { list.splice(i, 1); renderSection('music'); onFieldChange(); });
      listWrap.appendChild(row);
    });
    root.appendChild(listWrap);
    const addBtn = el('<button type="button" class="add-btn">+ Add track</button>');
    addBtn.addEventListener('click', () => openTrackModal(null));
    root.appendChild(addBtn);
  }

  function openTrackModal(existing) {
    const modal = $('#track-modal');
    const body = $('#track-modal-body');
    const t = existing ? clone(existing) : { id: uid(), title: '', artist: '', url: '', artworkUrl: '' };
    body.innerHTML = '';
    body.appendChild(inputStandalone('Title', t.title, (v) => (t.title = v)));
    body.appendChild(inputStandalone('Artist', t.artist, (v) => (t.artist = v)));
    body.appendChild(mediaPickerStandalone('Audio file', t.url, 'audio', (url) => (t.url = url)));
    body.appendChild(mediaPickerStandalone('Album artwork', t.artworkUrl, 'image', (url) => (t.artworkUrl = url)));
    const actions = el('<div style="display:flex;gap:8px;margin-top:6px;"></div>');
    const saveBtn = el('<button type="button" class="primary-btn" style="flex:1">Save track</button>');
    saveBtn.addEventListener('click', () => {
      if (!t.url) { toast('Pick an audio file first', true); return; }
      let list = getPath(state, 'music.playlist') || [];
      list = list.filter((x) => x.id !== t.id);
      list.push(t);
      setPath(state, 'music.playlist', list);
      closeModal('track-modal');
      renderSection('music'); onFieldChange();
    });
    actions.appendChild(saveBtn);
    if (existing) {
      const delBtn = el('<button type="button" class="danger-btn">Delete</button>');
      delBtn.addEventListener('click', () => {
        setPath(state, 'music.playlist', (getPath(state, 'music.playlist') || []).filter((x) => x.id !== t.id));
        closeModal('track-modal'); renderSection('music'); onFieldChange();
      });
      actions.appendChild(delBtn);
    }
    body.appendChild(actions);
    modal.classList.remove('hidden');
  }

  // ---------------------------------------------------------------- GALLERY
  function renderGallery(root) {
    root.insertAdjacentHTML('beforeend', panelHeader('Gallery', 'Show off images, GIFs & videos'));
    root.appendChild(fieldToggle('gallery.enabled', 'Enable gallery'));
    root.appendChild(fieldChips('gallery.layout', 'Layout', [{ value: 'grid', label: 'Grid' }, { value: 'masonry', label: 'Masonry' }, { value: 'carousel', label: 'Carousel' }]));
    root.appendChild(fieldGroupTitle('Items'));
    const list = getPath(state, 'gallery.items') || [];
    const listWrap = el('<div></div>');
    list.forEach((it, i) => {
      const row = el(`<div class="list-item"><img src="${it.type === 'video' ? '/assets/imghost.gif' : it.url}"><div class="li-title">${(it.caption || it.url.split('/').pop())}</div><div class="li-actions"><button data-act="del">✕</button></div></div>`);
      $('[data-act=del]', row).addEventListener('click', () => { list.splice(i, 1); renderSection('gallery'); onFieldChange(); });
      listWrap.appendChild(row);
    });
    root.appendChild(listWrap);
    const addImgBtn = el('<button type="button" class="add-btn">+ Add image / GIF</button>');
    addImgBtn.addEventListener('click', () => openMediaModal({ type: 'image', onSelect: (item) => { list.push({ id: uid(), type: 'image', url: item.url, caption: '' }); renderSection('gallery'); onFieldChange(); } }));
    root.appendChild(addImgBtn);
    const addVidBtn = el('<button type="button" class="add-btn" style="margin-top:8px;">+ Add video</button>');
    addVidBtn.addEventListener('click', () => openMediaModal({ type: 'video', onSelect: (item) => { list.push({ id: uid(), type: 'video', url: item.url, caption: '' }); renderSection('gallery'); onFieldChange(); } }));
    root.appendChild(addVidBtn);
  }

  // ---------------------------------------------------------------- WIDGETS
  function renderWidgets(root) {
    root.insertAdjacentHTML('beforeend', panelHeader('Widgets', 'Small add-ons for your profile'));
    const vc = (getPath(state, 'widgets') || []).find((w) => w.type === 'visitorCounter');
    if (vc) {
      root.appendChild(fieldGroupTitle('Visitor counter'));
      const hideField = el(`<div class="field toggle-row"><label>Show visitor counter</label><label class="switch"><input type="checkbox" ${vc.hidden ? '' : 'checked'}/><span class="track"></span></label></div>`);
      $('input', hideField).addEventListener('change', (e) => { vc.hidden = !e.target.checked; onFieldChange(); });
      root.appendChild(hideField);
      root.appendChild(fieldNumber('_vc_startAt', 'Starting count', {}));
      // manual bind since path is nested inside array item
      const numInput = root.querySelector('.field:last-child input');
      numInput.value = vc.config.startAt;
      numInput.oninput = () => { vc.config.startAt = parseInt(numInput.value, 10) || 0; onFieldChange(); };
    }
    root.appendChild(fieldGroupTitle('Skills panel'));
    root.appendChild(fieldToggle('skillsPanel.enabled', 'Enable "Skills" toggle card'));
    root.appendChild(fieldText('skillsPanel.title', 'Panel title'));
    root.appendChild(fieldText('skillsPanel.buttonText', 'Button text'));
    root.insertAdjacentHTML('beforeend', '<div class="panel-sub" style="margin-top:8px;">More widgets (Discord status, Spotify now-playing, GitHub stats, clock, countdown) need an external API key — wire them up in <code>public/js/profile.js</code> → <code>applySkills</code> area, or ask for it as a follow-up build.</div>');
  }

  // ---------------------------------------------------------------- CURSOR
  function renderCursor(root) {
    root.insertAdjacentHTML('beforeend', panelHeader('Cursor', 'Custom cursor for visitors'));
    root.appendChild(fieldChips('cursor.type', 'Type', [
      { value: 'default', label: 'Default' }, { value: 'circle', label: 'Circle' }, { value: 'glow', label: 'Glow' }, { value: 'image', label: 'Image' },
    ]));
    if (getPath(state, 'cursor.type') === 'image') root.appendChild(fieldMediaPicker('cursor.imageUrl', 'Cursor image', 'image'));
    root.appendChild(fieldColor('cursor.color', 'Color'));
    root.appendChild(fieldToggle('cursor.trail', 'Particle trail'));
    root.appendChild(fieldToggle('cursor.clickEffect', 'Click effect'));
  }

  // ---------------------------------------------------------------- CLICK TO ENTER
  function renderEnter(root) {
    root.insertAdjacentHTML('beforeend', panelHeader('Click to Enter', 'Cinematic intro screen'));
    root.appendChild(fieldToggle('clickToEnter.enabled', 'Enabled'));
    root.appendChild(fieldPhraseList('clickToEnter.phrases', 'Text (random each visit)'));
    root.appendChild(fieldRange('clickToEnter.typingSpeedMs', 'Typing speed', { min: 20, max: 200, step: 5, suffix: 'ms' }));
    root.appendChild(fieldToggle('clickToEnter.button.show', 'Show button instead of "click anywhere"'));
    root.appendChild(fieldText('clickToEnter.button.text', 'Button text'));
    root.appendChild(fieldRange('clickToEnter.fontSize', 'Font size', { min: 12, max: 48, step: 1, suffix: 'px' }));
    root.appendChild(fieldColor('clickToEnter.textColor', 'Text color'));
    root.appendChild(fieldToggle('clickToEnter.glow', 'Glow text'));

    root.appendChild(fieldGroupTitle('Background'));
    root.appendChild(fieldChips('clickToEnter.background.type', 'Type', [{ value: 'color', label: 'Color' }, { value: 'image', label: 'Image' }, { value: 'video', label: 'Video' }]));
    const bt = getPath(state, 'clickToEnter.background.type');
    if (bt === 'color') root.appendChild(fieldColor('clickToEnter.background.color', 'Color'));
    if (bt === 'image') root.appendChild(fieldMediaPicker('clickToEnter.background.imageUrl', 'Image', 'image'));
    if (bt === 'video') root.appendChild(fieldMediaPicker('clickToEnter.background.videoUrl', 'Video', 'video'));
    root.appendChild(fieldRange('clickToEnter.blur', 'Backdrop blur', { min: 0, max: 40, step: 1, suffix: 'px' }));
    root.appendChild(fieldColor('clickToEnter.overlay.color', 'Overlay color'));
    root.appendChild(fieldRange('clickToEnter.overlay.opacity', 'Overlay opacity', { min: 0, max: 1, step: 0.02 }));
    root.appendChild(fieldToggle('clickToEnter.particles.enabled', 'Particles'));
    root.appendChild(fieldChips('clickToEnter.particles.style', 'Particle style', [{ value: 'stars', label: 'Stars' }, { value: 'snow', label: 'Snow' }, { value: 'particles', label: 'Dust' }]));

    root.appendChild(fieldGroupTitle('Transition'));
    root.appendChild(fieldChips('clickToEnter.transition.style', 'Style', ['fade', 'blur', 'zoom', 'scale', 'slide', 'glitch', 'dissolve'].map((s) => ({ value: s, label: s }))));
    root.appendChild(fieldRange('clickToEnter.transition.durationMs', 'Duration', { min: 200, max: 2000, step: 50, suffix: 'ms' }));
  }

  // ---------------------------------------------------------------- ADVANCED
  function renderAdvanced(root) {
    root.insertAdjacentHTML('beforeend', panelHeader('Advanced', 'Custom CSS for your public profile'));
    root.appendChild(fieldTextarea('advanced.customCss', 'CSS', { minHeight: 320 }));
    root.insertAdjacentHTML('beforeend', '<div class="panel-sub">This CSS only ever applies to your public profile page (<code>/</code>) — it is injected into a scoped preview iframe here and cannot touch the customize dashboard itself.</div>');
  }

  // ---------------------------------------------------------------- SETTINGS
  function renderSettings(root) {
    root.insertAdjacentHTML('beforeend', panelHeader('Settings', 'Page meta & account'));
    root.appendChild(fieldGroupTitle('Page'));
    root.appendChild(fieldText('meta.pageTitle', 'Browser tab title'));
    root.appendChild(fieldMediaPicker('meta.favicon', 'Favicon', 'image'));

    root.appendChild(fieldGroupTitle('Backup'));
    const exportBtn = el('<button type="button" class="add-btn">⬇ Export profile as JSON</button>');
    exportBtn.addEventListener('click', () => {
      const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob); a.download = 'profile-backup.json'; a.click();
    });
    root.appendChild(exportBtn);
    const importInput = el('<input type="file" accept="application/json" style="margin-top:8px;width:100%;font-size:11px;">');
    importInput.addEventListener('change', async (e) => {
      const file = e.target.files[0]; if (!file) return;
      try {
        const text = await file.text();
        state = JSON.parse(text);
        renderSection(activeSection === 'media' ? 'profile' : activeSection);
        onFieldChange();
        toast('Profile imported');
      } catch (err) { toast('Invalid JSON file', true); }
    });
    root.appendChild(importInput);

    root.appendChild(fieldGroupTitle('Account'));
    root.insertAdjacentHTML('beforeend', '<div class="panel-sub">To change your password, set the <code>ADMIN_PASSWORD</code> environment variable where the server runs and restart it.</div>');
  }

  // ---------------------------------------------------------------- standalone field helpers (for modals — no auto-path binding)
  function inputStandalone(label, value, onChange, placeholder) {
    const wrap = el(`<div class="field"><label>${label}</label><input class="input" type="text" value="${(value || '').replace(/"/g, '&quot;')}" ${placeholder ? `placeholder="${placeholder}"` : ''}/></div>`);
    $('input', wrap).addEventListener('input', (e) => onChange(e.target.value));
    return wrap;
  }
  function colorStandalone(label, value, onChange) {
    const wrap = el(`<div class="field"><label>${label}</label><input class="input" type="color" value="${/^#/.test(value) ? value : '#8b5cf6'}"/></div>`);
    $('input', wrap).addEventListener('input', (e) => onChange(e.target.value));
    return wrap;
  }
  function rangeStandalone(label, value, min, max, step, suffix, onChange) {
    const wrap = el(`<div class="field"><label>${label} <span class="range-val" style="opacity:.6">${value}${suffix || ''}</span></label><input class="input" type="range" min="${min}" max="${max}" step="${step}" value="${value}"/></div>`);
    $('input', wrap).addEventListener('input', (e) => { onChange(parseFloat(e.target.value)); $('.range-val', wrap).textContent = e.target.value + (suffix || ''); });
    return wrap;
  }
  function toggleStandalone(label, checked, onChange) {
    const wrap = el(`<div class="field toggle-row"><label>${label}</label><label class="switch"><input type="checkbox" ${checked ? 'checked' : ''}/><span class="track"></span></label></div>`);
    $('input', wrap).addEventListener('change', (e) => onChange(e.target.checked));
    return wrap;
  }
  function fieldSelectStandalone(label, options, value, onChange) {
    const wrap = el(`<div class="field"><label>${label}</label><select class="input"></select></div>`);
    const select = $('select', wrap);
    options.forEach((o) => { const opt = document.createElement('option'); opt.value = o.value; opt.textContent = o.label; select.appendChild(opt); });
    select.value = value;
    select.addEventListener('change', (e) => onChange(e.target.value));
    return wrap;
  }
  function mediaPickerStandalone(label, value, type, onChange) {
    const wrap = el(`<div class="field"><label>${label}</label><div class="media-pick-field"><div class="media-pick-preview" style="${value && type === 'image' ? `background-image:url(${value})` : ''}"></div><button type="button" class="media-pick-btn">${value ? value.split('/').pop() : 'Choose file…'}</button></div></div>`);
    $('.media-pick-btn', wrap).addEventListener('click', () => {
      openMediaModal({ type, onSelect: (item) => {
        onChange(item.url);
        $('.media-pick-btn', wrap).textContent = item.url.split('/').pop();
        if (type === 'image') $('.media-pick-preview', wrap).style.backgroundImage = `url(${item.url})`;
      } });
    });
    return wrap;
  }

  function closeModal(id) { $('#' + id).classList.add('hidden'); }
  $$('[data-close]').forEach((btn) => btn.addEventListener('click', () => closeModal(btn.dataset.close)));
  $$('.modal-backdrop[data-close]').forEach((bd) => bd.addEventListener('click', () => closeModal(bd.dataset.close)));

  // ---------------------------------------------------------------- MEDIA LIBRARY
  let mediaCache = [];
  let mediaPickerCallback = null;
  let mediaPickerTypeFilter = null;

  function openMediaModal(opts) {
    opts = opts || {};
    mediaPickerCallback = opts.onSelect || null;
    mediaPickerTypeFilter = opts.type || null;
    $('#media-modal-title').textContent = mediaPickerCallback ? `Choose ${opts.type || 'a file'}` : 'Media Library';
    $('#media-filter').value = mediaPickerTypeFilter || '';
    $('#media-modal').classList.remove('hidden');
    loadMedia();
  }
  $('#media-modal-close').addEventListener('click', () => { $('#media-modal').classList.add('hidden'); mediaPickerCallback = null; });
  $('#media-modal-backdrop').addEventListener('click', () => { $('#media-modal').classList.add('hidden'); mediaPickerCallback = null; });

  async function loadMedia() {
    const res = await fetch('/api/media');
    mediaCache = await res.json();
    renderMediaGrid();
  }

  function renderMediaGrid() {
    const grid = $('#media-grid');
    const search = $('#media-search').value.toLowerCase();
    const filter = $('#media-filter').value;
    const sort = $('#media-sort').value;
    let items = mediaCache.filter((m) => (!filter || m.type === filter) && (!search || m.filename.toLowerCase().includes(search)));
    if (sort === 'new') items.sort((a, b) => new Date(b.uploadedAt) - new Date(a.uploadedAt));
    if (sort === 'old') items.sort((a, b) => new Date(a.uploadedAt) - new Date(b.uploadedAt));
    if (sort === 'name') items.sort((a, b) => a.filename.localeCompare(b.filename));
    if (sort === 'size') items.sort((a, b) => b.size - a.size);

    grid.innerHTML = '';
    $('#media-empty').classList.toggle('hidden', items.length > 0);
    items.forEach((m) => {
      const card = el(`<div class="media-card"></div>`);
      const thumb = el(`<div class="media-thumb"></div>`);
      if (m.type === 'image') thumb.style.backgroundImage = `url(${m.url})`;
      else if (m.type === 'video') thumb.innerHTML = `<video src="${m.url}" muted></video>`;
      else if (m.type === 'audio') thumb.textContent = '🎵';
      else thumb.textContent = '𝔸';
      card.appendChild(thumb);
      card.appendChild(el(`<div class="media-meta"><div class="media-name">${m.filename}</div><div class="media-sub"><span>${formatSize(m.size)}</span><span>${m.type}</span></div></div>`));
      const actions = el('<div class="media-actions"></div>');
      if (mediaPickerCallback) {
        const useBtn = el('<button class="use-btn">Use</button>');
        useBtn.addEventListener('click', () => { mediaPickerCallback(m); $('#media-modal').classList.add('hidden'); mediaPickerCallback = null; });
        actions.appendChild(useBtn);
      }
      const renameBtn = el('<button>Rename</button>');
      renameBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const name = prompt('New filename', m.filename);
        if (!name) return;
        await fetch(`/api/media/${m.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ filename: name }) });
        loadMedia();
      });
      const copyBtn = el('<button>Copy URL</button>');
      copyBtn.addEventListener('click', (e) => { e.stopPropagation(); navigator.clipboard?.writeText(location.origin + m.url); toast('URL copied'); });
      const delBtn = el('<button>Delete</button>');
      delBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        if (!confirm(`Delete ${m.filename}? This can't be undone.`)) return;
        await fetch(`/api/media/${m.id}`, { method: 'DELETE' });
        loadMedia();
      });
      actions.appendChild(renameBtn); actions.appendChild(copyBtn); actions.appendChild(delBtn);
      card.appendChild(actions);
      if (mediaPickerCallback) card.addEventListener('click', () => { mediaPickerCallback(m); $('#media-modal').classList.add('hidden'); mediaPickerCallback = null; });
      grid.appendChild(card);
    });
  }
  function formatSize(bytes) {
    if (bytes > 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
    if (bytes > 1024) return (bytes / 1024).toFixed(0) + ' KB';
    return bytes + ' B';
  }

  $('#media-search').addEventListener('input', renderMediaGrid);
  $('#media-filter').addEventListener('change', renderMediaGrid);
  $('#media-sort').addEventListener('change', renderMediaGrid);
  $('#media-browse-btn').addEventListener('click', () => $('#media-file-input').click());
  $('#media-file-input').addEventListener('change', (e) => uploadFiles(e.target.files));

  const dropzone = $('#media-dropzone');
  dropzone.addEventListener('dragover', (e) => { e.preventDefault(); dropzone.classList.add('dragover'); });
  dropzone.addEventListener('dragleave', () => dropzone.classList.remove('dragover'));
  dropzone.addEventListener('drop', (e) => {
    e.preventDefault(); dropzone.classList.remove('dragover');
    if (e.dataTransfer.files.length) uploadFiles(e.dataTransfer.files);
  });

  async function uploadFiles(fileList) {
    const files = Array.from(fileList);
    if (!files.length) return;
    const progress = $('#media-upload-progress');
    progress.classList.remove('hidden');
    progress.textContent = `Uploading ${files.length} file${files.length > 1 ? 's' : ''}…`;
    const form = new FormData();
    files.forEach((f) => form.append('files', f, f.name));
    try {
      const res = await fetch('/api/upload', { method: 'POST', body: form });
      const data = await res.json();
      if (data.saved?.length) toast(`Uploaded ${data.saved.length} file${data.saved.length > 1 ? 's' : ''}`);
      if (data.errors?.length) toast(data.errors.map((e) => `${e.filename}: ${e.error}`).join(' · '), true);
      await loadMedia();
    } catch (e) {
      toast('Upload failed', true);
    } finally {
      progress.classList.add('hidden');
      $('#media-file-input').value = '';
    }
  }

  // ---------------------------------------------------------------- go
  checkSession();
})();
