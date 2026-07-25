// Program generation engine: builds a full periodized program JSON from a training profile.

const { calcWeight } = require('./loadCalc');
const { getSportExercises, getSubstitutions } = require('./exercises');

function lbMax(profile, lift) {
  return { squat: profile.squat_max, bench: profile.bench_max, deadlift: profile.deadlift_max }[lift] || null;
}

// Map a primary movement pattern to the athlete's relevant 1RM (falls back to a generic training max).
function relevantMax(profile, exerciseName) {
  const n = exerciseName.toLowerCase();
  if (n.includes('squat')) return profile.squat_max;
  if (n.includes('bench') || n.includes('press') && !n.includes('log') && !n.includes('push')) return profile.bench_max;
  if (n.includes('deadlift')) return profile.deadlift_max;
  // For sports without direct SBD maxes (strongman/oly/crossfit), estimate from squat/deadlift as anchor.
  if (n.includes('snatch')) return profile.squat_max ? Math.round(profile.squat_max * 0.55) : 135;
  if (n.includes('clean') || n.includes('jerk')) return profile.squat_max ? Math.round(profile.squat_max * 0.7) : 185;
  if (n.includes('log') || n.includes('axle') || n.includes('press')) return profile.bench_max ? Math.round(profile.bench_max * 0.85) : 155;
  if (n.includes('yoke') || n.includes('carry') || n.includes('stone')) return profile.deadlift_max ? Math.round(profile.deadlift_max * 0.9) : 300;
  return profile.squat_max || profile.deadlift_max || profile.bench_max || 135;
}

function buildExercise(name, sets, reps, rpe, profile, cue) {
  const oneRm = relevantMax(profile, name);
  const weight = calcWeight(oneRm, reps, rpe);
  return {
    name,
    sets,
    reps,
    rpe,
    prescribed_weight: weight,
    weight_percentage: oneRm ? Math.round((weight / oneRm) * 100) : null,
    intensity_cues: `RPE ${rpe} = ${Math.max(0, Math.round((10 - rpe) * 2) / 2)} RIR`,
    video_cue: null,
    substitutions: getSubstitutions(name)
  };
}

function accessoryPick(list, seed) {
  return list[seed % list.length];
}

// ---------- Weekly day templates per sport (non-conjugate models) ----------

function fourDaySplit(sport, weekIdx, focus, profile) {
  const lib = getSportExercises(sport);
  const [primary1, primary2, primary3] = lib.primary;
  const days = [];

  days.push({
    day_name: 'Monday',
    workout_type: 'Lower A',
    exercises: [
      buildExercise(primary1 || 'Back Squat', focus.sets, focus.reps, focus.rpe, profile),
      buildExercise(accessoryPick(lib.accessory, weekIdx), 3, 10, focus.rpe - 1, profile),
      buildExercise(accessoryPick(lib.accessory, weekIdx + 1), 3, 12, focus.rpe - 1, profile)
    ]
  });
  days.push({
    day_name: 'Tuesday',
    workout_type: 'Upper A',
    exercises: [
      buildExercise(primary2 || 'Bench Press', focus.sets, focus.reps, focus.rpe, profile),
      buildExercise(accessoryPick(lib.accessory, weekIdx + 2), 3, 10, focus.rpe - 1, profile),
      buildExercise(accessoryPick(lib.accessory, weekIdx + 3), 3, 12, focus.rpe - 1, profile)
    ]
  });
  days.push({
    day_name: 'Thursday',
    workout_type: 'Lower B',
    exercises: [
      buildExercise(primary3 || lib.secondary[0], focus.sets, focus.reps + 1, focus.rpe - 0.5, profile),
      buildExercise(accessoryPick(lib.accessory, weekIdx + 4), 4, 8, focus.rpe - 1, profile),
      buildExercise(accessoryPick(lib.accessory, weekIdx + 5), 3, 15, focus.rpe - 1.5, profile)
    ]
  });
  days.push({
    day_name: 'Friday',
    workout_type: 'Upper B',
    exercises: [
      buildExercise(lib.secondary[1] || primary2, focus.sets, focus.reps + 1, focus.rpe - 0.5, profile),
      buildExercise(accessoryPick(lib.accessory, weekIdx + 6), 4, 8, focus.rpe - 1, profile),
      buildExercise(accessoryPick(lib.accessory, weekIdx + 7), 3, 15, focus.rpe - 1.5, profile)
    ]
  });
  days.push({
    day_name: 'Saturday',
    workout_type: 'Conditioning',
    exercises: [
      { name: accessoryPick(lib.conditioning, weekIdx), sets: 1, reps: null, rpe: 6, prescribed_weight: null, weight_percentage: null, intensity_cues: 'Steady aerobic / EMOM per coach discretion', video_cue: null, substitutions: [] }
    ]
  });
  return days;
}

