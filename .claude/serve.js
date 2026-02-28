// Launcher shim for the Claude preview tool.
// Starts the electron-vite dev server as a child process and keeps alive.
const { spawn } = require('child_process')
const path = require('path')

const root = path.resolve(__dirname, '..')

const child = spawn('npm', ['run', 'dev'], {
  cwd: root,
  stdio: 'inherit',
  shell: true,   // required on Windows so npm resolves correctly
})

child.on('exit', (code) => process.exit(code ?? 0))
process.on('SIGTERM', () => child.kill())
process.on('SIGINT',  () => child.kill())
