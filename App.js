import React, { createContext, useContext, useReducer, useEffect, useRef, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  FlatList,
  Alert,
  Dimensions,
  Platform,
  Animated,
  SafeAreaView,
  StatusBar,
  Image,
  PanGestureHandler,
  State
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { LinearGradient } from 'expo-linear-gradient';
// import { BannerAd, BannerAdSize, TestIds } from 'react-native-google-mobile-ads'; // Commented for Expo Go
import ConfettiCannon from 'react-native-confetti-cannon';
import * as Haptics from 'expo-haptics';
import { PanGestureHandler as RNGHPanGestureHandler, State as GestureState } from 'react-native-gesture-handler';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

// ============================================================================
// GAME STATE MANAGEMENT (Redux-style with useReducer)
// ============================================================================

const INITIAL_STATE = {
  // Core game state
  gamePhase: 'splash', // splash, menu, playing, paused, won, gameOver
  gameMode: 'classic', // classic, color, pattern
  gridData: [], // Flat array instead of 2D
  gridSize: 4,
  selectedTileIndex: null,
  moveCount: 0,
  timeRemaining: 60,
  isGameActive: false,
  
  // Row completion system
  completedRows: new Set(),
  lockedTiles: new Set(),
  rowCompletionStreak: 0,
  
  // Power-up system
  availablePowerUps: [],
  activePowerUp: null,
  powerUpQueue: [],
  
  // Game mode specific data
  colorTargets: [], // For color match mode
  patternTargets: [], // For pattern match mode
  
  // Player data
  playerProfile: {
    totalGamesPlayed: 0,
    totalRowsCompleted: 0,
    favoriteGridSize: 4
  },
  
  // Platform integration
  gameServices: {
    isSignedIn: false,
    playerName: null,
    playerId: null
  },
  
  // Settings & UI
  isDarkTheme: false,
  soundsEnabled: false,
  gesturesEnabled: true,
  animationsEnabled: true,
  
  // High scores with new structure
  leaderboards: {
    classic: { '4x4': [], '5x5': [], '6x6': [] },
    color: { '4x4': [], '5x5': [], '6x6': [] },
    pattern: { '4x4': [], '5x5': [], '6x6': [] }
  },
  
  // UI state
  visiblePanel: null, // settings, scores, powerups
  isInitialized: false
};

const GAME_ACTIONS = {
  // Game flow
  INITIALIZE_GAME: 'INITIALIZE_GAME',
  SET_GAME_PHASE: 'SET_GAME_PHASE',
  SET_GAME_MODE: 'SET_GAME_MODE',
  START_NEW_GAME: 'START_NEW_GAME',
  RESET_GAME: 'RESET_GAME',
  
  // Grid management
  SET_GRID_DATA: 'SET_GRID_DATA',
  SET_GRID_SIZE: 'SET_GRID_SIZE',
  SWAP_TILES: 'SWAP_TILES',
  SELECT_TILE: 'SELECT_TILE',
  
  // Row completion
  CHECK_ROW_COMPLETION: 'CHECK_ROW_COMPLETION',
  COMPLETE_ROW: 'COMPLETE_ROW',
  RESET_ROW_PROGRESS: 'RESET_ROW_PROGRESS',
  
  // Power-ups
  ADD_POWER_UP: 'ADD_POWER_UP',
  USE_POWER_UP: 'USE_POWER_UP',
  CLEAR_POWER_UPS: 'CLEAR_POWER_UPS',
  
  // Game mechanics
  INCREMENT_MOVES: 'INCREMENT_MOVES',
  DECREMENT_TIME: 'DECREMENT_TIME',
  SET_TIME: 'SET_TIME',
  
  // Settings
  TOGGLE_THEME: 'TOGGLE_THEME',
  TOGGLE_SOUNDS: 'TOGGLE_SOUNDS',
  UPDATE_PLAYER_PROFILE: 'UPDATE_PLAYER_PROFILE',
  
  // Game Services
  SET_GAME_SERVICES_STATUS: 'SET_GAME_SERVICES_STATUS',
  SIGN_IN_GAME_SERVICES: 'SIGN_IN_GAME_SERVICES',
  SIGN_OUT_GAME_SERVICES: 'SIGN_OUT_GAME_SERVICES',
  
  // UI
  SHOW_PANEL: 'SHOW_PANEL',
  HIDE_PANEL: 'HIDE_PANEL',
  
  // Data persistence
  LOAD_SAVED_DATA: 'LOAD_SAVED_DATA',
  SAVE_HIGH_SCORE: 'SAVE_HIGH_SCORE'
};

// Power-up configurations
const POWER_UP_CONFIG = {
  FREEZE_TIME: { 
    icon: '❄️', 
    name: 'Time Freeze', 
    description: '+15 seconds',
    rarity: 'common',
    effect: 15
  },
  TELEPORT_SWAP: { 
    icon: '🌀', 
    name: 'Teleport', 
    description: 'Swap any tiles',
    rarity: 'rare',
    effect: null
  },
  AUTO_COMPLETE: { 
    icon: '✨', 
    name: 'Auto-Complete', 
    description: 'Complete 2 tiles',
    rarity: 'rare',
    effect: 2
  },
  FREE_MOVES: { 
    icon: '⚡', 
    name: 'Free Moves', 
    description: '3 free moves',
    rarity: 'common',
    effect: 3
  },
  ROW_HINT: {
    icon: '🎯',
    name: 'Row Hint',
    description: 'Highlight next row',
    rarity: 'common',
    effect: null
  }
};

// Game mode configurations
const GAME_MODE_CONFIG = {
  classic: {
    emoji: '🎯',
    name: 'NUMBERS',
    description: 'Arrange tiles in numerical order from 1 to 16 (or 25/36). Each row must be sequential.'
  },
  color: {
    emoji: '🎨',
    name: 'COLOR',
    description: 'Match all tiles in each row to the same color. Each row needs identical colors.'
  },
  pattern: {
    emoji: '🔄',
    name: 'PATTERN',
    description: 'Arrange each row to contain one of each pattern symbol. All patterns must appear once per row.'
  }
};

// Game state reducer
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
      
    case GAME_ACTIONS.SELECT_TILE:
      return { ...state, selectedTileIndex: action.payload };
      
    case GAME_ACTIONS.SWAP_TILES:
      const newGrid = [...state.gridData];
      const { fromIndex, toIndex } = action.payload;
      [newGrid[fromIndex], newGrid[toIndex]] = [newGrid[toIndex], newGrid[fromIndex]];
      return { ...state, gridData: newGrid, selectedTileIndex: null };
      
    case GAME_ACTIONS.INCREMENT_MOVES:
      return { ...state, moveCount: state.moveCount + 1 };
      
    case GAME_ACTIONS.COMPLETE_ROW:
      const { rowIndex } = action.payload;
      const newCompletedRows = new Set(state.completedRows);
      newCompletedRows.add(rowIndex);
      
      // Lock tiles in completed row
      const newLockedTiles = new Set(state.lockedTiles);
      for (let col = 0; col < state.gridSize; col++) {
        newLockedTiles.add(rowIndex * state.gridSize + col);
      }
      
      return {
        ...state,
        completedRows: newCompletedRows,
        lockedTiles: newLockedTiles,
        rowCompletionStreak: state.rowCompletionStreak + 1
      };
      
    case GAME_ACTIONS.ADD_POWER_UP:
      return {
        ...state,
        availablePowerUps: [...state.availablePowerUps, action.payload]
      };
      
    case GAME_ACTIONS.USE_POWER_UP:
      return {
        ...state,
        availablePowerUps: state.availablePowerUps.filter(p => p.id !== action.payload.id),
        activePowerUp: action.payload.type
      };
      
    case GAME_ACTIONS.TOGGLE_THEME:
      return { ...state, isDarkTheme: !state.isDarkTheme };
      
    case GAME_ACTIONS.UPDATE_PLAYER_PROFILE:
      return { ...state, playerProfile: { ...state.playerProfile, ...action.payload } };
      
    case GAME_ACTIONS.SET_GAME_SERVICES_STATUS:
      return { ...state, gameServices: { ...state.gameServices, ...action.payload } };
      
    case GAME_ACTIONS.SIGN_IN_GAME_SERVICES:
      return { 
        ...state, 
        gameServices: { 
          ...state.gameServices, 
          isSignedIn: true, 
          ...action.payload 
        } 
      };
      
    case GAME_ACTIONS.SIGN_OUT_GAME_SERVICES:
      return { 
        ...state, 
        gameServices: { 
          isSignedIn: false, 
          playerName: null, 
          playerId: null 
        } 
      };
      
    case GAME_ACTIONS.TOGGLE_SOUNDS:
      return { ...state, soundsEnabled: !state.soundsEnabled };
      return { ...state, visiblePanel: action.payload };
      
    case GAME_ACTIONS.HIDE_PANEL:
      return { ...state, visiblePanel: null };
      
    case GAME_ACTIONS.DECREMENT_TIME:
      return { ...state, timeRemaining: Math.max(0, state.timeRemaining - 1) };
      
    case GAME_ACTIONS.SET_TIME:
      return { ...state, timeRemaining: action.payload };
      
    case GAME_ACTIONS.START_NEW_GAME:
      return {
        ...state,
        gamePhase: 'playing',
        isGameActive: true,
        moveCount: 0,
        completedRows: new Set(),
        lockedTiles: new Set(),
        rowCompletionStreak: 0,
        availablePowerUps: [],
        activePowerUp: null,
        selectedTileIndex: null
      };
      
    case GAME_ACTIONS.LOAD_SAVED_DATA:
      return { ...state, ...action.payload, isInitialized: true };
      
    default:
      return state;
  }
}

