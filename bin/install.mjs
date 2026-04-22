#!/usr/bin/env node

import https from 'node:https';
import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, readdirSync, copyFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { resolve, dirname, win32 } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir, tmpdir } from 'node:os';

const __dir = dirname(fileURLToPath(import.meta.url));

export function copyDirMerge(src, dest, { overwrite = false } = {}) {
  mkdirSync(dest, { recursive: true });
  for (const entry of readdirSync(src, { withFileTypes: true })) {
    const srcPath = resolve(src, entry.name);
    const destPath = resolve(dest, entry.name);
    if (entry.isDirectory()) {
      copyDirMerge(srcPath, destPath, { overwrite });
    } else if (overwrite || !existsSync(destPath)) {
      copyFileSync(srcPath, destPath);
    }
  }
}

export function getInstalledVersion(binName) {
  try {
    const output = execSync(`${binName} --version`, { encoding: 'utf8', timeout: 5000 }).trim();
    const match = output.match(/(\d+\.\d+\.\d+)/);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}

export function httpsGetJson(url, redirects = 0) {
  if (redirects > 5) return Promise.reject(new Error(`Too many redirects fetching ${url}`));
  return new Promise((resolve, reject) => {
    const opts = { headers: { 'User-Agent': 'installer' } };
    https.get(url, opts, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return httpsGetJson(res.headers.location, redirects + 1).then(resolve, reject);
      }
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        if (res.statusCode >= 400) {
          reject(new Error(`HTTP ${res.statusCode} from ${url}: ${data.slice(0, 200)}`));
          return;
        }
        resolve(JSON.parse(data));
      });
      res.on('error', reject);
    }).on('error', reject);
  });
}

export function getPlatformPaths() {
  const isWin = process.platform === 'win32';
  if (isWin) {
    return {
      dataDir: win32.join(process.env.LOCALAPPDATA, 'installer'),
      configDir: win32.join(process.env.APPDATA, 'installer'),
      binDir: win32.join(process.env.LOCALAPPDATA, 'installer', 'bin'),
    };
  }
  return {
    dataDir: resolve(homedir(), '.local', 'share', 'installer'),
    configDir: resolve(homedir(), '.config', 'installer'),
    binDir: resolve(homedir(), '.local', 'bin'),
  };
}

const TARGET_MAP = {
  linux:  { x64: { key: 'linux-x86_64' } },
  darwin: {
    arm64: { key: 'darwin-arm64' },
    x64:   { key: 'darwin-x86_64' },
  },
  win32: {
    x64: { key: 'win32-x64' },
  },
};

export function detectTarget() {
  const entry = TARGET_MAP[process.platform]?.[process.arch];
  if (!entry) return null;
  const { binDir } = getPlatformPaths();
  return { ...entry, installDir: binDir };
}

export const REGISTRY = {
  'tokf': {
    platforms: ['linux-x86_64', 'darwin-arm64', 'darwin-x86_64'],
    githubRelease: {
      repo: 'mpecan/tokf',
      tagPrefix: 'tokf-v',
      targets: {
        'linux-x86_64': 'x86_64-unknown-linux-gnu',
        'darwin-arm64': 'aarch64-apple-darwin',
        'darwin-x86_64': 'x86_64-apple-darwin',
      },
      binName: 'tokf',
    },
    postInstall: ['tokf hook install --global'],
  },
  'codebase-memory': {
    binName: 'codebase-memory-mcp',
    latestVersionRepo: 'DeusData/codebase-memory-mcp',
    install: {
      unix: 'curl -fsSL https://raw.githubusercontent.com/DeusData/codebase-memory-mcp/main/install.sh | bash -s -- --ui',
      win32: [
        'Invoke-WebRequest -Uri https://raw.githubusercontent.com/DeusData/codebase-memory-mcp/main/install.ps1 -OutFile $env:TEMP\\install-codebase-memory.ps1',
        '& $env:TEMP\\install-codebase-memory.ps1 -UI',
      ],
    },
    postInstall: [
      'codebase-memory-mcp config set auto_index true',
      'codebase-memory-mcp config set auto_index_limit 50000',
    ],
  },
  'context7': {
    mcpEntry: {
      command: 'npx',
      args: ['-y', '@upstash/context7-mcp'],
      env: {
        CONTEXT7_API_KEY: '${CONTEXT7_API_KEY}',
      },
    },
  },
};

