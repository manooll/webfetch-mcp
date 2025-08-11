#!/usr/bin/env node

/**
 * WebFetch.MCP v0.1.8
 * Live Web Access for Your Local AI — Tunable Search & Clean Content Extraction
 * 
 * A production-ready Model Context Protocol (MCP) server that provides web search 
 * and content extraction capabilities for LM Studio and other MCP clients.
 * 
 * Features:
 * - Web search via local SearxNG instance
 * - Advanced web content extraction with Mozilla Readability
 * - Browser simulation to bypass bot detection
 * - Rate limiting and responsible scraping practices
 * - Comprehensive error handling and logging
 * 
 * @author Jay Leon (@manull)
 * @license MIT
 * @version 0.1.8
 * @repository https://github.com/manull/webfetch-mcp
 * 
 * Copyright (c) 2025 Jay Leon (@manull)
 * Licensed under the MIT License - see LICENSE file for details
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { JSDOM } from "jsdom";
import { Readability } from "@mozilla/readability";
import { writeFileSync, appendFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

// Use Node.js built-in fetch
const fetch = globalThis.fetch;

// ---------- Config ----------
const SEARXNG_BASE = process.env.SEARXNG_BASE || "http://localhost:8080";
const DEBUG = process.env.DEBUG === "true";
const DETAILED_LOG = process.env.DETAILED_LOG !== "false"; // Default to true

// Time-based rate limiting - more user-friendly approach
const RATE_LIMIT_WINDOW_MS = 5 * 60 * 1000; // 5 minutes
const MAX_CALLS_PER_WINDOW = 12; // Allow more calls but over time
const BURST_LIMIT = 8; // Max calls in quick succession
const BURST_WINDOW_MS = 30 * 1000; // 30 seconds

let callHistory = []; // Array of timestamps

const checkCallLimit = () => {
  const now = Date.now();
  
  // Clean up old calls outside the main window
  callHistory = callHistory.filter(timestamp => now - timestamp < RATE_LIMIT_WINDOW_MS);
  
  // Check burst limit (quick succession)
  const recentCalls = callHistory.filter(timestamp => now - timestamp < BURST_WINDOW_MS);
  
  if (recentCalls.length >= BURST_LIMIT) {
    return {
      limited: true,
      message: `🛑 **Burst Limit Reached**: ${BURST_LIMIT} calls in ${BURST_WINDOW_MS/1000} seconds. Please wait ${Math.ceil((BURST_WINDOW_MS - (now - recentCalls[0]))/1000)} seconds before making more requests. This prevents overwhelming websites and ensures reliable service.`
    };
  }
  
  // Check overall window limit
  if (callHistory.length >= MAX_CALLS_PER_WINDOW) {
    const oldestCall = Math.min(...callHistory);
    const resetTime = Math.ceil((RATE_LIMIT_WINDOW_MS - (now - oldestCall)) / 1000 / 60);
    return {
      limited: true,
      message: `🛑 **Rate Limit Reached**: ${MAX_CALLS_PER_WINDOW} calls in ${RATE_LIMIT_WINDOW_MS/1000/60} minutes. Please wait ${resetTime} minute(s) for the limit to reset. This ensures responsible web scraping and prevents server overload.`
    };
  }
  
  // Add current call to history
  callHistory.push(now);
  
  // Provide helpful warnings
  const remaining = MAX_CALLS_PER_WINDOW - callHistory.length;
  const recentCount = recentCalls.length + 1; // +1 for current call
  
  if (remaining <= 2) {
    return {
      limited: false,
      warning: `⚠️ **${remaining} calls remaining** in this ${RATE_LIMIT_WINDOW_MS/1000/60}-minute window.`
    };
  }
  
  if (recentCount >= BURST_LIMIT - 2) {
    return {
      limited: false,
      warning: `⚠️ **${BURST_LIMIT - recentCount} quick calls remaining** - Consider spacing out requests.`
    };
  }
  
  return { limited: false };
};

// Modern browser user agents (updated regularly)
const BROWSER_USER_AGENTS = [
  // Chrome on Windows
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  // Chrome on macOS
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  // Firefox on Windows
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0",
  // Firefox on macOS
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:121.0) Gecko/20100101 Firefox/121.0",
  // Safari on macOS
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Safari/605.1.15",
  // Edge on Windows
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0"
];

// Simple user agent for search (less likely to be blocked)
const SEARCH_USER_AGENT = "MCP-WebTools/0.6 (+https://example.local)";

// Simple rate limiting to avoid overwhelming sites
const requestTimes = new Map();
const RATE_LIMIT_DELAY = 1000; // 1 second between requests to same domain

const getRateLimitDelay = (hostname) => {
  const lastRequest = requestTimes.get(hostname) || 0;
  const now = Date.now();
  const timeSinceLastRequest = now - lastRequest;
  
  if (timeSinceLastRequest < RATE_LIMIT_DELAY) {
    return RATE_LIMIT_DELAY - timeSinceLastRequest;
  }
  return 0;
};

const updateRequestTime = (hostname) => {
  requestTimes.set(hostname, Date.now());
};

// Get a random browser user agent
const getRandomUserAgent = () => {
  return BROWSER_USER_AGENTS[Math.floor(Math.random() * BROWSER_USER_AGENTS.length)];
};

// Generate realistic browser headers
const getBrowserHeaders = (url) => {
  const urlObj = new URL(url);
  const userAgent = getRandomUserAgent();
  
  return {
    "User-Agent": userAgent,
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7",
    "Accept-Language": "en-US,en;q=0.9",
    "Accept-Encoding": "gzip, deflate, br",
    "DNT": "1",
    "Connection": "keep-alive",
    "Upgrade-Insecure-Requests": "1",
    "Sec-Fetch-Dest": "document",
    "Sec-Fetch-Mode": "navigate",
    "Sec-Fetch-Site": "none",
    "Sec-Fetch-User": "?1",
    "Cache-Control": "max-age=0",
    "sec-ch-ua": '"Not_A Brand";v="8", "Chromium";v="120", "Google Chrome";v="120"',
    "sec-ch-ua-mobile": "?0",
    "sec-ch-ua-platform": '"macOS"',
    "Referer": `https://${urlObj.hostname}/`
  };
};

// Setup detailed logging
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const LOG_FILE = join(__dirname, 'mcp-server-detailed.log');

// Initialize log file
if (DETAILED_LOG) {
  const logHeader = `\n${'='.repeat(80)}\nMCP Server Session Started: ${new Date().toISOString()}\n${'='.repeat(80)}\n`;
  if (existsSync(LOG_FILE)) {
    appendFileSync(LOG_FILE, logHeader);
  } else {
    writeFileSync(LOG_FILE, logHeader);
  }
}

// Enhanced logging functions
const log = (...args) => {
  if (DEBUG) {
    console.error("[DEBUG]", new Date().toISOString(), ...args);
  }
};

const detailedLog = (category, data) => {
  if (!DETAILED_LOG) return;
  
  const timestamp = new Date().toISOString();
  const logEntry = {
    timestamp,
    category,
    data
  };
  
  const logLine = `[${timestamp}] ${category}: ${JSON.stringify(data, null, 2)}\n`;
  
  try {
    appendFileSync(LOG_FILE, logLine);
  } catch (error) {
    console.error("Failed to write to log file:", error.message);
  }
  
  // Also log to console if debug is enabled
  if (DEBUG) {
    console.error(`[DETAILED-${category}]`, JSON.stringify(data, null, 2));
  }
};

// Helper function to safely extract text
const safeText = (s = "", max = 20000) =>
  String(s ?? "").replace(/\s+/g, " ").trim().slice(0, max);

// ---------- Create MCP server ----------
const server = new Server(
  {
    name: "mcp-web-tools-working",
    version: "0.6.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

log("Starting MCP server...");

// ---------- Tool Definitions ----------
const TOOLS = [
  {
    name: "web_search",
    description: "Search the web using a local SearxNG instance. Returns search results with titles, URLs, and snippets.",
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Search query",
        },
        limit: {
          type: "number",
          description: "Maximum number of results to return (1-20)",
          minimum: 1,
          maximum: 20,
          default: 5,
        },
        site: {
          type: "string",
          description: "Restrict search to a specific site (e.g., 'weather.gov')",
        },
        engines: {
          type: "string",
          description: "Comma-separated list of search engines",
        },
        language: {
          type: "string",
          description: "Language code (e.g., 'en')",
        },
        safesearch: {
          type: "number",
          description: "Safe search level: 0=off, 1=moderate, 2=strict",
          minimum: 0,
          maximum: 2,
        },
        page: {
          type: "number",
          description: "Page number for pagination",
          minimum: 1,
          default: 1,
        },
        time_range: {
          type: "string",
          description: "Time range filter",
          enum: ["day", "week", "month", "year"],
        },
      },
      required: ["query"],
    },
  },
  {
    name: "web_fetch",
    description: "Fetch and extract readable content from a web page URL using Mozilla Readability.",
    inputSchema: {
      type: "object",
      properties: {
        url: {
          type: "string",
          description: "HTTP/HTTPS URL to fetch (must be a valid URL)",
        },
        max_chars: {
          type: "number",
          description: "Maximum characters to return",
          minimum: 1000,
          maximum: 100000,
          default: 20000,
        },
      },
      required: ["url"],
    },
  },
];

// ---------- Tool Handlers ----------
async function handleWebSearch(args) {
  log("web_search called with args:", args);
  
  // Check call limit
  const limitCheck = checkCallLimit();
  if (limitCheck.limited) {
    return {
      content: [{ type: "text", text: limitCheck.message }]
    };
  }
  
  const { query, limit = 5, site, engines, language, safesearch, page = 1, time_range } = args;
  
  if (!query) {
    return {
      content: [{ 
        type: "text", 
        text: "Error: Missing required parameter 'query'" 
      }]
    };
  }
  
  try {
    // Build search query
    const searchQuery = site ? `${query} site:${site}` : query;
    
    // Build URL with parameters
    const url = new URL("/search", SEARXNG_BASE);
    url.searchParams.set("format", "json");
    url.searchParams.set("q", searchQuery);
    url.searchParams.set("pageno", String(page));
    url.searchParams.set("categories", "general");
    
    if (limit) {
      url.searchParams.set("count", String(limit));
    }
    
    if (engines) url.searchParams.set("engines", engines);
    if (language) url.searchParams.set("language", language);
    if (typeof safesearch === "number") url.searchParams.set("safesearch", String(safesearch));
    if (time_range) url.searchParams.set("time_range", time_range);
    
    log("Fetching URL:", url.toString());
    
    const startTime = Date.now();
    const response = await fetch(url.toString(), {
      headers: { 
        "User-Agent": SEARCH_USER_AGENT,
        "Accept": "application/json",
      },
      signal: AbortSignal.timeout(15000)
    });
    
    const fetchTime = Date.now() - startTime;
    log(`Response received in ${fetchTime}ms, status: ${response.status}`);
    
    if (!response.ok) {
      const errorText = await response.text();
      log("Error response:", errorText);
      
      return {
        content: [{ 
          type: "text", 
          text: `Search failed: HTTP ${response.status} - ${response.statusText}` 
        }]
      };
    }
    
    const responseText = await response.text();
    log("Response text length:", responseText.length);
    
    let data;
    try {
      data = JSON.parse(responseText);
    } catch (parseError) {
      log("JSON parse error:", parseError);
      return {
        content: [{ 
          type: "text", 
          text: `Search failed: Invalid JSON response from search engine` 
        }]
      };
    }
    
    log("Parsed response structure:", {
      hasResults: Array.isArray(data.results),
      resultsLength: data.results?.length || 0,
      numberofResults: data.number_of_results,
    });
    
    const rawResults = data.results || [];
    
    if (rawResults.length === 0) {
      return {
        content: [{ 
          type: "text", 
          text: `No search results found for query: "${query}"` 
        }]
      };
    }
    
    // Process and format results
    const results = rawResults.slice(0, limit).map((item, index) => {
      log(`Processing result ${index + 1}:`, {
        title: item.title?.slice(0, 50) + "...",
        url: item.url,
        engine: item.engine,
      });
      
      return {
        title: safeText(item.title || "No title", 300),
        url: item.url || "",
        snippet: safeText(item.content || item.description || "", 500),
        engine: item.engine || "unknown",
        score: item.score || 0,
        category: item.category || "general"
      };
    });
    
    // Create formatted response text
    let formattedResponse = `Search Results for "${query}":\n\n`;
    results.forEach((result, index) => {
      formattedResponse += `${index + 1}. **${result.title}**\n`;
      formattedResponse += `   URL: ${result.url}\n`;
      formattedResponse += `   ${result.snippet}\n`;
      formattedResponse += `   Source: ${result.engine}\n\n`;
    });
    
    formattedResponse += `\nFound ${results.length} results`;
    if (data.number_of_results) {
      formattedResponse += ` (${data.number_of_results} total available)`;
    }
    
    // Add warning if approaching limit
    if (limitCheck.warning) {
      formattedResponse += `\n\n${limitCheck.warning}`;
    }
    
    log("Returning successful result with", results.length, "items");
    
    return {
      content: [{ type: "text", text: formattedResponse }]
    };
    
  } catch (error) {
    log("Exception in web_search:", error);
    
    return {
      content: [{ 
        type: "text", 
        text: `Search failed: ${error.message}` 
      }]
    };
  }
}

async function handleWebFetch(args) {
  log("web_fetch called with args:", args);
  
  // Check call limit
  const limitCheck = checkCallLimit();
  if (limitCheck.limited) {
    return {
      content: [{ type: "text", text: limitCheck.message }]
    };
  }
  
  const { url, max_chars = 20000, retry_count = 0 } = args;
  
  if (!url) {
    return {
      content: [{ 
        type: "text", 
        text: "Error: Missing required parameter 'url'" 
      }]
    };
  }
  
  // Validate URL
  let validUrl;
  try {
    validUrl = new URL(url);
    if (!["http:", "https:"].includes(validUrl.protocol)) {
      throw new Error("Only HTTP and HTTPS URLs are supported");
    }
  } catch (urlError) {
    return {
      content: [{ 
        type: "text", 
        text: `Invalid URL: ${urlError.message}` 
      }]
    };
  }
  
  try {
    log("Fetching URL:", validUrl.toString());
    
    // Apply rate limiting
    const hostname = validUrl.hostname;
    const rateLimitDelay = getRateLimitDelay(hostname);
    if (rateLimitDelay > 0) {
      log(`Rate limiting: waiting ${rateLimitDelay}ms for ${hostname}`);
      await new Promise(resolve => setTimeout(resolve, rateLimitDelay));
    }
    updateRequestTime(hostname);
    
    // Add realistic delay to simulate human browsing (only on first attempt)
    if (retry_count === 0) {
      await new Promise(resolve => setTimeout(resolve, Math.random() * 1000 + 500));
    }
    
    // Get realistic browser headers
    const browserHeaders = getBrowserHeaders(validUrl.toString());
    
    // Add some randomization to headers to avoid fingerprinting
    const headers = { ...browserHeaders };
    
    // Sometimes remove optional headers to vary fingerprint
    if (Math.random() > 0.7) {
      delete headers["DNT"];
    }
    if (Math.random() > 0.8) {
      delete headers["sec-ch-ua"];
      delete headers["sec-ch-ua-mobile"];
      delete headers["sec-ch-ua-platform"];
    }
    
    log("Using headers:", Object.keys(headers).join(", "));
    
    const response = await fetch(validUrl.toString(), {
      headers,
      signal: AbortSignal.timeout(20000), // Increased timeout
      redirect: 'follow',
      // Add realistic fetch options
      method: 'GET',
      mode: 'cors',
      credentials: 'omit',
      cache: 'default'
    });
    
    log("Fetch response status:", response.status);
    
    // Handle different HTTP status codes with retry logic
    if (!response.ok) {
      // Retry on certain status codes if we haven't retried yet
      if (retry_count === 0 && [429, 503, 502, 504].includes(response.status)) {
        log(`Retrying request due to ${response.status} status`);
        await new Promise(resolve => setTimeout(resolve, 2000 + Math.random() * 3000));
        return handleWebFetch({ ...args, retry_count: 1 });
      }
      
      // Handle specific error codes with helpful messages
      let errorMessage;
      switch (response.status) {
        case 403:
          errorMessage = `Access forbidden (${response.status}). The site may be blocking automated requests or require authentication.`;
          break;
        case 404:
          errorMessage = `Page not found (${response.status}). The URL may be incorrect or the page may have been moved.`;
          break;
        case 429:
          errorMessage = `Rate limited (${response.status}). The site is temporarily blocking requests due to too many attempts.`;
          break;
        case 503:
          errorMessage = `Service unavailable (${response.status}). The site may be temporarily down or overloaded.`;
          break;
        default:
          errorMessage = `Failed to fetch URL: HTTP ${response.status} - ${response.statusText}`;
      }
      
      return {
        content: [{ 
          type: "text", 
          text: errorMessage
        }]
      };
    }
    
    // Check content type to handle non-HTML content appropriately
    const contentType = response.headers.get('content-type') || '';
    log("Content-Type:", contentType);
    
    // Handle non-HTML content types
    if (!contentType.includes('text/html') && !contentType.includes('application/xhtml')) {
      const fileExtension = validUrl.pathname.split('.').pop()?.toLowerCase();
      
      if (['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx'].includes(fileExtension || '')) {
        return {
          content: [{ 
            type: "text", 
            text: `Cannot extract text from ${fileExtension?.toUpperCase() || 'binary'} files. This URL points to a ${contentType || 'binary'} file, not a web page. Please provide a URL to an HTML web page for text extraction.` 
          }]
        };
      }
      
      if (contentType.includes('application/') || contentType.includes('image/') || contentType.includes('video/') || contentType.includes('audio/')) {
        return {
          content: [{ 
            type: "text", 
            text: `Cannot extract text from ${contentType} content. This URL points to a binary file, not a web page. Please provide a URL to an HTML web page for text extraction.` 
          }]
        };
      }
    }
    
    const html = await response.text();
    log("Fetched content length:", html.length);
    
    // Check if content looks like binary data (common with encoding issues)
    const binaryPattern = /[\x00-\x08\x0E-\x1F\x7F-\xFF]/g;
    const binaryMatches = html.match(binaryPattern);
    if (binaryMatches && binaryMatches.length > html.length * 0.1) {
      return {
        content: [{ 
          type: "text", 
          text: `This URL appears to contain binary data or has encoding issues. The content cannot be properly extracted as readable text. Please verify the URL points to a standard HTML web page.` 
        }]
      };
    }
    
    // Enhanced content extraction with better DOM parsing
    const dom = new JSDOM(html, { 
      url: validUrl.toString(),
      pretendToBeVisual: true,
      resources: "usable"
    });
    
    // Wait a moment for any immediate DOM updates
    await new Promise(resolve => setTimeout(resolve, 100));
    
    const document = dom.window.document;
    
    // Remove unwanted elements that interfere with content extraction
    const unwantedSelectors = [
      'script', 'style', 'nav', 'header', 'footer', 'aside', 
      '.advertisement', '.ads', '.social-share', '.comments',
      '.sidebar', '.menu', '.navigation', '.cookie-notice',
      '[class*="ad-"]', '[id*="ad-"]', '[class*="social"]'
    ];
    
    unwantedSelectors.forEach(selector => {
      const elements = document.querySelectorAll(selector);
      elements.forEach(el => el.remove());
    });
    
    // Try Readability first
    const reader = new Readability(document);
    const article = reader.parse();
    
    let extractedContent;
    if (article && article.textContent && article.textContent.trim().length > 100) {
      log("Readability extraction successful");
      extractedContent = `**${article.title || document.title || "Untitled"}**\n\n`;
      if (article.byline) {
        extractedContent += `By: ${article.byline}\n\n`;
      }
      extractedContent += safeText(article.textContent || "", max_chars);
    } else {
      log("Readability failed, trying enhanced fallback extraction");
      
      // Enhanced fallback: try to find main content areas
      const contentSelectors = [
        'main', 'article', '[role="main"]', '.main-content', '.content',
        '.post-content', '.entry-content', '.article-content', '.story-body',
        '#content', '#main', '.container .content', '.page-content'
      ];
      
      let bestContent = "";
      let bestScore = 0;
      
      for (const selector of contentSelectors) {
        const elements = document.querySelectorAll(selector);
        for (const element of elements) {
          const text = element.textContent || "";
          const score = text.length;
          if (score > bestScore && score > 200) {
            bestContent = text;
            bestScore = score;
          }
        }
      }
      
      // If no good content found, fall back to body
      if (!bestContent || bestContent.trim().length < 100) {
        bestContent = document.body?.textContent || "";
      }
      
      // Check if content is meaningful
      if (bestContent.trim().length < 100) {
        // Try one more approach: look for paragraphs
        const paragraphs = Array.from(document.querySelectorAll('p'))
          .map(p => p.textContent || "")
          .filter(text => text.trim().length > 20)
          .join("\n\n");
        
        if (paragraphs.length > 100) {
          bestContent = paragraphs;
        } else {
          return {
            content: [{ 
              type: "text", 
              text: `Unable to extract meaningful text content from this URL. The page may be:\n- A single-page application that loads content with JavaScript\n- A page with mostly images or media\n- Protected by authentication or paywall\n- Not a standard HTML page\n- Blocked by anti-bot measures\n\nPage title: ${document.title || "No title"}\nTry accessing the URL directly in a browser to verify the content is accessible.` 
            }]
          };
        }
      }
      
      extractedContent = `**${document.title || "Untitled"}**\n\n`;
      extractedContent += safeText(bestContent, max_chars);
    }
    
    // Final check for garbled content
    const cleanContent = extractedContent.replace(/[^\x20-\x7E\n\r\t]/g, '');
    if (cleanContent.length < extractedContent.length * 0.5) {
      return {
        content: [{ 
          type: "text", 
          text: `The extracted content contains significant encoding issues or non-text data. This may be due to:\n- Character encoding problems\n- Binary content mixed with text\n- Non-standard page format\n\nPage title: ${dom.window.document.title || "No title"}\nURL: ${validUrl.toString()}` 
        }]
      };
    }
    
    log("Content extraction completed, content length:", extractedContent.length);
    
    // Add warning if approaching limit
    if (limitCheck.warning) {
      extractedContent += `\n\n${limitCheck.warning}`;
    }
    
    return {
      content: [{ type: "text", text: extractedContent }]
    };
    
  } catch (error) {
    log("Exception in web_fetch:", error);
    
    return {
      content: [{ 
        type: "text", 
        text: `Fetch failed: ${error.message}` 
      }]
    };
  }
}

// ---------- Server Handlers ----------
server.setRequestHandler(ListToolsRequestSchema, async (request) => {
  detailedLog("INCOMING_REQUEST", {
    method: "tools/list",
    request: request,
    timestamp: new Date().toISOString()
  });
  
  const response = {
    tools: TOOLS,
  };
  
  detailedLog("OUTGOING_RESPONSE", {
    method: "tools/list",
    response: response,
    timestamp: new Date().toISOString()
  });
  
  return response;
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  
  detailedLog("INCOMING_REQUEST", {
    method: "tools/call",
    tool_name: name,
    arguments: args,
    full_request: request,
    timestamp: new Date().toISOString()
  });
  
  log("Tool called:", name, "with args:", args);
  
  let response;
  let error = null;
  
  try {
    switch (name) {
      case "web_search":
        response = await handleWebSearch(args || {});
        break;
      case "web_fetch":
        response = await handleWebFetch(args || {});
        break;
      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  } catch (err) {
    error = err;
    response = {
      content: [{ 
        type: "text", 
        text: `Tool execution failed: ${err.message}` 
      }]
    };
  }
  
  detailedLog("OUTGOING_RESPONSE", {
    method: "tools/call",
    tool_name: name,
    response: response,
    error: error ? {
      message: error.message,
      stack: error.stack
    } : null,
    timestamp: new Date().toISOString()
  });
  
  if (error) {
    detailedLog("ERROR", {
      method: "tools/call",
      tool_name: name,
      error_details: {
        message: error.message,
        stack: error.stack,
        arguments: args
      },
      timestamp: new Date().toISOString()
    });
  }
  
  return response;
});

// ---------- Connect and Start ----------
async function main() {
  // Log server startup
  detailedLog("SERVER_STARTUP", {
    server_info: {
      name: "mcp-web-tools-final",
      version: "0.6.0",
      searxng_base: SEARXNG_BASE,
      debug_enabled: DEBUG,
      detailed_log_enabled: DETAILED_LOG,
      log_file: LOG_FILE
    },
    environment: {
      node_version: process.version,
      platform: process.platform,
      cwd: process.cwd(),
      argv: process.argv
    },
    timestamp: new Date().toISOString()
  });

  // Note: Initialization is handled automatically by the MCP SDK
  // We'll capture it through transport-level logging if needed

  // Log all unhandled requests
  server.onerror = (error) => {
    detailedLog("SERVER_ERROR", {
      error: {
        message: error.message,
        stack: error.stack,
        name: error.name
      },
      timestamp: new Date().toISOString()
    });
    console.error("Server error:", error);
  };

  const transport = new StdioServerTransport();
  
  detailedLog("TRANSPORT_CONNECTING", {
    transport_type: "stdio",
    timestamp: new Date().toISOString()
  });

  await server.connect(transport);
  
  detailedLog("SERVER_READY", {
    message: "MCP Web Tools Server is ready and listening",
    timestamp: new Date().toISOString()
  });
  
  console.error("MCP Web Tools Server ready");
  console.error(`[mcp-web-tools-working] SearxNG Base: ${SEARXNG_BASE}`);
  console.error(`[mcp-web-tools-working] Debug mode: ${DEBUG}`);
  console.error(`[mcp-web-tools-working] Detailed logging: ${DETAILED_LOG ? 'ENABLED' : 'DISABLED'}`);
  if (DETAILED_LOG) {
    console.error(`[mcp-web-tools-working] Log file: ${LOG_FILE}`);
  }
}

// Add process event handlers for cleanup logging
process.on('SIGINT', () => {
  detailedLog("SERVER_SHUTDOWN", {
    reason: "SIGINT",
    timestamp: new Date().toISOString()
  });
  process.exit(0);
});

process.on('SIGTERM', () => {
  detailedLog("SERVER_SHUTDOWN", {
    reason: "SIGTERM", 
    timestamp: new Date().toISOString()
  });
  console.error("[mcp-web-tools-working] Shutting down gracefully...");
  process.exit(0);
});

main().catch((error) => {
  console.error("Fatal error in main():", error);
  process.exit(1);
});
