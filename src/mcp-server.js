#!/usr/bin/env node

/**
 * SitePilot MCP Server (bundled with SitePilot Desktop)
 * Connects AI assistants to WordPress via the SitePilot plugin REST API.
 *
 * Environment variables:
 *   SITEPILOT_URL - WordPress site URL (e.g. https://example.com)
 *   SITEPILOT_KEY - API key configured in SitePilot plugin
 *   TRANSPORT     - 'stdio' (default) or 'http'
 *   PORT          - HTTP port (default 3000, only used with TRANSPORT=http)
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import express from "express";
import { z } from "zod";

const BASE_URL = process.env.SITEPILOT_URL || "";
const API_KEY = process.env.SITEPILOT_KEY || "";

if (!BASE_URL) { console.error("SITEPILOT_URL is required."); process.exit(1); }
if (!API_KEY)  { console.error("SITEPILOT_KEY is required."); process.exit(1); }

const API_BASE = `${BASE_URL.replace(/\/+$/, "")}/wp-json/sitepilot/v1`;

async function apiRequest(endpoint, method = "GET", body) {
  const url = `${API_BASE}/${endpoint}`;
  const opts = {
    method,
    headers: { "X-SitePilot-Key": API_KEY, "Content-Type": "application/json", Accept: "application/json" },
  };
  if (body && method === "POST") opts.body = JSON.stringify(body);
  const res = await fetch(url, opts);
  if (!res.ok) throw new Error(`API error ${res.status}: ${await res.text()}`);
  return res.json();
}

const ok = (data) => ({ content: [{ type: "text", text: JSON.stringify(data, null, 2) }] });
const err = (msg) => ({ isError: true, content: [{ type: "text", text: msg }] });

const server = new McpServer({ name: "sitepilot-mcp-server", version: "1.0.0" });

// ── Tools ───────────────────────────────────────────────────────

server.registerTool("sp_ping", {
  title: "Ping", description: "Health check — verify the WordPress site is reachable and SitePilot is active.",
  inputSchema: {}, annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
}, async () => { try { return ok(await apiRequest("ping")); } catch(e) { return err(e.message); } });

server.registerTool("sp_get_site_info", {
  title: "Get Site Info", description: "Get full WordPress site information including theme, plugins, admin email, and WP version.",
  inputSchema: {}, annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
}, async () => { try { return ok(await apiRequest("site-info")); } catch(e) { return err(e.message); } });

server.registerTool("sp_get_options", {
  title: "Get Options", description: "Retrieve WordPress site options/settings. Optionally pass specific keys.",
  inputSchema: { keys: z.array(z.string()).optional().describe("Specific option keys to retrieve") },
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
}, async (params) => { try { const qs = params.keys ? `?keys=${params.keys.join(",")}` : ""; return ok(await apiRequest(`options${qs}`)); } catch(e) { return err(e.message); } });

server.registerTool("sp_update_options", {
  title: "Update Options", description: "Update WordPress site options. Updatable: blogname, blogdescription, admin_email, date_format, time_format, timezone_string, posts_per_page.",
  inputSchema: {
    blogname: z.string().optional(), blogdescription: z.string().optional(),
    admin_email: z.string().email().optional(), date_format: z.string().optional(),
    time_format: z.string().optional(), timezone_string: z.string().optional(),
    posts_per_page: z.number().int().min(1).max(100).optional(),
  },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
}, async (params) => { try { return ok(await apiRequest("options", "POST", params)); } catch(e) { return err(e.message); } });

server.registerTool("sp_get_log", {
  title: "Get Activity Log", description: "View recent API activity log (up to 200 entries).",
  inputSchema: {}, annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
}, async () => { try { return ok(await apiRequest("log")); } catch(e) { return err(e.message); } });

server.registerTool("sp_list_pages", {
  title: "List Pages", description: "List all pages with id, title, slug, status, modified date, and URL.",
  inputSchema: {}, annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
}, async () => { try { return ok(await apiRequest("pages")); } catch(e) { return err(e.message); } });

server.registerTool("sp_get_page", {
  title: "Get Page", description: "Get full content and metadata for a page by ID. Includes Elementor data if present.",
  inputSchema: { id: z.number().int().positive().describe("WordPress page ID") },
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
}, async (p) => { try { return ok(await apiRequest(`pages/${p.id}`)); } catch(e) { return err(e.message); } });

server.registerTool("sp_create_page", {
  title: "Create Page", description: "Create a new WordPress page.",
  inputSchema: {
    title: z.string().min(1).describe("Page title"),
    content: z.string().optional().describe("HTML content"),
    status: z.enum(["publish","draft","private"]).default("draft"),
    template: z.string().optional().describe("Page template filename"),
  },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
}, async (p) => { try { return ok(await apiRequest("pages", "POST", p)); } catch(e) { return err(e.message); } });

server.registerTool("sp_update_page", {
  title: "Update Page", description: "Update a page's content, title, SEO fields, or status.",
  inputSchema: {
    id: z.number().int().positive(), title: z.string().optional(), content: z.string().optional(),
    status: z.enum(["publish","draft","private"]).optional(),
    seo_title: z.string().optional(), seo_description: z.string().optional(),
  },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
}, async (p) => { try { const {id,...body}=p; return ok(await apiRequest(`pages/${id}`, "POST", body)); } catch(e) { return err(e.message); } });

server.registerTool("sp_get_elementor", {
  title: "Get Elementor Data", description: "Get raw Elementor JSON for a page. Returns null if not an Elementor page.",
  inputSchema: { id: z.number().int().positive() },
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
}, async (p) => { try { return ok(await apiRequest(`elementor/${p.id}`)); } catch(e) { return err(e.message); } });

server.registerTool("sp_update_elementor", {
  title: "Update Elementor Data", description: "Push Elementor JSON to a page. REPLACES entire layout — fetch first with sp_get_elementor.",
  inputSchema: { id: z.number().int().positive(), elementor_data: z.any() },
  annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
}, async (p) => { try { return ok(await apiRequest(`elementor/${p.id}`, "POST", { elementor_data: p.elementor_data })); } catch(e) { return err(e.message); } });

server.registerTool("sp_list_posts", {
  title: "List Posts", description: "List all blog posts with id, title, slug, status, date, modified, URL, excerpt.",
  inputSchema: {}, annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
}, async () => { try { return ok(await apiRequest("posts")); } catch(e) { return err(e.message); } });

server.registerTool("sp_get_post", {
  title: "Get Post", description: "Get full content and metadata for a blog post by ID.",
  inputSchema: { id: z.number().int().positive() },
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
}, async (p) => { try { return ok(await apiRequest(`posts/${p.id}`)); } catch(e) { return err(e.message); } });

server.registerTool("sp_update_post", {
  title: "Update Post", description: "Update a blog post's content, title, status, or excerpt.",
  inputSchema: {
    id: z.number().int().positive(), title: z.string().optional(), content: z.string().optional(),
    status: z.enum(["publish","draft","private"]).optional(), excerpt: z.string().optional(),
  },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
}, async (p) => { try { const {id,...body}=p; return ok(await apiRequest(`posts/${id}`, "POST", body)); } catch(e) { return err(e.message); } });

server.registerTool("sp_get_menus", {
  title: "Get Menus", description: "Get all WordPress navigation menus with nested item trees.",
  inputSchema: {}, annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
}, async () => { try { return ok(await apiRequest("menus")); } catch(e) { return err(e.message); } });

// ── Transport ───────────────────────────────────────────────────
async function runStdio() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("SitePilot MCP server running on stdio");
}

async function runHTTP() {
  const app = express();
  app.use(express.json({ limit: "10mb" }));
  app.post("/mcp", async (req, res) => {
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    res.on("close", () => transport.close());
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  });
  const port = parseInt(process.env.PORT || "3000");
  app.listen(port, () => console.error(`SitePilot MCP server running on http://localhost:${port}/mcp`));
}

if ((process.env.TRANSPORT || "stdio") === "http") { runHTTP(); } else { runStdio(); }