// ============================================================================
// CONTEXT SETUP
// ============================================================================

const GameContext = createContext();

export const useGameState = () => {
  const context = useContext(GameContext);
  if (!context) {
    throw new Error('useGameState must be used within GameProvider');
  }
  return context;
};

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

const generateTileColors = (count) => {
  // Vibrant, saturated colors for better visual appeal
  const vibrantColors = [
    '#FF3B30', // Bright Red
    '#007AFF', // Bright Blue  
    '#34C759', // Bright Green
    '#FF9500', // Bright Orange
    '#AF52DE', // Bright Purple
    '#FF2D92', // Bright Pink
    '#5AC8FA', // Bright Cyan
    '#FFCC02', // Bright Yellow
    '#FF6B35', // Bright Red-Orange
    '#4ECDC4', // Bright Teal
    '#45B7D1', // Bright Sky Blue
    '#96CEB4', // Bright Mint
    '#FFEAA7', // Bright Light Yellow
    '#DDA0DD', // Bright Plum
    '#98D8C8', // Bright Seafoam
    '#F7DC6F'  // Bright Gold
  ];
  
  return vibrantColors.slice(0, count);
};

const generatePatterns = (gridSize) => {
  const allPatterns = [
    { symbol: '●●●', name: 'dots', color: '#FF3B30' },      // Bright Red
    { symbol: '|||', name: 'stripes', color: '#007AFF' },   // Bright Blue
    { symbol: '~~~', name: 'waves', color: '#34C759' },     // Bright Green
    { symbol: '▓▓▓', name: 'grid', color: '#FF9500' },      // Bright Orange
    { symbol: '◆◇◆', name: 'diamond', color: '#AF52DE' },   // Bright Purple
    { symbol: '✕✕✕', name: 'cross', color: '#FF2D92' },     // Bright Pink
    { symbol: '▲▼▲', name: 'triangle', color: '#5AC8FA' },  // Bright Cyan
    { symbol: '◐◑◐', name: 'circle', color: '#FFCC02' }     // Bright Yellow
  ];
  
  return allPatterns.slice(0, gridSize);
};

const createGridData = (size, gameMode, isShuffled = true) => {
  const totalTiles = size * size;
  
  if (gameMode === 'classic') {
    const colors = generateTileColors(totalTiles);
    const numbers = Array.from({ length: totalTiles }, (_, i) => i + 1);
    
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
  } else if (gameMode === 'color') {
    const colors = generateTileColors(size); // One color per row
    const tiles = [];
    
    for (let i = 0; i < totalTiles; i++) {
      const rowIndex = Math.floor(i / size);
      tiles.push({
        id: `tile-${i}`,
        color: colors[rowIndex],
        targetColor: colors[rowIndex],
        currentIndex: i,
        gameMode: 'color'
      });
    }
    
    if (isShuffled) {
      for (let i = tiles.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [tiles[i], tiles[j]] = [tiles[j], tiles[i]];
        tiles[i].currentIndex = i;
        tiles[j].currentIndex = j;
      }
    }
    
    return tiles;
  } else if (gameMode === 'pattern') {
    const patterns = generatePatterns(size);
    const tiles = [];
    
    // Create tiles where each row contains one of each pattern
    for (let row = 0; row < size; row++) {
      for (let col = 0; col < size; col++) {
        const patternIndex = col; // Each column gets a different pattern
        const tileIndex = row * size + col;
        tiles.push({
          id: `tile-${tileIndex}`,
          pattern: patterns[patternIndex],
          currentIndex: tileIndex,
          targetRow: row,
          targetCol: col,
          gameMode: 'pattern'
        });
      }
    }
    
    if (isShuffled) {
      // Shuffle the tiles while keeping track of their target positions
      for (let i = tiles.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [tiles[i], tiles[j]] = [tiles[j], tiles[i]];
        tiles[i].currentIndex = i;
        tiles[j].currentIndex = j;
      }
    }
    
    return tiles;
  }
};

const checkRowCompletion = (gridData, gridSize, rowIndex, gameMode) => {
  const startIndex = rowIndex * gridSize;
  const endIndex = startIndex + gridSize;
  const rowTiles = gridData.slice(startIndex, endIndex);
  
  if (gameMode === 'classic') {
    return rowTiles.every((tile, colIndex) => {
      const expectedNumber = startIndex + colIndex + 1;
      return tile.number === expectedNumber;
    });
  } else if (gameMode === 'color') {
    const targetColor = rowTiles[0].targetColor;
    return rowTiles.every(tile => tile.color === targetColor);
  } else if (gameMode === 'pattern') {
    // Check that each row has one of each pattern (all different patterns)
    const patterns = generatePatterns(gridSize);
    const patternNames = patterns.map(p => p.name);
    
    const rowPatterns = rowTiles.map(tile => tile.pattern.name);
    const hasAllPatterns = patternNames.every(patternName => 
      rowPatterns.includes(patternName)
    );
    const hasUniquePatterns = new Set(rowPatterns).size === rowPatterns.length;
    
    return hasAllPatterns && hasUniquePatterns;
  }
  
  return false;
};

const checkWinCondition = (gridData, gridSize, gameMode) => {
  for (let row = 0; row < gridSize; row++) {
    if (!checkRowCompletion(gridData, gridSize, row, gameMode)) {
      return false;
    }
  }
  return true;
};

// ============================================================================
// CUSTOM HOOKS
// ============================================================================

