import React, { createContext, useContext, useReducer, useEffect, useRef, useCallback, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  FlatList,
  Alert,
  Dimensions,
  Animated,
  SafeAreaView,
  StatusBar,
  Image,
  Platform,
  ActivityIndicator
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { LinearGradient } from 'expo-linear-gradient';
import { BannerAd, BannerAdSize, TestIds } from 'react-native-google-mobile-ads';
import ConfettiCannon from 'react-native-confetti-cannon';
import * as Haptics from 'expo-haptics';
import { PanGestureHandler, State, GestureHandlerRootView } from 'react-native-gesture-handler';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAudioPlayer, setAudioModeAsync } from 'expo-audio';
import * as StoreReview from 'expo-store-review';
import Purchases, { LOG_LEVEL } from 'react-native-purchases';

/**
 * GridZen2 — App.js
 * Changes in this version:
 * - Full RevenueCat integration for $0.99 "Remove Ads" non-consumable IAP.
 * - isAdFree state: when true, BannerAd is hidden on GameScreen.
 * - "Remove Ads" button on MenuScreen, hidden once ad-free.
 * - Standalone "Restore Purchases" button on MenuScreen per App Store Guideline 3.1.1.
 *   Must be visible without any additional taps to guarantee approval.
 * - Both buttons show ActivityIndicator and are disabled while loading.
 * - handlePurchase searches all offerings by product identifier to avoid
 *   returning the wrong app's LIFETIME package when multiple apps share
 *   the same RevenueCat offering.
 */

// ============================================================================
// RevenueCat API Keys
// ============================================================================
const RC_IOS_KEY = 'appl_ohosUOPhoINxIlgwRxknpiLRUBj';
const RC_ANDROID_KEY = 'goog_OaGoOFcgQEZorbrWrqLZJXlszEk';
const ENTITLEMENT_ID = 'ad_free';
const PRODUCT_ID = 'com.steveomatic.gridzen2.removeads';

// ============================================================================
// Constants & Helpers
// ============================================================================
const { width: SCREEN_WIDTH } = Dimensions.get('window');

const GAME_ACTIONS = {
  SET_GAME_PHASE: 'SET_GAME_PHASE',
  SET_GAME_MODE: 'SET_GAME_MODE',
  START_NEW_GAME: 'START_NEW_GAME',
  SET_GRID_DATA: 'SET_GRID_DATA',
  SET_GRID_SIZE: 'SET_GRID_SIZE',
  SWAP_TILES: 'SWAP_TILES',
  COMPLETE_ROW: 'COMPLETE_ROW',
  ADD_POWER_UP: 'ADD_POWER_UP',
  USE_POWER_UP: 'USE_POWER_UP',
  CLEAR_POWER_UPS: 'CLEAR_POWER_UPS',
  SET_FREE_MOVES: 'SET_FREE_MOVES',
  CONSUME_FREE_MOVE: 'CONSUME_FREE_MOVE',
  SET_HINT_ROW: 'SET_HINT_ROW',
  CLEAR_HINT_ROW: 'CLEAR_HINT_ROW',
  INCREMENT_MOVES: 'INCREMENT_MOVES',
  DECREMENT_TIME: 'DECREMENT_TIME',
  SET_TIME: 'SET_TIME',
  PAUSE_GAME: 'PAUSE_GAME',
  RESUME_GAME: 'RESUME_GAME',
  SHOW_PANEL: 'SHOW_PANEL',
  HIDE_PANEL: 'HIDE_PANEL',
  SHOW_STRATEGIC_WARNING: 'SHOW_STRATEGIC_WARNING',
  HIDE_STRATEGIC_WARNING: 'HIDE_STRATEGIC_WARNING',
  SET_DARK_THEME: 'SET_DARK_THEME',
  SET_MUSIC_ENABLED: 'SET_MUSIC_ENABLED',
  SAVE_HIGH_SCORE: 'SAVE_HIGH_SCORE',
  LOAD_LEADERBOARDS: 'LOAD_LEADERBOARDS',
};

// Time budget scales with grid size. 60s for 4x4 is generous; 60s for 6x6
// is brutal. Each step up gets more time but stays beatable.
const TIME_FOR_SIZE = { 4: 60, 5: 90, 6: 130 };
const MAX_POWER_UPS = 5;

const INITIAL_STATE = {
  gamePhase: 'menu',
  gameMode: 'classic',
  gridData: [],
  gridSize: 4,
  moveCount: 0,
  timeRemaining: 60,
  isGameActive: false,
  isGamePaused: false,
  completedRows: new Set(),
  lockedTiles: new Set(),
  rowCompletionStreak: 0,
  availablePowerUps: [],
  activePowerUp: null,
  freeMovesRemaining: 0,
  hintRowIndex: null,
  isDarkTheme: false,
  musicEnabled: true,
  visiblePanel: null,
  strategicWarningVisible: false,
  strategicWarningShown: false,
  leaderboards: {
    classic: { '4x4': [], '5x5': [], '6x6': [] },
    color: { '4x4': [], '5x5': [], '6x6': [] },
    pattern: { '4x4': [], '5x5': [], '6x6': [] }
  }
};

const POWER_UP_CONFIG = {
  FREEZE_TIME: { icon: '❄️', name: 'Time Freeze', description: '+15s', effect: 15 },
  TELEPORT_SWAP: { icon: '🌀', name: 'Teleport', description: 'Smart auto-swap', effect: 1 },
  AUTO_COMPLETE: { icon: '✨', name: 'Auto-Complete', description: 'Fix 2 tiles', effect: 2 },
  FREE_MOVES: { icon: '⚡', name: 'Free Moves', description: '3 free moves', effect: 3 },
  ROW_HINT: { icon: '🎯', name: 'Row Hint', description: 'Highlight best row', effect: 1 }
};

const vibrantColors = [
  '#FF3B30', '#FF6B1A', '#FFB300', '#34C759',
  '#00D1FF', '#007AFF', '#AF52DE', '#FF2D92',
  '#00E1B4', '#4ECDC4', '#45B7D1', '#16A085',
  '#F7DC6F', '#96CEB4', '#98D8C8', '#5AC8FA'
];

const gradientForMode = (mode) => {
  if (mode === 'classic') return ['#ff512f', '#f09819', '#ff5f6d'];
  if (mode === 'color') return ['#36d1dc', '#5b86e5', '#23a6d5'];
  return ['#7F00FF', '#E100FF', '#6A11CB'];
};

const makeTheme = (isDark) => ({
  bg: isDark ? '#0c0c0f' : '#ffffff',
  text: isDark ? '#f4f4f7' : '#111',
  subText: isDark ? '#cfcfd6' : '#555',
  chipBg: isDark ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.06)',
  chipText: isDark ? '#fff' : '#333',
  headerShadow: isDark ? 'rgba(0,0,0,0.7)' : 'rgba(0,0,0,0.35)',
  card: isDark ? '#15151a' : '#f3f3f7',
  button: '#FF3B30',
  buttonText: '#fff',
});

const GameContext = createContext(null);
export const useGameState = () => {
  const ctx = useContext(GameContext);
  if (!ctx) throw new Error('useGameState must be used within GameContext');
  return ctx;
};

