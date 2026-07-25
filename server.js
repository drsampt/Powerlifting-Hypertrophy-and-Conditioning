const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const path = require('path');
const { Parser: CsvParser } = require('json2csv');

const db = require('./lib/db');
const { generateProgram } = require('./lib/periodization');
const { computeAdjustment } = require('./lib/adjustment');
const { buildAnalytics, compareWeeks } = require('./lib/analytics');
const { getSportExercises, getSubstitutions } = require('./lib/exercises');

const app = express();
app.use(cors());
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public')));

const PORT = process.env.PORT || 3000;

function getProgramRow(programId) {
  const row = db.prepare('SELECT * FROM programs WHERE id = ?').get(programId);
  if (!row) return null;
  return { ...row, program_data: JSON.parse(row.program_data) };
}

function findExerciseInProgram(programData, weekNumber, dayName, exerciseName) {
  for (const phase of programData.phases) {
    const wk = phase.workouts.find(w => w.week === Number(weekNumber));
    if (!wk) continue;
    const day = wk.days.find(d => d.day_name === dayName);
    if (!day) continue;
    const ex = day.exercises.find(e => e.name === exerciseName);
    if (ex) return ex;
  }
  return null;
}

// ---------------- Profile Management ----------------

app.post('/api/profile', (req, res) => {
  const { name, sport, experience_level, periodization_type, timeline_weeks, squat_max, bench_max, deadlift_max, equipment, injuries, goals } = req.body;

  if (!name || !sport || !experience_level || !periodization_type || !timeline_weeks) {
    return res.status(400).json({ error: 'name, sport, experience_level, periodization_type, and timeline_weeks are required.' });
  }
  const weeks = Number(timeline_weeks);
  if (!Number.isFinite(weeks) || weeks < 4 || weeks > 52) {
    return res.status(400).json({ error: 'timeline_weeks must be between 4 and 52.' });
  }

  const userStmt = db.prepare('INSERT INTO users (name) VALUES (?)');
  const userInfo = userStmt.run(name);
  const user_id = userInfo.lastInsertRowid;

  const profileStmt = db.prepare(`INSERT INTO profiles
    (user_id, sport, experience_level, periodization_type, timeline_weeks, squat_max, bench_max, deadlift_max, equipment, injuries, goals)
    VALUES (@user_id, @sport, @experience_level, @periodization_type, @timeline_weeks, @squat_max, @bench_max, @deadlift_max, @equipment, @injuries, @goals)`);
  const profileInfo = profileStmt.run({
    user_id,
    sport,
    experience_level,
    periodization_type,
    timeline_weeks: weeks,
    squat_max: squat_max || null,
    bench_max: bench_max || null,
    deadlift_max: deadlift_max || null,
    equipment: equipment ? JSON.stringify(equipment) : null,
    injuries: injuries || null,
    goals: goals || null
  });

  res.json({ user_id, profile_id: profileInfo.lastInsertRowid });
});

app.get('/api/profile/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM profiles WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Profile not found.' });
  res.json({ ...row, equipment: row.equipment ? JSON.parse(row.equipment) : [] });
});

// ---------------- Program Generation ----------------

app.post('/api/generate-program', (req, res) => {
  const { profile_id } = req.body;
  const profile = db.prepare('SELECT * FROM profiles WHERE id = ?').get(profile_id);
  if (!profile) return res.status(404).json({ error: 'Profile not found.' });

  const programData = generateProgram(profile);
  const stmt = db.prepare('INSERT INTO programs (profile_id, program_data) VALUES (?, ?)');
  const info = stmt.run(profile_id, JSON.stringify(programData));
  const program_id = info.lastInsertRowid;

  res.json({ program_id, profile_id: Number(profile_id), program: { program_id, profile_id: Number(profile_id), ...programData } });
});

