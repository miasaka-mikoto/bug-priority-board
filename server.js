const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '127.0.0.1';
const PUBLIC_DIR = path.join(__dirname, 'public');
const DATA_DIR = path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'bugs.json');
const MAX_BODY = 32 * 1024;

const initialBugs = [
  {
    id: crypto.randomUUID(),
    title: '切换模式后误进入编辑模式，无法攻击或继续切换',
    detail: '切换模式时会自动跳到编辑模式，随后无法攻击，也无法切换回其他模式。',
    category: '核心玩法',
    status: '待确认',
    supporters: [],
    createdAt: new Date().toISOString()
  },
  {
    id: crypto.randomUUID(),
    title: '羁绊卡无法洗练',
    detail: '羁绊卡的洗练功能无法正常使用。',
    category: '卡牌系统',
    status: '待确认',
    supporters: [],
    createdAt: new Date().toISOString()
  },
  {
    id: crypto.randomUUID(),
    title: '天台隐藏地图无法进入',
    detail: '满足进入条件后，仍无法进入天台隐藏地图。',
    category: '地图场景',
    status: '待确认',
    supporters: [],
    createdAt: new Date().toISOString()
  },
  {
    id: crypto.randomUUID(),
    title: '切换角色时会卡顿并发生位置偏移',
    detail: '切换角色时画面会短暂卡顿，角色位置也会发生变化。',
    category: '角色系统',
    status: '待确认',
    supporters: [],
    createdAt: new Date().toISOString()
  }
];

function ensureData() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(DATA_FILE)) {
    fs.writeFileSync(DATA_FILE, JSON.stringify(initialBugs, null, 2), 'utf8');
  }
}

function readBugs() {
  ensureData();
  return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
}

