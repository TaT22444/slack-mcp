#!/usr/bin/env node

// NOROSHI タスク自動監視・転送・MD管理システム
// Slackでタスクを検知し、#generalに転送 + Markdownファイルに自動保存

require('dotenv').config({ path: '../.env' });
const { App } = require('@slack/bolt');
const fs = require('fs').promises;
const path = require('path');

console.log('🔧 Loading environment variables from .env file...');

// 環境変数の確認
if (!process.env.SLACK_BOT_TOKEN) {
  console.error('❌ SLACK_BOT_TOKEN environment variable is required');
  process.exit(1);
}

if (!process.env.SLACK_APP_TOKEN) {
  console.error('❌ SLACK_APP_TOKEN environment variable is required');
  console.error('💡 Please add SLACK_APP_TOKEN to your .env file');
  process.exit(1);
}

console.log('🚀 Starting NOROSHI Task Monitor with Markdown Management...');

// Slack Boltアプリの初期化（Socket Mode）
const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  appToken: process.env.SLACK_APP_TOKEN,
  socketMode: true,
});

// 設定
const GENERAL_CHANNEL_ID = 'C02TJS8D205';
const TASKS_DIR = path.join(__dirname, '..', 'タスク');

// タスクパターンの正規表現
const TASK_PATTERNS = [
  /\[タスク\]/i,
  /\[本日のタスク\]/i,
  /\[今日のタスク\]/i,
  /\[task\]/i,
  /\[todo\]/i,
  /\[やること\]/i
];

// 日付フォーマット関数
function formatDate(date = new Date()) {
  return date.toISOString().split('T')[0]; // YYYY-MM-DD
}

function formatDateTime(date = new Date()) {
  return date.toLocaleString('ja-JP', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Asia/Tokyo'
  });
}

// タスクディレクトリの初期化
async function initializeTasksDirectory() {
  try {
    await fs.access(TASKS_DIR);
    console.log('📁 Tasks directory exists:', TASKS_DIR);
  } catch (error) {
    console.log('📁 Creating tasks directory:', TASKS_DIR);
    await fs.mkdir(TASKS_DIR, { recursive: true });
  }
}

// 今日のタスクファイルパスを取得
function getTodayTaskFile() {
  const today = formatDate();
  return path.join(TASKS_DIR, `${today}-tasks.md`);
}

// 全タスクファイルパスを取得
function getAllTasksFile() {
  return path.join(TASKS_DIR, 'all-tasks.md');
}

// タスクをMarkdownファイルに追加
async function addTaskToMarkdown(taskData) {
  const { userName, channelName, messageText, timestamp, slackLink } = taskData;
  const dateTime = formatDateTime(new Date(parseFloat(timestamp) * 1000));
  
  // 今日のタスクファイル
  const todayFile = getTodayTaskFile();
  const allTasksFile = getAllTasksFile();
  
  // タスクエントリを作成
  const taskEntry = `
## 📋 ${userName}さんのタスク
- **投稿者**: ${userName}
- **チャンネル**: #${channelName}
- **投稿時刻**: ${dateTime}
- **Slackリンク**: ${slackLink || 'N/A'}

### 内容
${messageText}

---
`;

  try {
    // 今日のタスクファイルに追加
    let todayContent = '';
    try {
      todayContent = await fs.readFile(todayFile, 'utf8');
    } catch (error) {
      // ファイルが存在しない場合、ヘッダーを作成
      const today = formatDate();
      todayContent = `# 📅 ${today} のタスク一覧

このファイルは自動生成されます。Slackで検知されたタスクが自動的に追加されます。

`;
    }
    
    await fs.writeFile(todayFile, todayContent + taskEntry);
    console.log('✅ Task added to today\'s file:', todayFile);
    
    // 全タスクファイルに追加
    let allContent = '';
    try {
      allContent = await fs.readFile(allTasksFile, 'utf8');
    } catch (error) {
      // ファイルが存在しない場合、ヘッダーを作成
      allContent = `# 📋 全タスク履歴

このファイルは自動生成されます。Slackで検知された全てのタスクが時系列で記録されます。

`;
    }
    
    await fs.writeFile(allTasksFile, allContent + taskEntry);
    console.log('✅ Task added to all tasks file:', allTasksFile);
    
    return { todayFile, allTasksFile };
    
  } catch (error) {
    console.error('❌ Error writing task to markdown:', error);
    throw error;
  }
}

