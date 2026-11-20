/** Published npm CLI — https://www.npmjs.com/package/rulecloud */

export const NPM_PACKAGE_NAME = "rulecloud";

/** One-shot init (no global install). */
export const NPX_INIT = `npx ${NPM_PACKAGE_NAME} init`;

/** Live HUD in the repo root. */
export const NPX_WATCH = `npx ${NPM_PACKAGE_NAME} watch`;

/** Copy-paste block for integrations / docs. */
export const CLI_QUICKSTART = `# npm install ${NPM_PACKAGE_NAME}  (optional global install)
export RULECLOUD_API_KEY=rc_live_YOUR_KEY

${NPX_INIT}
${NPX_WATCH}`;