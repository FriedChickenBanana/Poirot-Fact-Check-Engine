const { spawn } = require('child_process');
const path = require('path');

console.log('🧪 Starting Model Context Protocol (MCP) Integration Tests...');

const serverPath = path.join(__dirname, 'mcpServer.js');
const mcp = spawn('node', [serverPath]);

let buffer = '';
let currentTest = 'initialize';
let idCounter = 1;

mcp.stdout.setEncoding('utf-8');
mcp.stderr.setEncoding('utf-8');

mcp.stderr.on('data', (data) => {
  // All log outputs redirected to stderr should be shown as debug trace
  console.log(`[Server Trace] ${data.trim()}`);
});

mcp.stdout.on('data', (chunk) => {
  buffer += chunk;
  let lineEnd;
  while ((lineEnd = buffer.indexOf('\n')) !== -1) {
    const line = buffer.slice(0, lineEnd).trim();
    buffer = buffer.slice(lineEnd + 1);
    if (line) {
      handleResponse(line);
    }
  }
});

mcp.on('exit', (code) => {
  if (code !== 0 && code !== null) {
    console.error(`❌ Server exited unexpectedly with code ${code}`);
    process.exit(1);
  }
});

function sendRequest(method, params = {}) {
  const req = {
    jsonrpc: '2.0',
    id: idCounter++,
    method,
    params
  };
  console.log(`\n➡️ Sending request: ${method}`);
  mcp.stdin.write(JSON.stringify(req) + '\n');
}

function handleResponse(line) {
  try {
    const res = JSON.parse(line);
    console.log(`⬅️ Received response:`, JSON.stringify(res, null, 2));

    if (res.error) {
      console.error(`❌ Test failed with JSON-RPC Error:`, res.error);
      cleanupAndExit(1);
    }

    if (currentTest === 'initialize') {
      // Assert initialize response structure
      if (res.result && res.result.protocolVersion && res.result.serverInfo) {
        console.log('✅ Handshake Initialize: SUCCESS');
        
        // Send initialized notification
        const notification = {
          jsonrpc: '2.0',
          method: 'notifications/initialized'
        };
        mcp.stdin.write(JSON.stringify(notification) + '\n');
        
        // Move to next test
        currentTest = 'ping';
        sendRequest('ping');
      } else {
        console.error('❌ Handshake Initialize: FAILED (missing fields)');
        cleanupAndExit(1);
      }
    } else if (currentTest === 'ping') {
      console.log('✅ Ping: SUCCESS');
      
      // Move to tools list test
      currentTest = 'tools/list';
      sendRequest('tools/list');
    } else if (currentTest === 'tools/list') {
      const tools = res.result?.tools;
      if (Array.isArray(tools) && tools.length > 0) {
        console.log(`✅ Tools Registration: SUCCESS (Found ${tools.length} tools)`);
        const toolNames = tools.map(t => t.name);
        console.log('   Available tools:', toolNames.join(', '));
        
        // Assert expected tools are registered
        const expectedTools = ['verify_claim', 'query_rag', 'query_graph_rag', 'query_google_fact_check', 'get_source_trust_score', 'scrape_web_page'];
        const missingTools = expectedTools.filter(t => !toolNames.includes(t));
        if (missingTools.length === 0) {
          console.log('✅ All expected tools are registered correctly!');
          console.log('\n🎉 ALL MCP TESTS PASSED SUCCESSFULLY!');
          cleanupAndExit(0);
        } else {
          console.error(`❌ Missing registered tools: ${missingTools.join(', ')}`);
          cleanupAndExit(1);
        }
      } else {
        console.error('❌ Tools Registration: FAILED (no tools returned)');
        cleanupAndExit(1);
      }
    }
  } catch (err) {
    console.error('❌ Failed to parse response JSON:', err.message);
    console.error('   Raw line:', line);
    cleanupAndExit(1);
  }
}

function cleanupAndExit(code) {
  console.log('Shutting down MCP server test process...');
  mcp.stdin.end();
  mcp.kill();
  process.exit(code);
}

// Start handshake
sendRequest('initialize', {
  protocolVersion: '2024-11-05',
  clientInfo: { name: 'poirot-test-client', version: '1.0.0' },
  capabilities: {}
});
setTimeout(() => {
  console.error('⏰ Test Timeout: Server did not respond in time.');
  cleanupAndExit(1);
}, 5000);
