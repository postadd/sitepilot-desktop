const { app, BrowserWindow, ipcMain, shell, Tray, Menu, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { spawn } = require('child_process');

// Simple persistent store (no native deps)
const STORE_PATH = path.join(app.getPath('userData'), 'sitepilot-config.json');

function loadStore() {
  try {
    return JSON.parse(fs.readFileSync(STORE_PATH, 'utf8'));
  } catch {
    return {};
  }
}

function saveStore(data) {
  fs.writeFileSync(STORE_PATH, JSON.stringify(data, null, 2));
}

let mainWindow = null;
let mcpProcess = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 520,
    height: 680,
    resizable: false,
    maximizable: false,
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: '#0a0f1e',
      symbolColor: '#8b95a8',
      height: 36,
    },
    backgroundColor: '#0a0f1e',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, 'index.html'));
  mainWindow.on('closed', () => { mainWindow = null; });
}

app.whenReady().then(createWindow);
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('activate', () => { if (!mainWindow) createWindow(); });

// ── IPC Handlers ────────────────────────────────────────────────

// Load saved config
ipcMain.handle('config:load', () => {
  return loadStore();
});

// Save config
ipcMain.handle('config:save', (_, data) => {
  const store = loadStore();
  Object.assign(store, data);
  saveStore(store);
  return store;
});

// Generate a new API key
ipcMain.handle('key:generate', () => {
  return 'sp_' + crypto.randomBytes(32).toString('hex');
});

// Test connection to WordPress
ipcMain.handle('connection:test', async (_, { siteUrl, apiKey }) => {
  try {
    const url = `${siteUrl.replace(/\/+$/, '')}/wp-json/sitepilot/v1/ping`;
    const res = await fetch(url, {
      headers: {
        'X-SitePilot-Key': apiKey,
        'Accept': 'application/json',
      },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) {
      const text = await res.text();
      return { success: false, error: `HTTP ${res.status}: ${text}` };
    }
    const data = await res.json();
    return { success: true, data };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

// Auto-setup: push API key to WordPress via a setup endpoint
ipcMain.handle('connection:auto-setup', async (_, { siteUrl, wpUser, wpPass }) => {
  try {
    const apiKey = 'sp_' + crypto.randomBytes(32).toString('hex');
    const url = `${siteUrl.replace(/\/+$/, '')}/wp-json/sitepilot/v1/setup`;
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Basic ' + Buffer.from(`${wpUser}:${wpPass}`).toString('base64'),
        'Accept': 'application/json',
      },
      body: JSON.stringify({ key: apiKey }),
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) {
      const text = await res.text();
      return { success: false, error: `HTTP ${res.status}: ${text}` };
    }
    const data = await res.json();
    return { success: true, apiKey, data };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

// Configure Claude Desktop MCP config
ipcMain.handle('claude:configure', async (_, { siteUrl, apiKey }) => {
  try {
    // Find Claude Desktop config file
    const home = app.getPath('home');
    const possiblePaths = [
      path.join(home, 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json'), // macOS
      path.join(home, 'AppData', 'Roaming', 'Claude', 'claude_desktop_config.json'), // Windows
      path.join(home, '.config', 'claude', 'claude_desktop_config.json'), // Linux
    ];

    let configPath = possiblePaths.find(p => {
      try { return fs.existsSync(path.dirname(p)); } catch { return false; }
    });

    if (!configPath) {
      // Default to platform-appropriate path and create the directory
      if (process.platform === 'win32') configPath = possiblePaths[1];
      else if (process.platform === 'darwin') configPath = possiblePaths[0];
      else configPath = possiblePaths[2];
      fs.mkdirSync(path.dirname(configPath), { recursive: true });
    }

    // Load existing config or create new
    let config = {};
    try { config = JSON.parse(fs.readFileSync(configPath, 'utf8')); } catch {}

    if (!config.mcpServers) config.mcpServers = {};

    // Find the MCP server script path (bundled with the app)
    const mcpServerPath = path.join(__dirname, 'mcp-server.js');

    config.mcpServers.sitepilot = {
      command: 'node',
      args: [mcpServerPath],
      env: {
        SITEPILOT_URL: siteUrl,
        SITEPILOT_KEY: apiKey,
      },
    };

    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
    return { success: true, configPath };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

// Start HTTP MCP server
ipcMain.handle('server:start', async (_, { siteUrl, apiKey, port }) => {
  try {
    if (mcpProcess) {
      mcpProcess.kill();
      mcpProcess = null;
    }
    const mcpServerPath = path.join(__dirname, 'mcp-server.js');
    mcpProcess = spawn('node', [mcpServerPath], {
      env: {
        ...process.env,
        SITEPILOT_URL: siteUrl,
        SITEPILOT_KEY: apiKey,
        TRANSPORT: 'http',
        PORT: String(port || 3000),
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    return new Promise((resolve) => {
      let resolved = false;
      mcpProcess.stderr.on('data', (data) => {
        const msg = data.toString();
        if (!resolved && msg.includes('running on')) {
          resolved = true;
          resolve({ success: true, message: msg.trim() });
        }
      });
      mcpProcess.on('error', (err) => {
        if (!resolved) {
          resolved = true;
          resolve({ success: false, error: err.message });
        }
      });
      mcpProcess.on('exit', (code) => {
        if (!resolved) {
          resolved = true;
          resolve({ success: false, error: `Process exited with code ${code}` });
        }
        mcpProcess = null;
      });
      // Timeout
      setTimeout(() => {
        if (!resolved) {
          resolved = true;
          resolve({ success: true, message: 'Server started (no confirmation yet)' });
        }
      }, 3000);
    });
  } catch (e) {
    return { success: false, error: e.message };
  }
});

// Stop HTTP MCP server
ipcMain.handle('server:stop', () => {
  if (mcpProcess) {
    mcpProcess.kill();
    mcpProcess = null;
    return { success: true };
  }
  return { success: false, error: 'No server running' };
});

// Get server status
ipcMain.handle('server:status', () => {
  return { running: !!mcpProcess };
});

// Open external URL
ipcMain.handle('shell:open', (_, url) => {
  shell.openExternal(url);
});

// Disconnect: remove from Claude config and clear local config
ipcMain.handle('connection:disconnect', async () => {
  try {
    // Kill HTTP server if running
    if (mcpProcess) {
      mcpProcess.kill();
      mcpProcess = null;
    }

    // Remove from Claude Desktop config
    const home = app.getPath('home');
    const possiblePaths = [
      path.join(home, 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json'),
      path.join(home, 'AppData', 'Roaming', 'Claude', 'claude_desktop_config.json'),
      path.join(home, '.config', 'claude', 'claude_desktop_config.json'),
    ];

    for (const configPath of possiblePaths) {
      try {
        if (fs.existsSync(configPath)) {
          const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
          if (config.mcpServers && config.mcpServers.sitepilot) {
            delete config.mcpServers.sitepilot;
            fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
          }
        }
      } catch {}
    }

    // Clear saved config
    saveStore({});
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
});
