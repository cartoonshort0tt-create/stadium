# ⚽ Messi vs Ronaldo — Full-Screen Stadium

A **landscape, full-screen** version of the TikTok Live gift game for a PC monitor. The
same phone controller as the portrait game, but every gift becomes a **real attack**:

1. The ball drops at the attacker's feet and he **dribbles forward**.
2. The other player runs in to defend — the attacker beats him with a skill move
   (**NUTMEG**, **RAINBOW FLICK**, **ELASTICO**, **ROULETTE**, **STEP OVER**) while the defender
   **slide-tackles, misses and falls**.
3. The attacker shoots, **scores**, and celebrates (SIUUU! / ¡VAMOS!).

- **Messi** (cartoon Barça colours, #10) attacks the **right** goal.
- **Ronaldo** (cartoon Real Madrid white, #7) attacks the **left** goal.
- **1 coin = 5 goals** — each gift is one attack worth all its goals ("GOAL! +25").
  500+ goals is a **MEGA GOAL**.
- Gifts queue up and play one attack at a time; when many arrive the game **speeds up**,
  and a long run of gifts for the same team is merged into one bigger attack.
- 3-minute rounds, FULL TIME winner card, win count and winning streak, celebration sound
  buttons — all exactly like the portrait game.

## Setup (one time)

1. Install **Node.js** (LTS) from <https://nodejs.org>. Nothing else is needed.
2. Extract this folder anywhere.

## Getting updates

Close the black window, double-click **`update.bat`** (keeps your scores and wins;
`config.json` is replaced), then `start.bat` and **Ctrl+F5** in the browser.

## Every stream

1. Double-click **`start.bat`**. It prints the game and phone addresses.
2. On the PC open `http://localhost:3000` in Chrome, click **▶ Start** (turns sound on),
   press **F** for full screen. Capture that window in TikTok Live Studio (landscape scene).
3. On the phone (same Wi-Fi) open the `/control` address shown in the black window and on
   the Start screen. Phone can't connect? Double-click **`allow-phone.bat`** once.

Only run one game at a time (this one or the portrait one) — both use port 3000. To run
both, change `"port"` in one `config.json` (e.g. 3001).

## Keyboard shortcuts (game screen)

| Key | Action |
| --- | --- |
| F | Fullscreen |
| M | Mute / unmute |
| S | Start / pause the match clock |
| E | End the round now |
| R | Reset the clock |
| 1 / 2 | Test: 1 coin (5 goals) for Messi / Ronaldo |
| Q / W | Test: 100 coins (500-goal mega goal) for Messi / Ronaldo |

## Customising — `config.json`

- `teams.*.name` / `number` / `celebrate` — names, shirt numbers, celebration text.
- `goalsPerCoin` — goals per coin (default 5).
- `gifts.messi` / `gifts.ronaldo` — each team's gift buttons: `name`, `emoji`, `coins`.
- `roundSeconds`, `intermissionSeconds`, `autoStartNextRound` — match clock.
- `boardText` — the gold text in the bar at the bottom.
- `port` — change if 3000 is taken.

Sounds live in `public/sounds/` (`messi.mp3`, `ronaldo.mp3`, `goal.mp3`, `senor.mp3`).
Scores are stored in `data/scores.json`.
