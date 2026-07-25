const path = require('path');
const Database = require('better-sqlite3');
const { flattenLibrary } = require('./exercises');

const DB_PATH = path.join(__dirname, '..', 'training.db');
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS profiles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  sport TEXT NOT NULL,
  experience_level TEXT NOT NULL,
  periodization_type TEXT NOT NULL,
  timeline_weeks INTEGER NOT NULL,
  squat_max REAL,
  bench_max REAL,
  deadlift_max REAL,
  equipment TEXT,
  injuries TEXT,
  goals TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS programs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  profile_id INTEGER NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  program_data TEXT NOT NULL,
  status TEXT DEFAULT 'active',
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  program_id INTEGER NOT NULL REFERENCES programs(id) ON DELETE CASCADE,
  week_number INTEGER NOT NULL,
  day_name TEXT NOT NULL,
  exercise TEXT NOT NULL,
  prescribed_sets INTEGER,
  prescribed_reps INTEGER,
  prescribed_rpe REAL,
  prescribed_weight REAL,
  actual_sets INTEGER,
  actual_reps INTEGER,
  actual_rpe REAL,
  actual_weight REAL,
  notes TEXT,
  completed INTEGER DEFAULT 1,
  logged_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS progress_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  program_id INTEGER NOT NULL REFERENCES programs(id) ON DELETE CASCADE,
  metric TEXT NOT NULL,
  value REAL NOT NULL,
  recorded_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sport_exercises (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sport TEXT NOT NULL,
  exercise_name TEXT NOT NULL,
  movement_pattern TEXT,
  equipment_needed TEXT,
  difficulty_level TEXT
);
`);

// Seed sport_exercises once.
const count = db.prepare('SELECT COUNT(*) AS c FROM sport_exercises').get().c;
if (count === 0) {
  const insert = db.prepare('INSERT INTO sport_exercises (sport, exercise_name, movement_pattern, equipment_needed, difficulty_level) VALUES (?, ?, ?, ?, ?)');
  const insertMany = db.transaction((rows) => {
    for (const r of rows) {
      insert.run(r.sport, r.exercise_name, r.movement_pattern, r.category, r.category === 'primary' ? 'advanced' : 'intermediate');
    }
  });
  const sports = ['powerlifting', 'strongman', 'weightlifting', 'crossfit', 'bodybuilding', 'general'];
  let all = [];
  for (const s of sports) all = all.concat(flattenLibrary(s));
  insertMany(all);
}

module.exports = db;
