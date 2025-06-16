# 🌐 NOROSHI MCP Server

NOROSHIタスクモニターをCloudflare Workers上でリモートMCPサーバーとして実装し、CursorやClaude DesktopからSlackタスク管理を直接操作できるシステムです。

## 🎯 特徴

- ✅ **リモートMCPサーバー**: Cloudflare Workers上で24時間稼働
- ✅ **GitHubタスクファイル連携**: プロジェクト内のMarkdownタスクファイルを読み取り
- ✅ **Slackタスク管理**: タスクパターンの自動検出・分析
- ✅ **メンション対応**: `@ユーザー名 タスク教えて`で自動応答
- ✅ **AI統合**: CursorやClaude Desktopから自然言語で操作
- ✅ **無料運用**: Cloudflare無料枠で月10万リクエスト

## 🔧 開発・デプロイの流れ

### ⚠️ 重要：コード修正後の手順

```bash
# 1. コード修正
# src/index.ts を編集

# 2. GitHubにプッシュ（任意）
git add .
git commit -m "修正内容"
git push

# 3. 🚨 必須：Cloudflare Workersに再デプロイ
npx wrangler deploy
```

**注意**: GitHubにプッシュしただけではSlackに反映されません！必ず`npx wrangler deploy`を実行してください。

### デプロイフロー図

```
コード修正 → GitHub push (任意) → npx wrangler deploy (必須) → Slackに反映
```

## 🛠️ 利用可能なMCPツール

| ツール名 | 説明 | パラメータ |
|---------|------|-----------|
| `listChannels` | Slackチャンネル一覧取得 | なし |
| `searchTaskMessages` | タスクメッセージ検索 | channelId, limit |
| `sendTaskReminder` | タスクリマインダー送信 | message |
| `analyzeChannelTasks` | チャンネルタスク分析 | channelId |
| `analyzeUserTasks` | ユーザータスク分析 | userName |
| `getWorkspaceTaskOverview` | ワークスペース概要 | なし |
| `getCurrentJapanTime` | 現在の日本時間取得 | なし |
| `searchNotionManual` | Notionマニュアル検索 | query |

## 📚 新機能: Notion連携

### 🎯 概要
#マニュアルチャンネルで「~~のマニュアル」と投稿すると、Notionからマニュアルページを自動検索して結果を返します。

### 🔍 検索パターン
以下のパターンでマニュアル検索が自動実行されます：
- `Slackのマニュアル`
- `GitHubマニュアル`
- `マニュアル Cursor`
- `Cursorの使い方`
- `Notionについて教えて`

### 📋 検索結果の内容
- **ページタイトル**: マニュアルページの名前
- **直接リンク**: Notionページへの直接アクセス
- **タグ情報**: 関連するタグ
- **最終更新日**: ページの最終編集日時
- **内容プレビュー**: 最初のページの内容抜粋（最大10ブロック）

### ⚙️ Notion連携設定

