# Last One Standing

A top-down tank battle that runs in the browser. Up to 6 players can play online together, and bots fill any empty slots. One shot destroys any tank, and the last tank left wins the round.

**Play:** https://nachoboada.github.io/MyGame/

## Play with friends

1. One person opens the game, types a name and clicks **Create online match**. That person is the **host**.
2. The lobby shows a 5-character **room code**. The host sends friends the code, or clicks **Copy invite link** and sends the link.
3. Each friend opens the game, types a name, enters the code and clicks **Join**. Opening the invite link fills in the code for them.
4. When everyone is in the lobby, the host clicks **Start match**. Bots take any of the 6 slots that players haven't filled.
5. When a round ends, the host clicks **Play again** to start the next one. Anyone who joined during a round watches it and plays from the next round.

You can also click **Play solo vs bots** to play alone against 5 bots, with no internet connection needed.

### Things to know about online play

- **The host's browser runs the match.** If the host closes the tab or leaves, the match ends for everyone. The host should also keep the game tab open and in view, because browsers pause pages that aren't visible, and that freezes the match for all players.
- **Players connect directly to the host.** The game uses [PeerJS](https://peerjs.com/), and the free PeerJS server only introduces players to each other. Some strict networks (some workplaces, schools and mobile hotspots) block direct connections. If a friend can't join, try another network or let someone else host.
- **Lag depends on the connection to the host.** Other tanks are smoothed between updates, so on a slow connection they may move slightly behind where they really are.

## How to play

1. A 3-2-1 countdown runs at the start of each round. Tanks can aim, but not move or shoot, until it ends.
2. Shoot the other tanks, and use the walls as cover. Bots fight everyone, including each other.
3. Be the last tank left.

### Maps

There are 4 maps. Each one is symmetric, so no spawn point has an advantage.

| Map | Layout |
| --- | ------ |
| **Outpost** | Mixed cover: long walls, two side columns and a central block |
| **Crossroads** | Four L-shaped bunkers around an open center |
| **Pillars** | A grid of small pillars, with lots of cover and short sight lines |
| **Trenches** | Two long trench lines, with gaps at the ends and in the middle |

To choose a map:

- **Solo:** pick it in the **Map** list on the main menu before clicking **Play solo vs bots**.
- **Online:** the host picks it in the lobby, and everyone else sees the choice. The host can also choose a different map on the end-of-round screen before clicking **Play again**.

The game remembers the last map you chose.

### Controls

| Action  | Key                     |
| ------- | ----------------------- |
| Move    | `W` `A` `S` `D` or arrow keys |
| Aim     | Mouse                   |
| Shoot   | Left click (hold to keep firing) |
| Restart | `R` (solo only)         |

You need a keyboard and mouse. There are no touch controls, so the game doesn't work on phones or tablets.

### The tanks

Each of the 6 slots has its own tank. Players take slots in the order they joined, so the host always drives the green tank. Your own tank has a white star on its rear deck and **YOU** above it.

| Slot | Colour | Design |
| ---- | ------ | ------ |
| 1 (host) | Green  | Medium tank |
| 2    | Red    | Heavy tank with a box turret |
| 3    | Sand   | Small light tank |
| 4    | Purple | Twin-barrel tank |
| 5    | Blue   | Tank destroyer with a low, wedge-shaped turret |
| 6    | Grey   | Long-barrel tank |

The designs only change how the tanks look. Every tank is destroyed by a single shot, and every player tank moves at the same speed. A destroyed tank leaves a burnt-out wreck that you can drive over.

### Tips

- **Walls block bullets and sight.** A bot only shoots at tanks it can see, so breaking line of sight keeps you safe from bots.
- **Bots take a moment to react** when they first spot you. Shooting first usually wins.
- **Keep moving.** Bots aim slightly ahead of moving targets, but they aren't perfect.
- **Let the others thin each other out.** The kill feed in the top-right shows who destroyed whom.

The **Alive** and **Kills** counters and the room code are in the top-left corner.

## Hosting on GitHub Pages

The game is plain HTML, CSS and JavaScript, so GitHub Pages can serve it as is. To turn it on:

1. Open the repository on GitHub and go to **Settings → Pages**.
2. Under **Build and deployment**, set **Source** to **Deploy from a branch**.
3. Choose the `main` branch and the `/ (root)` folder, then click **Save**.

After a minute or two the game is live at https://nachoboada.github.io/MyGame/. Every push to `main` updates it.

## Run it locally

Open `index.html` in a modern browser (Chrome, Edge, Firefox or Safari). Solo play works offline. Online play needs an internet connection to load PeerJS and to connect players.

## Project files

| File         | What it contains |
| ------------ | ---------------- |
| `index.html` | The page, menu, lobby and end-of-round screens |
| `style.css`  | Styling for the screens, counters and kill feed |
| `game.js`    | The game: movement, shooting, bots, drawing, and the match logic for host and players |
| `net.js`     | Online connections: creating a room, joining by code, and detecting players who drop out |

## Changing the difficulty

These settings are in `game.js`:

- `BOT_SPEED` sets how fast bots move. Raise it to make them harder to hit.
- `accuracy` in `makeEntity` sets each bot's maximum aim error, in radians. Lower it to make bots more accurate.
- `fireRate` in `makeEntity` sets the seconds between a bot's shots. Lower it to make bots fire faster.
- `PLAYER_SPEED` and `PLAYER_COOLDOWN` set every player's speed and the time between their shots.
