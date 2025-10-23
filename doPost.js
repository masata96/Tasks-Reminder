// ------------------ デバッグログ（Spreadsheetへ） ------------------
function debugLogToSheet(valuesArray) {
  try {
    const sid = getProp('DEBUG_SHEET_ID');
    if (!sid) {
      Logger.log('debugLogToSheet: DEBUG_SHEET_ID not set');
      return;
    }
    const ss = SpreadsheetApp.openById(sid);
    const sh = ss.getSheets()[0];
    sh.appendRow(valuesArray);
  } catch (e) {
    Logger.log('debugLogToSheet error: ' + e);
  }
}

// ------------------ Notion: 未完タスク取得（ページネーション対応） ------------------
function queryIncompleteTasksFromNotion() {
  const NOTION_API_KEY = getProp('NOTION_API_KEY');
  const DATABASE_ID = getProp('DATABASE_ID');
  const NOTION_VERSION = getProp('NOTION_VERSION') || '2022-06-28';
  if (!NOTION_API_KEY || !DATABASE_ID) throw new Error('NOTION_API_KEY or DATABASE_ID not set');

  const url = `https://api.notion.com/v1/databases/${DATABASE_ID}/query`;
  const basePayload = {
    filter: {
      and: [
        { property: "チェック", checkbox: { equals: false } }
      ]
    },
    page_size: 100
  };
  const headers = {
    "Authorization": `Bearer ${NOTION_API_KEY}`,
    "Notion-Version": NOTION_VERSION,
    "Content-Type": "application/json"
  };

  let startCursor = null;
  let results = [];
  do {
    const body = Object.assign({}, basePayload);
    if (startCursor) body.start_cursor = startCursor;
    const options = { method: 'post', contentType: 'application/json', headers: headers, payload: JSON.stringify(body), muteHttpExceptions: true };
    const resp = UrlFetchApp.fetch(url, options);
    const code = resp.getResponseCode();
    const text = resp.getContentText();
    if (code < 200 || code >= 300) throw new Error('Notion query error: ' + code + ' / ' + text);
    const json = JSON.parse(text);
    if (json.results && json.results.length) results = results.concat(json.results);
    startCursor = json.has_more ? json.next_cursor : null;
  } while (startCursor);
  return results;
}

// ------------------ 日付パースと「今日判定」ユーティリティ ------------------
function parseNotionDateToLocalDateStr(dateStartStr, tz) {
  // return yyyy-MM-dd string in timezone tz
  if (!dateStartStr) return null;
  tz = tz || Session.getScriptTimeZone();
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateStartStr)) {
    return dateStartStr;
  } else {
    const d = new Date(dateStartStr);
    if (isNaN(d.getTime())) return null;
    return Utilities.formatDate(d, tz, 'yyyy-MM-dd');
  }
}

function getTodayStr(tz) {
  tz = tz || Session.getScriptTimeZone();
  return Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd');
}

// ------------------ タイトル抽出ユーティリティ ------------------
function extractTitle(titleProp) {
  try {
    if (!titleProp) return null;
    // Notion v2 title property shape
    if (Array.isArray(titleProp.title)) {
      if (titleProp.title.length === 0) return null;
      return titleProp.title.map(t => (t && t.plain_text) ? t.plain_text : (t && t.text && t.text.content) ? t.text.content : '').join('');
    }
    // fallback for other shapes
    if (Array.isArray(titleProp)) {
      return titleProp.map(t => (t && t.plain_text) ? t.plain_text : (t && t.text && t.text.content) ? t.text.content : '').join('');
    }
    return null;
  } catch (e) {
    Logger.log('extractTitle error: ' + e);
    return null;
  }
}

