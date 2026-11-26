const kpis = [
  ['Punctuality', 'มาตรงเวลา', 'นัดกี่โมง ทีมพร้อมออกกี่โมง'],
  ['Group Chat Response', 'ตอบแชตกลุ่ม', 'เวลาเพื่อนเรียกประชุมในกรุ๊ป ตอบทันไหม'],
  ['Confidentiality', 'เก็บความลับ', 'เรื่องที่ฝากไว้ ยังอยู่ในห้องประชุมไหม'],
  ['Shopping Budget', 'คุมงบช้อปปิ้ง', 'ตั้งงบแล้วช้อปได้ตามแผนแค่ไหน'],
  ['Restaurant Decisions', 'เลือกร้านอาหาร', 'ตอนทุกคนบอกว่า “อะไรก็ได้” ช่วยปิดดีลได้ไหม'],
  ['Crisis Management', 'จัดการเหตุฉุกเฉิน', 'แผนเปลี่ยนกะทันหัน พาทีมไปต่อได้ไหม'],
  ['Friendship', 'ดูแลมิตรภาพ', 'มีเวลาให้เพื่อนและคอยอยู่ข้างกันแค่ไหน'],
  ['Sending Clips', 'ส่งคลิปให้เพื่อน', 'ส่งคลิปได้ตรงจริตแก๊งแค่ไหน'],
  ['Girls’ Trip Planning', 'วางแผนทริปสาว ๆ', 'จาก “ต้องไปแล้ว” สู่การได้จองจริง'],
  ['Executive Presence', 'ออร่าผู้นำ', 'เข้าห้องแล้วทำให้ทีมรู้สึกพร้อมแค่ไหน'],
];
const app = document.querySelector('#app');
const route = location.pathname.slice(1);
document.body.classList.add(route);
const number = i => String(i + 1).padStart(2, '0');
const format = value => value == null ? '—' : value.toFixed(2);
const title = (tag, first, second, description) => `
  <div class="hero"><p class="eyebrow"><i></i> ${tag}</p>
  <h1>${first}<br><em>${second}</em></h1><p class="intro">${description}</p></div>`;
let state;
let participant;
let votePending = false;
let roundSync = 0;
let adminPassword = '';
let adminBusy = false;

async function request(path, payload, password) {
  const headers = {};
  if (password) headers.Authorization = 'Bearer ' + password;
  if (payload) headers['Content-Type'] = 'application/json';
  const response = await fetch(path, { headers, ...(payload && {method: 'POST', body: JSON.stringify(payload)}) });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error);
  return data;
}

function status() {
  return state.open ? 'เปิดโหวต · VOTING OPEN' : state.revealed ? 'เปิดผล · RESULTS' : 'ปิดโหวต · VOTING CLOSED';
}

function addFeedback(container, feedback) {
  for (const message of feedback) {
    const quote = document.createElement('blockquote');
    quote.textContent = message;
    container.append(quote);
  }
}

function mountVote() {
  app.innerHTML = title('THE FINAL CEO SUMMIT / BALLOT', 'CEO', 'SCORECARD', 'ให้คะแนนแบบไม่ระบุชื่อ แล้วส่งกำลังใจให้ CEO ของแก๊งได้เลย') + `
    <div id="vote-state" class="notice" role="status">กำลังเชื่อมต่อ…</div>
    <form id="ballot" hidden>
      <p class="scale">1 = ยังฝึกได้ <span>5 = พร้อมขึ้นเวที</span></p>
      ${kpis.map(([en, th, hint], i) => `<fieldset class="kpi card">
        <legend class="sr">${en} · ${th}</legend>
        <div class="kpi-label"><span class="index">${number(i)}</span><div><h2>${en}</h2><p>${th} · ${hint}</p></div></div>
        <div class="choices">${[1,2,3,4,5].map(n => `<label><input type="radio" name="k${i}" value="${n}" required><span>${n}</span></label>`).join('')}</div>
      </fieldset>`).join('')}
      <div class="card comment"><label for="feedback">ฝากข้อความถึง CEO <small>OPTIONAL</small></label>
      <textarea id="feedback" name="feedback" maxlength="500" rows="3" placeholder="ชมหนึ่งอย่าง หรือฝากไอเดียแบบเพื่อนคุยกัน"></textarea>
      <p>ผู้จัดอาจเลือกข้อความขึ้นจอ กรุณาเลี่ยงชื่อจริงและเรื่องส่วนตัว</p></div>
      <p id="vote-error" role="alert"></p>
      <button type="submit">ส่งคะแนน <span>SUBMIT VOTE ↗</span></button>
    </form>`;
  const form = document.querySelector('#ballot');
  form.onsubmit = async event => {
    event.preventDefault();
    if (!participant || !state || votePending) return;
    const data = new FormData(form);
    const round = participant.round;
    const errorBox = document.querySelector('#vote-error');
    errorBox.textContent = '';
    votePending = true;
    updateVote();
    try {
      await request('/api/vote', {round, scores: kpis.map((_, i) => Number(data.get('k' + i))), feedback: data.get('feedback')});
      if (participant?.round === round) participant.submitted = true;
    } catch (error) {
      if (error.message === 'already_submitted' && participant?.round === round) participant.submitted = true;
      else errorBox.textContent = 'ส่งคะแนนยังไม่สำเร็จ ลองอีกครั้งเมื่อระบบเปิดโหวต';
    } finally {
      votePending = false;
      updateVote();
    }
  };
}

