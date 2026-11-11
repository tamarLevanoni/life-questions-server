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
| `bun test` | Run all tests |
| `bun run test:coverage` | Run tests with coverage report |
| `bun run db:push` | Push Prisma schema to database |
| `bun run db:studio` | Open Prisma Studio |
| `bun run db:migrate:dev` | Create and apply a dev migration |
| `bun run db:migrate:deploy` | Apply migrations in production |

## Testing

Tests use Jest and Supertest. Each endpoint must have integration tests covering both success and unauthorized (missing API secret) states.

```bash
bun test
```

## Versioned story search

The search service uses the version in `SEARCH_INDEX_VERSION` and the matching
`SEARCH_EMBEDDING_MODEL`. Leave the version unset for the existing search.
The new index stores scenario and principle vectors and searchable expansion
passages alongside the catalog. Story cards contain no index documents.

Set `SEARCH_INDEX_DATABASE_URL` and `SEARCH_EVAL_DATABASE_URL` explicitly to
an isolated catalog that has the stories and reference tables. Use the same
catalog for index preparation and evaluation.

```bash
bun run search:index migrate
bun run search:index backfill --version split-small-v1 --layout split --model text-embedding-3-small
bun run search:index status --version split-small-v1 --layout split --model text-embedding-3-small
bun run search:eval --check-fixture
bun run search:eval --split tune --arm legacy --arm split=split-small-v1,text-embedding-3-small
```

The migration creates the extension, normalization function, and generated
lexical index. Use this command for search schema changes. A backfill can
resume after interruption and reuses documents whose text hash is unchanged.
Rerun it after catalog imports or edits. The status report checks missing,
stale and obsolete documents and counts required vectors.

Create a distinct version for each model and layout. Compare `combined`,
`split`, and `split-expansion` on the same catalog. The two OpenAI embedding
models use `OPENAI_API_KEY`, Gemini uses `GEMINI_API_KEY`, and Cohere
reranking uses `COHERE_API_KEY`. Add `,rerank` or `,rerank,rewrite` to
an evaluation arm to measure those stages. Tune on the tuning split and
run the holdout after selecting a configuration. The fixture has draft
relevance judgments. Review them and extend the judgments to other returned
stories before treating the scores as a release decision.

After verifying coverage and quality, set `SEARCH_INDEX_VERSION` to the
chosen version and `SEARCH_EMBEDDING_MODEL` to its model. Search can use
lexical retrieval when embedding calls fail. Enable reranking or rewriting
individually using `SEARCH_RERANK_ENABLED=true` and
`SEARCH_REWRITE_ENABLED=true` after measuring their impact. Calibrate
`SEARCH_RERANK_MIN_SCORE` on the tuning split if using a rerank cutoff.
To roll back, restore the previous version and model or unset the version
to return to the existing search.

Story detail accepts `x-story-reader-id` from the BFF, derived from a
verified registered session. The backend looks up the reader before
returning expansion text. Public previews include `hasExpansion` and
a null expansion.

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