// ============================================================================
// Reducer
// ============================================================================
function gameStateReducer(state, action) {
  switch (action.type) {
    case GAME_ACTIONS.SET_GAME_PHASE:
      return { ...state, gamePhase: action.payload };
    case GAME_ACTIONS.SET_GAME_MODE:
      return { ...state, gameMode: action.payload };
    case GAME_ACTIONS.SET_GRID_SIZE:
      return { ...state, gridSize: action.payload };
    case GAME_ACTIONS.SET_GRID_DATA:
      return { ...state, gridData: action.payload };
    case GAME_ACTIONS.SWAP_TILES: {
      const newGrid = state.gridData.slice();
      const { fromIndex, toIndex } = action.payload;
      const tmp = newGrid[fromIndex];
      newGrid[fromIndex] = { ...newGrid[toIndex], currentIndex: fromIndex };
      newGrid[toIndex] = { ...tmp, currentIndex: toIndex };
      return { ...state, gridData: newGrid };
    }
    case GAME_ACTIONS.INCREMENT_MOVES:
      return { ...state, moveCount: state.moveCount + 1 };
    case GAME_ACTIONS.COMPLETE_ROW: {
      const r = action.payload.rowIndex;
      const completedRows = new Set(state.completedRows);
      completedRows.add(r);
      const lockedTiles = new Set(state.lockedTiles);
      for (let c = 0; c < state.gridSize; c++) lockedTiles.add(r * state.gridSize + c);
      return { ...state, completedRows, lockedTiles, rowCompletionStreak: state.rowCompletionStreak + 1 };
    }
    case GAME_ACTIONS.ADD_POWER_UP: {
      const next = state.availablePowerUps.concat([action.payload]);
      // Cap at MAX_POWER_UPS so the chip rail never overflows; drop oldest.
      return { ...state, availablePowerUps: next.slice(-MAX_POWER_UPS) };
    }
    case GAME_ACTIONS.USE_POWER_UP:
      return { ...state, availablePowerUps: state.availablePowerUps.filter(p => p.id !== action.payload.id), activePowerUp: action.payload.type };
    case GAME_ACTIONS.CLEAR_POWER_UPS:
      return { ...state, availablePowerUps: [], activePowerUp: null };
    case GAME_ACTIONS.SET_FREE_MOVES:
      return { ...state, freeMovesRemaining: state.freeMovesRemaining + action.payload };
    case GAME_ACTIONS.CONSUME_FREE_MOVE:
      return { ...state, freeMovesRemaining: Math.max(0, state.freeMovesRemaining - 1) };
    case GAME_ACTIONS.SET_HINT_ROW:
      return { ...state, hintRowIndex: action.payload };
    case GAME_ACTIONS.CLEAR_HINT_ROW:
      return { ...state, hintRowIndex: null };
    case GAME_ACTIONS.DECREMENT_TIME:
      return { ...state, timeRemaining: Math.max(0, state.timeRemaining - 1) };
    case GAME_ACTIONS.SET_TIME:
      return { ...state, timeRemaining: action.payload };
    case GAME_ACTIONS.PAUSE_GAME:
      return { ...state, isGamePaused: true, isGameActive: false };
    case GAME_ACTIONS.RESUME_GAME:
      return { ...state, isGamePaused: false, isGameActive: true };
    case GAME_ACTIONS.START_NEW_GAME:
      return {
        ...state,
        gamePhase: 'playing',
        isGameActive: true,
        isGamePaused: false,
        moveCount: 0,
        completedRows: new Set(),
        lockedTiles: new Set(),
        rowCompletionStreak: 0,
        availablePowerUps: [],
        activePowerUp: null,
        freeMovesRemaining: 0,
        hintRowIndex: null,
        strategicWarningVisible: false,
        strategicWarningShown: false,
      };
    case GAME_ACTIONS.SHOW_PANEL:
      return { ...state, visiblePanel: action.payload };
    case GAME_ACTIONS.HIDE_PANEL:
      return { ...state, visiblePanel: null };
    case GAME_ACTIONS.SHOW_STRATEGIC_WARNING:
      return { ...state, strategicWarningVisible: true, strategicWarningShown: true };
    case GAME_ACTIONS.HIDE_STRATEGIC_WARNING:
      return { ...state, strategicWarningVisible: false };
    case GAME_ACTIONS.SET_DARK_THEME:
      return { ...state, isDarkTheme: !!action.payload };
    case GAME_ACTIONS.SET_MUSIC_ENABLED:
      return { ...state, musicEnabled: !!action.payload };
    case GAME_ACTIONS.SAVE_HIGH_SCORE: {
      const { gameMode, gridSize, score } = action.payload;
      const newLeaderboards = {
        classic: { ...state.leaderboards.classic },
        color: { ...state.leaderboards.color },
        pattern: { ...state.leaderboards.pattern }
      };
      const key = `${gridSize}x${gridSize}`;
      const board = (newLeaderboards[gameMode][key] || []).slice();
      board.push(score);
      board.sort((a, b) => a.moves - b.moves || a.time - b.time);
      newLeaderboards[gameMode][key] = board.slice(0, 10);
      return { ...state, leaderboards: newLeaderboards };
    }
    case GAME_ACTIONS.LOAD_LEADERBOARDS:
      return { ...state, leaderboards: action.payload };
    default:
      return state;
  }
}

// ============================================================================
// Grid helpers
// ============================================================================
const generateTileColors = (count) => {
  const out = [];
  for (let i = 0; i < count; i++) out.push(vibrantColors[i % vibrantColors.length]);
  return out;
};

const generatePatterns = (gridSize) => {
  const all = [
    { symbol: '●●●', name: 'dots', color: '#FF3B30' },
    { symbol: '|||', name: 'stripes', color: '#007AFF' },
    { symbol: '~~~', name: 'waves', color: '#34C759' },
    { symbol: '▓▓▓', name: 'grid', color: '#FF9500' },
    { symbol: '◆◇◆', name: 'diamond', color: '#AF52DE' },
    { symbol: '✕✕✕', name: 'cross', color: '#FF2D92' }
  ];
  return all.slice(0, gridSize);
};

const createGridData = (size, gameMode, isShuffled = true) => {
  const total = size * size;

  if (gameMode === 'classic') {
    const colors = generateTileColors(total);
    const numbers = Array.from({ length: total }, (_, i) => i + 1);
    if (isShuffled) {
      for (let i = numbers.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [numbers[i], numbers[j]] = [numbers[j], numbers[i]];
      }
    }
    return numbers.map((number, index) => ({
      id: `tile-${index}`,
      number,
      color: colors[number - 1],
      originalIndex: number - 1,
      currentIndex: index,
      gameMode: 'classic'
    }));
  }

  if (gameMode === 'color') {
    const rowColors = generateTileColors(size);
    const tiles = [];
    for (let i = 0; i < total; i++) {
      const rowIndex = Math.floor(i / size);
      tiles.push({
        id: `tile-${i}`,
        color: rowColors[rowIndex],
        targetColor: rowColors[rowIndex],
        currentIndex: i,
        gameMode: 'color'
      });
    }
    if (isShuffled) {
      for (let i = tiles.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [tiles[i], tiles[j]] = [tiles[j], tiles[i]];
        tiles[i] = { ...tiles[i], currentIndex: i };
        tiles[j] = { ...tiles[j], currentIndex: j };
      }
    }
    return tiles;
  }

  // pattern — each row gets one repeated symbol
  const patterns = generatePatterns(size);
  const tiles = [];
  for (let row = 0; row < size; row++) {
    for (let col = 0; col < size; col++) {
      const idx = row * size + col;
      tiles.push({
        id: `tile-${idx}`,
        pattern: patterns[row],
        targetRow: row,
        currentIndex: idx,
        gameMode: 'pattern'
      });
    }
  }
  if (isShuffled) {
    for (let i = tiles.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [tiles[i], tiles[j]] = [tiles[j], tiles[i]];
      tiles[i] = { ...tiles[i], currentIndex: i };
      tiles[j] = { ...tiles[j], currentIndex: j };
    }
  }
  return tiles;
};

const checkRowCompletion = (gridData, gridSize, rowIndex, mode) => {
  const start = rowIndex * gridSize;
  const row = gridData.slice(start, start + gridSize);
  if (mode === 'classic') {
    return row.every((tile, col) => tile.number === start + col + 1);
  }
  if (mode === 'color') {
    const tgt = row[0].targetColor;
    return row.every(tile => tile.color === tgt);
  }
  // pattern: all tiles in the row must share the same symbol
  const firstName = row[0].pattern.name;
  return row.every(t => t.pattern.name === firstName);
};

function checkStrategicError(completedRows, gridSize) {
  if (!completedRows || completedRows.size === 0) return false;
  const rows = Array.from(completedRows).sort((a, b) => a - b);
  const isTopPrefix = rows[0] === 0 && rows.every((r, i) => r === i);
  if (isTopPrefix) return false;
  const m = rows.length;
  const isBottomSuffix = rows[m - 1] === gridSize - 1 &&
    rows.every((r, i) => r === (gridSize - m + i));
  if (isBottomSuffix) return false;
  return rows.some(r => r > 0 && r < gridSize - 1);
}

