# Anti-Stealth — guards vs infiltrators, with an AI that learns

> A small stealth game that plays itself. Three guards defend a big house at night with flashlights, cameras and
> sensors; three infiltrators try to steal the loot and get out through a corner of the garden. Nobody is controlled
> by a person: both teams are run by an AI, and a genetic algorithm trains them by making them play thousands of
> rounds against each other. It runs in the browser (plain JavaScript + Three.js), and the training runs in Node
> without any window.

![A round in progress](docs/partida.png)

## The story

It started as a map I painted in Godot for a fog-of-war idea. Then I wanted to see if I could make two teams fight
on it without me touching anything, and it kind of got out of hand.

The first version (v1) had the AI written by hand: "if you see a guard, run", "if the bag is half full, go and
extract", and a lot of numbers (we called them genes) that the genetic algorithm tuned. It worked, but every time I
watched a round I saw something obvious they didn't do (guards that never defend the loot, infiltrators that run
straight into a flashlight...) and I had to program it. That list never ends.

So this is v2: each team now has a small **neural network** that decides what to do. It starts playing exactly like
v1 and learns, by training, when it is better to do something else.

## Run it

You need Python (only for a tiny local server) and a browser. For training and tests you also need Node.js.

```
python simulador/herramientas/servidor.py
```

Then open `http://localhost:8123/simulador/index.html`.

Opening `index.html` directly as a file also works, but then the browser can't read the trained genes and the teams
play with the default ones.

- `?n=5` in the URL plays 5 vs 5 instead of 3 vs 3; `?semilla=123` repeats the same round.
- Mouse: drag to rotate, right button to move, wheel to zoom.
- Keys: space pauses, R starts a new round, V shows the vision cones the game really uses.

## What happens in a round

- **Preparation (20 s, the clock doesn't run):** guards place their gadgets. Cameras go on walls and sweep from side to
  side; sensors are hidden on the floor. Where they put them depends on their genes: on the doors everyone has to go
  through, or right on top of the loot.
- **The round (3 minutes, +30 s after the first extraction):** infiltrators come in from the four corners of the
  garden. There are three loot points deep inside the house; they have to carry 100 to the corners to win. Guards win
  when time runs out or when all infiltrators are eliminated.
- **Seeing and being seen:** everything is in the dark. Guards see with their flashlight (a cone that gets weaker with
  distance); infiltrators see further but with a narrow cone, and they notice any flashlight they have in sight. Walls
  block everything; boxes only hide you if you are crouched. Each team shares what it sees and hears instantly, like
  a radio.
- **Noise:** walking and running make noise rings (you can see them); crouched you are almost silent.
- **Fighting:** a guard who keeps an infiltrator in his light for 1.5 s stuns him. An infiltrator who stays behind a
  guard without being seen knocks him down. People wake up after 20 s, or earlier if a teammate revives them. After 5
  knockdowns you are out.
- **Gadgets:**
  - *Camera* — sees far but narrow and sweeps, needs 1.5 s to raise the alarm, can be switched off by an infiltrator
    who stands next to it (and switched back on by a guard who sees it's off).
  - *Sensor* — hidden, 360°, ignores smoke and darkness, but only says "something happened here" and then recharges.
  - *Smoke* — blocks guards and cameras, but infiltrators see through it.
  - *Decoy* — fake noises to pull guards away.
  - *EMP* — switches off nearby guard gadgets for 10 s.
  - Infiltrators get a new gadget every 30 s.

All the numbers are in `simulador/config.js`.

## The AI part

Every agent has a small brain: a neural network with one hidden layer. Every quarter of a second it looks at what the
agent knows (am I being seen? how far is the closest guard I know about? am I carrying loot? is the next part of my
path lit? how much time is left?...) and picks one action from a menu and how to move (crouched, walking or running).

- **Infiltrators:** do the normal routine, go for the loot, go and extract, hide, wait still, attack a guard from
  behind, switch off a camera, throw smoke, or distract (EMP or decoy).
- **Guards:** do the normal routine, **guard the loot that is in danger**, cut the exit door, search hiding spots, wait,
  patrol, or investigate the last alert.

The "normal routine" is the whole v1 AI. With all the network weights at zero it always picks the routine, so a fresh
network plays like v1, and training only has to learn when to change.

The weights of the network are just more genes. The genetic algorithm takes a population of guard brains and one of
infiltrator brains, makes them play against each other, keeps the best, mixes them and mutates them, and repeats.
The only thing that counts is winning (how fast you win doesn't matter).

```
cd simulador
node pruebas/evolucionar.js 1 40 20 2      # seed, generations, population, rivals
node pruebas/equilibrio.js                 # win % for each team, ~1 minute
node pruebas/acciones.js                   # what the networks actually choose
```

Training writes `simulador/mejores_genes.json` after every generation, so you can stop it whenever you want; the page
loads it next time.

## Making it yours

- **The map** is `mapa_casa.js`. You can edit it in Godot 4: open the `editor_mapa` project, select the GridMap, tick
  *pintar*, change the blocks and tick *exportar*. Or generate a new house: `node simulador/herramientas/generar_casa.js 8`
  (another seed gives another house).
- **Rules and numbers:** `simulador/config.js`.
- **Tests:** `node simulador/pruebas/pruebas.js` (about a minute) and `node simulador/pruebas/pruebas_genetico.js`.

## Credits

- [Three.js](https://threejs.org/) for the 3D view.
