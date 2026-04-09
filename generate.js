/**
 * Guru Dashboard Generator — runs in GitHub Actions
 * Pulls live data from ClickUp and regenerates HTML files
 */

const https = require('https');
const fs = require('fs');

const API_KEY = process.env.CLICKUP_API_KEY;
const TEAM_ID = '90132046592';
const SPRINT_LIST_ID = '901326678466'; // Sprint 36 (4/6/26 - 4/12/26)
const BACKLOG_LIST_ID = '901316779458';

function api(path) {
  return new Promise((resolve) => {
    const options = { hostname: 'api.clickup.com', path, headers: { 'Authorization': API_KEY } };
    https.get(options, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch(e) { resolve({ tasks: [] }); } });
    });
  });
}

async function main() {
  console.log('Fetching data from ClickUp...');

  const [sprintData, backlogData, completedData, customerData] = await Promise.all([
    api(`/api/v2/list/${SPRINT_LIST_ID}/task?include_closed=true&subtasks=true`),
    api(`/api/v2/list/${BACKLOG_LIST_ID}/task?subtasks=true`),
    api(`/api/v2/team/${TEAM_ID}/task?statuses[]=done&statuses[]=closed&statuses[]=complete&include_closed=true&subtasks=true&space_ids[]=901313723446&space_ids[]=90138640835&space_ids[]=901313714795`),
    api(`/api/v2/team/${TEAM_ID}/task?statuses[]=paid&statuses[]=active&include_closed=true&space_ids[]=901312744437`)
  ]);

  const tasks = sprintData.tasks || [];
  const backlog = backlogData.tasks || [];
  const allCompleted = completedData.tasks || [];
  const customers = customerData.tasks || [];

  const done = tasks.filter(t => ['done','complete','closed'].includes(t.status.status.toLowerCase()));
  const inProg = tasks.filter(t => t.status.status.toLowerCase() === 'in progress' || t.status.status.toLowerCase() === 'in build');
  const todo = tasks.filter(t => t.status.status.toLowerCase() === 'to do');
  const overdue = tasks.filter(t => {
    const due = t.due_date ? parseInt(t.due_date) : null;
    return due && due < Date.now() && !['done','complete','closed'].includes(t.status.status.toLowerCase());
  });

  const total = tasks.length;
  const pct = total > 0 ? Math.round((done.length / total) * 100) : 0;

  // Per person
  const people = {};
  tasks.forEach(t => {
    const assignees = t.assignees.length > 0 ? t.assignees : [{ username: 'Unassigned' }];
    const status = t.status.status.toLowerCase();
    assignees.forEach(a => {
      const name = a.username || 'Unassigned';
      if (!people[name]) people[name] = { done: [], inProgress: [], todo: [] };
      if (['done','complete','closed'].includes(status)) people[name].done.push(t.name);
      else if (status === 'in progress' || status === 'in build') people[name].inProgress.push(t.name);
      else people[name].todo.push(t.name);
    });
  });

  const leaderboard = Object.entries(people)
    .filter(([n]) => n !== 'Unassigned')
    .sort((a, b) => b[1].done.length - a[1].done.length);

  // Funnel data
  const caiaWebinar = tasks.find(t => t.name.includes('Webinar Funnel') && t.name.includes('ClickFunnel'));
  let caiaWebDone = 33, caiaWebTotal = 43;
  if (caiaWebinar && caiaWebinar.checklists) {
    let cd = 0, ct = 0;
    caiaWebinar.checklists.forEach(cl => { (cl.items || []).forEach(item => { ct++; if (item.resolved) cd++; }); });
    if (ct > 0) { caiaWebDone = cd; caiaWebTotal = ct; }
  }
  const caiaWebPct = Math.round((caiaWebDone / caiaWebTotal) * 100);

  const now = new Date();
  const dateStr = now.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  const timeStr = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });

  console.log(`Sprint: ${total} tasks, ${done.length} done (${pct}%)`);
  console.log(`Team: ${leaderboard.map(([n,d]) => n + ':' + d.done.length).join(', ')}`);

  // ==========================================
  // GENERATE PERFORMANCE DASHBOARD HTML
  // ==========================================

  function medalFor(i) { return i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : '🏅'; }
  function streakFor(name, count) {
    if (count >= 10) return `<span class="streak">🔥 LEGENDARY</span>`;
    if (count >= 5) return `<span class="streak">🔥 On fire</span>`;
    return '';
  }

  // Build leaderboard rows
  let leaderRows = '';
  leaderboard.forEach(([name, data], i) => {
    const total = data.done.length + data.inProgress.length + data.todo.length;
    const barWidth = leaderboard[0] ? Math.round((total / (leaderboard[0][1].done.length + leaderboard[0][1].inProgress.length + leaderboard[0][1].todo.length)) * 100) : 0;
    const topWins = data.done.slice(0, 3).map(w => w.substring(0, 50)).join(', ');
    leaderRows += `
    <div class="leader">
      <div class="medal">${medalFor(i)}</div>
      <div class="info">
        <div class="name">${name} ${streakFor(name, data.done.length)}</div>
        <div class="wins">${topWins || 'Working on active tasks'}</div>
        <div class="bar"><div class="bar-fill" style="width:${barWidth}%"></div></div>
      </div>
      <div class="count">${data.done.length}</div>
    </div>`;
  });

  // Build funnel data for chart
  const funnelLabels = ['CAIA Webinar', 'Apr 3', 'Apr 7', 'Apr 10', 'Audos HT', 'Audos Turbo'];
  const caiaApr3Done = tasks.find(t => t.name.includes('3rd April') && ['done','complete','closed'].includes(t.status.status.toLowerCase()));
  const funnelData = [caiaWebPct, caiaApr3Done ? 100 : 0, 0, 0, 0, 0];

  const dashboardHTML = `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<title>Guru Performance Dashboard</title>
<script src="https://cdn.jsdelivr.net/npm/chart.js@3.9.1/dist/chart.min.js"><` + `/script>
<style>
  @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700;900&display=swap');
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: 'Inter', system-ui, sans-serif; background: #0f0f23; color: #fff; padding: 30px; }
  .title { text-align: center; margin-bottom: 30px; }
  .title h1 { font-size: 32px; font-weight: 900; letter-spacing: 3px; background: linear-gradient(90deg, #5f55ee, #30a46c); -webkit-background-clip: text; -webkit-text-fill-color: transparent; }
  .title p { color: #666; font-size: 13px; margin-top: 8px; }
  .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; max-width: 1200px; margin: 0 auto; }
  .full { grid-column: span 2; }
  .card { background: linear-gradient(145deg, #161630, #1a1a3e); border-radius: 20px; padding: 24px; border: 1px solid rgba(95,85,238,0.15); box-shadow: 0 8px 32px rgba(0,0,0,0.3); }
  .card h2 { font-size: 14px; color: #5f55ee; text-transform: uppercase; letter-spacing: 2px; margin-bottom: 16px; }
  .counters { display: grid; grid-template-columns: 1fr 1fr 1fr 1fr; gap: 14px; grid-column: span 2; }
  .counter { background: linear-gradient(145deg, #161630, #1a1a3e); border-radius: 16px; padding: 20px; text-align: center; border: 1px solid rgba(95,85,238,0.1); position: relative; overflow: hidden; }
  .counter::after { content: ''; position: absolute; top: 0; left: 0; right: 0; height: 3px; }
  .counter.green::after { background: linear-gradient(90deg, #30a46c, #40d88a); }
  .counter.purple::after { background: linear-gradient(90deg, #5f55ee, #8b7fff); }
  .counter.yellow::after { background: linear-gradient(90deg, #f8ae00, #ffc94d); }
  .counter.red::after { background: linear-gradient(90deg, #d33d44, #ff6b6b); }
  .counter .icon { font-size: 24px; margin-bottom: 6px; }
  .counter .num { font-size: 42px; font-weight: 900; }
  .counter.green .num { color: #30a46c; }
  .counter.purple .num { color: #5f55ee; }
  .counter.yellow .num { color: #f8ae00; }
  .counter.red .num { color: #d33d44; }
  .counter .label { font-size: 11px; color: #666; text-transform: uppercase; letter-spacing: 1px; margin-top: 4px; }
  .chart-container { position: relative; max-height: 220px; margin: 10px auto; }
  .chart-container canvas { max-height: 220px; }
  .leader { display: flex; align-items: center; padding: 12px 0; border-bottom: 1px solid rgba(95,85,238,0.1); }
  .leader:last-child { border: none; }
  .leader .medal { font-size: 28px; width: 44px; text-align: center; }
  .leader .info { flex: 1; margin-left: 12px; }
  .leader .name { font-weight: 700; font-size: 15px; }
  .leader .wins { font-size: 11px; color: #666; margin-top: 3px; }
  .leader .count { font-size: 22px; font-weight: 900; color: #30a46c; min-width: 44px; text-align: right; }
  .leader .bar { height: 6px; background: #1a1a3e; border-radius: 3px; margin-top: 6px; overflow: hidden; }
  .leader .bar-fill { height: 100%; border-radius: 3px; background: linear-gradient(90deg, #30a46c, #5f55ee); }
  .streak { display: inline-block; padding: 2px 8px; background: rgba(248,174,0,0.15); border: 1px solid rgba(248,174,0,0.3); border-radius: 12px; font-size: 10px; color: #f8ae00; margin-left: 6px; }
  .funnel { margin: 10px 0; }
  .funnel-header { display: flex; justify-content: space-between; margin-bottom: 6px; }
  .funnel-name { font-size: 13px; font-weight: 600; }
  .funnel-pct { font-size: 13px; font-weight: 800; }
  .funnel-bar { height: 16px; background: #1a1a3e; border-radius: 8px; overflow: hidden; }
  .funnel-fill { height: 100%; border-radius: 8px; }
  .funnel-fill.green { background: linear-gradient(90deg, #30a46c, #40d88a); }
  .funnel-fill.purple { background: linear-gradient(90deg, #5f55ee, #8b7fff); }
  .funnel-fill.yellow { background: linear-gradient(90deg, #f8ae00, #ffc94d); }
  .funnel-fill.gray { background: linear-gradient(90deg, #333, #444); }
  .funnel-tag { display: inline-block; padding: 2px 8px; border-radius: 6px; font-size: 10px; font-weight: 600; margin-top: 4px; }
  .funnel-tag.live { background: rgba(48,164,108,0.15); color: #30a46c; }
  .funnel-tag.building { background: rgba(95,85,238,0.15); color: #5f55ee; }
  .funnel-tag.planned { background: rgba(248,174,0,0.15); color: #f8ae00; }
  .okr { display: flex; align-items: center; padding: 10px 0; border-bottom: 1px solid rgba(95,85,238,0.1); }
  .okr:last-child { border: none; }
  .okr .icon { font-size: 22px; width: 34px; }
  .okr .info { flex: 1; margin-left: 8px; }
  .okr .label { font-size: 14px; font-weight: 600; }
  .okr .sub { font-size: 11px; color: #666; }
  .okr .progress-mini { height: 4px; background: #1a1a3e; border-radius: 2px; margin-top: 5px; overflow: hidden; }
  .okr .progress-fill { height: 100%; border-radius: 2px; background: linear-gradient(90deg, #5f55ee, #30a46c); }
  .revenue-box { background: linear-gradient(135deg, rgba(95,85,238,0.1), rgba(48,164,108,0.1)); border: 1px solid rgba(95,85,238,0.2); border-radius: 12px; padding: 16px; text-align: center; margin-top: 12px; }
  .revenue-amount { font-size: 36px; font-weight: 900; background: linear-gradient(90deg, #5f55ee, #30a46c); -webkit-background-clip: text; -webkit-text-fill-color: transparent; }
  .revenue-sub { font-size: 12px; color: #666; margin-top: 4px; }
  .banner { grid-column: span 2; background: linear-gradient(135deg, #5f55ee, #30a46c); border-radius: 20px; padding: 24px 30px; text-align: center; }
  .banner h3 { font-size: 22px; }
  .banner p { font-size: 14px; opacity: 0.9; margin-top: 8px; }
  .footer { grid-column: span 2; text-align: center; padding: 20px; color: #444; font-size: 11px; }
</style>
</head>
<body>
<div class="title">
  <h1>GURU LABS PERFORMANCE DASHBOARD</h1>
  <p>Real-time project pulse • Sprint 35 • Last refreshed: ${dateStr} ${timeStr}</p>
</div>
<div class="grid">
  <div class="counters">
    <div class="counter green"><div class="icon">✅</div><div class="num">${done.length}</div><div class="label">Completed</div></div>
    <div class="counter purple"><div class="icon">⚡</div><div class="num">${inProg.length}</div><div class="label">In Progress</div></div>
    <div class="counter yellow"><div class="icon">📋</div><div class="num">${todo.length}</div><div class="label">To Do</div></div>
    <div class="counter red"><div class="icon">🚨</div><div class="num">${overdue.length}</div><div class="label">Overdue</div></div>
  </div>
  <div class="card"><h2>📈 Sprint Completion</h2><div class="chart-container"><canvas id="completionChart"></canvas></div><p style="text-align:center;color:#888;font-size:13px;margin-top:8px;">${done.length} of ${total} tasks completed</p></div>
  <div class="card"><h2>📊 Task Distribution</h2><div class="chart-container"><canvas id="distChart"></canvas></div></div>
  <div class="card"><h2>🏆 Team Leaderboard</h2>${leaderRows}</div>
  <div class="card"><h2>📊 Workload</h2><div class="chart-container"><canvas id="workloadChart"></canvas></div></div>
  <div class="card"><h2>🌐 Funnel Pipeline</h2>
    <div class="funnel"><div class="funnel-header"><span class="funnel-name">CAIA Webinar</span><span class="funnel-pct" style="color:#5f55ee">${caiaWebPct}%</span></div><div class="funnel-bar"><div class="funnel-fill purple" style="width:${caiaWebPct}%"></div></div><span class="funnel-tag building">${caiaWebDone}/${caiaWebTotal} items</span></div>
    <div class="funnel"><div class="funnel-header"><span class="funnel-name">CAIA Apr 3</span><span class="funnel-pct" style="color:#30a46c">${caiaApr3Done ? '100%' : '0%'}</span></div><div class="funnel-bar"><div class="funnel-fill green" style="width:${caiaApr3Done ? 100 : 0}%"></div></div>${caiaApr3Done ? '<span class="funnel-tag live">LAUNCHED ✅</span>' : '<span class="funnel-tag planned">In progress</span>'}</div>
  </div>
  <div class="card"><h2>📊 Funnel Mix</h2><div class="chart-container"><canvas id="funnelChart"></canvas></div></div>
  <div class="card"><h2>🎯 OKR & Revenue</h2>
    <div class="okr"><div class="icon">✅</div><div class="info"><div class="label">5 People/Week</div><div class="sub">March — ACHIEVED</div><div class="progress-mini"><div class="progress-fill" style="width:100%"></div></div></div></div>
    <div class="okr"><div class="icon">🟡</div><div class="info"><div class="label">10 People/Week</div><div class="sub">April target</div><div class="progress-mini"><div class="progress-fill" style="width:50%"></div></div></div></div>
    <div class="okr"><div class="icon">🟡</div><div class="info"><div class="label">$100K/Month Revenue</div><div class="sub">34 sales needed</div><div class="progress-mini"><div class="progress-fill" style="width:15%"></div></div></div></div>
    <div class="revenue-box"><div class="revenue-amount">$100K</div><div class="revenue-sub">April target • ${customers.length || 91} customers tracked</div></div>
  </div>
  <div class="card"><h2>📉 Velocity</h2><div class="chart-container"><canvas id="velocityChart"></canvas></div></div>
  <div class="card"><h2>🏥 Health</h2><div class="chart-container"><canvas id="healthChart"></canvas></div></div>
  <div class="banner"><h3>🏆 ${done.length} tasks completed this sprint!</h3><p>Top performer: ${leaderboard[0]?.[0] || 'TBD'} with ${leaderboard[0]?.[1].done.length || 0} tasks! Keep pushing! 🚀</p></div>
  <div class="footer">Auto-updated every hour • Guru Labs Performance Dashboard</div>
</div>
<script>
new Chart(document.getElementById('completionChart'),{type:'doughnut',data:{labels:['Completed','Remaining'],datasets:[{data:[${done.length},${total-done.length}],backgroundColor:['#30a46c','#1a1a3e'],borderWidth:0,cutout:'75%'}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false}},animation:{animateRotate:true,duration:1500}},plugins:[{id:'ct',afterDraw(c){const{ctx,width:w,height:h}=c;ctx.save();ctx.font='bold 36px Inter';ctx.fillStyle='#5f55ee';ctx.textAlign='center';ctx.fillText('${pct}%',w/2,h/2+5);ctx.font='12px Inter';ctx.fillStyle='#888';ctx.fillText('complete',w/2,h/2+22);ctx.restore()}}]});
new Chart(document.getElementById('distChart'),{type:'pie',data:{labels:['Done (${done.length})','In Progress (${inProg.length})','To Do (${todo.length})'],datasets:[{data:[${done.length},${inProg.length},${todo.length}],backgroundColor:['#30a46c','#5f55ee','#555'],borderWidth:2,borderColor:'#0f0f23'}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{position:'bottom',labels:{color:'#888',font:{size:11}}}}}});
new Chart(document.getElementById('workloadChart'),{type:'bar',data:{labels:[${leaderboard.map(([n])=>`'${n.split(' ')[0]}'`).join(',')}],datasets:[{label:'Done',data:[${leaderboard.map(([,d])=>d.done.length).join(',')}],backgroundColor:'#30a46c'},{label:'Active',data:[${leaderboard.map(([,d])=>d.inProgress.length).join(',')}],backgroundColor:'#5f55ee'},{label:'To Do',data:[${leaderboard.map(([,d])=>d.todo.length).join(',')}],backgroundColor:'#555'}]},options:{indexAxis:'y',responsive:true,maintainAspectRatio:false,scales:{x:{stacked:true,grid:{color:'#1a1a3e'},ticks:{color:'#666'}},y:{stacked:true,grid:{display:false},ticks:{color:'#ccc',font:{size:11}}}},plugins:{legend:{position:'bottom',labels:{color:'#888',font:{size:11}}}}}});
new Chart(document.getElementById('funnelChart'),{type:'doughnut',data:{labels:['Launched','Building','Planned'],datasets:[{data:[${caiaApr3Done?1:0},2,3],backgroundColor:['#30a46c','#5f55ee','#f8ae00'],borderWidth:2,borderColor:'#0f0f23'}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{position:'bottom',labels:{color:'#888'}}}}});
new Chart(document.getElementById('velocityChart'),{type:'line',data:{labels:['Sprint 33','Sprint 34','Sprint 35'],datasets:[{label:'Completed',data:[20,28,${done.length}],borderColor:'#30a46c',backgroundColor:'rgba(48,164,108,0.1)',fill:true,tension:.3,pointRadius:8,pointBackgroundColor:'#30a46c',borderWidth:3},{label:'Scope',data:[35,45,${total}],borderColor:'#5f55ee',backgroundColor:'rgba(95,85,238,0.05)',fill:true,tension:.3,pointRadius:5,borderDash:[5,5],borderWidth:2}]},options:{responsive:true,maintainAspectRatio:false,scales:{x:{grid:{color:'#1a1a3e'},ticks:{color:'#888'}},y:{beginAtZero:true,grid:{color:'#1a1a3e'},ticks:{color:'#888'}}},plugins:{legend:{position:'bottom',labels:{color:'#888'}}}}});
new Chart(document.getElementById('healthChart'),{type:'radar',data:{labels:['Sprint','Team','Funnels','OKRs','Backlog'],datasets:[{data:[${pct},60,${caiaWebPct},50,20],backgroundColor:'rgba(95,85,238,0.2)',borderColor:'#5f55ee',borderWidth:2,pointBackgroundColor:['#f8ae00','#f8ae00','#30a46c','#f8ae00','#d33d44'],pointRadius:6}]},options:{responsive:true,maintainAspectRatio:false,scales:{r:{beginAtZero:true,max:100,grid:{color:'#1a1a3e'},angleLines:{color:'#1a1a3e'},pointLabels:{color:'#ccc',font:{size:12}},ticks:{display:false}}},plugins:{legend:{display:false}}}});
<` + `/script>
</body>
</html>`;

  fs.writeFileSync('whiteboard-mockup.html', dashboardHTML);
  console.log('Dashboard HTML updated');

  // ==========================================
  // GENERATE WALL OF FAME HTML
  // ==========================================

  const mvp = leaderboard[0];
  const mvpName = mvp ? mvp[0] : 'TBD';
  const mvpDone = mvp ? mvp[1].done.length : 0;
  const mvpWins = mvp ? mvp[1].done.slice(0, 7).map(w => `        <div class="win">\u2705 ${w.substring(0, 60)}</div>`).join('\n') : '';

  let teamCards = '';
  leaderboard.slice(1).forEach(([name, data], i) => {
    const wins = data.done.map(w => `          <div class="win-item">\u2705 ${w.substring(0, 55)}</div>`).join('\n');
    const inPr = data.inProgress.length;
    const motivMsg = data.done.length >= 5 ? `\ud83d\udcaa ${data.done.length} tasks done! Strong output.` :
      data.done.length >= 1 ? `\ud83d\udc4d ${data.done.length} task${data.done.length>1?'s':''} done! Every win counts.` :
      `\ud83c\udfaf ${inPr} active tasks \u2014 progress is progress!`;

    teamCards += `
      <div class="team-card">
        <div class="rank">
          <span class="medal">${medalFor(i + 1)}</span>
          <span class="name">${name}</span>
          <span class="count-badge">${data.done.length} done</span>
        </div>
        <div class="wins-list">
${wins}
${inPr > 0 ? `          <div class="win-item">\ud83d\udd35 ${inPr} tasks in progress</div>` : ''}
        </div>
        <div class="motivational">${motivMsg}</div>
      </div>`;
  });

  let streakRows = '';
  leaderboard.forEach(([name, data]) => {
    if (data.done.length >= 10) {
      streakRows += `
      <div class="streak-row">
        <div class="streak-fire">\ud83d\udd25\ud83d\udd25\ud83d\udd25</div>
        <div class="streak-info"><div class="streak-name">${name}</div><div class="streak-detail">${data.done.length}+ tasks completed this sprint</div></div>
        <div class="streak-badge">LEGENDARY</div>
      </div>`;
    } else if (data.done.length >= 5) {
      streakRows += `
      <div class="streak-row">
        <div class="streak-fire">\ud83d\udd25\ud83d\udd25</div>
        <div class="streak-info"><div class="streak-name">${name}</div><div class="streak-detail">${data.done.length} tasks completed</div></div>
        <div class="streak-badge">ON FIRE</div>
      </div>`;
    } else if (data.done.length >= 1) {
      streakRows += `
      <div class="streak-row">
        <div class="streak-fire">\ud83d\udd25</div>
        <div class="streak-info"><div class="streak-name">${name}</div><div class="streak-detail">Contributing to Sprint 35</div></div>
        <div class="streak-badge">ACTIVE</div>
      </div>`;
    }
  });

  let shoutouts = '';
  leaderboard.forEach(([name, data]) => {
    if (data.done.length >= 5) {
      const topWins = data.done.slice(0, 3).map(w => w.substring(0, 40)).join(', ');
      shoutouts += `
      <div class="shoutout ${data.done.length >= 10 ? 'gold' : 'purple'}">
        <span class="emoji">${data.done.length >= 10 ? '\ud83c\udfc6' : '\ud83d\ude80'}</span>
        <div class="text"><strong>${name}</strong> completed ${data.done.length} tasks this sprint including: ${topWins}. Outstanding work!</div>
        <div class="attribution">\u2014 Sprint 35 Recognition</div>
      </div>`;
    }
  });

  const wallOfFameHTML = `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<title>Guru Labs \u2014 Team Wall of Fame</title>
<style>
  @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700;900&display=swap');
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: 'Inter', system-ui, sans-serif; background: #0a0a1a; color: #fff; min-height: 100vh; }
  body::before { content: ''; position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: radial-gradient(ellipse at 20% 50%, rgba(95,85,238,0.08) 0%, transparent 50%), radial-gradient(ellipse at 80% 20%, rgba(48,164,108,0.06) 0%, transparent 50%); z-index: 0; }
  .container { max-width: 900px; margin: 0 auto; padding: 40px 24px; position: relative; z-index: 1; }
  .header { text-align: center; margin-bottom: 50px; }
  .header .trophy { font-size: 60px; display: block; margin-bottom: 12px; animation: bounce 2s infinite; }
  @keyframes bounce { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-10px); } }
  .header h1 { font-size: 36px; font-weight: 900; letter-spacing: 3px; background: linear-gradient(135deg, #f8ae00, #ff6b6b, #5f55ee, #30a46c); -webkit-background-clip: text; -webkit-text-fill-color: transparent; background-size: 300% 300%; animation: gradient 4s ease infinite; }
  @keyframes gradient { 0% { background-position: 0% 50%; } 50% { background-position: 100% 50%; } 100% { background-position: 0% 50%; } }
  .header p { color: #666; font-size: 14px; margin-top: 8px; }
  .sprint-banner { background: linear-gradient(135deg, #5f55ee, #30a46c); border-radius: 20px; padding: 30px; text-align: center; margin-bottom: 40px; position: relative; overflow: hidden; }
  .sprint-banner::before { content: ''; position: absolute; top: -50%; left: -50%; width: 200%; height: 200%; background: radial-gradient(circle, rgba(255,255,255,0.08) 0%, transparent 60%); animation: pulse 3s ease-in-out infinite; }
  @keyframes pulse { 0%, 100% { transform: scale(1); } 50% { transform: scale(1.05); } }
  .sprint-banner .big-num { font-size: 72px; font-weight: 900; position: relative; }
  .sprint-banner .sub { font-size: 18px; opacity: 0.9; position: relative; }
  .sprint-banner .detail { font-size: 14px; opacity: 0.7; position: relative; margin-top: 8px; }
  .section-title { font-size: 14px; color: #5f55ee; text-transform: uppercase; letter-spacing: 2px; font-weight: 700; margin-bottom: 16px; }
  .mvp-card { background: linear-gradient(145deg, #1a1a3e, #161630); border: 2px solid rgba(248,174,0,0.3); border-radius: 20px; padding: 30px; text-align: center; margin-bottom: 40px; position: relative; overflow: hidden; }
  .mvp-card::before { content: ''; position: absolute; top: 0; left: 0; right: 0; height: 3px; background: linear-gradient(90deg, #f8ae00, #ff6b6b, #f8ae00); }
  .mvp-crown { font-size: 50px; display: block; margin-bottom: 8px; animation: bounce 2.5s infinite; }
  .mvp-name { font-size: 28px; font-weight: 900; color: #f8ae00; }
  .mvp-title { font-size: 14px; color: #888; margin-top: 4px; text-transform: uppercase; letter-spacing: 2px; }
  .mvp-stats { display: flex; justify-content: center; gap: 30px; margin-top: 20px; }
  .mvp-stat .num { font-size: 32px; font-weight: 900; color: #30a46c; }
  .mvp-stat .label { font-size: 11px; color: #666; text-transform: uppercase; }
  .mvp-wins { margin-top: 20px; text-align: left; }
  .mvp-wins .win { padding: 6px 0; font-size: 13px; color: #ccc; border-bottom: 1px solid rgba(95,85,238,0.1); }
  .mvp-quote { margin-top: 16px; padding: 12px 16px; background: rgba(248,174,0,0.08); border-left: 3px solid #f8ae00; border-radius: 0 8px 8px 0; font-style: italic; color: #ccc; font-size: 13px; }
  .team-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 40px; }
  .team-card { background: linear-gradient(145deg, #161630, #1a1a3e); border-radius: 16px; padding: 20px; border: 1px solid rgba(95,85,238,0.1); transition: transform 0.2s; }
  .team-card:hover { transform: translateY(-3px); border-color: rgba(95,85,238,0.3); }
  .team-card .rank { display: flex; align-items: center; gap: 10px; margin-bottom: 12px; }
  .team-card .medal { font-size: 28px; }
  .team-card .name { font-size: 18px; font-weight: 700; }
  .team-card .count-badge { background: #30a46c; color: #fff; font-size: 12px; font-weight: 700; padding: 2px 10px; border-radius: 12px; margin-left: auto; }
  .team-card .win-item { font-size: 12px; color: #999; padding: 3px 0; }
  .team-card .motivational { margin-top: 10px; padding: 8px 12px; background: rgba(48,164,108,0.08); border-radius: 8px; font-size: 12px; color: #30a46c; }
  .streak-row { display: flex; align-items: center; padding: 12px 16px; background: linear-gradient(145deg, #161630, #1a1a3e); border-radius: 12px; margin-bottom: 8px; border: 1px solid rgba(248,174,0,0.1); }
  .streak-fire { font-size: 24px; margin-right: 12px; }
  .streak-info { flex: 1; }
  .streak-name { font-weight: 700; font-size: 14px; }
  .streak-detail { font-size: 12px; color: #888; }
  .streak-badge { background: rgba(248,174,0,0.15); color: #f8ae00; font-size: 11px; font-weight: 700; padding: 4px 12px; border-radius: 12px; border: 1px solid rgba(248,174,0,0.2); }
  .shoutout { background: linear-gradient(145deg, #161630, #1a1a3e); border-radius: 16px; padding: 20px; margin-bottom: 12px; border-left: 3px solid; }
  .shoutout.purple { border-left-color: #5f55ee; }
  .shoutout.gold { border-left-color: #f8ae00; }
  .shoutout .emoji { font-size: 28px; float: left; margin-right: 12px; }
  .shoutout .text { font-size: 14px; color: #ccc; line-height: 1.6; }
  .shoutout .attribution { font-size: 11px; color: #555; margin-top: 8px; }
  .goal-card { display: flex; align-items: center; padding: 16px; background: linear-gradient(145deg, #161630, #1a1a3e); border-radius: 12px; margin-bottom: 10px; border: 1px solid rgba(95,85,238,0.1); }
  .goal-icon { font-size: 30px; margin-right: 14px; }
  .goal-info { flex: 1; }
  .goal-name { font-size: 15px; font-weight: 700; }
  .goal-detail { font-size: 12px; color: #666; margin-top: 2px; }
  .goal-progress { width: 80px; height: 6px; background: #1a1a3e; border-radius: 3px; overflow: hidden; }
  .goal-fill { height: 100%; border-radius: 3px; background: linear-gradient(90deg, #5f55ee, #30a46c); }
  .footer-banner { background: linear-gradient(135deg, rgba(95,85,238,0.15), rgba(48,164,108,0.15)); border: 1px solid rgba(95,85,238,0.2); border-radius: 20px; padding: 30px; text-align: center; margin-bottom: 20px; }
  .footer-banner .gif { font-size: 48px; margin-bottom: 10px; display: block; }
  .footer-banner h3 { font-size: 20px; font-weight: 700; }
  .footer-banner p { color: #888; font-size: 14px; margin-top: 8px; }
  .footer { text-align: center; color: #333; font-size: 11px; padding: 20px; }
  .confetti { position: fixed; top: -10px; z-index: 100; pointer-events: none; }
  @keyframes fall { to { transform: translateY(105vh) rotate(720deg); } }
</style>
</head>
<body>
<div class="container">
  <div class="header">
    <span class="trophy">\ud83c\udfc6</span>
    <h1>TEAM WALL OF FAME</h1>
    <p>Celebrating wins, big and small \u2022 Guru Labs \u2022 Sprint 35 \u2022 Updated: ${dateStr}</p>
  </div>

  <div class="sprint-banner">
    <div class="big-num">${done.length}</div>
    <div class="sub">tasks completed this sprint!</div>
    <div class="detail">${total} total \u2022 ${pct}% completion \u2022 The team is building something incredible! \ud83d\ude80</div>
  </div>

  <div class="section-title">\ud83d\udc51 Sprint MVP</div>
  <div class="mvp-card">
    <span class="mvp-crown">\ud83d\udc51</span>
    <div class="mvp-name">${mvpName}</div>
    <div class="mvp-title">Sprint 35 Most Valuable Player</div>
    <div class="mvp-stats">
      <div class="mvp-stat"><div class="num">${mvpDone}</div><div class="label">Tasks Done</div></div>
      <div class="mvp-stat"><div class="num">#1</div><div class="label">Rank</div></div>
    </div>
    <div class="mvp-wins">
${mvpWins}
    </div>
    <div class="mvp-quote">"${mvpName} delivered ${mvpDone} tasks this sprint \u2014 absolutely crushing it!" \ud83d\udd25</div>
  </div>

  <div class="section-title">\ud83c\udfc5 Full Team Leaderboard</div>
  <div class="team-grid">
${teamCards}
  </div>

  <div class="section-title">\ud83d\udd25 Active Streaks</div>
${streakRows}

  <div style="margin-top:40px;">
    <div class="section-title">\ud83d\udcac Shoutouts</div>
${shoutouts}
    <div class="shoutout gold">
      <span class="emoji">\ud83d\udc51</span>
      <div class="text"><strong>Matt</strong> \u2014 stepped into CEO mode, defined the company vision, brought on new engineers, hit the first OKR, and is building the path to $100K/month. The team is executing YOUR vision. It's working.</div>
      <div class="attribution">\u2014 From the team</div>
    </div>
  </div>

  <div style="margin-top:40px;">
    <div class="section-title">\ud83d\ude80 Next Milestones to Unlock</div>
    <div class="goal-card"><div class="goal-icon">\ud83d\udcb0</div><div class="goal-info"><div class="goal-name">$100K Revenue Month</div><div class="goal-detail">34 sales at $3K \u2022 April 2026</div></div><div class="goal-progress"><div class="goal-fill" style="width:15%"></div></div></div>
    <div class="goal-card"><div class="goal-icon">\ud83d\udcaf</div><div class="goal-info"><div class="goal-name">100 Paying Customers</div><div class="goal-detail">Currently ${customers.length || 91} \u2014 almost there!</div></div><div class="goal-progress"><div class="goal-fill" style="width:${Math.min((customers.length || 91), 100)}%"></div></div></div>
    <div class="goal-card"><div class="goal-icon">\ud83c\udfaf</div><div class="goal-info"><div class="goal-name">10 People/Week in Cohorts</div><div class="goal-detail">Double from current 5/week</div></div><div class="goal-progress"><div class="goal-fill" style="width:50%"></div></div></div>
  </div>

  <div class="footer-banner" style="margin-top:40px;">
    <span class="gif">\ud83d\udcaa\ud83d\ude80\u2728</span>
    <h3>We're building something incredible.</h3>
    <p>From 0 to ${customers.length || 91} customers. From idea to live webinars. From chaos to organized execution.<br>Every task completed is a step toward $100K/month and beyond. Keep going, team! \ud83c\udfc6</p>
  </div>

  <div class="footer">Guru Labs Team Wall of Fame \u2022 Auto-updated hourly \u2022 ${dateStr}</div>
</div>
<script>
function createConfetti(){const c=['#5f55ee','#30a46c','#f8ae00','#ff6b6b','#fff'];for(let i=0;i<50;i++){const e=document.createElement('div');e.className='confetti';e.style.left=Math.random()*100+'vw';e.style.width=Math.random()*8+4+'px';e.style.height=e.style.width;e.style.background=c[Math.floor(Math.random()*c.length)];e.style.borderRadius=Math.random()>.5?'50%':'0';e.style.animation='fall '+((Math.random()*3+2))+'s linear forwards';e.style.animationDelay=Math.random()*2+'s';e.style.opacity=Math.random()*.7+.3;document.body.appendChild(e);setTimeout(()=>e.remove(),5000)}}
createConfetti();setInterval(createConfetti,30000);
<` + `/script>
</body>
</html>`;

  fs.writeFileSync('wall-of-fame.html', wallOfFameHTML);
  console.log('Wall of Fame HTML updated');

  console.log('Done! Both files ready for GitHub Pages.');
}

main().catch(console.error);
