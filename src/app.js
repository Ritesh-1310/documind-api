require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');

const authRoutes = require('./modules/auth/auth.routes');
const documentRoutes = require('./modules/documents/document.routes');
const queryRoutes = require('./modules/query/query.routes');
const errorHandler = require('./middleware/errorHandler');
const env = require('./config/env');

const app = express();

app.use(helmet());
app.use(cors({
  origin: process.env.CLIENT_URL || '*',
  credentials: true
}));
// app.use(morgan('dev'));
app.use(morgan('combined'));
app.use(express.json());

app.get('/', (req, res) => {
  res.json({
    name: 'DocuMind API',
    description: 'Production-ready RAG pipeline — upload PDFs, query them with AI',
    version: '1.0.0',
    status: 'live',
    github: 'https://github.com/Ritesh-1310/documind-api',
    endpoints: {
      auth: {
        register: 'POST /api/auth/register',
        login: 'POST /api/auth/login',
      },
      documents: {
        upload: 'POST /api/documents/upload',
        list: 'GET /api/documents',
        status: 'GET /api/documents/:id/status',
        delete: 'DELETE /api/documents/:id',
      },
      query: {
        ask: 'POST /api/query',
      },
      health: 'GET /health',
    },
    stack: [
      'Node.js', 'Express', 'PostgreSQL', 'pgvector',
      'Redis', 'BullMQ', 'AWS S3', 'Cohere', 'Groq/LLaMA 3.3', 'Docker', 'Nginx'
    ],
    author: 'Ritesh Ranjan',
    deployed_on: 'AWS EC2 (ap-south-1)',
  });
});

app.get('/health', (req, res) => res.json({ status: 'ok' }));

app.use('/api/auth', authRoutes);
app.use('/api/documents', documentRoutes);
app.use('/api/query', queryRoutes);

app.use(errorHandler);

const PORT = process.env.PORT || env.PORT || 3000;

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Server running on port ${PORT}`);
});

module.exports = app;
