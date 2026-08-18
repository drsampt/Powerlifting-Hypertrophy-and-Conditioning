const LoggerView = { selectedWeek: 1, selectedDay: null, selectedExercise: null, lastResult: null };

function findWeekData(p, week) {
  for (const phase of p.phases) {
    const wk = phase.workouts.find(w => w.week === Number(week));
    if (wk) return wk;
  }
  return null;
}

function renderLogger(main) {
  if (!State.program) {
    main.innerHTML = `<div class="empty">No program loaded. Generate or open a program first.</div>`;
    return;
  }
  const p = State.program;
  const allWeeks = p.phases.flatMap(ph => ph.workouts.map(w => w.week));
  if (!LoggerView.selectedWeek || !allWeeks.includes(LoggerView.selectedWeek)) LoggerView.selectedWeek = allWeeks[0];
  const weekData = findWeekData(p, LoggerView.selectedWeek);
  const days = weekData ? weekData.days : [];
  if (!LoggerView.selectedDay || !days.find(d => d.day_name === LoggerView.selectedDay)) {
    LoggerView.selectedDay = days[0] ? days[0].day_name : null;
  }
  const day = days.find(d => d.day_name === LoggerView.selectedDay);
  const exercises = day ? day.exercises : [];
  if (!LoggerView.selectedExercise || !exercises.find(e => e.name === LoggerView.selectedExercise)) {
    LoggerView.selectedExercise = exercises[0] ? exercises[0].name : null;
  }
  const ex = exercises.find(e => e.name === LoggerView.selectedExercise);

  main.innerHTML = `
    <h1>Log Session</h1>
    <p class="subtitle">Enter actual performance — the system will recommend your next load.</p>
    <div class="grid cols-2">
      <div>
        <div class="card">
          <div class="grid cols-3">
            <div class="field">
              <label>Week</label>
              <select id="log-week">${allWeeks.map(w => `<option value="${w}" ${w === LoggerView.selectedWeek ? 'selected' : ''}>Week ${w}</option>`).join('')}</select>
            </div>
            <div class="field">
              <label>Day</label>
              <select id="log-day">${days.map(d => `<option value="${d.day_name}" ${d.day_name === LoggerView.selectedDay ? 'selected' : ''}>${d.day_name} (${d.workout_type})</option>`).join('')}</select>
            </div>
            <div class="field">
              <label>Exercise</label>
              <select id="log-exercise">${exercises.map(e => `<option value="${e.name}" ${e.name === LoggerView.selectedExercise ? 'selected' : ''}>${e.name}</option>`).join('')}</select>
            </div>
          </div>

          ${ex ? `
            <div class="help" style="margin-bottom:14px">
              Prescribed: ${ex.sets}×${ex.reps ?? '-'} @ RPE ${ex.rpe ?? '-'} — ${ex.prescribed_weight ? ex.prescribed_weight + ' lbs' : 'RPE-based, pick a load to hit target reps/RPE'}
              ${ex.warmup_sets && ex.warmup_sets.length ? `<br/>Warm-up: ${ex.warmup_sets.map(w => `${w.weight}×${w.reps}`).join(' → ')} → <strong>${ex.prescribed_weight} lbs (top set)</strong>` : ''}
            </div>
            <form id="log-form">
              <div class="grid cols-2">
                <div class="field"><label>Actual Sets</label><input name="actual_sets" type="number" value="${ex.sets || ''}" /></div>
                <div class="field"><label>Actual Reps (per set)</label><input name="actual_reps" type="number" value="${ex.reps || ''}" /></div>
                <div class="field"><label>Actual Weight (lbs)</label><input name="actual_weight" type="number" step="0.5" value="${ex.prescribed_weight || ''}" /></div>
                <div class="field"><label>Actual RPE</label><input name="actual_rpe" type="number" step="0.5" min="1" max="10" placeholder="e.g. 8" /></div>
              </div>
              <div class="field"><label>Notes (fatigue, form, equipment, recovery)</label><textarea name="notes" rows="2"></textarea></div>
              <label style="display:flex;align-items:center;gap:8px;margin-bottom:8px"><input type="checkbox" name="movement_changed" style="width:auto" /> Movement/variation changed from what's prescribed</label>
              <label style="display:flex;align-items:center;gap:8px;margin-bottom:14px"><input type="checkbox" name="record_as_max" style="width:auto" /> Record this weight/reps as ${ex.name}'s tested max (used to compute future weights for this exercise)</label>
              <button type="submit" class="btn">Log Session</button>
            </form>
          ` : `<div class="empty">No exercises for this day.</div>`}
        </div>
        ${LoggerView.lastResult ? `
          <div class="card">
            <h3 style="margin-top:0">✓ Logged</h3>
            <p style="margin:4px 0"><span class="badge ${badgeColorForAction(LoggerView.lastResult.adjustment_action)}">${LoggerView.lastResult.adjustment_action.toUpperCase()}</span></p>
            <p style="margin:4px 0">Next session: <strong>${LoggerView.lastResult.next_weight_recommendation} lbs</strong></p>
            <p class="help">${LoggerView.lastResult.adjustment_explanation}</p>
            ${LoggerView.lastResult.deload_recommended ? `<p class="badge amber">Deload recommended</p>` : ''}
          </div>
        ` : ''}
      </div>
      <div class="card">
        <h3 style="margin-top:0">Recent Sessions</h3>
        <div id="recent-sessions" class="recent-list">Loading...</div>
      </div>
    </div>
  `;

  document.getElementById('log-week').addEventListener('change', (e) => { LoggerView.selectedWeek = Number(e.target.value); LoggerView.selectedDay = null; renderLogger(main); });
  document.getElementById('log-day').addEventListener('change', (e) => { LoggerView.selectedDay = e.target.value; LoggerView.selectedExercise = null; renderLogger(main); });
  const exSelect = document.getElementById('log-exercise');
  if (exSelect) exSelect.addEventListener('change', (e) => { LoggerView.selectedExercise = e.target.value; LoggerView.lastResult = null; renderLogger(main); });

  const form = document.getElementById('log-form');
  if (form) {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(form);
      const payload = {
        program_id: p.program_id,
        week_number: LoggerView.selectedWeek,
        day_name: LoggerView.selectedDay,
        exercise: ex.name,
        prescribed_sets: ex.sets,
        prescribed_reps: ex.reps,
        prescribed_rpe: ex.rpe,
        prescribed_weight: ex.prescribed_weight,
        actual_sets: fd.get('actual_sets') ? Number(fd.get('actual_sets')) : null,
        actual_reps: fd.get('actual_reps') ? Number(fd.get('actual_reps')) : null,
        actual_weight: fd.get('actual_weight') ? Number(fd.get('actual_weight')) : null,
        actual_rpe: fd.get('actual_rpe') ? Number(fd.get('actual_rpe')) : null,
        notes: fd.get('notes') || null,
        movement_changed: fd.get('movement_changed') === 'on',
        record_as_max: fd.get('record_as_max') === 'on'
      };
      try {
        const result = await Api.logSession(payload);
        LoggerView.lastResult = result;
        toast(payload.record_as_max ? `Logged! Max updated. Next: ${result.next_weight_recommendation} lbs` : `Logged! Next: ${result.next_weight_recommendation} lbs`);
        renderLogger(main);
      } catch (err) {
        toast(`Error: ${err.message}`);
      }
    });
  }

  loadRecentSessions(p.program_id);
}

function badgeColorForAction(action) {
  if (action === 'increase') return 'green';
  if (action === 'reduce') return 'red';
  if (action === 'reset') return 'amber';
  return 'blue';
}

async function loadRecentSessions(programId) {
  const el = document.getElementById('recent-sessions');
  if (!el) return;
  try {
    const sessions = await Api.getSessions(programId);
    const recent = sessions.slice(-5).reverse();
    if (!recent.length) {
      el.innerHTML = `<div class="empty">No sessions logged yet.</div>`;
      return;
    }
    el.innerHTML = recent.map(s => `
      <div class="row">
        <span>Wk${s.week_number} ${s.day_name} — ${s.exercise}</span>
        <span class="meta">${s.actual_weight ?? '-'}lbs @ RPE ${s.actual_rpe ?? '-'}</span>
      </div>
    `).join('');
  } catch (e) {
    el.innerHTML = `<div class="empty">Could not load sessions.</div>`;
  }
}
