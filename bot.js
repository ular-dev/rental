const axios = require("axios");
const TelegramBot = require("node-telegram-bot-api");
const fs = require("fs");

// Токен бота и канал
const TELEGRAM_TOKEN = "7606358097:AAGfxzYb0h-FYcCPcTfRJPhR0LMrHOeAvC8";
const CHANNEL_USERNAME = "@rental_bishkek";

const bot = new TelegramBot(TELEGRAM_TOKEN, { polling: false });

// Файлы
const FILE_PATH = "./sent_apartments.json";

// Загруженные ID и отправленные сообщения
let sentApartmentIds = new Set();

function loadSentIds() {
  if (fs.existsSync(FILE_PATH)) {
    const savedData = JSON.parse(fs.readFileSync(FILE_PATH));
    sentApartmentIds = new Set(savedData);
  }
}

function saveSentIds() {
  fs.writeFileSync(FILE_PATH, JSON.stringify([...sentApartmentIds]));
}

// Очередь сообщений
const queue = [];
let isSending = false;

// Статистика
let apartmentsSentToday = 0;

// Функция паузы
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Процессинг очереди
async function processQueue() {
  if (isSending) return;
  isSending = true;

  while (queue.length > 0) {
    const { type, data } = queue.shift();

    try {
      if (type === "photo") {
        const sent = await bot.sendPhoto(CHANNEL_USERNAME, data.photo, {
          caption: data.caption,
          parse_mode: "HTML",
        });
      } else if (type === "text") {
        const sent = await bot.sendMessage(CHANNEL_USERNAME, data.caption, {
          parse_mode: "HTML",
        });
      }

      apartmentsSentToday++;
      console.log("✅ Отправлено:", data.caption.slice(0, 30) + "...");
    } catch (error) {
      console.error("❌ Ошибка отправки:", error.message);
    }

    await sleep(60000); // Пауза 2 секунды между сообщениями
  }

  isSending = false;
}

// Получение квартир
async function fetchAndSendApartments() {
  try {
    const response = await axios.get(
      "https://lalafo.kg/api/search/v3/feed/search",
      {
        headers: {
          "User-Agent": "Mozilla/5.0",
          device: "pc",
        },
        params: {
          expand: "url", // Добавляет ссылку к объявлениям
          "per-page": 50, // 20 объявлений за раз
          page: 1, // первая страница
          category_id: 2044, // Долгосрочная аренда квартир
          city_id: 103184, // Бишкек
        },
      }
    );

    const apartments = response.data.items;
    console.log(apartments);
    for (const item of apartments) {
      if (!sentApartmentIds.has(item.id)) {
        sentApartmentIds.add(item.id);
        saveSentIds();

        const title = item.title || "Без названия";
        const link = `https://lalafo.kg${item.url}`;
        const district = item.params[0]?.value || "Не указан";
        const postedAt = new Date(item.created_time * 1000).toLocaleString(
          "ru-RU"
        );
        const phone = item.mobile || "Не указан"
        const price = item.price || "Не указан"
          ? `${item.price} ${item.currency}`
          : "Цена договорная";

        // Фото
        const photoUrl =
          item.images?.[0]?.original_url || item.images?.[0]?.thumbnail_url;

        // Собираем красивый текст
        const caption = `
  <a href="${link}"><b>${title}</b></a>
  
  📍 Район: <b>#${district.replace(/\s/g, "")}</b>
  💵 Цена: <b>${price}</b>
  📞 Телефон: <b>${phone}</b>

  🗓 ${postedAt}
          `.trim();

        // Кнопка "К объявлению"
        const inlineKeyboard = {
          reply_markup: {
            inline_keyboard: [[{ text: "➡️ К объявлению", url: link }]],
          },
          parse_mode: "HTML",
        };

        if (photoUrl) {
          queue.push({
            type: "photo",
            data: {
              photo: photoUrl,
              caption,
              itemId: item.id,
              options: inlineKeyboard,
            },
          });
        } else {
          queue.push({
            type: "text",
            data: { caption, itemId: item.id, options: inlineKeyboard },
          });
        }
      }
    }

    processQueue();
  } catch (error) {
    console.error("Ошибка при получении или отправке:", error.message);
  }
}

// Проверка каждые 5 минуты новые квартиры
setInterval(fetchAndSendApartments, 5 * 60 * 1000);

// Первая загрузка
loadSentIds();
fetchAndSendApartments();
