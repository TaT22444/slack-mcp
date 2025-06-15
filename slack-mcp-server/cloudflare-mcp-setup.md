# 🌐 NOROSHI タスクモニター Cloudflare MCP サーバー構築ガイド

NOROSHIタスクモニターをCloudflare Workers上でリモートMCPサーバーとして構築し、CursorやClaude Desktopから直接操作できるようにします。

## 🎯 概要

このガイドでは以下を実現します：

- ✅ CloudflareでリモートMCPサーバーを構築
- ✅ NOROSHIタスクモニター機能をMCPツールとして公開
- ✅ CursorやClaude DesktopからSlackタスク管理を操作
- ✅ 24時間稼働の安定したサービス
- ✅ 無料枠での運用（月10万リクエスト）

## 📋 前提条件

- Cloudflareアカウント
- Node.js 18以上
- Slack Bot Token & App Token
- GitHubアカウント（オプション）

## 🚀 セットアップ手順

### ステップ1: Cloudflare MCP プロジェクト作成

```bash
# 新しいCloudflare Workerプロジェクトを作成
npx create-cloudflare@latest noroshi-mcp-server

# テンプレート選択
# 1. "Hello World Example" を選択
# 2. "TypeScript" を選択
# 3. Git: No (オプション)
# 4. Deploy: No (後でデプロイ)

# プロジェクトディレクトリに移動
cd noroshi-mcp-server

# workers-mcpをインストール
npm install workers-mcp

# MCP設定を実行
npx workers-mcp setup
```

### ステップ2: 環境変数設定

```bash
# Cloudflareシークレットを設定
npx wrangler secret put SLACK_BOT_TOKEN
npx wrangler secret put SLACK_APP_TOKEN
npx wrangler secret put SLACK_TEAM_ID
```

### ステップ3: MCP サーバーコード実装

プロジェクトの `src/index.ts` を以下のように置き換えます：

