# Life Questions — Backend Server

REST API server for the Life Questions educational platform. Built with Node.js, Express, TypeScript, and Bun.

## Tech Stack

| Layer | Technology |
|---|---|
| Runtime | [Bun](https://bun.sh) |
| Framework | Express + TypeScript |
| ORM | Prisma |
| Database | PostgreSQL (Neon) |
| Monitoring | Sentry |
| Deployment | Render |

## Getting Started

### Prerequisites

- [Bun](https://bun.sh) installed
- PostgreSQL database on [Neon](https://neon.tech)

### Installation

```bash
bun install
```

### Environment Variables

Create a `.env` file at the project root:

```env
PORT=3001
NODE_ENV=development
API_SECRET=your_secret_key
DATABASE_URL=postgresql://...
DIRECT_URL=postgresql://...
CORS_ORIGIN_PROD=https://life-questions.vercel.app
SENTRY_DSN=https://...
```

### Database Setup

```bash
# Push schema to database
bun run db:push

# Generate Prisma client
bun run db:generate

# Open Prisma Studio (GUI)
bun run db:studio
```

### Running the Server

```bash
# Development (with hot reload)
bun run dev

# Production build
bun run build
bun run start
```

## API Security

All requests must include the `x-api-secret` header matching the `API_SECRET` environment variable. The API is not publicly accessible — it is intended to be called only from the Next.js BFF layer.

## Project Structure

```
src/
├── app.ts              # Express app setup
├── server.ts           # Entry point
├── middleware/         # Auth, error handling, etc.
├── modules/            # Feature modules (users, ...)
├── lib/                # Prisma client, Sentry init
├── types/              # Shared TypeScript types
└── utils/              # Helpers and utilities
prisma/
└── schema.prisma       # Database schema
tests/                  # Integration tests (Jest + Supertest)
```

## Scripts

| Command | Description |
|---|---|
| `bun run dev` | Start dev server with hot reload |
| `bun run build` | Compile TypeScript to `dist/` |
| `bun run start` | Run compiled production server |
| `bun run test` | Run all tests |
| `bun run test:coverage` | Run tests with coverage report |
| `bun run db:push` | Push Prisma schema to database |
| `bun run db:studio` | Open Prisma Studio |
| `bun run db:migrate:dev` | Create and apply a dev migration |
| `bun run db:migrate:deploy` | Apply migrations in production |

## Testing

Tests use Jest and Supertest. Apply the SQL migrations from the `life-questions-data` story-search tool
to the isolated test database before running database-backed search tests. Each endpoint must have
integration tests for success and a missing API secret.

```bash
bun run test
```

## Story search index

See the [search requirements](docs/specs/search/SEARCH_REQUIREMENTS.md) and
[search design and API contract](docs/specs/search/SEARCH_DESIGN.md) for the
request flow, source matching, pagination, and expansion access.

Set `SEARCH_REDIS_URL` to a shared Redis or Valkey instance for production
cursor searches. Development and tests without that URL use a bounded
in-process store.

`life-questions-data` owns the search migrations, document builder, and backfill.
Run the following from the root of its checkout, with `DIRECT_URL` or
`DATABASE_URL` pointing to the application database.

```bash
bun install --cwd story-search --frozen-lockfile
bun run story-search/search-index.ts migrate
bun run story-search/search-index.ts backfill
bun run story-search/search-index.ts status
```

Confirm `ready: true` before enabling the new search in production. Rerun
the backfill in `life-questions-data` after catalog changes. The
[index contract](src/modules/stories/search-index-contract.json) must match
`story-search/index-contract.json` in `life-questions-data`. The index stores
`scenario`, `principle`, and `expansion` documents by default.

Embedding and query rewriting use `OPENAI_API_KEY`. The search tries one
rewrite when the initial retrieval finds fewer than three acceptable
candidates and the query has no identified source reference.

## Deployment

The server is configured for deployment on [Render](https://render.com) via `render.yaml`.

Build command:
```bash
bun install && bunx prisma generate && bun run build
```

Start command:
```bash
node dist/server.js
```

Health check endpoint: `GET /health`
