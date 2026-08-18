const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const path = require('path');
const { Parser: CsvParser } = require('json2csv');

const { query } = require('./lib/db');
const { seedExercisesIfEmpty } = require('./lib/seedExercises');
const { generateProgram } = require('./lib/periodization');
const { computeAdjustment } = require('./lib/adjustment');
const { epley1RM } = require('./lib/loadCalc');
const { buildAnalytics, compareWeeks } = require('./lib/analytics');
const { getSportExercises, getSubstitutions } = require('./lib/exercises');
const { createAccount, findAccountByEmail, verifyPassword, createSessionToken, deleteToken, requireAuth } = require('./lib/auth');

const app = express();
app.use(cors());
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public')));

const PORT = process.env.PORT || 3000;

let seedPromise = null;
app.use((req, res, next) => {
  if (!seedPromise) seedPromise = seedExercisesIfEmpty().catch(err => console.error('Seed error:', err));
  seedPromise.then(() => next()).catch(next);
});

function asyncRoute(handler) {
  return (req, res) => handler(req, res).catch(err => {
    console.error(err);
    res.status(500).json({ error: 'Internal server error.' });
  });
}

// Ownership check: joins through profile so we can confirm the requesting account
// actually owns this program before returning or mutating it.
async function getOwnedProgramRow(programId, accountId) {
  const { rows } = await query(
    `SELECT p.* FROM tpb_programs p
     JOIN tpb_profiles pr ON pr.id = p.profile_id
     WHERE p.id = $1 AND pr.account_id = $2`,
    [programId, accountId]
  );
  if (!rows.length) return null;
  const row = rows[0];
  return { ...row, program_data: row.program_data };
}

async function getOwnedProfileRow(profileId, accountId) {
  const { rows } = await query('SELECT * FROM tpb_profiles WHERE id = $1 AND account_id = $2', [profileId, accountId]);
  return rows[0] || null;
}

// ---------------- Auth ----------------

app.post('/api/auth/signup', asyncRoute(async (req, res) => {
  const { email, password, name } = req.body;
  if (!email || !password || password.length < 8) {
    return res.status(400).json({ error: 'email and a password of at least 8 characters are required.' });
  }
  if (await findAccountByEmail(email)) {
    return res.status(409).json({ error: 'An account with that email already exists.' });
  }
  const account = await createAccount(email, password, name);
  const token = await createSessionToken(account.id);
  res.json({ token, account });
}));

app.post('/api/auth/login', asyncRoute(async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'email and password are required.' });
  const account = await findAccountByEmail(email);
  if (!account || !verifyPassword(password, account.password_salt, account.password_hash)) {
    return res.status(401).json({ error: 'Invalid email or password.' });
  }
  const token = await createSessionToken(account.id);
  res.json({ token, account: { id: account.id, email: account.email, name: account.name } });
}));

app.post('/api/auth/logout', requireAuth, asyncRoute(async (req, res) => {
  await deleteToken(req.authToken);
  res.json({ loggedOut: true });
}));

app.get('/api/auth/me', requireAuth, (req, res) => {
  res.json({ account: req.account });
});

app.use('/api/profile', requireAuth);
app.use('/api/generate-program', requireAuth);
app.use('/api/program', requireAuth);
app.use('/api/programs', requireAuth);
app.use('/api/log-session', requireAuth);
app.use('/api/sessions', requireAuth);
app.use('/api/session', requireAuth);
app.use('/api/progress', requireAuth);
app.use('/api/compare', requireAuth);
app.use('/api/export', requireAuth);
app.use('/api/exercise-maxes', requireAuth);

// ---------------- Exercise Maxes (per-exercise tested weight, not inferred from SBD) ----------------

async function getExerciseMaxesMap(accountId) {
  const { rows } = await query('SELECT exercise_name, estimated_1rm FROM tpb_exercise_maxes WHERE account_id = $1', [accountId]);
  const map = {};
  for (const row of rows) map[row.exercise_name] = row.estimated_1rm;
  return map;
}