export function detectPlatform() {
  return process.platform === 'win32' ? 'win32' : 'unix';
}

export async function installFromGithubRelease(name, ghConfig) {
  const target = detectTarget();
  if (!target) {
    console.log(`  Skipping ${name}: unsupported platform ${process.platform}/${process.arch}`);
    return false;
  }

  const ghTarget = ghConfig.targets[target.key];
  if (!ghTarget) {
    console.log(`  Skipping ${name}: no build for ${target.key}`);
    return false;
  }

  console.log(`\nInstalling ${name}...`);

  // 1. Resolve latest release
  const releases = await httpsGetJson(
    `https://api.github.com/repos/${ghConfig.repo}/releases`
  );
  const release = releases.find(r => r.tag_name.startsWith(ghConfig.tagPrefix));
  if (!release) throw new Error(`No release found matching prefix "${ghConfig.tagPrefix}"`);

  const tag = release.tag_name;

  // Version check — skip if already up to date
  const latestVersion = tag.replace(ghConfig.tagPrefix, '');
  const bin = typeof ghConfig.binName === 'string'
    ? ghConfig.binName
    : (process.platform === 'win32' ? ghConfig.binName.win32 : ghConfig.binName.unix);
  const installed = getInstalledVersion(bin);
  if (installed && installed === latestVersion) {
    console.log(`  ${name} ${installed} is up to date`);
    return true;
  }

  const ext = process.platform === 'win32' ? '.zip' : '.tar.gz';
  const assetName = ghConfig.assetNameFn
    ? ghConfig.assetNameFn(tag, ghTarget, ext)
    : `${tag}-${ghTarget}${ext}`;
  const asset = release.assets.find(a => a.name === assetName);
  if (!asset) throw new Error(`Asset "${assetName}" not found in release ${tag}`);

  // 2. Download to temp dir
  const installDir = target.installDir;
  const tmpDir = mkdtempSync(resolve(tmpdir(), 'installer-install-'));
  const tarball = resolve(tmpDir, assetName);

  execSync(`curl -fsSL -o "${tarball}" "${asset.browser_download_url}"`, {
    stdio: 'inherit', shell: '/bin/bash',
  });

  // 3. Verify SHA256 checksum
  const shaAsset = release.assets.find(a => a.name === `${assetName}.sha256`);
  if (shaAsset) {
    execSync(`curl -fsSL -o "${tarball}.sha256" "${shaAsset.browser_download_url}"`, {
      stdio: 'inherit', shell: '/bin/bash',
    });
    const shaRaw = readFileSync(`${tarball}.sha256`, 'utf8').trim();
    const shaLine = shaRaw.includes('  ') ? shaRaw : `${shaRaw}  ${assetName}`;
    writeFileSync(`${tarball}.sha256`, shaLine + '\n');
    execSync(`cd "${tmpDir}" && shasum -a 256 -c "${tarball}.sha256"`, {
      stdio: 'inherit', shell: '/bin/bash',
    });
    console.log(`  Checksum verified.`);
  } else {
    console.log(`  Warning: no .sha256 asset found, skipping verification.`);
  }

  // 4. Extract and install
  mkdirSync(installDir, { recursive: true });
  if (assetName.endsWith('.zip')) {
    execSync(
      `powershell -Command "Expand-Archive -Path '${tarball}' -DestinationPath '${tmpDir}' -Force"`,
      { stdio: 'inherit', shell: 'powershell.exe' },
    );
    const binSrc = resolve(tmpDir, ghConfig.binName);
    execSync(`copy "${binSrc}" "${resolve(installDir, ghConfig.binName)}"`, {
      stdio: 'inherit', shell: 'cmd.exe',
    });
  } else {
    execSync(`tar xzf "${tarball}" -C "${installDir}" "./${ghConfig.binName}" 2>/dev/null || tar xzf "${tarball}" -C "${installDir}" ${ghConfig.binName}`, {
      stdio: 'inherit', shell: '/bin/bash',
    });
    execSync(`chmod +x "${installDir}/${ghConfig.binName}"`);
  }
  rmSync(tmpDir, { recursive: true });

  // 5. Warn if install dir not on PATH
  const pathSep = process.platform === 'win32' ? ';' : ':';
  const pathDirs = (process.env.PATH || '').split(pathSep);
  if (!pathDirs.includes(installDir)) {
    console.log(`  Warning: ${installDir} is not on your PATH. Add it to your shell profile.`);
  }

  console.log(`  ${name} ${tag} installed to ${installDir}`);
  return true;
}

