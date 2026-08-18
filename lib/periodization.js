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

// pl_emphasis: 0-100, how much the program should behave like pure powerlifting (100)
// vs pure bodybuilding (0). Missing/invalid values default to 100 so profiles created
// before this field existed keep behaving exactly as they did.
function plEmphasisValue(profile) {
  const v = Number(profile.pl_emphasis);
  return Number.isFinite(v) ? Math.min(100, Math.max(0, v)) : 100;
}

const WEAK_POINT_MUSCLES = {
  quads: ['quads'],
  posterior_chain: ['hamstrings', 'glutes', 'back'],
  chest: ['chest'],
  back: ['back', 'rear_delts'],
  shoulders_triceps: ['shoulders', 'triceps'],
  arms: ['biceps', 'triceps']
};

function weakPointMuscles(profile) {
  return WEAK_POINT_MUSCLES[profile.weak_point_focus] || null;
}

// Builds one training day: mandatory main lift(s) with warmups, then greedily fills
// accessory work targeting whichever relevant muscle groups are furthest under their
// weekly volume target, stopping once the duration budget is spent. This is why heavy
// main-lift days (long rest between sets) end up with fewer total exercises than
// accessory-heavy days within the same time budget — the constraint is minutes, not a
// fixed exercise count. pl_emphasis shifts how much accessory work gets programmed at
// all (a pure-powerlifting profile stays lean; a powerbuilding-leaning one gets more
// accessories at higher, more hypertrophy-appropriate reps), and weak_point_focus biases
// which muscles get first claim on that accessory time.
function buildDay(dayName, workoutType, mainSpecs, muscleFocus, lib, profile, weekVolume, durationRange, volumeMultiplier, weekIdx, weekUsedNames) {
  const exercises = [];
  let minutes = 0;

  for (const spec of mainSpecs) {
    const ex = buildExercise(spec.name, spec.sets, spec.reps, spec.rpe, profile, { isMain: true });
    exercises.push(ex);
    minutes += minutesForExercise(ex);
    creditVolume(weekVolume, spec.name, ex.sets);
    weekUsedNames.add(spec.name);
  }

  const plEmphasis = plEmphasisValue(profile);
  const focusMuscles = weakPointMuscles(profile);
  const target = getWeeklyVolumeTarget(profile.experience_level);
  const emphasisVolumeBoost = 0.75 + ((100 - plEmphasis) / 100) * 0.55; // 0.75x (pure PL) .. 1.3x (pure BB)
  const accessoryReps = Math.round(15 - (plEmphasis / 100) * 7); // 8 (pure PL) .. 15 (pure BB)
  const mainRpe = mainSpecs[0] ? mainSpecs[0].rpe : 7;
  const accessoryRpe = Math.max(5.5, mainRpe - 1.5);
  // Secondary barbell/dumbbell variants (Front Squat, Close-Grip Bench, etc.) have a real
  // percentage-of-max relationship and keep computed loads when picked as fill-in work;
  // true accessory/isolation work (lib.accessory) stays RPE-only regardless of pick order.
  const secondarySet = new Set(lib.secondary);
  const candidatePool = rotate(Array.from(new Set([...lib.secondary, ...lib.accessory])), weekIdx);

  function deficitScore(name) {
    const muscles = getMuscles(name, movementPattern(name)).filter(m => muscleFocus.includes(m));
    if (!muscles.length) return -Infinity;
    const base = muscles.reduce((sum, m) => sum + Math.max(0, target.max * volumeMultiplier * emphasisVolumeBoost - (weekVolume[m] || 0)), 0);
    const weakPointBonus = focusMuscles && muscles.some(m => focusMuscles.includes(m)) ? 3 : 0;
    return base + weakPointBonus;
  }

  // Real sessions don't spread across a dozen exercises just because there's time left —
  // cap accessory count so leftover time budget goes toward not over-programming the day.
  // A powerbuilding-leaning profile gets a higher cap (more accessory/hypertrophy work is
  // the point); a pure-powerlifting profile stays lean. weekUsedNames (shared across every
  // day in the week) keeps the same accessory from showing up twice in one week.
  const MAX_ACCESSORIES = Math.round(3 + ((100 - plEmphasis) / 100) * 3); // 3 (pure PL) .. 6 (pure BB)
  let accessoryCount = 0;
  let guard = 0;
  while (minutes < durationRange.max && accessoryCount < MAX_ACCESSORIES && guard < 20) {
    guard++;
    const candidates = candidatePool.filter(n => !weekUsedNames.has(n) && deficitScore(n) > -Infinity);
    if (!candidates.length) break;
    candidates.sort((a, b) => deficitScore(b) - deficitScore(a));
    const name = candidates[0];
    if (deficitScore(name) <= 0 && minutes >= durationRange.min) break;

    const ex = buildExercise(name, 3, accessoryReps, accessoryRpe, profile, { noWeight: !secondarySet.has(name) });
    const exMinutes = minutesForExercise(ex);
    if (minutes + exMinutes > durationRange.max) break;

    exercises.push(ex);
    weekUsedNames.add(name);
    minutes += exMinutes;
    accessoryCount++;
    creditVolume(weekVolume, name, ex.sets);
  }

  return { day_name: dayName, workout_type: workoutType, exercises, estimated_minutes: Math.round(minutes) };
}

