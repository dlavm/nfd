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
    // 管理员命令区

    // 查看屏蔽列表命令
    if(message.text && message.text === '/blocklist'){
      return listBlocked(message)
    }
    
    if(message.text && message.text === '/taglist'){
      return listTagged(message)
    }

    // 直接通过ID屏蔽/解除屏蔽命令
    if(message.text && message.text.startsWith('/block ')){
      const parts = message.text.split(' ')
      if(parts.length >= 2 && /^\d+$/.test(parts[1])){
        return handleBlockById(message, parts[1], parts.slice(2).join(' ') || '无理由')
      }
    }
    
    if(message.text && message.text.startsWith('/unblock ')){
      const parts = message.text.split(' ')
      if(parts.length >= 2 && /^\d+$/.test(parts[1])){
        return handleUnBlockById(message, parts[1])
      }
    }
    
    // 直接通过ID标记/解除标记命令
    if(message.text && message.text.startsWith('/tag ')){
      const parts = message.text.split(' ')
      if(parts.length >= 2 && /^\d+$/.test(parts[1])){
        return handleTagById(message, parts[1], parts.slice(2).join(' ') || '无理由')
      }
    }
    
    if(message.text && message.text.startsWith('/untag ')){
      const parts = message.text.split(' ')
      if(parts.length >= 2 && /^\d+$/.test(parts[1])){
        return handleUnTagById(message, parts[1])
      }
    }
    
    // 回复消息的命令
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
      
      if(message.text && message.text.startsWith('/tag')){
        return handleTag(message)
      }
      if(message.text && message.text === '/untag'){
        return handleUnTag(message)
      }
      if(message.text && message.text === '/checktag'){
        return checkTag(message)
      }
      
      let guestChantId = await nfd.get('msg-map-' + message.reply_to_message.message_id,
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
      + '7. `/blocklist` - 查看所有已屏蔽的用户\n'
      + '8. `/tag [原因]` - 标记用户（回复消息时）\n'
      + '9. `/untag` - 解除标记（回复消息时）\n'
      + '10. `/checktag` - 检查标记状态（回复消息时）\n'
      + '11. `/tag 用户ID [原因]` - 直接标记指定用户ID\n'
      + '12. `/untag 用户ID` - 直接解除指定用户ID的标记\n'
      + '13. `/taglist` - 查看所有已标记的用户'
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
  let forwardText = `🙎‍♂️ 用户姓名: ${message.from.first_name}`;
  if (message.from.username) {
    forwardText += ` (@${message.from.username})`;
  }
  forwardText += `\n🆔 用户标识: ${message.from.id}`;
  
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
  
  // 如果用户已被标记，则提醒管理员
  let tagData = await nfd.get('istagged-' + chatId, { type: "json" });
  if(tagData){
    try{
      let tagInfo = typeof tagData === 'string' ? JSON.parse(tagData) : tagData;
      if(tagInfo.tagged){
         let tagMsg = `🔖 标记用户消息提醒:\nUID: ${chatId}`;
         if(tagInfo.reason) tagMsg += `\n原因: ${tagInfo.reason}`;
         await sendMessage({
            chat_id: ADMIN_UID,
            text: tagMsg
         });
      }
    } catch(e){
      console.error('解析标记信息失败', e);
    }
  }
  
  // 如有需要，可继续调用其他提醒逻辑
  // return handleNotify(message)
}

async function handleBlock(message){
  let guestChatId = await nfd.get('msg-map-' + message.reply_to_message.message_id, { type: "json" })
  if(guestChatId === ADMIN_UID){
    return sendMessage({
      chat_id: ADMIN_UID,
      text:'不能屏蔽自己'
    })
  }
  
  // 正确获取屏蔽原因
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

// 直接通过ID屏蔽用户
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
  let guestChatId = await nfd.get('msg-map-' + message.reply_to_message.message_id,
  { type: "json" })

  await nfd.put('isblocked-' + guestChatId, false)

  return sendMessage({
    chat_id: ADMIN_UID,
    text:`UID:${guestChatId} 解除屏蔽成功`,
  })
}

// 直接通过ID解除屏蔽用户
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

// ===== 新增标记功能 =====

// 回复方式标记用户
async function handleTag(message) {
  let guestChatId = await nfd.get('msg-map-' + message.reply_to_message.message_id, { type: "json" });
  let reason = message.text.substring(4).trim() || '无理由'; // 去掉"/tag"命令部分
  if (!guestChatId) {
    return sendMessage({
      chat_id: ADMIN_UID,
      text: '无法获取用户ID，请回复用户消息或者直接指定ID'
    });
  }
  else{
    await addToTaggedList(guestChatId);
  }
  await nfd.put('istagged-' + guestChatId, JSON.stringify({ tagged: true, reason: reason, timestamp: Date.now() }));
  return sendMessage({
    chat_id: ADMIN_UID,
    text: `UID:${guestChatId} 标记成功\n原因: ${reason}`
  });
}