const useGameTimer = (gameState, dispatch) => {
  const timerRef = useRef(null);
  
  useEffect(() => {
    if (gameState.isGameActive && gameState.timeRemaining > 0) {
      timerRef.current = setTimeout(() => {
        dispatch({ type: GAME_ACTIONS.DECREMENT_TIME });
      }, 1000);
    } else if (gameState.timeRemaining === 0 && gameState.isGameActive) {
      dispatch({ type: GAME_ACTIONS.SET_GAME_PHASE, payload: 'gameOver' });
    }
    
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
    };
  }, [gameState.isGameActive, gameState.timeRemaining, dispatch]);
};

const usePersistence = (gameState, dispatch) => {
  const saveData = useCallback(async () => {
    try {
      const dataToSave = {
        playerProfile: gameState.playerProfile,
        leaderboards: gameState.leaderboards,
        isDarkTheme: gameState.isDarkTheme,
        soundsEnabled: gameState.soundsEnabled,
        gameMode: gameState.gameMode
      };
      
      await AsyncStorage.setItem('gridzen2_v2_data', JSON.stringify(dataToSave));
    } catch (error) {
      console.log('Save error:', error);
    }
  }, [gameState]);
  
  const loadData = useCallback(async () => {
    try {
      const savedData = await AsyncStorage.getItem('gridzen2_v2_data');
      if (savedData) {
        const parsedData = JSON.parse(savedData);
        dispatch({ type: GAME_ACTIONS.LOAD_SAVED_DATA, payload: parsedData });
      } else {
        dispatch({ type: GAME_ACTIONS.LOAD_SAVED_DATA, payload: {} });
      }
    } catch (error) {
      console.log('Load error:', error);
      dispatch({ type: GAME_ACTIONS.LOAD_SAVED_DATA, payload: {} });
    }
  }, [dispatch]);
  
  useEffect(() => {
    loadData();
  }, [loadData]);
  
  useEffect(() => {
    if (gameState.isInitialized) {
      saveData();
    }
  }, [gameState.playerProfile, gameState.leaderboards, gameState.gameMode, gameState.gameServices, saveData, gameState.isInitialized]);
  
  return { saveData, loadData };
};

const useHapticFeedback = () => {
const useGameServices = (dispatch) => {
  const checkGameServicesStatus = useCallback(async () => {
    try {
      // Placeholder for Game Center/Google Play Games authentication check
      // This would integrate with actual Game Center or Play Games SDK
      
      if (Platform.OS === 'ios') {
        // iOS Game Center integration would go here
        // For now, simulate checking authentication status
        console.log('Checking Game Center authentication...');
        dispatch({ 
          type: GAME_ACTIONS.SET_GAME_SERVICES_STATUS, 
          payload: { 
            isSignedIn: false, 
            playerName: null,
            playerId: null 
          } 
        });
      } else {
        // Android Google Play Games integration would go here
        console.log('Checking Google Play Games authentication...');
        dispatch({ 
          type: GAME_ACTIONS.SET_GAME_SERVICES_STATUS, 
          payload: { 
            isSignedIn: false, 
            playerName: null,
            playerId: null 
          } 
        });
      }
    } catch (error) {
      console.log('Game services check error:', error);
    }
  }, [dispatch]);
  
  const signInToGameServices = useCallback(async () => {
    try {
      if (Platform.OS === 'ios') {
        // Game Center sign-in would go here
        console.log('Attempting Game Center sign-in...');
        // Simulate successful sign-in for now
        dispatch({ 
          type: GAME_ACTIONS.SIGN_IN_GAME_SERVICES, 
          payload: { 
            playerName: 'Game Center Player',
            playerId: 'gc_player_123' 
          } 
        });
      } else {
        // Google Play Games sign-in would go here
        console.log('Attempting Google Play Games sign-in...');
        // Simulate successful sign-in for now
        dispatch({ 
          type: GAME_ACTIONS.SIGN_IN_GAME_SERVICES, 
          payload: { 
            playerName: 'Play Games Player',
            playerId: 'pg_player_123' 
          } 
        });
      }
    } catch (error) {
      console.log('Game services sign-in error:', error);
    }
  }, [dispatch]);
  
  useEffect(() => {
    checkGameServicesStatus();
  }, [checkGameServicesStatus]);
  
  return { checkGameServicesStatus, signInToGameServices };
};
  const triggerHaptic = useCallback((type = 'light') => {
    try {
      switch (type) {
        case 'light':
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
          break;
        case 'medium':
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
          break;
        case 'heavy':
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
          break;
        case 'success':
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          break;
        case 'error':
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
          break;
      }
    } catch (error) {
      // Haptics not supported on this device
    }
  }, []);
  
  return triggerHaptic;
};

// Game Services Hook (placeholder for future Game Center/Play Games integration)
const useGameServices = (dispatch) => {
  const checkGameServicesStatus = useCallback(async () => {
    try {
      // Placeholder for Game Center/Google Play Games authentication check
      // This would integrate with actual Game Center or Play Games SDK
      
      if (Platform.OS === 'ios') {
        // iOS Game Center integration would go here
        // For now, simulate checking authentication status
        console.log('Checking Game Center authentication...');
        dispatch({ 
          type: GAME_ACTIONS.SET_GAME_SERVICES_STATUS, 
          payload: { 
            isSignedIn: false, 
            playerName: null,
            playerId: null 
          } 
        });
      } else {
        // Android Google Play Games integration would go here
        console.log('Checking Google Play Games authentication...');
        dispatch({ 
          type: GAME_ACTIONS.SET_GAME_SERVICES_STATUS, 
          payload: { 
            isSignedIn: false, 
            playerName: null,
            playerId: null 
          } 
        });
      }
    } catch (error) {
      console.log('Game services check error:', error);
    }
  }, [dispatch]);
  
  const signInToGameServices = useCallback(async () => {
    try {
      if (Platform.OS === 'ios') {
        // Game Center sign-in would go here
        console.log('Attempting Game Center sign-in...');
        // Simulate successful sign-in for now
        dispatch({ 
          type: GAME_ACTIONS.SIGN_IN_GAME_SERVICES, 
          payload: { 
            playerName: 'Game Center Player',
            playerId: 'gc_player_123' 
          } 
        });
      } else {
        // Google Play Games sign-in would go here
        console.log('Attempting Google Play Games sign-in...');
        // Simulate successful sign-in for now
        dispatch({ 
          type: GAME_ACTIONS.SIGN_IN_GAME_SERVICES, 
          payload: { 
            playerName: 'Play Games Player',
            playerId: 'pg_player_123' 
          } 
        });
      }
    } catch (error) {
      console.log('Game services sign-in error:', error);
    }
  }, [dispatch]);
  
  useEffect(() => {
    checkGameServicesStatus();
  }, [checkGameServicesStatus]);
  
  return { checkGameServicesStatus, signInToGameServices };
};

// ============================================================================
// COMPONENTS
// ============================================================================

