import { useEffect, useEffectEvent, useMemo, useRef, useState } from 'react'
import { Clipboard, Crown, LoaderCircle, Play, Plus, Settings as SettingsIcon, Users, Volume2, VolumeX } from 'lucide-react'
import * as Tone from 'tone'
import '@fontsource/creepster'
import '@fontsource/oxanium/400.css'
import '@fontsource/oxanium/500.css'
import '@fontsource/oxanium/700.css'
import './App.css'
import {
  PLAYER_CAP,
  ROUND_COUNT,
  ROUND_SECONDS,
  createRoomCode,
} from './lib/flipit'
import { api } from './lib/api'
import {
  buildFlashState,
  emptyGameState,
  normalizeGameStateForUi,
  normalizeLeaderboardForUi,
  normalizePlayersForUi,
} from './lib/gameSync'

const MUSIC_SRC = '/audio/plains-of-luminescence-loop.mp3'

const SCREENS = {
  home: 'home',
  create: 'create',
  join: 'join',
  lobby: 'lobby',
  game: 'game',
  end: 'end',
}

const DEFAULT_SETTINGS = {
  bgMusic: true,
  sfx: true,
  musicVolume: -15,
  sfxVolume: -8,
  theme: 'dark-fantasy',
}

const SCENE_IMAGES = {
  dungeon: '/backgrounds/dungeon-landing.jpg',
  forest: '/backgrounds/forest-home.jpg',
}

const DUNGEON_FLAMES = [
  { top: '60%', left: '21.2%', scale: 1.02, tilt: -8, flicker: '1.02s', delay: '0s', glow: '148px', flame: '54px' },
  { top: '73%', left: '39.1%', scale: 0.88, tilt: -3, flicker: '1.18s', delay: '0.18s', glow: '128px', flame: '42px' },
  { top: '73%', left: '60.7%', scale: 0.9, tilt: 3, flicker: '1.11s', delay: '0.34s', glow: '130px', flame: '43px' },
  { top: '57%', left: '78.5%', scale: 1.04, tilt: 8, flicker: '0.96s', delay: '0.5s', glow: '150px', flame: '56px' },
]

function randomBetween(min, max) {
  return min + Math.random() * (max - min)
}

function createBats(count = 10) {
  return Array.from({ length: count }, (_, index) => {
    const direction = index % 2 === 0 ? 1 : -1
    const duration = randomBetween(14, 26)
    return {
      id: `bat-${index}`,
      direction,
      top: randomBetween(8, 42),
      duration,
      delay: randomBetween(0, duration),
      scale: randomBetween(0.6, 1.08),
      altitude: randomBetween(-18, 24) * direction,
    }
  })
}

function createMistLayers(count = 4) {
  return Array.from({ length: count }, (_, index) => ({
    id: `mist-${index}`,
    bottom: randomBetween(4, 30),
    width: randomBetween(120, 182),
    left: randomBetween(-28, 10),
    opacity: randomBetween(0.16, 0.34),
    blur: randomBetween(18, 40),
    duration: randomBetween(28, 46),
    delay: randomBetween(0, 20),
  }))
}

function createWisps(count = 14) {
  return Array.from({ length: count }, (_, index) => ({
    id: `wisp-${index}`,
    left: randomBetween(6, 94),
    bottom: randomBetween(3, 32),
    size: randomBetween(2, 5),
    duration: randomBetween(8, 18),
    delay: randomBetween(0, 12),
    drift: randomBetween(-16, 16),
    opacity: randomBetween(0.3, 0.75),
  }))
}

function createEyePairs(count = 2) {
  return Array.from({ length: count }, (_, index) => ({
    id: `eyes-${index}`,
    left: randomBetween(index === 0 ? 18 : 62, index === 0 ? 34 : 82),
    top: randomBetween(18, 48),
    scale: randomBetween(0.75, 1.05),
    duration: randomBetween(11, 20),
    delay: randomBetween(0, 10),
  }))
}

function dbToVolume(db) {
  return Math.max(0, Math.min(1, 10 ** (db / 20)))
}

