# VOIDSTRIKE

A browser-based real-time strategy game inspired by StarCraft 2, built with Next.js 14, Three.js, and TypeScript.

## Features

- **3D Graphics**: Powered by Three.js with terrain rendering, unit animations, and visual effects
- **RTS Gameplay**: Unit selection, control groups, pathfinding, combat, and resource gathering
- **Three Factions**: The Dominion (humans), The Synthesis (machines), and The Swarm (organic hive)
- **Multiplayer Ready**: Architecture supports deterministic lockstep multiplayer via Supabase
- **Zero Install**: Runs entirely in the browser - click and play

## Tech Stack

- **Frontend**: Next.js 14, React, TypeScript
- **3D Engine**: Three.js / React Three Fiber
- **State Management**: Zustand
- **Styling**: Tailwind CSS
- **Backend**: Supabase (planned)
- **Deployment**: Vercel (planned)

## Getting Started

### Prerequisites

- Node.js 18+
- npm or yarn

### Installation

```bash
# Install dependencies
npm install

# Start development server
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) to see the game.

### Controls

- **Left Click**: Select unit/building
- **Right Click**: Move/Attack/Interact
- **Box Drag**: Multi-select units
- **Ctrl+1-9**: Create control group
- **1-9**: Select control group
- **A**: Attack move
- **S**: Stop
- **H**: Hold position
- **ESC**: Cancel/Deselect

### Camera

- **WASD / Arrow Keys**: Pan camera
- **Mouse Wheel**: Zoom in/out
- **Middle Mouse Drag**: Rotate camera
- **Edge Scroll**: Move camera to screen edges

## Project Structure

```
src/
├── app/                # Next.js pages
├── components/         # React components
│   ├── game/          # Game UI components
│   └── ui/            # Reusable UI components
├── engine/            # Game engine
│   ├── core/          # Game loop, events
│   ├── ecs/           # Entity Component System
│   ├── systems/       # Game systems
│   ├── components/    # ECS components
│   └── pathfinding/   # A* pathfinding
├── rendering/         # Three.js rendering
├── input/             # Input handling
├── data/              # Game data (units, buildings)
├── store/             # Zustand stores
└── utils/             # Utility functions
```

## Development Roadmap

See [.claude/TODO.md](.claude/TODO.md) for the full roadmap.

### Phase 1: Foundation (Current)
- [x] Project setup
- [x] 3D terrain rendering
- [x] Camera controls
- [x] Unit selection
- [x] Basic pathfinding
- [x] Resource gathering
- [x] Building placement
- [x] Basic AI

### Phase 2: Combat Depth
- [ ] Combat mechanics
- [ ] Unit abilities
- [ ] Tech trees
- [ ] Audio system

### Phase 3: Multiplayer
- [ ] Supabase integration
- [ ] Lobby system
- [ ] Lockstep sync
- [ ] Rankings

## Contributing

This is currently a solo project, but contributions are welcome! Please open an issue to discuss changes before submitting PRs.

## License

MIT License - see LICENSE file for details.

## Acknowledgments

- Inspired by StarCraft 2 by Blizzard Entertainment
- Built with the amazing Three.js library
- Powered by Next.js and React