// 3D Textured Tile Component with dynamic sizing
const GameServicesStatus = ({ gameState, dispatch }) => {
  const { signInToGameServices } = useGameServices(dispatch);
  
  if (gameState.gameServices.isSignedIn) {
    return (
      <View style={styles.gameServicesContainer}>
        <Text style={[styles.welcomeText, { color: gameState.isDarkTheme ? '#4CAF50' : '#2E7D32' }]}>
          Welcome, {gameState.gameServices.playerName}!
        </Text>
        <Text style={[styles.gameServicesSubtext, { color: gameState.isDarkTheme ? '#cccccc' : '#666666' }]}>
          {Platform.OS === 'ios' ? 'Game Center Connected' : 'Google Play Games Connected'}
        </Text>
      </View>
    );
  }
  
  return (
    <View style={styles.gameServicesContainer}>
      <TouchableOpacity 
        style={[styles.signInButton, { backgroundColor: gameState.isDarkTheme ? '#333333' : '#f0f0f0' }]}
        onPress={signInToGameServices}
      >
        <Text style={[styles.signInButtonText, { color: gameState.isDarkTheme ? '#4CAF50' : '#2E7D32' }]}>
          {Platform.OS === 'ios' ? '🎮 Sign in to Game Center' : '🎮 Sign in to Play Games'}
        </Text>
        <Text style={[styles.signInSubtext, { color: gameState.isDarkTheme ? '#cccccc' : '#666666' }]}>
          For leaderboards & achievements
        </Text>
      </TouchableOpacity>
    </View>
  );
};
const GameTile = React.memo(({ tile, index, gridSize, isSelected, isLocked, isCompleted, onPress, gameState }) => {
  const triggerHaptic = useHapticFeedback();
  const scale = useRef(new Animated.Value(1)).current;
  
  // Dynamic tile sizing - 80% of screen width with 10% padding each side
  const gridWidth = SCREEN_WIDTH * 0.8;
  const tileSize = (gridWidth / gridSize) - 8; // 8px for margins
  
  const handlePress = useCallback(() => {
    if (isLocked) return;
    
    triggerHaptic('light');
    
    Animated.sequence([
      Animated.timing(scale, { toValue: 0.95, duration: 100, useNativeDriver: true }),
      Animated.timing(scale, { toValue: 1, duration: 100, useNativeDriver: true })
    ]).start();
    
    onPress(index);
  }, [index, isLocked, onPress, triggerHaptic, scale]);
  
  // 3D Gradient effect with more vibrant colors for color/pattern modes
  let gradientColors;
  
  if (isCompleted) {
    gradientColors = ['#4169E1', '#1E90FF', '#87CEEB']; // Royal blue gradient for completed rows
  } else if (isSelected) {
    gradientColors = ['#32CD32', '#228B22', '#006400']; // Green gradient for selected
  } else if (gameState.gameMode === 'color') {
    // Use the vibrant color directly for color mode
    const baseColor = tile.color;
    gradientColors = [baseColor, `${baseColor}dd`, `${baseColor}bb`];
  } else if (gameState.gameMode === 'pattern') {
    // Use the vibrant pattern color for pattern mode
    const baseColor = tile.pattern.color;
    gradientColors = [baseColor, `${baseColor}dd`, `${baseColor}bb`];
  } else {
    // Classic mode - use the generated tile color
    gradientColors = [`${tile.color}`, `${tile.color}dd`, `${tile.color}bb`];
  }
  
  const renderTileContent = () => {
    if (gameState.gameMode === 'classic') {
      return (
        <Text style={[
          styles.tileNumber,
          {
            fontSize: Math.min(28, tileSize / 2.5),
            color: isCompleted || isSelected ? '#ffffff' : '#000000',
            textShadowColor: isCompleted || isSelected ? '#000000' : '#ffffff',
            textShadowOffset: { width: 1, height: 1 },
            textShadowRadius: 2
          }
        ]}>
          {tile.number}
        </Text>
      );
    } else if (gameState.gameMode === 'color') {
      return (
        <View style={[styles.colorIndicator, { 
          backgroundColor: tile.color,
          borderColor: '#ffffff',
          shadowColor: tile.color,
          shadowOffset: { width: 0, height: 2 },
          shadowOpacity: 0.5,
          shadowRadius: 4,
          elevation: 6
        }]} />
      );
    } else if (gameState.gameMode === 'pattern') {
      return (
        <View style={styles.patternContainer}>
          <Text style={[styles.patternSymbol, { 
            color: tile.pattern.color,
            textShadowColor: '#000000',
            textShadowOffset: { width: 2, height: 2 },
            textShadowRadius: 3
          }]}>
            {tile.pattern.symbol}
          </Text>
        </View>
      );
    }
  };
  
  return (
    <Animated.View style={{ transform: [{ scale }] }}>
      <TouchableOpacity
        onPress={handlePress}
        disabled={isLocked}
        style={[
          styles.tileContainer,
          {
            width: tileSize,
            height: tileSize,
            opacity: isLocked ? 0.8 : 1
          }
        ]}
        activeOpacity={0.8}
      >
        <LinearGradient
          colors={gradientColors}
          style={[
            styles.tile3D,
            {
              width: tileSize,
              height: tileSize,
              borderColor: isSelected ? '#32CD32' : isCompleted ? '#4169E1' : '#ffffff',
              borderWidth: isSelected || isCompleted ? 3 : 1
            }
          ]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
        >
          {renderTileContent()}
          
          {isLocked && (
            <View style={styles.lockIcon}>
              <Text style={styles.lockEmoji}>🔒</Text>
            </View>
          )}
        </LinearGradient>
      </TouchableOpacity>
    </Animated.View>
  );
});

// FlatList-based Grid Component with swipe support
const GameGrid = ({ gameState, dispatch }) => {
  const triggerHaptic = useHapticFeedback();
  
  const handleTilePress = useCallback((tileIndex) => {
    if (!gameState.isGameActive) return;
    
    const isLocked = gameState.lockedTiles.has(tileIndex);
    if (isLocked) return;
    
    if (gameState.selectedTileIndex === null) {
      dispatch({ type: GAME_ACTIONS.SELECT_TILE, payload: tileIndex });
    } else if (gameState.selectedTileIndex === tileIndex) {
      dispatch({ type: GAME_ACTIONS.SELECT_TILE, payload: null });
    } else {
      // Check if tiles are adjacent
      const selectedRow = Math.floor(gameState.selectedTileIndex / gameState.gridSize);
      const selectedCol = gameState.selectedTileIndex % gameState.gridSize;
      const targetRow = Math.floor(tileIndex / gameState.gridSize);
      const targetCol = tileIndex % gameState.gridSize;
      
      const isAdjacent = 
        (Math.abs(selectedRow - targetRow) === 1 && selectedCol === targetCol) ||
        (Math.abs(selectedCol - targetCol) === 1 && selectedRow === targetRow);
      
      if (isAdjacent) {
        performSwap(gameState.selectedTileIndex, tileIndex);
      } else {
        dispatch({ type: GAME_ACTIONS.SELECT_TILE, payload: tileIndex });
      }
    }
  }, [gameState, dispatch]);
  
  const handleTileSwipe = useCallback((tileIndex, direction) => {
    if (!gameState.isGameActive) return;
    
    const isLocked = gameState.lockedTiles.has(tileIndex);
    if (isLocked) return;
    
    // Calculate target position based on swipe direction
    const currentRow = Math.floor(tileIndex / gameState.gridSize);
    const currentCol = tileIndex % gameState.gridSize;
    
    let targetRow = currentRow;
    let targetCol = currentCol;
    
    switch (direction) {
      case 'up':
        targetRow = Math.max(0, currentRow - 1);
        break;
      case 'down':
        targetRow = Math.min(gameState.gridSize - 1, currentRow + 1);
        break;
      case 'left':
        targetCol = Math.max(0, currentCol - 1);
        break;
      case 'right':
        targetCol = Math.min(gameState.gridSize - 1, currentCol + 1);
        break;
    }
    
    const targetIndex = targetRow * gameState.gridSize + targetCol;
    
    // Only swap if position actually changed
    if (targetIndex !== tileIndex) {
      performSwap(tileIndex, targetIndex);
    }
  }, [gameState, dispatch]);
  
  const performSwap = useCallback((fromIndex, toIndex) => {
    triggerHaptic('medium');
    
    // Perform swap
    dispatch({
      type: GAME_ACTIONS.SWAP_TILES,
      payload: { fromIndex, toIndex }
    });
    
    dispatch({ type: GAME_ACTIONS.INCREMENT_MOVES });
    
    // Check for row completion after swap
    setTimeout(() => {
      const newGrid = [...gameState.gridData];
      [newGrid[fromIndex], newGrid[toIndex]] = [newGrid[toIndex], newGrid[fromIndex]];
      
      // Update current indices
      newGrid[fromIndex].currentIndex = fromIndex;
      newGrid[toIndex].currentIndex = toIndex;
      
      // Check each row for completion
      for (let row = 0; row < gameState.gridSize; row++) {
        if (!gameState.completedRows.has(row) && checkRowCompletion(newGrid, gameState.gridSize, row, gameState.gameMode)) {
          triggerHaptic('success');
          dispatch({ type: GAME_ACTIONS.COMPLETE_ROW, payload: { rowIndex: row } });
          
          // Award power-up for row completion
          const powerUpTypes = Object.keys(POWER_UP_CONFIG);
          const randomType = powerUpTypes[Math.floor(Math.random() * powerUpTypes.length)];
          const powerUp = {
            id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            type: randomType,
            ...POWER_UP_CONFIG[randomType]
          };
          
          dispatch({ type: GAME_ACTIONS.ADD_POWER_UP, payload: powerUp });
        }
      }
      
      // Check win condition
      if (checkWinCondition(newGrid, gameState.gridSize, gameState.gameMode)) {
        triggerHaptic('success');
        dispatch({ type: GAME_ACTIONS.SET_GAME_PHASE, payload: 'won' });
      }
    }, 100);
  }, [gameState, dispatch, triggerHaptic]);
  
  const renderTile = useCallback(({ item, index }) => {
    const isSelected = gameState.selectedTileIndex === index;
    const isLocked = gameState.lockedTiles.has(index);
    const rowIndex = Math.floor(index / gameState.gridSize);
    const isCompleted = gameState.completedRows.has(rowIndex);
    
    return (
      <GameTile
        tile={item}
        index={index}
        gridSize={gameState.gridSize}
        isSelected={isSelected}
        isLocked={isLocked}
        isCompleted={isCompleted}
        onPress={handleTilePress}
        onSwipe={handleTileSwipe}
        gameState={gameState}
      />
    );
  }, [gameState, handleTilePress, handleTileSwipe]);
  
  return (
    <View style={styles.gridContainer}>
      <FlatList
        data={gameState.gridData}
        renderItem={renderTile}
        numColumns={gameState.gridSize}
        key={gameState.gridSize}
        scrollEnabled={false}
        contentContainerStyle={styles.flatListGrid}
        columnWrapperStyle={gameState.gridSize > 1 ? styles.gridRow : null}
      />
    </View>
  );
};

// Custom Animated Panel with Frosted Glass Effect
const AnimatedPanel = ({ visible, children, onClose, title, isDarkTheme }) => {
  const slideAnim = useRef(new Animated.Value(SCREEN_HEIGHT)).current;
  const opacityAnim = useRef(new Animated.Value(0)).current;
  
  useEffect(() => {
    if (visible) {
      Animated.parallel([
        Animated.timing(slideAnim, {
          toValue: 0,
          duration: 300,
          useNativeDriver: true
        }),
        Animated.timing(opacityAnim, {
          toValue: 1,
          duration: 300,
          useNativeDriver: true
        })
      ]).start();
    } else {
      Animated.parallel([
        Animated.timing(slideAnim, {
          toValue: SCREEN_HEIGHT,
          duration: 250,
          useNativeDriver: true
        }),
        Animated.timing(opacityAnim, {
          toValue: 0,
          duration: 250,
          useNativeDriver: true
        })
      ]).start();
    }
  }, [visible, slideAnim, opacityAnim]);
  
  if (!visible) return null;
  
  return (
    <Animated.View style={[styles.panelOverlay, { opacity: opacityAnim }]}>
      <TouchableOpacity style={styles.panelBackdrop} onPress={onClose} activeOpacity={1} />
      <Animated.View style={[
        styles.frostedPanel, 
        { 
          transform: [{ translateY: slideAnim }],
          backgroundColor: isDarkTheme 
            ? 'rgba(30, 30, 30, 0.95)' 
            : 'rgba(255, 255, 255, 0.95)'
        }
      ]}>
        <View style={[styles.panelHeader, { borderBottomColor: isDarkTheme ? '#444' : '#e0e0e0' }]}>
          <Text style={[styles.panelTitle, { color: isDarkTheme ? '#ffffff' : '#000000' }]}>
            {title}
          </Text>
          <TouchableOpacity onPress={onClose} style={styles.closeButton}>
            <Text style={[styles.closeButtonText, { color: isDarkTheme ? '#ffffff' : '#000000' }]}>
              ✕
            </Text>
          </TouchableOpacity>
        </View>
        <View style={styles.panelContent}>
          {children}
        </View>
      </Animated.View>
    </Animated.View>
  );
};

// Power-up Display Component
const PowerUpDisplay = ({ powerUps, onUsePowerUp }) => {
  if (powerUps.length === 0) return null;
  
  return (
    <View style={styles.powerUpContainer}>
      <Text style={styles.powerUpTitle}>Power-ups Available:</Text>
      <FlatList
        data={powerUps}
        horizontal
        showsHorizontalScrollIndicator={false}
        keyExtractor={(item) => item.id.toString()}
        renderItem={({ item }) => (
          <TouchableOpacity
            style={styles.powerUpChip}
            onPress={() => onUsePowerUp(item)}
          >
            <Text style={styles.powerUpIcon}>{item.icon}</Text>
            <Text style={styles.powerUpName}>{item.name}</Text>
          </TouchableOpacity>
        )}
        contentContainerStyle={styles.powerUpList}
      />
    </View>
  );
};

// Main Game Screen with Banner
const GameScreen = ({ gameState, dispatch }) => {
  const confettiRef = useRef(null);
  const triggerHaptic = useHapticFeedback(); // Added missing triggerHaptic
  
  useEffect(() => {
    if (gameState.gamePhase === 'won' && confettiRef.current) {
      confettiRef.current.start();
    }
  }, [gameState.gamePhase]);
  
  const handleUsePowerUp = useCallback((powerUp) => {
    dispatch({ type: GAME_ACTIONS.USE_POWER_UP, payload: powerUp });
    
    switch (powerUp.type) {
      case 'FREEZE_TIME':
        const newTime = Math.min(gameState.timeRemaining + 15, 300); // Cap at 5 minutes
        dispatch({ type: GAME_ACTIONS.SET_TIME, payload: newTime });
        triggerHaptic('success');
        break;
        
      case 'TELEPORT_SWAP':
        // Allow swapping any two tiles regardless of adjacency
        dispatch({ type: GAME_ACTIONS.SELECT_TILE, payload: null });
        // Set a special mode that allows any swap
        // This would need additional state management
        triggerHaptic('medium');
        break;
        
      case 'AUTO_COMPLETE':
        // Auto-complete 2 random tiles to their correct positions
        const incorrectTiles = gameState.gridData
          .map((tile, index) => ({ tile, index }))
          .filter(({ tile, index }) => {
            if (gameState.gameMode === 'classic') {
              return tile.number !== index + 1;
            } else if (gameState.gameMode === 'color') {
              const targetRowIndex = Math.floor(index / gameState.gridSize);
              const targetColor = gameState.gridData[targetRowIndex * gameState.gridSize].targetColor;
              return tile.color !== targetColor;
            } else if (gameState.gameMode === 'pattern') {
              const targetRowIndex = Math.floor(index / gameState.gridSize);
              const targetCol = index % gameState.gridSize;
              const patterns = generatePatterns(gameState.gridSize);
              return tile.pattern.name !== patterns[targetCol].name;
            }
            return false;
          });
          
        // Auto-fix up to 2 tiles
        const tilesToFix = incorrectTiles.slice(0, 2);
        tilesToFix.forEach(({ index }) => {
          // Find correct position for this tile and swap
          // This is simplified - in practice you'd need more complex logic
          triggerHaptic('success');
        });
        break;
        
      case 'FREE_MOVES':
        // Add 3 free moves (subtract from move count)
        // This would need additional state management
        triggerHaptic('light');
        break;
        
      case 'ROW_HINT':
        // Highlight the next row that can be completed
        // This would need additional state management
        triggerHaptic('light');
        break;
        
      default:
        break;
    }
  }, [dispatch, gameState, triggerHaptic]);
  
  return (
    <View style={[styles.gameContainer, { backgroundColor: gameState.isDarkTheme ? '#1a1a1a' : '#ffffff' }]}>
      <StatusBar barStyle={gameState.isDarkTheme ? 'light-content' : 'dark-content'} />
      
      {/* Game Banner */}
      <View style={styles.bannerContainer}>
        <Image 
          source={require('./assets/images/gridzen2.png')} 
          style={styles.gameBanner}
          resizeMode="contain"
        />
      </View>
      
      {/* Game Header */}
      <View style={styles.gameHeader}>
        <Text style={[styles.gameHeaderText, { color: gameState.isDarkTheme ? '#ffffff' : '#000000' }]}>
          Moves: {gameState.moveCount}
        </Text>
        <Text style={[styles.gameHeaderText, { color: gameState.isDarkTheme ? '#ffffff' : '#000000' }]}>
          Time: {gameState.timeRemaining}s
        </Text>
        <Text style={[styles.gameHeaderText, { color: gameState.isDarkTheme ? '#ffffff' : '#000000' }]}>
          Rows: {gameState.completedRows.size}/{gameState.gridSize}
        </Text>
      </View>
      
      {/* Row Completion Streak */}
      {gameState.rowCompletionStreak > 0 && (
        <View style={styles.streakContainer}>
          <Text style={styles.streakText}>
            🔥 {gameState.rowCompletionStreak} Row Streak!
          </Text>
        </View>
      )}
      
      {/* Game Grid */}
      <GameGrid gameState={gameState} dispatch={dispatch} />
      
      {/* Power-ups */}
      <PowerUpDisplay 
        powerUps={gameState.availablePowerUps} 
        onUsePowerUp={handleUsePowerUp}
      />
      
      {/* Game Controls */}
      <View style={styles.gameControls}>
        <TouchableOpacity
          style={styles.controlButton}
          onPress={() => dispatch({ type: GAME_ACTIONS.SET_GAME_PHASE, payload: 'menu' })}
        >
          <Text style={styles.controlButtonText}>Menu</Text>
        </TouchableOpacity>
      </View>
      
      {/* Ads - Commented out for Expo Go testing */}
      {/*
      <View style={styles.adContainerFixed}>
        <BannerAd
          unitId={__DEV__ ? TestIds.BANNER : 
            Platform.OS === 'ios' ? "ca-app-pub-7368779159802085/3609137514" : "ca-app-pub-7368779159802085/6628408902"}
          size={BannerAdSize.FULL_BANNER}
          requestOptions={{ requestNonPersonalizedAdsOnly: true }}
          onAdFailedToLoad={(error) => console.log("Ad failed to load:", error)}
        />
      </View>
      */}
      
      {/* Placeholder for ad space during testing */}
      <View style={[styles.adContainerFixed, { backgroundColor: '#f0f0f0', justifyContent: 'center' }]}>
        <Text style={{ color: '#666', fontSize: 12, textAlign: 'center' }}>
          Ad Space (Disabled for Testing)
        </Text>
      </View>
      
      {/* Confetti */}
      <ConfettiCannon
        ref={confettiRef}
        count={200}
        origin={{ x: SCREEN_WIDTH / 2, y: 0 }}
        autoStart={false}
        fadeOut={true}
      />
    </View>
  );
};

// Menu Screen with Game Mode Selector
const MenuScreen = ({ gameState, dispatch }) => {
  const startGame = useCallback(() => {
    const gridData = createGridData(gameState.gridSize, gameState.gameMode, true);
    dispatch({ type: GAME_ACTIONS.SET_GRID_DATA, payload: gridData });
    dispatch({ type: GAME_ACTIONS.START_NEW_GAME });
    dispatch({ type: GAME_ACTIONS.SET_TIME, payload: 60 });
  }, [gameState.gridSize, gameState.gameMode, dispatch]);
  
  return (
    <SafeAreaView style={[styles.container, { backgroundColor: gameState.isDarkTheme ? '#1a1a1a' : '#ffffff' }]}>
      <StatusBar barStyle={gameState.isDarkTheme ? 'light-content' : 'dark-content'} />
      
      <View style={styles.menuContent}>
        <Text style={[styles.title, { color: gameState.isDarkTheme ? '#ffffff' : '#000000' }]}>
          GRIDZEN 2
        </Text>
        
        <Text style={[styles.subtitle, { color: gameState.isDarkTheme ? '#cccccc' : '#666666' }]}>
          3D Tile Puzzle with Row Completion
        </Text>
        
        {/* Game Services Status */}
        <GameServicesStatus gameState={gameState} dispatch={dispatch} />
        
        {/* Game Mode Selector */}
        <View style={styles.gameModeContainer}>
          <Text style={[styles.label, { color: gameState.isDarkTheme ? '#ffffff' : '#000000' }]}>
            Game Mode
          </Text>
          <View style={styles.gameModeButtons}>
            {Object.entries(GAME_MODE_CONFIG).map(([mode, config]) => (
              <TouchableOpacity
                key={mode}
                style={[
                  styles.gameModeButton,
                  { 
                    backgroundColor: gameState.gameMode === mode ? '#4CAF50' : (gameState.isDarkTheme ? '#333333' : '#e0e0e0'),
                    borderColor: gameState.gameMode === mode ? '#4CAF50' : 'transparent'
                  }
                ]}
                onPress={() => dispatch({ type: GAME_ACTIONS.SET_GAME_MODE, payload: mode })}
              >
                <Text style={styles.gameModeEmoji}>{config.emoji}</Text>
                <Text style={[
                  styles.gameModeText,
                  { color: gameState.gameMode === mode ? '#ffffff' : (gameState.isDarkTheme ? '#ffffff' : '#000000') }
                ]}>
                  {config.name}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
        
        {/* Grid Size Selector */}
        <View style={styles.gridSizeContainer}>
          <Text style={[styles.label, { color: gameState.isDarkTheme ? '#ffffff' : '#000000' }]}>
            Grid Size: {gameState.gridSize}x{gameState.gridSize}
          </Text>
          <View style={styles.gridSizeButtons}>
            {[4, 5, 6].map(size => (
              <TouchableOpacity
                key={size}
                style={[
                  styles.gridSizeButton,
                  { backgroundColor: gameState.gridSize === size ? '#4CAF50' : (gameState.isDarkTheme ? '#333333' : '#e0e0e0') }
                ]}
                onPress={() => dispatch({ type: GAME_ACTIONS.SET_GRID_SIZE, payload: size })}
              >
                <Text style={[
                  styles.gridSizeButtonText,
                  { color: gameState.gridSize === size ? '#ffffff' : (gameState.isDarkTheme ? '#ffffff' : '#000000') }
                ]}>
                  {size}x{size}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
          
          {/* Game Mode Description */}
          <View style={styles.gameModeDescription}>
            <Text style={[styles.descriptionText, { color: gameState.isDarkTheme ? '#cccccc' : '#666666' }]}>
              {GAME_MODE_CONFIG[gameState.gameMode].description}
            </Text>
          </View>
        </View>
        
        <TouchableOpacity style={styles.startButton} onPress={startGame}>
          <Text style={styles.startButtonText}>Start Game</Text>
        </TouchableOpacity>
        
        <View style={styles.menuButtons}>
          <TouchableOpacity
            style={[styles.menuButton, { backgroundColor: gameState.isDarkTheme ? '#333333' : '#f0f0f0' }]}
            onPress={() => dispatch({ type: GAME_ACTIONS.SHOW_PANEL, payload: 'settings' })}
          >
            <Text style={[styles.menuButtonText, { color: gameState.isDarkTheme ? '#ffffff' : '#000000' }]}>
              ⚙️ Settings
            </Text>
          </TouchableOpacity>
          
          <TouchableOpacity
            style={[styles.menuButton, { backgroundColor: gameState.isDarkTheme ? '#333333' : '#f0f0f0' }]}
            onPress={() => dispatch({ type: GAME_ACTIONS.SHOW_PANEL, payload: 'scores' })}
          >
            <Text style={[styles.menuButtonText, { color: gameState.isDarkTheme ? '#ffffff' : '#000000' }]}>
              🏆 Scores
            </Text>
          </TouchableOpacity>
        </View>
      </View>
      
      {/* Settings Panel */}
      <AnimatedPanel
        visible={gameState.visiblePanel === 'settings'}
        title="Settings"
        onClose={() => dispatch({ type: GAME_ACTIONS.HIDE_PANEL })}
        isDarkTheme={gameState.isDarkTheme}
      >
        <View style={styles.settingsContent}>
          <View style={styles.settingRow}>
            <Text style={[styles.settingLabel, { color: gameState.isDarkTheme ? '#ffffff' : '#000000' }]}>
              Dark Theme
            </Text>
            <TouchableOpacity
              style={[styles.toggle, { backgroundColor: gameState.isDarkTheme ? '#4CAF50' : '#cccccc' }]}
              onPress={() => dispatch({ type: GAME_ACTIONS.TOGGLE_THEME })}
            >
              <View style={[styles.toggleThumb, { 
                transform: [{ translateX: gameState.isDarkTheme ? 20 : 0 }] 
              }]} />
            </TouchableOpacity>
          </View>
          
          <View style={styles.settingRow}>
            <Text style={[styles.settingLabel, { color: gameState.isDarkTheme ? '#ffffff' : '#000000' }]}>
              Sounds
            </Text>
            <TouchableOpacity
              style={[styles.toggle, { backgroundColor: gameState.soundsEnabled ? '#4CAF50' : '#cccccc' }]}
              onPress={() => dispatch({ type: GAME_ACTIONS.TOGGLE_SOUNDS })}
            >
              <View style={[styles.toggleThumb, { 
                transform: [{ translateX: gameState.soundsEnabled ? 20 : 0 }] 
              }]} />
            </TouchableOpacity>
          </View>
        </View>
      </AnimatedPanel>
      
      {/* High Scores Panel */}
      <AnimatedPanel
        visible={gameState.visiblePanel === 'scores'}
        title="High Scores"
        onClose={() => dispatch({ type: GAME_ACTIONS.HIDE_PANEL })}
        isDarkTheme={gameState.isDarkTheme}
      >
        <Text style={[styles.comingSoonText, { color: gameState.isDarkTheme ? '#cccccc' : '#666666' }]}>
          High scores coming soon!
        </Text>
      </AnimatedPanel>
    </SafeAreaView>
  );
};

// Splash Screen
const SplashScreen = ({ onFinish }) => {
  const fadeAnim = useRef(new Animated.Value(1)).current;
  
  useEffect(() => {
    const timer = setTimeout(() => {
      Animated.timing(fadeAnim, {
        toValue: 0,
        duration: 1000,
        useNativeDriver: true
      }).start(() => {
        onFinish();
      });
    }, 2500);
    
    return () => clearTimeout(timer);
  }, [fadeAnim, onFinish]);
  
  return (
    <Animated.View style={[styles.splashContainer, { opacity: fadeAnim }]}>
      <Text style={styles.splashTitle}>GRIDZEN</Text>
      <Text style={styles.splashVersion}>2.0</Text>
      <Text style={styles.splashSubtitle}>3D Tile Puzzle Revolution</Text>
    </Animated.View>
  );
};

// ============================================================================
// MAIN APP COMPONENT
// ============================================================================

const GridZen2 = () => {
  const [gameState, dispatch] = useReducer(gameStateReducer, INITIAL_STATE);
  const alertShownRef = useRef(false);
  
  // Custom hooks
  useGameTimer(gameState, dispatch);
  usePersistence(gameState, dispatch);
  useGameServices(dispatch);
  
  const handleSplashFinish = useCallback(() => {
    dispatch({ type: GAME_ACTIONS.SET_GAME_PHASE, payload: 'menu' });
  }, []);
  
  // Reset alert flag when returning to menu
  useEffect(() => {
    if (gameState.gamePhase === 'menu') {
      alertShownRef.current = false;
    }
  }, [gameState.gamePhase]);
  
  // Game phase routing
  const renderCurrentScreen = () => {
    switch (gameState.gamePhase) {
      case 'splash':
        return <SplashScreen onFinish={handleSplashFinish} />;
      case 'menu':
        return <MenuScreen gameState={gameState} dispatch={dispatch} />;
      case 'playing':
        return <GameScreen gameState={gameState} dispatch={dispatch} />;
      case 'won':
        // Use a ref to prevent multiple alerts
        if (!alertShownRef.current) {
          alertShownRef.current = true;
          setTimeout(() => {
            Alert.alert(
              'Congratulations!',
              `You won in ${gameState.moveCount} moves with ${gameState.completedRows.size} completed rows!`,
              [{ 
                text: 'OK', 
                onPress: () => {
                  alertShownRef.current = false;
                  dispatch({ type: GAME_ACTIONS.SET_GAME_PHASE, payload: 'menu' });
                }
              }]
            );
          }, 500);
        }
        return <GameScreen gameState={gameState} dispatch={dispatch} />;
      case 'gameOver':
        if (!alertShownRef.current) {
          alertShownRef.current = true;
          setTimeout(() => {
            Alert.alert(
              'Game Over!',
              'Time\'s up! Try again.',
              [{ 
                text: 'OK', 
                onPress: () => {
                  alertShownRef.current = false;
                  dispatch({ type: GAME_ACTIONS.SET_GAME_PHASE, payload: 'menu' });
                }
              }]
            );
          }, 500);
        }
        return <MenuScreen gameState={gameState} dispatch={dispatch} />;
      default:
        return <MenuScreen gameState={gameState} dispatch={dispatch} />;
    }
  };
  
  if (!gameState.isInitialized && gameState.gamePhase !== 'splash') {
    return (
      <View style={styles.loadingContainer}>
        <Text style={styles.loadingText}>Loading GridZen 2...</Text>
      </View>
    );
  }
  
  return (
    <GameContext.Provider value={{ gameState, dispatch }}>
      {renderCurrentScreen()}
    </GameContext.Provider>
  );
};

// ============================================================================
// STYLES
// ============================================================================

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#ffffff'
  },
  
  // Game Container
  gameContainer: {
    flex: 1,
    backgroundColor: '#ffffff'
  },
  
  // Loading
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#000000'
  },
  loadingText: {
    color: '#ffffff',
    fontSize: 18,
    fontWeight: '600'
  },
  
  // Splash
  splashContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#000000'
  },
  splashTitle: {
    fontSize: 48,
    fontWeight: 'bold',
    color: '#ffffff',
    textAlign: 'center'
  },
  splashVersion: {
    fontSize: 24,
    color: '#4CAF50',
    textAlign: 'center',
    marginTop: 10
  },
  splashSubtitle: {
    fontSize: 16,
    color: '#cccccc',
    textAlign: 'center',
    marginTop: 20
  },
  
  // Banner
  bannerContainer: {
    alignItems: 'center',
    paddingTop: Platform.OS === 'ios' ? 10 : 20,
    paddingBottom: 10
  },
  gameBanner: {
    width: SCREEN_WIDTH * 0.8,
    height: 60
  },
  
  // Menu
  menuContent: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20
  },
  title: {
    fontSize: 36,
    fontWeight: 'bold',
    textAlign: 'center',
    marginBottom: 10
  },
  subtitle: {
    fontSize: 16,
    textAlign: 'center',
    marginBottom: 30
  },
  
  // Game Services
  gameServicesContainer: {
    width: '100%',
    alignItems: 'center',
    marginBottom: 25
  },
  welcomeText: {
    fontSize: 18,
    fontWeight: 'bold',
    textAlign: 'center'
  },
  gameServicesSubtext: {
    fontSize: 14,
    textAlign: 'center',
    marginTop: 4
  },
  signInButton: {
    padding: 15,
    borderRadius: 10,
    alignItems: 'center',
    width: '100%',
    borderWidth: 1,
    borderColor: 'transparent'
  },
  signInButtonText: {
    fontSize: 16,
    fontWeight: 'bold',
    textAlign: 'center'
  },
  signInSubtext: {
    fontSize: 12,
    textAlign: 'center',
    marginTop: 4
  },
  
  // Game Mode Selector
  gameModeContainer: {
    width: '100%',
    marginBottom: 20
  },
  gameModeButtons: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    gap: 10
  },
  gameModeButton: {
    flex: 1,
    alignItems: 'center',
    padding: 12,
    borderRadius: 10,
    borderWidth: 2
  },
  gameModeEmoji: {
    fontSize: 20,
    marginBottom: 4
  },
  gameModeText: {
    fontSize: 12,
    fontWeight: 'bold',
    textAlign: 'center'
  },
  
  // Grid Size
  gridSizeContainer: {
    width: '100%',
    marginBottom: 25
  },
  
  // Game Mode Description
  gameModeDescription: {
    marginTop: 15,
    paddingHorizontal: 10,
    alignItems: 'center'
  },
  descriptionText: {
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 20,
    fontStyle: 'italic'
  },
  label: {
    fontSize: 18,
    fontWeight: '600',
    textAlign: 'center',
    marginBottom: 15
  },
  gridSizeButtons: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 15
  },
  gridSizeButton: {
    padding: 15,
    borderRadius: 10,
    minWidth: 60
  },
  gridSizeButtonText: {
    fontSize: 16,
    fontWeight: 'bold',
    textAlign: 'center'
  },
  startButton: {
    backgroundColor: '#4CAF50',
    padding: 18,
    borderRadius: 15,
    width: '80%',
    marginBottom: 30
  },
  startButtonText: {
    color: '#ffffff',
    fontSize: 18,
    fontWeight: 'bold',
    textAlign: 'center'
  },
  menuButtons: {
    flexDirection: 'row',
    gap: 20
  },
  menuButton: {
    backgroundColor: '#f0f0f0',
    padding: 12,
    borderRadius: 10,
    minWidth: 100,
    borderWidth: 1,
    borderColor: 'transparent'
  },
  menuButtonText: {
    fontSize: 14,
    fontWeight: '600',
    textAlign: 'center'
  },
  
  // Game Screen
  gameHeader: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    padding: 15,
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    marginBottom: 15
  },
  gameHeaderText: {
    fontSize: 16,
    fontWeight: 'bold'
  },
  streakContainer: {
    alignItems: 'center',
    marginBottom: 10
  },
  streakText: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#FF6B35'
  },
  
  // Grid
  gridContainer: {
    alignItems: 'center',
    marginBottom: 20
  },
  flatListGrid: {
    alignItems: 'center'
  },
  gridRow: {
    justifyContent: 'center'
  },
  
  // 3D Tiles
  tileContainer: {
    margin: 4
  },
  tile3D: {
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.4,
    shadowRadius: 8,
    elevation: 12
  },
  tileNumber: {
    fontWeight: 'bold',
    textAlign: 'center'
  },
  colorIndicator: {
    width: '70%',
    height: '70%',
    borderRadius: 12,
    borderWidth: 3,
    borderColor: '#ffffff'
  },
  patternContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%',
    height: '100%'
  },
  patternSymbol: {
    fontSize: 20,
    fontWeight: 'bold',
    textAlign: 'center'
  },
  lockIcon: {
    position: 'absolute',
    top: 2,
    right: 2
  },
  lockEmoji: {
    fontSize: 12
  },
  
  // Power-ups
  powerUpContainer: {
    marginBottom: 20,
    paddingHorizontal: 20
  },
  powerUpTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    textAlign: 'center',
    marginBottom: 10
  },
  powerUpList: {
    paddingHorizontal: 10
  },
  powerUpChip: {
    backgroundColor: '#4CAF50',
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 20,
    marginHorizontal: 5
  },
  powerUpIcon: {
    fontSize: 16,
    marginRight: 5
  },
  powerUpName: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: 'bold'
  },
  
  // Game Controls
  gameControls: {
    alignItems: 'center',
    marginBottom: 80 // Space for fixed ad
  },
  controlButton: {
    backgroundColor: '#f0f0f0',
    padding: 12,
    borderRadius: 10,
    minWidth: 100
  },
  controlButtonText: {
    fontSize: 16,
    fontWeight: 'bold',
    textAlign: 'center'
  },
  
  // Fixed Ads (placeholder during testing)
  adContainerFixed: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: 60, // Standard banner ad height
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'transparent'
  },
  
  // Frosted Glass Panels
  panelOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.4)',
    zIndex: 1000
  },
  panelBackdrop: {
    flex: 1
  },
  frostedPanel: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: SCREEN_HEIGHT * 0.8,
    minHeight: 200,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -5 },
    shadowOpacity: 0.2,
    shadowRadius: 15,
    elevation: 20
  },
  panelHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 20,
    borderBottomWidth: 1
  },
  panelTitle: {
    fontSize: 20,
    fontWeight: 'bold'
  },
  closeButton: {
    padding: 5
  },
  closeButtonText: {
    fontSize: 18,
    fontWeight: 'bold'
  },
  panelContent: {
    padding: 20
  },
  
  // Settings
  settingsContent: {
    paddingVertical: 10
  },
  settingRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 15,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0'
  },
  settingLabel: {
    fontSize: 16,
    fontWeight: '500'
  },
  toggle: {
    width: 50,
    height: 30,
    borderRadius: 15,
    justifyContent: 'center',
    paddingHorizontal: 2
  },
  toggleThumb: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: '#ffffff'
  },
  comingSoonText: {
    fontSize: 16,
    textAlign: 'center',
    fontStyle: 'italic'
  }
});

export default GridZen2;