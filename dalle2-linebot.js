// 環境変数
const LINE_ACCESS_TOKEN = '';
const OPENAI_APIKEY = '';
const SHEET_ID = '';
const SYSTEM_TEXT = '';
const WELCOME_MESSAGE = 'あなたの指示に従って、AIが画像を作ります。\nまずは、以下のメッセージを「タップ」してお試しください！\n10秒ほどで画像を生成します。';

// 以降は全環境で統一
const DALLE2_URL = 'https://api.openai.com/v1/images/generations';
const LINE_REPLY_URL = 'https://api.line.me/v2/bot/message/reply';
const QUESTION_NUM = 10;
const USAGE_LIMIT = 100;
const MAX_LENGTH_INPUT = 1000;
const sheet = SpreadsheetApp.openById(SHEET_ID);
const historySheet = sheet.getSheetByName("history");
const questionsSheet = sheet.getSheetByName("questions");
const logSheet = sheet.getSheetByName("log");
const errorLogSheet = sheet.getSheetByName("error_log");

function doPost(e) {
  try {
    Logger.log("doPost start");
    saveLog(Logger.getLog());
    // イベントを取得
    const event = getEvent(e);

    Logger.log('event.type: ' + event.type);
    // イベントが何であるか
    if (event.type !== 'message' && event.type !== 'follow') {
      // イベントがメッセージイベント以外の場合、処理終了
      Logger.log("event.type !== 'message'");
      saveLog(Logger.getLog());
      return;
    }

    // ユーザーIDを取得
    const userId = event.source.userId;
    Logger.log('userId: ' + userId);
    // リプライトークンを取得
    const replyToken = event.replyToken;
    Logger.log('replyToken: ' + replyToken);

    // イベントがフォローイベントの場合
    if (event.type === 'follow') {
      // あいさつメッセージを送信して処理終了
      Logger.log("event.type === 'follow'");
      replyMessage(replyToken, WELCOME_MESSAGE);
      saveLog(Logger.getLog());
      return;
    }

    // イベントがメッセージイベントの場合
    Logger.log('event.message.type: ' + event.message.type);
    if (event.message.type !== 'text') {
      // メッセージイベントのタイプがテキストメッセージ以外（動画やスタンプ）の場合
      // 以下のメッセージをユーザに返信し、処理終了
      replyMessage(replyToken, 'テキストメッセージを送信してください。');
      saveLog(Logger.getLog());
      return;
    }

    if (isOverUsageLimit(userId)) {
      // 利用制限回数の上限に達した場合、以下のメッセージをユーザに返信し、処理終了
      replyMessage(replyToken, 'いつもご利用いただきありがとうございます。\n本日の利用制限回数に到達しました🙇‍♂');
      Logger.log('利用制限超過');
      saveLog(Logger.getLog());
      return;
    }

    // メッセージイベントのタイプがテキストメッセージの場合
    // ユーザからのメッセージ取得
    let userMessage = event.message.text;
    Logger.log('userMessage: ' + userMessage);

    // メッセージを MAX_LENGTH_INPUT の値で切り捨て
    userMessage = userMessage.substring(0, MAX_LENGTH_INPUT);

    // 日本語から英語に翻訳
    const translatedMessage = LanguageApp.translate(userMessage, 'ja', 'en');
    Logger.log('translatedMessage: ' + translatedMessage);

    // DALL·E 2 APIを呼び出すためのリクエストを送信する
    const imageUrl = generateImage(translatedMessage);

    if (!imageUrl) {
      replyMessage(replyToken, '画像を生成できませんでした。しばらく待ってから再度お試しください。');
      return;
    }
    // 画像生成の履歴を保存
    saveHistory(userId, userMessage, imageUrl);

    // ユーザに画像を送信
    replyImage(replyToken, imageUrl);

    // ログを保存
    saveLog(Logger.getLog());

  } catch (error) {
    Logger.log(error);
    saveLog(Logger.getLog());
    saveErrorLog(Logger.getLog());
  }
}

// イベントを取得する処理
function getEvent(e) {
  // LINE Developers Messaging APIリファレンス
  // https://developers.line.biz/ja/reference/messaging-api/#webhook-event-objects
  return JSON.parse(e.postData.contents).events[0];
}

// DALL·E 2 APIを呼び出し、出力結果の画像のURLを取得する関数
function generateImage(text) {
  try {
    Logger.log("text:" + text);
    // リクエストを送信するためのオプションを設定する
    const options = {
      "method": "post",
      "headers": {
        "Content-Type": "application/json",
        "Authorization": "Bearer " + OPENAI_APIKEY
      },
      "payload": JSON.stringify({
        "prompt": text
      })
    };
    // リクエストを送信する
    Logger.log("call DALLE2 API");
    const response = UrlFetchApp.fetch(DALLE2_URL, options);
    Logger.log("called DALLE2 API");
    const data = JSON.parse(response.getContentText());

    // 画像のURLを取得する
    return data.data[0].url;
  } catch (error) {
    Logger.log(error);
    saveErrorLog(Logger.getLog());
    return undefined;
  }
}

