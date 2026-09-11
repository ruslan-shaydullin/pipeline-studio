import { spawn } from 'node:child_process';
import { localPorts } from '../lib/local-config.mjs';
const ports = localPorts();
const children = [
  ...(!process.argv.includes('--web-only')
    ? [spawn(process.execPath, ['server/index.mjs'], { stdio: 'inherit' })]
    : []),
  spawn(
    process.execPath,
    ['node_modules/vinext/dist/cli.js', 'dev', '--port', String(ports.web)],
    {
      stdio: 'inherit',
    },
  ),
];
let closing = false;
function close(code = 0) {
  if (closing) return;
  closing = true;
  for (const child of children) child.kill('SIGTERM');
  setTimeout(() => process.exit(code), 500);
}
children.forEach((child) => {
  child.on('error', (error) => {
    console.error(error.message);
    close(1);
  });
  child.on('exit', (code) => close(code || 0));
});
process.on('SIGINT', () => close());
process.on('SIGTERM', () => close());
