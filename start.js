const { spawn } = require('child_process');

const api = spawn('node', ['src/app.js'], { stdio: 'inherit' });
const worker = spawn('node', ['src/workers/documentWorker.js'], { stdio: 'inherit' });

api.on('exit', (code) => {
  console.error('API process exited with code:', code);
  process.exit(1);
});

worker.on('exit', (code) => {
  console.error('Worker process exited with code:', code);
  process.exit(1);
});

console.log('Started API and Worker processes');
