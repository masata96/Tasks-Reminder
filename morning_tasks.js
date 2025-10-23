const NOTION_API_KEY = getProp('NOTION_API_KEY');
const DATABASE_ID = getProp('DATABASE_ID');
const NOTION_VERSION = '2022-06-28';
const LINE_CHANNEL_ACCESS_TOKEN = getProp('LINE_CHANNEL_ACCESS_TOKEN');
const LINE_TO = getProp('LINE_TO');

function remind_every_morning() {
  try {
    const tasks = queryIncompleteTasks();
    if (!tasks || tasks.length === 0) {
      const msg = "🌅 おはようございます！本日のタスクはありません。うれしいね";
      sendLineMessage(msg);
      return;
    }

      const todayTasks = [];
    // スクリプト（GAS）で使うタイムゾーン
    const tz = Session.getScriptTimeZone ? Session.getScriptTimeZone() : 'UTC';
    const todayStr = Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd');

    tasks.forEach(page => {
      const properties = page.properties || {};
      const dateProperty = properties['日付'];
      const taskName = extractTitle(properties['タスク名']) || "（タイトルなし）";

      if (!dateProperty || !dateProperty.date || !dateProperty.date.start) return;

      const start = dateProperty.date.start; // 文字列
      let taskDateStr;

      // date-only (YYYY-MM-DD) の場合はそのまま日付文字列を使う
      if (/^\d{4}-\d{2}-\d{2}$/.test(start)) {
        taskDateStr = start;
      } else {
        const d = new Date(start);
        if (isNaN(d.getTime())) return; // 予期しない形式ならスキップ
        taskDateStr = Utilities.formatDate(d, tz, 'yyyy-MM-dd');
      }

      if (taskDateStr <= todayStr) {
        try {
          updateTaskStatus(page.id, '本日中対応');
        } catch (err) {
          Logger.log(`ページ ${page.id} の状態更新でエラー: ${err}`);
        }
        const category = (properties['カテゴリー'] && properties['カテゴリー'].select) ? properties['カテゴリー'].select.name : '未分類';
        todayTasks.push({ name: taskName, category: category });
      }
    });
    
    // メッセージ作成
    if (todayTasks.length > 0) {
      const categoryMap = {};
      todayTasks.forEach(t => {
        if (!categoryMap[t.category]) categoryMap[t.category] = [];
        categoryMap[t.category].push(t.name);
      });

      let message = "🌅 おはようございます！本日のタスクはこちらです！\n今日も一日頑張りましょう！\n";
      let idx = 1;
      for (const cat in categoryMap) {
        message += `\n【${cat}】\n`;
        categoryMap[cat].forEach(name => {
          message += `${idx}. ${name}\n`;
          idx++;
        });
      }
      sendLineMessage(message);
    } else {
      sendLineMessage("🌅 おはようございます！本日のタスクはありません。うれしいね");
    }
  } catch (e) {
    Logger.log("main() エラー: " + e);
    // 管理者へ通知する場合はここで sendLineMessageを呼ぶ
    sendLineMessage("（自動通知）タスク通知処理でエラーが発生しました。ログを確認してください。");
  }
}


 // Notion: 未完了タスクを取得（ページネーション対応）
function queryIncompleteTasks() {
  const url = `https://api.notion.com/v1/databases/${DATABASE_ID}/query`;
  const payloadBase = {
    filter: {
      and: [
        {
          property: "チェック",
          checkbox: {
            equals: false
          }
        }
      ]
    }
  };

  const headers = {
    "Authorization": `Bearer ${NOTION_API_KEY}`,
    "Notion-Version": NOTION_VERSION,
    "Content-Type": "application/json"
  };

  let allResults = [];
  let startCursor = null;
  do {
    const payload = Object.assign({}, payloadBase);
    if (startCursor) payload.start_cursor = startCursor;

    const options = {
      method: 'post',
      contentType: 'application/json',
      headers: headers,
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    };

    const resp = UrlFetchApp.fetch(url, options);
    const code = resp.getResponseCode();
    const text = resp.getContentText();
    if (code < 200 || code >= 300) {
      throw new Error(`Notion API query error: HTTP ${code} - ${text}`);
    }
    const json = JSON.parse(text);
    if (json.results && json.results.length) allResults = allResults.concat(json.results);
    startCursor = json.has_more ? json.next_cursor : null;
  } while (startCursor);

  return allResults;
}

 //Notion: ページの状態を更新する
function updateTaskStatus(pageId, newStatus) {
  const url = `https://api.notion.com/v1/pages/${pageId}`;
  const payload = {
    properties: {
      "状態": {
        select: { name: newStatus }
      }
    }
  };

  const options = {
    method: 'patch',
    contentType: 'application/json',
    headers: {
      "Authorization": `Bearer ${NOTION_API_KEY}`,
      "Notion-Version": NOTION_VERSION
    },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  };

  const resp = UrlFetchApp.fetch(url, options);
  const code = resp.getResponseCode();
  if (code < 200 || code >= 300) {
    throw new Error(`Notion update error: HTTP ${code} - ${resp.getContentText()}`);
  }
}

/*****************************************
 * LINE: Push メッセージを送る（定期通知用）
 *****************************************/
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
//     headers: { Authorization: 'Bearer ' + LINE_CHANNEL_ACCESS_TOKEN },
//     payload: JSON.stringify(payload),
//     muteHttpExceptions: true
//   };

//   const resp = UrlFetchApp.fetch(url, options);
//   Logger.log('LINE push response: ' + resp.getResponseCode() + ' / ' + resp.getContentText());
//   if (resp.getResponseCode() < 200 || resp.getResponseCode() >= 300) {
//     throw new Error('LINE push failed: ' + resp.getResponseCode());
//   }
// }

/*****************************************
 * LINE: replyToken を使って返信する（Webhook 用ヘルパー）
 *****************************************/
function replyLineMessage(replyToken, message) {
  if (!LINE_CHANNEL_ACCESS_TOKEN) {
    Logger.log('LINE_CHANNEL_ACCESS_TOKEN が未設定です。');
    return;
  }
  const url = 'https://api.line.me/v2/bot/message/reply';
  const payload = {
    replyToken: replyToken,
    messages: [{ type: 'text', text: message }]
  };
  const options = {
    method: 'post',
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + LINE_CHANNEL_ACCESS_TOKEN },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  };
  const resp = UrlFetchApp.fetch(url, options);
  Logger.log('LINE reply response: ' + resp.getResponseCode() + ' / ' + resp.getContentText());
}



/*****************************************
 * ユーティリティ
 *****************************************/
function extractTitle(titleProperty) {
  // Notion の title プロパティから文字列を抽出する安全な関数
  try {
    if (!titleProperty || !Array.isArray(titleProperty.title)) return null;
    if (titleProperty.title.length === 0) return null;
    // 複数の text がある場合は結合
    return titleProperty.title.map(t => (t && t.plain_text) ? t.plain_text : (t && t.text && t.text.content) ? t.text.content : '').join('');
  } catch (e) {
    Logger.log('extractTitle error: ' + e);
    return null;
  }
}


