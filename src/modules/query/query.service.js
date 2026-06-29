const Groq = require('groq-sdk');
const { generateEmbedding, searchSimilarChunks } = require('../../workers/embedder');
const { getDocumentById } = require('../documents/document.model');
const prisma = require('../../config/db');
const { redis } = require('../../config/redis');
const env = require('../../config/env');

const groq = new Groq({ apiKey: env.GROQ_API_KEY });

const queryDocumentService = async (userId, documentId, question) => {
  const document = await getDocumentById(documentId, userId);
  if (!document) {
    const err = new Error('Document not found');
    err.status = 404;
    throw err;
  }
  if (document.status !== 'READY') {
    const err = new Error(`Document is not ready yet. Current status: ${document.status}`);
    err.status = 400;
    throw err;
  }

  const cacheKey = `query:${documentId}:${Buffer.from(question).toString('base64')}`;
  const cached = await redis.get(cacheKey);
  if (cached) return { ...JSON.parse(cached), cached: true };

  const queryEmbedding = await generateEmbedding(question);
  const similarChunks = await searchSimilarChunks(documentId, queryEmbedding, 5);

  if (!similarChunks.length) {
    const err = new Error('No relevant content found in document');
    err.status = 404;
    throw err;
  }

  const context = similarChunks.map((c, i) => `[Chunk ${i + 1}]:\n${c.content}`).join('\n\n');

  const completion = await groq.chat.completions.create({
    model: 'llama-3.3-70b-versatile',
    messages: [
      {
        role: 'system',
        content: 'You are a helpful assistant that answers questions based strictly on the provided document excerpts.',
      },
      {
        role: 'user',
        content: `Document excerpts:\n${context}\n\nQuestion: ${question}\n\nAnswer:`,
      },
    ],
    max_tokens: 1024,
  });

  const answer = completion.choices[0].message.content;

  await prisma.queryLog.create({
    data: { userId, documentId, question, answer },
  });

  const response = {
    answer,
    source_chunks: similarChunks.map(c => ({
      chunk_index: c.chunkIndex,
      content: c.content.substring(0, 200) + '...',
      similarity: parseFloat(c.similarity).toFixed(4),
    })),
  };

  await redis.set(cacheKey, JSON.stringify(response), 'EX', 3600);
  return { ...response, cached: false };
};

module.exports = { queryDocumentService };
