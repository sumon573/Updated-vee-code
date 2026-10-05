const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');
const fs = require('fs');

const projectRoot = __dirname;

const config = getDefaultConfig(projectRoot);

// ── Monorepo support (optional) ──────────────────────────────────────────────
// When the project lives inside a pnpm/yarn workspace (e.g. during local
// development on Replit), extend watchFolders and nodeModulesPaths so Metro
// can resolve packages hoisted to the workspace root.
//
// When the project is built as a standalone ZIP on EAS, the parent directory
// has no node_modules, so we only add it when it actually exists — otherwise
// the monorepo paths are silently omitted and Metro resolves everything from
// the project's own node_modules.
const workspaceRoot = path.resolve(projectRoot, '..');
const workspaceNodeModules = path.resolve(workspaceRoot, 'node_modules');

if (fs.existsSync(workspaceNodeModules)) {
  config.watchFolders = [workspaceRoot];
  config.resolver.nodeModulesPaths = [
    path.resolve(projectRoot, 'node_modules'),
    workspaceNodeModules,
  ];
} else {
  config.resolver.nodeModulesPaths = [
    path.resolve(projectRoot, 'node_modules'),
  ];
}

// Replit: cap workers to avoid OOM in the containerised environment.
config.maxWorkers = 2;

module.exports = config;
