import { useEffect, useRef, useState, useCallback } from 'react'
import './TankBattle.css'

// ─── Game constants ────────────────────────────────────────────────
const TILE = 32
const GRID = 16
const SIZE = TILE * GRID // 512

const PLAYER_SPEED = 2
const ENEMY_SPEED = 1.3
const BULLET_SPEED = 5
const BULLET_SIZE = 6

const PLAYER_FIRE_CD = 320
const ENEMY_FIRE_CD = 900
const ENEMY_SPAWN_CD = 1800
const MAX_ENEMIES_ON_SCREEN = 4
const LEVEL_ENEMY_POOL = 20

// tile types
const T_EMPTY = 0
const T_BRICK = 1
const T_STEEL = 2
const T_BASE = 3

// directions
const DIR_UP = 0
const DIR_RIGHT = 1
const DIR_DOWN = 2
const DIR_LEFT = 3
const DIR_DXY = [
  [0, -1],
  [1, 0],
  [0, 1],
  [-1, 0],
]

// ─── Level maps (16×16) ────────────────────────────────────────────
// . empty · B brick · S steel · # base
const LEVELS = [
  [
    '................',
    '................',
    '..BB..BBBB..BB..',
    '..BB..BBBB..BB..',
    '................',
    '....SS....SS....',
    '..BB........BB..',
    '..BB..BBBB..BB..',
    '......BBBB......',
    '..BB........BB..',
    '..BB........BB..',
    '....SS....SS....',
    '................',
    '.....B....B.....',
    '.....B.##.B.....',
    '.....BBBBBB.....',
  ],
  [
    '................',
    '.BBBBB....BBBBB.',
    '.B............B.',
    '.B....SSSS....B.',
    '......S..S......',
    '..BB..S..S..BB..',
    '..BB........BB..',
    '....BB....BB....',
    '....BB....BB....',
    '..BB........BB..',
    '..BB..S..S..BB..',
    '......S..S......',
    '......SSSS......',
    '.............BB.',
    '..BBBB..##...BB.',
    '..BBBB..BB......',
  ],
  [
    '................',
    '..S..........S..',
    '..S..BBBBBB..S..',
    '..S..B....B..S..',
    '.....B....B.....',
    'BB...B....B...BB',
    'BB...B....B...BB',
    '.....B....B.....',
    '.....B....B.....',
    'BB...B....B...BB',
    'BB...B....B...BB',
    '.....B....B.....',
    '..S..B....B..S..',
    '..S..BBBBBB..S..',
    '..S...B##B...S..',
    '......BBBB......',
  ],
]

// ─── Helpers ───────────────────────────────────────────────────────
const parseMap = (rows) => {
  const map = []
  for (let r = 0; r < GRID; r++) {
    const row = []
    for (let c = 0; c < GRID; c++) {
      const ch = rows[r][c]
      row.push(
        ch === 'B' ? T_BRICK : ch === 'S' ? T_STEEL : ch === '#' ? T_BASE : T_EMPTY,
      )
    }
    map.push(row)
  }
  return map
}

const rectHit = (a, b) =>
  a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y

const tileAt = (map, px, py) => {
  const c = Math.floor(px / TILE)
  const r = Math.floor(py / TILE)
  if (r < 0 || r >= GRID || c < 0 || c >= GRID) return T_STEEL
  return map[r][c]
}
const isBlocking = (t) => t === T_BRICK || t === T_STEEL || t === T_BASE

const tankBlockedByMap = (map, x, y) => {
  if (x < 0 || y < 0 || x + TILE > SIZE || y + TILE > SIZE) return true
  const pts = [
    [x + 1, y + 1],
    [x + TILE - 2, y + 1],
    [x + 1, y + TILE - 2],
    [x + TILE - 2, y + TILE - 2],
  ]
  return pts.some(([px, py]) => isBlocking(tileAt(map, px, py)))
}