// Pure evaluation of a grid against its mode. Returns which rows are newly
// complete, whether the whole grid is a win, and whether the player has
// triggered a strategic error. Used by both swipe-swaps and power-up swaps
// so they share one truth path.
const evaluateGrid = (newGrid, gridSize, gameMode, prevCompletedRows) => {
  const after = new Set(prevCompletedRows);
  const newlyCompleted = [];
  for (let r = 0; r < gridSize; r++) {
    if (!after.has(r) && checkRowCompletion(newGrid, gridSize, r, gameMode)) {
      after.add(r);
      newlyCompleted.push(r);
    }
  }
  let isWin = true;
  for (let r = 0; r < gridSize; r++) {
    if (!checkRowCompletion(newGrid, gridSize, r, gameMode)) { isWin = false; break; }
  }
  return {
    completedRowsAfter: after,
    newlyCompleted,
    isWin,
    isStrategicError: !isWin && checkStrategicError(after, gridSize),
  };
};

// Apply a swap to a grid array immutably and return the new array.
const applySwap = (grid, fromIndex, toIndex) => {
  const next = grid.slice();
  const tmp = next[fromIndex];
  next[fromIndex] = { ...next[toIndex], currentIndex: fromIndex };
  next[toIndex] = { ...tmp, currentIndex: toIndex };
  return next;
};

// ============================================================================
// Hooks
// ============================================================================
const useGameTimer = (state, dispatch) => {
  const tRef = useRef(null);
  useEffect(() => {
    if (state.gamePhase === 'playing' && !state.isGamePaused && state.timeRemaining > 0) {
      tRef.current = setTimeout(() => dispatch({ type: GAME_ACTIONS.DECREMENT_TIME }), 1000);
    } else if (state.timeRemaining === 0 && state.gamePhase === 'playing') {
      dispatch({ type: GAME_ACTIONS.SET_GAME_PHASE, payload: 'gameOver' });
    }
    return () => { if (tRef.current) clearTimeout(tRef.current); };
  }, [state.gamePhase, state.timeRemaining, state.isGamePaused, dispatch]);
};

const useHaptic = () => useCallback((kind = 'light') => {
  try {
    switch (kind) {
      case 'light': Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); break;
      case 'medium': Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); break;
      case 'heavy': Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy); break;
      case 'success': Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success); break;
      case 'error': Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error); break;
      default: break;
    }
  } catch { }
}, []);

// Shared post-change evaluation. Whenever the grid changes (via swipe OR
// power-up), call this with the new grid + the completed-rows set known
// *before* the change. It dispatches the right reducer actions for newly
// completed rows, win state, and strategic-error state. Power-ups previously
// skipped this path, so completing a row via Auto-Complete / Teleport never
// registered a win.
const useGameEvaluation = (state, dispatch, trigger) => {
  return useCallback((newGrid, prevCompletedRows) => {
    const result = evaluateGrid(newGrid, state.gridSize, state.gameMode, prevCompletedRows);

    for (const r of result.newlyCompleted) {
      trigger('success');
      dispatch({ type: GAME_ACTIONS.COMPLETE_ROW, payload: { rowIndex: r } });
      const keys = Object.keys(POWER_UP_CONFIG);
      const t = keys[Math.floor(Math.random() * keys.length)];
      const cfg = POWER_UP_CONFIG[t];
      dispatch({
        type: GAME_ACTIONS.ADD_POWER_UP,
        payload: {
          id: String(Date.now()) + '-' + Math.random().toString(36).slice(2, 8),
          type: t, icon: cfg.icon, name: cfg.name,
          description: cfg.description, effect: cfg.effect,
        }
      });
    }

    if (result.isWin) {
      dispatch({
        type: GAME_ACTIONS.SAVE_HIGH_SCORE,
        payload: {
          gameMode: state.gameMode,
          gridSize: state.gridSize,
          score: { moves: state.moveCount, time: 60 - state.timeRemaining, date: Date.now() }
        }
      });
      dispatch({ type: GAME_ACTIONS.SET_GAME_PHASE, payload: 'won' });
      return;
    }

    // Strategic error becomes a one-shot toast instead of a blocking modal.
    // Showing it only once per game keeps it feeling like a tip, not a nag.
    if (result.isStrategicError && !state.strategicWarningShown) {
      dispatch({ type: GAME_ACTIONS.SHOW_STRATEGIC_WARNING });
    }
  }, [dispatch, state.gridSize, state.gameMode, state.moveCount, state.timeRemaining, state.strategicWarningShown, trigger]);
};

// Persistence — lives only in root GridZen2 component
const usePersistence = (state, dispatch) => {
  const saveData = useCallback(async () => {
    try {
      await AsyncStorage.setItem('gridzen2_v2_data', JSON.stringify({
        leaderboards: state.leaderboards,
        isDarkTheme: state.isDarkTheme,
        musicEnabled: state.musicEnabled,
        gameMode: state.gameMode,
        gridSize: state.gridSize
      }));
    } catch (e) { console.log('Save error:', e); }
  }, [state.leaderboards, state.isDarkTheme, state.musicEnabled, state.gameMode, state.gridSize]);

  const loadData = useCallback(async () => {
    try {
      const raw = await AsyncStorage.getItem('gridzen2_v2_data');
      if (!raw) return;
      const d = JSON.parse(raw);
      if (d.leaderboards) {
        dispatch({ type: GAME_ACTIONS.LOAD_LEADERBOARDS, payload: d.leaderboards });
      }
      if (typeof d.isDarkTheme === 'boolean') {
        dispatch({ type: GAME_ACTIONS.SET_DARK_THEME, payload: d.isDarkTheme });
      }
      if (typeof d.musicEnabled === 'boolean') {
        dispatch({ type: GAME_ACTIONS.SET_MUSIC_ENABLED, payload: d.musicEnabled });
      }
      if (d.gameMode) {
        dispatch({ type: GAME_ACTIONS.SET_GAME_MODE, payload: d.gameMode });
      }
      if (d.gridSize) {
        dispatch({ type: GAME_ACTIONS.SET_GRID_SIZE, payload: d.gridSize });
      }
    } catch (e) { console.log('Load error:', e); }
  }, [dispatch]);

  useEffect(() => { loadData(); }, [loadData]);
  useEffect(() => { saveData(); },
    [state.leaderboards, state.isDarkTheme, state.musicEnabled, state.gameMode, state.gridSize, saveData]);
};

// ============================================================================
// Game Audio — looping zen music + one-shot SFX. Returns a play(name) callback
// so the rest of the app can fire 'cheer' on win and 'gameover' on time-up
// without each component owning its own audio player.
// ============================================================================
const useGameAudio = (gamePhase, musicEnabled) => {
  const music = useAudioPlayer(require('./assets/sounds/zen-sound.mp3'));
  const cheer = useAudioPlayer(require('./assets/sounds/Cheer.mp3'));
  const gameOver = useAudioPlayer(require('./assets/sounds/Game_over.mp3'));

  // iOS defaults audio to "ambient" — which silences playback when the
  // physical silent switch is on. For a casual puzzle game, the zen track
  // should still play with the ringer muted (matches Apple's own games).
  // Also unblocks audio in the iOS Simulator, which routes ambient audio
  // through host channels that often appear muted.
  useEffect(() => {
    setAudioModeAsync({ playsInSilentMode: true }).catch((e) =>
      console.log('setAudioMode error:', e)
    );
  }, []);

  useEffect(() => {
    if (music) { try { music.loop = true; } catch { } }
  }, [music]);

  const shouldPlay = musicEnabled && gamePhase === 'playing';

  useEffect(() => {
    if (!music) return;
    try {
      if (shouldPlay) { if (!music.playing) music.play(); }
      else { if (music.playing) music.pause(); }
    } catch (e) { console.log('Music control error:', e); }
  }, [shouldPlay, music]);

  // Fire one-shot SFX on win/loss. Guarded so we don't double-trigger on
  // re-renders while the phase is held.
  const sfxFiredRef = useRef(null);
  useEffect(() => {
    if (gamePhase !== 'won' && gamePhase !== 'gameOver') {
      sfxFiredRef.current = null;
      return;
    }
    if (sfxFiredRef.current === gamePhase) return;
    sfxFiredRef.current = gamePhase;
    const target = gamePhase === 'won' ? cheer : gameOver;
    if (!target) return;
    try {
      target.seekTo?.(0);
      target.play();
    } catch (e) { console.log('SFX error:', e); }
  }, [gamePhase, cheer, gameOver]);
};