function updateVote() {
  const notice = document.querySelector('#vote-state');
  const form = document.querySelector('#ballot');
  if (!state || participant?.round !== state.round) {
    notice.textContent = 'กำลังเชื่อมต่อ…';
    form.hidden = true;
    return;
  }
  notice.textContent = participant.submitted ? 'รับคะแนนแล้ว · THANK YOU, BOARD MEMBER!' : status();
  form.hidden = participant.submitted || !state.open;
  form.querySelector('button').disabled = votePending;
}

async function voteState() {
  updateVote();
  if (participant?.round === state.round) return;
  const attempt = ++roundSync;
  try {
    const next = await request('/api/participant');
    if (attempt !== roundSync || next.round !== state.round) return;
    if (participant && participant.round !== next.round) document.querySelector('#ballot').reset();
    participant = next;
    updateVote();
  } catch {
    if (attempt === roundSync) document.querySelector('#vote-state').textContent = 'เชื่อมต่อไม่ได้ ลองรีเฟรชหน้านี้';
  }
}

function projector() {
  app.innerHTML = `<div class="stage-top">${title('LIVE BOARDROOM', 'THE FINAL', 'CEO SUMMIT', 'Bachelorette Edition · มาประเมิน CEO ของแก๊งกัน')}
    <aside class="join card"><p class="eyebrow"><i></i> ${status()}</p>
    <div class="join-inner"><div id="qr"></div><div><strong>${state.count}</strong><p>คะแนนที่ส่งแล้ว<br><small>RESPONSES RECEIVED</small></p></div></div></aside></div>
    <section class="results" aria-label="ผลคะแนน"><div class="section-title"><h2>KPI RESULTS</h2><p>${state.revealed ? `เปิดแล้ว ${Math.min(state.revealed, 10)} / 10 KPI` : 'รอเปิดคะแนนบนเวที'}</p></div>
    <div class="results-grid">${kpis.map(([en, th], i) => `<article class="result card ${i < state.revealed ? 'revealed' : ''}"><span class="index">${number(i)}</span><div><h3>${en}</h3><p>${th}</p></div><strong>${i < state.revealed ? format(state.averages[i]) : '—'}</strong></article>`).join('')}</div>
    <div class="overall"><div><h2>OVERALL SCORE</h2><p>คะแนนเฉลี่ยรวม</p></div><strong>${format(state.overall)} <small>/ 5</small></strong></div></section>
    <section id="stage-feedback" ${state.feedback.length ? '' : 'hidden'}><h2>FROM THE BOARD</h2></section>`;
  const qrBox = document.querySelector('#qr');
  if (state.voteUrl) {
    const link = document.createElement('a');
    link.href = state.voteUrl;
    link.className = 'qr-link';
    const image = document.createElement('img');
    image.src = '/qr.png';
    image.alt = 'สแกน QR เพื่อเปิดหน้าโหวต';
    const label = document.createElement('span');
    label.textContent = new URL(state.voteUrl).host + '/vote';
    link.append(image, label);
    qrBox.append(link);
  } else {
    qrBox.textContent = 'รอลิงก์สำหรับสแกน';
  }
  addFeedback(document.querySelector('#stage-feedback'), state.feedback);
}

