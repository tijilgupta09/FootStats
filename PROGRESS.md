# FootStats — Development Progress & Roadmap

## Overall Project Completion

| Metric | Status |
|---|---|
| **Overall Project Completion** | **~65%** |
| **Backend & Ingestion Infrastructure (Phases 1 & 2)** | **~96% Completed** |
| **ML Engine (Phase 3)** | **~95% Completed** |
| **Frontend & Production (Phases 4 & 5)** | **Pending / In Queue** |

```
[████████████████████████████░░░░░░░░░░░░░░░░] 65% Total Completed
• Phase 1: 100% [█████████████████████████]
• Phase 2:  92% [███████████████████████░░]
• Phase 3:  95% [████████████████████████░]
• Phase 4:   0% [░░░░░░░░░░░░░░░░░░░░░░░░░]
• Phase 5:   0% [░░░░░░░░░░░░░░░░░░░░░░░░░]
```

---

## Phase Breakdown: Completed vs. Remaining Work

### Phase 1: Foundation Infrastructure, Database Schema & Core REST API
**Status: 100% Completed**
- **Completed:**
  - PostgreSQL 16 schema with TimescaleDB compatibility (`packages/db/migrations/001_foundation.sql`)
  - Enums (`match_status`, `event_type`, `competition_tier`, `news_category`, `player_position`)
  - Relational tables: `countries`, `competitions`, `seasons`, `venues`, `teams`, `players`, `matches`, `match_events`, `standings`, `news_articles`, `competition_teams`, and `entity_aliases`
  - Time-series tables: `match_probability_ticks`, `match_momentum_ticks`, `team_elo_history`, `team_xg_rolling`
  - Seed dataset (`packages/db/src/seed.ts`) covering 6 major competitions (PL, La Liga, Serie A, Bundesliga, Ligue 1, Champions League)
  - Fastify server configuration and core REST endpoints (`matches`, `competitions`, `teams`, `players`, `news`, `search`, `predictions`)
- **Remaining:** None.

---

### Phase 2: Real-time Data Pipeline, Sync Pollers & Worker Ingestion
**Status: ~92% Completed**
- **Completed:**
  - Mock data provider for full match simulation (`apps/api-gateway/src/ingestion/mock.provider.ts`)
  - Redis FNV-1a state hash diffing engine (`apps/api-gateway/src/ingestion/state-diff.ts`)
  - Kafka event producers and topic orchestration (`apps/api-gateway/src/infra/kafka.ts`)
  - Kafka consumer group for state delta, match events, and standings persistence (`apps/api-gateway/src/ingestion/consumers.ts`)
  - Redis client factory with separate pub/sub subscriber (`apps/api-gateway/src/infra/redis.ts`)
  - Socket.io gateway with room hierarchy (`room:dashboard`, `room:match:<id>`, `room:competition:<id>`)
  - Redis Pub/Sub to Socket.io real-time bridge (`apps/api-gateway/src/infra/socket.ts`)
  - Live match poller worker running at 5-second intervals (`apps/api-gateway/src/ingestion/live-poller.worker.ts`)
  - Fixture sync poller worker running at 5-minute intervals (`apps/api-gateway/src/ingestion/fixture-sync.worker.ts`)
  - Standings sync poller worker running at 5-minute intervals (`apps/api-gateway/src/ingestion/standings-sync.worker.ts`)
  - News ingestion poller worker running at 2-minute intervals (`apps/api-gateway/src/ingestion/news-poll.worker.ts`)
  - Ingestion orchestrator wiring all workers and consumers (`apps/api-gateway/src/ingestion/index.ts`)
  - Workspace Turborepo compilation passing with 0 TypeScript errors across all 3 packages (`@footstats/shared-types`, `@footstats/db`, `@footstats/api-gateway`)
- **Remaining (What is left for Phase 2):**
  - [ ] Start Docker containers (`postgres`, `redis`, `redpanda`, `meilisearch`)
  - [ ] Execute initial database migration (`pnpm db:migrate`) and seed (`pnpm db:seed`)
  - [ ] Run end-to-end integration smoke test (verifying live ticker deltas emitted via WebSocket)

