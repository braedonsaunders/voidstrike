# VOIDSTRIKE Deployment Guide

## Quick Start (Single Player Only)

For a basic deployment without multiplayer:

```bash
npm install
npm run build
npm start
```

No environment variables required - the game works offline.

---

## Full Deployment with Multiplayer

### Step 1: Create Supabase Project

1. Go to [supabase.com](https://supabase.com) and create a new project
2. Wait for the project to initialize (~2 minutes)
3. Go to **Settings > API** and copy:
   - Project URL
   - `anon` public key
   - `service_role` key (keep this secret!)

### Step 2: Run Database Migrations

1. Go to **SQL Editor** in Supabase Dashboard
2. Copy the entire contents of `supabase/migrations/001_initial_schema.sql`
3. Paste and click **Run**
4. Verify tables were created in **Table Editor**

### Step 3: Configure Environment Variables

Copy `.env.example` to `.env.local`:

```bash
cp .env.example .env.local
```

Fill in required values:

```env
# Required for multiplayer
NEXT_PUBLIC_SUPABASE_URL=https://xxxxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGci...
SUPABASE_SERVICE_ROLE_KEY=eyJhbGci...
```

### Step 4: Enable Realtime

In Supabase Dashboard:
1. Go to **Database > Replication**
2. Enable replication for the `lobbies` table
3. This allows real-time lobby updates

### Step 5: Deploy to Vercel

#### Option A: One-Click Deploy

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/YOUR_USERNAME/voidstrike)

#### Option B: Manual Deploy

```bash
# Install Vercel CLI
npm i -g vercel

# Deploy
vercel

# Set environment variables
vercel env add NEXT_PUBLIC_SUPABASE_URL
vercel env add NEXT_PUBLIC_SUPABASE_ANON_KEY
vercel env add SUPABASE_SERVICE_ROLE_KEY

# Redeploy with env vars
vercel --prod
```

---

## Environment Variables Reference

### Required for Multiplayer

| Variable | Description | Where to Find |
|----------|-------------|---------------|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL | Settings > API |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Public anon key | Settings > API |
| `SUPABASE_SERVICE_ROLE_KEY` | Server-side secret key | Settings > API |

### Optional - OAuth Providers

Configure these in **Supabase Dashboard > Authentication > Providers**:

| Variable | Description |
|----------|-------------|
| `GOOGLE_CLIENT_ID` | Google OAuth client ID |
| `GOOGLE_CLIENT_SECRET` | Google OAuth secret |
| `DISCORD_CLIENT_ID` | Discord OAuth client ID |
| `DISCORD_CLIENT_SECRET` | Discord OAuth secret |
| `GITHUB_CLIENT_ID` | GitHub OAuth client ID |
| `GITHUB_CLIENT_SECRET` | GitHub OAuth secret |

### Optional - Vercel KV (Session Caching)

| Variable | Description |
|----------|-------------|
| `KV_URL` | Vercel KV connection URL |
| `KV_REST_API_URL` | KV REST API endpoint |
| `KV_REST_API_TOKEN` | KV API token |

### Optional - Game Config

| Variable | Default | Description |
|----------|---------|-------------|
| `NEXT_PUBLIC_TICK_RATE` | `20` | Game updates per second |
| `NEXT_PUBLIC_MAX_PLAYERS` | `2` | Max players per match |
| `NEXT_PUBLIC_DEBUG_MODE` | `false` | Show debug info |

---

## Vercel Configuration

### Recommended Settings

In Vercel Dashboard > Project Settings:

- **Framework Preset**: Next.js
- **Node.js Version**: 18.x or 20.x
- **Build Command**: `npm run build`
- **Output Directory**: `.next`
- **Install Command**: `npm install`

### Environment Variable Scopes

- `NEXT_PUBLIC_*` variables: Add to all environments
- `SUPABASE_SERVICE_ROLE_KEY`: Add to Production and Preview only

---

## Database Schema

The SQL migration creates:

### Tables
- `players` - User accounts and stats
- `factions` - Game factions (Dominion, Synthesis, Swarm)
- `maps` - Map configurations
- `matches` - Match history
- `player_stats` - Per-faction statistics
- `lobbies` - Multiplayer game lobbies
- `replay_commands` - Command log for replays
- `achievements` - Achievement definitions
- `player_achievements` - Unlocked achievements

### Views
- `leaderboard` - Ranked player standings

### Functions
- `update_player_stats_after_match()` - Auto-update stats on match end
- `calculate_elo_change()` - ELO rating calculation
- `cleanup_stale_lobbies()` - Remove old lobbies

---

## Post-Deployment Checklist

- [ ] Database migrations run successfully
- [ ] Environment variables set in Vercel
- [ ] Supabase realtime enabled for `lobbies` table
- [ ] Test single-player game works
- [ ] Test authentication flow
- [ ] Test lobby creation/joining
- [ ] Test multiplayer match

---

## Troubleshooting

### "Multiplayer features disabled" warning
- Check that `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` are set
- Verify the values don't have extra whitespace
- Redeploy after adding environment variables

### Database connection errors
- Verify the Supabase project is not paused
- Check if IP restrictions are blocking connections
- Ensure RLS policies are correctly set up

### Realtime not working
- Enable replication for the `lobbies` table
- Check browser console for WebSocket errors
- Verify `eventsPerSecond` isn't exceeding Supabase limits

### Build failures
- Run `npm run type-check` locally first
- Check for missing dependencies in `package.json`
- Verify Node.js version matches Vercel settings
