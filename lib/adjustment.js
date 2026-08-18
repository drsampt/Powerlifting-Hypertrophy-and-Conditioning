// RPE-based auto-adjustment rules for prescribing the athlete's next load on a given exercise.

const { roundToIncrement } = require('./loadCalc');

/**
 * Determine next-session weight recommendation based on logged actual performance.
 * recentSessions: array of prior logged sessions for this exercise (most recent first), each with actual_rpe.
 */
function computeAdjustment({ actualWeight, actualRpe, prescribedWeight, recentSessions = [], movementChanged = false }) {
  const weight = actualWeight || prescribedWeight;
  let delta = 0;
  let action = 'hold';
  let explanation = '';

  if (movementChanged) {
    return {
      next_weight: roundToIncrement(weight * 0.825),
      action: 'reset',
      explanation: 'Exercise variation changed — resetting load to ~82.5% of prior weight to establish new baseline.'
    };
  }

  if (actualRpe == null) {
    return { next_weight: weight, action: 'hold', explanation: 'No RPE reported — holding weight.' };
  }

  // Two consecutive RPE >= 9 on this exercise: bigger cut + flag technique.
  const lastTwo = recentSessions.slice(0, 1).map(s => s.actual_rpe).concat([actualRpe]);
  const consecutiveHigh = recentSessions.length >= 1 && recentSessions[0].actual_rpe >= 9 && actualRpe >= 9;

  if (consecutiveHigh) {
    delta = -10;
    action = 'reduce';
    explanation = 'RPE ≥9 on two consecutive sessions — reducing 10 lbs and flagging for technique review.';
  } else if (actualRpe <= 5.5) {
    const consecutiveLow = recentSessions.length >= 1 && recentSessions[0].actual_rpe <= 5.5;
    delta = consecutiveLow ? 10 : 5;
    action = 'increase';
    explanation = consecutiveLow
      ? 'RPE consistently ≤5.5 — jumping 10 lbs.'
      : 'RPE ≤5.5 (too easy) — adding 5 lbs.';
  } else if (actualRpe <= 6.5) {
    delta = 5;
    action = 'increase';
    explanation = 'RPE 5.6-6.5 — still manageable, adding 5 lbs.';
  } else if (actualRpe <= 7.5) {
    delta = 0;
    action = 'hold';
    explanation = 'RPE 6.6-7.5 — sweet spot, holding weight (consider +1 rep next session).';
  } else if (actualRpe <= 8.5) {
    delta = 0;
    action = 'hold';
    explanation = 'RPE 7.6-8.5 — dialed in, maintaining weight.';
  } else {
    delta = -5;
    action = 'reduce';
    explanation = 'RPE ≥8.5 — too hard, reducing 5 lbs (or drop 1 set next time).';
  }

  // 3+ consecutive high RPE sessions -> deload flag.
  const lastThree = [actualRpe, ...recentSessions.slice(0, 2).map(s => s.actual_rpe)];
  const deloadFlag = lastThree.length === 3 && lastThree.every(r => r != null && r >= 8.5);

  const next_weight = roundToIncrement(weight + delta);

  return {
    next_weight,
    action,
    explanation,
    deload_recommended: deloadFlag,
    delta
  };
}

module.exports = { computeAdjustment };
