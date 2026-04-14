# CLAUDE.md - Life Questions Backend Server

## Development Commands (Bun Runtime)
- **Install Dependencies:** `bun install`
- **Run Dev Server:** `bun run dev` (using ts-node-dev or equivalent)
- **Build Project:** `bun run build`
- **Database Management (Prisma):** `bunx prisma studio` / `bunx prisma db push`
- **Unit & Integration Tests:** `bun test` (using Jest + Supertest)

## Backend Stack & Architecture
- **Framework:** **Node.js with Express and TypeScript**.
- **Runtime:** **Bun** is mandatory for all server operations and package management.
- **ORM & Database:** **Prisma** connected to a **PostgreSQL** instance on **Neon**.
- **Role:** This server is the **Single Source of Truth**. All persistent data resides here.
- **Security:** Implement a mandatory **Security Middleware** to validate the `API_SECRET` header sent from the Next.js BFF. The API is not public-facing.
- **Deployment:** Configured for deployment on **Render**.

## Logic & Data Structure (MVP Phase)
- **User Model:** Must include split fields for **`firstName`** and **`lastName`**, a unique `email`, an optional **`institutionName`**, optional `phone`, an array for `occupations` (jurist, educator, student, parent, learner), and `marketingConsent`.
- **Content Hierarchy:** Scenarios must support the structure: Scenario Content → Question → Short Answer → Expansion.
- **Permission Logic:** The `expansion` field should only be returned if the requesting user has the appropriate access flags.
- **Categorization:** Data must be indexed by a 3-level Source system (e.g., Book → Section → Subsection) and thematic Concept tags.

## AI Workflow & Git Rules
- **Plan Before Action:** Always use **Plan Mode** (`Shift + Tab`) to outline API routes, controller logic, or schema changes before writing code.
- **Git Commits:** Every significant logic change or feature must be followed by a Git backup.
- **Language Policy:** **All commit messages MUST be written in English**, providing clear details of the backend logic updated.
- **Terminology:** Use neutral, educational terminology in code, documentation, and commits (avoid direct religious keywords).

## Infrastructure & Reliability
- **Error Handling:** Maintain a standardized JSON error response structure.
- **Monitoring:** Integrate **Sentry** for real-time error tracking and performance monitoring.
- **Testing:** Every new endpoint must be accompanied by integration tests verifying both success and unauthorized (missing API secret) states.
