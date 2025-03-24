const TOKEN = ENV_BOT_TOKEN // Get it from @BotFather
const WEBHOOK = '/endpoint'
const SECRET = ENV_BOT_SECRET // A-Z, a-z, 0-9, _ and -
const ADMIN_UID = ENV_ADMIN_UID // your user id, get it from https://t.me/username_to_id_bot

const NOTIFY_INTERVAL = 3600 * 1000;
const fraudDb = 'https://raw.githubusercontent.com/dlavm/nfd/main/data/fraud.db';
const notificationUrl = 'https://raw.githubusercontent.com/dlavm/nfd/main/data/notification.txt'
const startMsgUrl = 'https://raw.githubusercontent.com/dlavm/nfd/main/data/startMessage.md';

const enable_notification = true
/**
 * Return url to telegram api, optionally with parameters added
 */
function apiUrl (methodName, params = null) {
  let query = ''
  if (params) {
    query = '?' + new URLSearchParams(params).toString()
  }
  return `https://api.telegram.org/bot${TOKEN}/${methodName}${query}`
}

function requestTelegram(methodName, body, params = null){
  return fetch(apiUrl(methodName, params), body)
    .then(r => r.json())
}

function makeReqBody(body){
  return {
    method:'POST',
    headers:{
      'content-type':'application/json'
    },
    body:JSON.stringify(body)
  }
}

function sendMessage(msg = {}){
  return requestTelegram('sendMessage', makeReqBody(msg))
}

function copyMessage(msg = {}){
  return requestTelegram('copyMessage', makeReqBody(msg))
}

function forwardMessage(msg){
  return requestTelegram('forwardMessage', makeReqBody(msg))
}

/**
 * Wait for requests to the worker
 */
addEventListener('fetch', event => {
  const url = new URL(event.request.url)
  if (url.pathname === WEBHOOK) {
    event.respondWith(handleWebhook(event))
  } else if (url.pathname === '/registerWebhook') {
    event.respondWith(registerWebhook(event, url, WEBHOOK, SECRET))
  } else if (url.pathname === '/unRegisterWebhook') {
    event.respondWith(unRegisterWebhook(event))
  } else {
    event.respondWith(new Response('No handler for this request'))
  }
})

/**
 * Handle requests to WEBHOOK
 * https://core.telegram.org/bots/api#update
 */
async function handleWebhook (event) {
  // Check secret
  if (event.request.headers.get('X-Telegram-Bot-Api-Secret-Token') !== SECRET) {
    return new Response('Unauthorized', { status: 403 })
  }

  // Read request body synchronously
  const update = await event.request.json()
  // Deal with response asynchronously
  event.waitUntil(onUpdate(update))

  return new Response('Ok')
}

/**
 * Handle incoming Update
 * https://core.telegram.org/bots/api#update
 */
async function onUpdate (update) {
  if ('message' in update) {
    await onMessage(update.message)
  }
}

/**
 * Handle incoming Message
 * https://core.telegram.org/bots/api#message
 */
async function onMessage (message) {
  if(message.text === '/start'){
    let startMsg = await fetch(startMsgUrl).then(r => r.text())
    return sendMessage({
      chat_id:message.chat.id,
      text:startMsg,
    })
  }
  if(message.chat.id.toString() === ADMIN_UID){
    if(!message?.reply_to_message?.chat){
      return sendMessage({
        chat_id:ADMIN_UID,
        text:'使用方法，回复转发的消息，并发送回复消息，或者`/block`、`/unblock`、`/checkblock`等指令'
      })
    }
    if(message.text && message.text.startsWith('/block')){
      return handleBlock(message)
    }
    if(message.text && message.text === '/unblock'){
      return handleUnBlock(message)
    }
    if(message.text && message.text === '/checkblock'){
      return checkBlock(message)
    }
    if(message.text && message.text.startsWith('/tag')){
      return handleTag(message)
    }
    if(message.text && message.text.startsWith('/untag')){
      return handleUnTag(message)
    }
    if(message.text && message.text === '/checktag'){
      return checkTag(message)
    }

    let guestChantId = await nfd.get('msg-map-' + message?.reply_to_message.message_id,
                                      { type: "json" })
    return copyMessage({
      chat_id: guestChantId,
      from_chat_id:message.chat.id,
      message_id:message.message_id,
    })
  }
  return handleGuestMessage(message)
}