export async function installBinary(name, server) {
  if (server.githubRelease) {
    return installFromGithubRelease(name, server.githubRelease);
  }
  // Version check for script-installed binaries
  if (server.binName && server.latestVersionRepo) {
    const installed = getInstalledVersion(server.binName);
    if (installed) {
      const releases = await httpsGetJson(
        `https://api.github.com/repos/${server.latestVersionRepo}/releases/latest`
      );
      const latest = releases.tag_name.replace(/^v/, '');
      if (installed === latest) {
        console.log(`\n  ${name} ${installed} is up to date`);
        return true;
      }
    }
  }
  const platform = detectPlatform();
  const cmds = server.install?.[platform];
  if (!cmds) {
    console.log(`  Skipping ${name}: no install commands for ${platform}`);
    return false;
  }
  console.log(`\nInstalling ${name}...`);
  if (Array.isArray(cmds)) {
    for (const cmd of cmds) {
      execSync(cmd, { stdio: 'inherit', shell: 'powershell.exe' });
    }
  } else {
    execSync(cmds, { stdio: 'inherit', shell: '/bin/bash' });
  }
  console.log(`  Binary installed.`);
  return true;
}

export function runPostInstall(name, server) {
  const pi = server.postInstall;
  if (!pi) return;
  const cmds = Array.isArray(pi) ? pi : null;
  if (!cmds?.length) return;

  // Back up settings.json before postInstall (tokf hook install --global may overwrite PreToolUse)
  const settingsPath = resolve(homedir(), '.claude', 'settings.json');
  let settingsBefore = null;
  if (existsSync(settingsPath)) {
    settingsBefore = JSON.parse(readFileSync(settingsPath, 'utf8'));
  }

  console.log(`Configuring ${name}...`);
  for (const cmd of cmds) {
    execSync(cmd, { stdio: 'inherit' });
  }

  // Restore any PreToolUse hooks that tokf may have overwritten
  if (settingsBefore?.hooks?.PreToolUse && existsSync(settingsPath)) {
    const settingsAfter = JSON.parse(readFileSync(settingsPath, 'utf8'));
    const beforeEntries = settingsBefore.hooks.PreToolUse;
    const afterEntries = settingsAfter.hooks?.PreToolUse || [];
    const afterMatchers = new Set(afterEntries.map(e => e.matcher));
    const merged = [
      ...afterEntries,
      ...beforeEntries.filter(e => !afterMatchers.has(e.matcher)),
    ];
    settingsAfter.hooks ??= {};
    settingsAfter.hooks.PreToolUse = merged;
    writeFileSync(settingsPath, JSON.stringify(settingsAfter, null, 2) + '\n');
    if (merged.length > afterEntries.length) {
      console.log(`  Restored ${merged.length - afterEntries.length} existing PreToolUse hook(s).`);
    }
  }

  console.log(`  Configuration applied.`);
}

function resolveEnvPlaceholders(env, envOverrides) {
  const resolved = { ...env };
  for (const k of Object.keys(resolved)) {
    const v = resolved[k];
    const m = typeof v === 'string' && v.match(/^\$\{([A-Z_][A-Z0-9_]*)\}$/);
    if (m) {
      const val = envOverrides[m[1]] ?? process.env[m[1]];
      if (val) resolved[k] = val;
    }
  }
  return resolved;
}

function mergeClaudeMcp(name, entry, configPath) {
  let config = {};
  if (existsSync(configPath)) {
    config = JSON.parse(readFileSync(configPath, 'utf8'));
  }
  config.mcpServers ??= {};
  if (config.mcpServers[name]) {
    console.log(`  ${configPath}: "${name}" already configured`);
    return;
  }
  config.mcpServers[name] = entry;
  writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');
  console.log(`  ${configPath}: added "${name}"`);
}

