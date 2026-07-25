// Program generation engine: builds a full periodized program JSON from a training profile.

const { calcWeight, generateWarmupSets, roundToIncrement } = require('./loadCalc');
const { getSportExercises, getSubstitutions, movementPattern } = require('./exercises');
const {
  LOWER_MUSCLES, UPPER_MUSCLES, ALL_MUSCLES,
  getMuscles, getWeeklyVolumeTarget, phaseVolumeMultiplier,
  isLowerMuscle, isUpperMuscle
} = require('./muscleGroups');
const { minutesForExercise, minutesForDay } = require('./timeEstimate');

// Map a primary movement pattern to the athlete's relevant 1RM. Only ever called for
// main-lift exercises (lib.primary/secondary) — these are the only names with a
// legitimate percentage-of-max relationship. Returns null if no real basis exists
// (deliberately no generic fallback to squat/bench/deadlift — that produced nonsense
// like a Leg Curl loaded off someone's squat max).
function relevantMax(profile, exerciseName) {
  const n = exerciseName.toLowerCase();
  if (n.includes('squat')) return profile.squat_max;
  if (n.includes('deadlift')) return profile.deadlift_max;
  if (n.includes('snatch')) return profile.squat_max ? Math.round(profile.squat_max * 0.55) : null;
  if (n.includes('clean') || n.includes('jerk')) return profile.squat_max ? Math.round(profile.squat_max * 0.7) : null;
  if (n.includes('yoke') || n.includes('carry') || n.includes('stone')) return profile.deadlift_max ? Math.round(profile.deadlift_max * 0.9) : null;
  if (n.includes('log') || n.includes('axle') || n.includes('push press') || n.includes('circus')) return profile.bench_max ? Math.round(profile.bench_max * 0.85) : null;
  if (n.includes('bench') || n.includes('press')) return profile.bench_max;
  return null;
}

// Accessory-pool exercises (isolation/machine/carry work with no real 1RM relationship
// to the athlete's competition maxes) are prescribed by sets/reps/RPE only — no computed
// weight. The athlete picks a load to hit the target RPE, and the auto-adjustment system
// converges on the right number after the first logged session, same as real coaching.
function buildExercise(name, sets, reps, rpe, profile, opts = {}) {
  const oneRm = opts.noWeight ? null : relevantMax(profile, name);
  const weight = oneRm ? calcWeight(oneRm, reps, rpe) : null;
  return {
    name,
    sets,
    reps,
    rpe,
    prescribed_weight: weight,
    weight_percentage: oneRm && weight ? Math.round((weight / oneRm) * 100) : null,
    intensity_cues: `RPE ${rpe} = ${Math.max(0, Math.round((10 - rpe) * 2) / 2)} RIR`,
    video_cue: null,
    substitutions: getSubstitutions(name),
    is_main: !!opts.isMain,
    warmup_sets: opts.isMain && weight ? generateWarmupSets(weight) : []
  };
}

function getDurationRange(profile) {
  let min = Number(profile.workout_duration_min) || 45;
  let max = Number(profile.workout_duration_max) || 75;
  min = Math.max(20, Math.min(min, 180));
  max = Math.max(min, Math.min(max, 180));
  return { min, max };
}

function dayFocusMuscles(mainLiftName) {
  const muscles = getMuscles(mainLiftName, movementPattern(mainLiftName));
  const hasLower = muscles.some(isLowerMuscle);
  const hasUpper = muscles.some(isUpperMuscle);
  if (hasLower && !hasUpper) return [...LOWER_MUSCLES, 'core'];
  if (hasUpper && !hasLower) return [...UPPER_MUSCLES, 'core'];
  return ALL_MUSCLES; // full-body lifts (Olympic movements) can pair with anything
}

function creditVolume(weekVolume, name, sets) {
  for (const m of getMuscles(name, movementPattern(name))) {
    weekVolume[m] = (weekVolume[m] || 0) + sets;
  }
}

function rotate(arr, n) {
  if (!arr.length) return arr;
  const i = n % arr.length;
  return arr.slice(i).concat(arr.slice(0, i));
}

