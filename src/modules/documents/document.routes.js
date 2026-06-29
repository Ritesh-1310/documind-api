const express = require('express');
const router = express.Router();
const auth = require('../../middleware/auth');
const rateLimiter = require('../../middleware/rateLimiter');
const { upload, uploadDocument, getDocuments, getDocumentStatus, deleteDocument } = require('./document.controller');

router.post('/upload', auth, rateLimiter(10, 60), upload.single('file'), uploadDocument);
router.get('/', auth, getDocuments);
router.get('/:id/status', auth, getDocumentStatus);
router.delete('/:id', auth, deleteDocument);

module.exports = router;