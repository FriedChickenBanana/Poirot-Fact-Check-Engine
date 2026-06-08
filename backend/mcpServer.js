// ══════════════════════════════════════════════════════════════════════════
// POIROT MCP SERVER — Model Context Protocol implementation over stdio
// ══════════════════════════════════════════════════════════════════════════

// Redirect all standard console output to stderr before loading any dependencies.
// This is critical because any standard print on stdout will corrupt the
// JSON-RPC stream and crash Cursor / Claude Desktop / Claude Code.
const originalConsoleLog = console.log;
console.log = (...args) => {
  process.stderr.write(args.map(x => typeof x === 'object' ? JSON.stringify(x) : String(x)).join(' ') + '\n');
};
console.info = console.log;
console.warn = (...args) => {
  process.stderr.write('WARN: ' + args.map(x => typeof x === 'object' ? JSON.stringify(x) : String(x)).join(' ') + '\n');
};
console.error = (...args) => {
  process.stderr.write('ERROR: ' + args.map(x => typeof x === 'object' ? JSON.stringify(x) : String(x)).join(' ') + '\n');
};

require('dotenv').config();
const crypto = require('crypto');
const { orchestrate } = require('./services/agentOrchestrator');
const { searchRelevantContext } = require('./services/ragService');
const { retrieveGraphContext } = require('./services/graphRagService');
const { queryGoogleFactCheck } = require('./services/factCheckService');
const { computeTrustScore } = require('./services/trustScoringService');
const { extractFromSocialMedia } = require('./services/socialMediaService');
const { buildImageBlock } = require('./utils/helpers');

// Helper to normalize the verdict code for UI/compatibility
function normalizeVerdictCode(verdict) {
  const v = (verdict || '').toLowerCase();
  if (v.includes('satir') || v.includes('ব্যঙ্গ')) return 'satirical';
  if (v.includes('false') || v.includes('মিথ্যা')) return 'false';
  if (v.includes('true') || v.includes('সত্য')) return 'true';
  if (v.includes('error') || v.includes('ত্রুটি')) return 'error';
  return 'uncertain';
}

// ── MCP Protocol Handlers ──────────────────────────────────────────────────

const TOOLS = [
  {
    name: 'verify_claim',
    description: 'Verify a fact-checking claim (text or image) using Poirot\'s multi-agent orchestration pipeline. Returns verdict, confidence, key findings, trust score, and sources.',
    inputSchema: {
      type: 'object',
      properties: {
        content: { type: 'string', description: 'The text claim content to verify' },
        type: { type: 'string', enum: ['text', 'image'], default: 'text', description: 'The type of claim: text or image' },
        base64: { type: 'string', description: 'Base64 data URI of the image (required if type is image)' },
        persona: { type: 'string', enum: ['General Public', 'Youth/Student', 'Journalist'], default: 'General Public', description: 'Target audience persona for the explanation style' },
        language: { type: 'string', enum: ['en', 'bn', 'auto'], default: 'auto', description: 'Language preference (\'bn\' for Bengali, \'en\' for English)' }
      },
      required: ['content']
    }
  },
  {
    name: 'query_rag',
    description: 'Queries Poirot\'s semantic PGVector RAG store for similar verified facts and known misinformation patterns.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'The query text to search for matches in the vector database' },
        topK: { type: 'number', default: 3, description: 'Maximum number of context matches to retrieve' }
      },
      required: ['query']
    }
  },
  {
    name: 'query_graph_rag',
    description: 'Retrieves entities and relationship subgraphs from Poirot\'s PostgreSQL knowledge graph database.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'The claim text or entity name to search for in the graph database' },
        topK: { type: 'number', default: 3, description: 'Maximum number of entity matches to retrieve' }
      },
      required: ['query']
    }
  },
  {
    name: 'query_google_fact_check',
    description: 'Searches the Google Fact Check Tools database directly for existing ratings on a query.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'The text query to search' }
      },
      required: ['query']
    }
  },
  {
    name: 'get_source_trust_score',
    description: 'Calculates the credibility and trust score for a set of URLs or domains based on past check history and bias factors.',
    inputSchema: {
      type: 'object',
      properties: {
        sourceUrls: { type: 'array', items: { type: 'string' }, description: 'List of domain names or full URLs to assess' }
      },
      required: ['sourceUrls']
    }
  },
  {
    name: 'scrape_web_page',
    description: 'Scrapes the text content and metadata from a general webpage or social media URL (X, Facebook, YouTube, etc.).',
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'The webpage or social media post URL to scrape' }
      },
      required: ['url']
    }
  }
];

