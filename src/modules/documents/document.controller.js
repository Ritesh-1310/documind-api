const multer = require('multer');
const { uploadDocumentService, getDocumentsService, getDocumentStatusService, deleteDocumentService } = require('./document.service');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'application/pdf') cb(null, true);
    else cb(new Error('Only PDF files are allowed'));
  },
});

const uploadDocument = async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ success: false, message: 'No file uploaded' });
    const document = await uploadDocumentService(req.user.id, req.file);
    res.status(201).json({ success: true, document });
  } catch (err) { next(err); }
};

const getDocuments = async (req, res, next) => {
  try {
    const documents = await getDocumentsService(req.user.id);
    res.json({ success: true, documents });
  } catch (err) { next(err); }
};

const getDocumentStatus = async (req, res, next) => {
  try {
    const document = await getDocumentStatusService(req.params.id, req.user.id);
    if (!document) return res.status(404).json({ success: false, message: 'Document not found' });
    res.json({ success: true, document });
  } catch (err) { next(err); }
};

const deleteDocument = async (req, res, next) => {
  try {
    await deleteDocumentService(req.params.id, req.user.id);
    res.json({ success: true, message: 'Document deleted' });
  } catch (err) { next(err); }
};

module.exports = { upload, uploadDocument, getDocuments, getDocumentStatus, deleteDocument };
