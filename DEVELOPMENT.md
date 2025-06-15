# 🔧 NOROSHI 開発・デプロイガイド

## ⚠️ 最重要：コード修正後の必須手順

### 🚨 忘れやすいポイント

```bash
# ❌ これだけではSlackに反映されない
git add .
git commit -m "修正"
git push

# ✅ 必ずこれを実行する
cd slack-mcp-server/noroshi-mcp-server
npx wrangler deploy
```

## 📋 開発フロー

### 1. 日常的なコード修正

```bash
# 1. コード編集
vim slack-mcp-server/noroshi-mcp-server/src/index.ts

# 2. ローカルテスト（任意）
cd slack-mcp-server/noroshi-mcp-server
npx wrangler dev --local

# 3. 🚨 本番デプロイ（必須）
npx wrangler deploy

# 4. Slackでテスト
# @tatsu0823takasago タスク教えて
```

### 2. GitHub連携

```bash
# GitHubにも保存したい場合
git add .
git commit -m "機能追加: メンションパターン拡張"
git push
```

## 🔍 デバッグ・ログ確認

### リアルタイムログ監視

```bash
cd slack-mcp-server/noroshi-mcp-server
npx wrangler tail --format pretty
```

### 過去のログ確認

```bash
# 過去1時間のログ
npx wrangler tail --since 1h

# 過去1日のログ
npx wrangler tail --since 1d
```

## 🔧 環境変数管理

### 現在の設定確認

```bash
# 設定済みシークレット一覧
npx wrangler secret list
```

### 新しいシークレット追加

```bash
# 例：新しいAPI キーを追加
npx wrangler secret put NEW_API_KEY
```

## 📊 プロジェクト構造

```
NOROSHI/
├── タスク/                          # GitHubから読み取られるタスクファイル
│   ├── 2025-06-15-tasks.md
│   └── 2025-06-14-tasks.md
├── slack-mcp-server/
│   └── noroshi-mcp-server/          # Cloudflare Workers プロジェクト
│       ├── src/index.ts             # メインコード
│       ├── wrangler.jsonc           # Cloudflare設定
│       └── README.md                # 詳細ドキュメント
└── DEVELOPMENT.md                   # このファイル
```

## 🎯 テスト方法

### 1. Slack自動応答テスト

```
# #generalチャンネルで以下を送信
@tatsu0823takasago タスク教えて
@tatsu0823takasago のタスク
tatsu0823takasagoさんのタスク状況を教えて
```

### 2. MCP機能テスト

```
# Cursorで以下を実行
@noroshi-tasks チャンネル一覧を取得
@noroshi-tasks tatsu0823takasagoのタスクを分析
```

## 🚨 よくあるエラーと解決方法

### 1. 「コード修正したのに反映されない」

**原因**: `npx wrangler deploy`を忘れている

**解決方法**:
```bash
cd slack-mcp-server/noroshi-mcp-server
npx wrangler deploy
```

### 2. 「GitHub APIエラー」

**原因**: トークンの権限不足

**解決方法**:
- GitHub Personal Access Tokenに`repo`権限があるか確認
- トークンの有効期限を確認

### 3. 「Slack応答なし」

**原因**: Events APIの設定問題

**解決方法**:
1. Slack App設定でEvents APIが有効か確認
2. `message.channels`イベントが追加されているか確認
3. Request URLが正しく設定されているか確認

## 📈 パフォーマンス監視

### Cloudflare Analytics

1. [Cloudflare Dashboard](https://dash.cloudflare.com/)
2. Workers & Pages → noroshi-mcp-server
3. Analytics タブで使用状況確認

### 使用量の目安

- **無料枠**: 月10万リクエスト
- **通常使用**: 月1000-5000リクエスト程度
- **十分な余裕**: あり

## 🔄 バックアップ・復旧

### コードバックアップ

```bash
# GitHubに定期的にプッシュ
git add .
git commit -m "定期バックアップ"
git push
```

### 設定バックアップ

```bash
# 環境変数をローカルファイルに保存（.envファイル）
# 注意：.envファイルはGitにコミットしない
```

## 🎉 成功の確認

以下が全て動作すれば成功：

1. ✅ Slackでメンション応答
2. ✅ GitHubタスクファイル読み取り
3. ✅ CursorからMCP操作
4. ✅ 24時間稼働

## 📞 サポート

問題が発生した場合：

1. **ログ確認**: `npx wrangler tail --format pretty`
2. **再デプロイ**: `npx wrangler deploy`
3. **設定確認**: Slack App設定、GitHub権限
4. **ドキュメント参照**: README.md

---

**重要**: 修正後は必ず`npx wrangler deploy`を実行することを忘れずに！ 