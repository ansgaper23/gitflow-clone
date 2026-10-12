const { Client } = require('ssh2');
const fs = require('fs');
const path = require('path');

const conn = new Client();

const backendBase = path.join(__dirname, 'src');
const infraBase = path.join(__dirname, '../infra/preview-orchestrator');

const filesToUpload = [
  { local: path.join(backendBase, 'services/dependencyAutoInjector.js'), remote: '/opt/gitflow-app/backend/src/services/dependencyAutoInjector.js' },
  { local: path.join(backendBase, 'services/runtimeBus.js'), remote: '/opt/gitflow-app/backend/src/services/runtimeBus.js' },
  { local: path.join(backendBase, 'services/agent.js'), remote: '/opt/gitflow-app/backend/src/services/agent.js' },
  { local: path.join(backendBase, 'routes/projects.js'), remote: '/opt/gitflow-app/backend/src/routes/projects.js' },
  { local: path.join(backendBase, 'routes/preview.js'), remote: '/opt/gitflow-app/backend/src/routes/preview.js' },
  { local: path.join(backendBase, 'index.js'), remote: '/opt/gitflow-app/backend/src/index.js' },
  { local: path.join(infraBase, 'server.mjs'), remote: '/opt/gitflow-previews/orchestrator/server.mjs' }
];

conn.on('ready', () => {
  console.log('SSH connection ready');
  conn.sftp((err, sftp) => {
    if (err) throw err;

    let idx = 0;
    function uploadNext() {
      if (idx >= filesToUpload.length) {
        console.log('All backend & orchestrator files uploaded successfully!');
        // Execute restart detached
        conn.exec('systemctl restart gitflow-preview gitflow-backend < /dev/null > /tmp/restart.log 2>&1', (errExec, stream) => {
          if (errExec) throw errExec;
          stream.on('close', (code) => {
            console.log(`Services restart triggered with code: ${code}`);
            conn.end();
          });
        });
        return;
      }

      const item = filesToUpload[idx++];
      console.log(`Uploading ${path.basename(item.local)} -> ${item.remote}`);
      const content = fs.readFileSync(item.local);
      sftp.writeFile(item.remote, content, (errWrite) => {
        if (errWrite) throw errWrite;
        uploadNext();
      });
    }

    uploadNext();
  });
}).connect({ host: '130.51.22.140', port: 22, username: 'root', password: '9d572xbYOM1BwvX' });
