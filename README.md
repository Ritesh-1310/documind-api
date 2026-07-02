# 📄 DocuMind API — Document Intelligence Backend

A production-ready RAG (Retrieval-Augmented Generation) pipeline that lets users upload PDF documents and query them using natural language. Built with a fully managed cloud stack deployed on AWS EC2.

> **Live API:** https://documinds.duckdns.org  
> **GitHub:** https://github.com/Ritesh-1310/documind-api

> **Stack:** Node.js · Express · PostgreSQL (Supabase + pgvector) · Redis (Upstash) · BullMQ · AWS S3 · Cohere (embeddings) · Groq/LLaMA 3.3 (LLM) · Prisma · Docker · Nginx · AWS EC2 · GitHub Actions

---

## 🏗️ Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                        CLIENT / REST API                        │
└───────────────────────────────┬─────────────────────────────────┘
                                │
                    ┌───────────▼───────────┐
                    │   Nginx (port 80/443)  │
                    │     Reverse Proxy      │
                    └───────────┬───────────┘
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
┌─────────────────┐     │  Groq (LLaMA 3.3 70B)│
│ Document Worker │     │  (AI answer gen)     │
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
Nginx reverse proxy (port 80/443 → 3000)
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
├── .github/
│   └── workflows/
│       └── deploy.yml         # GitHub Actions CI/CD
│
├── src/
│   ├── config/
│   │   ├── db.js              # PostgreSQL + Prisma client (adapter-based)
│   │   ├── redis.js           # Redis clients (cache + BullMQ, TLS-aware)
│   │   ├── s3.js              # AWS S3 client
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
├── start.js                    # Spawns API + Worker in single process
├── docker-compose.yml          # Local dev (Postgres/Redis/MinIO)
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

**Base URL:** `https://documinds.duckdns.org`

### Landing
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/` | API info, endpoints, stack overview |
| GET | `/health` | Health check |

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
| Database | PostgreSQL (Supabase) + pgvector | Managed Postgres with vector search, free tier |
| Queue | BullMQ + Redis (Upstash) | Async processing with retry logic, serverless Redis |
| Cache | Redis (Upstash) | Rate limiting + query result caching |
| Storage | AWS S3 (ap-south-1) | Industry-standard object storage |
| ORM | Prisma 7 (driver adapters) | Type-safe queries, pgbouncer-aware |
| Embeddings | Cohere (embed-english-v3.0) | Free tier, hosted, 1024-dim vectors |
| LLM | Groq (LLaMA 3.3 70B) | Free tier, very fast inference |
| Auth | JWT + bcrypt | Stateless, secure |
| Validation | Zod | Runtime schema validation |
| Compute | AWS EC2 t3.micro (ap-south-1) | Always-on, no cold starts |
| Reverse Proxy | Nginx | Port 80/443 → 3000, SSL termination |
| SSL | Let's Encrypt (Certbot) | Free, auto-renewing HTTPS |
| DNS | DuckDNS | Free custom subdomain |
| CI/CD | GitHub Actions | Auto-deploy to EC2 on push to main |

---

## 🚀 Key Engineering Decisions

**Why pgvector over Pinecone/Weaviate?**
Keeps the stack simple — one less managed service. pgvector runs in the same PostgreSQL instance already used for metadata. Supabase's free tier supports the `vector` extension out of the box.

**Why BullMQ for processing?**
Document processing (extraction → chunking → embedding) can take 10–30s and shouldn't block the upload response. BullMQ gives retry logic with exponential backoff, job status tracking, and concurrency control out of the box.

**Why Cohere for embeddings?**
Fully hosted, free tier with no card required, produces high-quality 1024-dim embeddings. Keeps the entire pipeline deployable with zero local dependencies.

**Why Redis for rate limiting?**
Sliding window rate limiting needs atomic increment operations. Redis `INCR` + `EXPIRE` is O(1) and avoids hitting the database on every request.

**Chunking strategy:**
512 tokens per chunk with 50 token overlap. Overlap ensures context isn't lost at chunk boundaries — critical for accurate answers spanning multiple sections.

**Why Groq?**
Free tier with fast inference (LLaMA 3.3 70B). The query service is LLM-agnostic — swapping to Claude/GPT-4 in production only requires changing `query.service.js`.

**Prisma 7 + connection pooling:**
Supabase's transaction pooler (port 6543, pgbouncer) is used for runtime queries. Migrations run against the direct connection (port 5432) since `migrate deploy` requires features pgbouncer doesn't support.

**Single-container deployment:**
API and Worker run as separate Node.js child processes inside one Docker container via `start.js`. Keeps the deployment simple while maintaining process isolation and independent crash handling.

**Nginx as reverse proxy:**
Nginx handles SSL termination and port forwarding (80/443 → 3000). Can be extended with rate limiting or load balancing at the infrastructure level without changing application code.

---

## 📦 Getting Started (Local Development)

### Prerequisites
- Node.js 22+
- Docker Desktop
- Free accounts: Supabase, Upstash, AWS, Cohere, Groq

### Setup

```bash
# 1. Clone the repo
git clone https://github.com/Ritesh-1310/documind-api
cd documind-api

