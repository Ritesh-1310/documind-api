# 📄 DocuMind API — Document Intelligence Backend

A production-ready RAG (Retrieval-Augmented Generation) pipeline that lets users upload PDF documents and query them using natural language. Built with a fully managed, free-tier cloud stack — no local infrastructure dependencies.

> **Stack:** Node.js · Express · PostgreSQL (Supabase + pgvector) · Redis (Upstash) · BullMQ · AWS S3 · Cohere (embeddings) · Groq/LLaMA 3.3 (LLM) · Prisma · Docker

---

## 🏗️ Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                        CLIENT / REST API                        │
└───────────────────────────────┬─────────────────────────────────┘
                                │
                    ┌───────────▼───────────┐
                    │     API Gateway        │
                    │  (Rate Limit · JWT)    │
                    └───────────┬───────────┘
                                │
          ┌─────────────────────┼────────────────────┐
          │                     │                    │
┌─────────▼──────┐   ┌──────────▼──────┐  ┌─────────▼──────────┐
│  Upload Service │   │  Query Service  │  │   Auth Service     │
│  POST /upload  │   │  POST /query    │  │  /register /login  │
└─────────┬──────┘   └──────────┬──────┘  └────────────────────┘
          │                     │
          │ push job            │ semantic search
          ▼                     ▼
┌─────────────────┐   ┌─────────────────────┐
│  Redis Queue    │   │  pgvector (Supabase) │
│  (Upstash +     │   │  embedding storage   │
│   BullMQ)       │   └──────────┬──────────┘
└────────┬────────┘              │
         │                       │ top-k chunks
         │ worker picks job      ▼
         ▼              ┌──────────────────────┐
┌─────────────────┐     │  Groq (LLaMA 3.3 70B) │
│ Document Worker │     │  (AI answer gen)      │
│                 │     └──────────────────────┘
│ 1. Fetch from   │
│    AWS S3       │
│ 2. Extract text │
│ 3. Chunk text   │──────► pgvector (Supabase)
│ 4. Embed chunks │◄────── Cohere (hosted API)
│ 5. Store meta   │──────► PostgreSQL (Supabase)
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│     AWS S3      │
│ (file storage)  │
└─────────────────┘
```

---

## 🔁 Request Flow

### Upload Flow
```
User uploads PDF
      │
      ▼
API validates (JWT + file type + size limit)
      │
      ▼
File saved to AWS S3 → metadata saved to PostgreSQL (status: PENDING)
      │
      ▼
Job pushed to Redis Queue (BullMQ via Upstash)
      │
      ▼
Worker picks up job:
  → Fetch PDF from S3
  → Extract text (pdfjs-dist)
  → Split into chunks (512 tokens, 50 token overlap)
  → Generate embeddings (Cohere embed-english-v3.0)
  → Store chunks + embeddings in pgvector (Supabase)
  → Update document status: READY
```

### Query Flow
```
User sends question + document_id
      │
      ▼
API validates (JWT + rate limit via Redis)
      │
      ▼
Check Redis cache (base64 query key, 1hr TTL)
      │
      ▼ (cache miss)
Generate embedding for user question (Cohere)
      │
      ▼
pgvector cosine similarity search → top 5 chunks
      │
      ▼
Build prompt: [system context] + [chunks] + [user question]
      │
      ▼
Send to Groq API (LLaMA 3.3 70B) → get answer
      │
      ▼