// ------------------ Flex 作成 & 送信 ------------------
function buildTaskBubble(task) {
  // task: { pageId, name, date, category, url? }
  return {
    type: "bubble",
    body: {
      type: "box",
      layout: "vertical",
      contents: [
        { type: "text", text: task.name || "（タイトルなし）", weight: "bold", size: "md", wrap: true },
        { type: "text", text: "期限: " + (task.date || "未設定"), size: "sm", color: "#666666", wrap: true },
        { type: "text", text: "カテゴリ: " + (task.category || "未分類"), size: "sm", color: "#888888", wrap: true }
      ]
    },
    footer: {
      type: "box",
      layout: "horizontal",
      contents: [
        {
          type: "button",
          style: "primary",
          action: {
            type: "postback",
            label: "完了",
            data: `action=complete&pageId=${task.pageId}`,
            displayText: `「${task.name}」は処理済みです`
          }
        },
        task.url ? {
          type: "button",
          style: "secondary",
          action: { type: "uri", label: "詳細", uri: task.url }
        } : { type: "spacer" }
      ]
    }
  };
}

function sendTodayTasksFlex(lineUserId) {
  try {
    const tz = Session.getScriptTimeZone();
    const todayStr = getTodayStr(tz);
    const pages = queryIncompleteTasksFromNotion();
    const todayTasks = [];

    pages.forEach(p => {
      try {
        const props = p.properties || {};
        const dateProp = props['日付'];
        if (!dateProp || !dateProp.date || !dateProp.date.start) return;
        const taskDateStr = parseNotionDateToLocalDateStr(dateProp.date.start, tz);
        if (taskDateStr !== todayStr) return; // 今日のみ
        const title = extractTitle(props['タスク名']) || '（タイトルなし）';
        const cat = (props['カテゴリー'] && props['カテゴリー'].select) ? props['カテゴリー'].select.name : '未分類';
        // try to get page url if exists (Notion might provide it)
        const url = p.url || null;
        todayTasks.push({ pageId: p.id, name: title, date: taskDateStr, category: cat, url: url });
      } catch (errInner) {
        Logger.log('processing page error: ' + errInner);
      }
    });

    if (todayTasks.length === 0) {
      pushLineMessage(lineUserId, "🌅 おはようございます！本日のタスクはありません。");
      return;
    }

    // chunk into carousels of size <=10
    const chunks = [];
    for (let i=0;i<todayTasks.length;i+=10) chunks.push(todayTasks.slice(i, i+10));

    chunks.forEach(chunk => {
      const bubbles = chunk.map(buildTaskBubble);
      const flex = {
        type: "flex",
        altText: "本日のタスク",
        contents: { type: "carousel", contents: bubbles }
      };
      pushFlex(lineUserId, flex);
    });

  } catch (e) {
    Logger.log('sendTodayTasksFlex error: ' + e);
    debugLogToSheet([new Date().toISOString(), 'ERROR', 'sendTodayTasksFlex', String(e)]);
  }
}

function pushFlex(to, flexObject) {
  const token = getProp('LINE_CHANNEL_ACCESS_TOKEN');
  if (!token) throw new Error('LINE_CHANNEL_ACCESS_TOKEN not set');
  const url = 'https://api.line.me/v2/bot/message/push';
  const payload = { to: to, messages: [flexObject] };
  const options = {
    method: 'post',
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + token },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  };
  const resp = UrlFetchApp.fetch(url, options);
  debugLogToSheet([new Date().toISOString(), 'PUSH_FLEX', resp.getResponseCode(), resp.getContentText(), to]);
  if (resp.getResponseCode() < 200 || resp.getResponseCode() >= 300) {
    throw new Error('Line push failed: ' + resp.getResponseCode() + ' / ' + resp.getContentText());
  }
}

// ------------------ Notion: タスク完了処理 ------------------
function markTaskComplete(pageId, lineUserId) {
  const NOTION_API_KEY = getProp('NOTION_API_KEY');
  const NOTION_VERSION = getProp('NOTION_VERSION') || '2022-06-28';
  if (!NOTION_API_KEY) throw new Error('NOTION_API_KEY not set');

  const url = `https://api.notion.com/v1/pages/${pageId}`;
  const payload = {
    properties: {
      "チェック": { checkbox: true },
      // 状態プロパティを使う場合は環境に合わせて編集
      // "状態": { select: { name: "完了" } }
    }
  };
  const options = {
    method: 'patch',
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + NOTION_API_KEY, 'Notion-Version': NOTION_VERSION },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  };
  const resp = UrlFetchApp.fetch(url, options);
  const code = resp.getResponseCode();
  const body = resp.getContentText();
  debugLogToSheet([new Date().toISOString(), 'NOTION_UPDATE', code, body, pageId, lineUserId]);
  if (code < 200 || code >= 300) throw new Error('Notion update failed: ' + code + ' / ' + body);
  return true;
}

