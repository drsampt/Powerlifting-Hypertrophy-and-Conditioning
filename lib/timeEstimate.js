// Estimates how long an exercise/day actually takes, so program generation can fit
// exercises to a desired session length instead of a fixed count. Heavy compound work
// needs longer rest between sets than light accessory/isolation work, so the same time
// budget naturally yields fewer exercises on a heavy day and more on a light one.

const MINUTES_PER_SET = {
  main: 3.5,             // heavy compound top sets — long rest for full recovery between efforts
  compound_accessory: 2.75, // secondary barbell/dumbbell compounds (rows, presses, etc.)
  isolation: 2.0,         // single-joint / machine accessory work — still needs real rest + transition time
  conditioning: 15         // flat block for a conditioning "exercise" (interval work, carries, etc.)
};
const MINUTES_PER_WARMUP_SET = 1.25;

function classifyExercise(exercise) {
  if (exercise.prescribed_weight == null && exercise.reps == null) return 'conditioning';
  if (exercise.is_main) return 'main';
  if (exercise.reps != null && exercise.reps <= 8) return 'compound_accessory';
  return 'isolation';
}

function minutesForExercise(exercise) {
  const category = classifyExercise(exercise);
  if (category === 'conditioning') return MINUTES_PER_SET.conditioning;
  const warmupMinutes = (exercise.warmup_sets || []).length * MINUTES_PER_WARMUP_SET;
  const workMinutes = (exercise.sets || 0) * MINUTES_PER_SET[category];
  return warmupMinutes + workMinutes;
}

function minutesForDay(day) {
  return day.exercises.reduce((total, ex) => total + minutesForExercise(ex), 0);
}

module.exports = { classifyExercise, minutesForExercise, minutesForDay, MINUTES_PER_SET, MINUTES_PER_WARMUP_SET };