// Builds one training day: mandatory main lift(s) with warmups, then greedily fills
// accessory work targeting whichever relevant muscle groups are furthest under their
// weekly volume target, stopping once the duration budget is spent. This is why heavy
// main-lift days (long rest between sets) end up with fewer total exercises than
// accessory-heavy days within the same time budget — the constraint is minutes, not a
// fixed exercise count.
function buildDay(dayName, workoutType, mainSpecs, muscleFocus, lib, profile, weekVolume, durationRange, volumeMultiplier, weekIdx) {
  const exercises = [];
  let minutes = 0;

  for (const spec of mainSpecs) {
    const ex = buildExercise(spec.name, spec.sets, spec.reps, spec.rpe, profile, { isMain: true });
    exercises.push(ex);
    minutes += minutesForExercise(ex);
    creditVolume(weekVolume, spec.name, ex.sets);
  }

  const target = getWeeklyVolumeTarget(profile.experience_level);
  const mainRpe = mainSpecs[0] ? mainSpecs[0].rpe : 7;
  const accessoryRpe = Math.max(5.5, mainRpe - 1.5);
  const usedNames = new Set(exercises.map(e => e.name));
  // Secondary barbell/dumbbell variants (Front Squat, Close-Grip Bench, etc.) have a real
  // percentage-of-max relationship and keep computed loads when picked as fill-in work;
  // true accessory/isolation work (lib.accessory) stays RPE-only regardless of pick order.
  const secondarySet = new Set(lib.secondary);
  const candidatePool = rotate(Array.from(new Set([...lib.secondary, ...lib.accessory])), weekIdx);

  function deficitScore(name) {
    const muscles = getMuscles(name, movementPattern(name)).filter(m => muscleFocus.includes(m));
    if (!muscles.length) return -Infinity;
    return muscles.reduce((sum, m) => sum + Math.max(0, target.max * volumeMultiplier - (weekVolume[m] || 0)), 0);
  }

  // Real sessions don't spread across a dozen exercises just because there's time left —
  // cap accessory count so leftover time budget goes toward not over-programming the day.
  const MAX_ACCESSORIES = 4;
  let accessoryCount = 0;
  let guard = 0;
  while (minutes < durationRange.max && accessoryCount < MAX_ACCESSORIES && guard < 20) {
    guard++;
    const candidates = candidatePool.filter(n => !usedNames.has(n) && deficitScore(n) > -Infinity);
    if (!candidates.length) break;
    candidates.sort((a, b) => deficitScore(b) - deficitScore(a));
    const name = candidates[0];
    if (deficitScore(name) <= 0 && minutes >= durationRange.min) break;

    const ex = buildExercise(name, 3, 12, accessoryRpe, profile, { noWeight: !secondarySet.has(name) });
    const exMinutes = minutesForExercise(ex);
    if (minutes + exMinutes > durationRange.max) break;

    exercises.push(ex);
    usedNames.add(name);
    minutes += exMinutes;
    accessoryCount++;
    creditVolume(weekVolume, name, ex.sets);
  }

  return { day_name: dayName, workout_type: workoutType, exercises, estimated_minutes: Math.round(minutes) };
}

// ---------- Weekly day templates per sport (non-conjugate models) ----------

function fourDaySplit(sport, weekIdx, focus, profile, durationRange) {
  const lib = getSportExercises(sport);
  const [primary1, primary2, primary3] = lib.primary;
  const weekVolume = {};
  const volumeMultiplier = phaseVolumeMultiplier(focus.reps);
  const days = [];

  days.push(buildDay('Monday', 'Lower A',
    [{ name: primary1 || 'Back Squat', sets: focus.sets, reps: focus.reps, rpe: focus.rpe }],
    [...LOWER_MUSCLES, 'core'], lib, profile, weekVolume, durationRange, volumeMultiplier, weekIdx));

  days.push(buildDay('Tuesday', 'Upper A',
    [{ name: primary2 || 'Bench Press', sets: focus.sets, reps: focus.reps, rpe: focus.rpe }],
    [...UPPER_MUSCLES, 'core'], lib, profile, weekVolume, durationRange, volumeMultiplier, weekIdx + 1));

  days.push(buildDay('Thursday', 'Lower B',
    [{ name: primary3 || lib.secondary[0], sets: focus.sets, reps: focus.reps + 1, rpe: focus.rpe - 0.5 }],
    [...LOWER_MUSCLES, 'core'], lib, profile, weekVolume, durationRange, volumeMultiplier, weekIdx + 2));

  days.push(buildDay('Friday', 'Upper B',
    [{ name: lib.secondary[1] || primary2, sets: focus.sets, reps: focus.reps + 1, rpe: focus.rpe - 0.5 }],
    [...UPPER_MUSCLES, 'core'], lib, profile, weekVolume, durationRange, volumeMultiplier, weekIdx + 3));

  days.push({
    day_name: 'Saturday',
    workout_type: 'Conditioning',
    exercises: [
      { name: lib.conditioning[weekIdx % lib.conditioning.length], sets: 1, reps: null, rpe: 6, prescribed_weight: null, weight_percentage: null, intensity_cues: 'Steady aerobic / EMOM per coach discretion', video_cue: null, substitutions: [], is_main: false, warmup_sets: [] }
    ],
    estimated_minutes: 20
  });
  return days;
}