// ------------------ LINE: push and reply helpers ------------------
function pushLineMessage(to, message) {
  const token = getProp('LINE_CHANNEL_ACCESS_TOKEN');
  if (!token) throw new Error('LINE_CHANNEL_ACCESS_TOKEN not set');
  const url = 'https://api.line.me/v2/bot/message/push';
  const payload = { to: to, messages: [{ type: 'text', text: message }] };
  const options = {
    method: 'post',
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + token },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  };
  const resp = UrlFetchApp.fetch(url, options);
  debugLogToSheet([new Date().toISOString(), 'PUSH', resp.getResponseCode(), resp.getContentText(), to]);
  if (resp.getResponseCode() < 200 || resp.getResponseCode() >= 300) throw new Error('Line push failed: ' + resp.getResponseCode());
}

function safeReply(replyToken, message) {
  try {
    const token = getProp('LINE_CHANNEL_ACCESS_TOKEN');
    if (!token) return { error: true, message: 'no token' };
    const url = 'https://api.line.me/v2/bot/message/reply';
    const payload = { replyToken: replyToken, messages: [{ type: 'text', text: message }] };
    const options = {
      method: 'post',
      contentType: 'application/json',
      headers: { Authorization: 'Bearer ' + token },
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    };
    const resp = UrlFetchApp.fetch(url, options);
    const code = resp.getResponseCode();
    const body = resp.getContentText();
    debugLogToSheet([new Date().toISOString(), 'SAFE_REPLY', code, body]);
    if (code >= 200 && code < 300) return { ok: true };
    return { error: true, httpCode: code, body: body };
  } catch (e) {
    debugLogToSheet([new Date().toISOString(), 'SAFE_REPLY_EXCEPTION', String(e)]);
    return { error: true, exception: String(e) };
  }
}

// ------------------ 署名検証（GAS内） ------------------
function getHeaderCaseInsensitive(e, headerName) {
  try {
    if (e && e.postData && e.postData.headers) {
      for (var k in e.postData.headers) if (k.toLowerCase() === headerName.toLowerCase()) return e.postData.headers[k];
    }
    if (e && e.headers) {
      for (var k2 in e.headers) if (k2.toLowerCase() === headerName.toLowerCase()) return e.headers[k2];
    }
  } catch (err) {}
  return null;
}

function verifyLineSignatureGAS(e) {
  try {
    const sigVerify = (getProp('SIG_VERIFY') || 'true').toLowerCase() === 'true';
    const raw = e && e.postData && e.postData.contents ? e.postData.contents : null;
    if (!raw) {
      debugLogToSheet([new Date().toISOString(), 'ERROR', 'no raw body for signature verify']);
      return false;
    }
    const signature = getHeaderCaseInsensitive(e, 'X-Line-Signature') || getHeaderCaseInsensitive(e, 'x-line-signature');
    if (!signature) {
      debugLogToSheet([new Date().toISOString(), 'WARN', 'signature header not found']);
      return sigVerify ? false : true; // dev: allow if sigVerify false
    }
    if (!sigVerify) {
      debugLogToSheet([new Date().toISOString(), 'INFO', 'SIG_VERIFY disabled, skipping signature check']);
      return true;
    }
    const secret = getProp('LINE_CHANNEL_SECRET');
    if (!secret) {
      debugLogToSheet([new Date().toISOString(), 'ERROR', 'LINE_CHANNEL_SECRET not set']);
      return false;
    }
    const rawHash = Utilities.computeHmacSha256Signature(raw, secret);
    const computed = Utilities.base64Encode(rawHash);
    const ok = computed === signature;
    debugLogToSheet([new Date().toISOString(), 'SIG_VERIFY', ok, computed, signature ? '(signature present)' : '(no signature)']);
    return ok;
  } catch (e) {
    debugLogToSheet([new Date().toISOString(), 'SIG_VERIFY_EXCEPTION', String(e)]);
    return false;
  }
}