function App() {
  const [screen, setScreen] = useState(SCREENS.home)
  const [role, setRole] = useState('host')
  const [username, setUsername] = useState('MoonCipher')
  const [joinUsername, setJoinUsername] = useState('NightGuest')
  const [joinCode, setJoinCode] = useState('')
  const [roomCode, setRoomCode] = useState(createRoomCode())
  const [players, setPlayers] = useState([])
  const [settings, setSettings] = useState(DEFAULT_SETTINGS)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [toast, setToast] = useState('')
  const [leaderboardVisible, setLeaderboardVisible] = useState(false)
  const [flashState, setFlashState] = useState({ correct: [], wrong: [], removed: [] })
  const [gameState, setGameState] = useState(() => emptyGameState())
  const [leaderboardEntries, setLeaderboardEntries] = useState([])
  const [selectedCardId, setSelectedCardId] = useState(null)
  const [, setIsBusy] = useState(false)
  const [currentPlayerName, setCurrentPlayerName] = useState('MoonCipher')

  const playersRef = useRef(players)
  const gameRef = useRef(gameState)
  const settingsRef = useRef(settings)
  const timerRef = useRef(null)
  const countdownRef = useRef(null)
  const toastRef = useRef(null)
  const musicRef = useRef(null)
  const selectedCardRef = useRef(selectedCardId)
  const currentPlayerNameRef = useRef(currentPlayerName)
  const revealOnceRef = useRef(new Set())
  const endGameOnceRef = useRef(new Set())
  const audioRef = useRef({
    ready: false,
  })

  useEffect(() => {
    playersRef.current = players
  }, [players])

  useEffect(() => {
    gameRef.current = gameState
  }, [gameState])

  useEffect(() => {
    selectedCardRef.current = selectedCardId
  }, [selectedCardId])

  useEffect(() => {
    currentPlayerNameRef.current = currentPlayerName
  }, [currentPlayerName])

  useEffect(() => {
    settingsRef.current = settings
  }, [settings])

  const disposeAudio = useEffectEvent(() => {
    if (musicRef.current) {
      musicRef.current.pause()
      musicRef.current.src = ''
      musicRef.current = null
    }

    if (!audioRef.current.ready) return
    audioRef.current.tick.dispose()
    audioRef.current.flip.dispose()
    audioRef.current.correct.dispose()
    audioRef.current.wrong.dispose()
    audioRef.current.reveal.dispose()
    audioRef.current.remove.dispose()
    audioRef.current.cheer.dispose()
    audioRef.current.sfxBus.dispose()
    audioRef.current = { ready: false }
  })

  useEffect(() => {
    return () => {
      window.clearInterval(timerRef.current)
      window.clearInterval(countdownRef.current)
      window.clearTimeout(toastRef.current)
      disposeAudio()
    }
  }, [])

  useEffect(() => {
    if (musicRef.current) {
      musicRef.current.volume = dbToVolume(settings.musicVolume)
      if (settings.bgMusic) {
        void musicRef.current.play().catch(() => {})
      } else {
        musicRef.current.pause()
      }
    }

    if (audioRef.current.ready) {
      audioRef.current.sfxBus.volume.value = settings.sfxVolume
    }
  }, [settings.bgMusic, settings.musicVolume, settings.sfxVolume])

  const activePlayers = useMemo(() => players.filter((player) => !player.removed), [players])
  const leaderboard = useMemo(() => leaderboardEntries, [leaderboardEntries])
  const isHost = role === 'host'
  const canStartGame = activePlayers.length >= 2
  const sceneVariant = screen === SCREENS.home ? 'dungeon' : 'forest'

  function updatePlayers(updater) {
    setPlayers((current) => {
      const next = typeof updater === 'function' ? updater(current) : updater
      playersRef.current = next
      return next
    })
  }

  async function ensureAudio() {
    if (!musicRef.current) {
      musicRef.current = new Audio(MUSIC_SRC)
      musicRef.current.loop = true
      musicRef.current.volume = dbToVolume(settingsRef.current.musicVolume)
    }

    if (settingsRef.current.bgMusic) {
      void musicRef.current.play().catch(() => {})
    }

    if (audioRef.current.ready) {
      if (Tone.getContext().state !== 'running') {
        await Tone.start()
      }
      return
    }

    await Tone.start()
    const sfxBus = new Tone.Volume(settingsRef.current.sfxVolume).toDestination()
    const tick = new Tone.Synth({
      oscillator: { type: 'square' },
      envelope: { attack: 0.001, decay: 0.03, sustain: 0, release: 0.05 },
    }).connect(sfxBus)
    const flip = new Tone.NoiseSynth({
      noise: { type: 'pink' },
      envelope: { attack: 0.001, decay: 0.16, sustain: 0, release: 0.05 },
    }).connect(sfxBus)
    const correct = new Tone.PolySynth(Tone.Synth, {
      oscillator: { type: 'triangle' },
      envelope: { attack: 0.01, decay: 0.1, sustain: 0.22, release: 0.4 },
    }).connect(sfxBus)
    const wrong = new Tone.FMSynth({
      harmonicity: 0.6,
      modulationIndex: 8,
      envelope: { attack: 0.001, decay: 0.18, sustain: 0, release: 0.15 },
    }).connect(sfxBus)
    const reveal = new Tone.MetalSynth({
      frequency: 180,
      envelope: { attack: 0.001, decay: 0.3, release: 0.1 },
      harmonicity: 5.1,
      modulationIndex: 24,
    }).connect(sfxBus)
    const remove = new Tone.MembraneSynth({
      pitchDecay: 0.04,
      octaves: 6,
      envelope: { attack: 0.001, decay: 0.45, sustain: 0, release: 0.2 },
    }).connect(sfxBus)
    const cheer = new Tone.PolySynth(Tone.Synth, {
      oscillator: { type: 'sawtooth' },
      envelope: { attack: 0.01, decay: 0.16, sustain: 0.22, release: 0.45 },
    }).connect(sfxBus)

    audioRef.current = {
      ready: true,
      sfxBus,
      tick,
      flip,
      correct,
      wrong,
      reveal,
      remove,
      cheer,
    }
  }

  function playTick() {
    if (!settingsRef.current.sfx || !audioRef.current.ready) return
    try {
      audioRef.current.tick.triggerAttackRelease('E5', '32n')
    } catch {
      // Audio can be unavailable on some browser gesture policies; gameplay should continue.
    }
  }

  function playFlip() {
    if (!settingsRef.current.sfx || !audioRef.current.ready) return
    audioRef.current.flip.triggerAttackRelease('16n')
  }

  function playCorrect() {
    if (!settingsRef.current.sfx || !audioRef.current.ready) return
    audioRef.current.correct.triggerAttackRelease(['C5', 'E5', 'G5'], '8n')
  }

  function playWrong() {
    if (!settingsRef.current.sfx || !audioRef.current.ready) return
    audioRef.current.wrong.triggerAttackRelease('A2', '8n')
  }

  function playReveal() {
    if (!settingsRef.current.sfx || !audioRef.current.ready) return
    audioRef.current.reveal.triggerAttackRelease('16n')
  }

  function playRemoval() {
    if (!settingsRef.current.sfx || !audioRef.current.ready) return
    audioRef.current.remove.triggerAttackRelease('C2', '8n')
  }

  function playCheer() {
    if (!settingsRef.current.sfx || !audioRef.current.ready) return
    audioRef.current.cheer.triggerAttackRelease(['C5', 'E5', 'G5', 'C6'], '4n')
  }

  function showToast(message) {
    setToast(message)
    window.clearTimeout(toastRef.current)
    toastRef.current = window.setTimeout(() => setToast(''), 2800)
  }

  function copyRoomCode(code = roomCode) {
    navigator.clipboard
      .writeText(code)
      .then(() => showToast(`Room code ${code} copied.`))
      .catch(() => showToast(`Copy failed for ${code}.`))
  }

  function resetLocalSessionState() {
    setPlayers([])
    setLeaderboardEntries([])
    setGameState(emptyGameState())
    setSelectedCardId(null)
    setLeaderboardVisible(false)
    setFlashState({ correct: [], wrong: [], removed: [] })
    revealOnceRef.current = new Set()
    endGameOnceRef.current = new Set()
  }

  function applySnapshot(snapshot, options = {}) {
    const nextPlayers = normalizePlayersForUi(snapshot.roomState, snapshot.leaderboard, currentPlayerNameRef.current)
    const nextLeaderboard = normalizeLeaderboardForUi(snapshot.leaderboard)
    const shouldPreserveSelection =
      snapshot.roundInfo.phase === 'playing' && snapshot.roundInfo.roundNumber === gameRef.current.roundIndex + 1
    const nextSelectedCardId = shouldPreserveSelection ? selectedCardRef.current : null
    const nextGameState = normalizeGameStateForUi(snapshot.roundInfo, nextSelectedCardId)
    const nextFlashState = buildFlashState(snapshot)

    updatePlayers(nextPlayers)
    setLeaderboardEntries(nextLeaderboard)
    setGameState(nextGameState)
    setSelectedCardId(nextSelectedCardId)
    setFlashState(nextFlashState)
    setLeaderboardVisible(snapshot.roundInfo.phase === 'leaderboard')

    const currentPlayer = nextPlayers.find((player) => player.isCurrentUser)
    const phaseKey = `${snapshot.roomState.roomCode}-${snapshot.roundInfo.roundNumber}-${snapshot.roundInfo.phase}`

    if ((snapshot.roundInfo.phase === 'leaderboard' || snapshot.roomState.status === 'finished') && !revealOnceRef.current.has(phaseKey)) {
      revealOnceRef.current.add(phaseKey)
      playFlip()
      playReveal()

      if (currentPlayer && nextFlashState.correct.includes(currentPlayer.id)) {
        playCorrect()
      } else if (currentPlayer && nextFlashState.wrong.includes(currentPlayer.id)) {
        playWrong()
      }

      const removedPlayer = nextPlayers.find((player) => nextFlashState.removed.includes(player.id))
      if (removedPlayer) {
        playRemoval()
        showToast(`${removedPlayer.name} has been removed by FlipIt AI`)
      }
    }

    if (snapshot.roomState.status === 'finished') {
      const endKey = `${snapshot.roomState.roomCode}-${snapshot.roundInfo.roundNumber}-finished`
      if (!endGameOnceRef.current.has(endKey)) {
        endGameOnceRef.current.add(endKey)
        playCheer()
      }
      setLeaderboardVisible(false)
      setScreen(SCREENS.end)
      return
    }

    if (options.preserveScreen !== true) {
      if (snapshot.roomState.status === 'active') {
        setScreen(SCREENS.game)
      } else if (screen !== SCREENS.create && screen !== SCREENS.join && screen !== SCREENS.home) {
        setScreen(SCREENS.lobby)
      }
    }
  }

  const applySnapshotFromEffect = useEffectEvent((snapshot, options = {}) => {
    applySnapshot(snapshot, options)
  })

  const syncRoomSnapshot = useEffectEvent(async (activeRoomCode, options = {}) => {
    if (!activeRoomCode) return

    const [roomState, roundInfo, leaderboardPayload] = await Promise.all([
      api.getRoomState(activeRoomCode),
      api.getRoundInfo(activeRoomCode),
      api.getLeaderboard(activeRoomCode),
    ])

    applySnapshotFromEffect(
      {
        roomState,
        roundInfo,
        leaderboard: leaderboardPayload,
      },
      options,
    )
  })

  useEffect(() => {
    if (!roomCode || ![SCREENS.lobby, SCREENS.game, SCREENS.end].includes(screen)) {
      window.clearInterval(timerRef.current)
      return undefined
    }

    window.setTimeout(() => {
      void syncRoomSnapshot(roomCode)
    }, 0)

    timerRef.current = window.setInterval(() => {
      void syncRoomSnapshot(roomCode)
    }, 2000)

    return () => window.clearInterval(timerRef.current)
  }, [roomCode, screen])

  useEffect(() => {
    if (screen !== SCREENS.game || gameState.phase !== 'playing' || !gameState.startedAt) {
      window.clearInterval(countdownRef.current)
      return undefined
    }

    const syncCountdown = () => {
      setGameState((current) => {
        if (current.phase !== 'playing' || !current.startedAt) {
          return current
        }

        const nextTimeLeft = Math.max(
          0,
          Math.min(ROUND_SECONDS, Math.ceil((current.startedAt + ROUND_SECONDS * 1000 - Date.now()) / 1000)),
        )

        return current.timeLeft === nextTimeLeft ? current : { ...current, timeLeft: nextTimeLeft }
      })
    }

    window.setTimeout(syncCountdown, 0)
    countdownRef.current = window.setInterval(syncCountdown, 1000)

    return () => window.clearInterval(countdownRef.current)
  }, [screen, gameState.phase, gameState.startedAt])

  useEffect(() => {
    if (screen !== SCREENS.game || gameState.phase !== 'playing') {
      return undefined
    }

    if (gameState.timeLeft <= 5 && gameState.timeLeft > 0) {
      playTick()
    }

    if (gameState.timeLeft === 0 && isHost) {
      const revealKey = `${roomCode}-${gameState.roundIndex + 1}-reveal`
      if (!revealOnceRef.current.has(revealKey)) {
        revealOnceRef.current.add(revealKey)
        void (async () => {
          try {
            let snapshot = await api.revealRound({ roomCode })

            if (
              snapshot.roomState.status !== 'finished' &&
              snapshot.roundInfo.phase === 'leaderboard' &&
              snapshot.roundInfo.roundNumber >= ROUND_COUNT
            ) {
              snapshot = await api.endGame({ roomCode })
            }

            applySnapshotFromEffect(snapshot)
            if (snapshot.roomState.status !== 'finished') {
              window.setTimeout(() => {
                void syncRoomSnapshot(roomCode)
              }, 5000)
            }
          } catch (error) {
            showToast(error.message || 'Unable to reveal this round.')
          }
        })()
      }
    }

    return undefined
  }, [screen, gameState.timeLeft, gameState.phase, isHost, roomCode, gameState.roundIndex])

  async function startGame() {
    try {
      setIsBusy(true)
      await ensureAudio()
      const snapshot = await api.startGame({ roomCode })
      setSelectedCardId(null)
      applySnapshot(snapshot)
      setScreen(SCREENS.game)
    } catch (error) {
      showToast(error.message || 'Unable to start game.')
    } finally {
      setIsBusy(false)
    }
  }

  function handleCreateFlow() {
    void ensureAudio()
    setRole('host')
    setRoomCode(createRoomCode())
    setScreen(SCREENS.create)
  }

  function handleJoinFlow() {
    void ensureAudio()
    setScreen(SCREENS.join)
  }

  async function createLobby() {
    const nextUsername = username.trim() || 'MoonCipher'
    const nextRoomCode = roomCode.toUpperCase()

    try {
      setIsBusy(true)
      setCurrentPlayerName(nextUsername)
      const snapshot = await api.createRoom({
        roomCode: nextRoomCode,
        hostUsername: nextUsername,
      })
      setRole('host')
      setRoomCode(nextRoomCode)
      applySnapshot(snapshot, { preserveScreen: true })
      setScreen(SCREENS.lobby)
      showToast('Lobby forged. Share the room code.')
    } catch (error) {
      showToast(error.message || 'Unable to create room.')
    } finally {
      setIsBusy(false)
    }
  }

  async function joinLobby() {
    const nextUsername = joinUsername.trim() || 'NightGuest'
    const nextRoomCode = (joinCode || createRoomCode()).toUpperCase()

    try {
      setIsBusy(true)
      setCurrentPlayerName(nextUsername)
      const snapshot = await api.joinRoom({
        roomCode: nextRoomCode,
        username: nextUsername,
      })
      setRole('guest')
      setRoomCode(nextRoomCode)
      applySnapshot(snapshot, { preserveScreen: true })
      setScreen(SCREENS.lobby)
      showToast('Joined room. Waiting for the host...')
    } catch (error) {
      showToast(error.message || 'Unable to join room.')
    } finally {
      setIsBusy(false)
    }
  }

  async function leaveRoom() {
    try {
      setIsBusy(true)
      if (roomCode) {
        await api.leaveRoom({
          roomCode,
          username: currentPlayerNameRef.current,
        })
      }
    } catch {
      // Local cleanup still proceeds.
    } finally {
      window.clearInterval(timerRef.current)
      resetLocalSessionState()
      setRole('host')
      setRoomCode(createRoomCode())
      setJoinCode('')
      setSettingsOpen(false)
      setCurrentPlayerName(username.trim() || 'MoonCipher')
      setScreen(SCREENS.home)
      setIsBusy(false)
      showToast('You left the chamber.')
    }
  }

  async function playAgain() {
    try {
      setIsBusy(true)
      const snapshot = await api.playAgain({ roomCode })
      setSelectedCardId(null)
      applySnapshot(snapshot, { preserveScreen: true })
      setScreen(SCREENS.lobby)
      showToast('Same room. Fresh round order.')
    } catch (error) {
      showToast(error.message || 'Unable to restart this room.')
    } finally {
      setIsBusy(false)
    }
  }

  async function handleCardGuess(card) {
    if (screen !== SCREENS.game || gameRef.current.phase !== 'playing') return
    try {
      await ensureAudio()
      setSelectedCardId(card.id)
      setGameState((current) => ({
        ...current,
        selectedCardId: card.id,
      }))
      await api.submitGuess({
        roomCode,
        username: currentPlayerNameRef.current,
        selectedCardId: card.id,
        guessedShape: card.shape.key,
        guessTimestamp: Date.now(),
      })
    } catch (error) {
      showToast(error.message || 'Unable to submit guess.')
    }
  }

  function toggleMusic() {
    setSettings((current) => ({
      ...current,
      bgMusic: !current.bgMusic,
    }))
  }

  function toggleSfx() {
    setSettings((current) => ({
      ...current,
      sfx: !current.sfx,
    }))
  }

  function updateTheme(theme) {
    setSettings((current) => ({
      ...current,
      theme,
    }))
  }

  return (
    <div className={`app-shell theme-${settings.theme} scene-${sceneVariant}`}>
      <AtmosphereBackdrop variant={sceneVariant} />
      <button className="floating-settings" onClick={() => setSettingsOpen(true)} aria-label="Open settings">
        <SettingsIcon size={18} />
      </button>

      {toast ? <div className="toast-banner">{toast}</div> : null}

      <header className="frame-top">
        <div className="brand-stack">
          <span className="brand-kicker">Multiplayer guessing ritual</span>
          <span className="brand-name">FLIPIT</span>
        </div>
        <div className="audio-pill">
          {settings.bgMusic ? <Volume2 size={16} /> : <VolumeX size={16} />}
          <span>{settings.bgMusic ? 'Lo-fi chiptune live' : 'Audio muted'}</span>
        </div>
      </header>

      {screen === SCREENS.home ? (
        <LandingScreen onCreate={handleCreateFlow} onJoin={handleJoinFlow} />
      ) : null}

      {screen === SCREENS.create ? (
        <CreateRoomScreen
          username={username}
          onUsernameChange={setUsername}
          roomCode={roomCode}
          onCopy={() => copyRoomCode(roomCode)}
          onContinue={createLobby}
          onBack={() => setScreen(SCREENS.home)}
        />
      ) : null}

      {screen === SCREENS.join ? (
        <JoinRoomScreen
          username={joinUsername}
          roomCode={joinCode}
          onUsernameChange={setJoinUsername}
          onRoomCodeChange={setJoinCode}
          onJoin={joinLobby}
          onBack={() => setScreen(SCREENS.home)}
        />
      ) : null}

      {screen === SCREENS.lobby ? (
        <LobbyScreen
          roomCode={roomCode}
          players={players}
          role={role}
          canStart={canStartGame}
          onStart={startGame}
          onCopy={() => copyRoomCode(roomCode)}
        />
      ) : null}

      {screen === SCREENS.game ? (
        <GameScreen
          gameState={gameState}
          players={players}
          leaderboard={leaderboard}
          leaderboardVisible={leaderboardVisible}
          flashState={flashState}
          onCardGuess={handleCardGuess}
          onOpenSettings={() => setSettingsOpen(true)}
        />
      ) : null}

      {screen === SCREENS.end ? (
        <EndGameScreen leaderboard={leaderboard} onPlayAgain={playAgain} onLeave={leaveRoom} />
      ) : null}

      {settingsOpen ? (
        <SettingsPanel
          settings={settings}
          onClose={() => setSettingsOpen(false)}
          onToggleMusic={toggleMusic}
          onToggleSfx={toggleSfx}
          onThemeChange={updateTheme}
          onMusicVolume={(value) =>
            setSettings((current) => ({
              ...current,
              musicVolume: value,
            }))
          }
          onSfxVolume={(value) =>
            setSettings((current) => ({
              ...current,
              sfxVolume: value,
            }))
          }
        />
      ) : null}
    </div>
  )
}

