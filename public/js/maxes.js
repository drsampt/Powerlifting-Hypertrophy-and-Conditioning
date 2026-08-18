async function renderMaxes(main) {
  main.innerHTML = `
    <h1>Exercise Maxes</h1>
    <p class="subtitle">Only Back Squat, Bench Press, and Deadlift use the 1RMs from your profile. Every other exercise — front squat, close-grip bench, accessories, sport-specific lifts — needs its own tested max here before the program builder will prescribe a real weight for it. Anything untested stays RPE-based (you pick the load to hit the target reps/RPE) until you log one.</p>
    <div class="card" style="max-width:520px">
      <h3 style="margin-top:0">Add / Update a Max</h3>
      <form id="max-form">
        <div class="field"><label>Exercise Name</label><input name="exercise_name" list="max-exercise-list" required placeholder="e.g. Front Squat" /><datalist id="max-exercise-list"></datalist></div>
        <div class="grid cols-2">
          <div class="field"><label>Weight (lbs)</label><input name="weight" type="number" min="0" step="0.5" required /></div>
          <div class="field"><label>Reps</label><input name="reps" type="number" min="1" max="15" value="1" required /></div>
        </div>
        <div class="help">Enter a true 1RM (reps=1) or any rep-max (e.g. a 10RM) — it's converted to an estimated 1RM automatically.</div>
        <button type="submit" class="btn">Save Max</button>
      </form>
    </div>
    <div id="maxes-list">Loading...</div>
  `;

  try {
    const exercises = await Api.getExercises();
    const names = Array.from(new Set(exercises.map(e => e.exercise_name))).sort();
    document.getElementById('max-exercise-list').innerHTML = names.map(n => `<option value="${n}"></option>`).join('');
  } catch (e) {}

  document.getElementById('max-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const data = Object.fromEntries(fd.entries());
    data.weight = Number(data.weight);
    data.reps = Number(data.reps);
    try {
      await Api.setExerciseMax(data);
      toast('Max saved.');
      e.target.reset();
      e.target.querySelector('[name=reps]').value = 1;
      loadMaxesList();
    } catch (err) {
      toast(`Error: ${err.message}`);
    }
  });

  loadMaxesList();
}

async function loadMaxesList() {
  const el = document.getElementById('maxes-list');
  if (!el) return;
  let maxes = [];
  try {
    maxes = await Api.getExerciseMaxes();
  } catch (e) {
    el.innerHTML = `<div class="empty">Could not load exercise maxes.</div>`;
    return;
  }
  if (!maxes.length) {
    el.innerHTML = `<div class="empty">No exercise maxes recorded yet.</div>`;
    return;
  }
  el.innerHTML = `<div class="table-wrap"><table>
    <thead><tr><th>Exercise</th><th>Logged</th><th>Est. 1RM</th><th>Source</th><th>Updated</th><th></th></tr></thead>
    <tbody>${maxes.map(m => `
      <tr>
        <td>${m.exercise_name}</td>
        <td>${m.weight} × ${m.reps}</td>
        <td>${m.estimated_1rm} lbs</td>
        <td><span class="badge ${m.source === 'tested' ? 'green' : 'blue'}">${m.source}</span></td>
        <td>${new Date(m.updated_at).toLocaleDateString()}</td>
        <td><button class="btn danger" data-delete-max="${m.exercise_name}">Delete</button></td>
      </tr>
    `).join('')}</tbody>
  </table></div>`;
  el.querySelectorAll('[data-delete-max]').forEach(btn => btn.addEventListener('click', async () => {
    await Api.deleteExerciseMax(btn.dataset.deleteMax);
    toast('Deleted.');
    loadMaxesList();
  }));
}