// ------------------ doPost: Webhook受信（署名検証 + postbackハンドル） ------------------
function doPost(e) {
  // early log
  try {
    const raw = e && e.postData && e.postData.contents ? e.postData.contents : '(no-body)';
    const hdrs = e && e.postData && e.postData.headers ? e.postData.headers : (e && e.headers ? e.headers : {});
    debugLogToSheet([new Date().toISOString(), 'INCOMING', JSON.stringify(hdrs), raw]);
  } catch (err) {
    Logger.log('doPost early log failed: ' + err);
  }

  // verify signature
  if (!verifyLineSignatureGAS(e)) {
    debugLogToSheet([new Date().toISOString(), 'ERROR', 'Invalid signature (or missing)']);
    return ContentService.createTextOutput('invalid signature').setMimeType(ContentService.MimeType.TEXT);
  }

  // parse body
  let body;
  try {
    body = JSON.parse(e.postData.contents);
  } catch (err) {
    debugLogToSheet([new Date().toISOString(), 'ERROR', 'JSON parse failed', String(err)]);
    return ContentService.createTextOutput('bad json').setMimeType(ContentService.MimeType.TEXT);
  }

  if (!body.events || !Array.isArray(body.events)) {
    debugLogToSheet([new Date().toISOString(), 'INFO', 'no events']);
    return ContentService.createTextOutput('no events').setMimeType(ContentService.MimeType.TEXT);
  }

  // handle events
  body.events.forEach(ev => {
    try {
      debugLogToSheet([new Date().toISOString(), 'EVENT', JSON.stringify(ev)]);
      // postback handler
      if (ev.type === 'postback' && ev.postback && ev.postback.data) {
        const data = ev.postback.data; // "action=complete&pageId=..."
        const params = parseQueryString(data);
        if (params.action === 'complete' && params.pageId) {
          try {
            markTaskComplete(params.pageId, ev.source && ev.source.userId);
            // reply to user
            safeReply(ev.replyToken, '✅ タスクを完了にしました');
          } catch (err) {
            debugLogToSheet([new Date().toISOString(), 'ERROR', 'markTaskComplete failed', String(err)]);
            safeReply(ev.replyToken, '❌ タスク完了に失敗しました。後で再試行してください。');
          }
        } else {
          safeReply(ev.replyToken, 'Unknown action');
        }
      } else if (ev.type === 'message' && ev.message && ev.message.type === 'text') {
        // optional: support quick commands, e.g., "tasks" to trigger push
        const text = ev.message.text && ev.message.text.trim().toLowerCase();
        if (text === 'tasks' || text === '今日のタスク') {
          // send today's tasks to the user who requested
          sendTodayTasksFlex(ev.source && ev.source.userId);
          safeReply(ev.replyToken, '本日のタスクは以上です');
        } else {
          // echo or helper
          // safeReply(ev.replyToken, '受け取りました。' );
        }
      }
    } catch (evErr) {
      debugLogToSheet([new Date().toISOString(), 'EVENT_PROCESS_ERR', String(evErr)]);
    }
  });

  return ContentService.createTextOutput('ok').setMimeType(ContentService.MimeType.TEXT);
}

// ------------------ チャート：簡易クエリパーサ ------------------
function parseQueryString(q) {
  const obj = {};
  if (!q) return obj;
  q.split('&').forEach(kv => {
    const i = kv.indexOf('=');
    if (i < 0) { obj[decodeURIComponent(kv)] = ''; return; }
    const k = decodeURIComponent(kv.slice(0, i));
    const v = decodeURIComponent(kv.slice(i+1));
    obj[k] = v;
  });
  return obj;
}

/* End of file */
