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

async function searchDuckDuckGo(query: string): Promise<SearchResult[]> {
  try {
    console.error('[DDG] Searching for:', query);
    
    const response = await axios.post(
      'https://lite.duckduckgo.com/lite/',
      new URLSearchParams({
        'q': query,
        'kl': 'us-en'
      }).toString(),
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36'
        }
      }
    );

    const $ = cheerio.load(response.data);
    const results: SearchResult[] = [];
    
    // Find all result rows (they start with a number followed by a period)
    $('tr').each((_, row) => {
      const $row = $(row);
      const firstCell = $row.find('td').first().text().trim();
      
      // Check if this is a numbered result row
      if (/^\d+\.$/.test(firstCell)) {
        const resultLink = $row.find('a.result-link');
        const title = resultLink.text().trim();
        const url = resultLink.attr('href');
        
        // Get the next row for snippet
        const snippetRow = $row.next('tr');
        const snippet = snippetRow.find('td.result-snippet').text().trim();
        
        if (title && url) {
          results.push({
            title,
            url,
            snippet
          });
        }
      }
    });

    console.error('[DDG] Found results:', results.length);
    return results;
  } catch (error) {
    if (axios.isAxiosError(error)) {
      console.error('[DDG] Network error:', {
        status: error.response?.status,
        statusText: error.response?.statusText,
        data: error.response?.data
      });
    } else {
      console.error('[DDG] Search failed:', error);
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

  const { query } = request.params.arguments as { query?: unknown };
  if (typeof query !== "string") {
    throw new Error("Invalid query parameter");
  }

  try {
    const results = await searchDuckDuckGo(query);
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
