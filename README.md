概要

Notion のタスクを毎朝 LINE（Messaging API）で自動通知し、通知内のワンタップ（postback）で Notion のタスク状態を更新できるボット。

主な機能

毎朝 Notion の未完了タスクを収集して LINE に配信

通知からワンタップでタスクを「完了」などに更新

友だち追加で userId を自動登録 → 一括送信可能

必要条件

Notion Integration（APIキー）＋対象データベース共有

LINE Developers チャネル（Channel access token + Channel secret）

実行環境：GAS（簡易・MVP） または Cloud Run（本番向け）

環境変数（必須）

NOTION_API_KEY, DATABASE_ID, LINE_CHANNEL_ACCESS_TOKEN, LINE_CHANNEL_SECRET

Quickstart（要点だけ）
GAS（最速で試す）

GAS プロジェクトにスクリプトを貼る（Notion/LINE 呼び出し・署名検証含む）

定数に NOTION_API_KEY 等をセット

Web アプリとしてデプロイ → 発行 URL を LINE の Webhook に設定

GAS トリガーで main() を毎朝実行

Cloud Run（本番向け）

Express アプリ（/webhook）と worker（Notion→LINE送信）を作成

Dockerize → gcloud builds submit → gcloud run deploy（環境変数に鍵を設定）

Cloud Scheduler → Pub/Sub → Cloud Run worker で毎朝実行

Cloud Run の /webhook を LINE の Webhook に設定

Notion 側（必須プロパティ）

チェック(Checkbox)、日付(Date)、タスク名(Title)、カテゴリー(Select)、状態(Select)
（プロパティ名が違う場合はコードを合わせてください）

Webhook / postback 仕様（推奨）

通知のボタンは postback、data に action=done&pageId=PAGE_ID を入れる

Webhook で postback.data をパース → Notion に PATCH → replyToken でユーザーに結果を返す