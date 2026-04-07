'use strict';

function calculateExpectedScore(playerElo, opponentElo) {
  return 1 / (1 + Math.pow(10, (opponentElo - playerElo) / 400));
}

function calculateHeadToHeadRatings(winnerElo, loserElo, kFactor) {
  const expectedWinner = calculateExpectedScore(winnerElo, loserElo);
  const expectedLoser = calculateExpectedScore(loserElo, winnerElo);
  const resolvedK = Number.isFinite(kFactor) && kFactor > 0 ? kFactor : 32;

  const nextWinnerElo = Math.max(0, Math.round(winnerElo + (resolvedK * (1 - expectedWinner))));
  const nextLoserElo = Math.max(0, Math.round(loserElo + (resolvedK * (0 - expectedLoser))));

  return {
    winnerElo: nextWinnerElo,
    loserElo: nextLoserElo
  };
}

module.exports = {
  calculateHeadToHeadRatings
};