function LandingScreen({ onCreate, onJoin }) {
  return (
    <main className="screen home-screen">
      <div className="screen-card hero-card">
        <div className="hero-fog hero-fog-left" />
        <div className="hero-fog hero-fog-right" />
        <div className="hero-copy">
          <span className="eyebrow">Dark fantasy meets party game chaos</span>
          <h1>FLIPIT</h1>
          <p>Guess the card. Trust nothing.</p>
          <div className="home-actions">
            <button className="primary-button" onClick={onCreate}>
              <Plus size={18} />
              <span>Create Room</span>
            </button>
            <button className="secondary-button" onClick={onJoin}>
              <Users size={18} />
              <span>Join Room</span>
            </button>
          </div>
        </div>
      </div>
    </main>
  )
}

function CreateRoomScreen({ username, onUsernameChange, roomCode, onCopy, onContinue, onBack }) {
  return (
    <main className="screen form-screen">
      <div className="screen-card panel-card">
        <div className="panel-heading">
          <span className="eyebrow">Create Room</span>
          <h2>Summon your table</h2>
        </div>
        <label className="field">
          <span>Enter your username</span>
          <input value={username} onChange={(event) => onUsernameChange(event.target.value)} placeholder="MoonCipher" />
        </label>
        <div className="code-box">
          <span>Room Code</span>
          <strong>{roomCode}</strong>
        </div>
        <div className="inline-actions">
          <button className="ghost-button" onClick={onCopy}>
            <Clipboard size={16} />
            <span>Copy Code</span>
          </button>
          <button className="secondary-button" onClick={onBack}>
            Back
          </button>
        </div>
        <button className="primary-button wide-button" onClick={onContinue}>
          Create Lobby
        </button>
      </div>
    </main>
  )
}

