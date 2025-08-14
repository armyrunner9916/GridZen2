import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  ScrollView,
  Alert,
  Dimensions,
  Modal,
  Switch,
  Platform,
  Animated,
  UIManager,
  Image,
  SafeAreaView
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Picker } from '@react-native-picker/picker';
import { Audio } from 'expo-audio';
import { BannerAd, BannerAdSize, TestIds } from 'react-native-google-mobile-ads';
import ConfettiCannon from 'react-native-confetti-cannon';

// Enable LayoutAnimation on Android to avoid crashes related to animated layout changes
if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

const { width: screenWidth, height: screenHeight } = Dimensions.get('window');

// Pre-designed puzzle configurations - CYCLE-BASED puzzles requiring exact moves
const PUZZLE_PACKS = {
  beginner: [
    { name: "First Steps", gridSize: 4, maxMoves: 1, timeLimit: 45, 
      startGrid: [2,1,3,4,5,6,7,8,9,10,11,12,13,14,15,16] }, // 1↔2 = 1 move
    { name: "Three Chain", gridSize: 4, maxMoves: 3, timeLimit: 60,
      startGrid: [3,1,4,2,5,6,7,8,9,10,11,12,13,14,15,16] }, // Requires exactly 3 moves
    { name: "Five Step", gridSize: 4, maxMoves: 5, timeLimit: 75,
      startGrid: [7,1,2,3,5,6,8,4,9,10,11,12,13,14,15,16] }, // Six-tile cycle requiring exactly 5 moves
    { name: "Seven Chain", gridSize: 4, maxMoves: 7, timeLimit: 90,
      startGrid: [7,1,2,3,5,6,11,4,9,10,12,8,13,14,15,16] }, // Eight-tile cycle requiring exactly 7 moves
    { name: "Nine Sequence", gridSize: 4, maxMoves: 9, timeLimit: 105,
      startGrid: [4,2,3,8,1,6,7,12,5,10,11,16,9,13,14,15] } // Ten-tile cycle requiring exactly 9 moves
  ],
  intermediate: [
    { name: "Double Challenge", gridSize: 4, maxMoves: 6, timeLimit: 120,
      startGrid: [2,1,4,3,5,6,7,8,9,10,11,12,13,14,15,16] }, // Two pairs = 2 moves total
    { name: "Triple Test", gridSize: 4, maxMoves: 8, timeLimit: 150,
      startGrid: [2,1,4,3,6,5,7,8,9,10,11,12,13,14,15,16] }, // Three pairs = 3 moves total  
    { name: "Quad Master", gridSize: 4, maxMoves: 10, timeLimit: 180,
      startGrid: [2,1,4,3,6,5,8,7,9,10,11,12,13,14,15,16] } // Four pairs = 4 moves total
  ],
  advanced: [
    { name: "Penta Challenge", gridSize: 4, maxMoves: 12, timeLimit: 200,
      startGrid: [2,1,4,3,6,5,8,7,10,9,11,12,13,14,15,16] }, // Five pairs = 5 moves total
    { name: "Hexa Master", gridSize: 4, maxMoves: 14, timeLimit: 250,
      startGrid: [2,1,4,3,6,5,8,7,10,9,12,11,13,14,15,16] }, // Six pairs = 6 moves total
    { name: "Ultimate Test", gridSize: 4, maxMoves: 16, timeLimit: 300,
      startGrid: [2,1,4,3,6,5,8,7,10,9,12,11,14,13,16,15] } // Eight pairs = 8 moves total
  ]
};

// Power-up types
const POWER_UP_TYPES = {
  FREEZE_TIME: { icon: '❄️', name: 'Freeze Time', description: '+15 seconds' },
  SWAP_ANY: { icon: '🔄', name: 'Teleport', description: 'Swap any two tiles' },
  AUTO_SOLVE: { icon: '✨', name: 'Hint', description: 'Auto-solve 2 tiles' },
  DOUBLE_MOVE: { icon: '⚡', name: 'Free Move', description: 'Next move is free' }
};

// Enhanced error boundary wrapper
const SafeComponent = ({ children, fallback = null }) => {
  try {
    return children;
  } catch (error) {
    console.log('Component render error:', error);
    return fallback;
  }
};

// Color generation function - optimized
const generateDistinctColors = (count) => {
  const colors = [];
  const hueStep = 360 / count;

  try {
    for (let i = 0; i < count; i++) {
      const hue = (i * hueStep + Math.random() * 30) % 360;
      const saturation = 70 + Math.random() * 30;
      const lightness = 45 + Math.random() * 20;
      colors.push(`hsl(${Math.round(hue)}, ${Math.round(saturation)}%, ${Math.round(lightness)}%)`);
    }
    return colors.sort(() => Math.random() - 0.5);
  } catch (error) {
    console.log('Color generation error:', error);
    // Fallback colors
    return Array(count).fill().map((_, i) => `hsl(${(i * 40) % 360}, 70%, 50%)`);
  }
};