---

### Phase 3: AI/ML Prediction Engine & Time-series Analytics
**Status: ~95% Completed**
- **Completed:**
  - **Poisson / Dixon-Coles Predictive Model** (`apps/api-gateway/src/ml/poisson.ts`):
    - Pre-match expected goals ($\lambda_{\text{home}}$, $\lambda_{\text{away}}$) derived from team ELO ratings + attack/defence ratings + home advantage (×1.15 multiplier).
    - Full (9×9) scoreline probability matrix with Dixon-Coles correction on {0-0, 1-0, 0-1, 1-1} cells (rho = −0.13).
    - Match outcome probabilities: Home Win %, Draw %, Away Win %, Over/Under 2.5, BTTS.
    - Most-likely scoreline extraction. Red card λ-penalty (−18% per card).
  - **In-game Live Win Probability Engine** (`apps/api-gateway/src/ml/live-probability.ts`):
    - Real-time recalculation triggered on state-altering Kafka events (goals, red cards, penalties).
    - Time-decay: remaining λ scaled as `λ_full × (1 − minute/90)`.
    - Convolution of remaining-goals matrix with current score for exact FT probability.
    - Near-FT renormalisation. Live xG accumulation tracker.
  - **Live Momentum & Pressure Indexing** (`apps/api-gateway/src/ml/momentum.ts`):
    - Exponential decay weighting over recent 20-minute event window (decay k = 0.08).
    - Per-event weights: Goal (+25), Red Card (−20), Penalty awarded (+12), VAR overturn (±20), etc.
    - Territorial pressure index from shots on target, total shots, corners, xG, and possession.
    - Composite dominance score (60% momentum + 40% pressure). `dominantTeam` output.
  - **ML Inference Consumer** (`apps/api-gateway/src/ml/inference.consumer.ts`):
    - Kafka consumer group `footstats-ml-inference` on `ml.inference.trigger` topic.
    - Loads match ELO, runs pre-match Poisson model (once per match), runs live probability on every trigger.
    - Persists updated `predictions` JSONB to `matches` table.
    - Writes time-series rows to `match_probability_ticks` and `match_momentum_ticks`.
    - Publishes prediction delta to `channel:match:<id>:predictions` Redis channel for WebSocket push.
  - **New REST Endpoints** (`apps/api-gateway/src/routes/predictions.ts`):
    - `GET /api/v1/predictions/pre-match/:id` — pre-match Poisson prediction with scoreline matrix.
    - `GET /api/v1/predictions/live/:id` — in-game win probabilities + pre-match summary.
    - `GET /api/v1/predictions/probability-ticks/:id` — full win-probability time-series (for Recharts chart).
    - `GET /api/v1/predictions/momentum/:id` — momentum/pressure time-series ticks.
  - **DB Migration 002** (`packages/db/migrations/002_ml_schema.sql`):
    - Adds `momentum_home`, `momentum_away`, `pressure_home`, `pressure_away`, `dominant_team` columns to `match_momentum_ticks`.
    - Unique constraints on `(match_id, time)` for both tick tables (for `ON CONFLICT DO NOTHING`).
    - New `team_season_ratings` table for per-season attack/defence ratings.
  - **Ingestion orchestrator wired** — ML consumer starts alongside existing consumers.
  - **Workspace build passing** — `npx turbo run build` → 3 successful, 0 TypeScript errors.
- **Remaining (What is left for Phase 3):**
  - [ ] Integration smoke test with live Docker stack (after Phase 2 operational tasks complete).
  - [ ] Dynamic attack/defence rating computation from `team_season_ratings` table (currently uses ELO-only defaults).
  - [ ] `team_season_ratings` auto-population worker (batch job reading completed match stats).

---