async function handleRequest(messageStr) {
  let id = null;
  try {
    const request = JSON.parse(messageStr);
    id = request.id;

    if (request.jsonrpc !== '2.0') {
      sendError(id, -32600, 'Invalid Request: Not JSON-RPC 2.0');
      return;
    }

    switch (request.method) {
      case 'initialize':
        sendResult(id, {
          protocolVersion: '2024-11-05',
          capabilities: {
            tools: {}
          },
          serverInfo: {
            name: 'poirot-factcheck-mcp',
            version: '2.0.0'
          }
        });
        break;

      case 'notifications/initialized':
        // Client initialized acknowledgement — nothing to respond
        console.error('MCP connection initialized successfully');
        break;

      case 'ping':
        sendResult(id, {});
        break;

      case 'tools/list':
        sendResult(id, { tools: TOOLS });
        break;

      case 'tools/call':
        const { name, arguments: args } = request.params || {};
        const result = await executeTool(name, args);
        sendResult(id, result);
        break;

      default:
        sendError(id, -32601, `Method not found: ${request.method}`);
        break;
    }
  } catch (err) {
    sendError(id, -32603, `Internal error: ${err.message}`);
  }
}

async function executeTool(name, args) {
  console.error(`Executing MCP Tool: ${name}`, JSON.stringify(args));
  try {
    switch (name) {
      case 'verify_claim': {
        const { type = 'text', content, base64, persona = 'General Public', language = 'auto' } = args;
        const imageBlock = type === 'image' && base64 ? buildImageBlock(base64) : null;
        const langOverride = (language === 'bn' || language === 'en') ? language : null;

        const result = await orchestrate({
          type,
          content: content || 'image claim',
          base64,
          imageBlock,
          persona,
          language: langOverride
        });

        result.verdict_code = normalizeVerdictCode(result.verdict);
        
        // Compute trust score
        const cacheKey = type === 'image' && base64
          ? crypto.createHash('sha256').update(base64).digest('hex')
          : (content || '');
        const claimHash = crypto.createHash('sha256').update(`${type}:${cacheKey}`).digest('hex');
        
        const trustResult = await computeTrustScore({
          sourceUrls: result.sources,
          claimHash,
          confidence: result.confidence,
          verdict: result.verdict,
        });
        
        result.trust_score = trustResult.trust_score;
        result.trust_breakdown = trustResult.breakdown;

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2)
            }
          ]
        };
      }

      case 'query_rag': {
        const { query, topK = 3 } = args;
        const context = await searchRelevantContext(query, topK);
        return {
          content: [
            {
              type: 'text',
              text: context || 'No relevant RAG context found.'
            }
          ]
        };
      }

      case 'query_graph_rag': {
        const { query, topK = 3 } = args;
        const context = await retrieveGraphContext(query, topK);
        return {
          content: [
            {
              type: 'text',
              text: context || 'No relevant GraphRAG entities found.'
            }
          ]
        };
      }

      case 'query_google_fact_check': {
        const { query } = args;
        const checks = await queryGoogleFactCheck(query);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(checks, null, 2)
            }
          ]
        };
      }

      case 'get_source_trust_score': {
        const { sourceUrls } = args;
        const trustResult = await computeTrustScore({
          sourceUrls,
          claimHash: 'mcp-trust-score-query',
          confidence: 100,
          verdict: 'Uncertain'
        });
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(trustResult, null, 2)
            }
          ]
        };
      }

      case 'scrape_web_page': {
        const { url } = args;
        const text = await extractFromSocialMedia(url);
        return {
          content: [
            {
              type: 'text',
              text: text || 'Could not extract content from the URL.'
            }
          ]
        };
      }

      default:
        throw new Error(`Tool not found: ${name}`);
    }
  } catch (err) {
    console.error(`Error executing tool ${name}:`, err.message);
    return {
      isError: true,
      content: [
        {
          type: 'text',
          text: `Error executing tool: ${err.message}`
        }
      ]
    };
  }
}

function sendResult(id, result) {
  const response = {
    jsonrpc: '2.0',
    id,
    result
  };
  // Write to stdout (must be a single line)
  originalConsoleLog(JSON.stringify(response));
}

function sendError(id, code, message) {
  const response = {
    jsonrpc: '2.0',
    id,
    error: {
      code,
      message
    }
  };
  originalConsoleLog(JSON.stringify(response));
}

// ── Read incoming stdin JSON-RPC streams ───────────────────────────────────

let buffer = '';
process.stdin.on('data', chunk => {
  buffer += chunk;
  let lineEnd;
  while ((lineEnd = buffer.indexOf('\n')) !== -1) {
    const line = buffer.slice(0, lineEnd).trim();
    buffer = buffer.slice(lineEnd + 1);
    if (line) {
      handleRequest(line);
    }
  }
});

process.stdin.on('end', () => {
  console.error('MCP server stdio stream ended. Exiting.');
  process.exit(0);
});
