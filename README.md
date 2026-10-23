# Last One Standing

A top-down tank battle that runs in the browser. Up to 6 players can play online together, and you choose how many bots join them, up to 17. Pick one of 7 tanks, each with its own strengths and weaknesses. The last tank left wins the round.

**Play:** https://nachoboada.github.io/MyGame/

**Newer version, still being tried out:** https://nachoboada.github.io/MyGame/messages/ is the `extra-features` branch. It is a separate copy of the game: rooms made on one page can't be joined from the other, and each page keeps its own saved settings.

## Play with friends

1. One person opens the game, types a name and clicks **Create online match**. That person is the **host**.
2. The lobby shows a 5-character **room code**. The host sends friends the code, or clicks **Copy invite link** and sends the link.
3. Each friend opens the game, types a name, enters the code and clicks **Join**. Opening the invite link fills in the code for them.
4. Everyone picks a tank in the lobby (see [The tanks](#the-tanks)). Several players can pick the same one. When everyone is ready, the host clicks **Start match**. The host chooses how many bots to add with the **Bots** list (up to the free spawn points, so 18 tanks in all). Bots get random tanks.
5. When a round ends, the host clicks **Play again** to start the next one. Everyone can change their tank on the end screen first. Anyone who joined during a round watches it and plays from the next round.

You can also click **Play solo vs bots** to play alone against 1 to 17 bots, as many as you choose in the **Bots** list, with no internet connection needed.

### Things to know about online play

- **The host's browser runs the match.** If the host closes the tab or leaves, the match ends for everyone. The host should also keep the game tab open and in view, because browsers pause pages that aren't visible, and that freezes the match for all players.
- **Players connect directly to the host.** The game uses [PeerJS](https://peerjs.com/), and the free PeerJS server only introduces players to each other. Some strict networks (some workplaces, schools and mobile hotspots) block direct connections. If a friend can't join, try another network or let someone else host.
- **Lag depends on the connection to the host.** Other tanks are smoothed between updates, so on a slow connection they may move slightly behind where they really are.

## How to play

1. A 3-2-1 countdown runs at the start of each round. Tanks can aim, but not move or shoot, until it ends. A bobbing yellow arrow points at your tank during the countdown, so you can find it before the round starts.
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

### Spawn points

Every map has 18 spawn points, and each map's points are mirrored on all four sides, so none is better than the others. You choose where your tank starts:

1. Click the **Spawn** button next to the **Map** and **Bots** lists, on the main menu, in the lobby, or on the end-of-round screen. It reads **Random** until you choose a point.
2. The arena shows the numbered spawn points. Click one, or pick it from the list. Your tank appears on it so you can see where it will start. **Random** goes back to a random point.
3. Click **Done** (or press `Esc`) to go back.

Everyone else starts on random free points: bots always, and any player who hasn't chosen. Online, each player chooses their own, and a point someone has taken shows that player's colour and initial and can't be chosen twice. Spawn points belong to one map, so changing the map sets everyone back to **Random**.

### Bots

Choose how many bots to play with in the **Bots** list, next to the **Map** list on the main menu. The choices are from None up to one fewer than the map's spawn points, which is 17 (every map has 18 spawn points, and one is kept for you). The game remembers your choice.

- **Solo:** you play against the number you choose. You always get at least 1 bot, because a round needs an opponent. With 17 bots, all 18 spawn points are used.
- **Online:** the host picks the number in the lobby, and everyone else sees it. A match never has more tanks than the map has spawn points (18), so bots only take the spawn points that players leave free: with 6 players and 17 bots chosen, 12 bots join. The lobby shows the players, then one line for all the bots. Choosing **None** gives a match with only players, which needs at least 2 of them. The host can change the number again on the end-of-round screen before clicking **Play again**.

### Bot tanks

Bots get a random tank each round. To choose which tanks they can use, click **Bot tanks** above the tank list (on the main menu, in the lobby, or on the end-of-round screen). A panel shows all 7 tanks. Click a tank to switch it on or off, then click **Done** (or press `Esc`). **Select all** turns every tank back on.

- Each bot picks at random from the tanks that are on, so with only 2 tanks on, every bot drives one of those 2. With a single tank on, every bot drives that tank. At least one tank always stays on.
- It starts with all 7 tanks on, and the game remembers your choice.
- **Online:** the host chooses, and everyone else sees the choice in the lobby. The lobby shows what the bots will drive.

### Controls

| Action  | Key                     |
| ------- | ----------------------- |
| Move    | `W` `A` `S` `D` or arrow keys |
| Aim     | Mouse                   |
| Shoot   | Left click (hold to keep firing) |
| Lay a mine (tank 6) | `E` or right-click |
| Jump over walls (tank 7) | `Space` |
| Restart | `R` (solo only)         |
| New solo game after a round | `Space` (after a short pause, so a jump key press doesn't skip the results) |
| Main menu, once your tank is destroyed and only bots are left (solo) | `Esc` |
| Sound on/off | `M`                |

You need a keyboard and mouse. There are no touch controls, so the game doesn't work on phones or tablets.

### The tanks

Pick your tank on the main menu, in the lobby, or on the end-of-round screen. Anyone can pick any tank, including the same one as another player. Bots get a random tank each round. Your own tank has a white star on its rear deck and **YOU** above it.

A normal shot does 100 damage, and a normal tank has 100 health, so one normal shot destroys it. A tank that has taken damage shows a health bar under it and flashes when it's hit.

Every bullet has the colour of the tank that fired it.

| Tank | Colour | Ability | Drawback |
| ---- | ------ | ------- | -------- |
| **1 · Bulwark** | Red | Takes twice as many hits (200 health) | Moves at 70% speed |
| **2 · Dart** | Sand | Moves at 150% speed | Each shot does half damage, so it needs 2 shots to destroy a normal tank |
| **3 · Twin Gun** | Purple | Shoots twice as fast | Each shot does half damage |
| **4 · Phantom** | Blue | Bullets pass through walls | Bullets travel at 70% speed |
| **5 · Hunter** | Teal | Auto-aim: the turret locks onto the nearest enemy it can see | Fires at half the normal rate |
| **6 · Sapper** | Green | Lays mines (`E` or right-click) | Bullets vanish after 100 pixels |
| **7 · Hopper** | Pink | Jumps over walls (`Space`) | Can't shoot in the air, and needs 3 seconds to recharge |

**Jumping.** A Hopper leaps about 210 pixels in the direction it is moving (or the way it is facing if it is standing still) and takes half a second to land. In the air it passes over walls and mines, and it can aim but not shoot. It can still be hit by bullets. A "Jump ready" label under the counters shows when it has recharged. If a jump lands inside a wall, the tank is pushed out to the nearest side.

**Mines.** A mine arms 1 second after it is laid, shown by a blinking red light. It destroys any tank except its owner that drives close to it. A Sapper can lay one mine every 2 seconds and keep up to 4 on the field, and laying a fifth removes the oldest. Mines show for everyone and are cleared when the round ends.

A destroyed tank leaves a burnt-out wreck that you can drive over.

### Tips

- **Walls block bullets and sight.** A bot only shoots at tanks it can see, so breaking line of sight keeps you safe from bots. A Phantom's bullets and a Phantom bot's aim ignore walls, so cover doesn't help against them.
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
| `sound.js`   | Plays the game's sounds, and the **M** key's sound on/off setting |
| `destroyed-sound.js` | The sound when your tank is destroyed (an arcade-style metal explosion), embedded like the shot sound |
| `shot-sound.js` | The shot sound (a short explosion), embedded so it also plays when the game is opened from disk |
| `net.js`     | Online connections: creating a room, joining by code, and detecting players who drop out |

## Changing the difficulty

These settings are in `game.js`:

- `BOT_SPEED` sets how fast bots move. Raise it to make them harder to hit.
- `accuracy` in `makeEntity` sets each bot's maximum aim error, in radians. Lower it to make bots more accurate.
- `fireRate` in `makeEntity` sets the seconds between a bot's shots. Lower it to make bots fire faster.
- `PLAYER_SPEED` and `PLAYER_COOLDOWN` set every player's speed and the time between their shots.
- `TANK_TYPES` lists the 7 tanks. Each one's health (`hp`), speed, damage, fire rate (`cooldown`), bullet speed, `range` and abilities are on one line, so you can rebalance a tank by editing its numbers. The mine and jump settings (`MINE_*`, `JUMP_*`) are near the top of the file.