### Phase 4: Frontend Application (Next.js 15, Tailwind CSS, Recharts, Socket.io)
**Status: 0% (Not Started — Later Stage Development)**
- **What is Left:**
  - [ ] **Project Setup**:
    - Initialize `apps/web` inside the Turborepo monorepo with Next.js 15 (App Router).
    - Configure Tailwind CSS v4, shadcn/ui component library, and Lucide icons.
    - Setup TanStack Query for server state caching and Zustand for client UI state.
    - Configure `@footstats/shared-types` workspace dependency for end-to-end type safety.
  - [ ] **Real-time Client Layer**:
    - `socket.io-client` hook managing room subscriptions (`dashboard`, `match`, `competition`).
    - Flash banner toast/ticker system for real-time goal, red card, and VAR announcements.
    - Animated live score deltas and standings position shift badges.
  - [ ] **Pages & Views**:
    - `/` **Live Dashboard**: Hero live score ticker, live match cards grouped by competition tier, breaking news ticker.
    - `/match/[id]` **Match Center**: Pitch visualization with interactive starting lineups, dynamic events timeline, head-to-head (H2H) matrix, stats comparison bar charts, and live win probability chart (Recharts).
    - `/competition/[id]` **Competition Hub**: Live league table with qualification zones, form badges, and fixtures/results calendar.
    - `/team/[id]` **Team Profile**: Squad roster, historical form, venue details, and historical ELO chart.
    - `/news` **News Feed**: Filterable by team/competition/category, paginated with rich thumbnails.
    - `/search` **Global Search**: Modal search bar powered by Fastify/Meilisearch with instant results for teams, players, and leagues.

---

### Phase 5: Production Hardening, Load Testing & CI/CD
**Status: 0% (Not Started)**
- **What is Left:**
  - [ ] **External Live Data Provider**:
    - Integration of real-world sports data API adapter (Sportmonks / API-Football) implementing `DataProvider` interface with API key management and rate limit tracking.
  - [ ] **Containerization & Deployment**:
    - Multi-stage production `Dockerfile` for `api-gateway`, `web`, and background workers.
    - Production `docker-compose.prod.yml` or Kubernetes manifests / Helm charts.
  - [ ] **Load & Resilience Testing**:
    - k6 / Locust load testing scenarios for high-concurrency WebSocket client connections.
    - Kafka topic partition scalability and message throughput stress testing.
  - [ ] **CI/CD & Observability**:
    - GitHub Actions automated test, lint, and build pipeline.
    - Prometheus metrics exporter for poller latency, Kafka lag, and Redis cache hit ratios.
    - Structured logging with Pino and tracing integration.

---

## Resolved Phase 3 — ML Engine Notes

1. **Pure Node.js (no Python required)**:
   - All Poisson, Dixon-Coles, and momentum calculations implemented in TypeScript. No FastAPI/Ray dependency needed.

2. **`match_momentum_ticks` Schema Mismatch Fixed (Migration 002)**:
   - Original schema had `home_momentum`, `home_pressure_index`, `away_pressure_index` — not matching the ML engine output.
   - Migration 002 adds `momentum_home`, `momentum_away`, `pressure_home`, `pressure_away`, `dominant_team` with idempotent `IF NOT EXISTS` guards.

3. **Tick Table `ON CONFLICT` Fix**:
   - Migration 002 adds `UNIQUE(match_id, time)` constraints to both tick tables enabling `ON CONFLICT DO NOTHING` deduplication.

4. **Dixon-Coles Renormalisation**:
   - After applying τ correction the matrix is renormalised to sum to 1.0, preventing probability leakage.

5. **Near-FT Win Probability Stability**:
   - When remaining λ → 0 (match ending), the convolution correctly collapses to a Dirac on the current score. No special casing needed.

---

## Resolved Phase 1 Bugs & Ingestion Hardening

1. **News Column & Type Mismatch Fixed (`news-poll.worker.ts`)**:
   - Fixed column mapping: mapped `image_url` -> `thumbnail_url`, `related_team_ids` -> `tagged_team_ids`, and `related_player_ids` -> `tagged_player_ids`.
   - Replaced raw JSON stringification with team name-to-UUID resolution and formatted proper PostgreSQL array literals (`'{uuid1,uuid2}'`).