async function handleGuestMessage(message){
  let chatId = message.chat.id;
  let isBlocked = await nfd.get('isblocked-' + chatId, { type: "json" })
  
  if(isBlocked){
    return sendMessage({
      chat_id: chatId,
      text: 'You are blocked'
    })
  }
  
  // 用户信息汇总
  let forwardText = `💬 来自: ${message.from.first_name}`;
  if (message.from.username) {
    forwardText += ` (@${message.from.username})`;
  }
  forwardText += `\n🆔 用户 ID: ${message.from.id}`;
  
  // 发送用户信息
  await sendMessage({
    chat_id: ADMIN_UID,
    text: forwardText,
    parse_mode: 'Markdown'
  });
  
  // 转发原始消息
  let forwardReq = await forwardMessage({
    chat_id: ADMIN_UID,
    from_chat_id: chatId,
    message_id: message.message_id
  });
  
  if(forwardReq.ok){
    await nfd.put('msg-map-' + forwardReq.result.message_id, chatId)
  }

  // 判断是否是标记用户，如果是，立即提醒管理员
  let tagData = await nfd.get('istagged-' + chatId, { type: "json" })
  if(tagData){
    try {
      let tagInfo = typeof tagData === 'string' ? JSON.parse(tagData) : tagData;
      let tagMessage = `🔖 已标记用户消息提醒:\nUID: ${chatId}`;
      if(tagInfo.reason) {
        tagMessage += `\n原因: ${tagInfo.reason}`;
      }
      await sendMessage({
        chat_id: ADMIN_UID,
        text: tagMessage
      });
    } catch(e) {
      console.error('解析标记信息出错', e);
    }
  }

  
  //return handleNotify(message)
}

async function handleNotify(message){
  // 先判断是否是诈骗人员，如果是，则直接提醒
  // 如果不是，则根据时间间隔提醒：用户id，交易注意点等
  let chatId = message.chat.id;
  if(await isFraud(chatId)){
    return sendMessage({
      chat_id: ADMIN_UID,
      text:`检测到骗子，UID${chatId}`
    })
  }
  if(enable_notification){
    let lastMsgTime = await nfd.get('lastmsg-' + chatId, { type: "json" })
    if(!lastMsgTime || Date.now() - lastMsgTime > NOTIFY_INTERVAL){
      await nfd.put('lastmsg-' + chatId, Date.now())
      return sendMessage({
        chat_id: ADMIN_UID,
        text:await fetch(notificationUrl).then(r => r.text())
      })
    }
  }
}

async function handleBlock(message){
  let guestChatId = await nfd.get('msg-map-' + message.reply_to_message.message_id, { type: "json" })
  if(guestChatId === ADMIN_UID){
    return sendMessage({
      chat_id: ADMIN_UID,
      text:'不能屏蔽自己'
    })
  }
  
  // 修复问题1：正确获取屏蔽原因
  let reason = message.text.substring(6).trim() || '无理由';
  await nfd.put('isblocked-' + guestChatId, JSON.stringify({ blocked: true, reason: reason }))
  
  return sendMessage({
    chat_id: ADMIN_UID,
    text: `UID:${guestChatId} 屏蔽成功\n原因: ${reason}`,
  })
}

async function handleUnBlock(message){
  let guestChantId = await nfd.get('msg-map-' + message.reply_to_message.message_id,
  { type: "json" })

  await nfd.put('isblocked-' + guestChantId, false)

  return sendMessage({
    chat_id: ADMIN_UID,
    text:`UID:${guestChantId}解除屏蔽成功`,
  })
}

async function checkBlock(message){
  let guestChatId = await nfd.get('msg-map-' + message.reply_to_message.message_id, { type: "json" })
  let blockData = await nfd.get('isblocked-' + guestChatId, { type: "json" })
  
  let responseText = `UID:${guestChatId} `;
  
  // 修复问题1：正确解析屏蔽信息
  if (blockData) {
    try {
      const blockInfo = typeof blockData === 'string' ? JSON.parse(blockData) : blockData;
      responseText += `已被屏蔽\n原因: ${blockInfo.reason || '无理由'}`;
    } catch (e) {
      responseText += '已被屏蔽，但无法获取详细信息';
    }
  } else {
    responseText += '未被屏蔽';
  }
  
  return sendMessage({
    chat_id: ADMIN_UID,
    text: responseText
  })
}