const loadHighScore = () => {
  try {
    return parseInt(localStorage.getItem('tank-battle-highscore'), 10) || 0
  } catch {
    return 0
  }
}

// ─── Component ─────────────────────────────────────────────────────
export default function TankBattle() {
  const canvasRef = useRef(null)
  const stateRef = useRef(null)
  const keysRef = useRef({})
  const rafRef = useRef(0)

  const [status, setStatus] = useState({
    score: 0,
    lives: 3,
    level: 1,
    remaining: LEVEL_ENEMY_POOL,
    phase: 'playing',
    highScore: loadHighScore(),
  })

  const initGame = useCallback((levelIdx = 0, carry = null) => {
    const map = parseMap(LEVELS[levelIdx % LEVELS.length])
    const now = performance.now()
    stateRef.current = {
      map,
      player: {
        type: 'player',
        x: 4 * TILE,
        y: 14 * TILE,
        dir: DIR_UP,
        cd: 0,
        moving: false,
        dead: false,
        shieldUntil: now + 2000,
      },
      enemies: [],
      bullets: [],
      lives: carry ? carry.lives : 3,
      score: carry ? carry.score : 0,
      level: levelIdx + 1,
      levelIdx,
      enemyPool: LEVEL_ENEMY_POOL,
      enemySpawnCd: 300,
      spawnIdx: 0,
      phase: 'playing',
      lastTs: now,
      paused: false,
      explosions: [],
      highScore: loadHighScore(),
      highScoreSaved: false,
    }
    setStatus({
      score: stateRef.current.score,
      lives: stateRef.current.lives,
      level: stateRef.current.level,
      remaining: stateRef.current.enemyPool,
      phase: 'playing',
      highScore: stateRef.current.highScore,
    })
  }, [])

  const respawnPlayer = () => {
    const s = stateRef.current
    s.player.x = 4 * TILE
    s.player.y = 14 * TILE
    s.player.dir = DIR_UP
    s.player.dead = false
    s.player.shieldUntil = performance.now() + 2000
    s.player.cd = 0
  }

  const spawnEnemy = () => {
    const s = stateRef.current
    if (s.enemies.length >= MAX_ENEMIES_ON_SCREEN) return
    if (s.enemyPool <= 0) return
    const spots = [0, 7, 15]
    for (let i = 0; i < 3; i++) {
      const col = spots[(s.spawnIdx + i) % 3]
      const x = col * TILE
      const y = 0
      const conflict = s.enemies.some(
        (e) => Math.hypot(e.x - x, e.y - y) < TILE * 1.5,
      )
      if (
        !conflict &&
        !tankBlockedByMap(s.map, x, y) &&
        !rectHit(
          { x, y, w: TILE, h: TILE },
          { x: s.player.x, y: s.player.y, w: TILE, h: TILE },
        )
      ) {
        s.enemies.push({
          type: 'enemy',
          x,
          y,
          dir: DIR_DOWN,
          cd: 500 + Math.random() * 300,
          aiCd: 400 + Math.random() * 800,
          moving: true,
          dead: false,
          spawnedAt: performance.now(),
        })
        s.enemyPool--
        s.spawnIdx = (s.spawnIdx + i + 1) % 3
        return
      }
    }
  }

  const fire = (t, now) => {
    const s = stateRef.current
    if (t.cd > 0 || t.dead) return
    // limit bullets per owner
    const owned = s.bullets.filter((b) => b.from === t).length
    if (owned >= (t.type === 'player' ? 2 : 1)) return
    const [dx, dy] = DIR_DXY[t.dir]
    const bx = t.x + TILE / 2 - BULLET_SIZE / 2 + (dx * TILE) / 2
    const by = t.y + TILE / 2 - BULLET_SIZE / 2 + (dy * TILE) / 2
    s.bullets.push({
      x: bx,
      y: by,
      dx: dx * BULLET_SPEED,
      dy: dy * BULLET_SPEED,
      owner: t.type,
      from: t,
    })
    t.cd = t.type === 'player' ? PLAYER_FIRE_CD : ENEMY_FIRE_CD
  }

  const moveTank = (t, speed) => {
    const s = stateRef.current
    const [dx, dy] = DIR_DXY[t.dir]
    // snap the perpendicular axis a bit — makes it easier to fit through
    // 1-tile-wide corridors like in Battle City
    if (dx !== 0) t.y = Math.round(t.y / 4) * 4
    if (dy !== 0) t.x = Math.round(t.x / 4) * 4
    const nx = t.x + dx * speed
    const ny = t.y + dy * speed
    if (tankBlockedByMap(s.map, nx, ny)) return false
    const box = { x: nx, y: ny, w: TILE, h: TILE }
    const others = [s.player, ...s.enemies]
    const collide = others.some(
      (o) =>
        o !== t &&
        !o.dead &&
        rectHit(box, { x: o.x, y: o.y, w: TILE, h: TILE }),
    )
    if (collide) return false
    t.x = nx
    t.y = ny
    return true
  }

  const enemyAI = (e, dt, now) => {
    const s = stateRef.current
    e.aiCd -= dt
    if (e.aiCd <= 0 || e.blocked) {
      e.aiCd = 500 + Math.random() * 1500
      const target =
        Math.random() < 0.55
          ? { x: 7 * TILE, y: 14 * TILE } // base
          : { x: s.player.x, y: s.player.y }
      const wantX = target.x - e.x
      const wantY = target.y - e.y
      const preferred =
        Math.abs(wantX) > Math.abs(wantY)
          ? wantX > 0
            ? DIR_RIGHT
            : DIR_LEFT
          : wantY > 0
            ? DIR_DOWN
            : DIR_UP
      const dirs = [DIR_UP, DIR_DOWN, DIR_LEFT, DIR_RIGHT]
      e.dir =
        Math.random() < 0.6
          ? preferred
          : dirs[Math.floor(Math.random() * 4)]
      e.blocked = false
    }
    // random shooting
    if (Math.random() < 0.025) fire(e, now)
    const moved = moveTank(e, ENEMY_SPEED)
    if (!moved) e.blocked = true
  }

  const damageAround = (map, r, c) => {
    // destroy adjacent brick to make hits feel meatier
    if (r >= 0 && r < GRID && c >= 0 && c < GRID && map[r][c] === T_BRICK) {
      map[r][c] = T_EMPTY
    }
  }

  const updateBullets = () => {
    const s = stateRef.current
    const survivors = []
    for (const b of s.bullets) {
      if (b._dead) continue
      b.x += b.dx
      b.y += b.dy
      let hit = false
      if (b.x < 0 || b.y < 0 || b.x + BULLET_SIZE > SIZE || b.y + BULLET_SIZE > SIZE) {
        hit = true
      }
      // wall check — sample the head of the bullet based on direction
      if (!hit) {
        const headPts = [
          [b.x + BULLET_SIZE / 2, b.y + BULLET_SIZE / 2],
          [b.x + (b.dx > 0 ? BULLET_SIZE : 0), b.y + BULLET_SIZE / 2],
          [b.x + BULLET_SIZE / 2, b.y + (b.dy > 0 ? BULLET_SIZE : 0)],
        ]
        for (const [px, py] of headPts) {
          const c = Math.floor(px / TILE)
          const r = Math.floor(py / TILE)
          if (r < 0 || r >= GRID || c < 0 || c >= GRID) continue
          const t = s.map[r][c]
          if (t === T_BRICK) {
            s.map[r][c] = T_EMPTY
            // also nick the neighbouring tile on the perpendicular axis
            if (b.dx !== 0) {
              damageAround(s.map, r + 1, c)
              damageAround(s.map, r - 1, c)
            } else {
              damageAround(s.map, r, c + 1)
              damageAround(s.map, r, c - 1)
            }
            hit = true
            break
          } else if (t === T_STEEL) {
            hit = true
            break
          } else if (t === T_BASE) {
            s.map[r][c] = T_EMPTY
            s.phase = 'lost'
            hit = true
            break
          }
        }
      }
      // tank collisions
      if (!hit) {
        const bulletBox = { x: b.x, y: b.y, w: BULLET_SIZE, h: BULLET_SIZE }
        if (b.owner === 'player') {
          for (const e of s.enemies) {
            if (
              !e.dead &&
              rectHit(bulletBox, { x: e.x, y: e.y, w: TILE, h: TILE })
            ) {
              e.dead = true
              s.score += 100
              s.explosions.push({
                x: e.x + TILE / 2,
                y: e.y + TILE / 2,
                start: performance.now(),
              })
              hit = true
              break
            }
          }
        } else {
          const p = s.player
          const shielded = p.shieldUntil && p.shieldUntil > performance.now()
          if (
            !p.dead &&
            !shielded &&
            rectHit(bulletBox, { x: p.x, y: p.y, w: TILE, h: TILE })
          ) {
            p.dead = true
            s.lives -= 1
            s.explosions.push({
              x: p.x + TILE / 2,
              y: p.y + TILE / 2,
              start: performance.now(),
            })
            hit = true
          }
        }
        // bullet vs bullet: opposing bullets cancel each other out
        if (!hit) {
          for (const b2 of s.bullets) {
            if (b2 !== b && !b2._dead && b2.owner !== b.owner) {
              if (
                rectHit(bulletBox, {
                  x: b2.x,
                  y: b2.y,
                  w: BULLET_SIZE,
                  h: BULLET_SIZE,
                })
              ) {
                b2._dead = true
                hit = true
                break
              }
            }
          }
        }
      }
      if (!hit) survivors.push(b)
    }
    s.bullets = survivors
  }

  // ─── Rendering ───────────────────────────────────────────────────
  const drawBrick = (ctx, x, y) => {
    ctx.fillStyle = '#b45f2f'
    ctx.fillRect(x, y, TILE, TILE)
    ctx.fillStyle = '#7b3d1f'
    for (let i = 0; i < 4; i++) {
      const off = (i % 2) * 4
      for (let j = 0; j < 4; j++) {
        ctx.fillRect(x + j * 8 + off, y + i * 8, 1, 8)
      }
      ctx.fillRect(x, y + i * 8 + 7, TILE, 1)
    }
  }
  const drawSteel = (ctx, x, y) => {
    ctx.fillStyle = '#7d8590'
    ctx.fillRect(x, y, TILE, TILE)
    ctx.fillStyle = '#c9d1d9'
    ctx.fillRect(x + 2, y + 2, TILE - 4, 4)
    ctx.fillRect(x + 2, y + 2, 4, TILE - 4)
    ctx.fillStyle = '#484f58'
    ctx.fillRect(x + 2, y + TILE - 6, TILE - 4, 4)
    ctx.fillRect(x + TILE - 6, y + 2, 4, TILE - 4)
    ctx.strokeStyle = '#1f2937'
    ctx.strokeRect(x + 0.5, y + 0.5, TILE - 1, TILE - 1)
  }
  const drawBase = (ctx, x, y, isDead) => {
    ctx.fillStyle = '#0b0e14'
    ctx.fillRect(x, y, TILE, TILE)
    ctx.fillStyle = isDead ? '#4b5563' : '#e6c027'
    ctx.beginPath()
    ctx.moveTo(x + 6, y + TILE - 4)
    ctx.lineTo(x + TILE / 2, y + 5)
    ctx.lineTo(x + TILE - 6, y + TILE - 4)
    ctx.closePath()
    ctx.fill()
    ctx.fillStyle = '#0b0e14'
    ctx.fillRect(x + TILE / 2 - 3, y + 12, 6, 10)
  }
  const drawTank = (ctx, t, palette) => {
    const { body, turret, barrel } = palette
    const x = t.x
    const y = t.y
    ctx.fillStyle = body
    ctx.fillRect(x + 2, y + 4, TILE - 4, TILE - 8)
    ctx.fillStyle = '#1f2937'
    // tracks depending on direction
    if (t.dir === DIR_LEFT || t.dir === DIR_RIGHT) {
      ctx.fillRect(x + 2, y, TILE - 4, 4)
      ctx.fillRect(x + 2, y + TILE - 4, TILE - 4, 4)
      // tread lines
      ctx.fillStyle = '#0b0e14'
      for (let i = 0; i < 3; i++) {
        ctx.fillRect(x + 4 + i * 8, y + 1, 4, 2)
        ctx.fillRect(x + 4 + i * 8, y + TILE - 3, 4, 2)
      }
    } else {
      ctx.fillRect(x, y + 2, 4, TILE - 4)
      ctx.fillRect(x + TILE - 4, y + 2, 4, TILE - 4)
      ctx.fillStyle = '#0b0e14'
      for (let i = 0; i < 3; i++) {
        ctx.fillRect(x + 1, y + 4 + i * 8, 2, 4)
        ctx.fillRect(x + TILE - 3, y + 4 + i * 8, 2, 4)
      }
    }
    ctx.fillStyle = turret
    const cx = x + TILE / 2
    const cy = y + TILE / 2
    ctx.fillRect(cx - 5, cy - 5, 10, 10)
    ctx.fillStyle = barrel
    const bw = 4
    const bl = TILE / 2 - 2
    if (t.dir === DIR_UP) ctx.fillRect(cx - bw / 2, y + 2, bw, bl)
    else if (t.dir === DIR_DOWN) ctx.fillRect(cx - bw / 2, cy, bw, bl)
    else if (t.dir === DIR_LEFT) ctx.fillRect(x + 2, cy - bw / 2, bl, bw)
    else if (t.dir === DIR_RIGHT) ctx.fillRect(cx, cy - bw / 2, bl, bw)
  }

  const draw = (ctx) => {
    const s = stateRef.current
    ctx.fillStyle = '#0b0e14'
    ctx.fillRect(0, 0, SIZE, SIZE)
    // grid faint
    ctx.strokeStyle = 'rgba(255,255,255,0.02)'
    for (let i = 1; i < GRID; i++) {
      ctx.beginPath()
      ctx.moveTo(i * TILE + 0.5, 0)
      ctx.lineTo(i * TILE + 0.5, SIZE)
      ctx.stroke()
      ctx.beginPath()
      ctx.moveTo(0, i * TILE + 0.5)
      ctx.lineTo(SIZE, i * TILE + 0.5)
      ctx.stroke()
    }
    // map tiles
    for (let r = 0; r < GRID; r++) {
      for (let c = 0; c < GRID; c++) {
        const t = s.map[r][c]
        const x = c * TILE
        const y = r * TILE
        if (t === T_BRICK) drawBrick(ctx, x, y)
        else if (t === T_STEEL) drawSteel(ctx, x, y)
        else if (t === T_BASE) drawBase(ctx, x, y, false)
      }
    }
    // enemies
    for (const e of s.enemies) {
      // spawn flash
      if (performance.now() - e.spawnedAt < 500) {
        ctx.fillStyle = performance.now() % 200 < 100 ? '#fff' : 'transparent'
        ctx.fillRect(e.x, e.y, TILE, TILE)
        continue
      }
      drawTank(ctx, e, {
        body: '#9db1c9',
        turret: '#4b5563',
        barrel: '#111',
      })
    }
    // player
    if (!s.player.dead) {
      drawTank(ctx, s.player, {
        body: '#f5c542',
        turret: '#d97706',
        barrel: '#111',
      })
      const now = performance.now()
      if (s.player.shieldUntil && s.player.shieldUntil > now) {
        ctx.strokeStyle = now % 200 < 100 ? '#4fd1c5' : '#7fdcd0'
        ctx.lineWidth = 2
        ctx.strokeRect(s.player.x - 2, s.player.y - 2, TILE + 4, TILE + 4)
      }
    }
    // bullets
    ctx.fillStyle = '#fff'
    for (const b of s.bullets) ctx.fillRect(b.x, b.y, BULLET_SIZE, BULLET_SIZE)
    // explosions
    const now = performance.now()
    for (const ex of s.explosions) {
      const progress = Math.min(1, (now - ex.start) / 500)
      const radius = progress * TILE
      const alpha = 1 - progress
      ctx.save()
      ctx.globalAlpha = alpha
      ctx.fillStyle = '#ff8800'
      ctx.beginPath()
      ctx.arc(ex.x, ex.y, radius, 0, Math.PI * 2)
      ctx.fill()
      ctx.strokeStyle = '#ff4444'
      ctx.lineWidth = 3
      ctx.stroke()
      ctx.restore()
    }
    // overlays
    if (s.phase === 'won' || s.phase === 'lost') {
      ctx.fillStyle = 'rgba(0,0,0,0.65)'
      ctx.fillRect(0, 0, SIZE, SIZE)
      ctx.fillStyle = s.phase === 'won' ? '#4fd1c5' : '#ff6b6b'
      ctx.font = 'bold 40px system-ui'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText(
        s.phase === 'won' ? '关卡通过！' : 'GAME OVER',
        SIZE / 2,
        SIZE / 2 - 20,
      )
      ctx.fillStyle = '#e6edf3'
      ctx.font = '16px system-ui'
      ctx.fillText(
        s.phase === 'won'
          ? `得分 ${s.score} · 按 N 进入下一关`
          : `得分 ${s.score} · 按 R 重新开始`,
        SIZE / 2,
        SIZE / 2 + 24,
      )
    }
    // paused overlay
    if (s.paused) {
      ctx.fillStyle = 'rgba(0,0,0,0.55)'
      ctx.fillRect(0, 0, SIZE, SIZE)
      ctx.fillStyle = '#f5c542'
      ctx.font = 'bold 48px system-ui'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText('PAUSED', SIZE / 2, SIZE / 2)
      ctx.fillStyle = '#e6edf3'
      ctx.font = '16px system-ui'
      ctx.fillText('按 P 或 ESC 继续', SIZE / 2, SIZE / 2 + 36)
    }
  }

  // ─── Main loop ──────────────────────────────────────────────────
  useEffect(() => {
    initGame(0)
    const canvas = canvasRef.current
    const ctx = canvas.getContext('2d')

    const onKeyDown = (e) => {
      keysRef.current[e.code] = true
      if (
        [
          'Space',
          'ArrowUp',
          'ArrowDown',
          'ArrowLeft',
          'ArrowRight',
        ].includes(e.code)
      ) {
        e.preventDefault()
      }
      if (e.code === 'KeyP' || e.code === 'Escape') {
        const s = stateRef.current
        if (s && s.phase === 'playing') {
          s.paused = !s.paused
        }
      }
    }
    const onKeyUp = (e) => {
      keysRef.current[e.code] = false
    }
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)

    const loop = (ts) => {
      const s = stateRef.current
      const dt = Math.min(50, ts - s.lastTs)
      s.lastTs = ts

      if (s.phase === 'playing' && !s.paused) {
        // player input
        const p = s.player
        if (!p.dead) {
          const K = keysRef.current
          if (K.ArrowUp || K.KeyW) {
            p.dir = DIR_UP
            moveTank(p, PLAYER_SPEED)
          } else if (K.ArrowDown || K.KeyS) {
            p.dir = DIR_DOWN
            moveTank(p, PLAYER_SPEED)
          } else if (K.ArrowLeft || K.KeyA) {
            p.dir = DIR_LEFT
            moveTank(p, PLAYER_SPEED)
          } else if (K.ArrowRight || K.KeyD) {
            p.dir = DIR_RIGHT
            moveTank(p, PLAYER_SPEED)
          }
          if (K.Space) fire(p, ts)
        }
        // cooldowns
        p.cd = Math.max(0, p.cd - dt)
        // enemies
        for (const e of s.enemies) {
          e.cd = Math.max(0, e.cd - dt)
          if (ts - e.spawnedAt < 500) continue // hatch flash
          enemyAI(e, dt, ts)
        }
        // bullets
        updateBullets()
        // reap
        s.enemies = s.enemies.filter((e) => !e.dead)
        // spawn
        s.enemySpawnCd -= dt
        if (s.enemySpawnCd <= 0) {
          spawnEnemy()
          s.enemySpawnCd = ENEMY_SPAWN_CD
        }
        // player death & respawn
        if (p.dead) {
          if (s.lives > 0) respawnPlayer()
          else s.phase = 'lost'
        }
        // win check
        if (
          s.enemyPool === 0 &&
          s.enemies.length === 0 &&
          s.phase === 'playing'
        ) {
          s.phase = 'won'
        }
        // save high score on game over
        if (s.phase === 'lost' && !s.highScoreSaved) {
          s.highScoreSaved = true
          if (s.score > s.highScore) {
            s.highScore = s.score
            try {
              localStorage.setItem('tank-battle-highscore', String(s.score))
            } catch {}
          }
        }
        setStatus({
          score: s.score,
          lives: s.lives,
          level: s.level,
          remaining: s.enemyPool + s.enemies.length,
          phase: s.phase,
          highScore: s.highScore,
        })
      }
      // age explosions (freeze when paused)
      if (!s.paused) {
        s.explosions = s.explosions.filter((ex) => ts - ex.start < 500)
      }
      draw(ctx)
      rafRef.current = requestAnimationFrame(loop)
    }
    rafRef.current = requestAnimationFrame(loop)

    return () => {
      cancelAnimationFrame(rafRef.current)
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initGame])

  // Restart / next level
  useEffect(() => {
    const handler = (e) => {
      const s = stateRef.current
      if (!s) return
      if (s.phase === 'lost' && (e.code === 'KeyR' || e.code === 'Enter')) {
        initGame(0)
      } else if (
        s.phase === 'won' &&
        (e.code === 'KeyN' || e.code === 'Enter')
      ) {
        const nextIdx = (s.levelIdx + 1) % LEVELS.length
        initGame(nextIdx, { score: s.score, lives: s.lives + 1 })
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [initGame])

  return (
    <div className="tb-wrap">
      <div className="tb-header">
        <h1>坦克大战 · Tank Battle</h1>
        <p>
          经典 Battle City 风格 · 保护你的基地，消灭全部
          {LEVEL_ENEMY_POOL} 辆敌方坦克
        </p>
      </div>
      <div className="tb-stage">
        <canvas ref={canvasRef} width={SIZE} height={SIZE} tabIndex={0} />
        <aside className="tb-hud">
          <div className="tb-stat">
            <span>关卡</span>
            <b>{status.level}</b>
          </div>
          <div className="tb-stat">
            <span>剩余敌人</span>
            <b>{status.remaining}</b>
          </div>
          <div className="tb-stat">
            <span>生命</span>
            <b>{status.lives}</b>
          </div>
          <div className="tb-stat">
            <span>分数</span>
            <b>{status.score}</b>
          </div>
          <div className="tb-stat">
            <span>最高分</span>
            <b>{status.highScore}</b>
          </div>
          <div className="tb-tips">
            <div>
              <kbd>↑</kbd>
              <kbd>↓</kbd>
              <kbd>←</kbd>
              <kbd>→</kbd> 或 <kbd>WASD</kbd> 移动
            </div>
            <div>
              <kbd>Space</kbd> 开火
            </div>
            <div>
              <kbd>R</kbd> 重开 · <kbd>N</kbd> 下一关
            </div>
            <div>
              <kbd>P</kbd> 或 <kbd>ESC</kbd> 暂停
            </div>
          </div>
        </aside>
      </div>
    </div>
  )
}