// ---------- Conjugate model ----------

function conjugateWeek(sport, weekIdx, profile, durationRange) {
  const lib = getSportExercises(sport);
  const rotation = weekIdx % 3; // rotates primary ME lift every 3 weeks
  const meLifts = [lib.primary[0], lib.secondary[0] || lib.primary[0], lib.primary[Math.min(2, lib.primary.length - 1)]];
  const meLift = meLifts[rotation];
  const deLift = lib.primary[0];
  const repLift = lib.secondary[1] || lib.accessory[0];
  const weekVolume = {};

  const days = [
    buildDay('Monday', 'Max Effort',
      [{ name: meLift, sets: 1, reps: 2, rpe: 9 }],
      dayFocusMuscles(meLift), lib, profile, weekVolume, durationRange, phaseVolumeMultiplier(2), weekIdx),
    buildDay('Wednesday', 'Dynamic Effort',
      [{ name: deLift, sets: 8, reps: 3, rpe: 6.5 }],
      dayFocusMuscles(deLift), lib, profile, weekVolume, durationRange, phaseVolumeMultiplier(3), weekIdx + 1),
    buildDay('Friday', 'Repetition',
      [{ name: repLift, sets: 4, reps: 10, rpe: 7.5 }],
      dayFocusMuscles(repLift), lib, profile, weekVolume, durationRange, phaseVolumeMultiplier(10), weekIdx + 2)
  ];

  days.push({
    day_name: 'Saturday',
    workout_type: 'Conditioning',
    exercises: [
      { name: lib.conditioning[weekIdx % lib.conditioning.length], sets: 1, reps: null, rpe: 6, prescribed_weight: null, weight_percentage: null, intensity_cues: 'GPP / recovery conditioning', video_cue: null, substitutions: [], is_main: false, warmup_sets: [] }
    ],
    estimated_minutes: 20
  });
  return days;
}

// ---------- DUP model ----------

function dupWeek(sport, weekIdx, profile, durationRange) {
  const lib = getSportExercises(sport);
  const types = [
    { name: 'Day A - Hypertrophy', reps: 11, rpe: 6.75, sets: 4 },
    { name: 'Day B - Strength-Hypertrophy', reps: 7, rpe: 7.25, sets: 4 },
    { name: 'Day C - Strength', reps: 4, rpe: 8, sets: 5 }
  ];
  const dayNames = ['Monday', 'Wednesday', 'Friday'];
  const weekVolume = {};
  return types.map((t, i) => {
    const mainLift = lib.primary[i % lib.primary.length];
    return buildDay(dayNames[i], t.name,
      [{ name: mainLift, sets: t.sets, reps: t.reps, rpe: t.rpe }],
      dayFocusMuscles(mainLift), lib, profile, weekVolume, durationRange, phaseVolumeMultiplier(t.reps), weekIdx + i);
  });
}

// ---------- Phase templates ----------

const LINEAR_PHASES = [
  { name: 'Hypertrophy Foundation', weeks: 8, focus: { sets: 5, reps: 8, rpe: 7 }, description: 'High volume, moderate intensity' },
  { name: 'Strength', weeks: 8, focus: { sets: 5, reps: 5, rpe: 8 }, description: 'Moderate volume, rising intensity' },
  { name: 'Power/Speed', weeks: 8, focus: { sets: 6, reps: 3, rpe: 7 }, description: 'Bar speed and explosiveness' },
  { name: 'Peaking', weeks: 8, focus: { sets: 4, reps: 2, rpe: 8.5 }, description: 'Competition-specific, low volume, high intensity' }
];

const BLOCK_TEMPLATE = [
  { name: 'Hypertrophy Block', weeks: 4, focus: { sets: 5, reps: 10, rpe: 7 } },
  { name: 'Strength Block', weeks: 4, focus: { sets: 5, reps: 4, rpe: 8 } },
  { name: 'Power Block', weeks: 4, focus: { sets: 7, reps: 2, rpe: 6.75 } },
  { name: 'Peaking Block', weeks: 4, focus: { sets: 4, reps: 2, rpe: 8.75 } }
];

