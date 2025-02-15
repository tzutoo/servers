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
  const allResults = new Map<string, SearchResult>();
  let nextPageParams: Record<string, string> = {
    q: query,
    kl: 'us-en'
  };

  try {
    while (allResults.size < maxResults) {
      console.error('\n[DDG] Sending request with params:', nextPageParams);
      
      const response = await axios.post('https://lite.duckduckgo.com/lite/', 
        new URLSearchParams(nextPageParams),
        {
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36'
          }
        }
      );

      console.error('\n[DDG] Response HTML:', response.data);

      const $ = cheerio.load(response.data);
      let foundNewResults = false;

      // Log all tr elements for debugging
      console.error('\n[DDG] Found table rows:');
      $('tr').each((i, row) => {
        console.error(`Row ${i}:`, $(row).html());
      });

      // Process results table
      $('tr').each((_, row) => {
        const $row = $(row);
        const $firstCell = $row.find('td').first();
        const firstCellText = $firstCell.text().trim();

        console.error('\n[DDG] Processing row with first cell:', firstCellText);

        // Check for numbered result rows (e.g., "1.", "2.", etc.)
        if (/^\d+\.$/.test(firstCellText)) {
          const $link = $row.find('a.result-link');
          const title = $link.text().trim();
          const url = $link.attr('href');
          
          // Get snippet from the next row's result-snippet cell
          const $snippetRow = $row.next('tr');
          const snippet = $snippetRow.find('td.result-snippet').text().trim();

          console.error('[DDG] Found potential result:', {
            title,
            url,
            snippet: snippet.substring(0, 50) + '...'
          });

          if (title && url && !allResults.has(url)) {
            allResults.set(url, { title, url, snippet });
            foundNewResults = true;
            console.error('[DDG] Added result:', title);
          }
        }
      });

      console.error(`\n[DDG] Found ${allResults.size} total results`);

      if (!foundNewResults || allResults.size >= maxResults) {
        console.error('[DDG] No new results or reached max results');
        break;
      }

      // Find next page form and extract navigation parameters
      const nextForms = $('form');
      console.error('\n[DDG] Found forms:', nextForms.length);
      nextForms.each((i, form) => {
        console.error(`Form ${i}:`, $(form).html());
      });

      // Look specifically for the next page form
      const $nextForm = $('form:has(input.navbutton[value="Next Page >"])');
      if (!$nextForm.length) {
        console.error('[DDG] No next page form found');
        break;
      }

      // Check for next page button
      const $nextButton = $nextForm.find('input.navbutton[value="Next Page >"]');
      if (!$nextButton.length) {
        console.error('[DDG] No next page button found');
        break;
      }

      // Extract next page parameters from hidden inputs
      nextPageParams = { q: query, kl: 'us-en' };
      $nextForm.find('input[type="hidden"]').each((_, input) => {
        const name = $(input).attr('name');
        const value = $(input).val();
        if (name && typeof value === 'string') {
          nextPageParams[name] = value;
          console.error(`[DDG] Next page param: ${name}=${value}`);
        }
      });

      console.error('\n[DDG] Next page params:', nextPageParams);
    }

    const results = Array.from(allResults.values()).slice(0, maxResults);
    console.error(`\n[DDG] Returning ${results.length} results`);
    return results;

  } catch (error) {
    console.error('\n[DDG] Search failed:', error);
    if (axios.isAxiosError(error)) {
      console.error('[DDG] Response data:', error.response?.data);
    }
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
