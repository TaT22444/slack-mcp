#!/usr/bin/env node

// NOROSHI Slack MCP Server
// 社内業務効率化のためのSlack連携サーバー

// .envファイルから環境変数を読み込み
require('dotenv').config({ path: '../.env' });

const { spawn } = require('child_process');
const path = require('path');

console.log('🔧 Loading environment variables from .env file...');

// 環境変数の確認
if (!process.env.SLACK_BOT_TOKEN) {
  console.error('❌ SLACK_BOT_TOKEN environment variable is required');
  console.error('💡 Please set your Slack Bot Token in the .env file');
  console.error('📄 Check the .env file in the NOROSHI project root');
  process.exit(1);
}

if (!process.env.SLACK_TEAM_ID) {
  console.error('❌ SLACK_TEAM_ID environment variable is required');
  console.error('💡 Please set your Slack Team ID in the .env file');
  console.error('📄 Check the .env file in the NOROSHI project root');
  process.exit(1);
}

console.log('🚀 Starting NOROSHI Slack MCP Server...');
console.log(`📁 Working directory: ${__dirname}`);
console.log(`🏢 Team ID: ${process.env.SLACK_TEAM_ID}`);
console.log(`🔗 Bot Token: ${process.env.SLACK_BOT_TOKEN.substring(0, 20)}...`);

// Slack MCPサーバーを実行
const serverPath = path.join(__dirname, 'node_modules', '@modelcontextprotocol', 'server-slack', 'dist', 'index.js');

console.log(`📦 Server path: ${serverPath}`);

// 子プロセスとしてサーバーを起動
const serverProcess = spawn('node', [serverPath], {
  stdio: 'inherit',
  env: {
    ...process.env,
    SLACK_BOT_TOKEN: process.env.SLACK_BOT_TOKEN,
    SLACK_TEAM_ID: process.env.SLACK_TEAM_ID
  }
});

// プロセスイベントの処理
serverProcess.on('close', (code) => {
  console.log(`\n🔚 NOROSHI Slack MCP Server exited with code ${code}`);
});

serverProcess.on('error', (error) => {
  console.error(`❌ Error starting server: ${error.message}`);
});

// プロセス終了時のクリーンアップ
process.on('SIGINT', () => {
  console.log('\n🛑 Shutting down NOROSHI Slack MCP Server...');
  serverProcess.kill('SIGINT');
});

process.on('SIGTERM', () => {
  console.log('\n🛑 NOROSHI Slack MCP Server terminated');
  serverProcess.kill('SIGTERM');
}); 