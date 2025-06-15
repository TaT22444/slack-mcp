#!/usr/bin/env node

// NOROSHI スマートタスク自動監視・差分更新システム
// 同じユーザーのタスクを比較し、削除・追加を自動検知してMarkdownを更新

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

console.log('🚀 Starting NOROSHI Smart Task Monitor with Diff Updates...');

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

// タスクリストを解析（箇条書きを配列に変換）
function parseTaskList(messageText) {
  const lines = messageText.split('\n');
  const tasks = [];
  
  for (const line of lines) {
    const trimmed = line.trim();
    // 箇条書きパターンを検出: ・、-、*、1.、2.など
    if (trimmed.match(/^[・\-\*]/) || trimmed.match(/^\d+\./) || trimmed.match(/^[\-\+\*]\s/)) {
      const taskText = trimmed.replace(/^[・\-\*\d\.]+\s*/, '').trim();
      if (taskText) {
        tasks.push(taskText);
      }
    }
  }
  
  return tasks;
}

// 既存のユーザータスクを取得
async function getUserPreviousTasks(userName, todayFile) {
  try {
    const content = await fs.readFile(todayFile, 'utf8');
    const userSectionRegex = new RegExp(`## 📋 ${userName}さんのタスク([\\s\\S]*?)(?=## |$)`, 'g');
    const matches = [...content.matchAll(userSectionRegex)];
    
    if (matches.length === 0) return [];
    
    // 最新のタスクセクションを取得
    const latestSection = matches[matches.length - 1][1];
    const tasks = [];
    
    const lines = latestSection.split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.match(/^[・\-\*]/) || trimmed.match(/^\d+\./) || trimmed.match(/^[\-\+\*]\s/)) {
        const taskText = trimmed.replace(/^[・\-\*\d\.]+\s*/, '').trim();
        if (taskText) {
          tasks.push(taskText);
        }
      }
    }
    
    return tasks;
  } catch (error) {
    return [];
  }
}

// タスクの差分を計算
function calculateTaskDiff(previousTasks, newTasks) {
  const added = newTasks.filter(task => !previousTasks.includes(task));
  const removed = previousTasks.filter(task => !newTasks.includes(task));
  const unchanged = newTasks.filter(task => previousTasks.includes(task));
  
  return { added, removed, unchanged };
}

