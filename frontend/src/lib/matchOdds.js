// Probabilistic match prediction built on the existing strength pipeline.
//
// The joint goal distribution is modeled as two independent Poissons with
// lambdas from the same calibration used by expectedGoals()/randomGoals(),
// so the "Predict" button and the existing "Randomize" button share one
// underlying model. P(1)/P(X)/P(2) and the modal scoreline are derived by
// summing the joint PMF over the truncated 0..GOAL_CAP grid.

import { expectedGoals, teamStrength } from './standingsCalc.js';

export const GOAL_CAP = 6;
const POISSON_MAX = 30; // beyond GOAL_CAP, lambda tail is negligible

export function poissonPmf(lambda) {
  // e^-λ λ^k / k!, computed iteratively, truncated at POISSON_MAX
  const pmf = new Array(POISSON_MAX + 1);
  let term = Math.exp(-lambda);
  for (let k = 0; k <= POISSON_MAX; k++) {
    pmf[k] = term;
    term *= lambda / (k + 1);
  }
  return pmf;
}

export function predictMatch(homeTeam, awayTeam) {
  const homeStr = teamStrength(homeTeam);
  const awayStr = teamStrength(awayTeam);
  const lambdaHome = expectedGoals(homeStr, awayStr);
  const lambdaAway = expectedGoals(awayStr, homeStr);
  const pmfHome = poissonPmf(lambdaHome);
  const pmfAway = poissonPmf(lambdaAway);

  let pHome = 0;
  let pDraw = 0;
  let pAway = 0;
  let modalHome = 0;
  let modalAway = 0;
  let modalP = -1;

  for (let h = 0; h <= GOAL_CAP; h++) {
    for (let a = 0; a <= GOAL_CAP; a++) {
      const p = pmfHome[h] * pmfAway[a];
      if (h > a) pHome += p;
      else if (h === a) pDraw += p;
      else pAway += p;
      if (p > modalP) {
        modalP = p;
        modalHome = h;
        modalAway = a;
      }
    }
  }

  const total = pHome + pDraw + pAway;
  return {
    pHome: total ? pHome / total : null,
    pDraw: total ? pDraw / total : null,
    pAway: total ? pAway / total : null,
    modal_score: [modalHome, modalAway],
  };
}