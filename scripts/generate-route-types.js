// Regenerates .expo/types/router.d.ts (expo-router typed routes) WITHOUT starting Metro.
// `expo start` normally writes this file; run this after adding/removing a route file so
// `tsc --noEmit` knows the new hrefs:  node scripts/generate-route-types.js
// Uses the same generator as @expo/cli (via its bundled @expo/router-server).
/* global __dirname */
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
process.env.EXPO_ROUTER_APP_ROOT = path.join(root, 'src', 'app');

const cliDir = path.dirname(require.resolve('@expo/cli/package.json', { paths: [require.resolve('expo/package.json')] }));
const routerServer = path.dirname(require.resolve('@expo/router-server/package.json', { paths: [cliDir] }));
const { getTypedRoutesDeclarationFile } = require(path.join(routerServer, 'build', 'typed-routes', 'generate'));
const { requireContext } = require(require.resolve('expo-router/internal/testing', { paths: [routerServer] }));
const { EXPO_ROUTER_CTX_IGNORE } = require(require.resolve('expo-router/_ctx-shared', { paths: [routerServer] }));

const ctx = requireContext(process.env.EXPO_ROUTER_APP_ROOT, true, EXPO_ROUTER_CTX_IGNORE);
const file = getTypedRoutesDeclarationFile(ctx, {});
if (!file) throw new Error('typed routes: generator returned nothing');
const out = path.join(root, '.expo', 'types', 'router.d.ts');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, file);
console.log('wrote .expo/types/router.d.ts');
