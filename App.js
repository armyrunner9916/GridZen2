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
  StatusBar
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { LinearGradient } from 'expo-linear-gradient';
import { BannerAd, BannerAdSize, TestIds } from 'react-native-google-mobile-ads';
import ConfettiCannon from 'react-native-confetti-cannon';
import * as Haptics from 'expo-haptics';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

// ============================================================================
// GAME STATE MANAGEMENT (Redux-style with useReducer)
// ============================================================================

const INITIAL_STATE = {
  // Core game state
  gamePhase: 'splash', // splash, menu, playing, paused, won, gameOver
  gameMode: 'classic', // classic, puzzle
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
  
  // Puzzle mode
  currentPuzzlePack: 'beginner',
  currentPuzzleIndex: 0,
  maxMovesAllowed: 0,
  puzzleProgress: {
    beginner: { unlocked: true, completed: [] },
    intermediate: { unlocked: false, completed: [] },
    advanced: { unlocked: false, completed: [] }
  },
  
  // Player data
  playerProfile: {
    name: '',
    totalGamesPlayed: 0,
    totalRowsCompleted: 0,
    favoriteGridSize: 4
  },
  
  // Settings & UI
  isDarkTheme: false,
  soundsEnabled: false, // Placeholder for future audio implementation
  gesturesEnabled: true,
  animationsEnabled: true,
  
  // High scores with new structure
  leaderboards: {
    classic: { '4x4': [], '5x5': [], '6x6': [] },
    puzzle: { beginner: [], intermediate: [], advanced: [] }
  },
  
  // UI state
  visiblePanel: null, // settings, scores, puzzles, powerups
  isInitialized: false
};

const GAME_ACTIONS = {
  // Game flow
  INITIALIZE_GAME: 'INITIALIZE_GAME',
  SET_GAME_PHASE: 'SET_GAME_PHASE',
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

// Game state reducer
function gameStateReducer(state, action) {
  switch (action.type) {
    case GAME_ACTIONS.SET_GAME_PHASE:
      return { ...state, gamePhase: action.payload };
      
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
      
    case GAME_ACTIONS.SHOW_PANEL:
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
  const colors = [];
  const hueStep = 360 / count;
  
  for (let i = 0; i < count; i++) {
    const hue = (i * hueStep + Math.random() * 20) % 360;
    const saturation = 65 + Math.random() * 25;
    const lightness = 50 + Math.random() * 15;
    colors.push(`hsl(${Math.round(hue)}, ${Math.round(saturation)}%, ${Math.round(lightness)}%)`);
  }
  
  return colors.sort(() => Math.random() - 0.5);
};

const createGridData = (size, isShuffled = true) => {
  const totalTiles = size * size;
  const colors = generateTileColors(totalTiles);
  const numbers = Array.from({ length: totalTiles }, (_, i) => i + 1);
  
  if (isShuffled) {
    // Fisher-Yates shuffle
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
    currentIndex: index
  }));
};

const checkRowCompletion = (gridData, gridSize, rowIndex) => {
  const startIndex = rowIndex * gridSize;
  const endIndex = startIndex + gridSize;
  const rowTiles = gridData.slice(startIndex, endIndex);
  
  return rowTiles.every((tile, colIndex) => {
    const expectedNumber = startIndex + colIndex + 1;
    return tile.number === expectedNumber;
  });
};

const checkWinCondition = (gridData, gridSize) => {
  return gridData.every((tile, index) => tile.number === index + 1);
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
        puzzleProgress: gameState.puzzleProgress,
        isDarkTheme: gameState.isDarkTheme,
        soundsEnabled: gameState.soundsEnabled
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
  }, [gameState.playerProfile, gameState.leaderboards, saveData, gameState.isInitialized]);
  
  return { saveData, loadData };
};