// ============================================================================
// Rating Prompt — Apple/Google both rate-limit the OS prompt, so we layer
// our own checks on top so a player only sees it after they're invested:
//   * at least 5 lifetime wins
//   * at least 2 days since install
//   * at least 60 days since last prompt
//   * triggered only on a 'won' phase (emotional peak)
// Wrapping with hasAction()/isAvailableAsync() avoids crashes on platforms
// where review APIs aren't available.
// ============================================================================
const RATING_STORAGE_KEY = 'gridzen2_rating_v1';
const useRatingPrompt = (gamePhase) => {
  const askedThisSessionRef = useRef(false);
  useEffect(() => {
    if (gamePhase !== 'won') return;
    if (askedThisSessionRef.current) return;

    (async () => {
      try {
        const raw = await AsyncStorage.getItem(RATING_STORAGE_KEY);
        const data = raw
          ? JSON.parse(raw)
          : { gamesWon: 0, installedAt: Date.now(), lastPromptedAt: 0 };
        data.gamesWon = (data.gamesWon || 0) + 1;

        const daysSinceInstall = (Date.now() - (data.installedAt || Date.now())) / 86400000;
        const daysSincePrompt = (Date.now() - (data.lastPromptedAt || 0)) / 86400000;

        let canPrompt = false;
        try {
          const hasAction = await StoreReview.hasAction();
          const isAvailable = await StoreReview.isAvailableAsync();
          canPrompt = hasAction && isAvailable;
        } catch { canPrompt = false; }

        const shouldAsk =
          data.gamesWon >= 5 &&
          daysSinceInstall >= 2 &&
          daysSincePrompt >= 60 &&
          canPrompt;

        if (shouldAsk) {
          askedThisSessionRef.current = true;
          data.lastPromptedAt = Date.now();
          // Delay so the win overlay/confetti has a moment to land first.
          setTimeout(() => {
            StoreReview.requestReview().catch(() => { });
          }, 1800);
        }
        await AsyncStorage.setItem(RATING_STORAGE_KEY, JSON.stringify(data));
      } catch (e) { console.log('Rating prompt error:', e); }
    })();
  }, [gamePhase]);
};

// ============================================================================
// Components
// ============================================================================

const GameTile = React.memo(({ tile, index, gridSize, gameMode, isLocked, isCompleted, isHinted, onSwipe, theme }) => {
  const trigger = useHaptic();
  const scale = useRef(new Animated.Value(1)).current;

  const gridWidth = SCREEN_WIDTH * 0.8;
  const tileSize = (gridWidth / gridSize) - 8;

  const handleStateChange = useCallback(({ nativeEvent }) => {
    if (isLocked) return;
    if (nativeEvent.state === State.BEGAN) {
      trigger('light');
      scale.stopAnimation();
      Animated.timing(scale, { toValue: 0.97, duration: 90, useNativeDriver: true }).start();
    } else if (
      nativeEvent.state === State.END ||
      nativeEvent.state === State.CANCELLED ||
      nativeEvent.state === State.FAILED
    ) {
      const tx = nativeEvent.translationX || 0;
      const ty = nativeEvent.translationY || 0;
      const threshold = 28;
      if (Math.abs(tx) > threshold || Math.abs(ty) > threshold) {
        let dir = '';
        if (Math.abs(tx) > Math.abs(ty)) dir = tx > 0 ? 'right' : 'left';
        else dir = ty > 0 ? 'down' : 'up';
        onSwipe(index, dir);
      }
      scale.stopAnimation();
      Animated.timing(scale, { toValue: 1, duration: 110, useNativeDriver: true }).start();
    }
  }, [index, onSwipe, isLocked, trigger, scale]);

  let gradientColors;
  if (isCompleted) gradientColors = ['#4169E1', '#1E90FF', '#87CEEB'];
  else if (gameMode === 'color') gradientColors = [tile.color, tile.color + 'dd', tile.color + 'bb'];
  else if (gameMode === 'pattern') gradientColors = [tile.pattern.color, tile.pattern.color + 'dd', tile.pattern.color + 'bb'];
  else gradientColors = [tile.color, tile.color + 'dd', tile.color + 'bb'];

  const renderTileContent = () => {
    if (gameMode === 'classic') {
      return (
        <Text style={[styles.tileNumber, { fontSize: Math.min(28, tileSize / 2.5), color: '#000' }]}>
          {tile.number}
        </Text>
      );
    } else if (gameMode === 'color') {
      return null;
    } else {
      return (
        <Text
          allowFontScaling={false}
          style={[
            styles.patternSymbol,
            {
              color: '#fff',
              textShadowColor: theme.headerShadow,
              textShadowOffset: { width: 0, height: 2 },
              textShadowRadius: 3
            }
          ]}
        >
          {tile.pattern.symbol}
        </Text>
      );
    }
  };

  return (
    <PanGestureHandler
      onHandlerStateChange={handleStateChange}
      activeOffsetX={[-14, 14]}
      activeOffsetY={[-14, 14]}
      enabled={!isLocked}
    >
      <Animated.View style={[styles.tileContainer, { width: tileSize, height: tileSize, transform: [{ scale }] }]}>
        <LinearGradient
          colors={gradientColors}
          style={[
            styles.tile3D,
            {
              width: tileSize,
              height: tileSize,
              borderColor: isHinted ? '#FFD400' : (isCompleted ? '#1E90FF' : '#ffffff'),
              borderWidth: isHinted ? 3 : 1
            }
          ]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
        >
          {renderTileContent()}
          {isLocked && <View style={styles.lockIcon}><Text style={styles.lockEmoji}>🔒</Text></View>}
        </LinearGradient>
      </Animated.View>
    </PanGestureHandler>
  );
});

const GameGrid = ({ state, dispatch, theme, evaluate }) => {
  const trigger = useHaptic();

  const performSwap = useCallback((fromIndex, toIndex) => {
    trigger('medium');
    dispatch({ type: GAME_ACTIONS.SWAP_TILES, payload: { fromIndex, toIndex } });
    if (state.freeMovesRemaining > 0) dispatch({ type: GAME_ACTIONS.CONSUME_FREE_MOVE });
    else dispatch({ type: GAME_ACTIONS.INCREMENT_MOVES });

    const newGrid = applySwap(state.gridData, fromIndex, toIndex);
    evaluate(newGrid, state.completedRows);
  }, [dispatch, state.gridData, state.freeMovesRemaining, state.completedRows, trigger, evaluate]);

  const onSwipe = useCallback((index, direction) => {
    if (state.gamePhase !== 'playing') return;
    if (state.lockedTiles.has(index)) return;

    const row = Math.floor(index / state.gridSize);
    const col = index % state.gridSize;
    let r = row, c = col;
    switch (direction) {
      case 'up': r = Math.max(0, row - 1); break;
      case 'down': r = Math.min(state.gridSize - 1, row + 1); break;
      case 'left': c = Math.max(0, col - 1); break;
      case 'right': c = Math.min(state.gridSize - 1, col + 1); break;
      default: break;
    }
    const target = r * state.gridSize + c;
    if (target !== index) performSwap(index, target);
  }, [state.gamePhase, state.gridSize, state.lockedTiles, performSwap]);

  // Plain View grid — FlatList overhead is wasted on 16-36 static items, and
  // the prior implementation re-rendered every tile on every state change.
  return (
    <View style={styles.gridContainer}>
      <View style={[styles.gridFlex, { width: SCREEN_WIDTH * 0.8 }]}>
        {state.gridData.map((tile, index) => {
          const rowIndex = Math.floor(index / state.gridSize);
          return (
            <GameTile
              key={tile.id || index}
              tile={tile}
              index={index}
              gridSize={state.gridSize}
              gameMode={state.gameMode}
              isLocked={state.lockedTiles.has(index)}
              isCompleted={state.completedRows.has(rowIndex)}
              isHinted={state.hintRowIndex === rowIndex}
              onSwipe={onSwipe}
              theme={theme}
            />
          );
        })}
      </View>
    </View>
  );
};

const PowerUpDisplay = ({ powerUps, onUse, theme }) => {
  if (!powerUps || powerUps.length === 0) return null;
  return (
    <View style={styles.powerUpContainer}>
      <Text style={[styles.powerUpTitle, { color: theme.text }]}>Power-ups:</Text>
      <FlatList
        horizontal
        data={powerUps}
        keyExtractor={(p) => p.id}
        contentContainerStyle={styles.powerUpList}
        renderItem={({ item }) => (
          <TouchableOpacity style={styles.powerUpChip} onPress={() => onUse(item)}>
            <Text style={styles.powerUpIcon}>{item.icon}</Text>
            <Text style={styles.powerUpName}>{item.name}</Text>
          </TouchableOpacity>
        )}
        showsHorizontalScrollIndicator={false}
      />
    </View>
  );
};

const GAME_MODE_CONFIG = {
  classic: { emoji: '🔢', name: 'NUMBERS', description: 'Arrange tiles 1..N, each row sequential.' },
  color: { emoji: '🎨', name: 'COLORS', description: 'Match rows by identical colors.' },
  pattern: { emoji: '🧩', name: 'SHAPES', description: 'Fill each row with matching symbols.' }
};

const ToggleChip = ({ onPress, label, chipBg, chipText }) => (
  <TouchableOpacity onPress={onPress} style={[styles.toggleChip, { backgroundColor: chipBg }]}>
    <Text style={[styles.toggleChipText, { color: chipText }]}>{label}</Text>
  </TouchableOpacity>
);

// ============================================================================
// Result Overlay — replaces native Alert.alert on win/loss with an in-app
// view so the moment matches the game's tone, shows actual stats, and gives
// a direct "Play Again" CTA. Player loses the worst part of native modals
// (looks like an error, blocks taps until dismissed, no styling).
// ============================================================================
const ResultOverlay = ({ visible, kind, moves, time, rowsCompleted, totalRows, onPlayAgain, onMenu, accentGradient }) => {
  const fade = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(fade, {
      toValue: visible ? 1 : 0,
      duration: 220,
      useNativeDriver: true,
    }).start();
  }, [visible, fade]);

  if (!visible) return null;
  const isWin = kind === 'won';

  return (
    <Animated.View
      style={[styles.overlay, { opacity: fade }]}
      pointerEvents={visible ? 'auto' : 'none'}
    >
      <View style={styles.overlayCard}>
        <LinearGradient
          colors={accentGradient}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.overlayHeader}
        >
          <Text style={styles.overlayTitle}>
            {isWin ? 'Solved' : "Time's up"}
          </Text>
          <Text style={styles.overlaySubtitle}>
            {isWin ? 'Nice work — every row complete.' : 'So close. Want another shot?'}
          </Text>
        </LinearGradient>

        <View style={styles.overlayStats}>
          <View style={styles.overlayStatCol}>
            <Text style={styles.overlayStatValue}>{moves}</Text>
            <Text style={styles.overlayStatLabel}>Moves</Text>
          </View>
          <View style={styles.overlayStatDivider} />
          <View style={styles.overlayStatCol}>
            <Text style={styles.overlayStatValue}>{time}s</Text>
            <Text style={styles.overlayStatLabel}>{isWin ? 'Time used' : 'Time left'}</Text>
          </View>
          <View style={styles.overlayStatDivider} />
          <View style={styles.overlayStatCol}>
            <Text style={styles.overlayStatValue}>{rowsCompleted}/{totalRows}</Text>
            <Text style={styles.overlayStatLabel}>Rows</Text>
          </View>
        </View>

        <TouchableOpacity style={styles.overlayPrimary} onPress={onPlayAgain}>
          <Text style={styles.overlayPrimaryText}>Play Again</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.overlaySecondary} onPress={onMenu}>
          <Text style={styles.overlaySecondaryText}>Back to Menu</Text>
        </TouchableOpacity>
      </View>
    </Animated.View>
  );
};