function JoinRoomScreen({ username, roomCode, onUsernameChange, onRoomCodeChange, onJoin, onBack }) {
  return (
    <main className="screen form-screen">
      <div className="screen-card panel-card">
        <div className="panel-heading">
          <span className="eyebrow">Join Room</span>
          <h2>Step into the chamber</h2>
        </div>
        <label className="field">
          <span>Enter your username</span>
          <input value={username} onChange={(event) => onUsernameChange(event.target.value)} placeholder="NightGuest" />
        </label>
        <label className="field">
          <span>Enter room code</span>
          <input value={roomCode} onChange={(event) => onRoomCodeChange(event.target.value.toUpperCase())} placeholder="ABC123" />
        </label>
        <div className="inline-actions">
          <button className="secondary-button" onClick={onBack}>
            Back
          </button>
          <button className="primary-button" onClick={onJoin}>
            Join Game
          </button>
        </div>
      </div>
    </main>
  )
}

function LobbyScreen({ roomCode, players, role, canStart, onStart, onCopy }) {
  const isHost = role === 'host'

  return (
    <main className="screen lobby-screen">
      <div className="screen-card panel-card wide-card">
        <div className="lobby-header">
          <div>
            <span className="eyebrow">Waiting Lobby</span>
            <h2>{roomCode}</h2>
          </div>
          <div className="count-pill">
            <Users size={16} />
            <span>
              {players.length} / {PLAYER_CAP} players joined
            </span>
          </div>
        </div>

        <div className="code-row">
          <button className="ghost-button" onClick={onCopy}>
            <Clipboard size={16} />
            <span>Copy Code</span>
          </button>
          {!isHost ? (
            <div className="waiting-indicator">
              <LoaderCircle size={16} />
              <span>Waiting for host to start...</span>
            </div>
          ) : null}
        </div>

        <div className="player-grid">
          {players.map((player) => (
            <div key={player.id} className="player-tile">
              <div className="player-main">
                <strong>{player.name}</strong>
                <span>{player.isBot ? 'Bot' : player.isHost ? 'Host' : 'Player'}</span>
              </div>
              <span className="player-badge">{player.isHost ? 'Host' : player.isBot ? 'Mock' : 'Live'}</span>
            </div>
          ))}
        </div>

        {isHost ? (
          <button className="primary-button wide-button" disabled={!canStart} onClick={onStart}>
            <Play size={18} />
            <span>Start Game</span>
          </button>
        ) : null}
      </div>
    </main>
  )
}