function writeBugs(bugs) {
  const temp = `${DATA_FILE}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(bugs, null, 2), 'utf8');
  fs.renameSync(temp, DATA_FILE);
}

function json(res, status, payload) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff'
  });
  res.end(JSON.stringify(payload));
}

function clean(value, max) {
  return typeof value === 'string' ? value.trim().replace(/[\u0000-\u001f\u007f]/g, '').slice(0, max) : '';
}

function clientError(message, statusCode = 400) {
  return Object.assign(new Error(message), { statusCode });
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let oversized = false;
    req.on('data', chunk => {
      if (oversized) return;
      size += chunk.length;
      if (size > MAX_BODY) {
        oversized = true;
        chunks.length = 0;
        reject(clientError('请求内容过大', 413));
        return; // Drain the request without retaining it or destroying the response.
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (oversized) return;
      try {
        // Decode once: a UTF-8 character may span two incoming buffers.
        const value = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
        if (value === null || typeof value !== 'object' || Array.isArray(value)) {
          return reject(clientError('请求正文必须是 JSON 对象'));
        }
        resolve(value);
      } catch {
        reject(clientError('请求格式不正确'));
      }
    });
    req.on('error', reject);
  });
}

function serveStatic(req, res) {
  const requestPath = decodeURIComponent(req.url.split('?')[0]);
  const relative = requestPath === '/' ? 'index.html' : requestPath.replace(/^\/+/, '');
  const filePath = path.resolve(PUBLIC_DIR, relative);
  if (!filePath.startsWith(path.resolve(PUBLIC_DIR) + path.sep)) {
    res.writeHead(403); return res.end('Forbidden');
  }
  fs.readFile(filePath, (error, data) => {
    if (error) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('页面不存在');
    }
    const types = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };
    res.writeHead(200, {
      'Content-Type': `${types[path.extname(filePath)] || 'application/octet-stream'}; charset=utf-8`,
      'X-Content-Type-Options': 'nosniff'
    });
    res.end(data);
  });
}


// ---- 轻量限流：防刷票/灌水（内存滑动窗口，无外部依赖） ----
const WRITE_RATE_LIMITS = [
  { name: 'create', test: (method, pathname) => method === 'POST' && pathname === '/api/bugs', max: 20, windowMs: 10 * 60 * 1000 },
  { name: 'support', test: (method, pathname) => method === 'POST' && SUPPORT_PATH_RE.test(pathname), max: 60, windowMs: 10 * 60 * 1000 },
];
const SUPPORT_PATH_RE = /^\/api\/bugs\/([a-f0-9-]+)\/support$/i;
const rateBuckets = new Map(); // key: `${name}:${ip}` -> number[] timestamps
function isRateLimited(req, pathname) {
  const rule = WRITE_RATE_LIMITS.find(r => r.test(req.method, pathname));
  if (!rule) return false;
  const ip = (req.socket && req.socket.remoteAddress) || 'unknown';
  const key = `${rule.name}:${ip}`;
  const now = Date.now();
  const hits = (rateBuckets.get(key) || []).filter(t => now - t < rule.windowMs);
  if (hits.length >= rule.max) return true;
  hits.push(now);
  rateBuckets.set(key, hits);
  if (rateBuckets.size > 5000) {
    for (const [k, v] of rateBuckets) {
      const fresh = v.filter(t => now - t < rule.windowMs);
      if (fresh.length) rateBuckets.set(k, fresh); else rateBuckets.delete(k);
    }
  }
  return false;
}

const server = http.createServer(async (req, res) => {
  try {
    let url;
    try {
      url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    } catch {
      throw clientError('请求地址不正确');
    }
    if (req.method === 'GET' && url.pathname === '/api/bugs') {
      const bugs = readBugs().sort((a, b) => b.supporters.length - a.supporters.length || new Date(a.createdAt) - new Date(b.createdAt));
      return json(res, 200, bugs);
    }

    if (req.method === 'POST' && (url.pathname === '/api/bugs' || SUPPORT_PATH_RE.test(url.pathname))) {
      if (isRateLimited(req, url.pathname)) {
        return json(res, 429, { error: '操作太频繁，请稍后再试。' });
      }
    }

    if (req.method === 'POST' && url.pathname === '/api/bugs') {
      const body = await readBody(req);
      const title = clean(body.title, 80);
      const detail = clean(body.detail, 400);
      const category = clean(body.category, 20) || '其他问题';
      const qqName = clean(body.qqName, 30);
      if (title.length < 4 || detail.length < 4 || qqName.length < 1) {
        return json(res, 400, { error: '请填写完整的问题标题、现象描述和 QQ 名。' });
      }
      const bugs = readBugs();
      const duplicate = bugs.find(b => b.title.toLowerCase() === title.toLowerCase());
      if (duplicate) return json(res, 409, { error: '已有相同标题，请直接为该问题加权。', bugId: duplicate.id });
      const bug = {
        id: crypto.randomUUID(), title, detail, category, status: '待确认',
        supporters: [{ name: qqName, at: new Date().toISOString() }],
        createdAt: new Date().toISOString()
      };
      bugs.push(bug);
      writeBugs(bugs);
      return json(res, 201, bug);
    }

    const supportMatch = url.pathname.match(SUPPORT_PATH_RE);
    if (req.method === 'POST' && supportMatch) {
      const body = await readBody(req);
      const qqName = clean(body.qqName, 30);
      if (!qqName) return json(res, 400, { error: '请填写你的 QQ 名。' });
      const bugs = readBugs();
      const bug = bugs.find(item => item.id === supportMatch[1]);
      if (!bug) return json(res, 404, { error: '没有找到这个问题。' });
      if (bug.supporters.some(item => item.name.toLowerCase() === qqName.toLowerCase())) {
        return json(res, 409, { error: '这个 QQ 名已经为该问题加过权了。' });
      }
      bug.supporters.push({ name: qqName, at: new Date().toISOString() });
      writeBugs(bugs);
      return json(res, 200, bug);
    }

    if (url.pathname.startsWith('/api/')) return json(res, 404, { error: '接口不存在' });
    serveStatic(req, res);
  } catch (error) {
    const status = error instanceof URIError ? 400 : (error.statusCode || 500);
    if (status >= 500) console.error(error);
    if (!res.headersSent) json(res, status, {
      error: status >= 500 ? '服务器开小差了，请稍后再试。' : error.message
    });
  }
});

ensureData();
server.listen(PORT, HOST, () => {
  console.log(`Bug 优先级看板已启动：http://localhost:${PORT}`);
});
