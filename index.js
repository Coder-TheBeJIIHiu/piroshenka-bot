const { Telegraf } = require('telegraf');
const mongoose = require('mongoose');
const { v4: uuidv4 } = require('uuid');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const axios = require('axios');
const express = require('express');
const app = express();
const { prompt, addToHistory } = require("./messages.js");
let stopped_message_count = 0;

start()

// Определение схемы и модели для пользователей
const UserSchema = new mongoose.Schema({
  _id: { type: String, default: uuidv4 },
  uid: { type: Number, unique: true },
  createdAt: { type: Date, default: Date.now },
  warns: { type: Number, default: 0 },
  banned: { type: Boolean, default: false },
  messages: { type: Number, default: 0},
  telegramUserTag: String
});

const User = mongoose.model('User', UserSchema);


app.get('/', async (req, res) => {
  try {
    const users = await User.find({}); // Выбираем только идентификаторы и теги пользователей
    res.json(users); // Отправляем данные в формате JSON
  } catch (err) {
    console.error(err);
    res.status(500).send('Ошибка сервера');
  }
});

// Создаем экземпляр бота Telegraf
const bot = new Telegraf(process.env.BOT_TOKEN);

// Middleware для регистрации пользователей
bot.use(async (ctx, next) => {
    const startTime = Date.now() / 1000;
    const msgDate = ctx.message ? ctx.message.date : null;

    const Time = await checkTime(ctx, startTime, msgDate);
    if (!Time) return;

    // Проверяем наличие ctx.message перед использованием
    if (ctx.message) {
        let user = await User.findOne({ uid: ctx.from.id });
        if (!user) {
            user = new User({
                uid: ctx.from.id,
                telegramUserTag: ctx.from.username ? `@${ctx.from.username}` : ''
            });
            await user.save();
        } else {
            if (user.telegramUserTag !== ctx.from.username) {
                user.telegramUserTag = ctx.from.username ? `@${ctx.from.username}` : '';
                await user.save();
            }
        }
        ctx.state.user = user;
    }
    return next();
});


// Создаем экземпляр GoogleGenerativeAI
const genAI = new GoogleGenerativeAI(process.env.API_KEY);
// Функция для получения текущей даты по GMT
function getCurrentDateByGMT(gmtOffset) {
  let currentDate = new Date();
  let timezoneOffset = gmtOffset * 60;
  let gmtTime = new Date(currentDate.getTime() + timezoneOffset * 60000);
  return gmtTime;
}

const model = genAI.getGenerativeModel({ model: 'gemini-pro' });
const chat = model.startChat({
  history: prompt(),
  generationConfig: {
    maxOutputTokens: 2048,
  },
});

// Функция для отправки сообщения
async function sendMessage(msg) {
  const startTime = Date.now()
  const result = await chat.sendMessage(msg);
  const response = await result.response;
  const text = response.text();
  addToHistory(msg, text);
  return {
      text: text,
      time: Date.now() - startTime
  };
}

// Обработчик команды /start
bot.start((ctx) => ctx.reply('Привет! Давай общаться.'));

