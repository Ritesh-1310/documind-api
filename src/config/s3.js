const { S3Client } = require('@aws-sdk/client-s3');
const env = require('./env');

const s3 = new S3Client({
  region: env.AWS_REGION,
  endpoint: env.S3_ENDPOINT || undefined,
  forcePathStyle: !!env.S3_ENDPOINT,
  credentials: {
    accessKeyId: env.AWS_ACCESS_KEY_ID,
    secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
  },
});

module.exports = s3;