# 2. Install dependencies
npm install

# 3. Copy env file and fill in values
cp .env.example .env

# 4. Run DB migrations
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

# Check status
GET /api/documents/:id/status
Authorization: Bearer <token>

# Query
POST /api/query
Authorization: Bearer <token>
{ "document_id": "<id>", "question": "What is this document about?" }
```

---

## ☁️ Deployment

**Live:** https://documinds.duckdns.org

Deployed on **AWS EC2 (t3.micro, ap-south-1 Mumbai)** with Docker, Nginx reverse proxy, and Let's Encrypt SSL.

### Infrastructure
- **Compute:** AWS EC2 t3.micro — Ubuntu 26.04 LTS, always-on, no cold starts
- **Reverse Proxy:** Nginx proxies port 80/443 → Docker container on port 3000
- **SSL:** Let's Encrypt via Certbot (auto-renewing every 90 days)
- **DNS:** DuckDNS (`documinds.duckdns.org` → EC2 public IP)
- **Container:** Single Docker container running API + Worker via `start.js`
- **Restart policy:** `--restart unless-stopped` — survives crashes and instance reboots

### Cloud Services
| Service | Provider | Purpose |
|---------|----------|---------|
| Compute | AWS EC2 (ap-south-1) | API + Worker hosting |
| Database | Supabase (PostgreSQL + pgvector) | Data + vector storage |
| Cache + Queue | Upstash Redis | Rate limiting, caching, job queue |
| File Storage | AWS S3 (ap-south-1) | PDF uploads |
| Embeddings | Cohere | Vector embedding generation |
| LLM | Groq (LLaMA 3.3 70B) | AI answer generation |

### CI/CD Pipeline

Auto-deployment via **GitHub Actions** — every push to `main` triggers:

1. SSH into EC2
2. `git pull` latest code
3. Stop and remove existing container
4. Rebuild Docker image
5. Run new container

```yaml
# .github/workflows/deploy.yml
on:
  push:
    branches: [main]
```

> Secrets stored in GitHub → Settings → Secrets: `EC2_HOST`, `EC2_SSH_KEY`

No manual deployment needed after initial setup.

### Manual Deployment Steps

```bash
# 1. SSH into EC2
ssh -i documind-key.pem ubuntu@<EC2-IP>

# 2. Install Docker
curl -fsSL https://get.docker.com -o get-docker.sh
sudo sh get-docker.sh
sudo usermod -aG docker ubuntu

# 3. Clone and configure
git clone https://github.com/Ritesh-1310/documind-api.git
cd documind-api
nano .env  # add all environment variables (no quotes around values)

# 4. Build and run container
docker build -t documind-api .
docker run -d --name documind --env-file .env -p 3000:3000 --restart unless-stopped documind-api

# 5. Set up Nginx
sudo apt install nginx -y
sudo nano /etc/nginx/sites-available/documind
sudo ln -s /etc/nginx/sites-available/documind /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl restart nginx

# 6. SSL with Let's Encrypt
sudo apt install certbot python3-certbot-nginx -y
sudo certbot --nginx -d documinds.duckdns.org
```

---

## 🔮 Planned Improvements
- [ ] Support DOCX and TXT files
- [ ] Multi-document querying
- [ ] Streaming LLM responses via SSE
- [ ] Admin dashboard with usage analytics
- [x] CI/CD pipeline (GitHub Actions → auto-deploy to EC2 on push to main)