Log query + answer to PostgreSQL
Cache result in Redis (TTL: 1hr)
Return answer + source chunks + similarity scores
```

---

## 🗂️ Folder Structure

```
documind-api/
│
├── src/
│   ├── config/
│   │   ├── db.js              # PostgreSQL + Prisma client (adapter-based)
│   │   ├── redis.js           # Redis clients (cache + BullMQ, separate connections)
│   │   ├── s3.js               # AWS S3 client
│   │   └── env.js             # Zod-validated env vars
│   │
│   ├── middleware/
│   │   ├── auth.js            # JWT verification
│   │   ├── rateLimiter.js     # Redis sliding window rate limiter
│   │   ├── errorHandler.js    # Centralized error handler
│   │   └── validate.js        # Request schema validation (Zod)
│   │
│   ├── modules/
│   │   ├── auth/
│   │   │   ├── auth.routes.js
│   │   │   ├── auth.controller.js
│   │   │   └── auth.service.js
│   │   │
│   │   ├── documents/
│   │   │   ├── document.routes.js
│   │   │   ├── document.controller.js
│   │   │   ├── document.service.js
│   │   │   └── document.model.js
│   │   │
│   │   └── query/
│   │       ├── query.routes.js
│   │       ├── query.controller.js
│   │       └── query.service.js
│   │
│   ├── workers/
│   │   ├── documentWorker.js  # BullMQ worker (extract→chunk→embed)
│   │   ├── chunker.js         # Text splitting logic
│   │   └── embedder.js        # Cohere embeddings + pgvector raw SQL ops
│   │
│   ├── queues/
│   │   └── documentQueue.js   # BullMQ queue definition
│   │
│   └── app.js
│
├── prisma/
│   ├── schema.prisma
│   └── migrations/
│
├── prisma.config.ts            # Datasource URL config (Prisma 7)
├── docker-compose.yml          # Local dev only (Postgres/Redis/MinIO fallback)
├── Dockerfile
├── .env.example
└── README.md
```

---

## 🗃️ Database Schema

```sql
-- Users
CREATE TABLE users (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email       TEXT UNIQUE NOT NULL,
  password    TEXT NOT NULL,
  created_at  TIMESTAMP DEFAULT NOW()
);

-- Documents (uploaded files)
CREATE TABLE documents (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID REFERENCES users(id),
  filename    TEXT NOT NULL,
  s3_key      TEXT NOT NULL,
  status      TEXT DEFAULT 'PENDING',  -- PENDING | PROCESSING | READY | FAILED
  page_count  INT,
  created_at  TIMESTAMP DEFAULT NOW()
);

-- Chunks with vector embeddings (pgvector)
CREATE TABLE document_chunks (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id UUID REFERENCES documents(id) ON DELETE CASCADE,
  chunk_index INT NOT NULL,
  content     TEXT NOT NULL,
  embedding   VECTOR(1024),            -- Cohere embed-english-v3.0
  created_at  TIMESTAMP DEFAULT NOW()
);

-- Vector similarity index
CREATE INDEX ON document_chunks
  USING ivfflat (embedding vector_cosine_ops);

-- Query logs
CREATE TABLE query_logs (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID REFERENCES users(id),
  document_id UUID REFERENCES documents(id),
  question    TEXT NOT NULL,
  answer      TEXT NOT NULL,
  created_at  TIMESTAMP DEFAULT NOW()
);
```

---

## 🔌 API Endpoints

### Auth
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/auth/register` | Register new user |
| POST | `/api/auth/login` | Login, returns JWT |

### Documents
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/documents/upload` | Upload PDF (multipart/form-data) |
| GET | `/api/documents` | List user's documents |
| GET | `/api/documents/:id/status` | Check processing status |
| DELETE | `/api/documents/:id` | Delete document + chunks |

### Query
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/query` | Ask a question against a document |

#### Query Request/Response
```json
// POST /api/query
{
  "document_id": "uuid-here",
  "question": "What are the key topics covered in this document?"
}

// Response
{
  "success": true,
  "answer": "The document covers Node.js event loop, API design, authentication...",
  "source_chunks": [
    {
      "chunk_index": 0,
      "content": "Senior Backend Developer (Node.js) Interview Questions...",
      "similarity": "0.4959"
    }
  ],
  "cached": false
}
```

---

## ⚙️ Tech Stack

| Layer | Technology | Why |
|-------|-----------|-----|
| Runtime | Node.js + Express | Fast I/O, familiar ecosystem |
| Database | PostgreSQL (Supabase) + pgvector | Managed Postgres with vector search built in, free tier |
| Queue | BullMQ + Redis (Upstash) | Async processing with retry logic, serverless-friendly Redis |
| Cache | Redis (Upstash) | Rate limiting + query result caching |
| Storage | AWS S3 | Industry-standard object storage |
| ORM | Prisma 7 (driver adapters) | Type-safe DB queries, pgbouncer-aware via direct/pooled URLs |
| Embeddings | Cohere (embed-english-v3.0) | Free tier, hosted, no local GPU/runtime needed |
| LLM | Groq (LLaMA 3.3 70B) | Free tier, very fast inference |
| Auth | JWT + bcrypt | Stateless, secure |
| Validation | Zod | Runtime schema validation |
| Hosting | Render (free tier) | Persistent services for both API and worker |