function applyDeload(focus) {
  return {
    sets: Math.max(2, Math.round(focus.sets * 0.6)),
    reps: focus.reps,
    rpe: Math.max(5, focus.rpe - 2)
  };
}

// Used by conjugate/DUP (which don't route through applyDeload's phase-level focus) to
// cut an already-built exercise's weight/sets/rpe for a deload week, keeping
// weight_percentage and warmup_sets in sync with the reduced weight.
function applyDeloadToExercise(e) {
  const prescribed_weight = e.prescribed_weight ? roundToIncrement(e.prescribed_weight * 0.85) : e.prescribed_weight;
  const oneRm = e.weight_percentage && e.prescribed_weight ? e.prescribed_weight / (e.weight_percentage / 100) : null;
  return {
    ...e,
    sets: Math.max(1, Math.round((e.sets || 1) * 0.6)),
    rpe: e.rpe ? Math.max(5, e.rpe - 2) : e.rpe,
    prescribed_weight,
    weight_percentage: oneRm ? Math.round((prescribed_weight / oneRm) * 100) : e.weight_percentage,
    warmup_sets: e.warmup_sets && e.warmup_sets.length ? generateWarmupSets(prescribed_weight) : e.warmup_sets
  };
}

function deloadDay(day) {
  const exercises = day.exercises.map(applyDeloadToExercise);
  return { ...day, exercises, estimated_minutes: Math.round(minutesForDay({ exercises })) };
}

function generateLinear(profile) {
  const totalWeeks = profile.timeline_weeks;
  const durationRange = getDurationRange(profile);
  const phases = [];
  let weekCursor = 1;
  let phaseNumber = 1;

  // Scale the 4 canonical 8-week phases to fit the requested timeline.
  const scale = totalWeeks / 32;
  const scaledPhases = LINEAR_PHASES.map(p => ({ ...p, weeks: Math.max(1, Math.round(p.weeks * scale)) }));

  const deloadWeeks = [];
  let weekIdx = 0;

  for (const phaseTemplate of scaledPhases) {
    if (weekCursor > totalWeeks) break;
    const phaseWeeksRemaining = Math.min(phaseTemplate.weeks, totalWeeks - weekCursor + 1);
    const workouts = [];
    for (let w = 0; w < phaseWeeksRemaining; w++) {
      const weekNumber = weekCursor + w;
      const isDeload = weekNumber % 8 === 0 && weekNumber !== totalWeeks;
      const focus = isDeload ? applyDeload(phaseTemplate.focus) : phaseTemplate.focus;
      if (isDeload) deloadWeeks.push(weekNumber);
      workouts.push({ week: weekNumber, deload: isDeload, days: fourDaySplit(profile.sport, weekIdx, focus, profile, durationRange) });
      weekIdx++;
    }
    phases.push({
      phase_number: phaseNumber++,
      name: phaseTemplate.name,
      weeks: phaseWeeksRemaining,
      focus: phaseTemplate.description,
      weekly_structure: `4x/week (Upper A/B, Lower A/B) + conditioning, ${durationRange.min}-${durationRange.max} min/session`,
      workouts
    });
    weekCursor += phaseWeeksRemaining;
  }

  return finalizeProgram(profile, phases, deloadWeeks, 'linear');
}

function generateBlock(profile) {
  const totalWeeks = profile.timeline_weeks;
  const durationRange = getDurationRange(profile);
  const phases = [];
  let weekCursor = 1;
  let phaseNumber = 1;
  let blockIdx = 0;
  const deloadWeeks = [];
  let weekIdx = 0;

  while (weekCursor <= totalWeeks) {
    const template = BLOCK_TEMPLATE[blockIdx % BLOCK_TEMPLATE.length];
    const phaseWeeks = Math.min(template.weeks, totalWeeks - weekCursor + 1);
    const workouts = [];
    for (let w = 0; w < phaseWeeks; w++) {
      const weekNumber = weekCursor + w;
      const isDeload = weekNumber % 14 === 0 && weekNumber !== totalWeeks;
      const focus = isDeload ? applyDeload(template.focus) : template.focus;
      if (isDeload) deloadWeeks.push(weekNumber);
      workouts.push({ week: weekNumber, deload: isDeload, days: fourDaySplit(profile.sport, weekIdx, focus, profile, durationRange) });
      weekIdx++;
    }
    phases.push({
      phase_number: phaseNumber++,
      name: `${template.name} ${Math.floor(blockIdx / BLOCK_TEMPLATE.length) + 1}`,
      weeks: phaseWeeks,
      focus: `${template.focus.reps} rep range, RPE ~${template.focus.rpe}`,
      weekly_structure: `4x/week (Upper A/B, Lower A/B) + conditioning, ${durationRange.min}-${durationRange.max} min/session`,
      workouts
    });
    weekCursor += phaseWeeks;
    blockIdx++;
  }

  return finalizeProgram(profile, phases, deloadWeeks, 'block');
}

