// Muscle-group tagging and weekly volume targets, used to select accessory work that
// actually earns its place in the program rather than being picked at random.

const LOWER_MUSCLES = ['quads', 'hamstrings', 'glutes', 'calves'];
const UPPER_MUSCLES = ['chest', 'back', 'shoulders', 'triceps', 'biceps', 'rear_delts'];
const OTHER_MUSCLES = ['core', 'forearms', 'traps'];
const ALL_MUSCLES = [...LOWER_MUSCLES, ...UPPER_MUSCLES, ...OTHER_MUSCLES];

// Exercise name -> muscle groups it trains. Covers every exercise referenced across
// lib/exercises.js. Names not found here fall back to a movement-pattern default.
const MUSCLE_MAP = {
  'Back Squat': ['quads', 'glutes', 'core'],
  'Bench Press': ['chest', 'triceps', 'shoulders'],
  'Deadlift': ['hamstrings', 'glutes', 'back', 'core'],
  'Front Squat': ['quads', 'glutes', 'core'],
  'Close-Grip Bench Press': ['triceps', 'chest'],
  'Deficit Deadlift': ['hamstrings', 'glutes', 'back'],
  'Paused Bench Press': ['chest', 'triceps', 'shoulders'],
  'Box Squat': ['quads', 'glutes'],
  'Sumo Deadlift': ['glutes', 'hamstrings', 'back'],
  'Safety Bar Squat': ['quads', 'glutes'],
  'Leg Press': ['quads', 'glutes'],
  'Romanian Deadlift': ['hamstrings', 'glutes'],
  'Barbell Row': ['back', 'biceps'],
  'Dumbbell Bench Press': ['chest', 'triceps', 'shoulders'],
  'Overhead Press': ['shoulders', 'triceps'],
  'Lat Pulldown': ['back', 'biceps'],
  'Leg Curl': ['hamstrings'],
  'Leg Extension': ['quads'],
  'Triceps Pushdown': ['triceps'],
  'Face Pull': ['rear_delts', 'back'],
  'Bulgarian Split Squat': ['quads', 'glutes'],
  'Glute Ham Raise': ['hamstrings', 'glutes'],
  'Ab Wheel Rollout': ['core'],
  'Sled Push': ['quads', 'glutes'],
  'Airbike Intervals': [],
  'Incline Walk': [],

  'Log Press': ['shoulders', 'triceps'],
  'Axle Deadlift': ['hamstrings', 'glutes', 'back'],
  'Yoke Walk': ['core', 'quads', 'traps'],
  'Farmers Carry': ['core', 'forearms', 'traps'],
  'Atlas Stone': ['back', 'glutes', 'core'],
  'Axle Clean and Press': ['shoulders', 'back', 'quads'],
  'Circus Dumbbell Press': ['shoulders', 'triceps'],
  'Tire Flip': ['quads', 'glutes', 'back'],
  'Push Press': ['shoulders', 'triceps'],
  'Sandbag Carry': ['core', 'forearms'],
  'Zercher Carry': ['core', 'quads'],
  'Grip Trainer': ['forearms'],
  'Neck Harness': [],
  'Sled Drag': ['quads', 'glutes'],
  'Prowler Push': ['quads', 'glutes'],
  'Sled Sprint': ['quads', 'glutes'],

  'Snatch': ['quads', 'back', 'shoulders', 'glutes'],
  'Clean and Jerk': ['quads', 'back', 'shoulders', 'glutes'],
  'Power Snatch': ['quads', 'back', 'shoulders'],
  'Power Clean': ['quads', 'back', 'shoulders'],
  'Hang Snatch': ['back', 'shoulders'],
  'Hang Clean': ['back', 'shoulders'],
  'Clean Pull': ['back', 'hamstrings', 'traps'],
  'Snatch Pull': ['back', 'hamstrings', 'traps'],
  'Jerk from Rack': ['shoulders', 'triceps'],
  'Overhead Squat': ['quads', 'shoulders', 'core'],
  'Snatch Balance': ['shoulders', 'quads'],
  'Muscle Snatch': ['shoulders', 'back'],
  'Good Morning': ['hamstrings', 'back'],

  'Thruster': ['quads', 'shoulders'],
  'Pull-Up': ['back', 'biceps'],
  'Toes to Bar': ['core'],
  'Handstand Push-Up': ['shoulders', 'triceps'],
  'Kettlebell Swing': ['glutes', 'hamstrings'],
  'Box Jump': ['quads', 'glutes'],
  'Wall Ball': ['quads', 'shoulders'],
  'Double Under': [],
  'Row Intervals': [],
  'Run Intervals': [],
  'Metcon Circuit': [],

  'Incline Dumbbell Press': ['chest', 'shoulders', 'triceps'],
  'Hack Squat': ['quads'],
  'Chest Supported Row': ['back', 'biceps'],
  'Lateral Raise': ['shoulders'],
  'Cable Fly': ['chest'],
  'Barbell Curl': ['biceps'],
  'Calf Raise': ['calves'],
  'Preacher Curl': ['biceps'],
  'Cable Crunch': ['core'],

  'Lunge': ['quads', 'glutes'],
  'Incline Bench Press': ['chest', 'shoulders', 'triceps'],
  'Plank': ['core']
};

function getMuscles(name, movementPattern) {
  if (MUSCLE_MAP[name]) return MUSCLE_MAP[name];
  switch (movementPattern) {
    case 'squat': return ['quads', 'glutes', 'core'];
    case 'hinge': return ['hamstrings', 'glutes', 'back'];
    case 'press': return ['chest', 'shoulders', 'triceps'];
    case 'pull': return ['back', 'biceps'];
    case 'carry': return ['core', 'forearms'];
    case 'olympic': return ['quads', 'back', 'shoulders'];
    default: return [];
  }
}

// Weekly direct-set targets per muscle group, by experience level (research-informed
// MEV/MAV ranges — e.g. Israetel/RP volume landmarks, Schoenfeld et al. dose-response
// reviews). Advanced/elite lifters both tolerate and need more volume to keep progressing.
const VOLUME_TARGETS_BY_EXPERIENCE = {
  novice: { min: 8, max: 12 },
  intermediate: { min: 10, max: 16 },
  advanced: { min: 12, max: 18 },
  elite: { min: 14, max: 20 }
};

function getWeeklyVolumeTarget(experienceLevel) {
  return VOLUME_TARGETS_BY_EXPERIENCE[experienceLevel] || VOLUME_TARGETS_BY_EXPERIENCE.intermediate;
}

// Lower-rep strength/peaking phases need less total accessory volume (recovery budget
// is spent on heavier main-lift work instead); higher-rep hypertrophy phases need more.
function phaseVolumeMultiplier(phaseReps) {
  if (phaseReps >= 8) return 1.0;
  if (phaseReps >= 5) return 0.75;
  return 0.55;
}

function isLowerMuscle(m) { return LOWER_MUSCLES.includes(m); }
function isUpperMuscle(m) { return UPPER_MUSCLES.includes(m); }

module.exports = {
  LOWER_MUSCLES, UPPER_MUSCLES, OTHER_MUSCLES, ALL_MUSCLES,
  getMuscles, getWeeklyVolumeTarget, phaseVolumeMultiplier,
  isLowerMuscle, isUpperMuscle
};
