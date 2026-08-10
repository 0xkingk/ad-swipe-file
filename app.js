/* ============================================================
   Lightbox — ad swipe file
   Storage model: the GitHub repo itself is the database.
     /images/*             raw pinned files
     /data/manifest.json   {items:[{id,type,path,src,caption,tags,source,addedBy,addedAt}]}
   Config (owner/repo/branch/token/name) lives only in this
   browser's localStorage — never committed anywhere.
   ============================================================ */

const LS_KEY = 'lightbox_swipefile_config_v1';
const MANIFEST_PATH = 'data/manifest.json';

let cfg = null;
let manifestSha = null;
let items = [];
let activeTag = null;
let searchTerm = '';

/* ---------------- element refs ---------------- */
const el = (id) => document.getElementById(id);
const grid = el('grid');
const emptyState = el('emptyState');
const loadingState = el('loadingState');
const tagRail = el('tagRail');
const toastEl = el('toast');
const dropOverlay = el('dropOverlay');

/* ---------------- config ---------------- */
function loadConfig() {
  try { return JSON.parse(localStorage.getItem(LS_KEY)); } catch { return null; }
}
function saveConfig(c) { localStorage.setItem(LS_KEY, JSON.stringify(c)); }

function openModal(id) { el(id).hidden = false; }
function closeModal(id) { el(id).hidden = true; }
document.querySelectorAll('[data-close]').forEach(n => {
  n.addEventListener('click', (e) => {
    const panel = e.target.closest('.modal');
    if (panel) panel.hidden = true;
  });
});

function showToast(msg, ms = 2600) {
  toastEl.textContent = msg;
  toastEl.hidden = false;
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => { toastEl.hidden = true; }, ms);
}