// タスクファイル一覧を取得
async function getTaskFilesList() {
  try {
    const files = await fs.readdir(TASKS_DIR);
    return files.filter(file => file.endsWith('.md')).sort().reverse();
  } catch (error) {
    console.error('❌ Error reading tasks directory:', error);
    return [];
  }
}

// メッセージ処理
app.message(async ({ message, client }) => {
  try {
    // ボット自身のメッセージは無視
    if (message.bot_id) return;
    
    // #generalチャンネルのメッセージは無視（無限ループ防止）
    if (message.channel === GENERAL_CHANNEL_ID) return;
    
    const messageText = message.text || '';
    
    // タスクパターンをチェック
    const isTaskMessage = TASK_PATTERNS.some(pattern => pattern.test(messageText));
    
    if (isTaskMessage) {
      console.log('🎉 TASK MESSAGE DETECTED!');
      console.log(`📍 Channel: ${message.channel}`);
      console.log(`👤 User: ${message.user}`);
      console.log(`💬 Message: ${messageText}`);
      
      // ユーザー情報を取得
      const userInfo = await client.users.info({ user: message.user });
      const userName = userInfo.user.display_name || userInfo.user.real_name || userInfo.user.name;
      
      // チャンネル情報を取得
      const channelInfo = await client.conversations.info({ channel: message.channel });
      const channelName = channelInfo.channel.name;
      
      // Slackリンクを生成
      const teamId = process.env.SLACK_TEAM_ID || 'T02TJS8D1TZ';
      const slackLink = `https://${teamId}.slack.com/archives/${message.channel}/p${message.ts.replace('.', '')}`;
      
      // タスクデータを準備
      const taskData = {
        userName,
        channelName,
        messageText,
        timestamp: message.ts,
        slackLink
      };
      
      // Markdownファイルに保存
      try {
        const { todayFile, allTasksFile } = await addTaskToMarkdown(taskData);
        console.log('📝 Task saved to markdown files');
        
        // #generalに転送メッセージを投稿（Markdownファイル情報も含む）
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
                  text: `🤖 自動転送・保存完了 | 📝 Markdownファイルに記録済み | 元メッセージ: <#${message.channel}>`
                }
              ]
            }
          ]
        });
        
        console.log('✅ Message posted to #general with markdown info');
        
      } catch (mdError) {
        console.error('❌ Error saving to markdown:', mdError);
        
        // Markdownエラーでも通常の転送は実行
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
                  text: `🤖 自動転送 | ⚠️ Markdown保存エラー | 元メッセージ: <#${message.channel}>`
                }
              ]
            }
          ]
        });
      }
      
      // 元のメッセージにリアクションを追加
      await client.reactions.add({
        channel: message.channel,
        timestamp: message.ts,
        name: 'white_check_mark'
      });
      
      console.log('✅ Task processing completed');
    }
    
  } catch (error) {
    console.error('❌ Error processing message:', error);
  }
});

// アプリの起動
(async () => {
  try {
    // タスクディレクトリを初期化
    await initializeTasksDirectory();
    
    await app.start();
    console.log('⚡️ NOROSHI Task Monitor with Markdown Management is running!');
    console.log('🔍 Monitoring for task messages...');
    console.log('📋 Task Patterns: [タスク], [本日のタスク], [今日のタスク], [task], [todo], [やること]');
    console.log('📁 Tasks will be saved to:', TASKS_DIR);
    console.log('🌐 Using Socket Mode - no HTTP endpoint required!');
    
    // 既存のタスクファイル一覧を表示
    const taskFiles = await getTaskFilesList();
    if (taskFiles.length > 0) {
      console.log('📄 Existing task files:');
      taskFiles.forEach(file => console.log(`  - ${file}`));
    }
    
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