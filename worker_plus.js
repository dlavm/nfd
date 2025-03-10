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
    // 处理查看屏蔽列表的命令
    if(message.text && message.text === '/blocklist'){
      return listBlocked(message)
    }
    
    // 处理不需要回复消息的 block/unblock 命令
    if(message.text && message.text.startsWith('/block ')){
      const parts = message.text.split(' ')
      if(parts.length >= 2 && /^\d+$/.test(parts[1])){
        return handleBlockById(message, parts[1], parts.slice(2).join(' '))
      }
    }
    
    if(message.text && message.text.startsWith('/unblock ')){
      const parts = message.text.split(' ')
      if(parts.length >= 2 && /^\d+$/.test(parts[1])){
        return handleUnBlockById(message, parts[1])
      }
    }
    
    // 处理需要回复消息的命令
    if(message?.reply_to_message?.chat){
      if(message.text && message.text.startsWith('/block')){
        return handleBlock(message)
      }
      if(message.text && message.text === '/unblock'){
        return handleUnBlock(message)
      }
      if(message.text && message.text === '/checkblock'){
        return checkBlock(message)
      }
      
      let guestChantId = await nfd.get('msg-map-' + message?.reply_to_message.message_id,
                                        { type: "json" })
      return copyMessage({
        chat_id: guestChantId,
        from_chat_id:message.chat.id,
        message_id:message.message_id,
      })
    }
    
    return sendMessage({
      chat_id:ADMIN_UID,
      text:'使用方法：\n'
          + '1. 回复转发的消息，并发送回复消息\n'
          + '2. `/block [原因]` - 屏蔽用户（回复消息时）\n'
          + '3. `/unblock` - 解除屏蔽（回复消息时）\n'
          + '4. `/checkblock` - 检查屏蔽状态（回复消息时）\n'
          + '5. `/block 用户ID [原因]` - 直接屏蔽指定用户ID\n'
          + '6. `/unblock 用户ID` - 直接解除指定用户ID的屏蔽\n'
          + '7. `/blocklist` - 查看所有已屏蔽的用户'
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
  
  return handleNotify(message)
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
  await nfd.put('isblocked-' + guestChatId, JSON.stringify({ 
    blocked: true, 
    reason: reason,
    timestamp: Date.now()
  }))
  
  return sendMessage({
    chat_id: ADMIN_UID,
    text: `UID:${guestChatId} 屏蔽成功\n原因: ${reason}`,
  })
}

// 新增：直接通过ID屏蔽用户
async function handleBlockById(message, userId, reason = '无理由'){
  if(userId === ADMIN_UID){
    return sendMessage({
      chat_id: ADMIN_UID,
      text:'不能屏蔽自己'
    })
  }
  
  await nfd.put('isblocked-' + userId, JSON.stringify({ 
    blocked: true, 
    reason: reason,
    timestamp: Date.now()
  }))
  
  return sendMessage({
    chat_id: ADMIN_UID,
    text: `UID:${userId} 屏蔽成功\n原因: ${reason}`,
  })
}

async function handleUnBlock(message){
  let guestChantId = await nfd.get('msg-map-' + message.reply_to_message.message_id,
  { type: "json" })

  await nfd.put('isblocked-' + guestChantId, false)

  return sendMessage({
    chat_id: ADMIN_UID,
    text:`UID:${guestChantId} 解除屏蔽成功`,
  })
}

// 新增：直接通过ID解除屏蔽用户
async function handleUnBlockById(message, userId){
  await nfd.put('isblocked-' + userId, false)

  return sendMessage({
    chat_id: ADMIN_UID,
    text:`UID:${userId} 解除屏蔽成功`,
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
      if (blockInfo.timestamp) {
        const blockDate = new Date(blockInfo.timestamp);
        responseText += `\n屏蔽时间: ${blockDate.toLocaleString()}`;
      }
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

// 新增：列出所有被屏蔽的用户
async function listBlocked(message) {
  // 获取所有以"isblocked-"开头的键
  // 由于 nfd 可能没有提供列出所有键的方法，这里实现可能需要根据实际情况调整
  // 在实际环境中，可能需要维护一个单独的"已屏蔽用户列表"
  
  // 这里假设有一个存储所有被屏蔽用户ID的列表
  const blockedListKey = 'blocked-users-list';
  let blockedList = await nfd.get(blockedListKey, { type: "json" }) || [];
  
  if (blockedList.length === 0) {
    return sendMessage({
      chat_id: ADMIN_UID,
      text: '当前没有被屏蔽的用户'
    });
  }
  
  let responseText = '已屏蔽用户列表：\n\n';
  
  // 获取每个被屏蔽用户的详细信息
  const promises = blockedList.map(async (userId) => {
    const blockData = await nfd.get('isblocked-' + userId, { type: "json" });
    if (!blockData) return null;
    
    try {
      const blockInfo = typeof blockData === 'string' ? JSON.parse(blockData) : blockData;
      if (!blockInfo.blocked) return null;
      
      let userInfo = `UID: ${userId}\n原因: ${blockInfo.reason || '无理由'}`;
      if (blockInfo.timestamp) {
        const blockDate = new Date(blockInfo.timestamp);
        userInfo += `\n屏蔽时间: ${blockDate.toLocaleString()}`;
      }
      return userInfo;
    } catch (e) {
      return `UID: ${userId}\n无法获取详细信息`;
    }
  });
  
  const userInfos = await Promise.all(promises);
  const validUserInfos = userInfos.filter(info => info !== null);
  
  if (validUserInfos.length === 0) {
    return sendMessage({
      chat_id: ADMIN_UID,
      text: '当前没有有效的被屏蔽用户'
    });
  }
  
  responseText += validUserInfos.join('\n\n');
  
  return sendMessage({
    chat_id: ADMIN_UID,
    text: responseText
  });
}

// 辅助函数：将用户ID添加到被屏蔽列表
async function addToBlockedList(userId) {
  const blockedListKey = 'blocked-users-list';
  let blockedList = await nfd.get(blockedListKey, { type: "json" }) || [];
  
  if (!blockedList.includes(userId)) {
    blockedList.push(userId);
    await nfd.put(blockedListKey, JSON.stringify(blockedList));
  }
}

// 辅助函数：从被屏蔽列表中移除用户ID
async function removeFromBlockedList(userId) {
  const blockedListKey = 'blocked-users-list';
  let blockedList = await nfd.get(blockedListKey, { type: "json" }) || [];
  
  const newList = blockedList.filter(id => id !== userId);
  await nfd.put(blockedListKey, JSON.stringify(newList));
}

// 修改原有的 handleBlock 和 handleBlockById 函数，添加维护屏蔽列表的代码
const originalHandleBlock = handleBlock;
handleBlock = async function(message) {
  const result = await originalHandleBlock(message);
  let guestChatId = await nfd.get('msg-map-' + message.reply_to_message.message_id, { type: "json" });
  await addToBlockedList(guestChatId);
  return result;
};

const originalHandleBlockById = handleBlockById;
handleBlockById = async function(message, userId, reason) {
  const result = await originalHandleBlockById(message, userId, reason);
  await addToBlockedList(userId);
  return result;
};

// 修改原有的 handleUnBlock 和 handleUnBlockById 函数，添加维护屏蔽列表的代码
const originalHandleUnBlock = handleUnBlock;
handleUnBlock = async function(message) {
  const result = await originalHandleUnBlock(message);
  let guestChatId = await nfd.get('msg-map-' + message.reply_to_message.message_id, { type: "json" });
  await removeFromBlockedList(guestChatId);
  return result;
};

const originalHandleUnBlockById = handleUnBlockById;
handleUnBlockById = async function(message, userId) {
  const result = await originalHandleUnBlockById(message, userId);
  await removeFromBlockedList(userId);
  return result;
};

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