// ---------- Conjugate model ----------

function conjugateWeek(sport, weekIdx, profile) {
  const lib = getSportExercises(sport);
  const rotation = weekIdx % 3; // rotates primary ME lift every 3 weeks
  const meLifts = [lib.primary[0], lib.secondary[0] || lib.primary[0], lib.primary[Math.min(2, lib.primary.length - 1)]];
  const meLift = meLifts[rotation];
  const deLift = lib.primary[0];
  const repLift = lib.secondary[1] || lib.accessory[0];

  return [
    {
      day_name: 'Monday',
      workout_type: 'Max Effort',
      exercises: [
        buildExercise(meLift, 1, 2, 9, profile, 'Work up to a 1-3RM'),
        buildExercise(accessoryPick(lib.accessory, weekIdx), 4, 8, 7.5, profile),
        buildExercise(accessoryPick(lib.accessory, weekIdx + 1), 3, 12, 7, profile)
      ]
    },
    {
      day_name: 'Wednesday',
      workout_type: 'Dynamic Effort',
      exercises: [
        buildExercise(deLift, 8, 3, 6.5, profile, 'Speed emphasis, 50-60% + bands/chains'),
        buildExercise(accessoryPick(lib.accessory, weekIdx + 2), 4, 10, 7, profile),
        buildExercise(accessoryPick(lib.accessory, weekIdx + 3), 3, 15, 6.5, profile)
      ]
    },
    {
      day_name: 'Friday',
      workout_type: 'Repetition',
      exercises: [
        buildExercise(repLift, 4, 10, 7.5, profile),
        buildExercise(accessoryPick(lib.accessory, weekIdx + 4), 4, 10, 7.5, profile),
        buildExercise(accessoryPick(lib.accessory, weekIdx + 5), 3, 15, 7, profile)
      ]
    },
    {
      day_name: 'Saturday',
      workout_type: 'Conditioning',
      exercises: [
        { name: accessoryPick(lib.conditioning, weekIdx), sets: 1, reps: null, rpe: 6, prescribed_weight: null, weight_percentage: null, intensity_cues: 'GPP / recovery conditioning', video_cue: null, substitutions: [] }
      ]
    }
  ];
}

// ---------- DUP model ----------

function dupWeek(sport, weekIdx, profile) {
  const lib = getSportExercises(sport);
  const types = [
    { name: 'Day A - Hypertrophy', reps: 11, rpe: 6.75, sets: 4 },
    { name: 'Day B - Strength-Hypertrophy', reps: 7, rpe: 7.25, sets: 4 },
    { name: 'Day C - Strength', reps: 4, rpe: 8, sets: 5 }
  ];
  const dayNames = ['Monday', 'Wednesday', 'Friday'];
  return types.map((t, i) => ({
    day_name: dayNames[i],
    workout_type: t.name,
    exercises: [
      buildExercise(lib.primary[i % lib.primary.length], t.sets, t.reps, t.rpe, profile),
      buildExercise(accessoryPick(lib.accessory, weekIdx + i), 3, 10, t.rpe - 1, profile),
      buildExercise(accessoryPick(lib.accessory, weekIdx + i + 3), 3, 12, t.rpe - 1, profile)
    ]
  }));
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

function generateLinear(profile) {
  const totalWeeks = profile.timeline_weeks;
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
      workouts.push({ week: weekNumber, deload: isDeload, days: fourDaySplit(profile.sport, weekIdx, focus, profile) });
      weekIdx++;
    }
    phases.push({
      phase_number: phaseNumber++,
      name: phaseTemplate.name,
      weeks: phaseWeeksRemaining,
      focus: phaseTemplate.description,
      weekly_structure: '4x/week (Upper A/B, Lower A/B) + conditioning',
      workouts
    });
    weekCursor += phaseWeeksRemaining;
  }

  return finalizeProgram(profile, phases, deloadWeeks, 'linear');
}

