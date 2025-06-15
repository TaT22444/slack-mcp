#!/usr/bin/env node

// NOROSHI タスク自動監視・転送システム (デバッグ版)
// 全てのメッセージイベントをログ出力して問題を特定

require('dotenv').config({ path: '../.env' });
const { App } = require('@slack/bolt');

console.log('🔧 Loading environment variables from .env file...');

// 環境変数の確認
if (!process.env.SLACK_BOT_TOKEN) {
  console.error('❌ SLACK_BOT_TOKEN environment variable is required');
  process.exit(1);
}

if (!process.env.SLACK_APP_TOKEN) {
  console.error('❌ SLACK_APP_TOKEN environment variable is required');
  console.error('💡 Please add SLACK_APP_TOKEN to your .env file');
  console.error('📄 You can find this in your Slack App settings > Basic Information');
  process.exit(1);
}

console.log('🚀 Starting NOROSHI Task Monitor (Debug Mode)...');
console.log(`🔗 Bot Token: ${process.env.SLACK_BOT_TOKEN.substring(0, 20)}...`);
console.log(`🔗 App Token: ${process.env.SLACK_APP_TOKEN.substring(0, 20)}...`);

// Slack Boltアプリの初期化（Socket Mode）
const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  appToken: process.env.SLACK_APP_TOKEN,
  socketMode: true, // Socket Modeを使用
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

// 全てのメッセージイベントをキャッチ（デバッグ用）
app.message(async ({ message, client, logger }) => {
  console.log('🔍 MESSAGE EVENT RECEIVED:');
  console.log('📍 Channel:', message.channel);
  console.log('👤 User:', message.user);
  console.log('🤖 Bot ID:', message.bot_id);
  console.log('💬 Text:', message.text);
  console.log('📝 Message Type:', message.type);
  console.log('⏰ Timestamp:', message.ts);
  console.log('---');

  try {
    // ボット自身のメッセージは無視
    if (message.bot_id) {
      console.log('⏭️ Skipping bot message');
      return;
    }

    // #generalチャンネルのメッセージは無視（無限ループ防止）
    if (message.channel === GENERAL_CHANNEL_ID) {
      console.log('⏭️ Skipping #general message to prevent loop');
      return;
    }

    const messageText = message.text || '';
    console.log('🔎 Checking message text:', messageText);
    
    // タスクパターンをチェック
    const isTaskMessage = TASK_PATTERNS.some(pattern => {
      const match = pattern.test(messageText);
      console.log(`🎯 Pattern ${pattern} match:`, match);
      return match;
    });
    
    console.log('📋 Is task message:', isTaskMessage);
    
    if (isTaskMessage) {
      console.log('🎉 TASK MESSAGE DETECTED! Processing...');
      console.log(`📍 Channel: ${message.channel}`);
      console.log(`👤 User: ${message.user}`);
      console.log(`💬 Message: ${messageText}`);

      // ユーザー情報を取得
      console.log('👤 Fetching user info...');
      const userInfo = await client.users.info({
        user: message.user
      });

      const userName = userInfo.user.display_name || userInfo.user.real_name || userInfo.user.name;
      console.log('👤 User name:', userName);

      // チャンネル情報を取得
      console.log('📍 Fetching channel info...');
      const channelInfo = await client.conversations.info({
        channel: message.channel
      });

      const channelName = channelInfo.channel.name;
      console.log('📍 Channel name:', channelName);

      // #generalに転送メッセージを投稿
      console.log('📤 Posting message to #general...');
      const result = await client.chat.postMessage({
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
                text: `🤖 自動転送 (Debug Mode) | 元メッセージ: <#${message.channel}>`
              }
            ]
          }
        ]
      });

      console.log('✅ Message posted successfully:', result.ok);
      console.log('📤 Message timestamp:', result.ts);

      // 元のメッセージにリアクションを追加
      console.log('👍 Adding reaction to original message...');
      const reactionResult = await client.reactions.add({
        channel: message.channel,
        timestamp: message.ts,
        name: 'white_check_mark'
      });

      console.log('✅ Reaction added successfully:', reactionResult.ok);
    } else {
      console.log('⏭️ Not a task message, skipping...');
    }

  } catch (error) {
    console.error('❌ Error processing message:', error);
    console.error('❌ Error details:', error.message);
    console.error('❌ Stack trace:', error.stack);
  }
});

// アプリの起動
(async () => {
  try {
    await app.start();
    console.log('⚡️ NOROSHI Task Monitor (Debug Mode) is running!');
    console.log('🔍 Monitoring for ALL messages (debug mode)...');
    console.log('📋 Task Patterns: [タスク], [本日のタスク], [今日のタスク], [task], [todo], [やること]');
    console.log('🌐 Using Socket Mode - no HTTP endpoint required!');
    console.log('🐛 Debug mode: All message events will be logged');
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