#### 1. Notion Integration作成
1. [Notion Developers](https://www.notion.com/my-integrations)にアクセス
2. `+ New integration`をクリック
3. 統合名を入力し、ワークスペースを選択
4. `Read content`権限を有効化
5. `Submit`をクリックして作成

#### 2. Integration Tokenを取得
- 作成した統合の`Configuration`タブから`Integration Token`をコピー

#### 3. データベースIDを取得
1. Notionでマニュアル用データベースを開く
2. 右上の`...`メニューから`Copy link`を選択
3. URLから32文字のIDを抽出（例：`8935f9d140a04f95a872520c4f123456`）

#### 4. データベースに統合を接続
1. マニュアルデータベースを開く
2. 右上の`...`メニューから`+ Add connections`を選択
3. 作成した統合を検索して接続

#### 5. 環境変数を設定
```bash
# Notion関連の環境変数を設定
npx wrangler secret put NOTION_TOKEN
npx wrangler secret put NOTION_DATABASE_ID
```

#### 6. データベース構造
マニュアルデータベースには以下のプロパティが必要です：
- **Name** (Title): ページタイトル
- **Tags** (Multi-select): 検索用タグ（任意）
- **Last edited time** (Last edited time): 自動設定

### 🎮 使用例

#### Slackでの自動検索
```
# #マニュアルチャンネルで投稿
Slackのマニュアル
→ Slackに関するマニュアルページを自動検索

Cursorの使い方
→ Cursorの使い方に関するページを検索

GitHubについて教えて
→ GitHubに関するマニュアルを検索
```

#### MCPツールとしての使用
```
# CursorやClaude Desktopから
@noroshi-tasks Slackのマニュアルを検索して
@noroshi-tasks Notionの使い方を教えて
```

## 📊 タスクデータソース

システムは以下の優先順位でタスクデータを取得します：

1. **GitHubタスクファイル** (優先)
   - `タスク/YYYY-MM-DD-tasks.md`
   - GitHub API経由で読み取り
   
2. **Slackメッセージ履歴** (フォールバック)
   - `[タスク]`, `[todo]`等のパターンを検索

## 🚀 セットアップ

### 1. 環境変数設定

```bash
# Slack関連
npx wrangler secret put SLACK_BOT_TOKEN
npx wrangler secret put SLACK_APP_TOKEN
npx wrangler secret put SLACK_TEAM_ID

# GitHub関連
npx wrangler secret put GITHUB_TOKEN
npx wrangler secret put GITHUB_REPO
npx wrangler secret put GITHUB_OWNER
```

### 2. GitHub情報

- **GITHUB_OWNER**: `TaT22444`
- **GITHUB_REPO**: `slack-mcp`
- **GITHUB_TOKEN**: Personal Access Token (repo権限必要)

### 3. デプロイ

```bash
npx wrangler deploy
```

## 🎮 使用例

### Slackでの自動応答

```
@tatsu0823takasago タスク状況を教えて
@tatsu0823takasago タスク教えて
@tatsu0823takasago のタスク
tatsu0823takasagoさんのタスク状況を教えて
```

### Cursorでの使用

```
@noroshi-tasks チャンネル一覧を取得
@noroshi-tasks tatsu0823takasagoのタスクを分析
@noroshi-tasks リマインダーを送信
```

## 📝 対応パターン

### メンション形式
- `@ユーザー名 タスク状況を教えて`
- `@ユーザー名 のタスク状況を教えて`
- `@ユーザー名 タスクを教えて`
- `@ユーザー名 のタスクを教えて`
- `@ユーザー名 タスク状況`
- `@ユーザー名 のタスク状況`
- `@ユーザー名 タスク教えて`
- `@ユーザー名 のタスク`

### テキスト形式
- `ユーザー名さんのタスク状況を教えて`
- `ユーザー名のタスク状況を教えて`
- `ユーザー名さんのタスクを教えて`
- `ユーザー名のタスクを教えて`

## 🔍 トラブルシューティング

### よくある問題

1. **コード修正が反映されない**
   ```bash
   # 解決方法：再デプロイを実行
   npx wrangler deploy
   ```

2. **GitHub API エラー**
   ```bash
   # トークンの権限確認
   # repo権限が必要
   ```

3. **Slack応答なし**
   ```bash
   # ログ確認
   npx wrangler tail --format pretty
   ```

### ログ確認

```bash
# リアルタイムログ監視
npx wrangler tail --format pretty

# 特定の時間のログ
npx wrangler tail --since 1h
```

## 📊 アーキテクチャ

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

## 💰 コスト

- **Cloudflare Workers**: 無料枠で月10万リクエスト
- **GitHub API**: 無料（認証済みで5000リクエスト/時間）
- **実質無料**: 通常の使用では無料枠内で十分

## 🔄 開発ワークフロー

### 日常的な修正

1. **コード編集**: `src/index.ts`
2. **テスト**: ローカルで確認
3. **デプロイ**: `npx wrangler deploy`
4. **確認**: Slackでテスト

### 大きな変更

1. **ブランチ作成**: `git checkout -b feature/new-feature`
2. **開発**: コード修正
3. **テスト**: `npx wrangler dev` でローカルテスト
4. **デプロイ**: `npx wrangler deploy`
5. **マージ**: `git merge` でmainに統合

## 📚 参考資料

- [Model Context Protocol (MCP)](https://modelcontextprotocol.io/)
- [Cloudflare Workers](https://workers.cloudflare.com/)
- [Slack API](https://api.slack.com/)
- [GitHub API](https://docs.github.com/en/rest)

## 🎉 完了！

これでNOROSHIタスクモニターがCloudflare上でリモートMCPサーバーとして稼働し、GitHubタスクファイルと連携した24時間365日のAI統合タスク管理システムが完成です！🌟