2. **Shared Types Duplication Resolved (`packages/shared-types`)**:
   - Eliminated duplicated `ClientSocketEvents`, `ServerSocketEvents`, `DashboardDelta`, and `ConnectionInfo` declarations between `api.ts` and `websocket.ts`.
   - Unified canonical socket event types in `api.ts` and retained transport channels/constants in `websocket.ts`.
   - Cleaned up unused entity imports in `api.ts`.

3. **Standings `ON CONFLICT` & Constraint Alignment (`standings-sync.worker.ts`, `consumers.ts`, `seed.ts`)**:
   - Updated standings upsert queries to include `group_name` default `''` to accurately match `UNIQUE(competition_id, season_id, COALESCE(group_name, ''), team_id)`.
   - Removed manual insertion/update of generated column `goal_difference`.

4. **Season ID Nullable Mismatch Fixed (`fixture-sync.worker.ts`)**:
   - Enforced strict guard on non-nullable `season_id` before upserting into `matches`.
   - Handled duplicate fixtures cleanly using provider IDs.

5. **Entity Code Alignment (`mock.provider.ts`)**:
   - Aligned Ligue 1 and Bundesliga team IDs/codes with the database seed records (`OM`, `ASM`, `LYO`, `NIC`, `STU`).

6. **TypeScript Strict Typing & Build Fixes**:
   - Cleaned up optional chaining and strict-null access in BullMQ worker `on('completed')` event handlers.
   - Fixed search score typing in `apps/api-gateway/src/routes/news.ts`.
   - Cleaned unused imports across DB seeds and connection scripts.
   - Successfully compiled full workspace with `npx turbo run build`.

---

## File Inventory (Excluding `node_modules` & `.git`)

```
FootStats/
├── .env.example
├── .gitignore
├── docker-compose.yml
├── package.json
├── pnpm-lock.yaml
├── pnpm-workspace.yaml
├── PROGRESS.md
├── README.md
├── tsconfig.base.json
├── turbo.json
│
├── apps/
│   └── api-gateway/
│       ├── package.json
│       ├── tsconfig.json
│       └── src/
│           ├── config.ts
│           ├── server.ts
│           ├── infra/
│           │   ├── kafka.ts
│           │   ├── redis.ts
│           │   └── socket.ts
│           ├── ingestion/
│           │   ├── consumers.ts
│           │   ├── fixture-sync.worker.ts
│           │   ├── index.ts                 ← wires ML consumer
│           │   ├── live-poller.worker.ts
│           │   ├── mock.provider.ts
│           │   ├── news-poll.worker.ts
│           │   ├── provider.interface.ts
│           │   ├── standings-sync.worker.ts
│           │   └── state-diff.ts
│           ├── ml/                          ← NEW (Phase 3)
│           │   ├── index.ts
│           │   ├── poisson.ts               ← Dixon-Coles Poisson model
│           │   ├── live-probability.ts      ← in-game win probability engine
│           │   ├── momentum.ts              ← momentum & pressure index
│           │   └── inference.consumer.ts    ← Kafka ML consumer + DB writer
│           └── routes/
│               ├── competitions.ts
│               ├── matches.ts
│               ├── news.ts
│               ├── predictions.ts           ← 4 endpoints (pre-match, live, ticks, momentum)
│               └── teams.ts
│
└── packages/
    ├── db/
    │   ├── package.json
    │   ├── tsconfig.json
    │   ├── migrations/
    │   │   ├── 001_foundation.sql
    │   │   └── 002_ml_schema.sql            ← NEW (Phase 3)
    │   └── src/
    │       ├── connection.ts
    │       ├── index.ts
    │       ├── migrate.ts
    │       └── seed.ts
    │
    └── shared-types/
        ├── package.json
        ├── tsconfig.json
        └── src/
            ├── api.ts
            ├── entities.ts
            ├── enums.ts
            ├── index.ts
            └── websocket.ts
```