```typescript
import { WorkerEntrypoint } from 'cloudflare:workers'
import { ProxyToSelf } from 'workers-mcp'
import { App } from '@slack/bolt'

interface Env {
  SLACK_BOT_TOKEN: string
  SLACK_APP_TOKEN: string
  SLACK_TEAM_ID: string
}

export default class NorosiTaskMCP extends WorkerEntrypoint<Env> {
  private slackApp: App | null = null

  private getSlackApp() {
    if (!this.slackApp) {
      this.slackApp = new App({
        token: this.env.SLACK_BOT_TOKEN,
        appToken: this.env.SLACK_APP_TOKEN,
        socketMode: false, // HTTP mode for Cloudflare Workers
      })
    }
    return this.slackApp
  }

  /**
   * Slackチャンネル一覧を取得します
   * @returns {Promise<string>} チャンネル一覧のJSON文字列
   */
  async listChannels(): Promise<string> {
    try {
      const app = this.getSlackApp()
      const result = await app.client.conversations.list({
        token: this.env.SLACK_BOT_TOKEN,
        types: 'public_channel,private_channel'
      })
      
      const channels = result.channels?.map(channel => ({
        id: channel.id,
        name: channel.name,
        is_private: channel.is_private,
        member_count: channel.num_members
      })) || []
      
      return JSON.stringify(channels, null, 2)
    } catch (error) {
      return `エラー: ${error.message}`
    }
  }

  /**
   * 指定されたチャンネルでタスクパターンのメッセージを検索します
   * @param channelId {string} チャンネルID
   * @param limit {number} 取得するメッセージ数（デフォルト: 50）
   * @returns {Promise<string>} タスクメッセージの一覧
   */
  async searchTaskMessages(channelId: string, limit: number = 50): Promise<string> {
    try {
      const app = this.getSlackApp()
      const result = await app.client.conversations.history({
        token: this.env.SLACK_BOT_TOKEN,
        channel: channelId,
        limit: limit
      })

      const taskPatterns = [
        /\[タスク\]/i,
        /\[本日のタスク\]/i,
        /\[今日のタスク\]/i,
        /\[task\]/i,
        /\[todo\]/i,
        /\[やること\]/i
      ]

      const taskMessages = result.messages?.filter(message => {
        return message.text && taskPatterns.some(pattern => pattern.test(message.text))
      }).map(message => ({
        user: message.user,
        text: message.text,
        timestamp: message.ts,
        permalink: `https://${this.env.SLACK_TEAM_ID}.slack.com/archives/${channelId}/p${message.ts?.replace('.', '')}`
      })) || []

      return JSON.stringify(taskMessages, null, 2)
    } catch (error) {
      return `エラー: ${error.message}`
    }
  }

  /**
   * #generalチャンネルにタスクリマインダーを送信します
   * @param message {string} リマインダーメッセージ
   * @returns {Promise<string>} 送信結果
   */
  async sendTaskReminder(message: string): Promise<string> {
    try {
      const app = this.getSlackApp()
      const result = await app.client.chat.postMessage({
        token: this.env.SLACK_BOT_TOKEN,
        channel: 'C02TJS8D205', // #general channel ID
        text: `🔔 タスクリマインダー: ${message}`,
        blocks: [
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: `🔔 *タスクリマインダー*\n${message}`
            }
          },
          {
            type: 'context',
            elements: [
              {
                type: 'mrkdwn',
                text: `🤖 NOROSHI MCP Server | ${new Date().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })}`
              }
            ]
          }
        ]
      })

      return `✅ リマインダーを送信しました (ts: ${result.ts})`
    } catch (error) {
      return `❌ エラー: ${error.message}`
    }
  }

  /**
   * 指定されたチャンネルの最新タスクを取得し、分析します
   * @param channelId {string} チャンネルID
   * @returns {Promise<string>} タスク分析結果
   */
  async analyzeChannelTasks(channelId: string): Promise<string> {
    try {
      const taskMessages = await this.searchTaskMessages(channelId, 100)
      const tasks = JSON.parse(taskMessages)
      
      if (tasks.length === 0) {
        return '📋 このチャンネルにはタスクメッセージが見つかりませんでした。'
      }

      // ユーザー別タスク集計
      const userTasks = tasks.reduce((acc, task) => {
        if (!acc[task.user]) {
          acc[task.user] = []
        }
        acc[task.user].push(task)
        return acc
      }, {})

      const analysis = {
        totalTasks: tasks.length,
        uniqueUsers: Object.keys(userTasks).length,
        userBreakdown: Object.entries(userTasks).map(([user, userTaskList]) => ({
          user,
          taskCount: userTaskList.length,
          latestTask: userTaskList[0]?.text?.substring(0, 100) + '...'
        })),
        recentTasks: tasks.slice(0, 5).map(task => ({
          user: task.user,
          preview: task.text.substring(0, 100) + '...',
          timestamp: new Date(parseFloat(task.timestamp) * 1000).toLocaleString('ja-JP')
        }))
      }

      return JSON.stringify(analysis, null, 2)
    } catch (error) {
      return `❌ エラー: ${error.message}`
    }
  }

  /**
   * Slackワークスペースの全体的なタスク状況を取得します
   * @returns {Promise<string>} ワークスペース全体のタスク状況
   */
  async getWorkspaceTaskOverview(): Promise<string> {
    try {
      const app = this.getSlackApp()
      
      // パブリックチャンネル一覧を取得
      const channelsResult = await app.client.conversations.list({
        token: this.env.SLACK_BOT_TOKEN,
        types: 'public_channel',
        limit: 20
      })

      const channels = channelsResult.channels || []
      const overview = {
        totalChannels: channels.length,
        channelsWithTasks: [],
        totalTaskMessages: 0,
        summary: ''
      }

      // 各チャンネルのタスクを確認
      for (const channel of channels.slice(0, 10)) { // 最初の10チャンネルのみ
        try {
          const taskMessages = await this.searchTaskMessages(channel.id, 20)
          const tasks = JSON.parse(taskMessages)
          
          if (tasks.length > 0) {
            overview.channelsWithTasks.push({
              name: channel.name,
              id: channel.id,
              taskCount: tasks.length
            })
            overview.totalTaskMessages += tasks.length
          }
        } catch (error) {
          // チャンネルアクセスエラーは無視
        }
      }

      overview.summary = `📊 ワークスペース概要: ${overview.totalChannels}チャンネル中${overview.channelsWithTasks.length}チャンネルでタスクを発見。合計${overview.totalTaskMessages}件のタスクメッセージ。`

      return JSON.stringify(overview, null, 2)
    } catch (error) {
      return `❌ エラー: ${error.message}`
    }
  }

  /**
   * @ignore
   */
  async fetch(request: Request): Promise<Response> {
    return new ProxyToSelf(this).fetch(request)
  }
}
```

### ステップ4: 依存関係の追加

```bash
# Slack Bolt SDKを追加
npm install @slack/bolt