function generateConjugate(profile) {
  const totalWeeks = profile.timeline_weeks;
  const durationRange = getDurationRange(profile);
  const deloadWeeks = [];
  const workouts = [];
  for (let w = 1; w <= totalWeeks; w++) {
    const isDeload = w % 7 === 0 && w !== totalWeeks;
    if (isDeload) deloadWeeks.push(w);
    let days = conjugateWeek(profile.sport, w - 1, profile, durationRange);
    if (isDeload) days = days.map(deloadDay);
    workouts.push({ week: w, deload: isDeload, days });
  }
  const phases = [{
    phase_number: 1,
    name: 'Conjugate/Concurrent',
    weeks: totalWeeks,
    focus: 'Max Effort, Dynamic Effort, and Repetition method rotated weekly; primary ME lift rotates every 3 weeks',
    weekly_structure: `Conjugate 4x/week: Max Effort, Dynamic Effort, Repetition, Conditioning, ${durationRange.min}-${durationRange.max} min/session`,
    workouts
  }];
  return finalizeProgram(profile, phases, deloadWeeks, 'conjugate');
}

function generateDUP(profile) {
  const totalWeeks = profile.timeline_weeks;
  const durationRange = getDurationRange(profile);
  const deloadWeeks = [];
  const workouts = [];
  for (let w = 1; w <= totalWeeks; w++) {
    const isDeload = w % 6 === 0 && w !== totalWeeks;
    if (isDeload) deloadWeeks.push(w);
    let days = dupWeek(profile.sport, w - 1, profile, durationRange);
    if (isDeload) days = days.map(deloadDay);
    workouts.push({ week: w, deload: isDeload, days });
  }
  const phases = [{
    phase_number: 1,
    name: 'Daily Undulating Periodization',
    weeks: totalWeeks,
    focus: 'Intensity/volume varies session-to-session across a 3-day rotation to prevent adaptation plateau',
    weekly_structure: `3x/week rotating Hypertrophy / Strength-Hypertrophy / Strength, ${durationRange.min}-${durationRange.max} min/session`,
    workouts
  }];
  return finalizeProgram(profile, phases, deloadWeeks, 'dup');
}

function estimateGains(profile) {
  const growth = Math.min(0.15, 0.03 + profile.timeline_weeks * 0.0025);
  const range = (max) => {
    if (!max) return null;
    const low = Math.round(max * (1 + growth * 0.7));
    const high = Math.round(max * (1 + growth));
    return `${low}-${high} lbs`;
  };
  return {
    squat: range(profile.squat_max),
    bench: range(profile.bench_max),
    deadlift: range(profile.deadlift_max)
  };
}

function finalizeProgram(profile, phases, deloadWeeks, periodizationType) {
  const totalWeeks = profile.timeline_weeks;
  const testingWeek = totalWeeks >= 4 ? totalWeeks - 1 : totalWeeks;
  const finalDeloads = Array.from(new Set([...deloadWeeks, Math.max(1, totalWeeks - 2)])).sort((a, b) => a - b);
  const durationRange = getDurationRange(profile);

  return {
    total_weeks: totalWeeks,
    periodization_type: periodizationType,
    sport: profile.sport,
    workout_duration_min: durationRange.min,
    workout_duration_max: durationRange.max,
    phases,
    deload_weeks: finalDeloads,
    testing_week: testingWeek,
    estimated_strength_gain: estimateGains(profile)
  };
}

function generateProgram(profile) {
  switch ((profile.periodization_type || '').toLowerCase()) {
    case 'block':
      return generateBlock(profile);
    case 'conjugate':
      return generateConjugate(profile);
    case 'dup':
    case 'undulating':
      return generateDUP(profile);
    case 'linear':
    default:
      return generateLinear(profile);
  }
}

module.exports = { generateProgram };
