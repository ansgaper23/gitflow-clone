import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const versionCache = new Map();

const BUILT_IN_NODE_MODULES = new Set([
  'assert', 'async_hooks', 'buffer', 'child_process', 'cluster', 'console',
  'constants', 'crypto', 'dgram', 'dns', 'domain', 'events', 'fs', 'http',
  'http2', 'https', 'inspector', 'module', 'net', 'os', 'path', 'perf_hooks',
  'process', 'punycode', 'querystring', 'readline', 'repl', 'stream',
  'string_decoder', 'timers', 'tls', 'trace_events', 'tty', 'url', 'util',
  'v8', 'vm', 'wasi', 'worker_threads', 'zlib',
  'react', 'react-dom', 'react/jsx-runtime' // Pre-incluidos en templates
]);

/**
 * Normaliza un import specifier a nombre de paquete de npm.
 * '@scope/pkg/sub' -> '@scope/pkg'
 * 'pkg/sub' -> 'pkg'
 */
export function normalizePackageName(spec) {
  if (!spec || typeof spec !== 'string') return null;
  const s = spec.trim();
  if (s.startsWith('.') || s.startsWith('/') || s.startsWith('@/') || s.startsWith('~/')) return null;
  if (s.startsWith('http:') || s.startsWith('https:') || s.startsWith('data:') || s.startsWith('blob:')) return null;
  if (s.startsWith('node:')) return null;

  if (s.startsWith('@')) {
    const parts = s.split('/');
    if (parts.length >= 2) {
      const pkg = `${parts[0]}/${parts[1]}`;
      return BUILT_IN_NODE_MODULES.has(pkg) ? null : pkg;
    }
    return null;
  }

  const pkg = s.split('/')[0];
  if (BUILT_IN_NODE_MODULES.has(pkg)) return null;
  return pkg;
}

/**
 * Extrae todas las dependencias externas (bare imports) de los archivos JS/TS/JSX/TSX.
 */
export function detectMissingDependencies(filesMap, packageJsonContent) {
  let pkg = {};
  try {
    pkg = typeof packageJsonContent === 'string' ? JSON.parse(packageJsonContent) : (packageJsonContent || {});
  } catch {
    pkg = {};
  }

  const existingDeps = new Set([
    ...Object.keys(pkg.dependencies || {}),
    ...Object.keys(pkg.devDependencies || {}),
    ...Object.keys(pkg.peerDependencies || {})
  ]);

  const neededPkgs = new Set();
  const importRegex = /(?:import|export)\s+(?:[\w*\s{},]*\s+from\s+)?['"]([^'"]+)['"]/g;
  const dynamicRegex = /(?:import|require)\s*\(\s*['"]([^'"]+)['"]\s*\)/g;

  for (const [filePath, fileObj] of Object.entries(filesMap || {})) {
    if (!/\.(jsx?|tsx?|vue|svelte|mjs|cjs)$/i.test(filePath)) continue;
    const content = typeof fileObj === 'string' ? fileObj : (fileObj?.content || '');
    if (!content) continue;

    let match;
    while ((match = importRegex.exec(content)) !== null) {
      const pkgName = normalizePackageName(match[1]);
      if (pkgName && !existingDeps.has(pkgName)) neededPkgs.add(pkgName);
    }
    while ((match = dynamicRegex.exec(content)) !== null) {
      const pkgName = normalizePackageName(match[1]);
      if (pkgName && !existingDeps.has(pkgName)) neededPkgs.add(pkgName);
    }
  }

  return Array.from(neededPkgs);
}

/**
 * Resuelve la versión de un paquete npm usando cache, npm registry HTTP o npm view.
 */
export async function resolvePackageVersion(pkg) {
  if (versionCache.has(pkg)) return versionCache.get(pkg);

  // Soporte de GitHub repos (user/repo o github:user/repo o git+https)
  if (typeof pkg === 'string') {
    if (pkg.startsWith('github:') || pkg.startsWith('git+') || pkg.startsWith('http://') || pkg.startsWith('https://')) {
      versionCache.set(pkg, pkg);
      return pkg;
    }
    // Si tiene formato 'user/repo' y no es scoped package '@scope/pkg'
    if (pkg.includes('/') && !pkg.startsWith('@')) {
      versionCache.set(pkg, pkg);
      return pkg;
    }
  }

  // 1. HTTP rápido al registro de npm (sin subprocess)
  try {
    const res = await fetch(`https://registry.npmjs.org/${encodeURIComponent(pkg)}/latest`, {
      signal: AbortSignal.timeout(2000)
    });
    if (res.ok) {
      const data = await res.json();
      if (data?.version) {
        const ver = `^${data.version}`;
        versionCache.set(pkg, ver);
        return ver;
      }
    }
  } catch (_) {}

  // 2. npm view <pkg> version
  try {
    const { stdout } = await execFileAsync('npm', ['view', pkg, 'version'], { timeout: 3500 });
    const trimmed = stdout.trim();
    if (trimmed) {
      const ver = `^${trimmed}`;
      versionCache.set(pkg, ver);
      return ver;
    }
  } catch (_) {}

  versionCache.set(pkg, 'latest');
  return 'latest';
}

/**
 * Auto-inyecta dependencias faltantes en package.json y actualiza stagedContent y proposedChanges.
 */
export async function autoInjectDependencies(stagedContent, proposedChanges, existingPackageJsonContent) {
  // Construir mapa de archivos para detectMissingDependencies
  const filesMap = {};
  for (const [p, c] of stagedContent.entries()) {
    filesMap[p] = { content: c };
  }

  const pkgContent = stagedContent.get('package.json') || existingPackageJsonContent || '{"dependencies":{}}';
  const missing = detectMissingDependencies(filesMap, pkgContent);

  if (missing.length === 0) return null;

  let pkg = {};
  try {
    pkg = JSON.parse(pkgContent);
  } catch {
    pkg = { name: 'app', dependencies: {}, devDependencies: {} };
  }

  pkg.dependencies = pkg.dependencies || {};

  for (const p of missing) {
    const ver = await resolvePackageVersion(p);
    pkg.dependencies[p] = ver;
  }

  const updatedPkgContent = JSON.stringify(pkg, null, 2) + '\n';
  stagedContent.set('package.json', updatedPkgContent);

  const existingIdx = proposedChanges.findIndex(c => c.path === 'package.json');
  const summaryMsg = `Auto-dependencias añadidas: ${missing.join(', ')}`;
  if (existingIdx >= 0) {
    proposedChanges[existingIdx].newContent = updatedPkgContent;
    proposedChanges[existingIdx].summary = summaryMsg;
  } else {
    proposedChanges.push({
      path: 'package.json',
      originalContent: pkgContent,
      newContent: updatedPkgContent,
      summary: summaryMsg,
    });
  }

  console.log(`Auto-dependencias añadidas: ${missing.join(', ')}`);
  return { missing, updatedPkgContent };
}
