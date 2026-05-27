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
import { useAudioPlayer } from 'expo-audio';
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
  SET_DARK_THEME: 'SET_DARK_THEME',
  SET_MUSIC_ENABLED: 'SET_MUSIC_ENABLED',
  SAVE_HIGH_SCORE: 'SAVE_HIGH_SCORE',
  LOAD_LEADERBOARDS: 'LOAD_LEADERBOARDS',
};

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
    case GAME_ACTIONS.ADD_POWER_UP:
      return { ...state, availablePowerUps: state.availablePowerUps.concat([action.payload]) };
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
        hintRowIndex: null
      };
    case GAME_ACTIONS.SHOW_PANEL:
      return { ...state, visiblePanel: action.payload };
    case GAME_ACTIONS.HIDE_PANEL:
      return { ...state, visiblePanel: null };
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
// Zen Music Hook
// ============================================================================
const useZenMusic = (gamePhase, musicEnabled) => {
  const player = useAudioPlayer(require('./assets/sounds/zen-sound.mp3'));

  useEffect(() => {
    if (player) {
      try { player.loop = true; } catch { }
    }
  }, [player]);

  const shouldPlay = musicEnabled &&
    (gamePhase === 'playing' || gamePhase === 'strategicError');

  useEffect(() => {
    if (!player) return;
    try {
      if (shouldPlay) {
        if (!player.playing) player.play();
      } else {
        if (player.playing) player.pause();
      }
    } catch (e) {
      console.log('Music control error:', e);
    }
  }, [shouldPlay, player]);
};

// ============================================================================
// Components
// ============================================================================