function GameScreen({ gameState, players, leaderboard, leaderboardVisible, flashState, onCardGuess, onOpenSettings }) {
  return (
    <main className="screen game-screen">
      <div className="game-layout">
        <section className="game-main">
          <div className="top-bar">
            <div className="bar-chip">Round {gameState.roundIndex + 1} / {ROUND_COUNT}</div>
            <div className="bar-chip">{players.filter((player) => !player.removed).length} players</div>
            <button className="icon-button" onClick={onOpenSettings} aria-label="Open settings">
              <SettingsIcon size={18} />
            </button>
          </div>

          <div className="objective-card">
            <span className="objective-caption">Guess the correct card:</span>
            <strong style={{ color: gameState.targetShape.glow }}>
              {gameState.targetShape.symbol} {gameState.targetShape.label}
            </strong>
          </div>

          <div className={`timer-dial ${gameState.timeLeft <= 10 ? 'danger' : ''}`}>
            <span>{gameState.timeLeft}</span>
          </div>

          <div className="cards-row">
            {gameState.deck.map((card, index) => (
              <FlipCard
                key={`${gameState.roundIndex}-${card.id}`}
                card={card}
                index={index}
                revealed={gameState.revealed}
                selected={gameState.selectedCardId === card.id}
                disabled={gameState.phase !== 'playing'}
                onPick={() => onCardGuess(card)}
              />
            ))}
          </div>

          <div className="guess-panel">
            <span className="guess-caption">
              {gameState.selectedCardId ? 'Card locked. Change it before the timer ends.' : 'Pick one covered mascot card.'}
            </span>
          </div>
        </section>

        <aside className={`leaderboard-panel ${leaderboardVisible ? 'visible' : ''}`}>
          <div className="leaderboard-header">
            <h3>Leaderboard</h3>
            <div className="leaderboard-columns" aria-hidden="true">
              <span>Rank</span>
              <span>Username</span>
              <span>Points</span>
              <span>Status</span>
            </div>
          </div>

          <div className="leaderboard-body">
            {leaderboard.map((player) => (
              <div
                key={player.id}
                className={`leader-row${player.removed ? ' removed' : ''}${flashState.correct.includes(player.id) ? ' flash-correct' : ''}${
                  flashState.wrong.includes(player.id) ? ' flash-wrong' : ''
                }`}
              >
                <span className="leader-rank">{player.rank}</span>
                <strong className="leader-name">{player.name}</strong>
                <span className="leader-points">{player.points}</span>
                <span className="leader-status">{player.status}</span>
              </div>
            ))}
          </div>
        </aside>
      </div>
    </main>
  )
}