// ---------- Weekly day templates per sport (non-conjugate models) ----------

function conditioningDay(dayName, lib, weekIdx, label) {
  return {
    day_name: dayName,
    workout_type: 'Conditioning',
    exercises: [
      { name: lib.conditioning[weekIdx % lib.conditioning.length], sets: 1, reps: null, rpe: 6, prescribed_weight: null, weight_percentage: null, intensity_cues: label, video_cue: null, substitutions: [], is_main: false, warmup_sets: [] }
    ],
    estimated_minutes: 20
  };
}

// Generates the weekly split for however many days/week the athlete asked for.
// 3 days: full-body each session (infrequent enough that every session needs to touch
// everything). 4 days: the classic Upper/Lower A/B split. 5 days: Upper/Lower A/B plus a
// dedicated hypertrophy/weak-point day — the extra frequency a powerbuilding-leaning
// profile actually wants, biased toward weak_point_focus if one was chosen.
function daySplit(sport, weekIdx, focus, profile, durationRange) {
  const daysPerWeek = [3, 4, 5].includes(Number(profile.training_days_per_week)) ? Number(profile.training_days_per_week) : 4;
  const lib = getSportExercises(sport);
  const [primary1, primary2, primary3] = lib.primary;
  const mainA = primary1 || 'Back Squat';
  const mainB = primary2 || 'Bench Press';
  const mainC = primary3 || lib.secondary[0];
  const mainD = lib.secondary[1] || primary2;
  const volumeMultiplier = phaseVolumeMultiplier(focus.reps);
  const weekVolume = {};
  const days = [];

  if (daysPerWeek === 3) {
    const mains = [mainA, mainB, mainC];
    const weekUsedNames = new Set(mains);
    const names = ['Full Body A', 'Full Body B', 'Full Body C'];
    ['Monday', 'Wednesday', 'Friday'].forEach((dayName, i) => {
      days.push(buildDay(dayName, names[i],
        [{ name: mains[i], sets: focus.sets, reps: focus.reps, rpe: focus.rpe }],
        ALL_MUSCLES, lib, profile, weekVolume, durationRange, volumeMultiplier, weekIdx + i, weekUsedNames));
    });
    return days;
  }

  if (daysPerWeek === 5) {
    const mains = [mainA, mainB, mainC, mainD];
    const weekUsedNames = new Set(mains);
    const focusMuscles = weakPointMuscles(profile) || ALL_MUSCLES;
    days.push(buildDay('Monday', 'Lower A', [{ name: mainA, sets: focus.sets, reps: focus.reps, rpe: focus.rpe }], [...LOWER_MUSCLES, 'core'], lib, profile, weekVolume, durationRange, volumeMultiplier, weekIdx, weekUsedNames));
    days.push(buildDay('Tuesday', 'Upper A', [{ name: mainB, sets: focus.sets, reps: focus.reps, rpe: focus.rpe }], [...UPPER_MUSCLES, 'core'], lib, profile, weekVolume, durationRange, volumeMultiplier, weekIdx + 1, weekUsedNames));
    days.push(buildDay('Wednesday', 'Hypertrophy / Weak Point', [], focusMuscles, lib, profile, weekVolume, durationRange, volumeMultiplier * 1.2, weekIdx + 2, weekUsedNames));
    days.push(buildDay('Thursday', 'Lower B', [{ name: mainC, sets: focus.sets, reps: focus.reps + 1, rpe: focus.rpe - 0.5 }], [...LOWER_MUSCLES, 'core'], lib, profile, weekVolume, durationRange, volumeMultiplier, weekIdx + 3, weekUsedNames));
    days.push(buildDay('Friday', 'Upper B', [{ name: mainD, sets: focus.sets, reps: focus.reps + 1, rpe: focus.rpe - 0.5 }], [...UPPER_MUSCLES, 'core'], lib, profile, weekVolume, durationRange, volumeMultiplier, weekIdx + 4, weekUsedNames));
    return days;
  }

  // Default: 4 lifting days + a conditioning day.
  const weekUsedNames = new Set([mainA, mainB, mainC, mainD]);
  days.push(buildDay('Monday', 'Lower A', [{ name: mainA, sets: focus.sets, reps: focus.reps, rpe: focus.rpe }], [...LOWER_MUSCLES, 'core'], lib, profile, weekVolume, durationRange, volumeMultiplier, weekIdx, weekUsedNames));
  days.push(buildDay('Tuesday', 'Upper A', [{ name: mainB, sets: focus.sets, reps: focus.reps, rpe: focus.rpe }], [...UPPER_MUSCLES, 'core'], lib, profile, weekVolume, durationRange, volumeMultiplier, weekIdx + 1, weekUsedNames));
  days.push(buildDay('Thursday', 'Lower B', [{ name: mainC, sets: focus.sets, reps: focus.reps + 1, rpe: focus.rpe - 0.5 }], [...LOWER_MUSCLES, 'core'], lib, profile, weekVolume, durationRange, volumeMultiplier, weekIdx + 2, weekUsedNames));
  days.push(buildDay('Friday', 'Upper B', [{ name: mainD, sets: focus.sets, reps: focus.reps + 1, rpe: focus.rpe - 0.5 }], [...UPPER_MUSCLES, 'core'], lib, profile, weekVolume, durationRange, volumeMultiplier, weekIdx + 3, weekUsedNames));
  days.push(conditioningDay('Saturday', lib, weekIdx, 'Steady aerobic / EMOM per coach discretion'));
  return days;
}

