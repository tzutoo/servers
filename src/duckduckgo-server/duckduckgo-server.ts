#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema
} from "@modelcontextprotocol/sdk/types.js";
import axios from "axios";
import * as cheerio from "cheerio";

// Create an MCP server
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

interface SearchResult {
  title: string;
  url: string;
  date?: string; // Optional since DDG lite doesn't provide dates
}

async function searchDuckDuckGo(query: string): Promise<SearchResult[]> {
  try {
    const response = await axios.post(
      'https://lite.duckduckgo.com/lite/', 
      new URLSearchParams({
        'q': query
      }).toString(),
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded'
        }
      }
    );

    const $ = cheerio.load(response.data);
    const results: SearchResult[] = [];

    $('table tr').each((i, element) => {
      const resultLink = $(element).find('a.result-link');
      const linkText = $(element).find('span.link-text');

      if (resultLink.length > 0 && linkText.length > 0) {
        results.push({
          title: resultLink.text().trim(),
          url: resultLink.attr('href') || '',
        });
      }
    });

    return results;
  } catch (error) {
    console.error('Search failed:', error);
    throw error;
  }
}

// List available tools
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

// Handle search tool calls
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
    return {
      content: [{
        type: "text",
        text: `Error performing search: ${error}`
      }],
      isError: true
    };
  }
});

// Start receiving messages on stdin and sending messages on stdout
const transport = new StdioServerTransport();
await server.connect(transport);

console.error('DuckDuckGo search MCP server running on stdio');