/* ---------------- GitHub API helpers ---------------- */
function apiUrl(path) {
  return `https://api.github.com/repos/${cfg.owner}/${cfg.repo}/contents/${path}`;
}
async function ghGet(path) {
  const res = await fetch(`${apiUrl(path)}?ref=${encodeURIComponent(cfg.branch)}&t=${Date.now()}`, {
    headers: { Authorization: `token ${cfg.token}`, Accept: 'application/vnd.github+json' }
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`GitHub GET ${path} failed: ${res.status}`);
  return res.json();
}
async function ghPut(path, { contentBase64, message, sha }) {
  const body = { message, content: contentBase64, branch: cfg.branch };
  if (sha) body.sha = sha;
  const res = await fetch(apiUrl(path), {
    method: 'PUT',
    headers: {
      Authorization: `token ${cfg.token}`,
      Accept: 'application/vnd.github+json',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });
  if (!res.ok) {
    const errBody = await res.json().catch(() => ({}));
    const err = new Error(errBody.message || `GitHub PUT ${path} failed: ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return res.json();
}
async function ghDelete(path, { message, sha }) {
  const res = await fetch(apiUrl(path), {
    method: 'DELETE',
    headers: {
      Authorization: `token ${cfg.token}`,
      Accept: 'application/vnd.github+json',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ message, sha, branch: cfg.branch })
  });
  if (!res.ok) throw new Error(`GitHub DELETE ${path} failed: ${res.status}`);
  return res.json();
}

function utf8ToBase64(str) {
  return btoa(unescape(encodeURIComponent(str)));
}
function base64ToUtf8(b64) {
  return decodeURIComponent(escape(atob(b64)));
}

/* ---------------- manifest read/write with conflict retry ---------------- */
async function fetchManifest() {
  const file = await ghGet(MANIFEST_PATH);
  if (!file) {
    manifestSha = null;
    return [];
  }
  manifestSha = file.sha;
  try {
    return JSON.parse(base64ToUtf8(file.content.replace(/\n/g, ''))).items || [];
  } catch {
    return [];
  }
}

async function mutateManifest(mutateFn, message) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const latest = await fetchManifest();
    const next = mutateFn(latest.slice());
    try {
      const result = await ghPut(MANIFEST_PATH, {
        contentBase64: utf8ToBase64(JSON.stringify({ items: next }, null, 2)),
        message,
        sha: manifestSha
      });
      manifestSha = result.content.sha;
      items = next;
      return next;
    } catch (e) {
      if (e.status === 409 || e.status === 422) {
        await new Promise(r => setTimeout(r, 300 + Math.random() * 400));
        continue;
      }
      throw e;
    }
  }
  throw new Error('Could not save — someone else is pinning at the same time. Try again.');
}

/* ---------------- image prep ---------------- */
function fileToId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function resizeImage(file, maxDim = 1600, quality = 0.85) {
  return new Promise((resolve, reject) => {
    if (file.type === 'image/gif') {
      const reader = new FileReader();
      reader.onload = () => resolve({ base64: reader.result.split(',')[1], ext: 'gif', mime: 'image/gif' });
      reader.onerror = reject;
      reader.readAsDataURL(file);
      return;
    }
    const img = new Image();
    const reader = new FileReader();
    reader.onload = () => { img.src = reader.result; };
    reader.onerror = reject;
    img.onload = () => {
      let { width, height } = img;
      if (width > maxDim || height > maxDim) {
        const scale = maxDim / Math.max(width, height);
        width = Math.round(width * scale);
        height = Math.round(height * scale);
      }
      const canvas = document.createElement('canvas');
      canvas.width = width; canvas.height = height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, width, height);
      const isPng = file.type === 'image/png';
      const mime = isPng ? 'image/png' : 'image/jpeg';
      const dataUrl = canvas.toDataURL(mime, quality);
      resolve({ base64: dataUrl.split(',')[1], ext: isPng ? 'png' : 'jpg', mime });
    };
    img.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function rawUrl(path) {
  return `https://raw.githubusercontent.com/${cfg.owner}/${cfg.repo}/${cfg.branch}/${path}`;
}

/* ---------------- add / delete ---------------- */
async function pinFiles(fileList) {
  const files = Array.from(fileList).filter(f => f.type.startsWith('image/'));
  if (!files.length) return;
  for (let i = 0; i < files.length; i++) {
    showToast(`pinning ${i + 1} / ${files.length}…`, 5000);
    try {
      await pinFileSequential(files[i]);
    } catch (e) {
      console.error(e);
      showToast(`couldn't pin ${files[i].name}: ${e.message}`, 4000);
    }
  }
  showToast(`pinned ${files.length} ✓`);
  render();
}

// sequential variant that doesn't re-render / re-toast per file
async function pinFileSequential(file) {
  const id = fileToId();
  const { base64, ext, mime } = await resizeImage(file);
  const path = `images/${id}.${ext}`;
  await ghPut(path, { contentBase64: base64, message: `pin: ${file.name || id}` });
  const entry = {
    id, type: 'image', path,
    src: rawUrl(path),
    caption: '', tags: [], source: '',
    addedBy: cfg.name || 'someone', addedAt: new Date().toISOString(),
    mime
  };
  await mutateManifest(list => [entry, ...list], `add pin ${id}`);
}

async function pinLink({ imgUrl, sourceUrl, caption }) {
  const id = fileToId();
  const entry = {
    id, type: 'link',
    src: imgUrl,
    caption: caption || '', tags: [], source: sourceUrl || imgUrl,
    addedBy: cfg.name || 'someone', addedAt: new Date().toISOString()
  };
  await mutateManifest(list => [entry, ...list], `add pin ${id} (link)`);
  render();
  showToast('pinned ✓');
}

async function deleteItem(item) {
  if (item.type === 'image') {
    try {
      const file = await ghGet(item.path);
      if (file) await ghDelete(item.path, { message: `unpin ${item.id}`, sha: file.sha });
    } catch (e) { console.warn('could not remove file from repo', e); }
  }
  await mutateManifest(list => list.filter(x => x.id !== item.id), `unpin ${item.id}`);
  render();
  showToast('unpinned');
}

async function updateItem(id, patch) {
  await mutateManifest(list => list.map(x => x.id === id ? { ...x, ...patch } : x), `edit ${id}`);
  render();
}

/* ---------------- rendering ---------------- */
function allTags() {
  const set = new Set();
  items.forEach(i => (i.tags || []).forEach(t => set.add(t)));
  return Array.from(set).sort();
}

function renderTagRail() {
  const tags = allTags();
  tagRail.innerHTML = '';
  if (!tags.length) { tagRail.hidden = true; return; }
  tagRail.hidden = false;
  const allChip = document.createElement('button');
  allChip.className = 'tag-chip' + (activeTag ? '' : ' active');
  allChip.textContent = 'all';
  allChip.onclick = () => { activeTag = null; render(); };
  tagRail.appendChild(allChip);
  tags.forEach(t => {
    const chip = document.createElement('button');
    chip.className = 'tag-chip' + (activeTag === t ? ' active' : '');
    chip.textContent = t;
    chip.onclick = () => { activeTag = activeTag === t ? null : t; render(); };
    tagRail.appendChild(chip);
  });
}

function filteredItems() {
  return items.filter(i => {
    if (activeTag && !(i.tags || []).includes(activeTag)) return false;
    if (searchTerm) {
      const hay = `${i.caption} ${(i.tags || []).join(' ')} ${i.source} ${i.addedBy}`.toLowerCase();
      if (!hay.includes(searchTerm)) return false;
    }
    return true;
  });
}

function timeAgo(iso) {
  const s = Math.max(1, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  const units = [[31536000,'y'],[2592000,'mo'],[604800,'w'],[86400,'d'],[3600,'h'],[60,'m']];
  for (const [secs, label] of units) {
    if (s >= secs) return `${Math.floor(s / secs)}${label} ago`;
  }
  return 'just now';
}

function frameNumber(index, total) {
  return String(total - index).padStart(3, '0');
}

function render() {
  renderTagRail();
  const list = filteredItems();
  grid.innerHTML = '';
  emptyState.hidden = items.length !== 0;
  loadingState.hidden = true;

  list.forEach((item, idx) => {
    const card = document.createElement('div');
    card.className = 'card';
    card.style.setProperty('--tilt', `${(hashCode(item.id) % 5 - 2) * 0.6}deg`);
    card.innerHTML = `
      <div class="card__tape"></div>
      <div class="card__frame">${frameNumber(idx, list.length)}</div>
      <div class="card__img-wrap">
        <img src="${item.src}" loading="lazy" alt="${escapeHtml(item.caption || '')}">
      </div>
      <div class="card__body">
        <p class="card__caption">${escapeHtml(item.caption || '')}</p>
        <div class="card__tags">${(item.tags || []).map(t => `<span class="card__tag">${escapeHtml(t)}</span>`).join('')}</div>
        <div class="card__foot"><span>${timeAgo(item.addedAt)}</span></div>
      </div>
    `;
    card.addEventListener('click', () => openLightbox(item));
    grid.appendChild(card);
  });
}

function hashCode(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h << 5) - h + str.charCodeAt(i) | 0;
  return Math.abs(h);
}
function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
}

/* ---------------- lightbox ---------------- */
let lightboxItemId = null;
function openLightbox(item) {
  lightboxItemId = item.id;
  el('lightboxImg').src = item.src;
  el('lightboxFrame').textContent = `FRAME ${item.id}`;
  el('lightboxCaption').value = item.caption || '';
  el('lightboxTags').value = (item.tags || []).join(', ');
  el('lightboxSource').value = item.source || '';
  el('lightboxBy').textContent = `pinned ${timeAgo(item.addedAt)}`;
  const openLink = el('lightboxOpen');
  if (item.source) { openLink.href = item.source; openLink.style.display = 'inline-flex'; }
  else { openLink.style.display = 'none'; }
  openModal('lightbox');
}
el('lightboxSave').addEventListener('click', async () => {
  const patch = {
    caption: el('lightboxCaption').value.trim(),
    tags: el('lightboxTags').value.split(',').map(t => t.trim()).filter(Boolean),
    source: el('lightboxSource').value.trim()
  };
  await updateItem(lightboxItemId, patch);
  closeModal('lightbox');
});
el('lightboxDelete').addEventListener('click', async () => {
  const item = items.find(i => i.id === lightboxItemId);
  if (!item) return;
  if (!confirm('Unpin this from the board? This removes it for both of you.')) return;
  closeModal('lightbox');
  await deleteItem(item);
});

/* ---------------- add link modal ---------------- */
el('addLinkBtn').addEventListener('click', () => openModal('linkModal'));
el('linkSubmit').addEventListener('click', async () => {
  const imgUrl = el('linkImgUrl').value.trim();
  if (!imgUrl) return;
  await pinLink({
    imgUrl,
    sourceUrl: el('linkSourceUrl').value.trim(),
    caption: el('linkCaption').value.trim()
  });
  el('linkImgUrl').value = ''; el('linkSourceUrl').value = ''; el('linkCaption').value = '';
  closeModal('linkModal');
});

/* ---------------- file add ---------------- */
el('addFileBtn').addEventListener('click', () => el('fileInput').click());
el('fileInput').addEventListener('change', (e) => { pinFiles(e.target.files); e.target.value = ''; });

/* ---------------- search ---------------- */
el('searchInput').addEventListener('input', (e) => {
  searchTerm = e.target.value.trim().toLowerCase();
  render();
});

/* ---------------- drag & drop + paste ---------------- */
let dragCounter = 0;
window.addEventListener('dragenter', (e) => {
  if (!e.dataTransfer.types.includes('Files')) return;
  dragCounter++;
  dropOverlay.classList.add('active');
});
window.addEventListener('dragleave', () => {
  dragCounter = Math.max(0, dragCounter - 1);
  if (dragCounter === 0) dropOverlay.classList.remove('active');
});
window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('drop', (e) => {
  e.preventDefault();
  dragCounter = 0;
  dropOverlay.classList.remove('active');
  if (e.dataTransfer.files && e.dataTransfer.files.length) pinFiles(e.dataTransfer.files);
});
window.addEventListener('paste', (e) => {
  if (!cfg) return;
  const files = Array.from(e.clipboardData.items)
    .filter(i => i.type.startsWith('image/'))
    .map(i => i.getAsFile());
  if (files.length) pinFiles(files);
});

/* ---------------- settings ---------------- */
el('settingsBtn').addEventListener('click', () => {
  if (cfg) {
    el('cfgOwner').value = cfg.owner || '';
    el('cfgRepo').value = cfg.repo || '';
    el('cfgBranch').value = cfg.branch || 'main';
    el('cfgToken').value = cfg.token || '';
  }
  openModal('settingsModal');
});
el('settingsSave').addEventListener('click', async () => {
  const candidate = {
    name: 'me',
    owner: el('cfgOwner').value.trim(),
    repo: el('cfgRepo').value.trim(),
    branch: el('cfgBranch').value.trim() || 'main',
    token: el('cfgToken').value.trim()
  };
  const errEl = el('settingsError');
  errEl.hidden = true;
  if (!candidate.owner || !candidate.repo || !candidate.token) {
    errEl.textContent = 'Fill in owner, repo, and token.';
    errEl.hidden = false;
    return;
  }
  el('settingsSave').textContent = 'connecting…';
  const prevCfg = cfg;
  cfg = candidate;
  try {
    const test = await fetch(`https://api.github.com/repos/${cfg.owner}/${cfg.repo}`, {
      headers: { Authorization: `token ${cfg.token}`, Accept: 'application/vnd.github+json' }
    });
    if (!test.ok) throw new Error(test.status === 404 ? 'Repo not found — check owner/repo.' : `GitHub said: ${test.status}`);
    saveConfig(cfg);
    closeModal('settingsModal');
    await boot();
  } catch (e) {
    cfg = prevCfg;
    errEl.textContent = e.message;
    errEl.hidden = false;
  } finally {
    el('settingsSave').textContent = 'connect';
  }
});

/* ---------------- boot ---------------- */
async function boot() {
  cfg = loadConfig();
  if (!cfg) {
    loadingState.hidden = true;
    openModal('settingsModal');
    return;
  }
  if (!cfg.name) cfg.name = 'me';
  loadingState.hidden = false;
  emptyState.hidden = true;
  try {
    items = await fetchManifest();
    render();
  } catch (e) {
    console.error(e);
    loadingState.hidden = true;
    showToast('Could not load board — check settings/token', 5000);
    openModal('settingsModal');
  }
}

boot();