// Non-blocking strategic warning toast. Shows once per game when the player
// completes a middle row before the rows below it, fades after 3s. Prior
// implementation used Alert.alert which paused the game and felt punitive.
const StrategicWarningToast = ({ visible, onDismiss, topInset }) => {
  const slide = useRef(new Animated.Value(-80)).current;
  const opacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (visible) {
      Animated.parallel([
        Animated.timing(slide, { toValue: 0, duration: 220, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 1, duration: 220, useNativeDriver: true }),
      ]).start();
      const t = setTimeout(onDismiss, 3000);
      return () => clearTimeout(t);
    } else {
      Animated.parallel([
        Animated.timing(slide, { toValue: -80, duration: 200, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 0, duration: 200, useNativeDriver: true }),
      ]).start();
    }
  }, [visible, slide, opacity, onDismiss]);

  return (
    <Animated.View
      pointerEvents="none"
      style={[
        styles.toast,
        { top: topInset + 8, transform: [{ translateY: slide }], opacity },
      ]}
    >
      <Text style={styles.toastIcon}>⚠</Text>
      <View style={{ flex: 1 }}>
        <Text style={styles.toastTitle}>Try working top-down</Text>
        <Text style={styles.toastBody}>Skipping a row makes it harder to finish.</Text>
      </View>
    </Animated.View>
  );
};