// Rainbow gradient animation
const RainbowBackground = ({ isDarkMode }) => {
  const animatedValue = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const animation = Animated.loop(
      Animated.timing(animatedValue, {
        toValue: 1,
        duration: 10000,
        useNativeDriver: false,
      })
    );
    animation.start();
    
    return () => animation.stop();
  }, []);

  const backgroundColor = animatedValue.interpolate({
    inputRange: [0, 0.16, 0.33, 0.5, 0.66, 0.83, 1],
    outputRange: [
      'rgba(255, 0, 0, 0.1)',
      'rgba(255, 165, 0, 0.1)',
      'rgba(255, 255, 0, 0.1)',
      'rgba(0, 255, 0, 0.1)',
      'rgba(0, 0, 255, 0.1)',
      'rgba(75, 0, 130, 0.1)',
      'rgba(238, 130, 238, 0.1)'
    ]
  });

  return (
    <Animated.View 
      style={[
        styles.rainbowBackground,
        { backgroundColor }
      ]} 
    />
  );
};

// Game component
const GridZenGame = () => {
  const [gameState, setGameState] = useState('splash');
  const [gameMode, setGameMode] = useState('classic'); // 'classic' or 'puzzle'
  const [gridSize, setGridSize] = useState(4);
  const [grid, setGrid] = useState([]);
  const [targetGrid, setTargetGrid] = useState([]);
  const [selectedTile, setSelectedTile] = useState(null);
  const [moves, setMoves] = useState(0);
  const [timeLeft, setTimeLeft] = useState(30);
  const [playerName, setPlayerName] = useState('');
  const [highScores, setHighScores] = useState({});

  // --- Puzzle completion helpers (derived from highScores) ---
  const isPuzzleCompleted = useCallback((pack, index) => {
    try {
      const key = `puzzle-${pack}-${index}`;
      const list = highScores?.[key];
      return Array.isArray(list) && list.length > 0;
    } catch (_e) { return false; }
  }, [highScores]);

  const isPackCompleted = useCallback((pack) => {
    const list = PUZZLE_PACKS[pack] || [];
    if (!list.length) return false;
    for (let i = 0; i < list.length; i++) {
      if (!isPuzzleCompleted(pack, i)) return false;
    }
    return true;
  }, [isPuzzleCompleted]);

  // Keep unlock flags consistent with derived completion
  useEffect(() => {
    try {
      const next = {
        beginner: true,
        intermediate: isPackCompleted('beginner') || unlocks.intermediate,
        advanced: (isPackCompleted('beginner') && isPackCompleted('intermediate')) || unlocks.advanced
      };
      if (next.beginner !== unlocks.beginner || next.intermediate !== unlocks.intermediate || next.advanced !== unlocks.advanced) {
        saveUnlocks(next);
      }
    } catch(e) { /* noop */ }
  }, [isPackCompleted]);
  const [isDarkMode, setIsDarkMode] = useState(false);
  const [soundEnabled, setSoundEnabled] = useState(false);
  const [showHighScores, setShowHighScores] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showGridSizeModal, setShowGridSizeModal] = useState(false);
  const [selectedDifficulty, setSelectedDifficulty] = useState('4x4');
  const [isInitialized, setIsInitialized] = useState(false);
  const [animatingTiles, setAnimatingTiles] = useState(new Set());
  
  // Puzzle mode states
  const [currentPuzzlePack, setCurrentPuzzlePack] = useState('beginner');
  const [currentPuzzleIndex, setCurrentPuzzleIndex] = useState(0);
  const [showPuzzleSelect, setShowPuzzleSelect] = useState(false);
  const [maxMoves, setMaxMoves] = useState(0);
  
  // Power-ups states
  const [powerUps, setPowerUps] = useState([]);
  const [selectedPowerUp, setSelectedPowerUp] = useState(null);
  const [showPowerUpModal, setShowPowerUpModal] = useState(false);

  // Animation values
  const fadeAnim = useRef(new Animated.Value(1)).current;
  const tileAnimations = useRef({}).current;

  // Refs
  const timerRef = useRef(null);
  const gameOverSound = useRef(null);
  const victorySound = useRef(null);
  const isUnmountedRef = useRef(false);
  const confettiRef = useRef(null);

  // Difficulty-based gradient backgrounds
  const getDifficultyGradient = useCallback((size) => {
    switch (size) {
      case 4:
        return ['#4CAF50', '#000000']; // Green to black (Easy)
      case 5:
        return ['#FFC107', '#000000']; // Yellow to black (Medium)
      case 6:
        return ['#F44336', '#000000']; // Red to black (Hard)
      default:
        return ['#4CAF50', '#000000'];
    }
  }, []);

  // Safe async storage operations
  const safeAsyncStorage = {
    getItem: async (key) => {
      try {
        return await AsyncStorage.getItem(key);
      } catch (error) {
        console.log(`AsyncStorage getItem error for ${key}:`, error);
        return null;
      }
    },
    setItem: async (key, value) => {
      try {
        await AsyncStorage.setItem(key, value);
        return true;
      } catch (error) {
        console.log(`AsyncStorage setItem error for ${key}:`, error);
        return false;
      }
    },
    removeItem: async (key) => {
      try {
        await AsyncStorage.removeItem(key);
        return true;
      } catch (error) {
        console.log(`AsyncStorage removeItem error for ${key}:`, error);
        return false;
      }
    }
  };

  // Enhanced sound cleanup
  const unloadSounds = useCallback(async () => {
    try {
      const unloadPromises = [];

      if (gameOverSound.current) {
        unloadPromises.push(
          gameOverSound.current.unloadAsync().catch(err => 
            console.log('Game over sound unload error:', err)
          )
        );
        gameOverSound.current = null;
      }
      
      if (victorySound.current) {
        unloadPromises.push(
          victorySound.current.unloadAsync().catch(err => 
            console.log('Victory sound unload error:', err)
          )
        );
        victorySound.current = null;
      }

      if (unloadPromises.length > 0) {
        await Promise.all(unloadPromises);
      }
    } catch (error) {
      console.log('Sound cleanup error:', error);
    }
  }, []);

  // Enhanced sound loading with expo-audio API (properly handled)
  const loadSounds = useCallback(async () => {
    if (isUnmountedRef.current || !soundEnabled) return;

    try {
      // Check if Audio is available
      if (typeof Audio === 'undefined' || !Audio.Sound) {
        console.log('Audio module not available, continuing without sounds');
        return;
      }

      // Load sounds with expo-audio API
      try {
        const gameOverSoundObject = await Audio.Sound.createAsync(
          require('./assets/sounds/Game_over.mp3')
        );
        
        const victorySoundObject = await Audio.Sound.createAsync(
          require('./assets/sounds/Cheer.mp3')
        );

        if (!isUnmountedRef.current) {
          gameOverSound.current = gameOverSoundObject.sound;
          victorySound.current = victorySoundObject.sound;
        }
      } catch (loadError) {
        console.log('Sound files not found or loading failed (non-critical):', loadError.message);
        // Continue without sounds
        gameOverSound.current = null;
        victorySound.current = null;
      }
    } catch (error) {
      console.log('Sound initialization error (non-critical):', error.message);
      // Ensure sound refs are null on failure
      gameOverSound.current = null;
      victorySound.current = null;
    }
  }, [soundEnabled]);

  // Safe sound playing with expo-audio API
  const playSound = useCallback(async (soundType) => {
    if (!soundEnabled || isUnmountedRef.current) return;

    try {
      let soundRef = null;
      if (soundType === 'gameover' && gameOverSound.current) {
        soundRef = gameOverSound.current;
      } else if (soundType === 'victory' && victorySound.current) {
        soundRef = victorySound.current;
      }

      if (soundRef) {
        // expo-audio uses playAsync instead of replayAsync
        await soundRef.setPositionAsync(0); // Reset to beginning
        await soundRef.playAsync();
      }
    } catch (error) {
      console.log('Sound playback error (non-critical):', error);
    }
  }, [soundEnabled]);

  // Theme colors - memoized for performance
  const theme = useMemo(() => ({
    background: isDarkMode ? '#1a1a1a' : '#ffffff',
    text: isDarkMode ? '#ffffff' : '#000000',
    tile: isDarkMode ? '#2a2a2a' : '#f0f0f0',
    selectedTile: '#4CAF50',
    button: isDarkMode ? '#333333' : '#e0e0e0',
    buttonText: isDarkMode ? '#ffffff' : '#000000',
    input: isDarkMode ? '#333333' : '#f5f5f5',
    inputText: isDarkMode ? '#ffffff' : '#000000',
    border: isDarkMode ? '#444444' : '#cccccc',
    gridBox: isDarkMode ? '#000000' : '#ffffff',
    numberBorder: isDarkMode ? '#ffffff' : '#000000',
  }), [isDarkMode]);

  // Time limits based on grid size - memoized
  const getTimeLimit = useCallback((size) => {
    if (gameMode === 'puzzle') {
      const puzzle = PUZZLE_PACKS[currentPuzzlePack]?.[currentPuzzleIndex];
      return puzzle?.timeLimit || 60;
    }
    const timeLimits = { 4: 60, 5: 90, 6: 120 };
    return timeLimits[size] || 60;
  }, [gameMode, currentPuzzlePack, currentPuzzleIndex]);

  // Generate power-up randomly
  const generatePowerUp = useCallback(() => {
    if (gameMode === 'classic' && Math.random() < 0.15) { // 15% chance
      const powerUpTypes = Object.keys(POWER_UP_TYPES);
      const randomType = powerUpTypes[Math.floor(Math.random() * powerUpTypes.length)];
      return {
        id: Date.now(),
        type: randomType,
        ...POWER_UP_TYPES[randomType]
      };
    }
    return null;
  }, [gameMode]);

  // Use power-up
  const usePowerUp = useCallback((powerUpType) => {
    switch (powerUpType) {
      case 'FREEZE_TIME':
        setTimeLeft(prev => prev + 15);
        break;
      case 'SWAP_ANY':
        setSelectedPowerUp('SWAP_ANY');
        break;
      case 'AUTO_SOLVE':
        // Auto-solve logic - find first two out-of-place tiles and place them correctly
        const newGrid = [...grid];
        let fixed = 0;
        for (let i = 0; i < gridSize && fixed < 2; i++) {
          for (let j = 0; j < gridSize && fixed < 2; j++) {
            const expectedNumber = i * gridSize + j + 1;
            if (newGrid[i][j].number !== expectedNumber) {
              // Find where the correct number is
              for (let x = 0; x < gridSize; x++) {
                for (let y = 0; y < gridSize; y++) {
                  if (newGrid[x][y].number === expectedNumber) {
                    // Swap the tiles
                    const temp = newGrid[i][j];
                    newGrid[i][j] = newGrid[x][y];
                    newGrid[x][y] = temp;
                    fixed++;
                    break;
                  }
                }
                if (fixed > 0) break;
              }
            }
          }
        }
        setGrid(newGrid);
        break;
      case 'DOUBLE_MOVE':
        setSelectedPowerUp('DOUBLE_MOVE');
        break;
    }
    
    // Remove used power-up
    setPowerUps(prev => prev.filter(p => p.type !== powerUpType));
    setShowPowerUpModal(false);
  }, [grid, gridSize]);

  // Initialize tile animations
  const initializeTileAnimation = useCallback((row, col) => {
    const key = `${row}-${col}`;
    if (!tileAnimations[key]) {
      tileAnimations[key] = {
        translateX: new Animated.Value(0),
        translateY: new Animated.Value(0),
      };
    }
    return tileAnimations[key];
  }, [tileAnimations]);

  // Animate tile swap
  const animateTileSwap = useCallback((fromPos, toPos) => {
    const fromKey = `${fromPos.row}-${fromPos.col}`;
    const toKey = `${toPos.row}-${toPos.col}`;
    
    const fromAnim = initializeTileAnimation(fromPos.row, fromPos.col);
    const toAnim = initializeTileAnimation(toPos.row, toPos.col);
    
    const tileSize = Math.max(40, (screenWidth - 100) / gridSize - 10);
    const spacing = tileSize + 10;
    
    const deltaX = (toPos.col - fromPos.col) * spacing;
    const deltaY = (toPos.row - fromPos.row) * spacing;
    
    setAnimatingTiles(prev => new Set([...prev, fromKey, toKey]));
    
    const animations = [
      Animated.timing(fromAnim.translateX, {
        toValue: deltaX,
        duration: 250,
        useNativeDriver: Platform.OS === 'ios',
      }),
      Animated.timing(fromAnim.translateY, {
        toValue: deltaY,
        duration: 250,
        useNativeDriver: Platform.OS === 'ios',
      }),
      Animated.timing(toAnim.translateX, {
        toValue: -deltaX,
        duration: 250,
        useNativeDriver: Platform.OS === 'ios',
      }),
      Animated.timing(toAnim.translateY, {
        toValue: -deltaY,
        duration: 250,
        useNativeDriver: Platform.OS === 'ios',
      })
    ];
    
    Animated.parallel(animations).start(() => {
      setTimeout(() => {
        fromAnim.translateX.setValue(0);
        fromAnim.translateY.setValue(0);
        toAnim.translateX.setValue(0);
        toAnim.translateY.setValue(0);
        
        setAnimatingTiles(prev => {
          const newSet = new Set(prev);
          newSet.delete(fromKey);
          newSet.delete(toKey);
          return newSet;
        });
      }, Platform.OS === 'android' ? 50 : 0);
    });
  }, [initializeTileAnimation, gridSize]);

  // Enhanced initial data loading
  const loadInitialData = useCallback(async () => {
    try {
      const [savedScores, savedName, savedDarkMode, savedSound] = await Promise.all([
        safeAsyncStorage.getItem('gridzen2_highscores'),
        safeAsyncStorage.getItem('gridzen2_playername'),
        safeAsyncStorage.getItem('gridzen2_darkMode'),
        safeAsyncStorage.getItem('gridzen2_soundOn')
      ]);

      if (!isUnmountedRef.current) {
        if (savedScores) {
          try {
            setHighScores(JSON.parse(savedScores));
          } catch (parseError) {
            console.log('High scores parse error:', parseError);
          }
        }
        
        if (savedName) setPlayerName(savedName);
        if (savedDarkMode !== null) {
          try {
            setIsDarkMode(JSON.parse(savedDarkMode));
          } catch (parseError) {
            console.log('Dark mode parse error:', parseError);
          }
        }
        if (savedSound !== null) {
          try {
            setSoundEnabled(JSON.parse(savedSound));
          } catch (parseError) {
            console.log('Sound setting parse error:', parseError);
          }
        }

        setTimeout(() => {
          if (!isUnmountedRef.current) {
            Animated.timing(fadeAnim, {
              toValue: 0,
              duration: 1000,
              useNativeDriver: true,
            }).start(() => {
              if (!isUnmountedRef.current) {
                fadeAnim.setValue(1);
                setGameState('menu');
              }
            });
          }
        }, 3000);
      }
    } catch (error) {
      console.log('Load initial data error:', error);
      throw error;
    }
  }, [fadeAnim]);

  // Enhanced cleanup on unmount
  useEffect(() => {
    return () => {
      isUnmountedRef.current = true;
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      unloadSounds();
    };
  }, [unloadSounds]);

  // Initialize game and load data
  useEffect(() => {
    let isCancelled = false;

    const initialize = async () => {
      try {
        await loadInitialData();
        if (!isCancelled && !isUnmountedRef.current) {
          await loadSounds();
          setIsInitialized(true);
        }
      } catch (error) {
        console.log('Initialization error:', error);
        if (!isCancelled && !isUnmountedRef.current) {
          setIsInitialized(true);
          setTimeout(() => {
            if (!isUnmountedRef.current) {
              fadeAnim.setValue(1);
              setGameState('menu');
            }
          }, 3000);
        }
      }
    };

    initialize();
    return () => { isCancelled = true; };
  }, []);

  // Enhanced game over handling
  const handleGameOver = useCallback(() => {
    if (isUnmountedRef.current) return;

    try {
      setGameState('gameOver');
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      
      playSound('gameover');
      
      const message = gameMode === 'puzzle' 
        ? `Puzzle failed! You used ${moves}/${maxMoves} moves.`
        : 'You ran out of time. Try again!';
      
      Alert.alert('Game Over!', message, [
        { text: 'OK', onPress: () => setGameState('menu') }
      ]);
    } catch (error) {
      console.log('Game over handling error:', error);
      setGameState('menu');
    }
  }, [playSound, gameMode, moves, maxMoves]);

  // Enhanced timer effect
  useEffect(() => {
    if (gameState === 'playing' && timeLeft > 0 && !isUnmountedRef.current) {
      timerRef.current = setTimeout(() => {
        if (!isUnmountedRef.current) {
          setTimeLeft(prev => prev - 1);
        }
      }, 1000);
    } else if (timeLeft === 0 && gameState === 'playing' && !isUnmountedRef.current) {
      handleGameOver();
    }

    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [timeLeft, gameState, handleGameOver]);

  // Safe settings save
  const saveSettings = useCallback(async () => {
    try {
      await Promise.all([
        safeAsyncStorage.setItem('gridzen2_darkMode', JSON.stringify(isDarkMode)),
        safeAsyncStorage.setItem('gridzen2_soundOn', JSON.stringify(soundEnabled))
      ]);
    } catch (error) {
      console.log('Settings save error:', error);
    }
  }, [isDarkMode, soundEnabled]);

  // Enhanced high scores save
  const saveHighScores = useCallback(async (scores) => {
    try {
      await safeAsyncStorage.setItem('gridzen2_highscores', JSON.stringify(scores));
    } catch (error) {
      console.log('High scores save error:', error);
    }
  }, []);

  // Enhanced player name save
  const savePlayerName = useCallback(async (name) => {
    try {
      await safeAsyncStorage.setItem('gridzen2_playername', name);
    } catch (error) {
      console.log('Player name save error:', error);
    }
  }, []);

  // Enhanced grid initialization with puzzle support
  const initializeGrid = useCallback(() => {
    try {
      const size = gridSize * gridSize;
      const colors = generateDistinctColors(size);

      // Create target grid (numbers in order)
      const target = [];
      for (let i = 0; i < gridSize; i++) {
        target[i] = [];
        for (let j = 0; j < gridSize; j++) {
          target[i][j] = {
            number: i * gridSize + j + 1,
            color: colors[i * gridSize + j],
          };
        }
      }
      setTargetGrid(target);

      let numbers;
      if (gameMode === 'puzzle') {
        const puzzle = PUZZLE_PACKS[currentPuzzlePack]?.[currentPuzzleIndex];
        if (puzzle) {
          numbers = [...puzzle.startGrid];
          setMaxMoves(puzzle.maxMoves);
        } else {
          numbers = Array.from({ length: size }, (_, i) => i + 1);
        }
      } else {
        numbers = Array.from({ length: size }, (_, i) => i + 1);
        let attempts = 0;
        do {
          numbers = numbers.sort(() => Math.random() - 0.5);
          attempts++;
        } while (JSON.stringify(numbers) === JSON.stringify(Array.from({ length: size }, (_, i) => i + 1)) && attempts < 10);
      }

      const newGrid = [];
      for (let i = 0; i < gridSize; i++) {
        newGrid[i] = [];
        for (let j = 0; j < gridSize; j++) {
          const index = i * gridSize + j;
          newGrid[i][j] = {
            number: numbers[index],
            color: colors[numbers[index] - 1],
          };
        }
      }
      setGrid(newGrid);
    } catch (error) {
      console.log('Grid initialization error:', error);
      const fallbackGrid = Array(gridSize).fill().map((_, i) => 
        Array(gridSize).fill().map((_, j) => ({
          number: i * gridSize + j + 1,
          color: `hsl(${(i * gridSize + j) * 40}, 70%, 50%)`
        }))
      );
      setGrid(fallbackGrid);
      setTargetGrid(fallbackGrid);
    }
  }, [gridSize, gameMode, currentPuzzlePack, currentPuzzleIndex]);

  // Enhanced start game with puzzle support
  const startGame = useCallback(() => {
    try {
      if (!playerName.trim()) {
        Alert.alert('Name Required', 'Please enter your name to continue.');
        return;
      }

      savePlayerName(playerName);
      setGameState('playing');
      setMoves(0);
      setTimeLeft(getTimeLimit(gridSize));
      setSelectedTile(null);
      setPowerUps([]);
      setSelectedPowerUp(null);
      initializeGrid();
    } catch (error) {
      console.log('Start game error:', error);
      Alert.alert('Error', 'Failed to start game. Please try again.');
    }
  }, [playerName, gridSize, getTimeLimit, initializeGrid, savePlayerName]);

  // Enhanced win condition check
  const checkWin = useCallback((currentGrid) => {
    try {
      if (!currentGrid || !Array.isArray(currentGrid)) {
        return false;
      }
      
      let expectedNumber = 1;
      for (let i = 0; i < gridSize; i++) {
        for (let j = 0; j < gridSize; j++) {
          if (!currentGrid[i] || !currentGrid[i][j] || currentGrid[i][j].number !== expectedNumber) {
            return false;
          }
          expectedNumber++;
        }
      }
      return true;
    } catch (error) {
      console.log('Win check error:', error);
      return false;
    }
  }, [gridSize]);

  // Enhanced win handling with puzzle progression
  const handleWin = useCallback(() => {
    if (isUnmountedRef.current) return;

    try {
      setGameState('won');
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      
      if (confettiRef.current) {
        confettiRef.current.start();
      }
      
      const scoreKey = gameMode === 'puzzle' 
        ? `puzzle-${currentPuzzlePack}-${currentPuzzleIndex}`
        : `${gridSize}x${gridSize}`;
        
      const newScore = {
        name: playerName,
        moves: moves,
        timeRemaining: timeLeft,
        date: new Date().toLocaleDateString(),
        mode: gameMode,
        ...(gameMode === 'puzzle' && { 
          puzzlePack: currentPuzzlePack, 
          puzzleIndex: currentPuzzleIndex,
          maxMoves: maxMoves
        })
      };
      
      const updatedScores = { ...highScores };
      if (!updatedScores[scoreKey]) {
        updatedScores[scoreKey] = [];
      }
      
      updatedScores[scoreKey].push(newScore);
      updatedScores[scoreKey].sort((a, b) => a.moves - b.moves);
      updatedScores[scoreKey] = updatedScores[scoreKey].slice(0, 5);
      
      setHighScores(updatedScores);
      saveHighScores(updatedScores);
      playSound('victory');
      
      let message = `You won in ${moves} moves with ${timeLeft} seconds remaining!`;
      if (gameMode === 'puzzle') {
        const currentPuzzle = PUZZLE_PACKS[currentPuzzlePack]?.[currentPuzzleIndex];
        message = `Puzzle "${currentPuzzle?.name || 'Unknown'}" solved!`;
        if (currentPuzzleIndex < PUZZLE_PACKS[currentPuzzlePack].length - 1) {
          message += '\nNext puzzle unlocked!';
        }
      }
      
      Alert.alert('Congratulations!', message, [
        { text: 'OK', onPress: () => setGameState('menu') }
      ]);
    } catch (error) {
      console.log('Win handling error:', error);
      setGameState('menu');
    }
  }, [gridSize, playerName, moves, timeLeft, highScores, saveHighScores, playSound, gameMode, currentPuzzlePack, currentPuzzleIndex, maxMoves]);

  // Enhanced tile press handling with power-ups
  const handleTilePress = useCallback((row, col) => {
    if (gameState !== 'playing' || isUnmountedRef.current) return;

    try {
      // Special handling for SWAP_ANY power-up
      if (selectedPowerUp === 'SWAP_ANY') {
        if (!selectedTile) {
          setSelectedTile({ row, col });
        } else {
          // Swap any two tiles
          const { row: selRow, col: selCol } = selectedTile;
          const newGrid = grid.map(gridRow => [...gridRow]);
          const temp = newGrid[row][col];
          newGrid[row][col] = newGrid[selRow][selCol];
          newGrid[selRow][selCol] = temp;
          
          setGrid(newGrid);
          setMoves(prev => prev + 1);
          setSelectedTile(null);
          setSelectedPowerUp(null);
          
          if (checkWin(newGrid)) {
            setTimeout(() => handleWin(), 300);
          }
        }
        return;
      }

      if (!selectedTile) {
        setSelectedTile({ row, col });
      } else {
        const { row: selRow, col: selCol } = selectedTile;
        
        if (row === selRow && col === selCol) {
          setSelectedTile(null);
          return;
        }
        
        const isAdjacent = 
          (Math.abs(row - selRow) === 1 && col === selCol) ||
          (Math.abs(col - selCol) === 1 && row === selRow);

        if (isAdjacent) {
          // Check puzzle mode move limit
          if (gameMode === 'puzzle' && moves >= maxMoves) {
            Alert.alert('No More Moves!', `You've used all ${maxMoves} moves for this puzzle.`);
            handleGameOver();
            return;
          }

          animateTileSwap({ row: selRow, col: selCol }, { row, col });
          
          const newGrid = grid.map(gridRow => [...gridRow]);
          const temp = newGrid[row][col];
          newGrid[row][col] = newGrid[selRow][selCol];
          newGrid[selRow][selCol] = temp;
          
          setGrid(newGrid);
          
          // Handle move counting and power-up generation
          const isFreeMoveActive = selectedPowerUp === 'DOUBLE_MOVE';
          if (!isFreeMoveActive) {
            setMoves(prev => prev + 1);
            
            // Generate power-up occasionally in classic mode
            if (gameMode === 'classic' && (moves + 1) % 8 === 0) {
              const newPowerUp = generatePowerUp();
              if (newPowerUp) {
                setPowerUps(prev => [...prev, newPowerUp]);
              }
            }
          } else {
            setSelectedPowerUp(null); // Free move used
          }
          
          setSelectedTile(null);
          
          // Check for win condition
          const isWin = checkWin(newGrid);
          console.log('Win check result:', isWin, 'Game mode:', gameMode);
          if (isWin) {
            console.log('Victory detected! Showing dialog...');
            setTimeout(() => {
              handleWin();
            }, 300);
          }
        } else {
          setSelectedTile({ row, col });
        }
      }
    } catch (error) {
      console.log('Tile press error:', error);
      setSelectedTile(null);
    }
  }, [gameState, selectedTile, grid, checkWin, handleWin, animateTileSwap, selectedPowerUp, gameMode, moves, maxMoves, handleGameOver, generatePowerUp]);

  // Reset high scores
  const resetHighScores = useCallback(() => {
    Alert.alert(
      'Reset High Scores',
      'Are you sure you want to delete all high scores? This action cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Reset',
          style: 'destructive',
          onPress: async () => {
            try {
              setHighScores({});
              await safeAsyncStorage.removeItem('gridzen2_highscores');
              Alert.alert('Success', 'All high scores have been reset.');
            } catch (error) {
              console.log('Reset scores error:', error);
              Alert.alert('Error', 'Failed to reset scores.');
            }
          },
        },
      ]
    );
  }, []);

  // Enhanced tile rendering with styled borders and power-up highlights
  const renderTile = useCallback((tile, row, col) => {
    try {
      if (!tile) return null;

      const isSelected = selectedTile && selectedTile.row === row && selectedTile.col === col;
      const tileSize = Math.max(40, (screenWidth - 100) / gridSize - 10);
      const key = `${row}-${col}`;
      const isAnimating = animatingTiles.has(key);
      const animation = initializeTileAnimation(row, col);
      
      if (Platform.OS === 'android' && !isAnimating) {
        animation.translateX.setValue(0);
        animation.translateY.setValue(0);
      }
      
      return (
        <Animated.View
          key={key}
          style={{
            transform: [
              { translateX: animation.translateX },
              { translateY: animation.translateY }
            ],
            opacity: 1,
          }}
        >
          <TouchableOpacity
            style={[
              styles.tile,
              {
                backgroundColor: tile.color || '#cccccc',
                width: tileSize,
                height: tileSize,
                borderColor: isSelected ? theme.selectedTile : theme.border,
                borderWidth: isSelected ? 3 : 1,
                shadowColor: '#000',
                shadowOffset: { width: 0, height: 4 },
                shadowOpacity: 0.3,
                shadowRadius: 4.65,
                elevation: 8,
              },
            ]}
            onPress={() => handleTilePress(row, col)}
            activeOpacity={0.7}
            disabled={isAnimating}
          >
            <Text style={[
              styles.tileText, 
              { 
                color: theme.text, 
                fontSize: Math.min(24, tileSize / 3),
                textShadowColor: theme.numberBorder,
                textShadowOffset: { width: 1, height: 1 },
                textShadowRadius: 1,
              }
            ]}>
              {tile.number || '?'}
            </Text>
          </TouchableOpacity>
        </Animated.View>
      );
    } catch (error) {
      console.log('Tile render error:', error);
      return (
        <View
          key={`${row}-${col}-error`}
          style={[styles.tile, { backgroundColor: '#cccccc', width: 40, height: 40 }]}
        >
          <Text style={styles.tileText}>?</Text>
        </View>
      );
    }
  }, [selectedTile, gridSize, theme, handleTilePress, animatingTiles, initializeTileAnimation]);

  // Settings modal
  const renderSettingsModal = useCallback(() => {
    return (
      <Modal
        visible={showSettings}
        animationType="slide"
        transparent={true}
        onRequestClose={() => setShowSettings(false)}
      >
        <View style={[styles.modalContainer, { backgroundColor: 'rgba(0,0,0,0.5)' }]}>
          <View style={[styles.modalContent, { backgroundColor: theme.background }]}>
            <Text style={[styles.modalTitle, { color: theme.text }]}>Settings</Text>
            
            <View style={styles.settingsContainer}>
              <View style={styles.settingRow}>
                <Text style={[styles.settingLabel, { color: theme.text }]}>Dark Mode</Text>
                <Switch
                  value={isDarkMode}
                  onValueChange={(value) => {
                    setIsDarkMode(value);
                    saveSettings();
                  }}
                  trackColor={{ false: '#767577', true: '#81b0ff' }}
                  thumbColor={isDarkMode ? '#f5dd4b' : '#f4f3f4'}
                />
              </View>

              <View style={styles.settingRow}>
                <Text style={[styles.settingLabel, { color: theme.text }]}>
                  Sounds {soundEnabled ? '🔔' : '🔕'}
                </Text>
                <Switch
                  value={soundEnabled}
                  onValueChange={(value) => {
                    setSoundEnabled(value);
                    saveSettings();
                  }}
                  trackColor={{ false: '#767577', true: '#81b0ff' }}
                  thumbColor={soundEnabled ? '#f5dd4b' : '#f4f3f4'}
                />
              </View>
            </View>
            
            <TouchableOpacity
              style={[styles.button, { backgroundColor: theme.button, marginTop: 20 }]}
              onPress={() => setShowSettings(false)}
            >
              <Text style={[styles.buttonText, { color: theme.buttonText }]}>Close</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    );
  }, [showSettings, theme, isDarkMode, soundEnabled, saveSettings]);

  // Grid size selection modal
  const renderGridSizeModal = useCallback(() => {
    return (
      <Modal
        visible={showGridSizeModal}
        animationType="fade"
        transparent={true}
        onRequestClose={() => setShowGridSizeModal(false)}
      >
        <View style={[styles.modalContainer, { backgroundColor: 'rgba(0,0,0,0.5)' }]}>
          <View style={[styles.gridSizeModal, { backgroundColor: theme.background }]}>
            <Text style={[styles.modalTitle, { color: theme.text }]}>Select Grid Size</Text>
            
            <View style={[styles.pickerContainer, { backgroundColor: theme.input }]}>
              <Picker
                selectedValue={gridSize}
                onValueChange={(value) => setGridSize(value)}
                style={{ color: theme.inputText }}
              >
                <Picker.Item label="4x4 Grid" value={4} />
                <Picker.Item label="5x5 Grid" value={5} />
                <Picker.Item label="6x6 Grid" value={6} />
              </Picker>
            </View>
            
            <View style={styles.modalButtons}>
              <TouchableOpacity
                style={[styles.compactButton, { backgroundColor: theme.selectedTile, flex: 1, marginRight: 5 }]}
                onPress={() => setShowGridSizeModal(false)}
              >
                <Text style={[styles.compactButtonText, { color: '#ffffff' }]}>Confirm</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.compactButton, { backgroundColor: theme.button, flex: 1, marginLeft: 5 }]}
                onPress={() => setShowGridSizeModal(false)}
              >
                <Text style={[styles.compactButtonText, { color: theme.buttonText }]}>Cancel</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    );
  }, [showGridSizeModal, theme, gridSize]);

  // Power-up modal rendering
  const renderPowerUpModal = useCallback(() => {
    if (powerUps.length === 0) return null;

    return (
      <Modal
        visible={showPowerUpModal}
        animationType="fade"
        transparent={true}
        onRequestClose={() => setShowPowerUpModal(false)}
      >
        <View style={[styles.modalContainer, { backgroundColor: 'rgba(0,0,0,0.8)' }]}>
          <View style={[styles.powerUpModal, { backgroundColor: theme.background }]}>
            <Text style={[styles.modalTitle, { color: theme.text }]}>Power-Up Available!</Text>
            {powerUps.map((powerUp) => (
              <TouchableOpacity
                key={powerUp.id}
                style={[styles.powerUpButton, { backgroundColor: theme.button }]}
                onPress={() => usePowerUp(powerUp.type)}
              >
                <Text style={styles.powerUpIcon}>{powerUp.icon}</Text>
                <View style={styles.powerUpInfo}>
                  <Text style={[styles.powerUpName, { color: theme.buttonText }]}>{powerUp.name}</Text>
                  <Text style={[styles.powerUpDescription, { color: theme.buttonText }]}>{powerUp.description}</Text>
                </View>
              </TouchableOpacity>
            ))}
            <TouchableOpacity
              style={[styles.button, { backgroundColor: theme.border, marginTop: 10 }]}
              onPress={() => setShowPowerUpModal(false)}
            >
              <Text style={[styles.buttonText, { color: theme.buttonText }]}>Later</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    );
  }, [powerUps, showPowerUpModal, theme, usePowerUp]);

  // Puzzle selection modal
  
  const renderPuzzleSelectModal = useCallback(() => {
    const packs = ['beginner', 'intermediate', 'advanced'];
    const packTitles = { beginner: 'Beginner', intermediate: 'Intermediate', advanced: 'Advanced' };

    return (
      <Modal visible={showPuzzleSelect} animationType="slide" transparent onRequestClose={() => setShowPuzzleSelect(false)}>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalCard, { backgroundColor: theme.modalBackground }]}>
            <Text style={[styles.modalTitle, { color: theme.text }]}>Select Puzzle Pack</Text>
            <Text style={[styles.unlockNote, { color: theme.text }]}>
              Beat all puzzles in a level to unlock the next pack.
            </Text>

            <View style={styles.packRow}>
              {packs.map((pack) => {
                const locked = (pack === 'intermediate' && !isPackCompleted('beginner')) ||
                               (pack === 'advanced' && !isPackCompleted('intermediate'));
                const complete = isPackCompleted(pack);

                return (
                  <View key={pack} style={styles.packColumn}>
                    <View style={styles.packHeader}>
                      <Text style={[styles.puzzlePackTitle, { color: theme.text }]}>
                        {packTitles[pack]} {complete ? '✅' : ''} {locked ? '🔒' : ''}
                      </Text>
                    </View>

                    <View style={[styles.puzzleGrid, locked && { opacity: 0.5 }]} pointerEvents={locked ? 'none' : 'auto'}>
                      {(PUZZLE_PACKS[pack] || []).map((pz, idx) => {
                        const selected = (currentPuzzlePack === pack && currentPuzzleIndex === idx);
                        const solved = isPuzzleCompleted(pack, idx);
                        return (
                          <TouchableOpacity
                            key={`${pack}-${idx}`}
                            style={[
                              styles.puzzleCell,
                              { backgroundColor: selected ? theme.selectedTile : theme.button }
                            ]}
                            disabled={locked}
                            onPress={() => {
                              setCurrentPuzzlePack(pack);
                              setCurrentPuzzleIndex(idx);
                            }}
                          >
                            <Text style={[styles.puzzleCellText, { color: theme.buttonText }]} numberOfLines={2}>
                              {pz.name}
                            </Text>
                            <Text style={[styles.puzzleCellSub, { color: theme.buttonText }]}>
                              {pz.gridSize}x{pz.gridSize} • {pz.maxMoves}
                            </Text>
                            {solved ? <Text style={styles.checkMark}>✓</Text> : null}
                          </TouchableOpacity>
                        );
                      })}
                    </View>
                  </View>
                );
              })}
            </View>

            <View style={{ flexDirection: 'row', gap: 12, marginTop: 16 }}>
              <TouchableOpacity
                style={[styles.button, { backgroundColor: theme.selectedTile, flex: 1 }]}
                onPress={() => { setShowPuzzleSelect(false); startGame(); }}
              >
                <Text style={[styles.buttonText, { color: '#fff' }]}>Start Selected</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.button, { backgroundColor: theme.button, flex: 1 }]}
                onPress={() => setShowPuzzleSelect(false)}
              >
                <Text style={[styles.buttonText, { color: theme.buttonText }]}>Cancel</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    );
  }, [showPuzzleSelect, theme, currentPuzzlePack, currentPuzzleIndex, startGame, isPackCompleted, isPuzzleCompleted]);

}

export default GridZenGame;