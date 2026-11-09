const { execFileSync } = require('node:child_process');
const path = require('node:path');

// Fail packaging if a nested helper is unsigned or signed by a different team.
module.exports = async function verifyMacSigning(context) {
  if (context.electronPlatformName !== 'darwin') return;
  const app = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
  const daemon = path.join(app, 'Contents/Resources/daemon/fit');
  let appTeam;
  for (const target of [app, daemon]) {
    execFileSync('codesign', ['--verify', '--deep', '--strict', target], { stdio: 'inherit' });
    // codesign prints signature details on stderr.
    const { spawnSync } = require('node:child_process');
    const result = spawnSync('codesign', ['--display', '--verbose=4', target], { encoding: 'utf8' });
    if (result.status !== 0) throw new Error(`Cannot inspect signature: ${target}`);
    const team = result.stderr.match(/^TeamIdentifier=(.+)$/m)?.[1];
    if (!team || team === 'not set' || !result.stderr.includes('Authority=Developer ID Application:')) {
      throw new Error(`Developer ID Application signing is required: ${target}`);
    }
    if (appTeam && team !== appTeam) throw new Error('App and daemon must have the same signing team');
    appTeam = team;
  }
};