function mergeOpencodeMcp(name, entry, configPath) {
  let config = {};
  if (existsSync(configPath)) {
    config = JSON.parse(readFileSync(configPath, 'utf8'));
  }
  config.mcp ??= {};
  if (config.mcp[name]) {
    console.log(`  ${configPath}: "${name}" already configured`);
    return;
  }
  config.mcp[name] = {
    type: 'local',
    command: [entry.command, ...entry.args],
    ...(entry.env && { environment: entry.env }),
    enabled: true,
  };
  writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');
  console.log(`  ${configPath}: added "${name}"`);
}

function mergeCodexMcp(name, entry, configPath) {
  let content = '';
  if (existsSync(configPath)) {
    content = readFileSync(configPath, 'utf8');
  }
  const header = `[mcp_servers.${name}]`;
  if (content.includes(header)) {
    console.log(`  ${configPath}: "${name}" already configured`);
    return;
  }
  let block = `\n${header}\ncommand = "${entry.command}"\nargs = [${entry.args.map(a => `"${a}"`).join(', ')}]\n`;
  if (entry.env) {
    for (const [k, v] of Object.entries(entry.env)) {
      block += `\n[mcp_servers.${name}.env]\n${k} = "${v}"\n`;
    }
  }
  mkdirSync(dirname(configPath), { recursive: true });
  writeFileSync(configPath, content + block);
  console.log(`  ${configPath}: added "${name}"`);
}

export function mergeMcpConfig(name, server, tools, envOverrides = {}) {
  if (!server.mcpEntry) return;
  const entry = JSON.parse(JSON.stringify(server.mcpEntry));
  if (entry.env) {
    entry.env = resolveEnvPlaceholders(entry.env, envOverrides);
  }

  for (const tool of tools) {
    switch (tool) {
      case 'claude':
        mergeClaudeMcp(name, entry, resolve(homedir(), '.claude.json'));
        break;
      case 'opencode': {
        const isWin = process.platform === 'win32';
        const configDir = isWin
          ? win32.join(process.env.APPDATA, 'opencode')
          : resolve(homedir(), '.config', 'opencode');
        mergeOpencodeMcp(name, entry, resolve(configDir, 'opencode.json'));
        break;
      }
      case 'codex': {
        const isWin = process.platform === 'win32';
        const codexDir = isWin
          ? win32.join(process.env.APPDATA, 'codex')
          : resolve(homedir(), '.codex');
        mergeCodexMcp(name, entry, resolve(codexDir, 'config.toml'));
        break;
      }
    }
  }
}

export function promptApiKey(name, envVar) {
  return new Promise((done) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    rl.question(`${name} API key (or press Enter to skip): `, (answer) => {
      rl.close();
      const val = answer.trim();
      if (!val) {
        console.log(`  Skipped. Set ${envVar} in your shell profile later.`);
        done(null);
      } else {
        done({ key: envVar, value: val });
      }
    });
  });
}

function getShellProfile() {
  const shell = process.env.SHELL || '';
  if (shell.endsWith('/zsh')) return resolve(homedir(), '.zshrc');
  if (shell.endsWith('/fish')) return resolve(homedir(), '.config', 'fish', 'config.fish');
  return resolve(homedir(), '.bashrc');
}

export function writeEnvVars(keys) {
  if (!keys.length) return;

  if (process.platform === 'win32') {
    for (const { key, value } of keys) {
      execSync(`setx ${key} "${value}"`, { stdio: 'inherit' });
    }
    console.log('  Environment variables set via setx (restart shell to take effect).');
    return;
  }

  const profile = getShellProfile();
  let content = existsSync(profile) ? readFileSync(profile, 'utf8') : '';

  const added = [];
  for (const { key, value } of keys) {
    if (content.includes(`export ${key}=`)) continue;
    const line = `export ${key}="${value}"`;
    const prefix = content === '' || content.endsWith('\n') ? '' : '\n';
    content += prefix + line + '\n';
    process.env[key] = value;
    added.push(key);
  }

  if (added.length) {
    writeFileSync(profile, content);
    console.log(`  Added ${added.join(', ')} to ${profile}`);
  }
}



