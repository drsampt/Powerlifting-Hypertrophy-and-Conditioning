const WorkoutState = { week: null, dayName: null, done: {}, results: {} };

function startWorkout(program, week, dayName) {
  WorkoutState.week = week;
  WorkoutState.dayName = dayName;
  WorkoutState.done = {};
  WorkoutState.results = {};
  setView('workout');
}

function findWorkoutDay(p, week, dayName) {
  for (const phase of p.phases) {
    const wk = phase.workouts.find(w => w.week === Number(week));
    if (wk) {
      const day = wk.days.find(d => d.day_name === dayName);
      if (day) return day;
    }
  }
  return null;
}

function renderWorkout(main) {
  const p = State.program;
  if (!p || !WorkoutState.dayName) {
    main.innerHTML = `<div class="empty">No workout in progress. Open "Program" → Week View and hit "Start Workout" on a day.</div>`;
    return;
  }
  const day = findWorkoutDay(p, WorkoutState.week, WorkoutState.dayName);
  if (!day) {
    main.innerHTML = `<div class="empty">Couldn't find that day in the current program.</div>`;
    return;
  }
  const total = day.exercises.length;
  const doneCount = Object.keys(WorkoutState.done).filter(k => WorkoutState.done[k]).length;

  main.innerHTML = `
    <h1>${day.day_name} — ${day.workout_type}</h1>
    <p class="subtitle">Week ${WorkoutState.week} · ${doneCount}/${total} exercises logged${day.estimated_minutes ? ` · ~${day.estimated_minutes} min` : ''}</p>
    <div id="workout-cards"></div>
    <button class="btn" id="finish-workout" style="margin-top:8px">Finish Workout</button>
  `;

  const cards = document.getElementById('workout-cards');
  cards.innerHTML = day.exercises.map((ex, i) => renderExerciseCard(ex, i)).join('');

  day.exercises.forEach((ex, i) => wireExerciseCard(main, ex, i));

  document.getElementById('finish-workout').addEventListener('click', () => setView('program'));
}

function renderExerciseCard(ex, i) {
  const isDone = !!WorkoutState.done[i];
  const result = WorkoutState.results[i];
  const isStrengthLift = ex.sets != null && ex.reps != null; // excludes pure conditioning "exercises"
  const untested = isStrengthLift && ex.prescribed_weight == null;

  return `
    <div class="card" id="workout-card-${i}" style="${isDone ? 'opacity:0.7' : ''}">
      <h3 style="margin-top:0;display:flex;justify-content:space-between;align-items:center">
        <span>${isDone ? '✓ ' : ''}${ex.name}</span>
        ${ex.is_main ? '<span class="badge blue">Main Lift</span>' : ''}
      </h3>
      <p class="help" style="margin-bottom:10px">
        Prescribed: ${ex.sets}×${ex.reps ?? '-'} @ RPE ${ex.rpe ?? '-'} —
        ${ex.prescribed_weight ? `${ex.prescribed_weight} lbs (${ex.weight_percentage}%)` : 'RPE-based, pick a load to hit target reps/RPE'}
        ${ex.warmup_sets && ex.warmup_sets.length ? `<br/>Warm-up: ${ex.warmup_sets.map(w => `${w.weight}×${w.reps}`).join(' → ')} → <strong>${ex.prescribed_weight} lbs (top set)</strong>` : ''}
      </p>

      ${untested ? `
        <div class="help" style="background:var(--bg-panel-2);padding:10px;border-radius:8px;margin-bottom:12px">
          No tested max for ${ex.name} yet, so it's RPE-based. Setting one here updates future programs — it won't change today's prescription, so still log what you actually lift below.
          <form data-max-form="${i}" style="display:flex;gap:8px;margin-top:8px;align-items:flex-end">
            <div class="field" style="margin:0;flex:1"><label>Weight</label><input name="weight" type="number" min="0" step="0.5" required /></div>
            <div class="field" style="margin:0;flex:1"><label>Reps</label><input name="reps" type="number" min="1" max="15" value="1" required /></div>
            <button type="submit" class="btn secondary">Save Max</button>
          </form>
        </div>
      ` : ''}

      ${isStrengthLift ? `
        <form data-log-form="${i}">
          <div class="grid cols-2">
            <div class="field" style="margin-bottom:8px"><label>Actual Sets</label><input name="actual_sets" type="number" value="${ex.sets || ''}" /></div>
            <div class="field" style="margin-bottom:8px"><label>Actual Reps</label><input name="actual_reps" type="number" value="${ex.reps || ''}" /></div>
            <div class="field" style="margin-bottom:8px"><label>Actual Weight</label><input name="actual_weight" type="number" step="0.5" value="${ex.prescribed_weight || ''}" /></div>
            <div class="field" style="margin-bottom:8px"><label>Actual RPE</label><input name="actual_rpe" type="number" step="0.5" min="1" max="10" placeholder="e.g. 8" /></div>
          </div>
          <label style="display:flex;align-items:center;gap:8px;margin-bottom:10px"><input type="checkbox" name="record_as_max" style="width:auto" /> Record this as ${ex.name}'s tested max</label>
          <button type="submit" class="btn">${isDone ? 'Re-log' : 'Log & Next'}</button>
        </form>
      ` : `<div class="help">Conditioning — no set/rep logging needed.</div>`}

      ${result ? `
        <p style="margin:10px 0 0"><span class="badge ${badgeColorForAction(result.adjustment_action)}">${result.adjustment_action.toUpperCase()}</span> Next time: <strong>${result.next_weight_recommendation} lbs</strong></p>
      ` : ''}
    </div>
  `;
}

function wireExerciseCard(main, ex, i) {
  const maxForm = document.querySelector(`[data-max-form="${i}"]`);
  if (maxForm) {
    maxForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(maxForm);
      try {
        await Api.setExerciseMax({ exercise_name: ex.name, weight: Number(fd.get('weight')), reps: Number(fd.get('reps')) });
        toast(`Max saved for ${ex.name}.`);
      } catch (err) {
        toast(`Error: ${err.message}`);
      }
    });
  }

  const logForm = document.querySelector(`[data-log-form="${i}"]`);
  if (logForm) {
    logForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(logForm);
      const payload = {
        program_id: State.program.program_id,
        week_number: WorkoutState.week,
        day_name: WorkoutState.dayName,
        exercise: ex.name,
        prescribed_sets: ex.sets,
        prescribed_reps: ex.reps,
        prescribed_rpe: ex.rpe,
        prescribed_weight: ex.prescribed_weight,
        actual_sets: fd.get('actual_sets') ? Number(fd.get('actual_sets')) : null,
        actual_reps: fd.get('actual_reps') ? Number(fd.get('actual_reps')) : null,
        actual_weight: fd.get('actual_weight') ? Number(fd.get('actual_weight')) : null,
        actual_rpe: fd.get('actual_rpe') ? Number(fd.get('actual_rpe')) : null,
        record_as_max: fd.get('record_as_max') === 'on'
      };
      try {
        const result = await Api.logSession(payload);
        WorkoutState.done[i] = true;
        WorkoutState.results[i] = result;
        toast(`Logged ${ex.name}!`);
        renderWorkout(main);
      } catch (err) {
        toast(`Error: ${err.message}`);
      }
    });
  }
}
