// Load calculation, RPE% tables, and rounding utilities.

// % of 1RM by reps at a given RPE, derived from standard RPE/RIR charts (Mike Tuchscherer / Justin Harris tables).
// Table keyed by RPE (rounded to nearest 0.5) then reps (1-12).
const RPE_TABLE = {
  10: { 1: 100, 2: 95.5, 3: 92.2, 4: 89.2, 5: 86.3, 6: 83.7, 7: 81.1, 8: 78.6, 9: 76.2, 10: 73.9, 11: 71.7, 12: 69.6 },
  9.5: { 1: 97.8, 2: 93.9, 3: 90.7, 4: 87.8, 5: 85.0, 6: 82.4, 7: 79.9, 8: 77.4, 9: 75.1, 10: 72.8, 11: 70.7, 12: 68.6 },
  9: { 1: 95.5, 2: 92.2, 3: 89.2, 4: 86.3, 5: 83.7, 6: 81.1, 7: 78.6, 8: 76.2, 9: 73.9, 10: 71.7, 11: 69.6, 12: 67.6 },
  8.5: { 1: 93.9, 2: 90.7, 3: 87.8, 4: 85.0, 5: 82.4, 6: 79.9, 7: 77.4, 8: 75.1, 9: 72.8, 10: 70.7, 11: 68.6, 12: 66.6 },
  8: { 1: 92.2, 2: 89.2, 3: 86.3, 4: 83.7, 5: 81.1, 6: 78.6, 7: 76.2, 8: 73.9, 9: 71.7, 10: 69.6, 11: 67.6, 12: 65.6 },
  7.5: { 1: 90.7, 2: 87.8, 3: 85.0, 4: 82.4, 5: 79.9, 6: 77.4, 7: 75.1, 8: 72.8, 9: 70.7, 10: 68.6, 11: 66.6, 12: 64.7 },
  7: { 1: 89.2, 2: 86.3, 3: 83.7, 4: 81.1, 5: 78.6, 6: 76.2, 7: 73.9, 8: 71.7, 9: 69.6, 10: 67.6, 11: 65.6, 12: 63.7 },
  6.5: { 1: 87.8, 2: 85.0, 3: 82.4, 4: 79.9, 5: 77.4, 6: 75.1, 7: 72.8, 8: 70.7, 9: 68.6, 10: 66.6, 11: 64.7, 12: 62.9 },
  6: { 1: 86.3, 2: 83.7, 3: 81.1, 4: 78.6, 5: 76.2, 6: 73.9, 7: 71.7, 8: 69.6, 9: 67.6, 10: 65.6, 11: 63.7, 12: 61.9 }
};

function nearestHalf(n) {
  return Math.round(n * 2) / 2;
}

function percentForRepsRpe(reps, rpe) {
  const r = Math.min(Math.max(nearestHalf(rpe), 6), 10);
  const table = RPE_TABLE[r] || RPE_TABLE[7.5];
  const repKey = Math.min(Math.max(Math.round(reps), 1), 12);
  return table[repKey] || table[Math.min(repKey, 12)];
}

// Round to nearest usable plate increment (5 lb default for barbell work).
function roundToIncrement(weight, increment = 5) {
  return Math.round(weight / increment) * increment;
}

function calcWeight(oneRm, reps, rpe, increment = 5) {
  if (!oneRm || oneRm <= 0) return null;
  const pct = percentForRepsRpe(reps, rpe);
  return roundToIncrement(oneRm * (pct / 100), increment);
}

// RIR = 10 - RPE (roughly, at RPE scale 6-10)
function rirFromRpe(rpe) {
  return Math.max(0, 10 - rpe);
}

function epley1RM(weight, reps) {
  if (reps <= 1) return weight;
  return Math.round(weight * (1 + reps / 30));
}

module.exports = { percentForRepsRpe, calcWeight, roundToIncrement, rirFromRpe, epley1RM, nearestHalf };