export function ensureBypassPermissions(tools) {
  console.log('\nConfiguring permissions...');
  for (const tool of tools) {
    switch (tool) {
      case 'claude': {
        const settingsPath = resolve(homedir(), '.claude', 'settings.json');
        let settings = {};
        if (existsSync(settingsPath)) {
          settings = JSON.parse(readFileSync(settingsPath, 'utf8'));
        }
        if (settings.permissions?.defaultMode === 'bypassPermissions') {
          console.log(`  claude: already set`);
          break;
        }
        settings.permissions ??= {};
        settings.permissions.defaultMode = 'bypassPermissions';
        settings.attribution ??= {};
        settings.attribution.commit ??= '';
        settings.attribution.pr ??= '';
        mkdirSync(dirname(settingsPath), { recursive: true });
        writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n');
        console.log(`  claude: bypassPermissions + no co-authored-by in ${settingsPath}`);
        break;
      }
      case 'codex': {
        const isWin = process.platform === 'win32';
        const configPath = isWin
          ? win32.join(process.env.APPDATA, 'codex', 'config.toml')
          : resolve(homedir(), '.codex', 'config.toml');
        let content = '';
        if (existsSync(configPath)) {
          content = readFileSync(configPath, 'utf8');
        }
        if (content.includes('approval_policy')) {
          console.log(`  codex: already set`);
          break;
        }
        mkdirSync(dirname(configPath), { recursive: true });
        writeFileSync(configPath, content + `\napproval_policy = "never"\n`);
        console.log(`  codex: approval_policy = "never" in ${configPath}`);
        break;
      }
      case 'opencode': {
        const isWin = process.platform === 'win32';
        const configDir = isWin
          ? win32.join(process.env.APPDATA, 'opencode')
          : resolve(homedir(), '.config', 'opencode');
        const configPath = resolve(configDir, 'opencode.json');
        let config = {};
        if (existsSync(configPath)) {
          config = JSON.parse(readFileSync(configPath, 'utf8'));
        }
        if (config.permission === 'allow') {
          console.log(`  opencode: already set`);
          break;
        }
        config.permission = 'allow';
        mkdirSync(configDir, { recursive: true });
        writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');
        console.log(`  opencode: permission = "allow" in ${configPath}`);
        break;
      }
    }
  }
}

export function multiSelect(options) {
  return new Promise((done) => {
    const selected = options.map(() => false);
    let cursor = 0;

    const render = () => {
      process.stdout.write(`\x1b[${options.length}A`);
      options.forEach((opt, i) => {
        const check = selected[i] ? 'x' : ' ';
        const arrow = i === cursor ? '>' : ' ';
        process.stdout.write(`\x1b[2K${arrow} [${check}] ${opt.label}\n`);
      });
    };

    console.log('\nSelect tools (arrows to move, space to toggle, enter to confirm):\n');
    options.forEach((opt, i) => {
      const arrow = i === cursor ? '>' : ' ';
      console.log(`${arrow} [ ] ${opt.label}`);
    });

    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.setEncoding('utf8');

    const onKey = (key) => {
      if (key === '\x1b[A') { cursor = (cursor - 1 + options.length) % options.length; render(); }
      else if (key === '\x1b[B') { cursor = (cursor + 1) % options.length; render(); }
      else if (key === ' ') { selected[cursor] = !selected[cursor]; render(); }
      else if (key === 'a') { const allOn = selected.every(Boolean); selected.fill(!allOn); render(); }
      else if (key === '\r') {
        process.stdin.setRawMode(false);
        process.stdin.pause();
        process.stdin.removeListener('data', onKey);
        console.log('');
        done(options.filter((_, i) => selected[i]).map(o => o.value));
      }
      else if (key === '\x03') { process.exit(0); }
    };

    process.stdin.on('data', onKey);
  });
}

const CE_REPO = 'EveryInc/compound-engineering-plugin';

const CLAUDE_PLUGINS = [
  { marketplace: 'compound-engineering-plugin', repo: 'EveryInc/compound-engineering-plugin', plugin: 'compound-engineering' },
];

const SKILLS = [
  'pbakaus/impeccable',
];