---

## 🚀 Key Engineering Decisions

**Why pgvector over Pinecone/Weaviate?**
Keeps the stack simple — one less managed service. pgvector with cosine similarity handles semantic search efficiently and runs in the same PostgreSQL instance already used for metadata. Supabase's free tier supports the `vector` extension out of the box.

**Why BullMQ for processing?**
Document processing (extraction → chunking → embedding) can take 10–30s and shouldn't block the upload response. BullMQ gives retry logic with exponential backoff, job status tracking, and concurrency control out of the box.

**Why Cohere for embeddings instead of OpenAI?**
Fully hosted, free tier with no card required, and produces high-quality 1024-dim embeddings. Keeps the entire pipeline runnable with zero local dependencies (no self-hosted models), which matters for actually deploying this for free.

**Why Redis (Upstash) for rate limiting?**
Sliding window rate limiting needs atomic increment operations across requests. Redis `INCR` + `EXPIRE` makes this O(1) and avoids hitting the database. Upstash's serverless pricing model means near-zero cost at low traffic.

**Chunking strategy:**
512 tokens per chunk with 50 token overlap. Overlap ensures context isn't lost at chunk boundaries — critical for accurate answers spanning multiple sections.

**Why Groq?**
Free tier with very fast inference (LLaMA 3.3 70B). The query service is LLM-agnostic — swapping to Claude/GPT-4 in production only requires changing `query.service.js`.

**Prisma 7 + connection pooling:**
Supabase's transaction pooler (port 6543, pgbouncer mode) is used for app runtime queries, since it handles high concurrency well. Migrations run against the direct connection (port 5432) since `migrate deploy` requires features pgbouncer's transaction mode doesn't support.

---

## 📦 Getting Started (Local Development)

### Prerequisites
- Node.js 20+
- A Supabase project (free tier, pgvector enabled)
- An Upstash Redis database (free tier)
- An AWS account with an S3 bucket
- Free API keys: Cohere, Groq

### Setup

```bash
# 1. Clone the repo
git clone https://github.com/yourusername/documind-api
cd documind-api

# 2. Install dependencies
npm install

# 3. Copy env file and fill in values
cp .env.example .env
# Fill in: DATABASE_URL, DIRECT_URL, REDIS_URL, AWS keys,
# S3_BUCKET_NAME, COHERE_API_KEY, GROQ_API_KEY, JWT_SECRET

# 4. Run DB migrations (uses direct connection)
npx prisma migrate deploy
npx prisma generate

# 5. Start worker (Terminal 1)
npm run worker

# 6. Start API server (Terminal 2)
npm run dev
```

### Test with Postman

```bash
# Register
POST /api/auth/register
{ "email": "you@example.com", "password": "123456" }

# Upload PDF
POST /api/documents/upload
Authorization: Bearer <token>
Body: form-data → file (PDF)

# Query
POST /api/query
Authorization: Bearer <token>
{ "document_id": "<id>", "question": "What is this document about?" }
```

---

## ☁️ Deployment

Deployed as two persistent Render services from this repo:
1. **API service** — `npm start`, handles HTTP requests
2. **Worker service** — `npm run worker`, processes the document queue

Both share the same environment variables (Supabase, Upstash, S3, Cohere, Groq credentials).

> Free tier note: Render's free instances spin down after inactivity and may take ~30–60s to respond on the first request after idling.

---

## 🔮 Planned Improvements
- [ ] Support DOCX and TXT files
- [ ] Multi-document querying
- [ ] Streaming LLM responses via SSE
- [ ] Admin dashboard with usage analytics
- [ ] Distinguish query vs. document embedding input types in Cohere for improved retrieval quality