app.get('/api/exercise-maxes', asyncRoute(async (req, res) => {
  const { rows } = await query(
    'SELECT exercise_name, weight, reps, estimated_1rm, source, updated_at FROM tpb_exercise_maxes WHERE account_id = $1 ORDER BY exercise_name',
    [req.account.id]
  );
  res.json(rows);
}));

app.post('/api/exercise-maxes', asyncRoute(async (req, res) => {
  const { exercise_name, weight, reps } = req.body;
  const w = Number(weight);
  const r = Number(reps) || 1;
  if (!exercise_name || !Number.isFinite(w) || w <= 0) {
    return res.status(400).json({ error: 'exercise_name and a positive weight are required.' });
  }
  const estimated_1rm = epley1RM(w, r);
  const { rows } = await query(
    `INSERT INTO tpb_exercise_maxes (account_id, exercise_name, weight, reps, estimated_1rm, source, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, now())
     ON CONFLICT (account_id, exercise_name) DO UPDATE SET weight = $3, reps = $4, estimated_1rm = $5, source = $6, updated_at = now()
     RETURNING exercise_name, weight, reps, estimated_1rm, source, updated_at`,
    [req.account.id, exercise_name, w, r, estimated_1rm, req.body.source === 'tested' ? 'tested' : 'manual']
  );
  res.json(rows[0]);
}));

app.delete('/api/exercise-maxes/:exercise_name', asyncRoute(async (req, res) => {
  await query('DELETE FROM tpb_exercise_maxes WHERE account_id = $1 AND exercise_name = $2', [req.account.id, req.params.exercise_name]);
  res.json({ deleted: true });
}));

// ---------------- Profile Management ----------------

const GOAL_TYPES = ['powerlifting', 'powerbuilding', 'power_combo'];
const WEAK_POINTS = ['none', 'quads', 'posterior_chain', 'chest', 'back', 'shoulders_triceps', 'arms'];

app.post('/api/profile', asyncRoute(async (req, res) => {
  const {
    name, sport, experience_level, periodization_type, timeline_weeks, squat_max, bench_max, deadlift_max,
    equipment, injuries, goals, workout_duration_min, workout_duration_max,
    goal_type, pl_emphasis, training_days_per_week, weak_point_focus
  } = req.body;

  if (!name || !sport || !experience_level || !periodization_type || !timeline_weeks) {
    return res.status(400).json({ error: 'name, sport, experience_level, periodization_type, and timeline_weeks are required.' });
  }
  const weeks = Number(timeline_weeks);
  if (!Number.isFinite(weeks) || weeks < 4 || weeks > 52) {
    return res.status(400).json({ error: 'timeline_weeks must be between 4 and 52.' });
  }
  const durationMin = Number(workout_duration_min) || 45;
  const durationMax = Number(workout_duration_max) || 75;
  if (durationMin < 20 || durationMax > 180 || durationMin > durationMax) {
    return res.status(400).json({ error: 'workout_duration_min/max must be between 20 and 180 minutes, with min <= max.' });
  }
  const goalType = goal_type || 'powerlifting';
  if (!GOAL_TYPES.includes(goalType)) {
    return res.status(400).json({ error: `goal_type must be one of: ${GOAL_TYPES.join(', ')}.` });
  }
  const plEmphasis = pl_emphasis === undefined || pl_emphasis === null || pl_emphasis === '' ? 100 : Number(pl_emphasis);
  if (!Number.isFinite(plEmphasis) || plEmphasis < 0 || plEmphasis > 100) {
    return res.status(400).json({ error: 'pl_emphasis must be a number between 0 and 100.' });
  }
  const daysPerWeek = Number(training_days_per_week) || 4;
  if (![3, 4, 5].includes(daysPerWeek)) {
    return res.status(400).json({ error: 'training_days_per_week must be 3, 4, or 5.' });
  }
  const weakPoint = weak_point_focus && weak_point_focus !== 'none' ? weak_point_focus : null;
  if (weakPoint && !WEAK_POINTS.includes(weakPoint)) {
    return res.status(400).json({ error: `weak_point_focus must be one of: ${WEAK_POINTS.join(', ')}.` });
  }

  const userResult = await query('INSERT INTO tpb_users (name) VALUES ($1) RETURNING id', [name]);
  const user_id = userResult.rows[0].id;

  const profileResult = await query(
    `INSERT INTO tpb_profiles
      (user_id, account_id, sport, experience_level, periodization_type, timeline_weeks, squat_max, bench_max, deadlift_max, equipment, injuries, goals, workout_duration_min, workout_duration_max,
       goal_type, pl_emphasis, training_days_per_week, weak_point_focus)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
     RETURNING id`,
    [user_id, req.account.id, sport, experience_level, periodization_type, weeks, squat_max || null, bench_max || null, deadlift_max || null,
      equipment ? JSON.stringify(equipment) : null, injuries || null, goals || null, durationMin, durationMax,
      goalType, plEmphasis, daysPerWeek, weakPoint]
  );

  res.json({ user_id, profile_id: profileResult.rows[0].id });
}));