// スマートタスク更新（差分情報付き）
async function smartUpdateTasks(taskData, diff) {
  const { userName, channelName, messageText, timestamp, slackLink } = taskData;
  const { added, removed, unchanged } = diff;
  const dateTime = formatDateTime(new Date(parseFloat(timestamp) * 1000));
  
  const todayFile = getTodayTaskFile();
  const allTasksFile = getAllTasksFile();
  
  // 差分情報を含むタスクエントリを作成
  let diffSummary = '';
  if (added.length > 0) {
    diffSummary += `\n**🆕 追加されたタスク (${added.length}件):**\n`;
    added.forEach(task => diffSummary += `- ✅ ${task}\n`);
  }
  if (removed.length > 0) {
    diffSummary += `\n**🗑️ 削除されたタスク (${removed.length}件):**\n`;
    removed.forEach(task => diffSummary += `- ❌ ${task}\n`);
  }
  if (unchanged.length > 0) {
    diffSummary += `\n**📋 継続中のタスク (${unchanged.length}件):**\n`;
    unchanged.forEach(task => diffSummary += `- 🔄 ${task}\n`);
  }
  
  const taskEntry = `
## 📋 ${userName}さんのタスク (更新: ${dateTime})
- **投稿者**: ${userName}
- **チャンネル**: #${channelName}
- **更新時刻**: ${dateTime}
- **Slackリンク**: ${slackLink || 'N/A'}

### 📊 変更サマリー
${diffSummary}

### 📝 現在のタスク一覧
${messageText}

---
`;

  try {
    // 今日のタスクファイルを更新
    let todayContent = '';
    try {
      todayContent = await fs.readFile(todayFile, 'utf8');
    } catch (error) {
      const today = formatDate();
      todayContent = `# 📅 ${today} のタスク一覧

このファイルは自動生成されます。Slackで検知されたタスクが自動的に追加・更新されます。

`;
    }
    
    // 同じユーザーの既存エントリを削除して新しいエントリを追加
    const userSectionRegex = new RegExp(`## 📋 ${userName}さんのタスク[\\s\\S]*?(?=## |$)`, 'g');
    todayContent = todayContent.replace(userSectionRegex, '');
    
    await fs.writeFile(todayFile, todayContent + taskEntry);
    console.log('✅ Smart task update completed for today\'s file:', todayFile);
    
    // 全タスクファイルに履歴として追加
    let allContent = '';
    try {
      allContent = await fs.readFile(allTasksFile, 'utf8');
    } catch (error) {
      allContent = `# 📋 全タスク履歴

このファイルは自動生成されます。Slackで検知された全てのタスクが時系列で記録されます。

`;
    }
    
    await fs.writeFile(allTasksFile, allContent + taskEntry);
    console.log('✅ Task history added to all tasks file:', allTasksFile);
    
    return { todayFile, allTasksFile, diffSummary };
    
  } catch (error) {
    console.error('❌ Error writing smart task update:', error);
    throw error;
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
      
      // 新しいタスクリストを解析
      const newTasks = parseTaskList(messageText);
      console.log('🔍 Parsed new tasks:', newTasks);
      
      // 既存のタスクを取得
      const todayFile = getTodayTaskFile();
      const previousTasks = await getUserPreviousTasks(userName, todayFile);
      console.log('📋 Previous tasks:', previousTasks);
      
      // タスクの差分を計算
      const diff = calculateTaskDiff(previousTasks, newTasks);
      console.log('📊 Task diff:', diff);
      
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
      
      // スマート更新を実行
      try {
        const { diffSummary } = await smartUpdateTasks(taskData, diff);
        console.log('📝 Smart task update completed');
        
        // 差分情報を含む転送メッセージを作成
        let changeInfo = '';
        if (diff.added.length > 0 || diff.removed.length > 0) {
          changeInfo = `\n\n📊 *変更内容:*`;
          if (diff.added.length > 0) {
            changeInfo += `\n🆕 追加: ${diff.added.length}件`;
          }
          if (diff.removed.length > 0) {
            changeInfo += `\n🗑️ 削除: ${diff.removed.length}件`;
          }
          if (diff.unchanged.length > 0) {
            changeInfo += `\n🔄 継続: ${diff.unchanged.length}件`;
          }
        }
        
        // #generalに転送メッセージを投稿
        await client.chat.postMessage({
          channel: GENERAL_CHANNEL_ID,
          text: `📋 ${userName}さんのタスク更新 (#${channelName}より自動転送)`,
          blocks: [
            {
              type: 'section',
              text: {
                type: 'mrkdwn',
                text: `📋 *${userName}さんのタスク更新* (#${channelName}より自動転送)${changeInfo}`
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
                  text: `🤖 スマート更新・保存完了 | 📝 差分検知済み | 元メッセージ: <#${message.channel}>`
                }
              ]
            }
          ]
        });
        
        console.log('✅ Smart update message posted to #general');
        
      } catch (mdError) {
        console.error('❌ Error in smart task update:', mdError);
        
        // エラーでも通常の転送は実行
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
                  text: `🤖 自動転送 | ⚠️ スマート更新エラー | 元メッセージ: <#${message.channel}>`
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
      
      console.log('✅ Smart task processing completed');
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
    console.log('⚡️ NOROSHI Smart Task Monitor with Diff Updates is running!');
    console.log('🔍 Monitoring for task messages...');
    console.log('📋 Task Patterns: [タスク], [本日のタスク], [今日のタスク], [task], [todo], [やること]');
    console.log('📁 Tasks will be saved to:', TASKS_DIR);
    console.log('🧠 Smart Features: Task diff detection, automatic add/remove tracking');
    console.log('🌐 Using Socket Mode - no HTTP endpoint required!');
    
  } catch (error) {
    console.error('❌ Failed to start app:', error);
    process.exit(1);
  }
})();

// プロセス終了時のクリーンアップ
process.on('SIGINT', () => {
  console.log('\n🛑 Shutting down NOROSHI Smart Task Monitor...');
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('\n🛑 NOROSHI Smart Task Monitor terminated');
  process.exit(0);
}); 