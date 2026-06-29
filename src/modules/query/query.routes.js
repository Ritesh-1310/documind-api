const express = require('express');
const router = express.Router();
const auth = require('../../middleware/auth');
const rateLimiter = require('../../middleware/rateLimiter');
const { queryDocument } = require('./query.controller');

router.post('/', auth, rateLimiter(20, 60), queryDocument);

module.exports = router;