// 直接通过ID标记用户
async function handleTagById(message, userId, reason = '无理由') {
  if(userId === ADMIN_UID){
    return sendMessage({
      chat_id: ADMIN_UID,
      text:'不能标记自己'
    })
  }
  await addToTaggedList(userId);
  await nfd.put('istagged-' + userId, JSON.stringify({ tagged: true, reason: reason, timestamp: Date.now() }));
  return sendMessage({
    chat_id: ADMIN_UID,
    text: `UID:${userId} 标记成功\n原因: ${reason}`
  });
}

// 回复方式解除标记
async function handleUnTag(message) {
  let guestChatId = await nfd.get('msg-map-' + message.reply_to_message.message_id, { type: "json" });
  if (!guestChatId) {
    return sendMessage({
      chat_id: ADMIN_UID,
      text: '无法获取用户ID，请回复用户消息或者直接指定ID'
    });
  }else{
    await removeFromTaggedList(guestChatId);
  }
  await nfd.put('istagged-' + guestChatId, false);
  return sendMessage({
    chat_id: ADMIN_UID,
    text: `UID:${guestChatId} 解除标记成功`
  });
}

// 直接通过ID解除标记
async function handleUnTagById(message, userId) {
  await nfd.put('istagged-' + userId, false);
  await removeFromTaggedList(userId);
  return sendMessage({
    chat_id: ADMIN_UID,
    text: `UID:${userId} 解除标记成功`
  });
}

// 检查标记状态
async function checkTag(message) {
  let guestChatId = await nfd.get('msg-map-' + message.reply_to_message.message_id, { type: "json" });
  if (!guestChatId) {
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
      if(tagInfo.tagged){
        responseText += `已被标记\n原因: ${tagInfo.reason || '无理由'}`;
        if (tagInfo.timestamp) {
          const tagDate = new Date(tagInfo.timestamp);
          responseText += `\n标记时间: ${tagDate.toLocaleString()}`;
        }
      } else {
        responseText += '未被标记';
      }
    } catch(e) {
      responseText += '标记信息解析错误';
    }
  } else {
    responseText += '未被标记';
  }
  
  return sendMessage({
    chat_id: ADMIN_UID,
    text: responseText
  });
}

// ===== 结束新增标记功能 =====

// 新增：列出所有被屏蔽的用户
async function listBlocked(message) {
  // 获取所有以"isblocked-"开头的键
  // 此处假设维护了一个单独的"blocked-users-list"
  const blockedListKey = 'blocked-users-list';
  let blockedList = await nfd.get(blockedListKey, { type: "json" }) || [];
  
  if (blockedList.length === 0) {
    return sendMessage({
      chat_id: ADMIN_UID,
      text: '当前没有被屏蔽的用户'
    });
  }
  
  let responseText = '已屏蔽用户列表：\n\n';
  
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

// 新增：列出所有被标记的用户
async function listTagged(message) {
  // 获取所有标记用户列表
  const taggedListKey = 'tagged-users-list';
  let taggedList = await nfd.get(taggedListKey, { type: "json" }) || [];
  
  if (taggedList.length === 0) {
    return sendMessage({
      chat_id: ADMIN_UID,
      text: '当前没有被标记的用户'
    });
  }
  
  let responseText = '已标记用户列表：\n\n';
  
  const promises = taggedList.map(async (userId) => {
    const tagData = await nfd.get('istagged-' + userId, { type: "json" });
    if (!tagData) return null;
    
    try {
      const tagInfo = typeof tagData === 'string' ? JSON.parse(tagData) : tagData;
      if (!tagInfo.tagged) return null;
      
      let userInfo = `UID: ${userId}\n原因: ${tagInfo.reason || '无理由'}`;
      if (tagInfo.timestamp) {
        const tagDate = new Date(tagInfo.timestamp);
        userInfo += `\n标记时间: ${tagDate.toLocaleString()}`;
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
      text: '当前没有有效的被标记用户'
    });
  }
  
  responseText += validUserInfos.join('\n\n');
  
  return sendMessage({
    chat_id: ADMIN_UID,
    text: responseText
  });
}

// 辅助函数：将用户ID添加到标记列表
async function addToTaggedList(userId) {
  const taggedListKey = 'tagged-users-list';
  let taggedList = await nfd.get(taggedListKey, { type: "json" }) || [];
  
  if (!taggedList.includes(userId)) {
    taggedList.push(userId);
    await nfd.put(taggedListKey, JSON.stringify(taggedList));
  }
}

// 辅助函数：从标记列表中移除用户ID
async function removeFromTaggedList(userId) {
  const taggedListKey = 'tagged-users-list';
  let taggedList = await nfd.get(taggedListKey, { type: "json" }) || [];
  
  const newList = taggedList.filter(id => id !== userId);
  await nfd.put(taggedListKey, JSON.stringify(newList));
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
