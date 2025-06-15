# NOROSHI タスク自動監視機能 セットアップガイド

## 🎯 概要
Slackで`[タスク]`パターンのメッセージを自動検出し、#generalチャンネルに転送する機能です。

## 📋 検出パターン
以下のパターンを含むメッセージを自動検出します：
- `[タスク]`
- `[本日のタスク]`
- `[今日のタスク]`
- `[task]`
- `[todo]`
- `[やること]`

## ⚙️ セットアップ手順

### 1. Slack App設定の更新

#### A. Event Subscriptions を有効化
1. [Slack API](https://api.slack.com/apps) にアクセス
2. NOROSHI-AI アプリを選択
3. **Event Subscriptions** をクリック
4. **Enable Events** をONにする
5. **Request URL** に以下を設定：
   ```
   https://your-domain.com/slack/events
   ```
   ※ ngrokやCloudflareトンネルを使用してローカル開発可能

#### B. Bot Events を追加
**Subscribe to bot events** セクションで以下を追加：
- `message.channels` - パブリックチャンネルのメッセージ
- `message.groups` - プライベートチャンネルのメッセージ
- `message.im` - ダイレクトメッセージ

#### C. Signing Secret を取得
1. **Basic Information** をクリック
2. **App Credentials** セクションの **Signing Secret** をコピー

### 2. 環境変数の設定

`.env` ファイルに以下を追加：
```bash
# 既存の設定
SLACK_BOT_TOKEN=xoxb-your-bot-token
SLACK_TEAM_ID=your-team-id

# 新規追加
SLACK_SIGNING_SECRET=your-signing-secret
PORT=3000
```

### 3. 開発環境でのテスト

#### ngrokを使用したローカル開発
```bash
# ngrokをインストール（未インストールの場合）
npm install -g ngrok

# ローカルサーバーを起動
npm run monitor

# 別ターミナルでngrokを起動
ngrok http 3000
```

ngrokで表示されたHTTPS URLを Slack App の Request URL に設定。

### 4. 本番環境デプロイ

#### Heroku デプロイ例
```bash
# Herokuアプリ作成
heroku create noroshi-task-monitor

# 環境変数設定
heroku config:set SLACK_BOT_TOKEN=xoxb-your-token
heroku config:set SLACK_TEAM_ID=your-team-id
heroku config:set SLACK_SIGNING_SECRET=your-secret

# デプロイ
git add .
git commit -m "Add task monitor"
git push heroku main
```

## 🚀 使用方法

### 1. 監視サーバー起動
```bash
npm run monitor
```

### 2. テスト投稿
任意のチャンネル（#general以外）で以下のようなメッセージを投稿：
```
[タスク]
・資料作成
・会議準備
・レビュー対応
```

### 3. 自動転送確認
- #generalチャンネルに自動転送される
- 元メッセージに✅リアクションが追加される

## 🔧 カスタマイズ

### パターン追加
`task-monitor.js` の `TASK_PATTERNS` 配列に追加：
```javascript
const TASK_PATTERNS = [
  /\[タスク\]/i,
  /\[本日のタスク\]/i,
  /\[新しいパターン\]/i  // 追加
];
```

### 転送先チャンネル変更
`GENERAL_CHANNEL_ID` を変更：
```javascript
const GENERAL_CHANNEL_ID = 'C02TJS8D205'; // #generalのID
```

## 🐛 トラブルシューティング

### よくあるエラー

#### 1. `SLACK_SIGNING_SECRET` エラー
```
❌ SLACK_SIGNING_SECRET environment variable is required
```
**解決方法**: Slack App の Basic Information から Signing Secret を取得し、.env に追加

#### 2. `url_verification` エラー
```
❌ Request URL verification failed
```
**解決方法**: ngrok URL が正しく設定されているか確認

#### 3. `missing_scope` エラー
```
❌ missing_scope: message.channels
```
**解決方法**: Bot Events に必要なスコープを追加

## 📊 ログ出力例
```
🚀 Starting NOROSHI Task Monitor...
⚡️ NOROSHI Task Monitor is running!
🔍 Monitoring for task messages...
📋 Task message detected!
📍 Channel: C091H8NUJ8L
👤 User: U02TQ34K39S
💬 Message: [タスク] 資料作成完了
✅ Task message forwarded to #general
✅ Reaction added to original message
```

## 🔒 セキュリティ注意事項
- Signing Secret は秘匿情報として管理
- 本番環境では HTTPS 必須
- Bot Token の権限を最小限に設定 