// ============================================================================
// GameScreen
// ============================================================================
const GameScreen = ({ state, dispatch, isAdFree }) => {
  const confettiRef = useRef(null);
  const confettiFiredRef = useRef(false);
  const trigger = useHaptic();
  const insets = useSafeAreaInsets();
  const theme = useMemo(() => makeTheme(state.isDarkTheme), [state.isDarkTheme]);
  const evaluate = useGameEvaluation(state, dispatch, trigger);

  useGameTimer(state, dispatch);

  useEffect(() => {
    if (state.gamePhase === 'won' && confettiRef.current && !confettiFiredRef.current) {
      confettiFiredRef.current = true;
      confettiRef.current.start();
    } else if (state.gamePhase !== 'won') {
      confettiFiredRef.current = false;
    }
  }, [state.gamePhase]);

  const handleUsePowerUp = useCallback((powerUp) => {
    dispatch({ type: GAME_ACTIONS.USE_POWER_UP, payload: powerUp });
    switch (powerUp.type) {
      case 'FREEZE_TIME': {
        const t = Math.min(state.timeRemaining + POWER_UP_CONFIG.FREEZE_TIME.effect, 300);
        dispatch({ type: GAME_ACTIONS.SET_TIME, payload: t });
        trigger('success');
        break;
      }
      case 'FREE_MOVES': {
        dispatch({ type: GAME_ACTIONS.SET_FREE_MOVES, payload: POWER_UP_CONFIG.FREE_MOVES.effect });
        trigger('light');
        break;
      }
      case 'ROW_HINT': {
        let bestRow = null; let bestScore = -1;
        for (let r = 0; r < state.gridSize; r++) {
          if (checkRowCompletion(state.gridData, state.gridSize, r, state.gameMode)) continue;
          const start = r * state.gridSize;
          const row = state.gridData.slice(start, start + state.gridSize);
          let score = 0;
          if (state.gameMode === 'classic') {
            score = row.reduce((acc, tile, i) => acc + (tile.number === start + i + 1 ? 1 : 0), 0);
          } else if (state.gameMode === 'color') {
            const target = row[0].targetColor;
            score = row.reduce((acc, tile) => acc + (tile.color === target ? 1 : 0), 0);
          } else {
            const counts = {};
            row.forEach(t => { counts[t.pattern.name] = (counts[t.pattern.name] || 0) + 1; });
            score = Math.max(...Object.values(counts));
          }
          if (score > bestScore) { bestScore = score; bestRow = r; }
        }
        if (bestRow !== null) {
          dispatch({ type: GAME_ACTIONS.SET_HINT_ROW, payload: bestRow });
          setTimeout(() => dispatch({ type: GAME_ACTIONS.CLEAR_HINT_ROW }), 5000);
        }
        break;
      }
      case 'AUTO_COMPLETE': {
        // Build a local grid and apply each fix to it, so the next iteration
        // sees the most recent swap. Old version re-read state.gridData each
        // iteration — that closure was stale and could undo prior swaps.
        let fixes = POWER_UP_CONFIG.AUTO_COMPLETE.effect;
        const size = state.gridSize;
        const mode = state.gameMode;
        let grid = state.gridData.slice();
        if (mode === 'classic') {
          for (let i = 0; i < grid.length && fixes > 0; i++) {
            if (grid[i].number !== i + 1) {
              const j = grid.findIndex(t => t.number === i + 1);
              if (j !== -1 && j !== i) { grid = applySwap(grid, i, j); fixes--; }
            }
          }
        } else if (mode === 'color') {
          for (let r = 0; r < size && fixes > 0; r++) {
            const start = r * size;
            const row = grid.slice(start, start + size);
            const target = row[0].targetColor;
            const wrongIdx = row.findIndex(t => t.color !== target);
            if (wrongIdx !== -1) {
              const globalWrong = start + wrongIdx;
              const donor = grid.findIndex((t, idx) => Math.floor(idx / size) !== r && t.color === target);
              if (donor !== -1) { grid = applySwap(grid, globalWrong, donor); fixes--; }
            }
          }
        } else {
          for (let r = 0; r < size && fixes > 0; r++) {
            const start = r * size;
            const row = grid.slice(start, start + size);
            const counts = {};
            row.forEach(t => { counts[t.pattern.name] = (counts[t.pattern.name] || 0) + 1; });
            const targetName = Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
            const wrongIdx = row.findIndex(t => t.pattern.name !== targetName);
            if (wrongIdx !== -1) {
              const globalWrong = start + wrongIdx;
              const donor = grid.findIndex((t, idx) =>
                Math.floor(idx / size) !== r && t.pattern.name === targetName
              );
              if (donor !== -1) { grid = applySwap(grid, globalWrong, donor); fixes--; }
            }
          }
        }
        if (grid !== state.gridData) {
          dispatch({ type: GAME_ACTIONS.SET_GRID_DATA, payload: grid });
          evaluate(grid, state.completedRows);
        }
        trigger('success');
        break;
      }
      case 'TELEPORT_SWAP': {
        let grid = state.gridData;
        let swap = null;
        if (state.gameMode === 'classic') {
          for (let i = 0; i < grid.length; i++) {
            if (grid[i].number !== i + 1) {
              const j = grid.findIndex(t => t.number === i + 1);
              if (j !== -1 && j !== i) { swap = [i, j]; break; }
            }
          }
        } else if (state.gameMode === 'color') {
          for (let r = 0; r < state.gridSize; r++) {
            const start = r * state.gridSize;
            const row = grid.slice(start, start + state.gridSize);
            const target = row[0].targetColor;
            const wrong = row.findIndex(t => t.color !== target);
            if (wrong !== -1) {
              const globalWrong = start + wrong;
              const donor = grid.findIndex((t, idx) => Math.floor(idx / state.gridSize) !== r && t.color === target);
              if (donor !== -1) { swap = [globalWrong, donor]; break; }
            }
          }
        } else {
          for (let r = 0; r < state.gridSize; r++) {
            const start = r * state.gridSize;
            const row = grid.slice(start, start + state.gridSize);
            const counts = {};
            row.forEach(t => { counts[t.pattern.name] = (counts[t.pattern.name] || 0) + 1; });
            const targetName = Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
            const wrongIdx = row.findIndex(t => t.pattern.name !== targetName);
            if (wrongIdx !== -1) {
              const globalWrong = start + wrongIdx;
              const donor = grid.findIndex((t, idx) =>
                Math.floor(idx / state.gridSize) !== r && t.pattern.name === targetName
              );
              if (donor !== -1) { swap = [globalWrong, donor]; break; }
            }
          }
        }
        if (swap) {
          const newGrid = applySwap(grid, swap[0], swap[1]);
          dispatch({ type: GAME_ACTIONS.SET_GRID_DATA, payload: newGrid });
          evaluate(newGrid, state.completedRows);
        }
        trigger('success');
        break;
      }
      default: break;
    }
  }, [dispatch, state.timeRemaining, state.gridSize, state.gridData, state.gameMode, state.completedRows, trigger, evaluate]);

  const toggleTheme = useCallback(() => {
    dispatch({ type: GAME_ACTIONS.SET_DARK_THEME, payload: !state.isDarkTheme });
  }, [dispatch, state.isDarkTheme]);

  const toggleMusic = useCallback(() => {
    dispatch({ type: GAME_ACTIONS.SET_MUSIC_ENABLED, payload: !state.musicEnabled });
  }, [dispatch, state.musicEnabled]);

  const quitToMenu = useCallback(() => {
    dispatch({ type: GAME_ACTIONS.SET_GAME_PHASE, payload: 'menu' });
  }, [dispatch]);

  const playAgain = useCallback(() => {
    const gridData = createGridData(state.gridSize, state.gameMode, true);
    dispatch({ type: GAME_ACTIONS.SET_GRID_DATA, payload: gridData });
    dispatch({ type: GAME_ACTIONS.START_NEW_GAME });
    dispatch({ type: GAME_ACTIONS.SET_TIME, payload: TIME_FOR_SIZE[state.gridSize] || 60 });
  }, [dispatch, state.gridSize, state.gameMode]);

  const dismissStrategicWarning = useCallback(() => {
    dispatch({ type: GAME_ACTIONS.HIDE_STRATEGIC_WARNING });
  }, [dispatch]);

  const showResultOverlay = state.gamePhase === 'won' || state.gamePhase === 'gameOver';
  const initialTime = TIME_FOR_SIZE[state.gridSize] || 60;
  const timeStat = state.gamePhase === 'won'
    ? initialTime - state.timeRemaining
    : state.timeRemaining;

  return (
    <View style={[styles.gameContainer, { backgroundColor: theme.bg }]}>
      <StatusBar barStyle={state.isDarkTheme ? 'light-content' : 'dark-content'} />

      {/* Dedicated top bar row — quit X right-aligned with its own space,
          so it never collides with the banner or its rainbow gradient. */}
      <View style={[styles.topBar, { paddingTop: Math.max(8, insets.top + 4) }]}>
        <TouchableOpacity
          onPress={quitToMenu}
          style={[styles.quitButton, { backgroundColor: theme.chipBg }]}
          hitSlop={{ top: 12, left: 12, right: 12, bottom: 12 }}
          accessibilityRole="button"
          accessibilityLabel="Quit round"
        >
          <Text style={[styles.quitButtonText, { color: theme.text }]}>✕</Text>
        </TouchableOpacity>
      </View>

      {/* Banner */}
      <View style={styles.bannerContainer}>
        <Image source={require('./assets/images/gridzen2.png')} style={styles.gameBanner} resizeMode="contain" />
      </View>

      {/* Theme + Music toggles */}
      <View style={styles.toggleRow}>
        <ToggleChip
          onPress={toggleTheme}
          label={state.isDarkTheme ? '☀️  Light' : '🌙  Dark'}
          chipBg={theme.chipBg}
          chipText={theme.chipText}
        />
        <ToggleChip
          onPress={toggleMusic}
          label={state.musicEnabled ? '🎵  Music' : '🔇  Music'}
          chipBg={theme.chipBg}
          chipText={theme.chipText}
        />
      </View>

      {/* Header: time hero, moves and rows secondary */}
      <View style={styles.gameHeader}>
        <View style={styles.headerColSecondary}>
          <Text style={[styles.headerStatLabel, { color: theme.subText }]}>MOVES</Text>
          <Text style={[styles.headerStatValueSm, { color: theme.text }]}>{state.moveCount}</Text>
        </View>
        <View style={styles.headerColPrimary}>
          <Text style={[styles.headerStatLabel, { color: theme.subText }]}>TIME</Text>
          <Text style={[styles.headerStatValueLg, { color: theme.text }]}>{state.timeRemaining}s</Text>
        </View>
        <View style={styles.headerColSecondary}>
          <Text style={[styles.headerStatLabel, { color: theme.subText }]}>ROWS</Text>
          <Text style={[styles.headerStatValueSm, { color: theme.text }]}>
            {state.completedRows.size}/{state.gridSize}
          </Text>
        </View>
      </View>

      {/* Grid */}
      <GameGrid state={state} dispatch={dispatch} theme={theme} evaluate={evaluate} />

      {/* Power-ups */}
      <PowerUpDisplay powerUps={state.availablePowerUps} onUse={handleUsePowerUp} theme={theme} />

      {/* Ads — hidden when ad-free */}
      {!isAdFree && (
        <View style={styles.adContainerFixed}>
          <BannerAd
            unitId={__DEV__ ? TestIds.BANNER :
              Platform.OS === 'ios'
                ? 'ca-app-pub-7368779159802085/3609137514'
                : 'ca-app-pub-7368779159802085/6628408902'}
            size={BannerAdSize.FULL_BANNER}
            requestOptions={{ requestNonPersonalizedAdsOnly: true }}
            onAdFailedToLoad={(e) => console.log('Ad failed to load:', e)}
          />
        </View>
      )}

      <ConfettiCannon ref={confettiRef} count={120} origin={{ x: SCREEN_WIDTH / 2, y: 0 }} autoStart={false} fadeOut />

      <StrategicWarningToast
        visible={state.strategicWarningVisible}
        onDismiss={dismissStrategicWarning}
        topInset={insets.top}
      />

      <ResultOverlay
        visible={showResultOverlay}
        kind={state.gamePhase}
        moves={state.moveCount}
        time={timeStat}
        rowsCompleted={state.completedRows.size}
        totalRows={state.gridSize}
        onPlayAgain={playAgain}
        onMenu={quitToMenu}
        accentGradient={gradientForMode(state.gameMode)}
      />
    </View>
  );
};