const useHapticFeedback = () => {
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

// ============================================================================
// COMPONENTS
// ============================================================================

// 3D Textured Tile Component
const GameTile = React.memo(({ tile, index, gridSize, isSelected, isLocked, isCompleted, onPress, gameState }) => {
  const triggerHaptic = useHapticFeedback();
  const scale = useRef(new Animated.Value(1)).current;
  const tileSize = Math.max(60, (SCREEN_WIDTH - 80) / gridSize - 8);
  
  const handlePress = useCallback(() => {
    if (isLocked) return;
    
    triggerHaptic('light');
    
    Animated.sequence([
      Animated.timing(scale, { toValue: 0.95, duration: 100, useNativeDriver: true }),
      Animated.timing(scale, { toValue: 1, duration: 100, useNativeDriver: true })
    ]).start();
    
    onPress(index);
  }, [index, isLocked, onPress, triggerHaptic, scale]);
  
  // 3D Gradient effect
  const gradientColors = isCompleted 
    ? ['#4169E1', '#1E90FF', '#87CEEB'] // Royal blue gradient for completed rows
    : isSelected
    ? ['#32CD32', '#228B22', '#006400'] // Green gradient for selected
    : [`${tile.color}`, `${tile.color}dd`, `${tile.color}bb`]; // Original color gradient
  
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
          <Text style={[
            styles.tileNumber,
            {
              fontSize: Math.min(24, tileSize / 2.5),
              color: isCompleted || isSelected ? '#ffffff' : '#000000',
              textShadowColor: isCompleted || isSelected ? '#000000' : '#ffffff',
              textShadowOffset: { width: 1, height: 1 },
              textShadowRadius: 2
            }
          ]}>
            {tile.number}
          </Text>
          
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

// FlatList-based Grid Component
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
        triggerHaptic('medium');
        
        // Perform swap
        dispatch({
          type: GAME_ACTIONS.SWAP_TILES,
          payload: { fromIndex: gameState.selectedTileIndex, toIndex: tileIndex }
        });
        
        dispatch({ type: GAME_ACTIONS.INCREMENT_MOVES });
        
        // Check for row completion after swap
        setTimeout(() => {
          const newGrid = [...gameState.gridData];
          [newGrid[gameState.selectedTileIndex], newGrid[tileIndex]] = 
            [newGrid[tileIndex], newGrid[gameState.selectedTileIndex]];
          
          // Check each row for completion
          for (let row = 0; row < gameState.gridSize; row++) {
            if (!gameState.completedRows.has(row) && checkRowCompletion(newGrid, gameState.gridSize, row)) {
              triggerHaptic('success');
              dispatch({ type: GAME_ACTIONS.COMPLETE_ROW, payload: { rowIndex: row } });
              
              // Award power-up for row completion
              const powerUpTypes = Object.keys(POWER_UP_CONFIG);
              const randomType = powerUpTypes[Math.floor(Math.random() * powerUpTypes.length)];
              const powerUp = {
                id: Date.now(),
                type: randomType,
                ...POWER_UP_CONFIG[randomType]
              };
              
              dispatch({ type: GAME_ACTIONS.ADD_POWER_UP, payload: powerUp });
            }
          }
          
          // Check win condition
          if (checkWinCondition(newGrid, gameState.gridSize)) {
            triggerHaptic('success');
            dispatch({ type: GAME_ACTIONS.SET_GAME_PHASE, payload: 'won' });
          }
        }, 100);
      } else {
        dispatch({ type: GAME_ACTIONS.SELECT_TILE, payload: tileIndex });
      }
    }
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
        gameState={gameState}
      />
    );
  }, [gameState, handleTilePress]);
  
  return (
    <View style={styles.gridContainer}>
      <FlatList
        data={gameState.gridData}
        renderItem={renderTile}
        numColumns={gameState.gridSize}
        key={gameState.gridSize} // Force re-render when grid size changes
        scrollEnabled={false}
        contentContainerStyle={styles.flatListGrid}
        columnWrapperStyle={gameState.gridSize > 1 ? styles.gridRow : null}
      />
    </View>
  );
};