export function registerClaudePlugins() {
  const settingsPath = resolve(homedir(), '.claude', 'settings.json');
  let settings = {};
  if (existsSync(settingsPath)) {
    settings = JSON.parse(readFileSync(settingsPath, 'utf8'));
  }
  settings.extraKnownMarketplaces ??= {};
  settings.enabledPlugins ??= {};
  const added = [];

  for (const { marketplace, repo, plugin } of CLAUDE_PLUGINS) {
    const pluginKey = `${plugin}@${marketplace}`;
    let changed = false;
    if (!settings.extraKnownMarketplaces[marketplace]) {
      settings.extraKnownMarketplaces[marketplace] = { source: { source: 'github', repo } };
      changed = true;
    }
    if (!settings.enabledPlugins[pluginKey]) {
      settings.enabledPlugins[pluginKey] = true;
      changed = true;
    }
    if (changed) {
      added.push(pluginKey);
    } else {
      console.log(`  ${pluginKey}: already registered`);
    }
  }

  if (added.length) {
    mkdirSync(dirname(settingsPath), { recursive: true });
    writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n');
    for (const p of added) console.log(`  ${p}: registered`);
    console.log('  Claude Code will auto-install on next session.');
  }
}

export function installSkills(tools) {
  console.log('\nInstalling skills...');
  const agents = tools.map(t => t === 'claude' ? 'claude-code' : t);
  for (const skill of SKILLS) {
    for (const agent of agents) {
      console.log(`  ${skill} → ${agent}`);
      execSync(`npx -y skills add ${skill} -a ${agent} -y -g`, { stdio: 'pipe' });
    }
  }
}

export function installCompoundEngineering(tool) {
  console.log(`\nInstalling compound-engineering for ${tool}...`);

  switch (tool) {
    case 'claude': {
      registerClaudePlugins();
      break;
    }
    case 'codex': {
      execSync(`codex plugin marketplace add ${CE_REPO}`, { stdio: 'inherit' });
      execSync('bunx @every-env/compound-plugin install compound-engineering --to codex', { stdio: 'inherit' });
      console.log('\n  Also launch codex, run /plugins, find Compound Engineering, and install from the TUI.');
      break;
    }
    case 'opencode': {
      execSync('bunx @every-env/compound-plugin install compound-engineering --to opencode', { stdio: 'inherit' });
      break;
    }
  }

  console.log(`  ${tool}: done`);
}

export function ensureGitignore(entries) {
  const gitignorePath = resolve('.gitignore');
  let content = '';
  if (existsSync(gitignorePath)) {
    content = readFileSync(gitignorePath, 'utf8');
  }
  const missing = entries.filter(e => !content.includes(e));
  if (!missing.length) return;
  const block = missing.join('\n') + '\n';
  const prefix = content === '' || content.endsWith('\n') ? '' : '\n';
  writeFileSync(gitignorePath, content + prefix + block);
  console.log(`  Added ${missing.join(', ')} to .gitignore`);
}

export function installBundledSkills(tools) {
  console.log('\nInstalling agentkit skills...');
  const srcDir = resolve(__dir, '..', 'skills');
  if (!existsSync(srcDir)) return;

  for (const tool of tools) {
    let destDir;
    switch (tool) {
      case 'claude':
        destDir = resolve(homedir(), '.claude', 'skills');
        break;
      case 'codex':
        destDir = resolve(homedir(), '.codex', 'skills');
        break;
      case 'opencode': {
        const isWin = process.platform === 'win32';
        destDir = isWin
          ? win32.join(process.env.APPDATA, 'opencode', 'skills')
          : resolve(homedir(), '.config', 'opencode', 'skills');
        break;
      }
    }
    copyDirMerge(srcDir, destDir, { overwrite: true });
    console.log(`  ${tool}: ${destDir}`);
  }
}