// ============================================================================
// MenuScreen
// ============================================================================
const MenuScreen = ({ state, dispatch, isAdFree, onPurchase, onRestore, isPurchasing, isRestoring }) => {
  const theme = useMemo(() => makeTheme(state.isDarkTheme), [state.isDarkTheme]);

  const startGame = useCallback(() => {
    const gridData = createGridData(state.gridSize, state.gameMode, true);
    dispatch({ type: GAME_ACTIONS.SET_GRID_DATA, payload: gridData });
    dispatch({ type: GAME_ACTIONS.START_NEW_GAME });
    dispatch({ type: GAME_ACTIONS.SET_TIME, payload: TIME_FOR_SIZE[state.gridSize] || 60 });
  }, [state.gridSize, state.gameMode, dispatch]);

  const toggleTheme = useCallback(() => {
    dispatch({ type: GAME_ACTIONS.SET_DARK_THEME, payload: !state.isDarkTheme });
  }, [dispatch, state.isDarkTheme]);

  const toggleMusic = useCallback(() => {
    dispatch({ type: GAME_ACTIONS.SET_MUSIC_ENABLED, payload: !state.musicEnabled });
  }, [dispatch, state.musicEnabled]);

  return (
    <LinearGradient colors={gradientForMode(state.gameMode)} style={{ flex: 1 }} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}>
      <SafeAreaView style={[styles.container, { backgroundColor: 'transparent' }]}>
        <StatusBar barStyle="light-content" />
        <View style={styles.menuContent}>
          <Text style={[styles.title, { color: '#ffffff' }]}>GRIDZEN 2</Text>
          <Text style={[styles.subtitle, { color: '#e6e6e6' }]}>3 game modes • 3 sizes</Text>

          {/* Settings row */}
          <View style={[styles.toggleRow, { marginTop: 6, marginBottom: 14 }]}>
            <ToggleChip
              onPress={toggleTheme}
              label={state.isDarkTheme ? '☀️  Light' : '🌙  Dark'}
              chipBg="rgba(0,0,0,0.25)"
              chipText="#fff"
            />
            <ToggleChip
              onPress={toggleMusic}
              label={state.musicEnabled ? '🎵  Music' : '🔇  Music'}
              chipBg="rgba(0,0,0,0.25)"
              chipText="#fff"
            />
          </View>

          <View style={styles.gameModeContainer}>
            <Text style={[styles.label, { color: '#ffffff' }]}>Game Mode</Text>
            <View style={styles.gameModeButtons}>
              {Object.entries(GAME_MODE_CONFIG).map(([mode, cfg]) => (
                <TouchableOpacity
                  key={mode}
                  style={[styles.gameModeButton, {
                    backgroundColor: state.gameMode === mode ? '#4CAF50' : 'rgba(0,0,0,0.25)',
                    borderColor: state.gameMode === mode ? '#4CAF50' : 'transparent'
                  }]}
                  onPress={() => dispatch({ type: GAME_ACTIONS.SET_GAME_MODE, payload: mode })}
                >
                  <Text style={styles.gameModeEmoji}>{cfg.emoji}</Text>
                  <Text style={[styles.gameModeText, { color: '#ffffff' }]}>{cfg.name}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          <View style={styles.gridSizeContainer}>
            <Text style={[styles.label, { color: '#ffffff' }]}>Grid Size</Text>
            <View style={styles.gridSizeButtons}>
              {[4, 5, 6].map(size => (
                <TouchableOpacity
                  key={size}
                  style={[styles.gridSizeButton, { backgroundColor: state.gridSize === size ? '#4CAF50' : 'rgba(0,0,0,0.25)' }]}
                  onPress={() => dispatch({ type: GAME_ACTIONS.SET_GRID_SIZE, payload: size })}
                >
                  <Text style={[styles.gridSizeButtonText, { color: '#ffffff' }]}>{size}x{size}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          <TouchableOpacity style={styles.startButton} onPress={startGame}>
            <Text style={styles.startButtonText}>Start Game</Text>
          </TouchableOpacity>

          {/* Remove Ads — hidden once ad-free */}
          {!isAdFree && (
            <TouchableOpacity
              style={[styles.removeAdsButton, isPurchasing && styles.buttonDisabled]}
              onPress={onPurchase}
              disabled={isPurchasing}
            >
              {isPurchasing ? (
                <ActivityIndicator size="small" color="#ffffff" />
              ) : (
                <Text style={styles.removeAdsText}>🚫 Remove Ads — $0.99</Text>
              )}
            </TouchableOpacity>
          )}

          {/* Ads removed confirmation */}
          {isAdFree && (
            <Text style={styles.adFreeText}>✓ Ads removed</Text>
          )}

          {/* Restore Purchases — always visible per App Store Guideline 3.1.1 */}
          {!isAdFree && (
            <TouchableOpacity
              style={[styles.restoreButton, isRestoring && styles.buttonDisabled]}
              onPress={onRestore}
              disabled={isRestoring}
            >
              {isRestoring ? (
                <ActivityIndicator size="small" color="rgba(255,255,255,0.7)" />
              ) : (
                <Text style={styles.restoreText}>🔄 Restore Purchases</Text>
              )}
            </TouchableOpacity>
          )}
        </View>
      </SafeAreaView>
    </LinearGradient>
  );
};

// ============================================================================
// Root
// ============================================================================
const GridZen2 = () => {
  const [state, dispatch] = useReducer(gameStateReducer, INITIAL_STATE);

  // RevenueCat state
  const [isAdFree, setIsAdFree] = useState(false);
  const [isPurchasing, setIsPurchasing] = useState(false);
  const [isRestoring, setIsRestoring] = useState(false);

  // Initialize RevenueCat
  useEffect(() => {
    const initRC = async () => {
      try {
        Purchases.setLogLevel(LOG_LEVEL.ERROR);
        await Purchases.configure({
          apiKey: Platform.OS === 'ios' ? RC_IOS_KEY : RC_ANDROID_KEY,
        });
        const customerInfo = await Purchases.getCustomerInfo();
        setIsAdFree(customerInfo.entitlements.active[ENTITLEMENT_ID] !== undefined);
      } catch (e) {
        console.log('RevenueCat init error:', e);
      }
    };
    initRC();
  }, []);

  // -------------------------------------------------------------------------
  // handlePurchase — searches all offerings for the GridZen 2 product ID.
  // Using offerings.current alone is unreliable when multiple apps share the
  // same RevenueCat offering, because RevenueCat may return another app's
  // LIFETIME package first. Matching on product.identifier guarantees we
  // always pass GridZen 2's own product to StoreKit.
  // -------------------------------------------------------------------------
  const handlePurchase = useCallback(async () => {
    setIsPurchasing(true);
    try {
      const offerings = await Purchases.getOfferings();

      let targetPackage = null;
      for (const offering of Object.values(offerings.all)) {
        const pkg = offering.availablePackages.find(
          p => p.packageType === 'LIFETIME' &&
            p.product.identifier === PRODUCT_ID
        );
        if (pkg) { targetPackage = pkg; break; }
      }

      if (!targetPackage) {
        Alert.alert('Not Available', 'Purchase not available right now. Please try again later.');
        return;
      }
      const { customerInfo } = await Purchases.purchasePackage(targetPackage);
      if (customerInfo.entitlements.active[ENTITLEMENT_ID] !== undefined) {
        setIsAdFree(true);
        Alert.alert('Thank You!', 'Ads have been removed. Enjoy GridZen 2!');
      }
    } catch (e) {
      if (!e.userCancelled) {
        Alert.alert('Purchase Failed', 'Something went wrong. Please try again.');
      }
    } finally {
      setIsPurchasing(false);
    }
  }, []);

  const handleRestore = useCallback(async () => {
    setIsRestoring(true);
    try {
      const customerInfo = await Purchases.restorePurchases();
      if (customerInfo.entitlements.active[ENTITLEMENT_ID] !== undefined) {
        setIsAdFree(true);
        Alert.alert('Restored!', 'Your purchase has been restored.');
      } else {
        Alert.alert('Nothing to Restore', 'No previous purchase found for this account.');
      }
    } catch (e) {
      Alert.alert('Restore Failed', 'Something went wrong. Please try again.');
    } finally {
      setIsRestoring(false);
    }
  }, []);

  // Persistence, audio, and rating prompt all live at the root so they exist
  // exactly once.
  usePersistence(state, dispatch);
  useGameAudio(state.gamePhase, state.musicEnabled);
  useRatingPrompt(state.gamePhase);

  const renderCurrent = () => {
    // 'won' and 'gameOver' keep the GameScreen mounted so the ResultOverlay
    // renders on top of the final grid state rather than blink-cutting back
    // to the menu.
    switch (state.gamePhase) {
      case 'playing':
      case 'won':
      case 'gameOver':
        return <GameScreen state={state} dispatch={dispatch} isAdFree={isAdFree} />;
      case 'menu':
      default:
        return (
          <MenuScreen
            state={state}
            dispatch={dispatch}
            isAdFree={isAdFree}
            onPurchase={handlePurchase}
            onRestore={handleRestore}
            isPurchasing={isPurchasing}
            isRestoring={isRestoring}
          />
        );
    }
  };

  return (
    <GameContext.Provider value={{ state, dispatch }}>
      <GestureHandlerRootView style={{ flex: 1 }}>
        {renderCurrent()}
      </GestureHandlerRootView>
    </GameContext.Provider>
  );
};

export default GridZen2;

// ============================================================================
// Styles
// ============================================================================
const styles = StyleSheet.create({
  container: { flex: 1 },
  gameContainer: { flex: 1 },

  bannerContainer: { alignItems: 'center', paddingBottom: 6 },
  gameBanner: { width: SCREEN_WIDTH * 0.8, height: 60 },

  toggleRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 10,
    marginBottom: 4
  },
  toggleChip: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 14 },
  toggleChipText: { fontWeight: '600', fontSize: 12 },

  gameHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-around', paddingHorizontal: 20, paddingVertical: 10, marginTop: 4 },
  headerColPrimary: { alignItems: 'center', flex: 1.4 },
  headerColSecondary: { alignItems: 'center', flex: 1 },
  headerStatLabel: { fontSize: 11, fontWeight: '600', letterSpacing: 1.2, marginBottom: 2 },
  headerStatValueLg: { fontSize: 30, fontWeight: '700', letterSpacing: -0.5 },
  headerStatValueSm: { fontSize: 18, fontWeight: '700' },

  topBar: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    paddingHorizontal: 16,
    paddingBottom: 4,
  },
  quitButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  quitButtonText: { fontSize: 18, fontWeight: '600' },

  gridContainer: { alignItems: 'center', marginBottom: 16 },
  gridFlex: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', alignItems: 'center' },

  tileContainer: { margin: 4 },
  tile3D: {
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.18,
    shadowRadius: 4,
    elevation: 4,
    borderColor: '#ffffff',
    borderWidth: 1
  },
  tileNumber: { fontWeight: 'bold', textAlign: 'center' },
  patternSymbol: { fontSize: 20, fontWeight: 'bold', textAlign: 'center' },
  lockIcon: { position: 'absolute', top: 2, right: 2 },
  lockEmoji: { fontSize: 12 },

  powerUpContainer: { marginBottom: 10, paddingHorizontal: 20 },
  powerUpTitle: { fontSize: 16, fontWeight: 'bold', textAlign: 'center', marginBottom: 8 },
  powerUpList: { paddingHorizontal: 10 },
  powerUpChip: { backgroundColor: '#4CAF50', flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 8, borderRadius: 20, marginHorizontal: 5 },
  powerUpIcon: { fontSize: 16, marginRight: 5 },
  powerUpName: { color: '#ffffff', fontSize: 12, fontWeight: 'bold' },

  adContainerFixed: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    height: 60, alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'transparent'
  },

  menuContent: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 20 },
  title: { fontSize: 36, fontWeight: 'bold', textAlign: 'center', marginBottom: 10 },
  subtitle: { fontSize: 16, textAlign: 'center', marginBottom: 14 },

  label: { fontSize: 18, fontWeight: '600', textAlign: 'center', marginBottom: 15 },
  gameModeContainer: { width: '100%', marginBottom: 15 },
  gameModeButtons: { flexDirection: 'row', justifyContent: 'space-around', gap: 10 },
  gameModeButton: { flex: 1, alignItems: 'center', padding: 12, borderRadius: 10, borderWidth: 2 },
  gameModeEmoji: { fontSize: 20, marginBottom: 4 },
  gameModeText: { fontSize: 12, fontWeight: 'bold', textAlign: 'center' },

  gridSizeContainer: { width: '100%', marginBottom: 20 },
  gridSizeButtons: { flexDirection: 'row', justifyContent: 'center', gap: 15 },
  gridSizeButton: { padding: 15, borderRadius: 10, minWidth: 60 },
  gridSizeButtonText: { fontSize: 16, fontWeight: 'bold', textAlign: 'center' },

  startButton: { backgroundColor: '#4CAF50', padding: 18, borderRadius: 15, width: '80%', marginTop: 10 },
  startButtonText: { color: '#ffffff', fontSize: 18, fontWeight: 'bold', textAlign: 'center' },

  removeAdsButton: {
    backgroundColor: 'rgba(0,0,0,0.35)',
    paddingVertical: 13,
    paddingHorizontal: 28,
    borderRadius: 12,
    marginTop: 14,
    width: '80%',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.3)'
  },
  removeAdsText: { color: '#ffffff', fontSize: 15, fontWeight: '700' },

  adFreeText: {
    color: 'rgba(255,255,255,0.85)',
    fontSize: 14,
    fontWeight: '600',
    marginTop: 14,
    textAlign: 'center'
  },

  restoreButton: {
    alignItems: 'center',
    paddingVertical: 12,
    marginTop: 6
  },
  restoreText: { color: 'rgba(255,255,255,0.7)', fontSize: 14 },

  buttonDisabled: { opacity: 0.5 },

  toast: {
    position: 'absolute',
    left: 14,
    right: 14,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(20,20,28,0.94)',
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 8,
    zIndex: 50,
  },
  toastIcon: { fontSize: 20, marginRight: 10, color: '#FFD400' },
  toastTitle: { color: '#fff', fontSize: 14, fontWeight: '700' },
  toastBody: { color: 'rgba(255,255,255,0.78)', fontSize: 12, marginTop: 2 },

  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    zIndex: 100,
  },
  overlayCard: {
    width: '100%',
    maxWidth: 360,
    backgroundColor: '#15151a',
    borderRadius: 20,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.4,
    shadowRadius: 24,
    elevation: 20,
  },
  overlayHeader: { paddingVertical: 26, paddingHorizontal: 22, alignItems: 'center' },
  overlayTitle: { color: '#fff', fontSize: 28, fontWeight: '800', letterSpacing: -0.5 },
  overlaySubtitle: { color: 'rgba(255,255,255,0.88)', fontSize: 14, marginTop: 4, textAlign: 'center' },
  overlayStats: { flexDirection: 'row', paddingVertical: 18, paddingHorizontal: 12, alignItems: 'center' },
  overlayStatCol: { flex: 1, alignItems: 'center' },
  overlayStatDivider: { width: 1, height: 32, backgroundColor: 'rgba(255,255,255,0.12)' },
  overlayStatValue: { color: '#fff', fontSize: 22, fontWeight: '700' },
  overlayStatLabel: { color: 'rgba(255,255,255,0.55)', fontSize: 11, marginTop: 2, letterSpacing: 1 },
  overlayPrimary: {
    marginHorizontal: 16,
    marginTop: 4,
    backgroundColor: '#4CAF50',
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center',
  },
  overlayPrimaryText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  overlaySecondary: { paddingVertical: 14, alignItems: 'center', marginBottom: 4 },
  overlaySecondaryText: { color: 'rgba(255,255,255,0.65)', fontSize: 14, fontWeight: '500' },
});
