function sendLineMessage(text) {
  if (!LINE_CHANNEL_ACCESS_TOKEN || !LINE_TO) {
    Logger.log('LINE_CHANNEL_ACCESS_TOKEN または LINE_TO が未設定です。');
    return;
  }

  const url = 'https://api.line.me/v2/bot/message/push';
  const payload = {
    to: LINE_TO,
    messages: [{ type: 'text', text: text }]
  };
  const options = {
    method: 'post',
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + LINE_CHANNEL_ACCESS_TOKEN },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  };

  try {
    const resp = UrlFetchApp.fetch(url, options);
    const code = resp.getResponseCode();
    const body = resp.getContentText();
    Logger.log('LINE push response: ' + code + ' / ' + body);

    if (code < 200 || code >= 300) {
      // 詳細を含めたエラーとして再スロー
      throw new Error('LINE push failed: HTTP ' + code + ' - ' + body);
    }
  } catch (err) {
    // ログに残す。トークン等の機密はログに出さないよう注意
    Logger.log('sendLineMessage error: ' + err);
    // 呼び出し元で対処できるように例外を再スロー
    throw err;
  }
}