function FlipCard({ card, index, revealed, selected, disabled, onPick }) {
  return (
    <button
      className={`flip-card${revealed ? ' revealed' : ''}${card.isCorrect ? ' correct' : ''}${selected ? ' selected' : ''}`}
      style={{ animationDelay: `${index * 120}ms` }}
      onClick={onPick}
      disabled={disabled}
      aria-label={revealed ? `${card.shape.label} card` : `Pick covered card ${index + 1}`}
    >
      <div className="flip-inner">
        <div className="card-face card-back">
          <div className="card-back-shell">
            <span className="card-back-title">Flipit</span>
            <div className="card-back-crest">
              <img src={card.mascot} alt="Cat mascot card back" />
            </div>
            <div className="card-back-runes" aria-hidden="true">
              <span />
              <span />
            </div>
          </div>
        </div>
        <div className="card-face card-front">
          <div className="card-front-shell">
            <span className="card-front-label">Reveal</span>
            <div className="front-sigil" style={{ color: card.shape.glow }}>
              {card.shape.symbol}
            </div>
            <span className="front-name">{card.shape.label}</span>
          </div>
          {card.isCorrect ? <div className="burst-ring" /> : null}
        </div>
      </div>
    </button>
  )
}

function SettingsPanel({
  settings,
  onClose,
  onToggleMusic,
  onToggleSfx,
  onThemeChange,
  onMusicVolume,
  onSfxVolume,
}) {
  return (
    <aside className="settings-panel">
      <div className="settings-header">
        <div>
          <span className="eyebrow">Settings</span>
          <h3>Control the ritual</h3>
        </div>
        <button className="ghost-button" onClick={onClose}>
          Close
        </button>
      </div>

      <div className="settings-group">
        <button className="toggle-button" onClick={onToggleMusic}>
          <span>Background Music</span>
          <strong>{settings.bgMusic ? 'On' : 'Off'}</strong>
        </button>
        <label className="slider-row">
          <span>Music Volume</span>
          <input
            type="range"
            min="-30"
            max="-6"
            value={settings.musicVolume}
            onChange={(event) => onMusicVolume(Number(event.target.value))}
          />
        </label>
      </div>

      <div className="settings-group">
        <button className="toggle-button" onClick={onToggleSfx}>
          <span>Sound Effects</span>
          <strong>{settings.sfx ? 'On' : 'Off'}</strong>
        </button>
        <label className="slider-row">
          <span>SFX Volume</span>
          <input
            type="range"
            min="-24"
            max="0"
            value={settings.sfxVolume}
            onChange={(event) => onSfxVolume(Number(event.target.value))}
          />
        </label>
      </div>

      <div className="settings-group">
        <span className="theme-label">Theme</span>
        <div className="theme-grid">
          {['dark-fantasy', 'neon', 'classic'].map((theme) => (
            <button
              key={theme}
              className={`theme-button${settings.theme === theme ? ' active' : ''}`}
              onClick={() => onThemeChange(theme)}
            >
              {theme === 'dark-fantasy' ? 'Dark Fantasy' : theme === 'neon' ? 'Neon' : 'Classic'}
            </button>
          ))}
        </div>
      </div>
    </aside>
  )
}