// ---------- Conjugate model ----------

function conjugateWeek(sport, weekIdx, profile, durationRange) {
  const lib = getSportExercises(sport);
  const rotation = weekIdx % 3; // rotates primary ME lift every 3 weeks
  const deLift = lib.primary[0];
  const meLifts = [lib.primary[0], lib.secondary[0] || lib.primary[0], lib.primary[Math.min(2, lib.primary.length - 1)]];
  // ME/DE/Rep days must train different lifts within the same week — dedupe against
  // whichever names are already spoken for before falling through to a generic pick.
  let meLift = meLifts[rotation];
  if (meLift === deLift) {
    meLift = lib.secondary.find(n => n !== deLift) || lib.primary.find(n => n !== deLift) || lib.accessory[0];
  }
  const usedMains = new Set([meLift, deLift]);
  let repLift = lib.secondary[1] || lib.accessory[0];
  if (usedMains.has(repLift)) {
    repLift = lib.secondary.find(n => !usedMains.has(n)) || lib.accessory.find(n => !usedMains.has(n)) || repLift;
  }
  const weekVolume = {};
  // Reserve all three main lifts before any accessory picking starts (same reasoning as
  // fourDaySplit) so Monday's accessory loop can't grab Wednesday's or Friday's main lift.
  const weekUsedNames = new Set([meLift, deLift, repLift]);

  const days = [
    buildDay('Monday', 'Max Effort',
      [{ name: meLift, sets: 1, reps: 2, rpe: 9 }],
      dayFocusMuscles(meLift), lib, profile, weekVolume, durationRange, phaseVolumeMultiplier(2), weekIdx, weekUsedNames),
    buildDay('Wednesday', 'Dynamic Effort',
      [{ name: deLift, sets: 8, reps: 3, rpe: 6.5 }],
      dayFocusMuscles(deLift), lib, profile, weekVolume, durationRange, phaseVolumeMultiplier(3), weekIdx + 1, weekUsedNames),
    buildDay('Friday', 'Repetition',
      [{ name: repLift, sets: 4, reps: 10, rpe: 7.5 }],
      dayFocusMuscles(repLift), lib, profile, weekVolume, durationRange, phaseVolumeMultiplier(10), weekIdx + 2, weekUsedNames)
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
  // Draw from primary+secondary combined so sports with <3 primary lifts (e.g.
  // weightlifting: Snatch, Clean and Jerk) still get 3 distinct main lifts across the
  // week instead of wrapping back to day A's lift on day C.
  const mainPool = Array.from(new Set([...lib.primary, ...lib.secondary]));
  const mainLifts = types.map((t, i) => mainPool[i % mainPool.length]);
  // Reserve all three main lifts upfront (same reasoning as fourDaySplit/conjugateWeek).
  const weekUsedNames = new Set(mainLifts);
  return types.map((t, i) => {
    const mainLift = mainLifts[i];
    return buildDay(dayNames[i], t.name,
      [{ name: mainLift, sets: t.sets, reps: t.reps, rpe: t.rpe }],
      dayFocusMuscles(mainLift), lib, profile, weekVolume, durationRange, phaseVolumeMultiplier(t.reps), weekIdx + i, weekUsedNames);
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

// ---------- Peaking: overreach + taper (JTS/sport-science peaking principles) ----------
//
// Fatigue masks fitness, and training reps (3-5RM) are not fully specific to a 1RM
// attempt. So the weeks before a test/meet do three things: (1) briefly overreach to
// push fitness a bit higher, (2) taper by cutting volume first and intensity second
// (volume drives fatigue; intensity is what preserves strength), and (3) narrow
// specificity down to the competition lifts at low reps, since a 1RM is a distinct
// skill from a 5RM. Taper length and how hard the overreach hits both scale with the
// athlete's size/experience — bigger, more advanced lifters disrupt homeostasis more
// and need longer to shed that fatigue.
const TAPER_WEEKS_BY_EXPERIENCE = { novice: 1, intermediate: 2, advanced: 3, elite: 4 };

// Bigger lifts/lighter body segments recover fatigue faster, so deadlift-pattern work
// backs off earliest, squats next, and bench/press-pattern work is trained heaviest for
// longest — mirrors the "deadlift 2.5wk out, squat 2wk out, bench 1.5wk out" staggering.
function liftTaperOffset(name) {
  const pattern = movementPattern(name);
  if (pattern === 'hinge') return 1;
  if (pattern === 'press') return -1;
  return 0;
}

function overreachExercise(e) {
  if (!e.is_main) return e;
  const sets = Math.round(e.sets * 1.3);
  return { ...e, sets, warmup_sets: e.warmup_sets };
}

function overreachDay(day) {
  const exercises = day.exercises.map(overreachExercise);
  return { ...day, exercises, estimated_minutes: Math.round(minutesForDay({ exercises })) };
}

// weeksOut: how many weeks before the test this exercise's day falls, already adjusted
// for that lift's taper offset. <=0 means "peak week" (heaviest, lowest volume/reps).
// keepAccessory: a powerbuilding-leaning profile doesn't taper as hard as a competition
// powerlifter — one non-main exercise per day survives at reduced, muscle-maintenance
// volume instead of every accessory dropping out, except on peak week itself, where
// specificity for the actual test still wins regardless of emphasis.
function taperExercise(e, weeksOut, keepAccessory) {
  if (!e.is_main) {
    if (!keepAccessory || weeksOut <= 0) return null;
    return { ...e, sets: Math.max(1, Math.round(e.sets * 0.5)) };
  }

  const oneRm = e.weight_percentage && e.prescribed_weight ? e.prescribed_weight / (e.weight_percentage / 100) : null;
  const reps = weeksOut <= 0 ? 1 : weeksOut === 1 ? 2 : 3;
  const rpe = Math.min(9.5, 8 + (3 - Math.min(3, Math.max(0, weeksOut))) * 0.5);
  const sets = Math.max(1, Math.round(e.sets * (weeksOut <= 0 ? 0.4 : weeksOut === 1 ? 0.55 : 0.7)));
  const prescribed_weight = oneRm ? calcWeight(oneRm, reps, rpe) : e.prescribed_weight;

  return {
    ...e,
    sets,
    reps,
    rpe,
    prescribed_weight,
    weight_percentage: oneRm && prescribed_weight ? Math.round((prescribed_weight / oneRm) * 100) : e.weight_percentage,
    intensity_cues: `RPE ${rpe} = ${Math.max(0, Math.round((10 - rpe) * 2) / 2)} RIR (peaking)`,
    warmup_sets: prescribed_weight ? generateWarmupSets(prescribed_weight) : e.warmup_sets
  };
}

function taperDay(day, weeksOut, plEmphasis) {
  // Powerbuilding/power-combo profiles (pl_emphasis < 60) keep one accessory per day
  // during the taper for muscle maintenance; a pure powerlifter narrows to just the
  // main lift(s), same as before.
  const keepBudget = plEmphasis < 60 ? 1 : 0;
  let kept = 0;
  const exercises = day.exercises
    .map(e => {
      const keepAccessory = !e.is_main && kept < keepBudget;
      const result = taperExercise(e, weeksOut + liftTaperOffset(e.name), keepAccessory);
      if (result && !e.is_main) kept++;
      return result;
    })
    .filter(Boolean);
  if (!exercises.length) return { ...day, exercises, estimated_minutes: 0 };
  return { ...day, exercises, estimated_minutes: Math.round(minutesForDay({ exercises })) };
}

// Mutates phases in place: applies overreach to the week before the taper window, and
// volume-first/intensity-second tapering with narrowing specificity through the taper
// window, overriding any deload that would otherwise land on those same weeks.
function applyPeaking(phases, testingWeek, experienceLevel, deloadWeeks, plEmphasis) {
  const taperWeeks = TAPER_WEEKS_BY_EXPERIENCE[experienceLevel] || TAPER_WEEKS_BY_EXPERIENCE.intermediate;
  const taperStart = Math.max(1, testingWeek - taperWeeks + 1);
  const overreachWeek = taperStart - 1;
  const peakedWeeks = new Set();

  for (const phase of phases) {
    for (const workout of phase.workouts) {
      if (workout.week === overreachWeek && overreachWeek >= 1) {
        workout.days = workout.days.map(overreachDay);
        workout.overreach = true;
        peakedWeeks.add(workout.week);
      } else if (workout.week >= taperStart && workout.week <= testingWeek) {
        const weeksOut = testingWeek - workout.week;
        workout.days = workout.days.map(d => taperDay(d, weeksOut, plEmphasis));
        workout.taper = true;
        workout.deload = false;
        peakedWeeks.add(workout.week);
      }
    }
  }

  return {
    taperStart,
    overreachWeek,
    deloadWeeks: deloadWeeks.filter(w => !peakedWeeks.has(w))
  };
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
      workouts.push({ week: weekNumber, deload: isDeload, days: daySplit(profile.sport, weekIdx, focus, profile, durationRange) });
      weekIdx++;
    }
    phases.push({
      phase_number: phaseNumber++,
      name: phaseTemplate.name,
      weeks: phaseWeeksRemaining,
      focus: phaseTemplate.description,
      weekly_structure: `${[3,4,5].includes(Number(profile.training_days_per_week)) ? Number(profile.training_days_per_week) : 4}x/week split, ${durationRange.min}-${durationRange.max} min/session`,
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
      workouts.push({ week: weekNumber, deload: isDeload, days: daySplit(profile.sport, weekIdx, focus, profile, durationRange) });
      weekIdx++;
    }
    phases.push({
      phase_number: phaseNumber++,
      name: `${template.name} ${Math.floor(blockIdx / BLOCK_TEMPLATE.length) + 1}`,
      weeks: phaseWeeks,
      focus: `${template.focus.reps} rep range, RPE ~${template.focus.rpe}`,
      weekly_structure: `${[3,4,5].includes(Number(profile.training_days_per_week)) ? Number(profile.training_days_per_week) : 4}x/week split, ${durationRange.min}-${durationRange.max} min/session`,
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
  const durationRange = getDurationRange(profile);

  const peaking = applyPeaking(phases, testingWeek, profile.experience_level, deloadWeeks, plEmphasisValue(profile));
  const finalDeloads = Array.from(new Set([...peaking.deloadWeeks, Math.max(1, totalWeeks - 2)]))
    .filter(w => w < peaking.taperStart || w > testingWeek)
    .sort((a, b) => a - b);

  return {
    total_weeks: totalWeeks,
    periodization_type: periodizationType,
    sport: profile.sport,
    goal_type: profile.goal_type || 'powerlifting',
    pl_emphasis: plEmphasisValue(profile),
    training_days_per_week: [3, 4, 5].includes(Number(profile.training_days_per_week)) ? Number(profile.training_days_per_week) : 4,
    weak_point_focus: profile.weak_point_focus || null,
    workout_duration_min: durationRange.min,
    workout_duration_max: durationRange.max,
    phases,
    deload_weeks: finalDeloads,
    testing_week: testingWeek,
    overreach_week: peaking.overreachWeek >= 1 ? peaking.overreachWeek : null,
    taper_weeks: Array.from({ length: testingWeek - peaking.taperStart + 1 }, (_, i) => peaking.taperStart + i),
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
