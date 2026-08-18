const { query } = require('./db');
const { flattenLibrary } = require('./exercises');

async function seedExercisesIfEmpty() {
  const { rows } = await query('SELECT COUNT(*)::int AS c FROM tpb_sport_exercises');
  if (rows[0].c > 0) return;

  const sports = ['powerlifting', 'strongman', 'weightlifting', 'crossfit', 'bodybuilding', 'general'];
  let all = [];
  for (const s of sports) all = all.concat(flattenLibrary(s));

  const values = [];
  const params = [];
  all.forEach((r, i) => {
    const base = i * 5;
    values.push(`($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5})`);
    params.push(r.sport, r.exercise_name, r.movement_pattern, r.category, r.category === 'primary' ? 'advanced' : 'intermediate');
  });

  await query(
    `INSERT INTO tpb_sport_exercises (sport, exercise_name, movement_pattern, equipment_needed, difficulty_level) VALUES ${values.join(', ')}`,
    params
  );
}

module.exports = { seedExercisesIfEmpty };