// Custom Animated Panel (replaces Modal)
const AnimatedPanel = ({ visible, children, onClose, title }) => {
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
      <Animated.View style={[styles.panel, { transform: [{ translateY: slideAnim }] }]}>
        <View style={styles.panelHeader}>
          <Text style={styles.panelTitle}>{title}</Text>
          <TouchableOpacity onPress={onClose} style={styles.closeButton}>
            <Text style={styles.closeButtonText}>✕</Text>
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

// Main Game Screen
const GameScreen = ({ gameState, dispatch }) => {
  const confettiRef = useRef(null);
  
  useEffect(() => {
    if (gameState.gamePhase === 'won' && confettiRef.current) {
      confettiRef.current.start();
    }
  }, [gameState.gamePhase]);
  
  const handleUsePowerUp = useCallback((powerUp) => {
    dispatch({ type: GAME_ACTIONS.USE_POWER_UP, payload: powerUp });
    
    switch (powerUp.type) {
      case 'FREEZE_TIME':
        dispatch({ type: GAME_ACTIONS.SET_TIME, payload: gameState.timeRemaining + 15 });
        break;
      case 'TELEPORT_SWAP':
        // Will be handled in tile press logic
        break;
      // Add other power-up effects here
    }
  }, [dispatch, gameState.timeRemaining]);
  
  return (
    <SafeAreaView style={[styles.container, { backgroundColor: gameState.isDarkTheme ? '#1a1a1a' : '#ffffff' }]}>
      <StatusBar barStyle={gameState.isDarkTheme ? 'light-content' : 'dark-content'} />
      
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
      
      {/* Ads */}
      <View style={styles.adContainer}>
        <BannerAd
          unitId={__DEV__ ? TestIds.BANNER : 
            Platform.OS === 'ios' ? "ca-app-pub-7368779159802085/3609137514" : "ca-app-pub-7368779159802085/6628408902"}
          size={BannerAdSize.FULL_BANNER}
          requestOptions={{ requestNonPersonalizedAdsOnly: true }}
          onAdFailedToLoad={(error) => console.log("Ad failed to load:", error)}
        />
      </View>
      
      {/* Confetti */}
      <ConfettiCannon
        ref={confettiRef}
        count={200}
        origin={{ x: SCREEN_WIDTH / 2, y: 0 }}
        autoStart={false}
        fadeOut={true}
      />
    </SafeAreaView>
  );
};

// Menu Screen
const MenuScreen = ({ gameState, dispatch }) => {
  const startGame = useCallback(() => {
    const gridData = createGridData(gameState.gridSize, true);
    dispatch({ type: GAME_ACTIONS.SET_GRID_DATA, payload: gridData });
    dispatch({ type: GAME_ACTIONS.START_NEW_GAME });
    dispatch({ type: GAME_ACTIONS.SET_TIME, payload: 60 }); // Default time
  }, [gameState.gridSize, dispatch]);
  
  return (
    <SafeAreaView style={[styles.container, { backgroundColor: gameState.isDarkTheme ? '#1a1a1a' : '#ffffff' }]}>
      <StatusBar barStyle={gameState.isDarkTheme ? 'light-content' : 'dark-content'} />
      
      <View style={styles.menuContent}>
        <Text style={[styles.title, { color: gameState.isDarkTheme ? '#ffffff' : '#000000' }]}>
          GRIDZEN 2.0
        </Text>
        
        <Text style={[styles.subtitle, { color: gameState.isDarkTheme ? '#cccccc' : '#666666' }]}>
          3D Tile Puzzle with Row Completion
        </Text>
        
        <TextInput
          style={[styles.nameInput, { 
            backgroundColor: gameState.isDarkTheme ? '#333333' : '#f5f5f5',
            color: gameState.isDarkTheme ? '#ffffff' : '#000000'
          }]}
          placeholder="Enter your name"
          placeholderTextColor={gameState.isDarkTheme ? '#999999' : '#666666'}
          value={gameState.playerProfile.name}
          onChangeText={(text) => dispatch({
            type: GAME_ACTIONS.UPDATE_PLAYER_PROFILE,
            payload: { ...gameState.playerProfile, name: text }
          })}
        />
        
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
        </View>
        
        <TouchableOpacity style={styles.startButton} onPress={startGame}>
          <Text style={styles.startButtonText}>Start Game</Text>
        </TouchableOpacity>
        
        <View style={styles.menuButtons}>
          <TouchableOpacity
            style={styles.menuButton}
            onPress={() => dispatch({ type: GAME_ACTIONS.SHOW_PANEL, payload: 'settings' })}
          >
            <Text style={styles.menuButtonText}>⚙️ Settings</Text>
          </TouchableOpacity>
          
          <TouchableOpacity
            style={styles.menuButton}
            onPress={() => dispatch({ type: GAME_ACTIONS.SHOW_PANEL, payload: 'scores' })}
          >
            <Text style={styles.menuButtonText}>🏆 Scores</Text>
          </TouchableOpacity>
        </View>
      </View>
      
      {/* Settings Panel */}
      <AnimatedPanel
        visible={gameState.visiblePanel === 'settings'}
        title="Settings"
        onClose={() => dispatch({ type: GAME_ACTIONS.HIDE_PANEL })}
      >
        <View style={styles.settingsContent}>
          <View style={styles.settingRow}>
            <Text style={styles.settingLabel}>Dark Theme</Text>
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
            <Text style={styles.settingLabel}>Sounds</Text>
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
      >
        <Text style={styles.comingSoonText}>High scores coming soon!</Text>
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
  
  // Custom hooks
  useGameTimer(gameState, dispatch);
  usePersistence(gameState, dispatch);
  
  const handleSplashFinish = useCallback(() => {
    dispatch({ type: GAME_ACTIONS.SET_GAME_PHASE, payload: 'menu' });
  }, []);
  
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
        Alert.alert(
          'Congratulations!',
          `You won in ${gameState.moveCount} moves with ${gameState.completedRows.size} completed rows!`,
          [{ text: 'OK', onPress: () => dispatch({ type: GAME_ACTIONS.SET_GAME_PHASE, payload: 'menu' }) }]
        );
        return <GameScreen gameState={gameState} dispatch={dispatch} />;
      case 'gameOver':
        Alert.alert(
          'Game Over!',
          'Time\'s up! Try again.',
          [{ text: 'OK', onPress: () => dispatch({ type: GAME_ACTIONS.SET_GAME_PHASE, payload: 'menu' }) }]
        );
        return <MenuScreen gameState={gameState} dispatch={dispatch} />;
      default:
        return <MenuScreen gameState={gameState} dispatch={dispatch} />;
    }
  };
  
  if (!gameState.isInitialized && gameState.gamePhase !== 'splash') {
    return (
      <View style={styles.loadingContainer}>
        <Text style={styles.loadingText}>Loading GridZen 2.0...</Text>
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
  nameInput: {
    width: '100%',
    padding: 15,
    borderRadius: 10,
    fontSize: 16,
    marginBottom: 30,
    borderWidth: 1,
    borderColor: 'transparent'
  },
  gridSizeContainer: {
    width: '100%',
    marginBottom: 30
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
    minWidth: 100
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
    marginBottom: 20
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
  
  // Ads
  adContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingBottom: 20
  },
  
  // Animated Panels
  panelOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    zIndex: 1000
  },
  panelBackdrop: {
    flex: 1
  },
  panel: {
    backgroundColor: '#ffffff',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: SCREEN_HEIGHT * 0.8,
    minHeight: 200
  },
  panelHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 20,
    borderBottomWidth: 1,
    borderBottomColor: '#e0e0e0'
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
    color: '#666666',
    fontStyle: 'italic'
  }
});

export default GridZen2;