app.get('/api/profile/:id', asyncRoute(async (req, res) => {
  const row = await getOwnedProfileRow(req.params.id, req.account.id);
  if (!row) return res.status(404).json({ error: 'Profile not found.' });
  res.json({ ...row, equipment: row.equipment ? JSON.parse(row.equipment) : [] });
}));

// ---------------- Program Generation ----------------

app.post('/api/generate-program', asyncRoute(async (req, res) => {
  const { profile_id } = req.body;
  const profile = await getOwnedProfileRow(profile_id, req.account.id);
  if (!profile) return res.status(404).json({ error: 'Profile not found.' });
  profile.exercise_maxes = await getExerciseMaxesMap(req.account.id);

  const programData = generateProgram(profile);
  const insertResult = await query(
    'INSERT INTO tpb_programs (profile_id, program_data) VALUES ($1, $2) RETURNING id',
    [profile_id, JSON.stringify(programData)]
  );
  const program_id = insertResult.rows[0].id;

  res.json({ program_id, profile_id: Number(profile_id), program: { program_id, profile_id: Number(profile_id), ...programData } });
}));

app.get('/api/program/:program_id', asyncRoute(async (req, res) => {
  const program = await getOwnedProgramRow(req.params.program_id, req.account.id);
  if (!program) return res.status(404).json({ error: 'Program not found.' });
  res.json({ program_id: program.id, profile_id: program.profile_id, status: program.status, created_at: program.created_at, ...program.program_data });
}));

app.put('/api/program/:program_id', asyncRoute(async (req, res) => {
  const existing = await getOwnedProgramRow(req.params.program_id, req.account.id);
  if (!existing) return res.status(404).json({ error: 'Program not found.' });
  const updated = { ...existing.program_data, ...req.body };
  await query('UPDATE tpb_programs SET program_data = $1 WHERE id = $2', [JSON.stringify(updated), req.params.program_id]);
  res.json({ program_id: Number(req.params.program_id), ...updated });
}));

app.delete('/api/program/:program_id', asyncRoute(async (req, res) => {
  const existing = await getOwnedProgramRow(req.params.program_id, req.account.id);
  if (!existing) return res.status(404).json({ error: 'Program not found.' });
  await query('DELETE FROM tpb_programs WHERE id = $1', [req.params.program_id]);
  res.json({ deleted: true });
}));

app.get('/api/programs', asyncRoute(async (req, res) => {
  const { rows } = await query(`
    SELECT p.id AS program_id, p.status, p.created_at, pr.sport, pr.timeline_weeks, pr.periodization_type, u.name AS athlete_name
    FROM tpb_programs p
    JOIN tpb_profiles pr ON pr.id = p.profile_id
    JOIN tpb_users u ON u.id = pr.user_id
    WHERE pr.account_id = $1
    ORDER BY p.created_at DESC
  `, [req.account.id]);
  res.json(rows);
}));

app.post('/api/program/:program_id/archive', asyncRoute(async (req, res) => {
  const existing = await getOwnedProgramRow(req.params.program_id, req.account.id);
  if (!existing) return res.status(404).json({ error: 'Program not found.' });
  await query("UPDATE tpb_programs SET status = 'archived' WHERE id = $1", [req.params.program_id]);
  res.json({ archived: true });
}));

