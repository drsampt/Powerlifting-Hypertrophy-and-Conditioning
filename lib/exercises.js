// Sport-specific exercise libraries used for program generation and the exercise library API.

const EXERCISES = {
  powerlifting: {
    primary: ['Back Squat', 'Bench Press', 'Deadlift'],
    secondary: ['Front Squat', 'Close-Grip Bench Press', 'Deficit Deadlift', 'Paused Bench Press', 'Box Squat', 'Sumo Deadlift', 'Safety Bar Squat'],
    accessory: ['Leg Press', 'Romanian Deadlift', 'Barbell Row', 'Dumbbell Bench Press', 'Overhead Press', 'Lat Pulldown', 'Leg Curl', 'Leg Extension', 'Triceps Pushdown', 'Face Pull', 'Bulgarian Split Squat', 'Glute Ham Raise', 'Ab Wheel Rollout'],
    conditioning: ['Sled Push', 'Airbike Intervals', 'Incline Walk']
  },
  strongman: {
    primary: ['Log Press', 'Axle Deadlift', 'Yoke Walk', 'Farmers Carry', 'Atlas Stone'],
    secondary: ['Axle Clean and Press', 'Deficit Deadlift', 'Circus Dumbbell Press', 'Tire Flip'],
    accessory: ['Back Squat', 'Barbell Row', 'Push Press', 'Sandbag Carry', 'Zercher Carry', 'Grip Trainer', 'Neck Harness', 'Ab Wheel Rollout'],
    conditioning: ['Sled Drag', 'Prowler Push', 'Sled Sprint']
  },
  weightlifting: {
    primary: ['Snatch', 'Clean and Jerk'],
    secondary: ['Power Snatch', 'Power Clean', 'Hang Snatch', 'Hang Clean', 'Clean Pull', 'Snatch Pull', 'Jerk from Rack'],
    accessory: ['Front Squat', 'Overhead Squat', 'Back Squat', 'Push Press', 'Snatch Balance', 'Muscle Snatch', 'Good Morning'],
    conditioning: ['Airbike Intervals', 'Row Intervals']
  },
  crossfit: {
    primary: ['Back Squat', 'Deadlift', 'Clean and Jerk', 'Snatch'],
    secondary: ['Front Squat', 'Push Press', 'Thruster', 'Overhead Squat'],
    accessory: ['Pull-Up', 'Toes to Bar', 'Handstand Push-Up', 'Kettlebell Swing', 'Box Jump', 'Wall Ball', 'Double Under'],
    conditioning: ['Row Intervals', 'Airbike Intervals', 'Run Intervals', 'Metcon Circuit']
  },
  bodybuilding: {
    primary: ['Back Squat', 'Bench Press', 'Deadlift', 'Overhead Press'],
    secondary: ['Incline Dumbbell Press', 'Hack Squat', 'Romanian Deadlift', 'Chest Supported Row'],
    accessory: ['Leg Extension', 'Leg Curl', 'Lateral Raise', 'Cable Fly', 'Barbell Curl', 'Triceps Pushdown', 'Calf Raise', 'Face Pull', 'Preacher Curl', 'Cable Crunch'],
    conditioning: ['Incline Walk', 'Airbike Intervals']
  },
  general: {
    primary: ['Back Squat', 'Bench Press', 'Deadlift', 'Overhead Press'],
    secondary: ['Front Squat', 'Incline Bench Press', 'Barbell Row', 'Pull-Up'],
    accessory: ['Lunge', 'Dumbbell Bench Press', 'Lat Pulldown', 'Leg Curl', 'Face Pull', 'Plank', 'Farmers Carry'],
    conditioning: ['Incline Walk', 'Airbike Intervals', 'Row Intervals']
  }
};

const SUBSTITUTIONS = {
  'Back Squat': ['Front Squat @ 70%', 'Safety Bar Squat', 'Goblet Squat'],
  'Bench Press': ['Close-Grip Bench Press', 'Dumbbell Bench Press', 'Football Bar Bench Press'],
  'Deadlift': ['Trap Bar Deadlift', 'Deficit Deadlift', 'Romanian Deadlift'],
  'Overhead Press': ['Push Press', 'Dumbbell Shoulder Press', 'Landmine Press'],
  'Log Press': ['Push Press', 'Axle Press'],
  'Snatch': ['Power Snatch', 'Snatch Pull'],
  'Clean and Jerk': ['Power Clean + Push Press', 'Clean Pull + Jerk from Rack']
};

function getSportExercises(sport) {
  return EXERCISES[sport] || EXERCISES.general;
}

function getSubstitutions(exerciseName) {
  return SUBSTITUTIONS[exerciseName] || ['Machine/Dumbbell variation', 'Reduce ROM variant'];
}

function movementPattern(name) {
  const n = name.toLowerCase();
  if (n.includes('squat')) return 'squat';
  if (n.includes('deadlift') || n.includes('pull') && n.includes('clean')) return 'hinge';
  if (n.includes('bench') || n.includes('press')) return 'press';
  if (n.includes('row') || n.includes('pulldown') || n.includes('pull-up')) return 'pull';
  if (n.includes('carry') || n.includes('walk')) return 'carry';
  if (n.includes('snatch') || n.includes('clean') || n.includes('jerk')) return 'olympic';
  return 'accessory';
}

function flattenLibrary(sport) {
  const lib = getSportExercises(sport);
  const rows = [];
  for (const category of Object.keys(lib)) {
    for (const name of lib[category]) {
      rows.push({ sport, exercise_name: name, category, movement_pattern: movementPattern(name) });
    }
  }
  return rows;
}

module.exports = { EXERCISES, getSportExercises, getSubstitutions, flattenLibrary, movementPattern };
