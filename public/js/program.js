const ProgramView = { activeTab: 'overview', activePhase: 0, activeWeek: 1, search: '' };

function renderProgram(main) {
  if (!State.program) {
    main.innerHTML = `<div class="empty">No program loaded yet. Go to "New Program" to generate one, or "Manage" to open an existing one.</div>`;
    return;
  }
  const p = State.program;
  main.innerHTML = `
    <h1>${p.sport[0].toUpperCase() + p.sport.slice(1)} Program</h1>
    <p class="subtitle">#${p.program_id} · ${p.periodization_type} · ${p.total_weeks} weeks · Deloads: wk ${p.deload_weeks.join(', ')} · Testing wk ${p.testing_week}</p>
    <div class="tabs">
      <button data-tab="overview" class="${ProgramView.activeTab === 'overview' ? 'active' : ''}">Overview</button>
      <button data-tab="week" class="${ProgramView.activeTab === 'week' ? 'active' : ''}">Week View</button>
      <button data-tab="library" class="${ProgramView.activeTab === 'library' ? 'active' : ''}">Exercise Library</button>
    </div>
    <div id="program-tab-content"></div>
  `;
  main.querySelectorAll('.tabs button').forEach(btn => btn.addEventListener('click', () => {
    ProgramView.activeTab = btn.dataset.tab;
    renderProgram(main);
  }));

  const content = document.getElementById('program-tab-content');
  if (ProgramView.activeTab === 'overview') renderOverviewTab(content, p);
  if (ProgramView.activeTab === 'week') renderWeekTab(content, p);
  if (ProgramView.activeTab === 'library') renderLibraryTab(content, p);
}

function renderOverviewTab(content, p) {
  content.innerHTML = `
    <div class="grid cols-3">
      <div class="card stat-card"><div class="value">${p.total_weeks}</div><div class="label">Total Weeks</div></div>
      <div class="card stat-card"><div class="value">${p.phases.length}</div><div class="label">Phases</div></div>
      <div class="card stat-card"><div class="value">${p.testing_week}</div><div class="label">Testing Week</div></div>
    </div>
    <h2>Estimated Strength Gains</h2>
    <div class="grid cols-3">
      <div class="card"><h3>Squat</h3>${p.estimated_strength_gain.squat || 'N/A'}</div>
      <div class="card"><h3>Bench</h3>${p.estimated_strength_gain.bench || 'N/A'}</div>
      <div class="card"><h3>Deadlift</h3>${p.estimated_strength_gain.deadlift || 'N/A'}</div>
    </div>
    <h2>Phases</h2>
    ${p.phases.map(phase => `
      <div class="card">
        <h3 style="color:var(--text)">Phase ${phase.phase_number}: ${phase.name} (${phase.weeks} weeks)</h3>
        <p style="color:var(--text-dim);margin:4px 0">${phase.focus}</p>
        <p style="color:var(--text-dim);margin:4px 0;font-size:13px">${phase.weekly_structure}</p>
        <button class="btn secondary" data-jump-phase="${phase.phase_number - 1}" data-jump-week="${phase.workouts[0].week}">View Weeks →</button>
      </div>
    `).join('')}
  `;
  content.querySelectorAll('[data-jump-phase]').forEach(btn => btn.addEventListener('click', () => {
    ProgramView.activeTab = 'week';
    ProgramView.activePhase = Number(btn.dataset.jumpPhase);
    ProgramView.activeWeek = Number(btn.dataset.jumpWeek);
    renderProgram(document.getElementById('main'));
  }));
}

function renderWeekTab(content, p) {
  const allWeeks = p.phases.flatMap(ph => ph.workouts.map(w => ({ week: w.week, phaseIdx: ph.phase_number - 1, phaseName: ph.name })));
  const current = allWeeks.find(w => w.week === ProgramView.activeWeek) || allWeeks[0];
  const phase = p.phases[current.phaseIdx];
  const weekData = phase.workouts.find(w => w.week === current.week);

  content.innerHTML = `
    <div class="week-nav">
      <label style="margin:0">Week</label>
      <select id="week-select">
        ${allWeeks.map(w => `<option value="${w.week}" ${w.week === current.week ? 'selected' : ''}>Week ${w.week} — ${w.phaseName}${p.deload_weeks.includes(w.week) ? ' (Deload)' : ''}</option>`).join('')}
      </select>
      <button class="btn secondary" id="print-week">Print This Week</button>
    </div>
    <div id="week-days">
      ${weekData.days.map(day => `
        <div class="day-block">
          <h4><span>${day.day_name} — ${day.workout_type}</span></h4>
          ${day.exercises.map(ex => `
            <div class="exercise-row">
              <span class="name">${ex.name}</span>
              <span class="meta">
                ${ex.sets ? `${ex.sets}×${ex.reps ?? '-'}` : ''}
                ${ex.rpe ? ` @ RPE ${ex.rpe}` : ''}
                ${ex.prescribed_weight ? ` — ${ex.prescribed_weight} lbs (${ex.weight_percentage}%)` : ''}
              </span>
            </div>
            ${ex.warmup_sets && ex.warmup_sets.length ? `
              <div class="warmup-row">
                Warm-up: ${ex.warmup_sets.map(w => `${w.weight}×${w.reps}`).join(' → ')} → <strong>${ex.prescribed_weight} lbs (top set)</strong>
              </div>
            ` : ''}
          `).join('')}
        </div>
      `).join('')}
    </div>
  `;
  document.getElementById('week-select').addEventListener('change', (e) => {
    ProgramView.activeWeek = Number(e.target.value);
    renderProgram(document.getElementById('main'));
  });
  document.getElementById('print-week').addEventListener('click', () => window.print());
}

async function renderLibraryTab(content, p) {
  content.innerHTML = `
    <div class="field" style="max-width:340px"><input id="lib-search" placeholder="Search exercises..." /></div>
    <div id="lib-results">Loading...</div>
  `;
  let exercises = [];
  try {
    exercises = await Api.getExercises(p.sport);
  } catch (e) {
    exercises = [];
  }
  function draw(filter) {
    const f = (filter || '').toLowerCase();
    const filtered = exercises.filter(ex => ex.exercise_name.toLowerCase().includes(f));
    document.getElementById('lib-results').innerHTML = `<div class="table-wrap"><table>
      <thead><tr><th>Exercise</th><th>Category</th><th>Movement Pattern</th></tr></thead>
      <tbody>${filtered.map(ex => `<tr><td>${ex.exercise_name}</td><td>${ex.category}</td><td>${ex.movement_pattern || '-'}</td></tr>`).join('')}</tbody>
    </table></div>`;
  }
  draw('');
  document.getElementById('lib-search').addEventListener('input', (e) => draw(e.target.value));
}