app.post('/api/program/:program_id/clone', asyncRoute(async (req, res) => {
  const existing = await getOwnedProgramRow(req.params.program_id, req.account.id);
  if (!existing) return res.status(404).json({ error: 'Program not found.' });
  const profile = await getOwnedProfileRow(existing.profile_id, req.account.id);
  profile.exercise_maxes = await getExerciseMaxesMap(req.account.id);
  const programData = generateProgram(profile);
  const insertResult = await query('INSERT INTO tpb_programs (profile_id, program_data) VALUES ($1, $2) RETURNING id', [existing.profile_id, JSON.stringify(programData)]);
  res.json({ program_id: insertResult.rows[0].id, profile_id: existing.profile_id, ...programData });
}));

// ---------------- Session Logging & Auto-Adjustment ----------------

app.post('/api/log-session', asyncRoute(async (req, res) => {
  const {
    program_id, week_number, day_name, exercise,
    prescribed_sets, prescribed_reps, prescribed_rpe, prescribed_weight,
    actual_sets, actual_reps, actual_rpe, actual_weight,
    notes, completed, movement_changed, record_as_max
  } = req.body;

  if (!program_id || !week_number || !day_name || !exercise) {
    return res.status(400).json({ error: 'program_id, week_number, day_name, and exercise are required.' });
  }
  if (!(await getOwnedProgramRow(program_id, req.account.id))) {
    return res.status(404).json({ error: 'Program not found.' });
  }

  const insertResult = await query(
    `INSERT INTO tpb_sessions
      (program_id, week_number, day_name, exercise, prescribed_sets, prescribed_reps, prescribed_rpe, prescribed_weight,
       actual_sets, actual_reps, actual_rpe, actual_weight, notes, completed)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
     RETURNING id`,
    [program_id, week_number, day_name, exercise,
      prescribed_sets ?? null, prescribed_reps ?? null, prescribed_rpe ?? null, prescribed_weight ?? null,
      actual_sets ?? null, actual_reps ?? null, actual_rpe ?? null, actual_weight ?? null,
      notes || null, completed === false ? false : true]
  );
  const session_id = insertResult.rows[0].id;

  const { rows: recentSessions } = await query(
    `SELECT * FROM tpb_sessions WHERE program_id = $1 AND exercise = $2 AND id != $3 ORDER BY logged_at DESC LIMIT 5`,
    [program_id, exercise, session_id]
  );

  const adjustment = computeAdjustment({
    actualWeight: actual_weight,
    actualRpe: actual_rpe,
    prescribedWeight: prescribed_weight,
    recentSessions,
    movementChanged: !!movement_changed
  });

  if (record_as_max && actual_weight && actual_reps) {
    const estimated_1rm = epley1RM(Number(actual_weight), Number(actual_reps));
    await query(
      `INSERT INTO tpb_exercise_maxes (account_id, exercise_name, weight, reps, estimated_1rm, source, updated_at)
       VALUES ($1, $2, $3, $4, $5, 'tested', now())
       ON CONFLICT (account_id, exercise_name) DO UPDATE SET weight = $3, reps = $4, estimated_1rm = $5, source = 'tested', updated_at = now()`,
      [req.account.id, exercise, actual_weight, actual_reps, estimated_1rm]
    );
  }

  res.json({
    session_id,
    next_weight_recommendation: adjustment.next_weight,
    adjustment_action: adjustment.action,
    adjustment_explanation: adjustment.explanation,
    deload_recommended: !!adjustment.deload_recommended
  });
}));

app.get('/api/sessions/:program_id', asyncRoute(async (req, res) => {
  if (!(await getOwnedProgramRow(req.params.program_id, req.account.id))) {
    return res.status(404).json({ error: 'Program not found.' });
  }
  const { rows } = await query('SELECT * FROM tpb_sessions WHERE program_id = $1 ORDER BY week_number ASC, logged_at ASC', [req.params.program_id]);
  res.json(rows);
}));