app.get('/api/program/:program_id', (req, res) => {
  const program = getProgramRow(req.params.program_id);
  if (!program) return res.status(404).json({ error: 'Program not found.' });
  res.json({ program_id: program.id, profile_id: program.profile_id, status: program.status, created_at: program.created_at, ...program.program_data });
});

app.put('/api/program/:program_id', (req, res) => {
  const existing = getProgramRow(req.params.program_id);
  if (!existing) return res.status(404).json({ error: 'Program not found.' });
  const updated = { ...existing.program_data, ...req.body };
  db.prepare('UPDATE programs SET program_data = ? WHERE id = ?').run(JSON.stringify(updated), req.params.program_id);
  res.json({ program_id: Number(req.params.program_id), ...updated });
});

app.delete('/api/program/:program_id', (req, res) => {
  const info = db.prepare('DELETE FROM programs WHERE id = ?').run(req.params.program_id);
  if (info.changes === 0) return res.status(404).json({ error: 'Program not found.' });
  res.json({ deleted: true });
});

app.get('/api/programs', (req, res) => {
  const rows = db.prepare(`
    SELECT p.id AS program_id, p.status, p.created_at, pr.sport, pr.timeline_weeks, pr.periodization_type, u.name AS athlete_name
    FROM programs p
    JOIN profiles pr ON pr.id = p.profile_id
    JOIN users u ON u.id = pr.user_id
    ORDER BY p.created_at DESC
  `).all();
  res.json(rows);
});

app.post('/api/program/:program_id/archive', (req, res) => {
  db.prepare("UPDATE programs SET status = 'archived' WHERE id = ?").run(req.params.program_id);
  res.json({ archived: true });
});

app.post('/api/program/:program_id/clone', (req, res) => {
  const existing = getProgramRow(req.params.program_id);
  if (!existing) return res.status(404).json({ error: 'Program not found.' });
  const profile = db.prepare('SELECT * FROM profiles WHERE id = ?').get(existing.profile_id);
  const programData = generateProgram(profile);
  const info = db.prepare('INSERT INTO programs (profile_id, program_data) VALUES (?, ?)').run(existing.profile_id, JSON.stringify(programData));
  res.json({ program_id: info.lastInsertRowid, profile_id: existing.profile_id, ...programData });
});

// ---------------- Session Logging & Auto-Adjustment ----------------

app.post('/api/log-session', (req, res) => {
  const {
    program_id, week_number, day_name, exercise,
    prescribed_sets, prescribed_reps, prescribed_rpe, prescribed_weight,
    actual_sets, actual_reps, actual_rpe, actual_weight,
    notes, completed, movement_changed
  } = req.body;

  if (!program_id || !week_number || !day_name || !exercise) {
    return res.status(400).json({ error: 'program_id, week_number, day_name, and exercise are required.' });
  }

  const stmt = db.prepare(`INSERT INTO sessions
    (program_id, week_number, day_name, exercise, prescribed_sets, prescribed_reps, prescribed_rpe, prescribed_weight,
     actual_sets, actual_reps, actual_rpe, actual_weight, notes, completed)
    VALUES (@program_id, @week_number, @day_name, @exercise, @prescribed_sets, @prescribed_reps, @prescribed_rpe, @prescribed_weight,
     @actual_sets, @actual_reps, @actual_rpe, @actual_weight, @notes, @completed)`);

  const info = stmt.run({
    program_id, week_number, day_name, exercise,
    prescribed_sets: prescribed_sets ?? null,
    prescribed_reps: prescribed_reps ?? null,
    prescribed_rpe: prescribed_rpe ?? null,
    prescribed_weight: prescribed_weight ?? null,
    actual_sets: actual_sets ?? null,
    actual_reps: actual_reps ?? null,
    actual_rpe: actual_rpe ?? null,
    actual_weight: actual_weight ?? null,
    notes: notes || null,
    completed: completed === false ? 0 : 1
  });

  const recentSessions = db.prepare(`SELECT * FROM sessions WHERE program_id = ? AND exercise = ? AND id != ? ORDER BY logged_at DESC LIMIT 5`)
    .all(program_id, exercise, info.lastInsertRowid);

  const adjustment = computeAdjustment({
    actualWeight: actual_weight,
    actualRpe: actual_rpe,
    prescribedWeight: prescribed_weight,
    recentSessions,
    movementChanged: !!movement_changed
  });

  res.json({
    session_id: info.lastInsertRowid,
    next_weight_recommendation: adjustment.next_weight,
    adjustment_action: adjustment.action,
    adjustment_explanation: adjustment.explanation,
    deload_recommended: !!adjustment.deload_recommended
  });
});

