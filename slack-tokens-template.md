# NOROSHI Slack MCP Server トークン設定

## 🔧 設定手順

### 1. Slack App作成
[Slack API Applications](https://api.slack.com/apps/)でAppを作成

### 2. 必要な権限設定
以下のBot Token Scopesを設定：
- `channels:history` - チャンネル履歴の読み取り
- `channels:read` - チャンネル情報の取得
- `chat:write` - メッセージの送信
- `reactions:write` - リアクションの追加
- `users:read` - ユーザー情報の取得

### 3. ワークスペースにインストール
「Install to Workspace」でワークスペースにインストール

### 4. トークン取得
- **Bot User OAuth Token**: `xoxb-`で始まる文字列
- **Team ID**: SlackのURLから取得（例：`T01234567`）

### 5. 設定ファイル更新

以下のファイルを更新してください：

#### `.cursor/mcp.json`
```json
{
  "mcpServers": {
    "noroshi-slack": {
      "command": "node",
      "args": ["./slack-mcp-server/index.js"],
      "env": {
        "SLACK_BOT_TOKEN": "xoxb-あなたの実際のトークンをここに",
        "SLACK_TEAM_ID": "T01234567"
      }
    }
  }
}
```

## 🔐 セキュリティ注意事項

- トークンは絶対に公開しないでください
- `.env`ファイルは`.gitignore`に追加してください
- 定期的にトークンをローテーションしてください

## ✅ 設定完了後

1. Cursorを再起動
2. Composerで「Slackチャンネル一覧を取得して」などと依頼
3. 正常に動作することを確認 