app.put('/api/session/:session_id', asyncRoute(async (req, res) => {
  const { rows } = await query(
    `SELECT s.* FROM tpb_sessions s
     JOIN tpb_programs p ON p.id = s.program_id
     JOIN tpb_profiles pr ON pr.id = p.profile_id
     WHERE s.id = $1 AND pr.account_id = $2`,
    [req.params.session_id, req.account.id]
  );
  if (!rows.length) return res.status(404).json({ error: 'Session not found.' });
  const existing = rows[0];
  const fields = ['actual_sets', 'actual_reps', 'actual_rpe', 'actual_weight', 'notes', 'completed'];
  const merged = { ...existing };
  for (const f of fields) if (req.body[f] !== undefined) merged[f] = req.body[f];
  await query(
    `UPDATE tpb_sessions SET actual_sets=$1, actual_reps=$2, actual_rpe=$3, actual_weight=$4, notes=$5, completed=$6 WHERE id=$7`,
    [merged.actual_sets, merged.actual_reps, merged.actual_rpe, merged.actual_weight, merged.notes, merged.completed, req.params.session_id]
  );
  res.json({ updated: true });
}));

// ---------------- Progress Analytics ----------------

app.get('/api/progress/:program_id', asyncRoute(async (req, res) => {
  if (!(await getOwnedProgramRow(req.params.program_id, req.account.id))) {
    return res.status(404).json({ error: 'Program not found.' });
  }
  const { rows } = await query('SELECT * FROM tpb_sessions WHERE program_id = $1', [req.params.program_id]);
  res.json(buildAnalytics(rows));
}));

app.get('/api/compare/:program_id', asyncRoute(async (req, res) => {
  const { week1, week2 } = req.query;
  if (!week1 || !week2) return res.status(400).json({ error: 'week1 and week2 query params are required.' });
  if (!(await getOwnedProgramRow(req.params.program_id, req.account.id))) {
    return res.status(404).json({ error: 'Program not found.' });
  }
  const { rows } = await query('SELECT * FROM tpb_sessions WHERE program_id = $1', [req.params.program_id]);
  res.json(compareWeeks(rows, week1, week2));
}));

app.get('/api/export/:program_id', asyncRoute(async (req, res) => {
  if (!(await getOwnedProgramRow(req.params.program_id, req.account.id))) {
    return res.status(404).json({ error: 'Program not found.' });
  }
  const format = (req.query.format || 'csv').toLowerCase();
  const { rows } = await query('SELECT * FROM tpb_sessions WHERE program_id = $1 ORDER BY week_number, logged_at', [req.params.program_id]);

  if (format === 'json') {
    return res.json(rows);
  }

  const fields = ['id', 'week_number', 'day_name', 'exercise', 'prescribed_sets', 'prescribed_reps', 'prescribed_rpe', 'prescribed_weight',
    'actual_sets', 'actual_reps', 'actual_rpe', 'actual_weight', 'notes', 'completed', 'logged_at'];
  const parser = new CsvParser({ fields });
  const csv = parser.parse(rows);
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename="program_${req.params.program_id}_sessions.csv"`);
  res.send(csv);
}));

// ---------------- Exercise Library ----------------

app.get('/api/exercises', asyncRoute(async (req, res) => {
  const sport = req.query.sport;
  if (sport) {
    const { rows } = await query('SELECT * FROM tpb_sport_exercises WHERE sport = $1', [sport]);
    return res.json(rows.length ? rows : Object.entries(getSportExercises(sport)).flatMap(([category, names]) => names.map(n => ({ sport, exercise_name: n, category }))));
  }
  const { rows } = await query('SELECT * FROM tpb_sport_exercises');
  res.json(rows);
}));

app.get('/api/exercise-variations/:exercise', (req, res) => {
  res.json({ exercise: req.params.exercise, substitutions: getSubstitutions(req.params.exercise) });
});

// SPA fallback
app.get(/^\/(?!api).*/, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Training Program Builder running at http://localhost:${PORT}`);
  });
}

module.exports = app;