export function setupProject(tools) {
  if (!existsSync('.git')) {
    console.log('Not a git repository, skipping project setup.');
    return;
  }

  ensureGitignore(['.claude/', '.codex/', '.opencode/', 'CLAUDE.md', 'AGENTS.md', '.mcp.json']);

  if (!existsSync('AGENTS.md')) {
    let template = '';
    if (getInstalledVersion('tokf')) {
      template += `# tokf\n\n🗜️ means this output was compressed by tokf.\nRun \`tokf raw last\` to see the full uncompressed output of the last command.\n\n`;
    }
    template += `# Principles\n\n`
      + `- **SRP** — A module should have one, and only one, reason to change: responsible to one actor.\n`
      + `- **OCP** — Software entities should be open for extension but closed for modification.\n`
      + `- **LSP** — Objects of a supertype shall be replaceable with objects of a subtype without altering program correctness.\n`
      + `- **ISP** — No client should be forced to depend on methods it does not use; prefer many client-specific interfaces over one general-purpose interface.\n`
      + `- **DIP** — High-level modules should not depend on low-level modules — both should depend on abstractions; abstractions should not depend on details.\n`
      + `- **KISS** — Every system works best when simplicity is a key goal and unnecessary complexity is avoided.\n`
      + `- **DRY** — Every piece of knowledge must have a single, unambiguous, authoritative representation within a system.\n`
      + `- **Forward-First** — Design for the current and next contract version; never introduce backward-compatibility shims or legacy code paths that increase maintenance surface.\n`
      + `- **No Defensive Garbage** — Trust established preconditions and module contracts; let violated invariants surface as immediate failures instead of masking them with silent fallbacks.\n`
      + `- **Tell, Don't Ask** — Rather than querying an object's state and acting on it, tell the object what to do and let it use its own state to decide how.\n`
      + `- **Fail Fast** — Detect and report errors at the earliest possible point, at the interface where the fault originates, rather than allowing bad state to propagate.\n`
      + `- **No Silent Error Swallowing** — Never catch an exception and discard it without logging, re-raising, or making the failure visible; every error must produce an observable signal.\n`
      + `- **Explicit Error Types** — Represent each distinct failure mode as a named, typed value in the return signature rather than relying on generic exceptions or sentinel values.\n`
      + `\n`;
    template += `# Workflow\n`;
    writeFileSync('AGENTS.md', template);
    console.log('  Created AGENTS.md');
  }

  if (tools.includes('claude') && !existsSync('CLAUDE.md')) {
    writeFileSync('CLAUDE.md', '@AGENTS.md\n');
    console.log('  Created CLAUDE.md (references @AGENTS.md)');
  }
}

async function main() {
  const projectOnly = process.argv.includes('--project') || process.argv.includes('-p');

  if (projectOnly) {
    console.log('agentkit project setup\n');
    const tools = ['claude', 'codex', 'opencode'];
    setupProject(tools);
    console.log('\nDone.');
    return;
  }

  console.log('agentkit\n');

  const tools = await multiSelect([
    { label: 'Claude Code', value: 'claude' },
    { label: 'Codex', value: 'codex' },
    { label: 'OpenCode', value: 'opencode' },
  ]);

  if (!tools.length) {
    console.log('Nothing selected.');
    return;
  }

  // Ensure bun is available (needed for compound-engineering on codex/opencode)
  if (!getInstalledVersion('bun')) {
    console.log('\nInstalling bun...');
    execSync('npm install -g bun', { stdio: 'inherit' });
  }

  // Binaries (version-checked)
  for (const [name, server] of Object.entries(REGISTRY)) {
    if (name === 'context7') continue;
    if (server.platforms) {
      const target = detectTarget();
      if (!target || !server.platforms.includes(target.key)) {
        console.log(`Skipping ${name}: not supported on ${process.platform}/${process.arch}`);
        continue;
      }
    }
    const installed = await installBinary(name, server);
    if (!installed) continue;
    runPostInstall(name, server);
    mergeMcpConfig(name, server, tools);
    console.log(`\n${name}: done`);
  }

  // Compound Engineering plugin
  for (const tool of tools) {
    installCompoundEngineering(tool);
  }

  // Skills (for selected tools)
  installSkills(tools);

  // Bundled agentkit skills
  installBundledSkills(tools);

  // API keys
  console.log('\nAPI Keys\n');
  const keys = [];
  const resolveKey = async (label, envVar) => {
    if (process.env[envVar]) {
      console.log(`  ${label}: found in environment`);
      return;
    }
    const k = await promptApiKey(label, envVar);
    if (k) {
      keys.push(k);
      process.env[envVar] = k.value;
    }
  };
  await resolveKey('Context7', 'CONTEXT7_API_KEY');
  if (keys.length) writeEnvVars(keys);

  const envOverrides = Object.fromEntries(keys.map(({ key, value }) => [key, value]));
  mergeMcpConfig('context7', REGISTRY['context7'], tools, envOverrides);

  ensureBypassPermissions(tools);
  setupProject(tools);

  console.log('\nDone.');
}

// Run main when executed directly. Skip when imported by another module (e.g. tests).
// In ESM, compare realpath of argv[1] with realpath of this file to handle
// symlinks and npx cache paths.
import { realpathSync } from 'node:fs';

function isMainModule() {
  if (!process.argv[1]) return false;
  try {
    return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isMainModule()) {
  main();
}
