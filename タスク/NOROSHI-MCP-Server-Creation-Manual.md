# 🌐 NOROSHI MCPサーバー作成マニュアル

## 📋 目次

1. [プロジェクト概要](#プロジェクト概要)
2. [システム構成](#システム構成)
3. [前提条件・準備](#前提条件準備)
4. [ステップ1: 基盤構築](#ステップ1-基盤構築)
5. [ステップ2: Slack連携実装](#ステップ2-slack連携実装)
6. [ステップ3: GitHub連携実装](#ステップ3-github連携実装)
7. [ステップ4: MCP機能実装](#ステップ4-mcp機能実装)
8. [ステップ5: 自動化機能実装](#ステップ5-自動化機能実装)
9. [ステップ6: デプロイ・運用](#ステップ6-デプロイ運用)
10. [トラブルシューティング](#トラブルシューティング)

---

## プロジェクト概要

### 🎯 NOROSHI MCPサーバーとは

NOROSHI MCPサーバーは、Cloudflare Workers上で動作するリモートMCPサーバーです。Slack、GitHub、Cursorを統合し、AI駆動のタスク管理システムを提供します。

### 🏗️ 主要機能

1. **Slack Events API統合**
   - リアルタイムタスク処理
   - メンション自動応答
   - チャンネル間自動転送

2. **GitHub API連携**
   - タスクファイル管理（`タスク/`フォルダ）
   - 自動ファイル編集・作成
   - バージョン管理

3. **MCP Protocol実装**
   - Cursor/Claude Desktop統合
   - 14種類のMCPツール
   - リモートサーバー対応

4. **自動化機能**
   - 定期タスクリマインダー（22:05-22:45 JST）
   - ボットループ防止
   - キャッシュ最適化

### 📊 技術スタック

- **Runtime**: Cloudflare Workers
- **Language**: TypeScript
- **Protocol**: MCP (Model Context Protocol)
- **APIs**: Slack Events API, GitHub API
- **Storage**: GitHub Repository
- **Deployment**: Wrangler CLI

---

## システム構成

### 🔄 アーキテクチャ図

```
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│   Cursor/Claude │────│ Cloudflare MCP   │────│   GitHub API    │
│     Desktop     │    │     Server       │    │  (タスクファイル) │
└─────────────────┘    └──────────────────┘    └─────────────────┘
        │                        │                        │
        │                        │                        │
        ▼                        ▼                        ▼
   自然言語指示            MCP Protocol            タスクデータ
                                │
                                ▼
                        ┌──────────────────┐
                        │   Slack API      │
                        │  (自動応答)       │
                        └──────────────────┘
```

### 🗂️ ディレクトリ構造

```
NOROSHI/
├── src/
│   └── index.ts                 # メインサーバーコード (2641行)
├── タスク/                      # GitHubタスクファイル
│   ├── tasks.md                 # 汎用タスクファイル
│   ├── 2025-06-16-tasks.md      # 日付別タスク
│   └── all-tasks.md             # 全タスク統合
├── wrangler.toml                # Cloudflare設定
├── package.json                 # 依存関係
├── README.md                    # プロジェクト説明
└── DEVELOPMENT.md               # 開発ガイド
```

### 🔗 外部連携

1. **Slack Workspace**
   - Team ID: `tatsu0823takasago`
   - Channels: `#general` (C02TJS8D205), `#タスク` (C091H8NUJ8L)
   - Bot: NOROSHI-AI (U091UQ2ATPB)

2. **GitHub Repository**
   - Owner: `TaT22444`
   - Repo: `slack-mcp`
   - URL: `https://github.com/TaT22444/slack-mcp.git`

3. **Cloudflare Workers**
   - Account: `tatsu0823takasago@icloud.com`
   - Worker Name: `noroshi-mcp-server`
   - URL: `https://noroshi-mcp-server.tatsu0823takasago.workers.dev/`

---

## 前提条件・準備

### 💻 開発環境

- **Node.js**: 18以上
- **Package Manager**: npm/yarn
- **Git**: バージョン管理
- **Cloudflare Account**: Workers利用
- **Slack Workspace**: 管理者権限
- **GitHub Account**: Personal Access Token

### 🔑 必要なトークン・認証情報

1. **Slack App設定**
   ```
   SLACK_BOT_TOKEN=xoxb-...
   SLACK_APP_TOKEN=xapp-...
   SLACK_TEAM_ID=T...
   ```

2. **GitHub設定**
   ```
   GITHUB_TOKEN=ghp_...
   GITHUB_OWNER=TaT22444
   GITHUB_REPO=slack-mcp
   ```

3. **Cloudflare設定**
   - Wrangler CLI認証
   - Workers無料プラン（月10万リクエスト）

---

## ステップ1: 基盤構築

### 1.1 プロジェクト初期化

```bash
# プロジェクトディレクトリ作成
mkdir NOROSHI
cd NOROSHI

# Git初期化
git init
git remote add origin https://github.com/TaT22444/slack-mcp.git

# Node.js初期化
npm init -y

# 依存関係インストール
npm install typescript @types/node
npm install --save-dev wrangler
```

### 1.2 TypeScript設定

```json
// tsconfig.json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ES2022",
    "moduleResolution": "node",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "types": ["@cloudflare/workers-types"]
  }
}
```

### 1.3 Wrangler設定

```toml
# wrangler.toml
name = "noroshi-mcp-server"
main = "src/index.ts"
compatibility_date = "2024-12-20"
compatibility_flags = ["nodejs_compat"]

[triggers]
crons = [
  "5 13 * * 1-5",   # 22:05 JST
  "15 13 * * 1-5",  # 22:15 JST
  "25 13 * * 1-5",  # 22:25 JST
  "35 13 * * 1-5",  # 22:35 JST
  "45 13 * * 1-5"   # 22:45 JST
]
```

---

## ステップ2: Slack連携実装

### 2.1 Slack App作成

1. **Slack API Console**で新しいAppを作成
2. **OAuth & Permissions**でスコープ設定:
   ```
   channels:read
   chat:write
   users:read
   reactions:add
   ```
3. **Event Subscriptions**を有効化
4. **Bot Token**と**App Token**を取得

### 2.2 基本インターフェース定義

```typescript
// src/index.ts (抜粋)
interface Env {
  SLACK_BOT_TOKEN: string
  SLACK_APP_TOKEN: string
  SLACK_TEAM_ID: string
  GITHUB_TOKEN?: string
  GITHUB_REPO?: string
  GITHUB_OWNER?: string
}

interface SlackEvent {
  type: string
  channel: string
  user: string
  text: string
  ts: string
  thread_ts?: string
}
```

### 2.3 Slack API基本機能

```typescript
/**
 * Slackチャンネル一覧を取得
 */
async listChannels(): Promise<string> {
  const response = await fetch('https://slack.com/api/conversations.list', {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${this.env.SLACK_BOT_TOKEN}`,
      'Content-Type': 'application/json'
    }
  })
  
  const data = await response.json()
  return JSON.stringify(data.channels, null, 2)
}
```

### 2.4 メンション応答システム

```typescript
/**
 * タスク状況問い合わせを処理
 */
private async handleTaskStatusInquiry(text: string, channel: string, messageTs: string): Promise<void> {
  const mentionPatterns = [
    /<@([A-Z0-9]+)>\s*タスク状況を教えて/i,
    /<@([A-Z0-9]+)>\s*のタスク状況を教えて/i,
    /<@([A-Z0-9]+)>\s*タスクを教えて/i,
    // ... 他のパターン
  ]
  
  // パターンマッチング処理
  // ユーザー情報取得
  // タスク分析実行
  // 結果投稿
}
```

---

## ステップ3: GitHub連携実装

### 3.1 GitHub Personal Access Token設定

1. GitHub Settings → Developer settings → Personal access tokens
2. 必要なスコープ: `repo`, `contents`
3. トークンをCloudflare Secretsに保存

### 3.2 ファイル操作基盤

```typescript
/**
 * UTF-8対応のBase64エンコード
 */
private encodeBase64(input: string): string {
  const encoder = new TextEncoder()
  const uint8Array = encoder.encode(input)
  
  let binary = ''
  for (let i = 0; i < uint8Array.length; i++) {
    binary += String.fromCharCode(uint8Array[i])
  }
  
  return btoa(binary)
}
```

### 3.3 タスクファイル管理

```typescript
/**
 * GitHubからタスクファイルを読み取り
 */
private async getTasksFromGitHub(userName: string): Promise<TaskFileData[]> {
  // キャッシュチェック
  const cacheKey = `tasks_${userName}`
  const cached = this.taskCache.get(cacheKey)
  
  if (cached && (Date.now() - cached.timestamp) < this.CACHE_DURATION) {
    return cached.data
  }

  // GitHub API呼び出し
  const response = await fetch(
    `https://api.github.com/repos/${this.env.GITHUB_OWNER}/${this.env.GITHUB_REPO}/contents/タスク`,
    {
      headers: {
        'Authorization': `Bearer ${this.env.GITHUB_TOKEN}`,
        'Accept': 'application/vnd.github.v3+json'
      }
    }
  )
  
  // ファイル解析・キャッシュ更新
}
```

### 3.4 ファイル編集機能

```typescript
/**
 * Markdownファイルを編集（完全置換）
 */
private async editMarkdownFile(fileName: string, content: string, userName: string): Promise<string> {
  const filePath = this.normalizeFilePath(fileName)
  const dateTime = new Date().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })

  // 既存ファイル取得
  // SHA取得
  // ファイル更新
  // 結果返却
}
```

---

## ステップ4: MCP機能実装

### 4.1 MCP Protocol基盤

```typescript
/**
 * MCPプロトコルのハンドラー
 */
async fetch(request: Request): Promise<Response> {
  // CORS対応
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      },
    })
  }

  const body = await request.json() as MCPRequest
  
  switch (body.method) {
    case 'initialize':
      // 初期化処理
    case 'tools/list':
      // ツール一覧返却
    case 'tools/call':
      // ツール実行
  }
}
```

### 4.2 MCPツール定義

```typescript
// tools/list レスポンス例
{
  tools: [
    {
      name: 'listChannels',
      description: 'Slackチャンネル一覧を取得します',
      inputSchema: {
        type: 'object',
        properties: {},
        required: []
      }
    },
    {
      name: 'analyzeUserTasks',
      description: '特定ユーザーのタスク状況を分析します',
      inputSchema: {
        type: 'object',
        properties: {
          userName: { type: 'string', description: 'ユーザー名' }
        },
        required: ['userName']
      }
    },
    // ... 他の12ツール
  ]
}
```

### 4.3 新規ファイル操作ツール

```typescript
// 5つの新規MCPツール
{
  name: 'editFile',
  description: 'GitHubファイルを編集します（Cursor統合対応）'
},
{
  name: 'appendToFile', 
  description: 'GitHubファイルに内容を追加します'
},
{
  name: 'viewFile',
  description: 'GitHubファイルの内容を表示します'
},
{
  name: 'createFile',
  description: '新しいGitHubファイルを作成します'
},
{
  name: 'deleteLineFromFile',
  description: 'GitHubファイルから指定行を削除します'
}
```

---

## ステップ5: 自動化機能実装

### 5.1 Cron Trigger設定

```typescript
/**
 * Cron Triggerハンドラー - 定期的なタスク報告
 */
