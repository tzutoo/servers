#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema
} from "@modelcontextprotocol/sdk/types.js";
import axios from "axios";
import * as cheerio from "cheerio";

interface SearchResult {
  title: string;
  url: string;
  snippet?: string;
}

interface NextPageParams {
  s: string;
  nextParams: string;
  v: string;
  o: string;
  dc: string;
  api: string;
  vqd: string;
  kl: string;
}

const server = new Server(
  {
    name: "duckduckgo-search",
    version: "1.0.0"
  },
  {
    capabilities: {
      tools: {}
    }
  }
);

async function searchDuckDuckGo(query: string, maxResults: number = 30): Promise<SearchResult[]> {
  console.error('[DDG] Starting search for:', query);
  const allResults = new Map<string, SearchResult>(); // Use Map to deduplicate by URL
  let currentPage = 1;
  let nextParams: Record<string, string> = {};

  try {
    while (allResults.size < maxResults) {
      console.error(`[DDG] Fetching page ${currentPage}...`);
      
      // Prepare form data for the request
      const formData = new URLSearchParams({
        'q': query,
        'kl': 'us-en',
        ...nextParams
      });

      const response = await axios.post('https://lite.duckduckgo.com/lite/', formData, {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36'
        }
      });

      const $ = cheerio.load(response.data);
      let foundNewResults = false;
      
      // Extract results from the current page
      $('tr').each((_, row) => {
        const $row = $(row);
        const firstCell = $row.find('td').first().text().trim();
        
        // Check if this is a numbered result row
        if (/^\d+\.$/.test(firstCell)) {
          const $resultCell = $row.find('td').last();
          const $link = $resultCell.find('a.result-link');
          const title = $link.text().trim();
          const url = $link.attr('href') || '';
          
          // Get the snippet from the next row
          const snippetRow = $row.next('tr');
          const snippet = snippetRow.find('td.result-snippet').text().trim();
          
          if (title && url && !allResults.has(url)) {
            allResults.set(url, { title, url, snippet });
            foundNewResults = true;
          }
        }
      });

      console.error(`[DDG] Found ${allResults.size} unique results so far`);
      
      // If we didn't find any new results on this page, or we have enough results, break
      if (!foundNewResults || allResults.size >= maxResults) break;

      // Extract next page parameters from the form
      const nextForm = $('form.next_form, form[action="/lite/"]').last();
      if (!nextForm.length) {
        console.error('[DDG] No next page form found');
        break;
      }

      // Get all hidden inputs for next page
      nextParams = {};
      nextForm.find('input[type="hidden"]').each((_, input) => {
        const name = $(input).attr('name');
        const value = $(input).val();
        if (name && typeof value === 'string') {
          nextParams[name] = value;
        }
      });

      // Debug log the next page parameters
      console.error('[DDG] Next page params:', nextParams);

      if (!Object.keys(nextParams).length) {
        console.error('[DDG] No next page parameters found');
        break;
      }

      currentPage++;
    }

    console.error(`[DDG] Search complete. Found ${allResults.size} unique results`);
    return Array.from(allResults.values()).slice(0, maxResults);
  } catch (error) {
    console.error('[DDG] Search failed:', error);
    throw error;
  }
}

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [{
    name: "search",
    description: "Search DuckDuckGo and get results",
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Search query"
        },
        maxResults: {
          type: "number",
          description: "Maximum number of results to return (default: 30)",
          minimum: 1,
          maximum: 100
        }
      },
      required: ["query"]
    }
  }]
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  if (request.params.name !== "search") {
    throw new Error("Unknown tool");
  }

  if (!request.params.arguments || typeof request.params.arguments !== 'object') {
    throw new Error("Invalid arguments");
  }

  const { query, maxResults = 30 } = request.params.arguments as { 
    query?: unknown;
    maxResults?: unknown;
  };

  if (typeof query !== "string") {
    throw new Error("Invalid query parameter");
  }

  if (maxResults !== undefined && 
      (typeof maxResults !== "number" || maxResults < 1 || maxResults > 100)) {
    throw new Error("Invalid maxResults parameter (must be between 1 and 100)");
  }

  try {
    const results = await searchDuckDuckGo(query, maxResults);
    return {
      content: [{
        type: "text",
        text: JSON.stringify(results, null, 2)
      }]
    };
  } catch (error) {
    console.error('[DDG] Error in request handler:', error);
    return {
      content: [{
        type: "text",
        text: `Error performing search: ${error}`
      }],
      isError: true
    };
  }
});

server.onerror = (error) => console.error('[DDG Error]', error);

const transport = new StdioServerTransport();
await server.connect(transport);

console.error('[DDG] DuckDuckGo search MCP server running on stdio');