# package.jsonの更新
npm install
```

### ステップ5: デプロイ

```bash
# Cloudflareにデプロイ
npx wrangler deploy

# デプロイ後、URLをメモ
# 例: https://noroshi-mcp-server.your-account.workers.dev
```

## 🔧 MCP クライアント設定

### Claude Desktop設定

`~/.config/claude_desktop_config.json` (Linux/Mac) または `%APPDATA%\Claude\claude_desktop_config.json` (Windows) に追加：

```json
{
  "mcpServers": {
    "noroshi-tasks": {
      "command": "npx",
      "args": [
        "mcp-remote",
        "https://noroshi-mcp-server.your-account.workers.dev"
      ]
    }
  }
}
```

### Cursor設定

Cursor の MCP 設定に追加：

```json
{
  "mcpServers": {
    "noroshi-tasks": {
      "command": "npx",
      "args": [
        "mcp-remote", 
        "https://noroshi-mcp-server.your-account.workers.dev"
      ]
    }
  }
}
```

## 🎮 使用方法

### Claude Desktopでの使用例

```
# チャンネル一覧を取得
Slackのチャンネル一覧を教えて

# 特定チャンネルのタスクを検索
C091H8NUJ8Lチャンネルのタスクメッセージを検索して

# タスクリマインダーを送信
「今日の進捗を共有してください」というリマインダーを送信して

# チャンネルのタスク分析
C091H8NUJ8Lチャンネルのタスクを分析して

# ワークスペース全体の概要
ワークスペース全体のタスク状況を教えて
```

### Cursorでの使用例

```
# MCP経由でSlackタスクを管理
@noroshi-tasks チャンネル一覧を取得

# 特定チャンネルの分析
@noroshi-tasks C091H8NUJ8Lのタスクを分析

# リマインダー送信
@noroshi-tasks 定時リマインダーを送信
```

## 📊 利用可能なMCPツール

| ツール名 | 説明 | パラメータ |
|---------|------|-----------|
| `listChannels` | Slackチャンネル一覧取得 | なし |
| `searchTaskMessages` | タスクメッセージ検索 | channelId, limit |
| `sendTaskReminder` | タスクリマインダー送信 | message |
| `analyzeChannelTasks` | チャンネルタスク分析 | channelId |
| `getWorkspaceTaskOverview` | ワークスペース概要 | なし |

## 🔍 トラブルシューティング

### よくある問題

1. **認証エラー**
   ```bash
   # シークレットを再設定
   npx wrangler secret put SLACK_BOT_TOKEN
   ```

2. **デプロイエラー**
   ```bash
   # Wranglerにログイン
   npx wrangler login
   ```

3. **MCP接続エラー**
   ```bash
   # mcp-remoteをインストール
   npm install -g mcp-remote
   ```

### ログ確認

```bash
# Cloudflare Workerのログを確認
npx wrangler tail
```

## 💰 コスト

- **Cloudflare Workers**: 無料枠で月10万リクエスト
- **追加リクエスト**: $0.15/100万リクエスト
- **実質無料**: 通常の使用では無料枠内で十分

## 🚀 次のステップ

1. **認証機能追加**: OAuth2.0でユーザー認証
2. **データ永続化**: Cloudflare KVでタスクデータ保存
3. **Webhook統合**: リアルタイムタスク更新
4. **AI分析**: Workers AIでタスク内容分析
5. **ダッシュボード**: Web UIでタスク可視化

## 🎉 完了！

これでNOROSHIタスクモニターがCloudflare上でリモートMCPサーバーとして稼働し、CursorやClaude Desktopから直接Slackタスク管理ができるようになりました！

24時間365日稼働する、グローバルにアクセス可能なAI統合タスク管理システムの完成です！🌟 