// Обработчик текстовых и голосовых сообщений
bot.on(['text', 'voice'], async (ctx) => {
    let userMessage, transcription;

    if (ctx.message.text) {
        userMessage = ctx.message.text;
    } else if (ctx.message.voice) {
        const voiceMessage = ctx.message.voice;
        const audioFileId = voiceMessage.file_id;

        // Скачиваем голосовое сообщение
        const audioBuffer = await ctx.telegram.getFileLink(audioFileId);

        sendError(ctx, audioBuffer)
        axios.get('https://b33756ac-466c-4176-8f21-95df149ef6c3-00-3qklwowzq0xwt.pike.replit.dev/', { params: { url: audioBuffer } })
  .then(response => {
    console.log(response.data);
    userMessage = response.data;
  })
  .catch(error => {
    return sendError(ctx, error)
  });
    }

    // Отправляем ответ пользователю
    const msg = await ctx.reply("ㅤ", {
        reply_parameters: {
            message_id: ctx.message.message_id,
            allow_sending_without_reply: true
        }
    });

    // Общие данные для обоих типов сообщений
    const commonData = {
        message_type: ctx.message.text ? 'text' : 'voice',
        _id: ctx.state.user._id,
        userId: ctx.from.id,
        chatId: ctx.chat.id,
        messageId: ctx.message.message_id,
        userMessageSentDate: ctx.message.date,
        "GMT+6 Astana/Almaty": getCurrentDateByGMT(6),
        "GMT+5 Aktobe": getCurrentDateByGMT(5),
        "Ping per second": (Date.now() / 1000) - ctx.message.date,
        createdAt: ctx.state.user.createdAt,
        warns: ctx.state.user.warns,
        banned: ctx.state.user.banned,
        messages_count: ctx.state.user.messages,
        telegramUserTag: ctx.state.user.telegramUserTag,
        language: ctx.from.language_code,
        stopped_message_count: stopped_message_count,
        note: "Отвечай человеку по его language, а также следи за _id, userId если совпадает с владельцем то общайся как с владельцом"
    };

    // Дополнительные данные для голосовых сообщений
    const voiceData = {
        VoiceMessageText: transcription,
    };

    // Формирование объекта messageData
    const messageData = {
        ...commonData,
        ...(ctx.message.voice && voiceData),
        ...(ctx.message.text && { messageText: userMessage }),
    };

    // Добавляем reply_to_message только если существует ctx.message.reply_to_message
    if (ctx.message.reply_to_message) {
        messageData.user_reply_to_message = {
            message_id: ctx.message.reply_to_message.message_id,
            chat: {
                id: ctx.message.reply_to_message.chat.id,
                username: ctx.message.reply_to_message.chat.username,
                type: ctx.message.reply_to_message.chat.type,
            },
            from: {
                id: ctx.message.reply_to_message.from.id,
                is_bot: ctx.message.reply_to_message.from.is_bot,
                username: ctx.message.reply_to_message.from.username,
                language_code: ctx.message.reply_to_message.from.language_code,
            },
            date: ctx.message.reply_to_message.date,
            text: ctx.message.reply_to_message.text,
        };
    }
    let modelResponseJson;
    let modelResponse;
    try {
        modelResponseJson = await sendMessage(JSON.stringify(messageData));
        modelResponse = modelResponseJson.text;
        await ctx.telegram.editMessageText(messageData.chatId, msg.message_id, null, `${modelResponse}\n\n🕗 • Total generation time: ${((Date.now() / 1000) - ctx.message.date).toFixed(2)}s.\n🌐 • Text generation time: ${(modelResponseJson.time / 1000).toFixed(2)}s.`, { parse_mode: 'markdown' });
        // Увеличиваем счетчик сообщений в базе данных
        await User.updateOne({ uid: ctx.from.id }, { $inc: { messages: 1 } });
    } catch (e) {
        // Увеличиваем счетчик ошибок в базе данных
        if (modelResponse != undefined) {
          await ctx.reply(modelResponse)
        } else {
          await sendError(ctx, modelResponse)
        }
        await User.updateOne({ uid: ctx.from.id }, { $inc: { warns: 1 } });
        await ctx.deleteMessage(msg.message_id)
        await sendError(ctx, `Ой ошибка ._. => ${e}\n\nPrompted: ${JSON.stringify(messageData)}\n\n🕗 • Total generation time: ${((Date.now() / 1000) - ctx.message.date).toFixed(2)}s.\n🌐 • Text generation time: ${(modelResponseJson.time / 1000).toFixed(2)}s.`);
    }
});

function start() {
   // Запускаем бот
  app.listen(8080, async () => {
    console.log('Server started on port 8080');
    // Подключение к базе данных MongoDB
    mongoose.connect(process.env.MONGODB_URL, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
});
    await bot.launch().then(() => {
      console.log('Bot started');
    })

    console.log(prompt())
  })
}

async function checkTime(ctx, startTime, msgDate) {
  if (msgDate < startTime - 30) {
    if (stopped_message_count >= 3) return await sendError(ctx, `Превышен лимит сообщений (${stopped_message_count}).`);
      
      stopped_message_count = await spam('add', stopped_message_count)
      await sendError(
      ctx,
      `Я отстаю от настоящего времени на более чем 30 сек. (Точнее на ±${Math.floor((startTime - msgDate) / 60)} мин).\n\nСообщений отправлено ${stopped_message_count}`,
    );
    return false;
  } else {
    stopped_message_count = await spam('stop', stopped_message_count)
    return true;
  }
}

async function sendError(ctx = null, errorMessage) {
  if (ctx != null) {
    const message = await ctx.reply(errorMessage);
    setTimeout(async () => {
      await ctx.deleteMessage(message.message_id);
    }, 15000);
  }
  console.error(errorMessage);
}

async function spam(x, stopped_message_count, ctx) {
    let spm = await stopped_message_count;
    switch (x) {
        case 'add':
            spm += 1;
            sendError(ctx, `Adding... ${spm}`);
            break;
        case 'remove':
            spm -= 1;
            sendError(ctx, `Removing... ${spm}`);
            break;
        case 'stop':
            spm = 0;
            sendError(ctx, `Stopped... ${spm}`);
            break;
        default:
            sendError(ctx, `Unknown command: ${x}`);
            break;
    }
    return spm;
}