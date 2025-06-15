#!/usr/bin/env node

// NOROSHI クリーンタスク自動監視・差分更新・スケジュールリマインドシステム
// シンプルで見やすいMarkdown形式でタスクを管理 + 決まった時間でのリマインド機能

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

console.log('🚀 Starting NOROSHI Clean Task Monitor with Scheduled Reminder...');

// Slack Boltアプリの初期化（Socket Mode）
const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  appToken: process.env.SLACK_APP_TOKEN,
  socketMode: true,
});

// 設定
const GENERAL_CHANNEL_ID = 'C02TJS8D205';
const TASKS_DIR = path.join(__dirname, '..', 'タスク');

// リマインダーの時間設定（日本時間）
const REMINDER_TIMES = [
  { hour: 9, minute: 30 },   // 9:30
  { hour: 11, minute: 30 },  // 11:30
  { hour: 13, minute: 30 },  // 13:30
  { hour: 15, minute: 30 },  // 15:30
  { hour: 17, minute: 30 },  // 17:30
  { hour: 20, minute: 30 }   // 20:30
];

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

// 日本時間の現在時刻を取得
function getJapanTime() {
  return new Date(new Date().toLocaleString("en-US", {timeZone: "Asia/Tokyo"}));
}

// 次のリマインダー時刻を取得
function getNextReminderTime() {
  const now = getJapanTime();
  const currentHour = now.getHours();
  const currentMinute = now.getMinutes();
  
  // 今日の残りのリマインダー時刻をチェック
  for (const time of REMINDER_TIMES) {
    if (currentHour < time.hour || (currentHour === time.hour && currentMinute < time.minute)) {
      const nextTime = new Date(now);
      nextTime.setHours(time.hour, time.minute, 0, 0);
      return nextTime;
    }
  }
  
  // 今日のリマインダーが全て終了している場合、明日の最初のリマインダー
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(REMINDER_TIMES[0].hour, REMINDER_TIMES[0].minute, 0, 0);
  return tomorrow;
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

// 既存のユーザータスクを取得（クリーン版）
async function getUserPreviousTasks(userName, todayFile) {
  try {
    const content = await fs.readFile(todayFile, 'utf8');
    const userSectionRegex = new RegExp(`## ${userName}([\\s\\S]*?)(?=## |$)`, 'g');
    const matches = [...content.matchAll(userSectionRegex)];
    
    if (matches.length === 0) return [];
    
    // 最新のタスクセクションを取得
    const latestSection = matches[matches.length - 1][1];
    const tasks = [];
    
    const lines = latestSection.split('\n');
    let inCurrentTasks = false;
    
    for (const line of lines) {
      const trimmed = line.trim();
      
      // 現在のタスクセクションを探す
      if (trimmed === '**現在のタスク:**') {
        inCurrentTasks = true;
        continue;
      }
      
      // 他のセクションに入ったら終了
      if (trimmed.startsWith('**') && inCurrentTasks) {
        break;
      }
      
      // 現在のタスクセクション内の箇条書きを取得
      if (inCurrentTasks && (trimmed.match(/^[・\-\*]/) || trimmed.match(/^\d+\./) || trimmed.match(/^[\-\+\*]\s/))) {
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

// 全ユーザーの現在のタスクを取得
async function getAllCurrentTasks() {
  try {
    const todayFile = getTodayTaskFile();
    const content = await fs.readFile(todayFile, 'utf8');
    
    const userTasks = {};
    const userSections = content.split(/^## /m).filter(section => section.trim());
    
    for (const section of userSections) {
      const lines = section.split('\n');
      const userName = lines[0].trim();
      
      if (!userName || userName.startsWith('#')) continue;
      
      const tasks = [];
      let inCurrentTasks = false;
      
      for (const line of lines) {
        const trimmed = line.trim();
        
        if (trimmed === '**現在のタスク:**') {
          inCurrentTasks = true;
          continue;
        }
        
        if (trimmed.startsWith('**') && inCurrentTasks) {
          break;
        }
        
        if (inCurrentTasks && (trimmed.match(/^[・\-\*]/) || trimmed.match(/^\d+\./) || trimmed.match(/^[\-\+\*]\s/))) {
          const taskText = trimmed.replace(/^[・\-\*\d\.]+\s*/, '').trim();
          if (taskText) {
            tasks.push(taskText);
          }
        }
      }
      
      if (tasks.length > 0) {
        userTasks[userName] = tasks;
      }
    }
    
    return userTasks;
  } catch (error) {
    console.log('📋 No tasks file found or error reading tasks:', error.message);
    return {};
  }
}

// タスクの差分を計算
function calculateTaskDiff(previousTasks, newTasks) {
  const added = newTasks.filter(task => !previousTasks.includes(task));
  const removed = previousTasks.filter(task => !newTasks.includes(task));
  const unchanged = newTasks.filter(task => previousTasks.includes(task));
  
  return { added, removed, unchanged };
}

// クリーンなタスク更新
async function cleanUpdateTasks(taskData, diff) {
  const { userName, messageText, timestamp } = taskData;
  const { added, removed } = diff;
  const dateTime = formatDateTime(new Date(parseFloat(timestamp) * 1000));
  
  const todayFile = getTodayTaskFile();
  const newTasks = parseTaskList(messageText);
  
  // シンプルなタスクエントリを作成
  let taskEntry = `## ${userName}\n\n`;
  
  // 現在のタスク
  taskEntry += `**現在のタスク:**\n`;
  newTasks.forEach(task => {
    taskEntry += `・${task}\n`;
  });
  
  // 変更があった場合のみ差分情報を表示
  if (added.length > 0 || removed.length > 0) {
    taskEntry += `\n**最新の変更 (${dateTime}):**\n`;
    
    if (added.length > 0) {
      taskEntry += `🆕 追加:\n`;
      added.forEach(task => taskEntry += `・${task}\n`);
    }
    
    if (removed.length > 0) {
      taskEntry += `🗑️ 削除:\n`;
      removed.forEach(task => taskEntry += `・${task}\n`);
    }
  }
  
  taskEntry += `\n---\n\n`;

  try {
    // 今日のタスクファイルを更新
    let todayContent = '';
    try {
      todayContent = await fs.readFile(todayFile, 'utf8');
    } catch (error) {
      const today = formatDate();
      todayContent = `# 📅 ${today} のタスク\n\n`;
    }
    
    // 同じユーザーの既存エントリを削除して新しいエントリを追加
    const userSectionRegex = new RegExp(`## ${userName}[\\s\\S]*?(?=## |$)`, 'g');
    todayContent = todayContent.replace(userSectionRegex, '');
    
    await fs.writeFile(todayFile, todayContent + taskEntry);
    console.log('✅ Clean task update completed:', todayFile);
    
    return { todayFile };
    
  } catch (error) {
    console.error('❌ Error writing clean task update:', error);
    throw error;
  }
}

// タスクリマインダーを送信
async function sendTaskReminder(client) {
  try {
    console.log('⏰ Sending scheduled task reminder...');
    
    const allTasks = await getAllCurrentTasks();
    const userCount = Object.keys(allTasks).length;
    
    if (userCount === 0) {
      console.log('📋 No tasks found for reminder');
      return;
    }
    
    const currentTime = formatDateTime();
    let reminderText = `🔔 **定時タスクリマインダー** (${currentTime})\n\n`;
    
    let totalTasks = 0;
    for (const [userName, tasks] of Object.entries(allTasks)) {
      reminderText += `**${userName}さん (${tasks.length}件):**\n`;
      tasks.forEach(task => {
        reminderText += `・${task}\n`;
      });
      reminderText += '\n';
      totalTasks += tasks.length;
    }
    
    // 次回のリマインダー時刻を取得
    const nextReminder = getNextReminderTime();
    const nextReminderStr = formatDateTime(nextReminder);
    
    // #generalにリマインダーを投稿
    await client.chat.postMessage({
      channel: GENERAL_CHANNEL_ID,
      text: `🔔 定時タスクリマインダー - ${userCount}名、合計${totalTasks}件のタスク`,
      blocks: [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `🔔 *定時タスクリマインダー* (${currentTime})`
          }
        },
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: reminderText
          }
        },
        {
          type: 'context',
          elements: [
            {
              type: 'mrkdwn',
              text: `🤖 定時リマインダー | 👥 ${userCount}名 | 📋 合計${totalTasks}件のタスク | ⏰ 次回: ${nextReminderStr}`
            }
          ]
        }
      ]
    });
    
    console.log(`✅ Scheduled task reminder sent: ${userCount} users, ${totalTasks} tasks`);
    console.log(`⏰ Next reminder: ${nextReminderStr}`);
    
  } catch (error) {
    console.error('❌ Error sending scheduled task reminder:', error);
  }
}

// スケジュールリマインダーを開始
function startScheduledReminder(client) {
  console.log('⏰ Starting scheduled task reminder...');
  console.log('📅 Reminder times (JST): 9:30, 11:30, 13:30, 15:30, 17:30, 20:30');
  
  // 即座に最初のリマインダーを送信（テスト用）
  setTimeout(() => {
    sendTaskReminder(client);
  }, 5000); // 5秒後に最初のリマインダー
  
  // 1分ごとにチェックして、リマインダー時刻になったら実行
  setInterval(() => {
    const now = getJapanTime();
    const currentHour = now.getHours();
    const currentMinute = now.getMinutes();
    const currentSecond = now.getSeconds();
    
    // 秒が0-5の間のみチェック（重複実行を防ぐ）
    if (currentSecond <= 5) {
      for (const time of REMINDER_TIMES) {
        if (currentHour === time.hour && currentMinute === time.minute) {
          console.log(`⏰ Scheduled reminder time reached: ${time.hour}:${time.minute}`);
          sendTaskReminder(client);
          break;
        }
      }
    }
  }, 60000); // 1分ごとにチェック
  
  // 次回のリマインダー時刻を表示
  const nextReminder = getNextReminderTime();
  console.log(`⏰ Next reminder scheduled: ${formatDateTime(nextReminder)}`);
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
      
      // タスクデータを準備
      const taskData = {
        userName,
        channelName,
        messageText,
        timestamp: message.ts
      };
      
      // クリーン更新を実行
      try {
        await cleanUpdateTasks(taskData, diff);
        console.log('📝 Clean task update completed');
        
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
                  text: `🤖 クリーン更新・保存完了 | 📝 差分検知済み | 元メッセージ: <#${message.channel}>`
                }
              ]
            }
          ]
        });
        
        console.log('✅ Clean update message posted to #general');
        
      } catch (mdError) {
        console.error('❌ Error in clean task update:', mdError);
        
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
                  text: `🤖 自動転送 | ⚠️ クリーン更新エラー | 元メッセージ: <#${message.channel}>`
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
      
      console.log('✅ Clean task processing completed');
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
    console.log('⚡️ NOROSHI Clean Task Monitor with Scheduled Reminder is running!');
    console.log('🔍 Monitoring for task messages...');
    console.log('📋 Task Patterns: [タスク], [本日のタスク], [今日のタスク], [task], [todo], [やること]');
    console.log('📁 Tasks will be saved to:', TASKS_DIR);
    console.log('✨ Clean Features: Simple markdown format, essential info only');
    console.log('⏰ Scheduled Reminder: 9:30, 11:30, 13:30, 15:30, 17:30, 20:30 (JST)');
    console.log('🌐 Using Socket Mode - no HTTP endpoint required!');
    
    // スケジュールリマインダーを開始
    startScheduledReminder(app.client);
    
  } catch (error) {
    console.error('❌ Failed to start app:', error);
    process.exit(1);
  }
})();

// プロセス終了時のクリーンアップ
process.on('SIGINT', () => {
  console.log('\n🛑 Shutting down NOROSHI Clean Task Monitor with Scheduled Reminder...');
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('\n🛑 NOROSHI Clean Task Monitor with Scheduled Reminder terminated');
  process.exit(0);
}); 