function EndGameScreen({ leaderboard, onPlayAgain, onLeave }) {
  return (
    <main className="screen end-screen">
      <div className="screen-card panel-card wide-card victory-card">
        <div className="confetti-field" aria-hidden="true">
          {Array.from({ length: 18 }).map((_, index) => (
            <span key={index} className="confetti-bit" />
          ))}
        </div>
        <div className="panel-heading">
          <span className="eyebrow">After Round 10</span>
          <h2>Final Leaderboard</h2>
        </div>

        <div className="podium-grid">
          {leaderboard.slice(0, 3).map((player, index) => (
            <div key={player.id} className={`podium-card place-${index + 1}`}>
              <Crown size={18} />
              <strong>{player.name}</strong>
              <span>{player.points} pts</span>
            </div>
          ))}
        </div>

        <div className="final-board">
          {leaderboard.map((player) => (
            <div key={player.id} className={`final-row${player.removed ? ' removed' : ''}`}>
              <span>#{player.rank}</span>
              <strong>{player.name}</strong>
              <span>{player.points}</span>
              <span>{player.status}</span>
            </div>
          ))}
        </div>

        <div className="inline-actions">
          <button className="primary-button" onClick={onPlayAgain}>
            Play Again
          </button>
          <button className="secondary-button" onClick={onLeave}>
            Leave Room
          </button>
        </div>
      </div>
    </main>
  )
}