const GameTile = React.memo(({ tile, index, gridSize, isLocked, isCompleted, isHinted, onSwipe, state, theme }) => {
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
  else if (state.gameMode === 'color') gradientColors = [tile.color, tile.color + 'dd', tile.color + 'bb'];
  else if (state.gameMode === 'pattern') gradientColors = [tile.pattern.color, tile.pattern.color + 'dd', tile.pattern.color + 'bb'];
  else gradientColors = [tile.color, tile.color + 'dd', tile.color + 'bb'];

  const renderTileContent = () => {
    if (state.gameMode === 'classic') {
      return (
        <Text style={[styles.tileNumber, { fontSize: Math.min(28, tileSize / 2.5), color: '#000' }]}>
          {tile.number}
        </Text>
      );
    } else if (state.gameMode === 'color') {
      return <View style={[styles.colorIndicator, { backgroundColor: tile.color }]} />;
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

const GameGrid = ({ state, dispatch, theme }) => {
  const trigger = useHaptic();

  const checkWinCondition = useCallback((grid) => {
    for (let r = 0; r < state.gridSize; r++) {
      if (!checkRowCompletion(grid, state.gridSize, r, state.gameMode)) return false;
    }
    return true;
  }, [state.gridSize, state.gameMode]);

  // evaluateAfterSwap receives currentCompletedRows explicitly to avoid stale
  // closure bugs. useCallback closes over state at render time; if a previous
  // swap's dispatch hasn't flushed yet the closure sees an outdated
  // completedRows and checkStrategicError fires a false positive.
  // Passing the Set in from performSwap (which builds it synchronously from
  // the current grid) guarantees we always have the full picture.
  const evaluateAfterSwap = useCallback((newGrid, currentCompletedRows) => {
    const after = new Set(currentCompletedRows);
    for (let r = 0; r < state.gridSize; r++) {
      if (checkRowCompletion(newGrid, state.gridSize, r, state.gameMode)) after.add(r);
    }

    for (const r of after) {
      if (!currentCompletedRows.has(r)) {
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
            description: cfg.description, effect: cfg.effect
          }
        });
      }
    }

    if (checkWinCondition(newGrid)) {
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

    if (checkStrategicError(after, state.gridSize)) {
      dispatch({ type: GAME_ACTIONS.SET_GAME_PHASE, payload: 'strategicError' });
    }
  }, [dispatch, state.gridSize, state.gameMode, state.moveCount, state.timeRemaining, trigger, checkWinCondition]);

  const performSwap = useCallback((fromIndex, toIndex) => {
    trigger('medium');
    dispatch({ type: GAME_ACTIONS.SWAP_TILES, payload: { fromIndex, toIndex } });
    if (state.freeMovesRemaining > 0) dispatch({ type: GAME_ACTIONS.CONSUME_FREE_MOVE });
    else dispatch({ type: GAME_ACTIONS.INCREMENT_MOVES });

    const newGrid = state.gridData.slice();
    const tmp = newGrid[fromIndex];
    newGrid[fromIndex] = { ...newGrid[toIndex], currentIndex: fromIndex };
    newGrid[toIndex] = { ...tmp, currentIndex: toIndex };

    // Pass state.completedRows directly — synchronous read of the current Set
    // before any dispatches above have re-rendered the component, so it is
    // accurate for this swap. evaluateAfterSwap builds its own 'after' on top.
    evaluateAfterSwap(newGrid, state.completedRows);
  }, [dispatch, state.gridData, state.freeMovesRemaining, state.completedRows, trigger, evaluateAfterSwap]);

  const onSwipe = useCallback((index, direction) => {
    if (state.gamePhase !== 'playing' && state.gamePhase !== 'strategicError') return;
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

  const renderItem = useCallback(({ item, index }) => {
    const isLocked = state.lockedTiles.has(index);
    const rowIndex = Math.floor(index / state.gridSize);
    const isCompleted = state.completedRows.has(rowIndex);
    const isHinted = state.hintRowIndex === rowIndex;
    return (
      <GameTile
        tile={item}
        index={index}
        gridSize={state.gridSize}
        isLocked={isLocked}
        isCompleted={isCompleted}
        isHinted={isHinted}
        onSwipe={onSwipe}
        state={state}
        theme={theme}
      />
    );
  }, [state, onSwipe, theme]);

  return (
    <View style={styles.gridContainer}>
      <FlatList
        data={state.gridData}
        renderItem={renderItem}
        keyExtractor={(it, i) => (it && it.id) ? it.id : String(i)}
        numColumns={state.gridSize}
        key={state.gridSize}
        scrollEnabled={false}
        contentContainerStyle={styles.flatListGrid}
        columnWrapperStyle={state.gridSize > 1 ? styles.gridRow : null}
        nestedScrollEnabled={false}
        showsVerticalScrollIndicator={false}
        showsHorizontalScrollIndicator={false}
        removeClippedSubviews={true}
        maxToRenderPerBatch={state.gridSize * 2}
        windowSize={3}
        initialNumToRender={state.gridSize * state.gridSize}
      />
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
// GameScreen
// ============================================================================
const GameScreen = ({ state, dispatch, isAdFree }) => {
  const confettiRef = useRef(null);
  const trigger = useHaptic();
  const insets = useSafeAreaInsets();
  const theme = useMemo(() => makeTheme(state.isDarkTheme), [state.isDarkTheme]);

  useGameTimer(state, dispatch);

  useEffect(() => {
    if (state.gamePhase === 'won' && confettiRef.current) confettiRef.current.start();
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
        let fixes = POWER_UP_CONFIG.AUTO_COMPLETE.effect;
        const size = state.gridSize;
        const mode = state.gameMode;
        if (mode === 'classic') {
          for (let i = 0; i < state.gridData.length && fixes > 0; i++) {
            if (state.gridData[i].number !== i + 1) {
              const j = state.gridData.findIndex(t => t.number === i + 1);
              if (j !== -1) { dispatch({ type: GAME_ACTIONS.SWAP_TILES, payload: { fromIndex: i, toIndex: j } }); fixes--; }
            }
          }
        } else if (mode === 'color') {
          for (let r = 0; r < size && fixes > 0; r++) {
            const start = r * size;
            const row = state.gridData.slice(start, start + size);
            const target = row[0].targetColor;
            const wrongIdx = row.findIndex(t => t.color !== target);
            if (wrongIdx !== -1) {
              const globalWrong = start + wrongIdx;
              const donor = state.gridData.findIndex((t, idx) => Math.floor(idx / size) !== r && t.color === target);
              if (donor !== -1) { dispatch({ type: GAME_ACTIONS.SWAP_TILES, payload: { fromIndex: globalWrong, toIndex: donor } }); fixes--; }
            }
          }
        } else {
          for (let r = 0; r < size && fixes > 0; r++) {
            const start = r * size;
            const row = state.gridData.slice(start, start + size);
            const counts = {};
            row.forEach(t => { counts[t.pattern.name] = (counts[t.pattern.name] || 0) + 1; });
            const targetName = Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
            const wrongIdx = row.findIndex(t => t.pattern.name !== targetName);
            if (wrongIdx !== -1) {
              const globalWrong = start + wrongIdx;
              const donor = state.gridData.findIndex((t, idx) =>
                Math.floor(idx / size) !== r && t.pattern.name === targetName
              );
              if (donor !== -1) {
                dispatch({ type: GAME_ACTIONS.SWAP_TILES, payload: { fromIndex: globalWrong, toIndex: donor } });
                fixes--;
              }
            }
          }
        }
        trigger('success');
        break;
      }
      case 'TELEPORT_SWAP': {
        const grid = state.gridData;
        if (state.gameMode === 'classic') {
          for (let i = 0; i < grid.length; i++) {
            if (grid[i].number !== i + 1) {
              const j = grid.findIndex(t => t.number === i + 1);
              if (j !== -1) { dispatch({ type: GAME_ACTIONS.SWAP_TILES, payload: { fromIndex: i, toIndex: j } }); break; }
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
              if (donor !== -1) { dispatch({ type: GAME_ACTIONS.SWAP_TILES, payload: { fromIndex: globalWrong, toIndex: donor } }); break; }
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
              if (donor !== -1) {
                dispatch({ type: GAME_ACTIONS.SWAP_TILES, payload: { fromIndex: globalWrong, toIndex: donor } });
                break;
              }
            }
          }
        }
        trigger('success');
        break;
      }
      default: break;
    }
  }, [dispatch, state.timeRemaining, state.gridSize, state.gridData, state.gameMode, trigger]);

  const toggleTheme = useCallback(() => {
    dispatch({ type: GAME_ACTIONS.SET_DARK_THEME, payload: !state.isDarkTheme });
  }, [dispatch, state.isDarkTheme]);

  const toggleMusic = useCallback(() => {
    dispatch({ type: GAME_ACTIONS.SET_MUSIC_ENABLED, payload: !state.musicEnabled });
  }, [dispatch, state.musicEnabled]);

  return (
    <View style={[styles.gameContainer, { backgroundColor: theme.bg }]}>
      <StatusBar barStyle={state.isDarkTheme ? 'light-content' : 'dark-content'} />

      {/* Banner */}
      <View style={[styles.bannerContainer, { paddingTop: Math.max(8, insets.top + 4) }]}>
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

      {/* Header */}
      <View style={styles.gameHeader}>
        <Text style={[styles.gameHeaderText, { color: theme.text }]}>Moves: {state.moveCount}</Text>
        <Text style={[styles.gameHeaderText, { color: theme.text }]}>Time: {state.timeRemaining}s</Text>
        <Text style={[styles.gameHeaderText, { color: theme.text }]}>Rows: {state.completedRows.size}/{state.gridSize}</Text>
      </View>

      {/* Grid */}
      <GameGrid state={state} dispatch={dispatch} theme={theme} />

      {/* Power-ups */}
      <PowerUpDisplay powerUps={state.availablePowerUps} onUse={handleUsePowerUp} theme={theme} />

      {/* Controls */}
      <View style={styles.gameControls}>
        <TouchableOpacity
          style={[styles.controlButton, { backgroundColor: theme.button }]}
          onPress={() => dispatch({ type: GAME_ACTIONS.SET_GAME_PHASE, payload: 'menu' })}
        >
          <Text style={[styles.controlButtonText, { color: theme.buttonText }]}>Give Up</Text>
        </TouchableOpacity>
      </View>

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
    dispatch({ type: GAME_ACTIONS.SET_TIME, payload: 60 });
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
  const alertShownRef = useRef(false);

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

  // Both persistence and music live here at the root — single instances
  usePersistence(state, dispatch);
  useZenMusic(state.gamePhase, state.musicEnabled);

  useEffect(() => {
    if (state.gamePhase === 'menu' || state.gamePhase === 'playing') alertShownRef.current = false;
  }, [state.gamePhase]);

  useEffect(() => {
    if (state.gamePhase === 'won' && !alertShownRef.current) {
      alertShownRef.current = true;
      setTimeout(() => {
        Alert.alert('Congratulations!', `You won in ${state.moveCount} moves!`, [
          { text: 'OK', onPress: () => { alertShownRef.current = false; dispatch({ type: GAME_ACTIONS.SET_GAME_PHASE, payload: 'menu' }); } }
        ]);
      }, 250);
    } else if (state.gamePhase === 'gameOver' && !alertShownRef.current) {
      alertShownRef.current = true;
      setTimeout(() => {
        Alert.alert('Game Over', "Time's up! Try again.", [
          { text: 'OK', onPress: () => { alertShownRef.current = false; dispatch({ type: GAME_ACTIONS.SET_GAME_PHASE, payload: 'menu' }); } }
        ]);
      }, 250);
    } else if (state.gamePhase === 'strategicError' && !alertShownRef.current) {
      alertShownRef.current = true;
      setTimeout(() => {
        Alert.alert(
          'Strategic Warning',
          'You completed a middle row before finishing the rows below it.\nTip: avoid skipping rows; complete contiguous rows.',
          [
            { text: 'Keep Looking' },
            { text: 'Give Up Now', style: 'destructive', onPress: () => { alertShownRef.current = false; dispatch({ type: GAME_ACTIONS.SET_GAME_PHASE, payload: 'menu' }); } }
          ]
        );
      }, 250);
    }
  }, [state.gamePhase, state.moveCount, dispatch]);

  const renderCurrent = () => {
    switch (state.gamePhase) {
      case 'menu':
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
      case 'playing':
      case 'strategicError':
        return <GameScreen state={state} dispatch={dispatch} isAdFree={isAdFree} />;
      case 'won':
      case 'gameOver':
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

  gameHeader: { flexDirection: 'row', justifyContent: 'space-around', padding: 12, marginTop: 4 },
  gameHeaderText: { fontSize: 16, fontWeight: 'bold' },

  gridContainer: { alignItems: 'center', marginBottom: 16 },
  flatListGrid: { alignItems: 'center' },
  gridRow: { justifyContent: 'center' },

  tileContainer: { margin: 4 },
  tile3D: {
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.4,
    shadowRadius: 8,
    elevation: 12,
    borderColor: '#ffffff',
    borderWidth: 1
  },
  tileNumber: { fontWeight: 'bold', textAlign: 'center' },
  colorIndicator: { width: '70%', height: '70%', borderRadius: 12, borderWidth: 3, borderColor: '#ffffff' },
  patternSymbol: { fontSize: 20, fontWeight: 'bold', textAlign: 'center' },
  lockIcon: { position: 'absolute', top: 2, right: 2 },
  lockEmoji: { fontSize: 12 },

  powerUpContainer: { marginBottom: 10, paddingHorizontal: 20 },
  powerUpTitle: { fontSize: 16, fontWeight: 'bold', textAlign: 'center', marginBottom: 8 },
  powerUpList: { paddingHorizontal: 10 },
  powerUpChip: { backgroundColor: '#4CAF50', flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 8, borderRadius: 20, marginHorizontal: 5 },
  powerUpIcon: { fontSize: 16, marginRight: 5 },
  powerUpName: { color: '#ffffff', fontSize: 12, fontWeight: 'bold' },

  gameControls: { alignItems: 'center', marginBottom: 80 },
  controlButton: { padding: 12, borderRadius: 10, minWidth: 100 },
  controlButtonText: { fontSize: 16, fontWeight: 'bold', textAlign: 'center' },

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
});
