/*********************************
 * Notion -> LINE: 本日の残タスク通知
 *********************************/

/**
 * 元の関数名を踏襲: getTodayIncompleteTasks()
 * Notion から「状態 = 本日中対応」かつ「チェック = false」のタスクを取得して
 * カテゴリ別に整形し、LINE に Push で通知します。
 */
function getTodayIncompleteTasks() {
  try {
    // Notion API query（ページネーション対応）
    const url = 'https://api.notion.com/v1/databases/' + DATABASE_ID + '/query';
    const payloadBase = {
      filter: {
        and: [
          {
            property: "状態",
            select: { equals: "本日中対応" }
          },
          {
            property: "チェック",
            checkbox: { equals: false }
          }
        ]
      }
    };

    const headers = {
      'Authorization': 'Bearer ' + NOTION_API_KEY,
      'Notion-Version': NOTION_VERSION,
      'Content-Type': 'application/json'
    };

    let allResults = [];
    let startCursor = null;
    do {
      const body = Object.assign({}, payloadBase);
      if (startCursor) body.start_cursor = startCursor;

      const options = {
        method: 'post',
        contentType: 'application/json',
        headers: headers,
        payload: JSON.stringify(body),
        muteHttpExceptions: true
      };

      const resp = UrlFetchApp.fetch(url, options);
      const code = resp.getResponseCode();
      const text = resp.getContentText();
      if (code < 200 || code >= 300) {
        throw new Error('Notion API error: HTTP ' + code + ' - ' + text);
      }

      const data = JSON.parse(text);
      if (data.results && data.results.length) allResults = allResults.concat(data.results);
      startCursor = data.has_more ? data.next_cursor : null;
    } while (startCursor);

    // タスクがなければ LINE へ「なし」を送信して終了
    if (!allResults || allResults.length === 0) {
      sendLineMessage("📋 本日中対応の未完了タスクはありません。お疲れさまです！");
      return;
    }

    // カテゴリ別に分類
    const categoryMap = {};
    allResults.forEach(function(task) {
      const props = task.properties || {};
      const taskName = safeExtractTitle(props['タスク名']) || '（タイトルなし）';
      const category = (props['カテゴリー'] && props['カテゴリー'].select && props['カテゴリー'].select.name) ? props['カテゴリー'].select.name : '未分類';

      if (!categoryMap[category]) categoryMap[category] = [];
      categoryMap[category].push(taskName);
    });

    // メッセージ構築（LINE テキスト）
    let message = "📋 本日の残タスクはこちらです！\n";
    let taskNumber = 1;
    for (const category in categoryMap) {
      message += `\n【${category}】\n`;
      categoryMap[category].forEach(function(t) {
        message += `${taskNumber}. ${t}\n`;
        taskNumber++;
      });
    }

    // LINE に送信
    sendLineMessage(message);
  } catch (err) {
    Logger.log('getTodayIncompleteTasks error: ' + err);
    // エラーが発生したら管理者（自分）に通知しておくと安心
    sendLineMessage('（自動通知）本日のタスク取得でエラーが発生しました。ログを確認してください。');
  }
}

/**
 * Notion title プロパティを安全に取り出すヘルパー
 */
function safeExtractTitle(titleProp) {
  try {
    if (!titleProp) return null;
    // 新しい Notion のレスポンスで title は titleProp.title の配列かもしれない
    if (Array.isArray(titleProp.title)) {
      if (titleProp.title.length === 0) return null;
      // 各要素の plain_text を連結して返す（フォールバックで text.content）
      return titleProp.title.map(function(t) {
        if (!t) return '';
        if (t.plain_text) return t.plain_text;
        if (t.text && t.text.content) return t.text.content;
        return '';
      }).join('');
    }
    // 古い構造を想定（直接 titleProp[0] 等）
    if (Array.isArray(titleProp)) {
      return titleProp.map(function(t) {
        if (!t) return '';
        if (t.plain_text) return t.plain_text;
        if (t.text && t.text.content) return t.text.content;
        return '';
      }).join('');
    }
    return null;
  } catch (e) {
    Logger.log('safeExtractTitle error: ' + e);
    return null;
  }
}

/**
 * LINE Push 送信ヘルパー
 */
// function sendLineMessage(text) {
//   if (!LINE_CHANNEL_ACCESS_TOKEN || !LINE_TO) {
//     Logger.log('LINE_CHANNEL_ACCESS_TOKEN または LINE_TO が未設定です。');
//     return;
//   }

//   const url = 'https://api.line.me/v2/bot/message/push';
//   const payload = {
//     to: LINE_TO,
//     messages: [
//       { type: 'text', text: text }
//     ]
//   };

//   const options = {
//     method: 'post',
//     contentType: 'application/json',
//     headers: {
//       Authorization: 'Bearer ' + LINE_CHANNEL_ACCESS_TOKEN
//     },
//     payload: JSON.stringify(payload),
//     muteHttpExceptions: true
//   };

//   try {
//     const resp = UrlFetchApp.fetch(url, options);
//     const code = resp.getResponseCode();
//     const body = resp.getContentText();
//     Logger.log('LINE push response: ' + code + ' / ' + body);
//     if (code < 200 || code >= 300) {
//       throw new Error('LINE push failed: HTTP ' + code + ' - ' + body);
//     }
//   } catch (err) {
//     Logger.log('sendLineMessage error: ' + err);
//   }
// }

/**
 * 補助: reply 用（Webhook で userId を確認したい場合に使う）
 * doPost で reply する際の helper です（任意で使ってください）
 */
// function replyLineMessage(replyToken, message) {
//   if (!LINE_CHANNEL_ACCESS_TOKEN) return;
//   const url = 'https://api.line.me/v2/bot/message/reply';
//   const payload = {
//     replyToken: replyToken,
//     messages: [{ type: 'text', text: message }]
//   };
//   const options = {
//     method: 'post',
//     contentType: 'application/json',
//     headers: {
//       Authorization: 'Bearer ' + LINE_CHANNEL_ACCESS_TOKEN
//     },
//     payload: JSON.stringify(payload),
//     muteHttpExceptions: true
//   };
//   try {
//     const resp = UrlFetchApp.fetch(url, options);
//     Logger.log('LINE reply response: ' + resp.getResponseCode() + ' / ' + resp.getContentText());
//   } catch (e) {
//     Logger.log('replyLineMessage error: ' + e);
//   }
// }