app.get('/api/sessions/:program_id', (req, res) => {
  const rows = db.prepare('SELECT * FROM sessions WHERE program_id = ? ORDER BY week_number ASC, logged_at ASC').all(req.params.program_id);
  res.json(rows);
});

app.put('/api/session/:session_id', (req, res) => {
  const existing = db.prepare('SELECT * FROM sessions WHERE id = ?').get(req.params.session_id);
  if (!existing) return res.status(404).json({ error: 'Session not found.' });
  const fields = ['actual_sets', 'actual_reps', 'actual_rpe', 'actual_weight', 'notes', 'completed'];
  const merged = { ...existing };
  for (const f of fields) if (req.body[f] !== undefined) merged[f] = req.body[f];
  db.prepare(`UPDATE sessions SET actual_sets=@actual_sets, actual_reps=@actual_reps, actual_rpe=@actual_rpe,
    actual_weight=@actual_weight, notes=@notes, completed=@completed WHERE id=@id`).run({ ...merged, id: req.params.session_id });
  res.json({ updated: true });
});

// ---------------- Progress Analytics ----------------

app.get('/api/progress/:program_id', (req, res) => {
  const sessions = db.prepare('SELECT * FROM sessions WHERE program_id = ?').all(req.params.program_id);
  res.json(buildAnalytics(sessions));
});

app.get('/api/compare/:program_id', (req, res) => {
  const { week1, week2 } = req.query;
  if (!week1 || !week2) return res.status(400).json({ error: 'week1 and week2 query params are required.' });
  const sessions = db.prepare('SELECT * FROM sessions WHERE program_id = ?').all(req.params.program_id);
  res.json(compareWeeks(sessions, week1, week2));
});

app.get('/api/export/:program_id', (req, res) => {
  const format = (req.query.format || 'csv').toLowerCase();
  const sessions = db.prepare('SELECT * FROM sessions WHERE program_id = ? ORDER BY week_number, logged_at').all(req.params.program_id);

  if (format === 'json') {
    return res.json(sessions);
  }

  const fields = ['id', 'week_number', 'day_name', 'exercise', 'prescribed_sets', 'prescribed_reps', 'prescribed_rpe', 'prescribed_weight',
    'actual_sets', 'actual_reps', 'actual_rpe', 'actual_weight', 'notes', 'completed', 'logged_at'];
  const parser = new CsvParser({ fields });
  const csv = parser.parse(sessions);
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename="program_${req.params.program_id}_sessions.csv"`);
  res.send(csv);
});

// ---------------- Exercise Library ----------------

app.get('/api/exercises', (req, res) => {
  const sport = req.query.sport;
  if (sport) {
    const rows = db.prepare('SELECT * FROM sport_exercises WHERE sport = ?').all(sport);
    return res.json(rows.length ? rows : Object.entries(getSportExercises(sport)).flatMap(([category, names]) => names.map(n => ({ sport, exercise_name: n, category }))));
  }
  const rows = db.prepare('SELECT * FROM sport_exercises').all();
  res.json(rows);
});

app.get('/api/exercise-variations/:exercise', (req, res) => {
  res.json({ exercise: req.params.exercise, substitutions: getSubstitutions(req.params.exercise) });
});

// SPA fallback
app.get(/^\/(?!api).*/, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Training Program Builder running at http://localhost:${PORT}`);
});

module.exports = app;
