#!/bin/sh
set -eu

command -v node >/dev/null
command -v curl >/dev/null
node -e 'if (Number(process.versions.node.split(".")[0]) < 20) throw new Error("Node.js 20+ required")'

install_tmp=$(mktemp -d)
trap 'rm -rf "$install_tmp"' EXIT
curl -fsSL https://raw.githubusercontent.com/Shimada666/agy-powerline/main/statusline.js \
  -o "$install_tmp/statusline.js"
node --check "$install_tmp/statusline.js"

node - "$install_tmp/statusline.js" <<'NODE'
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

const scriptPath = path.join(os.homedir(), '.agy-powerline', 'statusline.js');
const settingsPath = path.join(os.homedir(), '.gemini', 'antigravity-cli', 'settings.json');
const exists = fs.existsSync(settingsPath);
const original = exists ? fs.readFileSync(settingsPath, 'utf8') : null;
const settings = exists ? JSON.parse(original) : {};
if (settings === null || Array.isArray(settings) || typeof settings !== 'object') {
  throw new Error('agy settings.json must contain a JSON object');
}
const quote = value => "'" + value.replace(/'/g, "'\\''") + "'";
const statusLine = {
  type: 'command',
  command: `${quote(process.execPath)} ${quote(scriptPath)}`,
  stack_with_default: true,
};
const backupSuffix = `.bak-${Date.now()}-${crypto.randomUUID()}`;
fs.mkdirSync(path.dirname(scriptPath), { recursive: true, mode: 0o700 });
fs.mkdirSync(path.dirname(settingsPath), { recursive: true, mode: 0o700 });
if (exists) {
  fs.writeFileSync(settingsPath + backupSuffix, original, { mode: 0o600, flag: 'wx' });
  console.log(`Settings backup: ${settingsPath + backupSuffix}`);
}
if (fs.existsSync(scriptPath)) {
  fs.copyFileSync(scriptPath, scriptPath + backupSuffix, fs.constants.COPYFILE_EXCL);
}
const stagedScript = scriptPath + '.tmp-' + crypto.randomUUID();
fs.copyFileSync(process.argv[2], stagedScript, fs.constants.COPYFILE_EXCL);
fs.chmodSync(stagedScript, 0o755);
fs.renameSync(stagedScript, scriptPath);
settings.statusLine = statusLine;
const stagedSettings = settingsPath + '.tmp-' + crypto.randomUUID();
fs.writeFileSync(stagedSettings, JSON.stringify(settings, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
fs.renameSync(stagedSettings, settingsPath);
console.log('agy-powerline installed. Restart agy to activate.');
NODE
