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