async scheduled(controller: ScheduledController): Promise<void> {
  const now = new Date()
  const hour = now.getUTCHours() + 9 // JST変換
  const minute = now.getUTCMinutes()
  
  let reportMessage = ''
  
  if (hour === 22 && minute === 5) {
    reportMessage = '🌃 **22:05 夜のタスク状況をお知らせします**'
  } else if (hour === 22 && minute === 15) {
    reportMessage = '🌙 **22:15 夜のタスク進捗をお知らせします**'
  }
  // ... 他の時間帯
  
  if (reportMessage) {
    await this.reportAllUserTasks(reportMessage, reportType)
  }
}
```

### 5.2 自動タスク報告

```typescript
/**
 * 全ユーザーのタスクを取得してSlackに報告
 */
private async reportAllUserTasks(headerMessage: string, reportType: string): Promise<void> {
  // GitHubから最新のタスクファイルを取得
  const allTaskData = await this.getAllUsersTasksFromGitHub()
  
  // 報告メッセージを構築
  let reportContent = `${headerMessage}\n\n`
  
  // 各ユーザーのタスクを報告
  for (const user of latestTaskFile.users) {
    reportContent += `## 👤 ${user.userName}\n`
    reportContent += `📊 **タスク数**: ${user.tasks.length}件\n`
    // ... タスク詳細
  }
  
  // Slackに報告を送信
  await this.sendTaskReport(reportContent, reportType)
}
```

### 5.3 ユーザー名マッピング

```typescript
/**
 * ユーザーIDから表示名へのマッピング
 */