function saveHistory(userId, userMessage, imageUrl) {
  const lastRow = historySheet.getLastRow();
  // 現在日時を取得
  const now = Utilities.formatDate(new Date(), "Asia/Tokyo", "yyyy/MM/dd HH:mm:ss");

  // スプレッドシートに最新の会話を出力
  historySheet.getRange(lastRow + 1, 1).setValue(userId);
  historySheet.getRange(lastRow + 1, 2).setValue(userMessage);
  historySheet.getRange(lastRow + 1, 3).setValue(imageUrl);
  historySheet.getRange(lastRow + 1, 4).setValue(now);
}

function replyMessage(replyToken, text) {
  // quickReplyの選択肢を取得
  const quickReplyOptions = getQuickReplyOptions();

  const payload = {
    'replyToken': replyToken,
    'messages': [{
      'type': 'text',
      'text': text
    }]
  };

  if (quickReplyOptions) {
    payload.messages[0].quickReply = quickReplyOptions;
  }

  UrlFetchApp.fetch(LINE_REPLY_URL, {
    'headers': {
      'Content-Type': 'application/json; charset=UTF-8',
      'Authorization': 'Bearer ' + LINE_ACCESS_TOKEN,
    },
    'method': 'post',
    'payload': JSON.stringify(payload)
  });
  return ContentService.createTextOutput(JSON.stringify({ 'content': 'post ok' })).setMimeType(ContentService.MimeType.JSON);
}

function replyImage(replyToken, imageUrl) {
  // quickReplyの選択肢を取得
  const quickReplyOptions = getQuickReplyOptions();

  const payload = {
    'replyToken': replyToken,
    'messages': [{
      'type': 'image',
      "originalContentUrl": imageUrl,
      "previewImageUrl": imageUrl
    }]
  };

  if (quickReplyOptions) {
    payload.messages[0].quickReply = quickReplyOptions;
  }

  UrlFetchApp.fetch(LINE_REPLY_URL, {
    'headers': {
      'Content-Type': 'application/json; charset=UTF-8',
      'Authorization': 'Bearer ' + LINE_ACCESS_TOKEN,
    },
    'method': 'post',
    'payload': JSON.stringify(payload)
  });
  return ContentService.createTextOutput(JSON.stringify({ 'content': 'post ok' })).setMimeType(ContentService.MimeType.JSON);
}

// 質問例を取得する
function getQuickReplyOptions() {
  // LINE Developers クイックリプライを使う
  // https://developers.line.biz/ja/docs/messaging-api/using-quick-reply/
  const dataRange = questionsSheet.getDataRange();
  let values = dataRange.getValues();

  values.shift(); // ヘッダーを配列から取り出す
  let items = []; // 質問例を格納する配列

  for (let i = 0; i < values.length; i++) {
    const row = values[i];
    if (row.join("") === "") {
      continue; // 空行の場合はスキップする
    }
    const obj = {
      type: "action",
      action: {
        type: "message",
        label: row[0].substr(0, 20), // label: 最大文字数：20
        text: row[1].substr(0, 300) // text: 最大文字数：300
      }
    };
    items.push(obj); // 空行でない場合はオブジェクトを作成して配列に追加する
  }

  if (items.length === 0) {
    return undefined; // ヘッダー以外の値がない場合はundefinedを返す
  }

  shuffle(items); // 質問例をシャッフルする
  items = items.slice(0, QUESTION_NUM); // 質問例の数を定数QUESTION_NUMで指定された数に制限する

  return {
    "items": items
  };
}

function shuffle(array) {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const temp = array[i];
    array[i] = array[j];
    array[j] = temp;
  }
}

function isOverUsageLimit(userId) {
  const data = historySheet.getDataRange().getValues();
  const now = new Date(); // 現在時刻を取得
  const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000); // 24時間前の時刻を計算
  const userRows = data.filter(function (row) {
    return row[0] === userId && new Date(row[3]) >= oneDayAgo; // 24時間以内のデータをフィルタリング
  });
  Logger.log('userRows.length: ' + userRows.length);
  Logger.log('USAGE_LIMIT: ' + USAGE_LIMIT);
  return userRows.length >= USAGE_LIMIT;
}

function saveLog(text) {
  const lastRow = logSheet.getLastRow();
  // スプレッドシートにログを出力
  logSheet.getRange(lastRow + 1, 1).setValue(text);
}

function saveErrorLog(text) {
  const lastRow = errorLogSheet.getLastRow();
  // スプレッドシートにログを出力
  errorLogSheet.getRange(lastRow + 1, 1).setValue(text);
}