// 标记相关
// 标记用户：既可以在回复的情况下标记，也支持直接指定ID
async function handleTag(message) {
  let guestChatId = null;
  let reason = '';
  
  if (message.reply_to_message) {
    // 从回复的消息中获取用户ID映射
    guestChatId = await nfd.get('msg-map-' + message.reply_to_message.message_id, { type: "json" });
    reason = message.text.substring(4).trim() || '无理由'; // 去除命令部分（"/tag"）获取理由
  } else {
    // 支持直接指定用户ID，例如：/tag 12345 理由
    let tokens = message.text.split(' ');
    if(tokens.length >= 2){
      guestChatId = tokens[1];
      reason = tokens.slice(2).join(' ').trim() || '无理由';
    }
  }
  
  if (!guestChatId) {
    return sendMessage({
      chat_id: ADMIN_UID,
      text: '无法获取用户ID，请回复用户消息或者直接指定ID'
    });
  }
  
  await nfd.put('istagged-' + guestChatId, JSON.stringify({ tagged: true, reason: reason }));
  
  return sendMessage({
    chat_id: ADMIN_UID,
    text: `UID:${guestChatId} 标记成功\n原因: ${reason}`,
  });
}

// 解除标记
async function handleUnTag(message) {
  let guestChatId = null;
  
  if (message.reply_to_message) {
    guestChatId = await nfd.get('msg-map-' + message.reply_to_message.message_id, { type: "json" });
  } else {
    let tokens = message.text.split(' ');
    if(tokens.length >= 2){
      guestChatId = tokens[1];
    }
  }
  
  if (!guestChatId) {
    return sendMessage({
      chat_id: ADMIN_UID,
      text: '无法获取用户ID，请回复用户消息或者直接指定ID'
    });
  }
  
  await nfd.put('istagged-' + guestChatId, false);
  
  return sendMessage({
    chat_id: ADMIN_UID,
    text: `UID:${guestChatId} 解除标记成功`,
  });
}

// 查询标记状态
async function checkTag(message) {
  let guestChatId = null;
  
  if (message.reply_to_message) {
    guestChatId = await nfd.get('msg-map-' + message.reply_to_message.message_id, { type: "json" });
  } else {
    let tokens = message.text.split(' ');
    if(tokens.length >= 2){
      guestChatId = tokens[1];
    }
  }
  
  if (!guestChatId) {
    return sendMessage({
      chat_id: ADMIN_UID,
      text: '无法获取用户ID，请回复用户消息或者直接指定ID'
    });
  }
  
  let tagData = await nfd.get('istagged-' + guestChatId, { type: "json" });
  let responseText = `UID:${guestChatId} `;
  
  if (tagData) {
    try {
      const tagInfo = typeof tagData === 'string' ? JSON.parse(tagData) : tagData;
      responseText += `已被标记\n原因: ${tagInfo.reason || '无理由'}`;
    } catch(e) {
      responseText += '已被标记，但无法获取详细信息';
    }
  } else {
    responseText += '未被标记';
  }
  
  return sendMessage({
    chat_id: ADMIN_UID,
    text: responseText
  });
}



/**
 * Send plain text message
 * https://core.telegram.org/bots/api#sendmessage
 */
async function sendPlainText (chatId, text) {
  return sendMessage({
    chat_id: chatId,
    text
  })
}

/**
 * Set webhook to this worker's url
 * https://core.telegram.org/bots/api#setwebhook
 */
async function registerWebhook (event, requestUrl, suffix, secret) {
  // https://core.telegram.org/bots/api#setwebhook
  const webhookUrl = `${requestUrl.protocol}//${requestUrl.hostname}${suffix}`
  const r = await (await fetch(apiUrl('setWebhook', { url: webhookUrl, secret_token: secret }))).json()
  return new Response('ok' in r && r.ok ? 'Ok' : JSON.stringify(r, null, 2))
}

/**
 * Remove webhook
 * https://core.telegram.org/bots/api#setwebhook
 */
async function unRegisterWebhook (event) {
  const r = await (await fetch(apiUrl('setWebhook', { url: '' }))).json()
  return new Response('ok' in r && r.ok ? 'Ok' : JSON.stringify(r, null, 2))
}

async function isFraud(id){
  id = id.toString()
  let db = await fetch(fraudDb).then(r => r.text())
  let arr = db.split('\n').filter(v => v)
  console.log(JSON.stringify(arr))
  let flag = arr.filter(v => v === id).length !== 0
  console.log(flag)
  return flag
}
