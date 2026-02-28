// Launcher shim for the Claude preview tool.
// Serves only the renderer via plain Vite (no Electron) so the React UI
// can be previewed in the browser using bridge.ts mock stubs.
const { spawn } = require('child_process')
const path = require('path')

const root = path.resolve(__dirname, '..')

const child = spawn(
  'npx',
  ['vite', '--config', 'vite.renderer.only.config.mjs'],
  {
    cwd: root,
    stdio: 'inherit',
    shell: true,
  }
)

child.on('exit', (code) => process.exit(code ?? 0))
process.on('SIGTERM', () => child.kill())
process.on('SIGINT',  () => child.kill())
