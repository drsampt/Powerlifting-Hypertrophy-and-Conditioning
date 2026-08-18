const State = {
  view: 'setup',
  program: null,
  profile: null,
  programsList: []
};

function toast(msg, ms = 3500) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), ms);
}

function setView(view) {
  State.view = view;
  render();
}

async function loadProgramsList() {
  try {
    State.programsList = await Api.listPrograms();
  } catch (e) {
    State.programsList = [];
  }
}

function renderNav() {
  const topnav = document.getElementById('topnav');
  const items = [
    ['setup', 'New Program'],
    ['program', 'Program'],
    ['logger', 'Log Session'],
    ['maxes', 'Exercise Maxes'],
    ['analytics', 'Analytics'],
    ['manage', 'Manage']
  ];
  topnav.innerHTML = items.map(([v, label]) =>
    `<button data-view="${v}" class="${State.view === v ? 'active' : ''}">${label}</button>`
  ).join('');
  topnav.querySelectorAll('button').forEach(btn => {
    btn.addEventListener('click', () => setView(btn.dataset.view));
  });

  const sidebar = document.getElementById('sidebar');
  sidebar.innerHTML = `
    <h3>Navigate</h3>
    ${items.map(([v, label]) => `<div class="item ${State.view === v ? 'active' : ''}" data-view="${v}">${label}</div>`).join('')}
    <h3>Current Program</h3>
    <div class="item" style="cursor:default;color:var(--text-dim)">
      ${State.program ? `${State.program.sport} · ${State.program.total_weeks}wk · #${State.program.program_id}` : 'None loaded'}
    </div>
    <h3>Account</h3>
    <div class="item" style="cursor:default;color:var(--text-dim)">${AuthState.account ? (AuthState.account.name || AuthState.account.email) : ''}</div>
    <div class="item" id="logout-item">Log Out</div>
  `;
  sidebar.querySelectorAll('.item[data-view]').forEach(el => {
    el.addEventListener('click', () => { setView(el.dataset.view); closeSidebar(); });
  });
  const logoutItem = document.getElementById('logout-item');
  if (logoutItem) logoutItem.addEventListener('click', () => { logOut(); closeSidebar(); });
}

function render() {
  renderNav();
  const main = document.getElementById('main');
  main.innerHTML = '';
  if (State.view === 'setup') return renderSetup(main);
  if (State.view === 'program') return renderProgram(main);
  if (State.view === 'logger') return renderLogger(main);
  if (State.view === 'maxes') return renderMaxes(main);
  if (State.view === 'analytics') return renderAnalytics(main);
  if (State.view === 'manage') return renderManage(main);
}

// ---------------- Setup / Profile Form ----------------

function renderSetup(main) {
  main.innerHTML = `
    <h1>Build a New Program</h1>
    <p class="subtitle">Set up an athlete profile and generate a fully periodized training program.</p>
    <div class="card" style="max-width:640px">
      <form id="setup-form">
        <div class="grid cols-2">
          <div class="field">
            <label>Athlete Name</label>
            <input name="name" required placeholder="e.g. Dr. Sam" />
          </div>
          <div class="field">
            <label>Sport</label>
            <select name="sport" required>
              <option value="powerlifting">Powerlifting</option>
              <option value="strongman">Strongman</option>
              <option value="weightlifting">Olympic Weightlifting</option>
              <option value="crossfit">CrossFit</option>
              <option value="bodybuilding">Bodybuilding</option>
              <option value="general">General Strength</option>
            </select>
          </div>
        </div>
        <div class="grid cols-2">
          <div class="field">
            <label>Experience Level</label>
            <select name="experience_level" required>
              <option value="novice">Novice</option>
              <option value="intermediate">Intermediate</option>
              <option value="advanced" selected>Advanced</option>
              <option value="elite">Elite</option>
            </select>
          </div>
          <div class="field">
            <label>Periodization Model</label>
            <select name="periodization_type" required>
              <option value="linear">Linear</option>
              <option value="block">Block</option>
              <option value="conjugate">Conjugate/Concurrent</option>
              <option value="dup">Daily Undulating (DUP)</option>
            </select>
          </div>
        </div>
        <div class="field">
          <label>Timeline (weeks)</label>
          <input name="timeline_weeks" type="number" min="4" max="52" value="32" required />
          <div class="help">4-52 weeks. 32 weeks maps to the canonical 4-phase linear cycle with a peak/test week.</div>
        </div>
        <div class="grid cols-2">
          <div class="field">
            <label>Training Goal</label>
            <select name="goal_type" id="goal-type-select" required>
              <option value="powerlifting" selected>Powerlifting (compete on the platform)</option>
              <option value="powerbuilding">Powerbuilding (strength + physique)</option>
              <option value="power_combo">Power Combo (custom blend — set the slider below)</option>
            </select>
          </div>
          <div class="field">
            <label>Training Days / Week</label>
            <select name="training_days_per_week" required>
              <option value="3">3 (full-body each session)</option>
              <option value="4" selected>4 (Upper/Lower A/B split)</option>
              <option value="5">5 (Upper/Lower A/B + hypertrophy day)</option>
            </select>
          </div>
        </div>
        <div class="field">
          <label>Powerlifting <span id="pl-emphasis-value">100</span>% ↔ Bodybuilding <span id="bb-emphasis-value">0</span>%</label>
          <input name="pl_emphasis" id="pl-emphasis-slider" type="range" min="0" max="100" value="100" />
          <div class="help">How much accessory volume, rep ranges, and taper specificity should lean toward pure strength vs. muscle-building. Locked to 100 for Powerlifting and 30 for Powerbuilding; freely adjustable for Power Combo.</div>
        </div>
        <div class="field">
          <label>Weak Point to Prioritize</label>
          <select name="weak_point_focus">
            <option value="none" selected>None / balanced</option>
            <option value="quads">Quads</option>
            <option value="posterior_chain">Posterior Chain (hamstrings/glutes/back)</option>
            <option value="chest">Chest</option>
            <option value="back">Back</option>
            <option value="shoulders_triceps">Shoulders/Triceps</option>
            <option value="arms">Arms</option>
          </select>
          <div class="help">Accessory selection gets biased toward this muscle group first.</div>
        </div>
        <div class="grid cols-2">
          <div class="field">
            <label>Min Session Length (min)</label>
            <input name="workout_duration_min" type="number" min="20" max="180" value="45" required />
          </div>
          <div class="field">
            <label>Max Session Length (min)</label>
            <input name="workout_duration_max" type="number" min="20" max="180" value="75" required />
          </div>
          <div class="help" style="grid-column: 1 / -1">How long you actually want each session to run. Exercise count is fit to this window — heavy main-lift days naturally get fewer total exercises than lighter accessory days at the same duration.</div>
        </div>
        <div class="grid cols-3">
          <div class="field">
            <label>Squat 1RM (lbs)</label>
            <input name="squat_max" type="number" min="0" placeholder="370" />
          </div>
          <div class="field">
            <label>Bench 1RM (lbs)</label>
            <input name="bench_max" type="number" min="0" placeholder="280" />
          </div>
          <div class="field">
            <label>Deadlift 1RM (lbs)</label>
            <input name="deadlift_max" type="number" min="0" placeholder="435" />
          </div>
        </div>
        <div class="field">
          <label>Equipment Available</label>
          <input name="equipment" placeholder="barbell, rack, bands, chains, dumbbells..." />
        </div>
        <div class="field">
          <label>Injuries / Limitations</label>
          <textarea name="injuries" rows="2" placeholder="Optional"></textarea>
        </div>
        <div class="field">
          <label>Goals</label>
          <textarea name="goals" rows="2" placeholder="e.g. Peak for meet, hit a 500 squat"></textarea>
        </div>
        <button type="submit" class="btn">Generate Program</button>
      </form>
    </div>
  `;

  const goalSelect = document.getElementById('goal-type-select');
  const plSlider = document.getElementById('pl-emphasis-slider');
  const plLabel = document.getElementById('pl-emphasis-value');
  const bbLabel = document.getElementById('bb-emphasis-value');
  const GOAL_LOCKED_EMPHASIS = { powerlifting: 100, powerbuilding: 30 };
  function syncEmphasisLabels() {
    plLabel.textContent = plSlider.value;
    bbLabel.textContent = 100 - plSlider.value;
  }
  function syncEmphasisToGoal() {
    const locked = GOAL_LOCKED_EMPHASIS[goalSelect.value];
    if (locked !== undefined) {
      plSlider.value = locked;
      plSlider.disabled = true;
    } else {
      plSlider.disabled = false;
    }
    syncEmphasisLabels();
  }
  goalSelect.addEventListener('change', syncEmphasisToGoal);
  plSlider.addEventListener('input', syncEmphasisLabels);
  syncEmphasisToGoal();

  document.getElementById('setup-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const data = Object.fromEntries(fd.entries());
    data.timeline_weeks = Number(data.timeline_weeks);
    data.workout_duration_min = Number(data.workout_duration_min);
    data.workout_duration_max = Number(data.workout_duration_max);
    data.squat_max = data.squat_max ? Number(data.squat_max) : null;
    data.bench_max = data.bench_max ? Number(data.bench_max) : null;
    data.deadlift_max = data.deadlift_max ? Number(data.deadlift_max) : null;
    data.equipment = data.equipment ? data.equipment.split(',').map(s => s.trim()).filter(Boolean) : [];
    data.pl_emphasis = Number(plSlider.value);
    data.training_days_per_week = Number(data.training_days_per_week);

    if (data.workout_duration_min > data.workout_duration_max) {
      return toast('Min session length cannot be greater than max.');
    }

    const submitBtn = e.target.querySelector('button[type=submit]');
    submitBtn.disabled = true;
    submitBtn.textContent = 'Generating...';
    try {
      const { profile_id } = await Api.createProfile(data);
      State.profile = await Api.getProfile(profile_id);
      const genResult = await Api.generateProgram(profile_id);
      State.program = genResult.program;
      await loadProgramsList();
      toast('Program generated! Starting at Week 1.');
      setView('program');
    } catch (err) {
      toast(`Error: ${err.message}`);
      submitBtn.disabled = false;
      submitBtn.textContent = 'Generate Program';
    }
  });
}

// ---------------- Manage ----------------

async function renderManage(main) {
  main.innerHTML = `<h1>Program Management</h1><p class="subtitle">All generated programs.</p><div id="manage-list">Loading...</div>`;
  await loadProgramsList();
  const list = document.getElementById('manage-list');
  if (!State.programsList.length) {
    list.innerHTML = `<div class="empty">No programs yet. Create one from "New Program".</div>`;
    return;
  }
  list.innerHTML = `<div class="table-wrap"><table>
    <thead><tr><th>ID</th><th>Athlete</th><th>Sport</th><th>Model</th><th>Weeks</th><th>Status</th><th>Created</th><th></th></tr></thead>
    <tbody>
      ${State.programsList.map(p => `
        <tr>
          <td>#${p.program_id}</td>
          <td>${p.athlete_name}</td>
          <td>${p.sport}</td>
          <td>${p.periodization_type}</td>
          <td>${p.timeline_weeks}</td>
          <td><span class="badge ${p.status === 'active' ? 'green' : 'amber'}">${p.status}</span></td>
          <td>${new Date(p.created_at).toLocaleDateString()}</td>
          <td style="white-space:nowrap">
            <button class="btn secondary" data-open="${p.program_id}">Open</button>
            <button class="btn secondary" data-clone="${p.program_id}">Clone</button>
            <button class="btn danger" data-delete="${p.program_id}">Delete</button>
          </td>
        </tr>
      `).join('')}
    </tbody>
  </table></div>`;

  list.querySelectorAll('[data-open]').forEach(btn => btn.addEventListener('click', async () => {
    State.program = await Api.getProgram(btn.dataset.open);
    setView('program');
  }));
  list.querySelectorAll('[data-clone]').forEach(btn => btn.addEventListener('click', async () => {
    State.program = await Api.cloneProgram(btn.dataset.clone);
    toast('Program cloned.');
    setView('program');
  }));
  list.querySelectorAll('[data-delete]').forEach(btn => btn.addEventListener('click', async () => {
    if (!confirm('Delete this program and all logged sessions? This cannot be undone.')) return;
    await Api.deleteProgram(btn.dataset.delete);
    toast('Program deleted.');
    renderManage(main);
  }));
}

function closeSidebar() {
  document.getElementById('sidebar').classList.remove('open');
  document.getElementById('sidebar-backdrop').classList.remove('open');
}

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('hamburger').addEventListener('click', () => {
    document.getElementById('sidebar').classList.toggle('open');
    document.getElementById('sidebar-backdrop').classList.toggle('open');
  });
  document.getElementById('sidebar-backdrop').addEventListener('click', closeSidebar);
  initAuth();
});