private getUserDisplayName(userId: string, slackUserName: string | null): string {
  const userDisplayMapping: Record<string, string> = {
    'U02TQ34K39S': '相原立弥',  // 固定マッピング
    // 他のユーザーマッピング
  }
  
  return userDisplayMapping[userId] || slackUserName || 'Unknown User'
}
```

---

## ステップ6: デプロイ・運用

### 6.1 環境変数設定

```bash
# Cloudflareシークレット設定
npx wrangler secret put SLACK_BOT_TOKEN
npx wrangler secret put SLACK_APP_TOKEN  
npx wrangler secret put SLACK_TEAM_ID
npx wrangler secret put GITHUB_TOKEN
npx wrangler secret put GITHUB_REPO
npx wrangler secret put GITHUB_OWNER

# 設定確認
npx wrangler secret list
```

### 6.2 デプロイ実行

```bash
# 初回デプロイ
npx wrangler deploy

# デプロイ確認
npx wrangler tail --format pretty
```

### 6.3 Cursor/Claude Desktop設定

```json
// ~/.config/claude_desktop_config.json
{
  "mcpServers": {
    "noroshi-tasks": {
      "command": "npx",
      "args": [
        "mcp-remote",
        "https://noroshi-mcp-server.tatsu0823takasago.workers.dev"
      ]
    }
  }
}
```

### 6.4 動作確認

1. **Slack自動応答テスト**
   ```
   @tatsu0823takasago タスク教えて
   ```

2. **MCP機能テスト**
   ```
   @noroshi-tasks チャンネル一覧を取得
   ```

3. **自動リマインダー確認**
   - 22:05-22:45 JSTに自動投稿

---

## トラブルシューティング

### 🚨 よくある問題と解決方法

#### 1. コード修正が反映されない

**症状**: コードを修正したがSlackに反映されない

**原因**: `npx wrangler deploy`を忘れている

**解決方法**:
```bash
npx wrangler deploy
```

#### 2. GitHub API エラー

**症状**: `GitHub API error: 401`

**原因**: トークンの権限不足または有効期限切れ

**解決方法**:
- Personal Access Tokenに`repo`権限があるか確認
- トークンの有効期限を確認
- 新しいトークンを生成して再設定

#### 3. Slack応答なし

**症状**: メンションしても応答がない

**原因**: Events APIの設定問題

**解決方法**:
1. Slack App設定でEvents APIが有効か確認
2. `message.channels`イベントが追加されているか確認
3. Request URLが正しく設定されているか確認

#### 4. 自動リマインダーが動作しない

**症状**: 定時にリマインダーが投稿されない

**原因**: Cron設定またはタイムゾーン問題

**解決方法**:
```bash
# ログ確認
npx wrangler tail --format pretty

