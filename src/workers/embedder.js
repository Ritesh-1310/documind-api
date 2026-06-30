const { CohereClient } = require('cohere-ai');
const { PrismaPg } = require('@prisma/adapter-pg');
const { PrismaClient } = require('@prisma/client');
const env = require('../config/env');

const cohere = new CohereClient({ token: env.COHERE_API_KEY });

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

const generateEmbedding = async (text) => {
  const response = await cohere.embed({
    texts: [text],
    model: 'embed-english-v3.0',
    inputType: 'search_document',
  });
  return response.embeddings[0];
};

const storeChunks = async (documentId, chunks) => {
  await prisma.$executeRawUnsafe(`CREATE EXTENSION IF NOT EXISTS vector`);
  await prisma.$executeRawUnsafe(`
    ALTER TABLE "DocumentChunk"
    ADD COLUMN IF NOT EXISTS embedding vector(1024)
  `);

  for (let i = 0; i < chunks.length; i++) {
    const embedding = await generateEmbedding(chunks[i]);
    const embeddingStr = `[${embedding.join(',')}]`;

    await prisma.$executeRawUnsafe(`
      INSERT INTO "DocumentChunk" (id, "documentId", "chunkIndex", content, embedding, "createdAt")
      VALUES (gen_random_uuid(), $1, $2, $3, $4::vector, NOW())
    `, documentId, i, chunks[i], embeddingStr);
  }
};

const searchSimilarChunks = async (documentId, queryEmbedding, topK = 5) => {
  const embeddingStr = `[${queryEmbedding.join(',')}]`;

  const results = await prisma.$queryRawUnsafe(`
    SELECT id, "chunkIndex", content,
           1 - (embedding <=> $1::vector) AS similarity
    FROM "DocumentChunk"
    WHERE "documentId" = $2
    ORDER BY embedding <=> $1::vector
    LIMIT $3
  `, embeddingStr, documentId, topK);

  return results;
};

module.exports = { generateEmbedding, storeChunks, searchSimilarChunks };