function AtmosphereBackdrop({ variant }) {
  return (
    <div className={`scene-backdrop scene-backdrop-${variant}`} aria-hidden="true">
      <div className="scene-image" style={{ backgroundImage: `url(${SCENE_IMAGES[variant]})` }} />
      <div className="scene-overlay scene-overlay-base" />
      {variant === 'dungeon' ? <DungeonEffects /> : <ForestEffects />}
    </div>
  )
}

function DungeonEffects() {
  return (
    <>
      <div className="scene-overlay scene-overlay-dungeon" />
      <div className="torch-field">
        {DUNGEON_FLAMES.map((flame, index) => (
          <TorchFlame key={`torch-${index}`} flame={flame} />
        ))}
      </div>
      <div className="ash-field">
        {Array.from({ length: 18 }).map((_, index) => (
          <span key={`ash-${index}`} className={`ash ash-${index % 4}`} />
        ))}
      </div>
    </>
  )
}

function TorchFlame({ flame }) {
  return (
    <div
      className="torch-anchor"
      style={{
        top: flame.top,
        left: flame.left,
        '--torch-scale': flame.scale,
        '--torch-tilt': `${flame.tilt}deg`,
        '--torch-delay': flame.delay,
        '--flame-duration': flame.flicker,
        '--glow-size': flame.glow,
        '--flame-height': flame.flame,
      }}
    >
      <span className="torch-glow" />
      <span className="torch-ember ember-a" />
      <span className="torch-ember ember-b" />
      <span className="torch-flame flame-core" />
      <span className="torch-flame flame-mid" />
      <span className="torch-flame flame-tip" />
    </div>
  )
}

function ForestEffects() {
  const bats = useMemo(() => createBats(11), [])
  const mists = useMemo(() => createMistLayers(4), [])
  const wisps = useMemo(() => createWisps(15), [])
  const eyes = useMemo(() => createEyePairs(2), [])

  return (
    <>
      <div className="scene-overlay scene-overlay-forest" />
      <div className="bat-field">
        {bats.map((bat) => (
          <Bat key={bat.id} bat={bat} />
        ))}
      </div>
      <div className="mist-field">
        {mists.map((mist) => (
          <span
            key={mist.id}
            className="mist-layer"
            style={{
              bottom: `${mist.bottom}%`,
              left: `${mist.left}%`,
              width: `${mist.width}%`,
              opacity: mist.opacity,
              filter: `blur(${mist.blur}px)`,
              animationDuration: `${mist.duration}s`,
              animationDelay: `-${mist.delay}s`,
            }}
          />
        ))}
      </div>
      <div className="wisp-field">
        {wisps.map((wisp) => (
          <span
            key={wisp.id}
            className="wisp"
            style={{
              left: `${wisp.left}%`,
              bottom: `${wisp.bottom}%`,
              width: `${wisp.size}px`,
              height: `${wisp.size}px`,
              '--wisp-drift': `${wisp.drift}px`,
              '--wisp-opacity': wisp.opacity,
              animationDuration: `${wisp.duration}s`,
              animationDelay: `-${wisp.delay}s`,
            }}
          />
        ))}
      </div>
      <div className="eyes-field">
        {eyes.map((eye) => (
          <span
            key={eye.id}
            className="eye-pair"
            style={{
              left: `${eye.left}%`,
              top: `${eye.top}%`,
              '--eye-scale': eye.scale,
              animationDuration: `${eye.duration}s`,
              animationDelay: `-${eye.delay}s`,
            }}
          >
            <span />
            <span />
          </span>
        ))}
      </div>
    </>
  )
}

function Bat({ bat }) {
  return (
    <span
      className={`bat bat-${bat.direction > 0 ? 'east' : 'west'}`}
      style={{
        top: `${bat.top}%`,
        '--bat-scale': bat.scale,
        '--bat-altitude': `${bat.altitude}px`,
        animationDuration: `${bat.duration}s`,
        animationDelay: `-${bat.delay}s`,
      }}
    >
      <span className="bat-wing bat-wing-left" />
      <span className="bat-body" />
      <span className="bat-wing bat-wing-right" />
    </span>
  )
}

export default App
