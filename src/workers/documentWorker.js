require('dotenv').config();
const { Worker } = require('bullmq');
const { GetObjectCommand } = require('@aws-sdk/client-s3');
const s3 = require('../config/s3');
const { bullRedis } = require('../config/redis');
const { chunkText } = require('./chunker');
const { storeChunks } = require('./embedder');
const { updateDocumentStatus } = require('../modules/documents/document.model');
const env = require('../config/env');

const streamToBuffer = async (stream) => {
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  return Buffer.concat(chunks);
};

const extractTextFromPDF = async (buffer) => {
  const pdfjsLib = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const loadingTask = pdfjsLib.getDocument({ data: new Uint8Array(buffer) });
  const pdf = await loadingTask.promise;
  const numPages = pdf.numPages;
  let fullText = '';

  for (let i = 1; i <= numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    const pageText = content.items.map(item => item.str).join(' ');
    fullText += pageText + '\n';
  }

  return { text: fullText, numpages: numPages };
};

const worker = new Worker('document-processing', async (job) => {
  const { documentId, s3Key } = job.data;
  console.log(`Processing document: ${documentId}`);

  try {
    await updateDocumentStatus(documentId, 'PROCESSING');

    const command = new GetObjectCommand({ Bucket: env.S3_BUCKET_NAME, Key: s3Key });
    const s3Response = await s3.send(command);
    const buffer = await streamToBuffer(s3Response.Body);

    const { text, numpages } = await extractTextFromPDF(buffer);

    const chunks = chunkText(text);
    console.log(`Created ${chunks.length} chunks`);

    await storeChunks(documentId, chunks);
    console.log(`Embeddings stored`);

    await updateDocumentStatus(documentId, 'READY', numpages);
    console.log(`Document ${documentId} ready`);

  } catch (err) {
    console.error(`Failed to process document ${documentId}:`, err.message);
    await updateDocumentStatus(documentId, 'FAILED');
    throw err;
  }
}, { connection: bullRedis, concurrency: 2 });

worker.on('completed', (job) => console.log(`Job ${job.id} completed`));
worker.on('failed', (job, err) => console.error(`Job ${job.id} failed:`, err.message));

console.log('Document worker started');
