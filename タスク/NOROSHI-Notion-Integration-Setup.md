# 📚 NOROSHI Notion連携セットアップガイド

## 🎯 概要

NOROSHI MCPサーバーにNotion連携機能を追加し、Slackの#マニュアルチャンネルで「~~のマニュアル」と投稿すると、Notionからマニュアルページを自動検索して結果を返す機能を実装します。

## 🔧 セットアップ手順

### ステップ1: Notion Integration作成

1. **Notion Developers**にアクセス
   - URL: https://www.notion.com/my-integrations
   - Notionアカウントでログイン

2. **新しい統合を作成**
   - `+ New integration`ボタンをクリック
   - 統合名を入力（例：`NOROSHI Manual Search`）
   - ワークスペースを選択
   - 統合タイプ：`Internal`を選択

3. **権限設定**
   - `Read content`権限を有効化
   - 他の権限は不要

4. **統合を作成**
   - `Submit`ボタンをクリック

### ステップ2: Integration Token取得

1. **Configuration**タブを開く
2. **Integration Token**をコピー
   - 形式：`secret_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx`
   - このトークンは秘密情報として厳重に管理

### ステップ3: マニュアルデータベース作成

1. **Notionでデータベース作成**
   - 新しいページを作成
   - `/database`と入力してデータベースを追加
   - データベース名：`マニュアル`または`Manual`

2. **必要なプロパティ設定**
   ```
   - Name (Title): ページタイトル ✅ 必須
   - Tags (Multi-select): 検索用タグ（任意）
   - Last edited time (Last edited time): 自動設定 ✅ 必須
   ```

3. **サンプルデータ追加**
   ```
   | Name | Tags | Last edited time |
   |------|------|------------------|
   | Slack使い方ガイド | slack, communication | 自動設定 |
   | GitHub操作マニュアル | github, git, development | 自動設定 |
   | Cursor設定方法 | cursor, ide, development | 自動設定 |
   | Notion API連携 | notion, api, integration | 自動設定 |
   ```

### ステップ4: データベースIDを取得

1. **データベースを開く**
2. **URLをコピー**
   - 右上の`...`メニュー → `Copy link`
   - 例：`https://www.notion.so/username/8935f9d140a04f95a872520c4f123456?v=...`

3. **データベースIDを抽出**
   - URLから32文字のIDを取得
   - 例：`8935f9d140a04f95a872520c4f123456`

### ステップ5: データベースに統合を接続

1. **データベースページを開く**
2. **統合を接続**
   - 右上の`...`メニュー → `+ Add connections`
   - 作成した統合を検索して選択
   - `Connect`をクリック

3. **接続確認**
   - 統合がデータベースにアクセス可能になったことを確認

### ステップ6: 環境変数設定

```bash
# Cloudflare Workersに環境変数を設定
cd NOROSHI

# Notion Integration Token
npx wrangler secret put NOTION_TOKEN
# 入力プロンプトで先ほど取得したトークンを入力

# Notion Database ID  
npx wrangler secret put NOTION_DATABASE_ID
# 入力プロンプトで先ほど取得したデータベースIDを入力
```

### ステップ7: デプロイ

```bash
# 更新されたコードをデプロイ
npx wrangler deploy
```

## 🎮 使用方法

### Slackでの自動検索

#マニュアルチャンネル（`C091P73EPGS`）で以下のパターンで投稿：

```
Slackのマニュアル
→ Slackに関するマニュアルページを検索

GitHubマニュアル  
→ GitHubに関するマニュアルページを検索

マニュアル Cursor
→ Cursorに関するマニュアルページを検索

Cursorの使い方
→ Cursorの使い方に関するページを検索

Notionについて教えて
→ Notionに関するマニュアルを検索
```

### 検索パターン

システムが認識する検索パターン：
- `(.+?)のマニュアル`
- `(.+?)マニュアル`
- `マニュアル\s*(.+)`
- `manual\s*(.+)`
- `(.+?)\s*manual`
- `(.+?)の使い方`
- `(.+?)について教えて`

### MCPツールとしての使用

```bash
# CursorやClaude Desktopから
@noroshi-tasks Slackのマニュアルを検索して
@noroshi-tasks Notionの使い方を教えて
@noroshi-tasks GitHubマニュアルを探して
```

## 📋 検索結果の内容

検索結果には以下の情報が含まれます：

1. **ページタイトル**: マニュアルページの名前
2. **直接リンク**: Notionページへの直接アクセスURL
3. **タグ情報**: 関連するタグ（設定されている場合）
4. **最終更新日**: ページの最終編集日時（JST）
5. **内容プレビュー**: 最初のページの内容抜粋（最大10ブロック）

### 検索結果例

```
📚 **「Slack」のマニュアル検索結果**

🔍 **見つかったページ**: 2件

## 1. Slack使い方ガイド
🔗 **リンク**: https://www.notion.so/slack-guide-123456
🏷️ **タグ**: slack, communication
📅 **最終更新**: 2025/6/17 10:30:45

📄 **内容プレビュー**:
# Slack使い方ガイド
## 基本操作
• メッセージの送信方法
• チャンネルの作成と管理
• ダイレクトメッセージの使い方

## 2. Slack API連携
🔗 **リンク**: https://www.notion.so/slack-api-456789
🏷️ **タグ**: slack, api, development
📅 **最終更新**: 2025/6/16 15:20:30

💡 *データソース: Notion Database*
```

## 🔍 トラブルシューティング

### よくある問題

#### 1. 検索結果が表示されない
**原因**: 
- Notion統合がデータベースに接続されていない
- 環境変数が正しく設定されていない

**解決方法**:
```bash
# 環境変数確認
npx wrangler secret list

# 統合接続確認
# Notionデータベースの設定を再確認
```

#### 2. 「Notion連携が設定されていません」エラー
**原因**: 環境変数が設定されていない

**解決方法**:
```bash
# 環境変数を再設定
npx wrangler secret put NOTION_TOKEN
npx wrangler secret put NOTION_DATABASE_ID

# デプロイ
npx wrangler deploy
```

#### 3. 検索パターンが認識されない
**原因**: 検索クエリが短すぎる（2文字未満）

**解決方法**:
- より具体的なキーワードを使用
- 最低3文字以上のクエリを入力

#### 4. ページ内容が表示されない
**原因**: ページにアクセス権限がない

**解決方法**:
- 各マニュアルページに統合を個別に接続
- ページの`...`メニュー → `+ Add connections`

## 📊 システム構成

```
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│   Slack         │────│ Cloudflare MCP   │────│   Notion API    │
│   #マニュアル   │    │     Server       │    │   Database      │
│   チャンネル    │    │                  │    │                 │
└─────────────────┘    └──────────────────┘    └─────────────────┘
         │                        │                        │
         │                        │                        │
         ▼                        ▼                        ▼
   メッセージ投稿           パターン検索実行           マニュアル検索
   「Slackのマニュアル」    → クエリ抽出              → 結果返却
                          → Notion API呼び出        → 内容取得
```

## 🚀 今後の拡張予定

### Phase 2: 高度な検索機能
- ファジー検索対応
- 複数キーワード検索
- 検索履歴機能

### Phase 3: コンテンツ管理
- マニュアル更新通知
- 使用頻度統計
- おすすめマニュアル機能

### Phase 4: 多言語対応
- 英語マニュアル検索
- 自動翻訳機能

---

**作成日**: 2025年6月17日  
**作成者**: 相原立弥  
**バージョン**: 1.0  
**最終更新**: 2025年6月17日 