function adminLogin() {
  app.innerHTML = title('HOST ACCESS', 'SUMMIT', 'CONTROL', 'ลงชื่อเข้าใช้สำหรับผู้จัดงาน') + `
    <form id="login" class="card control"><label for="password">รหัสผ่านผู้จัด</label>
    <input type="password" id="password" name="password" autocomplete="current-password" required>
    <p id="login-error" role="alert"></p><button>เข้าสู่ระบบ ↗</button></form>`;
  const form = document.querySelector('#login');
  form.onsubmit = async event => {
    event.preventDefault();
    const button = form.querySelector('button');
    button.disabled = true;
    const password = new FormData(form).get('password');
    try {
      const next = await request('/api/admin', null, password);
      adminPassword = password;
      adminPanel(next);
    } catch (error) {
      document.querySelector('#login-error').textContent = error.message === 'admin_auth'
        ? 'เข้าสู่ระบบไม่ได้ ตรวจสอบรหัสผ่านแล้วลองอีกครั้ง' : 'เชื่อมต่อไม่ได้ ลองอีกครั้ง';
      button.disabled = false;
    }
  };
}

function adminPanel(current) {
  app.innerHTML = title('HOST ACCESS', 'SUMMIT', 'CONTROL', 'จัดคิวโหวตและเปิดผลทีละรายการ') + `
    <section class="card control">
      <p class="eyebrow"><i></i> ${current.open ? 'VOTING OPEN' : 'VOTING CLOSED'} · ${current.count} RESPONSES</p>
      <div class="actions">
        <button data-action="open" ${current.open || current.revealed ? 'disabled' : ''}>เปิดโหวต</button>
        <button data-action="close" ${!current.open ? 'disabled' : ''}>ปิดโหวต</button>
        <button data-action="reveal" ${current.open || !current.count || current.revealed >= 11 ? 'disabled' : ''}>${current.revealed < 10 ? 'เปิด KPI ' + number(current.revealed) : current.revealed === 10 ? 'เปิดคะแนนรวม' : 'เปิดผลครบแล้ว'}</button>
      </div>
      <a href="/projector" target="_blank" rel="noopener">เปิดหน้าโปรเจกเตอร์ ↗</a>
      <p id="admin-error" role="alert"></p>
    </section>
    <section class="card control"><h2>FEEDBACK MODERATION</h2><p>ข้อความที่อนุมัติจะขึ้นจอหลังเปิดคะแนนรวม</p>
      <div id="moderation"></div></section>
    <section class="card control"><div class="actions"><button class="secondary" data-action="reset">ล้างคะแนนและเริ่มรอบใหม่</button>
    <button class="secondary" data-action="logout">ออกจากระบบ</button></div></section>`;
  const list = document.querySelector('#moderation');
  if (!current.moderation.length) list.textContent = 'ยังไม่มีข้อความ';
  for (const entry of current.moderation) {
    const item = document.createElement('div');
    item.className = 'moderation-item';
    addFeedback(item, [entry.feedback]);
    const button = document.createElement('button');
    button.className = 'secondary';
    button.textContent = entry.approved ? 'ซ่อนจากจอ' : 'อนุมัติให้ขึ้นจอ';
    button.onclick = () => adminAction(current, 'moderate', {id: entry.id, approved: !entry.approved});
    item.append(button);
    list.append(item);
  }
  for (const button of app.querySelectorAll('[data-action]')) button.onclick = () => {
    const action = button.dataset.action;
    if (action === 'logout') {
      adminPassword = '';
      adminLogin();
      return;
    }
    if (action === 'reset' && !confirm('ลบคะแนนและข้อความทั้งหมดของรอบนี้ แล้วเริ่มรอบใหม่หรือไม่?')) return;
    adminAction(current, action);
  };
}

async function adminAction(current, action, details = {}) {
  if (adminBusy) return;
  adminBusy = true;
  try {
    const result = await request('/api/admin', {action, round: current.round, stage: current.revealed, ...details}, adminPassword);
    if (adminPassword) adminPanel(result);
  } catch {
    if (adminPassword) document.querySelector('#admin-error').textContent = 'บันทึกไม่ได้ รอสักครู่แล้วลองอีกครั้ง';
  } finally {
    adminBusy = false;
    if (adminPassword && state && (state.count !== current.count || state.round !== current.round || state.revealed !== current.revealed || state.open !== current.open)) refreshAdmin();
  }
}

let refreshVersion = 0;
async function refreshAdmin() {
  if (!adminPassword || adminBusy) return;
  const password = adminPassword;
  const version = ++refreshVersion;
  try {
    const next = await request('/api/admin', null, password);
    if (adminPassword === password && !adminBusy && refreshVersion === version) adminPanel(next);
  } catch {
    // The next event or operator action can retry.
  }
}

if (route === 'vote') mountVote();
if (route === 'admin') adminLogin();
const events = new EventSource('/api/events');
events.onmessage = event => {
  state = JSON.parse(event.data);
  document.body.classList.remove('offline');
  if (route === 'vote') voteState();
  if (route === 'projector') projector();
  if (route === 'admin') refreshAdmin();
};
events.onerror = () => document.body.classList.add('offline');
