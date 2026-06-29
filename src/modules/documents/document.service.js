const { createDocument, getDocumentsByUser, getDocumentById, deleteDocumentById } = require('./document.model');
const { PutObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');
const s3 = require('../../config/s3');
const { addDocumentJob } = require('../../queues/documentQueue');
const env = require('../../config/env');
const { v4: uuidv4 } = require('uuid');

const uploadDocumentService = async (userId, file) => {
  const s3Key = `documents/${userId}/${uuidv4()}-${file.originalname}`;

  await s3.send(new PutObjectCommand({
    Bucket: env.S3_BUCKET_NAME,
    Key: s3Key,
    Body: file.buffer,
    ContentType: file.mimetype,
  }));

  const document = await createDocument(userId, file.originalname, s3Key);
  await addDocumentJob({ documentId: document.id, s3Key });

  return document;
};

const getDocumentsService = (userId) => getDocumentsByUser(userId);

const getDocumentStatusService = (id, userId) => getDocumentById(id, userId);

const deleteDocumentService = async (id, userId) => {
  const doc = await getDocumentById(id, userId);
  if (!doc) {
    const err = new Error('Document not found');
    err.status = 404;
    throw err;
  }

  await s3.send(new DeleteObjectCommand({
    Bucket: env.S3_BUCKET_NAME,
    Key: doc.s3Key,
  }));

  return deleteDocumentById(id, userId);
};

module.exports = { uploadDocumentService, getDocumentsService, getDocumentStatusService, deleteDocumentService };
