const { queryDocumentService } = require('./query.service');

const queryDocument = async (req, res, next) => {
  try {
    const { document_id, question } = req.body;

    if (!document_id || !question) {
      return res.status(400).json({
        success: false,
        message: 'document_id and question are required',
      });
    }

    const result = await queryDocumentService(req.user.id, document_id, question);
    res.json({ success: true, ...result });
  } catch (err) {
    next(err);
  }
};

module.exports = { queryDocument };
