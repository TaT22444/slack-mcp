# 🌐 NOROSHI MCP Server

NOROSHIタスクモニターをCloudflare Workers上でリモートMCPサーバーとして実装し、CursorやClaude DesktopからSlackタスク管理を直接操作できるシステムです。

## 🎯 特徴

- ✅ **リモートMCPサーバー**: Cloudflare Workers上で24時間稼働
- ✅ **Slackタスク管理**: タスクパターンの自動検出・分析
- ✅ **AI統合**: CursorやClaude Desktopから自然言語で操作
- ✅ **リアルタイム**: Slack APIを使用したリアルタイム情報取得
- ✅ **無料運用**: Cloudflare無料枠で月10万リクエスト

## 🛠️ 利用可能なMCPツール

| ツール名 | 説明 | パラメータ |
|---------|------|-----------|
| `listChannels` | Slackチャンネル一覧取得 | なし |
| `searchTaskMessages` | タスクメッセージ検索 | channelId, limit |
| `sendTaskReminder` | タスクリマインダー送信 | message |
| `analyzeChannelTasks` | チャンネルタスク分析 | channelId |
| `getWorkspaceTaskOverview` | ワークスペース概要 | なし |
| `getCurrentJapanTime` | 現在の日本時間取得 | なし |

## 🚀 セットアップ

### 1. 前提条件

- Cloudflareアカウント
- Node.js 18以上
- Slack Bot Token & App Token

### 2. プロジェクト作成

```bash
# 新しいCloudflare Workerプロジェクトを作成
npx create-cloudflare@latest noroshi-mcp-server

# プロジェクトディレクトリに移動
cd noroshi-mcp-server

# workers-mcpをインストール
npm install workers-mcp

# MCP設定を実行
npx workers-mcp setup
```

### 3. 環境変数設定

```bash
# Cloudflareシークレットを設定
npx wrangler secret put SLACK_BOT_TOKEN
npx wrangler secret put SLACK_APP_TOKEN
npx wrangler secret put SLACK_TEAM_ID
```

### 4. デプロイ

```bash
# Cloudflareにデプロイ
npx wrangler deploy
```

## 🔧 MCP クライアント設定

### Claude Desktop

`~/.config/claude_desktop_config.json` に追加：

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

### Cursor

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

## 🎮 使用例

### Claude Desktopでの使用

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

### Cursorでの使用

```
# MCP経由でSlackタスクを管理
@noroshi-tasks チャンネル一覧を取得

# 特定チャンネルの分析
@noroshi-tasks C091H8NUJ8Lのタスクを分析

# リマインダー送信
@noroshi-tasks 定時リマインダーを送信
```

## 📊 アーキテクチャ

```
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│   Cursor/Claude │────│ Cloudflare MCP   │────│   Slack API     │
│     Desktop     │    │     Server       │    │                 │
└─────────────────┘    └──────────────────┘    └─────────────────┘
        │                        │                        │
        │                        │                        │
        ▼                        ▼                        ▼
   自然言語指示            MCP Protocol            タスクデータ
```

## 🔍 トラブルシューティング

### よくある問題

1. **認証エラー**
   ```bash
   npx wrangler secret put SLACK_BOT_TOKEN
   ```

2. **デプロイエラー**
   ```bash
   npx wrangler login
   ```

3. **MCP接続エラー**
   ```bash
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

## 🚀 拡張機能

### 今後の実装予定

1. **認証機能**: OAuth2.0でユーザー認証
2. **データ永続化**: Cloudflare KVでタスクデータ保存
3. **Webhook統合**: リアルタイムタスク更新
4. **AI分析**: Workers AIでタスク内容分析
5. **ダッシュボード**: Web UIでタスク可視化

### カスタマイズ例

```typescript
// 新しいMCPツールの追加例
/**
 * カスタムタスク分析を実行します
 * @param query {string} 分析クエリ
 * @returns {Promise<string>} 分析結果
 */
async customTaskAnalysis(query: string): Promise<string> {
  // カスタム分析ロジック
  return `分析結果: ${query}`
}
```

## 📚 参考資料

- [Model Context Protocol (MCP)](https://modelcontextprotocol.io/)
- [Cloudflare Workers](https://workers.cloudflare.com/)
- [Slack API](https://api.slack.com/)
- [workers-mcp](https://github.com/cloudflare/workers-mcp)

## 🤝 コントリビューション

1. このリポジトリをフォーク
2. 機能ブランチを作成 (`git checkout -b feature/amazing-feature`)
3. 変更をコミット (`git commit -m 'Add amazing feature'`)
4. ブランチにプッシュ (`git push origin feature/amazing-feature`)
5. プルリクエストを作成

## 📄 ライセンス

MIT License - 詳細は [LICENSE](LICENSE) ファイルを参照

## 🎉 完了！

これでNOROSHIタスクモニターがCloudflare上でリモートMCPサーバーとして稼働し、CursorやClaude Desktopから直接Slackタスク管理ができるようになりました！

24時間365日稼働する、グローバルにアクセス可能なAI統合タスク管理システムの完成です！🌟 