# Cron設定確認
# JST = UTC+9 の変換が正しいか確認
```

#### 5. MCP接続エラー

**症状**: CursorからMCPサーバーに接続できない

**原因**: URL設定またはCORS問題

**解決方法**:
- Worker URLが正しいか確認
- CORS設定が適切か確認
- Claude Desktop設定ファイルの構文確認

### 📊 ログ監視

```bash
# リアルタイムログ監視
npx wrangler tail --format pretty

# 特定時間のログ
npx wrangler tail --since 1h

# エラーのみフィルタ
npx wrangler tail --format pretty | grep -i error
```

### 💰 コスト管理

- **Cloudflare Workers**: 無料枠で月10万リクエスト
- **GitHub API**: 無料（認証済みで5000リクエスト/時間）
- **通常使用**: 月1000-5000リクエスト程度
- **実質無料**: 無料枠内で十分

---

## 📚 参考資料

### 公式ドキュメント
- [Model Context Protocol (MCP)](https://modelcontextprotocol.io/)
- [Cloudflare Workers](https://workers.cloudflare.com/)
- [Slack API](https://api.slack.com/)
- [GitHub API](https://docs.github.com/en/rest)

### 開発ツール
- [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/)
- [TypeScript](https://www.typescriptlang.org/)

### コミュニティ
- [MCP GitHub Organization](https://github.com/modelcontextprotocol)
- [Cloudflare Workers Discord](https://discord.gg/cloudflaredev)

---

## 🎉 完了！

これでNOROSHI MCPサーバーの作成が完了です。以下の機能が利用可能になります：

✅ **Slack↔GitHub↔Cursor統合**  
✅ **14種類のMCPツール**  
✅ **自動タスクリマインダー（5回/日）**  
✅ **リアルタイムタスク管理**  
✅ **24時間365日稼働**  

**重要**: 修正後は必ず`npx wrangler deploy`を実行することを忘れずに！

---

*作成日: 2025年6月16日*  
*作成者: 相原立弥*  
*バージョン: 1.0* 