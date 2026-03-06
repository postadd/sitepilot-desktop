# SitePilot Desktop

**AI Copilot for WordPress** — Connect your WordPress site to Claude and other AI assistants in one click.

## For Users

1. **Download** the latest installer from the [Releases](../../releases) page
   - Windows: `SitePilot-Setup-x.x.x.exe`
   - Mac: `SitePilot-x.x.x.dmg`
   - Linux: `SitePilot-x.x.x.AppImage`
2. **Install & open** SitePilot
3. **Enter your site URL** and WordPress credentials (used once, never stored)
4. **Done** — SitePilot generates your API key and configures everything automatically

## What It Does

SitePilot gives AI assistants (like Claude) secure access to manage your WordPress site — pages, posts, menus, Elementor layouts, SEO fields, and settings. The desktop app handles all the technical setup so you never touch a config file.

### Requirements

- A WordPress site with the **SitePilot plugin** installed ([download here](../../releases))
- **Claude Desktop** app (or any MCP-compatible AI client)

---

## For Maintainers

### How Releases Work

This repo uses GitHub Actions to automatically build installers for all platforms. To create a new release:

1. Update the version in `package.json`
2. Commit and push
3. Create and push a version tag:
   ```
   git tag v1.0.0
   git push origin v1.0.0
   ```
4. GitHub Actions builds `.exe`, `.dmg`, and `.AppImage` automatically
5. A new Release appears on the repo with all three installers attached

That's it. No local build tools needed.

### Project Structure

```
sitepilot-desktop/
├── .github/workflows/build.yml   # Auto-build pipeline
├── src/
│   ├── main.js                   # Electron main process
│   ├── preload.js                # Secure IPC bridge
│   ├── index.html                # App UI
│   └── mcp-server.js             # MCP server (bundled)
├── package.json
└── package-lock.json
```

### Local Development (optional)

If you want to run the app locally during development:

```bash
npm install
npm start
```

This opens the Electron app on your machine for testing. You do **not** need to do this for releases — GitHub Actions handles everything.
