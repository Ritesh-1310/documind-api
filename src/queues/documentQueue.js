const { Queue } = require('bullmq');
const { bullRedis } = require('../config/redis');

const documentQueue = new Queue('document-processing', {
  connection: bullRedis,
});

const addDocumentJob = (data) =>
  documentQueue.add('process-document', data, {
    attempts: 3,
    backoff: { type: 'exponential', delay: 2000 },
  });

module.exports = { documentQueue, addDocumentJob };
