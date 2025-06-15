# 🌐 NOROSHI Slack MCP Server

NOROSHIプロジェクト専用のSlack MCP（Model Context Protocol）サーバーです。CursorやClaude DesktopからSlackを直接操作できます。

## 🏗️ プロジェクト構造

```
slack-mcp-server/
├── 📁 noroshi-mcp-server/     # リモートMCPサーバー（Cloudflare Workers）
│   ├── src/index.ts           # メインMCPサーバー実装
│   ├── wrangler.jsonc         # Cloudflare Workers設定
│   └── package.json           # リモートサーバー依存関係
├── 📄 index.js                # ローカルMCPサーバー（基本版）
├── 📄 task-monitor*.js        # 各種タスクモニター実装
├── 📄 README-MCP.md           # リモートMCP詳細ドキュメント
└── 📄 package.json            # ローカルサーバー依存関係
```

## 🎯 利用可能なサーバー

### 1. 🌐 リモートMCPサーバー（推奨）
- **場所**: `noroshi-mcp-server/`
- **実行環境**: Cloudflare Workers
- **特徴**: 24時間稼働、パソコンの電源状態に依存しない
- **URL**: https://noroshi-mcp-server.tatsu0823takasago.workers.dev

### 2. 💻 ローカルMCPサーバー
- **場所**: `index.js`
- **実行環境**: Node.js（ローカル）
- **特徴**: 開発・テスト用、パソコンの電源が必要

### 3. 🔄 タスクモニター（各種）
- **基本版**: `task-monitor.js`
- **リマインダー付き**: `task-monitor-with-reminder.js`
- **スケジュール版**: `task-monitor-scheduled.js`
- **その他**: 用途別に複数のバリエーション

## 🛠️ 利用可能なMCPツール

| ツール名 | 説明 | パラメータ |
|---------|------|-----------|
| `listChannels` | Slackチャンネル一覧取得 | なし |
| `searchTaskMessages` | タスクメッセージ検索 | channelId, limit |
| `sendTaskReminder` | タスクリマインダー送信 | message |
| `analyzeChannelTasks` | チャンネルタスク分析 | channelId |
| `getWorkspaceTaskOverview` | ワークスペース概要 | なし |
| `getCurrentJapanTime` | 現在の日本時間取得 | なし |

## 🚀 使用方法

### Cursorでの使用
```
@noroshi-tasks Slackチャンネル一覧を表示して
@noroshi-tasks #generalチャンネルにタスクリマインダーを送信して
```

### 直接API呼び出し
```bash
curl -X POST https://noroshi-mcp-server.tatsu0823takasago.workers.dev \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc": "2.0", "id": 1, "method": "tools/call", "params": {"name": "listChannels", "arguments": {}}}'
```

## 📊 ステータス

- ✅ **リモートMCPサーバー**: 稼働中
- ✅ **Slack API統合**: 正常
- ✅ **Cursor連携**: 設定済み
- ✅ **24時間稼働**: 対応済み

## 🔧 開発・メンテナンス

### リモートサーバーのデプロイ
```bash
cd noroshi-mcp-server
npm run deploy
```

### ローカルサーバーの起動
```bash
npm start
```

### タスクモニターの起動
```bash
npm run monitor-scheduled  # スケジュール版
npm run monitor-reminder   # リマインダー版
```

## 📚 詳細ドキュメント

- [リモートMCP詳細](README-MCP.md)
- [タスクモニター設定](TASK-MONITOR-SETUP.md)
- [Cloudflare設定](cloudflare-mcp-setup.md)

---

**NOROSHI Team** - 社内業務効率化プロジェクト 