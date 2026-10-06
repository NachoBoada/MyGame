# Last One Standing

A top-down arena shooter that runs in the browser. You play against 5 bots. One bullet kills anyone, bots included, and the last one alive wins the round.

**Play online:** https://claude.ai/artifact/MosyweTYeD6tGjikwuag8K

## How to play

1. Open the game and click **Play**.
2. A 3-2-1 countdown runs. Nobody can move or shoot until it ends.
3. Shoot the bots, and use the walls as cover. Bots fight each other too.
4. Be the last one alive.

### Controls

| Action  | Key                     |
| ------- | ----------------------- |
| Move    | `W` `A` `S` `D` or arrow keys |
| Aim     | Mouse                   |
| Shoot   | Left click (hold to keep firing) |
| Restart | `R`                     |

You need a keyboard and mouse. There are no touch controls, so the game doesn't work on phones or tablets.

### Rules and tips

- **One shot kills.** This applies to you and to every bot.
- **Walls block bullets and sight.** A bot only shoots at someone it can see, so breaking line of sight keeps you safe.
- **Bots take a moment to react** when they first spot you. Shooting first usually wins.
- **Keep moving.** Bots aim slightly ahead of moving targets, but they aren't perfect, and each bot has its own accuracy.
- **Let the bots thin each other out.** The kill feed in the top-right shows who eliminated whom.
- **If you die,** you watch the rest of the round. Press `R` to start a new one right away.

The **Alive** and **Kills** counters are in the top-left corner.

## Run it locally

You don't need to install anything. Open `index.html` in any modern browser (Chrome, Edge, Firefox or Safari).

## Share it with friends

The online version is hosted as a claude.ai Artifact and is **private by default**. Before your friends can open it:

1. Open the [game link](https://claude.ai/artifact/MosyweTYeD6tGjikwuag8K).
2. Open the **Share** menu on the page.
3. Make the page viewable by anyone with the link.
4. Send them the link.

You can also share the game without that link:

- **Send the files.** Zip `index.html`, `style.css` and `game.js`. Your friends unzip them and open `index.html`.
- **Host it yourself.** Upload the folder to a free static host such as GitHub Pages or Netlify (both need an account).

Changes you make to the local files don't reach the online version on their own. It has to be republished to the same link.

## Project files

| File         | What it contains                                           |
| ------------ | ---------------------------------------------------------- |
| `index.html` | The page, start screen and end-of-round screen             |
| `style.css`  | Styling for the counters, kill feed and screens            |
| `game.js`    | The game: movement, shooting, hit detection and bot behaviour |

## Changing the difficulty

These settings are in `game.js`:

- `BOT_SPEED` sets how fast bots move. Raise it to make them harder to hit.
- `accuracy` in `makeEntity` sets each bot's maximum aim error, in radians. Lower it to make bots more accurate.
- `fireRate` in `makeEntity` sets the seconds between a bot's shots. Lower it to make bots fire faster.
- `PLAYER_SPEED` and `PLAYER_COOLDOWN` do the same for you.
