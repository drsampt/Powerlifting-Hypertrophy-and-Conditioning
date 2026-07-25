const { epley1RM } = require('./loadCalc');

function mean(arr) {
  if (!arr.length) return null;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function stddev(arr) {
  if (arr.length < 2) return 0;
  const m = mean(arr);
  const variance = mean(arr.map(x => (x - m) ** 2));
  return Math.sqrt(variance);
}

function linearRegression(points) {
  // points: [{x, y}]
  const n = points.length;
  if (n < 2) return { slope: 0, intercept: points[0] ? points[0].y : 0 };
  const sumX = points.reduce((a, p) => a + p.x, 0);
  const sumY = points.reduce((a, p) => a + p.y, 0);
  const sumXY = points.reduce((a, p) => a + p.x * p.y, 0);
  const sumX2 = points.reduce((a, p) => a + p.x * p.x, 0);
  const denom = n * sumX2 - sumX * sumX;
  if (denom === 0) return { slope: 0, intercept: sumY / n };
  const slope = (n * sumXY - sumX * sumY) / denom;
  const intercept = (sumY - slope * sumX) / n;
  return { slope, intercept };
}

function buildAnalytics(sessions) {
  const completed = sessions.filter(s => s.completed);

  const byExercise = {};
  for (const s of completed) {
    if (!byExercise[s.exercise]) byExercise[s.exercise] = [];
    byExercise[s.exercise].push(s);
  }

  const exerciseTrends = {};
  for (const [exercise, rows] of Object.entries(byExercise)) {
    const sorted = [...rows].sort((a, b) => a.week_number - b.week_number);
    const est1rms = sorted
      .filter(r => r.actual_weight && r.actual_reps)
      .map(r => ({ week: r.week_number, e1rm: epley1RM(r.actual_weight, r.actual_reps) }));
    const points = est1rms.map(e => ({ x: e.week, y: e.e1rm }));
    const reg = linearRegression(points);
    const lastWeek = points.length ? Math.max(...points.map(p => p.x)) : null;
    exerciseTrends[exercise] = {
      weekly_loads: sorted.map(r => ({ week: r.week_number, prescribed_weight: r.prescribed_weight, actual_weight: r.actual_weight, actual_rpe: r.actual_rpe, prescribed_rpe: r.prescribed_rpe })),
      estimated_1rm_progression: est1rms,
      trend_slope_per_week: reg.slope,
      projected_1rm: lastWeek != null ? Math.round(reg.intercept + reg.slope * (lastWeek + 4)) : null,
      avg_rpe: mean(sorted.filter(r => r.actual_rpe != null).map(r => r.actual_rpe)),
      prescribed_avg_rpe: mean(sorted.filter(r => r.prescribed_rpe != null).map(r => r.prescribed_rpe)),
      rpe_stddev: stddev(sorted.filter(r => r.actual_rpe != null).map(r => r.actual_rpe)),
      total_reps: sorted.reduce((a, r) => a + (r.actual_reps && r.actual_sets ? r.actual_reps * r.actual_sets : 0), 0)
    };
  }

  const byWeek = {};
  for (const s of completed) {
    if (!byWeek[s.week_number]) byWeek[s.week_number] = [];
    byWeek[s.week_number].push(s);
  }
  const weeklyVolume = Object.entries(byWeek)
    .map(([week, rows]) => ({
      week: Number(week),
      volume_load: rows.reduce((a, r) => a + ((r.actual_weight || 0) * (r.actual_reps || 0) * (r.actual_sets || 0)), 0),
      avg_rpe: mean(rows.filter(r => r.actual_rpe != null).map(r => r.actual_rpe)),
      sessions: rows.length
    }))
    .sort((a, b) => a.week - b.week);

  const allRpe = completed.filter(s => s.actual_rpe != null);
  const rpePatterns = {
    avg_actual_rpe: mean(allRpe.map(s => s.actual_rpe)),
    avg_prescribed_rpe: mean(completed.filter(s => s.prescribed_rpe != null).map(s => s.prescribed_rpe)),
    rpe_stddev: stddev(allRpe.map(s => s.actual_rpe)),
    underreporting_flag: mean(allRpe.map(s => s.actual_rpe)) != null && mean(allRpe.map(s => s.actual_rpe)) < mean(completed.filter(s => s.prescribed_rpe != null).map(s => s.prescribed_rpe)) - 1.5
  };

  return {
    total_sessions: completed.length,
    exercise_trends: exerciseTrends,
    weekly_volume: weeklyVolume,
    rpe_patterns: rpePatterns
  };
}

function compareWeeks(sessions, week1, week2) {
  const w1 = sessions.filter(s => s.week_number === Number(week1) && s.completed);
  const w2 = sessions.filter(s => s.week_number === Number(week2) && s.completed);
  const volume = rows => rows.reduce((a, r) => a + ((r.actual_weight || 0) * (r.actual_reps || 0) * (r.actual_sets || 0)), 0);
  const avgRpe = rows => mean(rows.filter(r => r.actual_rpe != null).map(r => r.actual_rpe));
  const v1 = volume(w1);
  const v2 = volume(w2);
  return {
    week1: { week: Number(week1), sessions: w1.length, volume_load: v1, avg_rpe: avgRpe(w1) },
    week2: { week: Number(week2), sessions: w2.length, volume_load: v2, avg_rpe: avgRpe(w2) },
    volume_change_pct: v1 ? Math.round(((v2 - v1) / v1) * 1000) / 10 : null
  };
}

module.exports = { buildAnalytics, compareWeeks, linearRegression, mean, stddev };
