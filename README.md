**概要**

Notion のタスクを毎朝 LINE（Messaging API）で自動通知し、通知内のワンタップ（postback）で Notion のタスク状態を更新できるボット。

**主な機能**

- 毎朝 Notion の未完了タスクを収集して LINE に配信

- 通知からワンタップでタスクを「完了」などに更新

- 友だち追加で userId を自動登録 → 一括送信可能

**必要条件**

- Notion Integration（APIキー）＋対象データベース共有

- LINE Developers チャネル（Channel access token + Channel secret）

- 実行環境：GAS

**環境変数（必須のもの）**

- NOTION_API_KEY
- DATABASE_ID
- LINE_CHANNEL_ACCESS_TOKEN
- LINE_CHANNEL_SECRET

**GASでの利用法**

1. GAS プロジェクトにスクリプトを貼る
2. PropertiesService に NOTION_API_KEY 等をセット
3. Web アプリとしてデプロイ → 発行 URL を LINE の Webhook に設定
4. GAS トリガーで毎朝実行
