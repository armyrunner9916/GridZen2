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
  Image
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Picker } from '@react-native-picker/picker';
import { Audio } from 'expo-av';
import { BannerAd, BannerAdSize, TestIds } from 'react-native-google-mobile-ads';
import ConfettiCannon from 'react-native-confetti-cannon';

// Enable LayoutAnimation on Android to avoid crashes related to animated layout changes
if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

const { width: screenWidth, height: screenHeight } = Dimensions.get('window');

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

// Game component
const GridZenGame = () => {
  const [gameState, setGameState] = useState('splash');
  const [gridSize, setGridSize] = useState(3);
  const [grid, setGrid] = useState([]);
  const [targetGrid, setTargetGrid] = useState([]);
  const [selectedTile, setSelectedTile] = useState(null);
  const [moves, setMoves] = useState(0);
  const [timeLeft, setTimeLeft] = useState(30);
  const [playerName, setPlayerName] = useState('');
  const [highScores, setHighScores] = useState({});
  const [isDarkMode, setIsDarkMode] = useState(false);
  const [soundEnabled, setSoundEnabled] = useState(false);
  const [showHighScores, setShowHighScores] = useState(false);
  const [selectedDifficulty, setSelectedDifficulty] = useState('3x3');
  const [isInitialized, setIsInitialized] = useState(false);
  const [animatingTiles, setAnimatingTiles] = useState(new Set());

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
      case 3:
        return ['#4CAF50', '#000000']; // Green to black (Easy)
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

  // Enhanced sound loading with better error handling
  const loadSounds = useCallback(async () => {
    if (isUnmountedRef.current) return;

    try {
      // Only attempt audio setup on native platforms
      if (Platform.OS !== 'web') {
        try {
          await Audio.setAudioModeAsync({
            playsInSilentModeIOS: true,
            shouldDuckAndroid: true,
            staysActiveInBackground: false,
            allowsRecordingIOS: false,
          });
        } catch (audioError) {
          console.log('Audio mode setup failed (non-critical):', audioError);
          // Continue without audio mode setup
        }
      }

      // Load sounds with better error handling
      try {
        const gameOverSoundObject = await Audio.Sound.createAsync(
          require('./assets/sounds/Game_over.mp3'),
          { shouldPlay: false, isLooping: false }
        );
        
        const victorySoundObject = await Audio.Sound.createAsync(
          require('./assets/sounds/Cheer.mp3'),
          { shouldPlay: false, isLooping: false }
        );

        if (!isUnmountedRef.current) {
          gameOverSound.current = gameOverSoundObject.sound;
          victorySound.current = victorySoundObject.sound;
        }
      } catch (loadError) {
        console.log('Sound loading failed (non-critical):', loadError);
        // Continue without sounds
        gameOverSound.current = null;
        victorySound.current = null;
      }
    } catch (error) {
      console.log('Sound initialization failed (non-critical):', error);
      // Ensure sound refs are null on failure
      gameOverSound.current = null;
      victorySound.current = null;
    }
  }, []);

  // Safe sound playing with error handling
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
        await soundRef.replayAsync();
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
  }), [isDarkMode]);

  // Time limits based on grid size - memoized
  const getTimeLimit = useCallback((size) => {
    const timeLimits = { 3: 30, 4: 60, 5: 90, 6: 120 };
    return timeLimits[size] || 30;
  }, []);

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
    
    const tileSize = Math.max(40, (screenWidth - 60) / gridSize - 10);
    const spacing = tileSize + 10;
    
    const deltaX = (toPos.col - fromPos.col) * spacing;
    const deltaY = (toPos.row - fromPos.row) * spacing;
    
    setAnimatingTiles(prev => new Set([...prev, fromKey, toKey]));
    
    const animations = [
      Animated.timing(fromAnim.translateX, {
        toValue: deltaX,
        duration: 250,
        useNativeDriver: true,
      }),
      Animated.timing(fromAnim.translateY, {
        toValue: deltaY,
        duration: 250,
        useNativeDriver: true,
      }),
      Animated.timing(toAnim.translateX, {
        toValue: -deltaX,
        duration: 250,
        useNativeDriver: true,
      }),
      Animated.timing(toAnim.translateY, {
        toValue: -deltaY,
        duration: 250,
        useNativeDriver: true,
      })
    ];
    
    Animated.parallel(animations).start(() => {
      // Reset animations
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
    });
  }, [initializeTileAnimation, gridSize]);

  // Enhanced initial data loading
  const loadInitialData = useCallback(async () => {
    try {
      // Load all data in parallel for better performance
      const [savedScores, savedName, savedDarkMode, savedSound] = await Promise.all([
        safeAsyncStorage.getItem('gridzen_highscores'),
        safeAsyncStorage.getItem('gridzen_playername'),
        safeAsyncStorage.getItem('darkMode'),
        safeAsyncStorage.getItem('soundOn')
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

        // Enhanced splash screen transition
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
      throw error; // Re-throw to handle in initialize
    }
  }, [fadeAnim]);

  // Enhanced cleanup on unmount
  useEffect(() => {
    return () => {
      isUnmountedRef.current = true;

      // Clear timer
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      
      // Unload sounds safely
      unloadSounds();
    };
  }, [unloadSounds]);

  // Initialize game and load data - enhanced error handling
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
        // Continue with default state
        if (!isCancelled && !isUnmountedRef.current) {
          setIsInitialized(true);
          // Still show menu even if initialization fails
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

    return () => {
      isCancelled = true;
    };
  }, [loadInitialData, loadSounds, fadeAnim]);

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
      
      Alert.alert(
        'Time\'s Up!',
        'You ran out of time. Try again!',
        [{ text: 'OK', onPress: () => setGameState('menu') }]
      );
    } catch (error) {
      console.log('Game over handling error:', error);
      setGameState('menu');
    }
  }, [playSound]);

  // Enhanced timer effect with better cleanup
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
        safeAsyncStorage.setItem('darkMode', JSON.stringify(isDarkMode)),
        safeAsyncStorage.setItem('soundOn', JSON.stringify(soundEnabled))
      ]);
    } catch (error) {
      console.log('Settings save error:', error);
    }
  }, [isDarkMode, soundEnabled]);

  // Enhanced high scores save
  const saveHighScores = useCallback(async (scores) => {
    try {
      await safeAsyncStorage.setItem('gridzen_highscores', JSON.stringify(scores));
    } catch (error) {
      console.log('High scores save error:', error);
    }
  }, []);

  // Enhanced player name save
  const savePlayerName = useCallback(async (name) => {
    try {
      await safeAsyncStorage.setItem('gridzen_playername', name);
    } catch (error) {
      console.log('Player name save error:', error);
    }
  }, []);

  // Enhanced grid initialization with error handling
  const initializeGrid = useCallback(() => {
    try {
      const size = gridSize * gridSize;
      const colors = generateDistinctColors(size);
      const numbers = Array.from({ length: size }, (_, i) => i + 1);

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

      // Create shuffled grid - ensure it's solvable
      let shuffled;
      let attempts = 0;
      do {
        shuffled = [...numbers].sort(() => Math.random() - 0.5);
        attempts++;
      } while (JSON.stringify(shuffled) === JSON.stringify(numbers) && attempts < 10);

      const newGrid = [];
      for (let i = 0; i < gridSize; i++) {
        newGrid[i] = [];
        for (let j = 0; j < gridSize; j++) {
          const index = i * gridSize + j;
          newGrid[i][j] = {
            number: shuffled[index],
            color: colors[shuffled[index] - 1],
          };
        }
      }
      setGrid(newGrid);
    } catch (error) {
      console.log('Grid initialization error:', error);
      // Fallback to simple grid
      const fallbackGrid = Array(gridSize).fill().map((_, i) => 
        Array(gridSize).fill().map((_, j) => ({
          number: i * gridSize + j + 1,
          color: `hsl(${(i * gridSize + j) * 40}, 70%, 50%)`
        }))
      );
      setGrid(fallbackGrid);
      setTargetGrid(fallbackGrid);
    }
  }, [gridSize]);

  // Enhanced start game with validation
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
      initializeGrid();
    } catch (error) {
      console.log('Start game error:', error);
      Alert.alert('Error', 'Failed to start game. Please try again.');
    }
  }, [playerName, gridSize, getTimeLimit, initializeGrid, savePlayerName]);

  // Enhanced win condition check
  const checkWin = useCallback((currentGrid) => {
    try {
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

  // Enhanced win handling with confetti
  const handleWin = useCallback(() => {
    if (isUnmountedRef.current) return;

    try {
      setGameState('won');
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      
      // Fire confetti
      if (confettiRef.current) {
        confettiRef.current.start();
      }
      
      const scoreKey = `${gridSize}x${gridSize}`;
      const newScore = {
        name: playerName,
        moves: moves,
        timeRemaining: timeLeft,
        date: new Date().toLocaleDateString(),
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
      
      Alert.alert(
        'Congratulations!',
        `You won in ${moves} moves with ${timeLeft} seconds remaining!`,
        [{ text: 'OK', onPress: () => setGameState('menu') }]
      );
    } catch (error) {
      console.log('Win handling error:', error);
      setGameState('menu');
    }
  }, [gridSize, playerName, moves, timeLeft, highScores, saveHighScores, playSound]);

  // Enhanced tile press handling with smooth animation
  const handleTilePress = useCallback((row, col) => {
    if (gameState !== 'playing' || isUnmountedRef.current) return;

    try {
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
          // Animate the swap
          animateTileSwap({ row: selRow, col: selCol }, { row, col });
          
          const newGrid = grid.map(gridRow => [...gridRow]);
          const temp = newGrid[row][col];
          newGrid[row][col] = newGrid[selRow][selCol];
          newGrid[selRow][selCol] = temp;
          
          setGrid(newGrid);
          setMoves(prev => prev + 1);
          setSelectedTile(null);
          
          if (checkWin(newGrid)) {
            setTimeout(() => handleWin(), 300); // Delay to let animation finish
          }
        } else {
          setSelectedTile({ row, col });
        }
      }
    } catch (error) {
      console.log('Tile press error:', error);
      setSelectedTile(null);
    }
  }, [gameState, selectedTile, grid, checkWin, handleWin, animateTileSwap]);

  // Enhanced reset high scores
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
              await safeAsyncStorage.removeItem('gridzen_highscores');
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

  // Enhanced tile rendering with animation support
  const renderTile = useCallback((tile, row, col) => {
    try {
      if (!tile) return null;

      const isSelected = selectedTile && selectedTile.row === row && selectedTile.col === col;
      const tileSize = Math.max(40, (screenWidth - 60) / gridSize - 10);
      const key = `${row}-${col}`;
      const isAnimating = animatingTiles.has(key);
      const animation = initializeTileAnimation(row, col);
      
      return (
        <Animated.View
          key={key}
          style={{
            transform: [
              { translateX: animation.translateX },
              { translateY: animation.translateY }
            ]
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
                shadowOffset: {
                  width: 0,
                  height: 4,
                },
                shadowOpacity: 0.3,
                shadowRadius: 4.65,
                elevation: 8,
              },
            ]}
            onPress={() => handleTilePress(row, col)}
            activeOpacity={0.7}
            disabled={isAnimating}
          >
            <Text style={[styles.tileText, { color: theme.text, fontSize: Math.min(24, tileSize / 3) }]}>
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

  // Enhanced high scores modal rendering
  const renderHighScoresModal = useCallback(() => {
    const scores = highScores[selectedDifficulty] || [];

    return (
      <Modal
        visible={showHighScores}
        animationType="slide"
        transparent={true}
        onRequestClose={() => setShowHighScores(false)}
      >
        <SafeComponent fallback={<View style={styles.modalContainer}><Text>Error loading scores</Text></View>}>
          <View style={[styles.modalContainer, { backgroundColor: 'rgba(0,0,0,0.5)' }]}>
            <View style={[styles.modalContent, { backgroundColor: theme.background }]}>
              <Text style={[styles.modalTitle, { color: theme.text }]}>High Scores</Text>
              
              <TouchableOpacity
                style={[styles.resetButton, { backgroundColor: '#ff4444' }]}
                onPress={resetHighScores}
              >
                <Text style={[styles.resetButtonText, { color: '#ffffff' }]}>Reset All Scores</Text>
              </TouchableOpacity>
              
              <View style={[styles.pickerContainer, { backgroundColor: theme.input }]}>
                <Picker
                  selectedValue={selectedDifficulty}
                  onValueChange={setSelectedDifficulty}
                  style={{ color: theme.inputText }}
                >
                  <Picker.Item label="3x3" value="3x3" />
                  <Picker.Item label="4x4" value="4x4" />
                  <Picker.Item label="5x5" value="5x5" />
                  <Picker.Item label="6x6" value="6x6" />
                </Picker>
              </View>
              
              <ScrollView style={styles.scoresContainer}>
                {scores.length > 0 ? (
                  scores.map((score, index) => (
                    <View key={`${score.name}-${index}`} style={[styles.scoreRow, { borderBottomColor: theme.border }]}>
                      <Text style={[styles.scoreRank, { color: theme.text }]}>#{index + 1}</Text>
                      <View style={styles.scoreInfo}>
                        <Text style={[styles.scoreName, { color: theme.text }]}>{score.name}</Text>
                        <Text style={[styles.scoreDetails, { color: theme.text }]}>
                          {score.moves} moves • {score.timeRemaining}s left
                        </Text>
                        <Text style={[styles.scoreDate, { color: theme.text, opacity: 0.7 }]}>
                          {score.date}
                        </Text>
                      </View>
                    </View>
                  ))
                ) : (
                  <Text style={[styles.noScores, { color: theme.text }]}>
                    No high scores yet for {selectedDifficulty}
                  </Text>
                )}
              </ScrollView>
              
              <TouchableOpacity
                style={[styles.button, { backgroundColor: theme.button }]}
                onPress={() => setShowHighScores(false)}
              >
                <Text style={[styles.buttonText, { color: theme.buttonText }]}>Close</Text>
              </TouchableOpacity>
            </View>
          </View>
        </SafeComponent>
      </Modal>
    );
  }, [showHighScores, selectedDifficulty, highScores, theme, resetHighScores]);

  // Enhanced menu rendering with gradient background
  const renderMenu = useCallback(() => {
    const gradientColors = getDifficultyGradient(gridSize);
    
    return (
      <SafeComponent fallback={<View style={styles.container}><Text>Loading...</Text></View>}>
        <View style={[styles.container, { backgroundColor: theme.background, flex: 1 }]}>
          <View style={[styles.gradientBackground, {
            background: `linear-gradient(135deg, ${gradientColors[0]}, ${gradientColors[1]})`
          }]} />
          <ScrollView contentContainerStyle={{ paddingBottom: 80 }}>
            <Text style={[styles.title, { color: theme.text }]}>GridZen</Text>

            <View style={styles.controls}>
              <View style={styles.controlRow}>
                <Text style={[styles.controlLabel, { color: theme.text }]}>Dark Mode</Text>
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

              <TouchableOpacity
                style={[styles.controlButton, { backgroundColor: theme.button }]}
                onPress={() => setShowHighScores(true)}
              >
                <Text style={[styles.buttonText, { color: theme.buttonText }]}>View High Scores</Text>
              </TouchableOpacity>

              <View style={styles.controlRow}>
                <Text style={[styles.controlLabel, { color: theme.text }]}>
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

            <View style={styles.menuContent}>
              <Text style={[styles.instructions, { color: theme.text }]}>
                Rearrange the tiles to place numbers in order from 1 to {gridSize * gridSize},
                reading left to right, top to bottom.
              </Text>

              <Text style={[styles.instructions, { color: theme.text }]}>
                You can only swap adjacent tiles (up-down, left-right).
              </Text>

              <TextInput
                style={[styles.input, { backgroundColor: theme.input, color: theme.inputText }]}
                placeholder="Enter your name"
                placeholderTextColor={isDarkMode ? '#999' : '#666'}
                value={playerName}
                onChangeText={setPlayerName}
                maxLength={20}
              />

              <Text style={[styles.label, { color: theme.text }]}>Select Grid Size:</Text>

              <View style={styles.sizeButtons}>
                {[3, 4, 5, 6].map((size) => (
                  <TouchableOpacity
                    key={size}
                    style={[
                      styles.sizeButton,
                      {
                        backgroundColor: gridSize === size ? theme.selectedTile : theme.button,
                      },
                    ]}
                    onPress={() => setGridSize(size)}
                  >
                    <Text
                      style={[
                        styles.sizeButtonText,
                        {
                          color: gridSize === size ? '#ffffff' : theme.buttonText,
                        },
                      ]}
                    >
                      {size}x{size}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>

              <Text style={[styles.timeLimit, { color: theme.text }]}>
                Time Limit: {getTimeLimit(gridSize)} seconds
              </Text>

              <TouchableOpacity
                style={[styles.startButton, { backgroundColor: theme.selectedTile }]}
                onPress={startGame}
              >
                <Text style={[styles.startButtonText, { color: '#ffffff' }]}>Start Game</Text>
              </TouchableOpacity>
            </View>

            {renderHighScoresModal()}
          </ScrollView>

          <BannerAd
            unitId={__DEV__ ? TestIds.BANNER : "ca-app-pub-7368779159802085/6628408902"}
            size={BannerAdSize.FULL_BANNER}
            requestOptions={{
              requestNonPersonalizedAdsOnly: true,
            }}
            onAdFailedToLoad={(error) => console.log("Ad failed to load:", error)}
          />
        </View>
      </SafeComponent>
    );
  }, [theme, isDarkMode, soundEnabled, saveSettings, gridSize, playerName, getTimeLimit, startGame, renderHighScoresModal, getDifficultyGradient]);

  // Enhanced game rendering with banner and gradient
  const renderGame = useCallback(() => {
    const gradientColors = getDifficultyGradient(gridSize);
    
    return (
      <SafeComponent fallback={<View style={styles.container}><Text>Game Error</Text></View>}>
        <View style={[styles.container, { backgroundColor: theme.background }]}>
          <View style={[styles.gradientBackground, {
            background: `linear-gradient(135deg, ${gradientColors[0]}, ${gradientColors[1]})`
          }]} />
          
          {/* GridZen2 Banner */}
          <View style={styles.bannerContainer}>
            <Image
              source={require('./assets/images/gridzen2.png')}
              style={styles.bannerImage}
              resizeMode="contain"
              onError={() => console.log('Banner image failed to load')}
            />
          </View>

          <View style={styles.header}>
            <Text style={[styles.headerText, { color: theme.text }]}>Moves: {moves}</Text>
            <Text style={[styles.headerText, { color: theme.text }]}>Time: {timeLeft}s</Text>
          </View>

          <View style={styles.gridContainer}>
            {grid.map((row, rowIndex) => (
              <View key={rowIndex} style={styles.row}>
                {row.map((tile, colIndex) => renderTile(tile, rowIndex, colIndex))}
              </View>
            ))}
          </View>
          
          <TouchableOpacity
            style={[styles.button, { backgroundColor: theme.button }]}
            onPress={() => {
              if (timerRef.current) {
                clearTimeout(timerRef.current);
                timerRef.current = null;
              }
              playSound('gameover');
              setGameState('menu');
            }}
          >
            <Text style={[styles.buttonText, { color: theme.buttonText }]}>Give Up</Text>
          </TouchableOpacity>

          {/* Confetti Cannon */}
          <ConfettiCannon
            ref={confettiRef}
            count={200}
            origin={{ x: screenWidth / 2, y: 0 }}
            autoStart={false}
            fadeOut={true}
          />
        </View>
      </SafeComponent>
    );
  }, [theme, moves, timeLeft, grid, renderTile, playSound, gridSize, getDifficultyGradient]);

  // Enhanced splash screen rendering
  const renderSplash = useCallback(() => {
    return (
      <SafeComponent fallback={<View style={styles.splashFallback}><Text style={{color: '#fff'}}>GridZen</Text></View>}>
        <View style={styles.splashContainer}>
          <Animated.Image
            source={require('./assets/images/splash.png')}
            style={[
              styles.splashImage,
              {
                opacity: fadeAnim,
                width: screenWidth,
                height: screenHeight,
              }
            ]}
            resizeMode="contain"
            onError={() => {
              console.log('Splash image failed to load');
              // Fallback to text
              setGameState('menu');
            }}
          />
        </View>
      </SafeComponent>
    );
  }, [fadeAnim]);

  // Main render with initialization check
  if (!isInitialized) {
    return (
      <View style={styles.loadingContainer}>
        <Text style={styles.loadingText}>Loading GridZen...</Text>
      </View>
    );
  }

  if (gameState === 'splash') {
    return renderSplash();
  }

  return gameState === 'menu' ? renderMenu() : renderGame();
};

// Enhanced styles with modern design and gradient support
const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 20,
    justifyContent: 'center',
    position: 'relative',
  },
  gradientBackground: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    opacity: 0.1,
    zIndex: 0,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#000',
  },
  loadingText: {
    color: '#fff',
    fontSize: 18,
  },
  splashContainer: {
    flex: 1,
    backgroundColor: '#000000',
    justifyContent: 'center',
    alignItems: 'center',
  },
  splashImage: {
    // Dynamic sizing handled in component
  },
  splashFallback: {
    flex: 1,
    backgroundColor: '#000000',
    justifyContent: 'center',
    alignItems: 'center',
  },
  bannerContainer: {
    alignItems: 'center',
    marginBottom: 15,
    paddingHorizontal: 20,
  },
  bannerImage: {
    height: 60,
    width: screenWidth - 40,
    maxWidth: 300,
  },
  title: {
    fontSize: Math.min(36, screenWidth * 0.1),
    fontWeight: 'bold',
    textAlign: 'center',
    marginBottom: 20,
    textShadowColor: 'rgba(0, 0, 0, 0.3)',
    textShadowOffset: { width: 1, height: 1 },
    textShadowRadius: 2,
  },
  controls: {
    marginBottom: 20,
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    borderRadius: 15,
    padding: 15,
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: 0.25,
    shadowRadius: 3.84,
    elevation: 5,
  },
  controlRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 15,
    paddingHorizontal: 10,
  },
  controlLabel: {
    fontSize: 16,
    flex: 1,
  },
  controlButton: {
    padding: 12,
    borderRadius: 12,
    marginBottom: 15,
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: 0.25,
    shadowRadius: 3.84,
    elevation: 5,
  },
  menuContent: {
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    borderRadius: 20,
    padding: 20,
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 4,
    },
    shadowOpacity: 0.3,
    shadowRadius: 4.65,
    elevation: 8,
  },
  instructions: {
    fontSize: 16,
    textAlign: 'center',
    marginBottom: 10,
    paddingHorizontal: 20,
    lineHeight: 22,
  },
  input: {
    width: '100%',
    padding: 15,
    borderRadius: 12,
    fontSize: 16,
    marginTop: 20,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: 'transparent',
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: 0.25,
    shadowRadius: 3.84,
    elevation: 5,
  },
  label: {
    fontSize: 18,
    marginBottom: 10,
    fontWeight: '600',
  },
  sizeButtons: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    marginBottom: 20,
  },
  sizeButton: {
    padding: 15,
    margin: 5,
    borderRadius: 12,
    minWidth: Math.min(60, screenWidth * 0.15),
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: 0.25,
    shadowRadius: 3.84,
    elevation: 5,
  },
  sizeButtonText: {
    fontSize: 16,
    fontWeight: 'bold',
    textAlign: 'center',
  },
  timeLimit: {
    fontSize: 16,
    marginBottom: 20,
    textAlign: 'center',
  },
  startButton: {
    padding: 18,
    borderRadius: 15,
    minWidth: Math.min(200, screenWidth * 0.5),
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 4,
    },
    shadowOpacity: 0.3,
    shadowRadius: 4.65,
    elevation: 8,
  },
  startButtonText: {
    fontSize: 18,
    fontWeight: 'bold',
    textAlign: 'center',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 20,
    paddingHorizontal: 10,
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    borderRadius: 15,
    padding: 15,
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: 0.25,
    shadowRadius: 3.84,
    elevation: 5,
  },
  headerText: {
    fontSize: 20,
    fontWeight: 'bold',
    textShadowColor: 'rgba(0, 0, 0, 0.3)',
    textShadowOffset: { width: 1, height: 1 },
    textShadowRadius: 2,
  },
  gridContainer: {
    alignItems: 'center',
    marginBottom: 30,
    paddingVertical: 15,
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    borderRadius: 20,
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 4,
    },
    shadowOpacity: 0.3,
    shadowRadius: 4.65,
    elevation: 8,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'center',
  },
  tile: {
    margin: 5,
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: 12,
    elevation: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 4.65,
    minWidth: 40,
    minHeight: 40,
  },
  tileText: {
    fontWeight: 'bold',
    textAlign: 'center',
    textShadowColor: 'rgba(0, 0, 0, 0.3)',
    textShadowOffset: { width: 1, height: 1 },
    textShadowRadius: 2,
  },
  button: {
    padding: 15,
    borderRadius: 12,
    alignSelf: 'center',
    minWidth: 150,
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 4,
    },
    shadowOpacity: 0.3,
    shadowRadius: 4.65,
    elevation: 8,
  },
  buttonText: {
    fontSize: 16,
    fontWeight: 'bold',
    textAlign: 'center',
  },
  modalContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 20,
  },
  modalContent: {
    width: '100%',
    maxWidth: 400,
    maxHeight: '90%',
    padding: 20,
    borderRadius: 20,
    elevation: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 4.65,
  },
  modalTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    textAlign: 'center',
    marginBottom: 10,
  },
  resetButton: {
    padding: 10,
    borderRadius: 8,
    marginBottom: 15,
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: 0.25,
    shadowRadius: 3.84,
    elevation: 5,
  },
  resetButtonText: {
    fontSize: 14,
    fontWeight: 'bold',
    textAlign: 'center',
  },
  pickerContainer: {
    borderRadius: 12,
    marginBottom: 20,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: 0.25,
    shadowRadius: 3.84,
    elevation: 5,
  },
  scoresContainer: {
    maxHeight: 300,
    marginBottom: 20,
  },
  scoreRow: {
    flexDirection: 'row',
    paddingVertical: 12,
    borderBottomWidth: 1,
    alignItems: 'flex-start',
  },
  scoreRank: {
    fontSize: 18,
    fontWeight: 'bold',
    marginRight: 15,
    width: 30,
  },
  scoreInfo: {
    flex: 1,
  },
  scoreName: {
    fontSize: 16,
    fontWeight: 'bold',
  },
  scoreDetails: {
    fontSize: 14,
    marginTop: 2,
  },
  scoreDate: {
    fontSize: 12,
    marginTop: 2,
  },
  noScores: {
    fontSize: 16,
    textAlign: 'center',
    padding: 20,
    fontStyle: 'italic',
  },
});

export default GridZenGame;