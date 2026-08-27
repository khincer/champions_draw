const STORAGE_PREFIX = 'champions_draw_prediction_';
const PLAYER_KEY = 'champions_draw_player_name';

function getStorageKey(seasonId, playerName) {
  return `${STORAGE_PREFIX}${seasonId}_${playerName || 'Guest'}`;
}

export function saveLocal(seasonId, playerName, data, drawSeed) {
  try {
    const key = getStorageKey(seasonId, playerName);
    const existing = loadLocal(seasonId, playerName, drawSeed);
    const merged = { ...existing, ...data, lastUpdated: Date.now(), drawSeed };
    localStorage.setItem(key, JSON.stringify(merged));
    return merged;
  } catch {
    // localStorage might be full or unavailable
  }
}

export function loadLocal(seasonId, playerName, currentDrawSeed) {
  try {
    const key = getStorageKey(seasonId, playerName);
    const raw = localStorage.getItem(key);
    if (!raw) return getDefaultState();
    const data = JSON.parse(raw);
    // If a new draw was run since these predictions were saved, discard them
    if (currentDrawSeed && data.drawSeed && data.drawSeed !== currentDrawSeed) {
      return getDefaultState();
    }
    return data;
  } catch {
    return getDefaultState();
  }
}

export function clearLocal(seasonId, playerName) {
  localStorage.removeItem(getStorageKey(seasonId, playerName));
}

function getDefaultState() {
  return {
    matchPredictions: {},
    playoffPredictions: {},
    knockoutPredictions: {},
    drawSeed: null,
    lastUpdated: 0,
  };
}

export function getPlayerName() {
  return localStorage.getItem(PLAYER_KEY) || '';
}

export function setPlayerName(name) {
  localStorage.setItem(PLAYER_KEY, name);
}

// Merge local and remote data (local wins for unsaved changes)
export function mergePredictionData(local, remote) {
  const result = getDefaultState();
  if (!remote) return local;

  result.matchPredictions = { ...remote.matchPredictions, ...local.matchPredictions };
  result.playoffPredictions = { ...remote.playoffPredictions, ...local.playoffPredictions };
  result.knockoutPredictions = { ...remote.knockoutPredictions, ...local.knockoutPredictions };
  return result;
}
