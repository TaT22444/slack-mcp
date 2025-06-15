#!/usr/bin/env node

// NOROSHI タスク自動監視・転送システム
// [タスク]パターンを検出して自動的に#generalに転送

require('dotenv').config({ path: '../.env' });
const { App } = require('@slack/bolt');

console.log('🔧 Loading environment variables from .env file...');

// 環境変数の確認
if (!process.env.SLACK_BOT_TOKEN) {
  console.error('❌ SLACK_BOT_TOKEN environment variable is required');
  process.exit(1);
}

if (!process.env.SLACK_SIGNING_SECRET) {
  console.error('❌ SLACK_SIGNING_SECRET environment variable is required');
  console.error('💡 Please add SLACK_SIGNING_SECRET to your .env file');
  console.error('📄 You can find this in your Slack App settings > Basic Information');
  process.exit(1);
}

console.log('🚀 Starting NOROSHI Task Monitor...');
console.log(`🔗 Bot Token: ${process.env.SLACK_BOT_TOKEN.substring(0, 20)}...`);

// Slack Boltアプリの初期化
const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  signingSecret: process.env.SLACK_SIGNING_SECRET,
  socketMode: false, // HTTP モードを使用
  port: process.env.PORT || 3000
});

// #generalチャンネルのID（実際のIDに置き換え）
const GENERAL_CHANNEL_ID = 'C02TJS8D205';

// タスクパターンの正規表現
const TASK_PATTERNS = [
  /\[タスク\]/i,
  /\[本日のタスク\]/i,
  /\[今日のタスク\]/i,
  /\[task\]/i,
  /\[todo\]/i,
  /\[やること\]/i
];

// メッセージイベントの監視
app.message(async ({ message, client, logger }) => {
  try {
    // ボット自身のメッセージは無視
    if (message.bot_id) {
      return;
    }

    // #generalチャンネルのメッセージは無視（無限ループ防止）
    if (message.channel === GENERAL_CHANNEL_ID) {
      return;
    }

    const messageText = message.text || '';
    
    // タスクパターンをチェック
    const isTaskMessage = TASK_PATTERNS.some(pattern => pattern.test(messageText));
    
    if (isTaskMessage) {
      console.log('📋 Task message detected!');
      console.log(`📍 Channel: ${message.channel}`);
      console.log(`👤 User: ${message.user}`);
      console.log(`💬 Message: ${messageText}`);

      // ユーザー情報を取得
      const userInfo = await client.users.info({
        user: message.user
      });

      const userName = userInfo.user.display_name || userInfo.user.real_name || userInfo.user.name;

      // チャンネル情報を取得
      const channelInfo = await client.conversations.info({
        channel: message.channel
      });

      const channelName = channelInfo.channel.name;

      // #generalに転送メッセージを投稿
      await client.chat.postMessage({
        channel: GENERAL_CHANNEL_ID,
        text: `📋 ${userName}さんのタスク (#${channelName}より自動転送)`,
        blocks: [
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: `📋 *${userName}さんのタスク* (#${channelName}より自動転送)`
            }
          },
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: `${messageText}`
            }
          },
          {
            type: 'context',
            elements: [
              {
                type: 'mrkdwn',
                text: `🤖 自動転送 | 元メッセージ: <#${message.channel}>`
              }
            ]
          }
        ]
      });

      console.log('✅ Task message forwarded to #general');

      // 元のメッセージにリアクションを追加
      await client.reactions.add({
        channel: message.channel,
        timestamp: message.ts,
        name: 'white_check_mark'
      });

      console.log('✅ Reaction added to original message');
    }

  } catch (error) {
    console.error('❌ Error processing message:', error);
  }
});

// アプリの起動
(async () => {
  try {
    await app.start();
    console.log('⚡️ NOROSHI Task Monitor is running!');
    console.log('🔍 Monitoring for task messages...');
    console.log('📋 Patterns: [タスク], [本日のタスク], [今日のタスク], [task], [todo], [やること]');
    console.log(`🌐 Server running on port ${process.env.PORT || 3000}`);
  } catch (error) {
    console.error('❌ Failed to start app:', error);
    process.exit(1);
  }
})();

// プロセス終了時のクリーンアップ
process.on('SIGINT', () => {
  console.log('\n🛑 Shutting down NOROSHI Task Monitor...');
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('\n🛑 NOROSHI Task Monitor terminated');
  process.exit(0);
}); 