const prisma = require('../../config/db');

const createDocument = (userId, filename, s3Key) =>
  prisma.document.create({
    data: { userId, filename, s3Key },
  });

const getDocumentsByUser = (userId) =>
  prisma.document.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    select: { id: true, filename: true, status: true, pageCount: true, createdAt: true },
  });

const getDocumentById = (id, userId) =>
  prisma.document.findFirst({ where: { id, userId } });

const updateDocumentStatus = (id, status, pageCount = null) =>
  prisma.document.update({
    where: { id },
    data: { status, ...(pageCount && { pageCount }) },
  });

const deleteDocumentById = (id, userId) =>
  prisma.document.delete({ where: { id, userId } });

module.exports = { createDocument, getDocumentsByUser, getDocumentById, updateDocumentStatus, deleteDocumentById };