function generateBlock(profile) {
  const totalWeeks = profile.timeline_weeks;
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
      workouts.push({ week: weekNumber, deload: isDeload, days: fourDaySplit(profile.sport, weekIdx, focus, profile) });
      weekIdx++;
    }
    phases.push({
      phase_number: phaseNumber++,
      name: `${template.name} ${Math.floor(blockIdx / BLOCK_TEMPLATE.length) + 1}`,
      weeks: phaseWeeks,
      focus: `${template.focus.reps} rep range, RPE ~${template.focus.rpe}`,
      weekly_structure: '4x/week (Upper A/B, Lower A/B) + conditioning',
      workouts
    });
    weekCursor += phaseWeeks;
    blockIdx++;
  }

  return finalizeProgram(profile, phases, deloadWeeks, 'block');
}

function generateConjugate(profile) {
  const totalWeeks = profile.timeline_weeks;
  const deloadWeeks = [];
  const workouts = [];
  for (let w = 1; w <= totalWeeks; w++) {
    const isDeload = w % 7 === 0 && w !== totalWeeks;
    if (isDeload) deloadWeeks.push(w);
    let days = conjugateWeek(profile.sport, w - 1, profile);
    if (isDeload) {
      days = days.map(d => ({ ...d, exercises: d.exercises.map(e => ({ ...e, sets: Math.max(1, Math.round((e.sets || 1) * 0.6)), rpe: e.rpe ? Math.max(5, e.rpe - 2) : e.rpe, prescribed_weight: e.prescribed_weight ? Math.round(e.prescribed_weight * 0.85 / 5) * 5 : e.prescribed_weight })) }));
    }
    workouts.push({ week: w, deload: isDeload, days });
  }
  const phases = [{
    phase_number: 1,
    name: 'Conjugate/Concurrent',
    weeks: totalWeeks,
    focus: 'Max Effort, Dynamic Effort, and Repetition method rotated weekly; primary ME lift rotates every 3 weeks',
    weekly_structure: 'Conjugate 4x/week: Max Effort, Dynamic Effort, Repetition, Conditioning',
    workouts
  }];
  return finalizeProgram(profile, phases, deloadWeeks, 'conjugate');
}

function generateDUP(profile) {
  const totalWeeks = profile.timeline_weeks;
  const deloadWeeks = [];
  const workouts = [];
  for (let w = 1; w <= totalWeeks; w++) {
    const isDeload = w % 6 === 0 && w !== totalWeeks;
    if (isDeload) deloadWeeks.push(w);
    let days = dupWeek(profile.sport, w - 1, profile);
    if (isDeload) {
      days = days.map(d => ({ ...d, exercises: d.exercises.map(e => ({ ...e, sets: Math.max(1, Math.round((e.sets || 1) * 0.6)), rpe: e.rpe ? Math.max(5, e.rpe - 2) : e.rpe, prescribed_weight: e.prescribed_weight ? Math.round(e.prescribed_weight * 0.85 / 5) * 5 : e.prescribed_weight })) }));
    }
    workouts.push({ week: w, deload: isDeload, days });
  }
  const phases = [{
    phase_number: 1,
    name: 'Daily Undulating Periodization',
    weeks: totalWeeks,
    focus: 'Intensity/volume varies session-to-session across a 3-day rotation to prevent adaptation plateau',
    weekly_structure: '3x/week rotating Hypertrophy / Strength-Hypertrophy / Strength',
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

  return {
    total_weeks: totalWeeks,
    periodization_type: periodizationType,
    sport: profile.sport,
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
