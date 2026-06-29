# 📄 DocuMind API — Document Intelligence Backend

A production-ready RAG (Retrieval-Augmented Generation) pipeline that lets users upload documents and query them using natural language. Built with a focus on scalability, async processing, and clean backend architecture.

> **Stack:** Node.js · Express · PostgreSQL · pgvector · Redis · BullMQ · MinIO · Ollama · Groq (LLaMA 3.3) · Docker · Prisma

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
│   Redis Queue   │   │  pgvector (postgres) │
│    (BullMQ)     │   │  embedding storage  │
└────────┬────────┘   └──────────┬──────────┘
         │                       │
         │ worker picks job      │ top-k chunks
         ▼                       ▼
┌─────────────────┐   ┌──────────────────────┐
│ Document Worker │   │  Groq (LLaMA 3.3)    │
│                 │   │  (AI answer gen)     │
│ 1. Fetch from   │   └──────────────────────┘
│    MinIO/S3     │
│ 2. Extract text │
│ 3. Chunk text   │──────► pgvector
│ 4. Embed chunks │◄────── Ollama (local)
│    (Ollama)     │
│ 5. Store meta   │──────► PostgreSQL
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│   MinIO / S3    │
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
File saved to MinIO/S3 → metadata saved to PostgreSQL (status: PENDING)
      │
      ▼
Job pushed to Redis Queue (BullMQ)
      │
      ▼
Worker picks up job:
  → Fetch PDF from MinIO/S3
  → Extract text (pdfjs-dist)
  → Split into chunks (512 tokens, 50 token overlap)
  → Generate embeddings (Ollama nomic-embed-text - runs locally)
  → Store chunks + embeddings in pgvector
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
Generate embedding for user question (Ollama)
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
│   │   ├── db.js              # PostgreSQL + Prisma client
│   │   ├── redis.js           # Redis client (cache + BullMQ)
│   │   ├── s3.js              # MinIO/S3 client
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
│   │   └── embedder.js        # Ollama embeddings + pgvector ops
│   │
│   ├── queues/
│   │   └── documentQueue.js   # BullMQ queue definition
│   │
│   └── app.js
│
├── prisma/
│   └── schema.prisma
│
├── prisma.config.ts
├── docker-compose.yml         # PostgreSQL + Redis + MinIO
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
  embedding   VECTOR(768),             -- nomic-embed-text via Ollama
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
| Database | PostgreSQL + pgvector | Vector search without extra infra |
| Queue | BullMQ + Redis | Async processing with retry logic |
| Cache | Redis | Rate limiting + query result caching |
| Storage | MinIO (S3-compatible) | Local S3, swap for AWS S3 in prod |
| ORM | Prisma | Type-safe DB queries |
| Embeddings | Ollama (nomic-embed-text) | Runs locally, zero cost |
| LLM | Groq (LLaMA 3.3 70B) | Free tier, fast inference |
| Auth | JWT + bcrypt | Stateless, secure |
| Validation | Zod | Runtime schema validation |
| Containers | Docker + docker-compose | One-command local setup |

---

## 🚀 Key Engineering Decisions

**Why pgvector over Pinecone/Weaviate?**
Keeps the stack simple — one less managed service. pgvector with cosine similarity handles semantic search efficiently and runs in the same PostgreSQL instance already used for metadata.

**Why BullMQ for processing?**
Document processing (extraction → chunking → embedding) can take 10–30s and shouldn't block the upload response. BullMQ gives retry logic with exponential backoff, job status tracking, and concurrency control out of the box.

**Why Ollama for embeddings?**
Runs locally at zero cost. `nomic-embed-text` produces high-quality 768-dim embeddings competitive with OpenAI's `text-embedding-3-small`. Easy to swap for OpenAI in production.

**Why Redis for rate limiting?**
Sliding window rate limiting needs atomic increment operations across requests. Redis `INCR` + `EXPIRE` makes this O(1) and avoids hitting the database.

**Chunking strategy:**
512 tokens per chunk with 50 token overlap. Overlap ensures context isn't lost at chunk boundaries — critical for accurate answers spanning multiple sections.

**Why Groq?**
Free tier with fast inference (LLaMA 3.3 70B). Architecture is LLM-agnostic — swap to Claude/GPT-4 by changing one service file.

---

## 📦 Getting Started

### Prerequisites
- Node.js 20+
- Docker Desktop
- Ollama (https://ollama.com)

### Setup

```bash
# 1. Clone the repo
git clone https://github.com/yourusername/documind-api
cd documind-api

# 2. Install dependencies
npm install

# 3. Copy env file and fill in values
cp .env.example .env

# 4. Pull embedding model
ollama pull nomic-embed-text

# 5. Start PostgreSQL, Redis, MinIO
docker-compose up -d

# 6. Create MinIO bucket
# Open http://localhost:9001 → login: minioadmin/minioadmin
# Create bucket named: documind-uploads

# 7. Run DB migrations
npx prisma migrate dev

# 8. Generate Prisma client
npx prisma generate

# 9. Start worker (Terminal 1)
npm run worker

# 10. Start API server (Terminal 2)
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

## 🔮 Planned Improvements
- [ ] Support DOCX and TXT files
- [ ] Multi-document querying
- [ ] Streaming LLM responses via SSE
- [ ] Admin dashboard with usage analytics
- [ ] Swap Ollama → OpenAI embeddings for production
