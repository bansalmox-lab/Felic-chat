const { spawn } = require('child_process');
const path = require('path');

console.log('Spawning Electron. Current ELECTRON_RUN_AS_NODE:', process.env.ELECTRON_RUN_AS_NODE);
delete process.env.ELECTRON_RUN_AS_NODE;
console.log('After delete ELECTRON_RUN_AS_NODE:', process.env.ELECTRON_RUN_AS_NODE);

const electronPath = require('electron'); // gets the path to the executable
const child = spawn(electronPath, ['.'], { stdio: 'inherit' });

child.on('close', (code) => {
  process.exit(code);
});
