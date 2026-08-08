const state = { bugs: [], query: '' };
const bugList = document.querySelector('#bugList');
const submitDialog = document.querySelector('#submitDialog');
const supportDialog = document.querySelector('#supportDialog');
const escapeHTML = value => String(value).replace(/[&<>'"]/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#39;', '"':'&quot;' }[char]));

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) }
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || '请求失败');
  return data;
}

function renderStats() {
  const weights = state.bugs.map(bug => bug.supporters.length);
  document.querySelector('#bugCount').textContent = state.bugs.length;
  document.querySelector('#supportCount').textContent = weights.reduce((sum, n) => sum + n, 0);
  document.querySelector('#topWeight').textContent = Math.max(0, ...weights);
}

function render() {
  const query = state.query.toLowerCase();
  const visible = state.bugs.filter(bug => [bug.title, bug.detail, bug.category].some(value => value.toLowerCase().includes(query)));
  if (!visible.length) {
    bugList.innerHTML = '<div class="empty">没有找到相关问题，换个关键词试试。</div>';
    return;
  }
  bugList.innerHTML = visible.map((bug, index) => {
    const names = bug.supporters.map(item => `<span class="supporter">${escapeHTML(item.name)}</span>`).join('');
    return `<article class="bug-card" id="bug-${bug.id}">
      <div class="rank ${index < 3 && !query ? 'top' : ''}">${String(index + 1).padStart(2, '0')}</div>
      <div>
        <div class="bug-meta"><span class="chip">${escapeHTML(bug.category)}</span><span class="chip status">${escapeHTML(bug.status)}</span></div>
        <h3 class="bug-title">${escapeHTML(bug.title)}</h3>
        <p class="bug-detail">${escapeHTML(bug.detail)}</p>
        <div class="supporters"><span class="support-label">已署名</span>${names || '<span class="empty-support">等待第一位用户加权</span>'}</div>
      </div>
      <div class="weight-box">
        <div class="weight">${bug.supporters.length}<small>WEIGHT</small></div>
        <button class="support-btn" data-support="${bug.id}">我也遇到了 ＋1</button>
      </div>
    </article>`;
  }).join('');
}

async function loadBugs() {
  try {
    state.bugs = await api('api/bugs');
    renderStats(); render();
  } catch (error) {
    bugList.innerHTML = `<div class="empty">同步失败：${escapeHTML(error.message)}</div>`;
  }
}

function toast(message) {
  const element = document.querySelector('#toast');
  element.textContent = message;
  element.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => element.classList.remove('show'), 2600);
}

document.querySelectorAll('[data-open-submit]').forEach(button => button.addEventListener('click', () => submitDialog.showModal()));
document.querySelectorAll('[data-close]').forEach(button => button.addEventListener('click', () => button.closest('dialog').close()));
document.querySelectorAll('dialog').forEach(dialog => dialog.addEventListener('click', event => {
  if (event.target === dialog) dialog.close();
}));

document.querySelector('#searchInput').addEventListener('input', event => {
  state.query = event.target.value.trim(); render();
});

bugList.addEventListener('click', event => {
  const button = event.target.closest('[data-support]');
  if (!button) return;
  const bug = state.bugs.find(item => item.id === button.dataset.support);
  supportDialog.querySelector('[name="bugId"]').value = bug.id;
  supportDialog.querySelector('#supportTitle').textContent = bug.title;
  supportDialog.querySelector('#supportMessage').textContent = '';
  supportDialog.showModal();
});

document.querySelector('#submitForm').addEventListener('submit', async event => {
  event.preventDefault();
  const form = event.currentTarget;
  const button = form.querySelector('[type="submit"]');
  const message = form.querySelector('#submitMessage');
  button.disabled = true; button.textContent = '正在提交…'; message.textContent = '';
  try {
    const values = Object.fromEntries(new FormData(form));
    await api('api/bugs', { method: 'POST', body: JSON.stringify(values) });
    form.reset(); submitDialog.close(); await loadBugs(); toast('问题已进入维护队列');
  } catch (error) { message.textContent = error.message; }
  finally { button.disabled = false; button.innerHTML = '确认提交 <span>↗</span>'; }
});

document.querySelector('#supportForm').addEventListener('submit', async event => {
  event.preventDefault();
  const form = event.currentTarget;
  const button = form.querySelector('[type="submit"]');
  const message = form.querySelector('#supportMessage');
  const values = Object.fromEntries(new FormData(form));
  button.disabled = true; button.textContent = '正在加权…'; message.textContent = '';
  try {
    await api(`/api/bugs/${values.bugId}/support`, { method: 'POST', body: JSON.stringify({ qqName: values.qqName }) });
    form.reset(); supportDialog.close(); await loadBugs(); toast('署名成功，问题权重 +1');
  } catch (error) { message.textContent = error.message; }
  finally { button.disabled = false; button.innerHTML = '署名并 +1 权重 <span>↑</span>'; }
});

loadBugs();
