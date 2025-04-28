const axios = require("axios");
const TelegramBot = require("node-telegram-bot-api");
const fs = require("fs");

// Конфигурация
const TELEGRAM_TOKEN = "7606358097:AAGfxzYb0h-FYcCPcTfRJPhR0LMrHOeAvC8";
const CHANNEL_USERNAME = "@rental_bishkek";
const FILE_PATH = "./sent_apartments.json";

const bot = new TelegramBot(TELEGRAM_TOKEN, { polling: false });

// Состояния
let sentApartmentIds = new Set();
let pendingQueue = []; // теперь очередь массивом

// ======= Функции ==========

// Пауза
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Загрузка отправленных ID
function loadSentIds() {
  if (fs.existsSync(FILE_PATH)) {
    const savedData = JSON.parse(fs.readFileSync(FILE_PATH));
    sentApartmentIds = new Set(savedData);
  }
}

// Сохранение отправленных ID
function saveSentIds() {
  fs.writeFileSync(FILE_PATH, JSON.stringify([...sentApartmentIds]));
}

// Получить новые квартиры
async function fetchAndSendApartments() {
    if (pendingQueue.length > 0) {
      console.log("⏳ Очередь ещё не пустая, пропускаем поиск новых квартир...");
      return;
    }
  
    try {
      const response = await axios.get(
        "https://lalafo.kg/api/search/v3/feed/search",
        {
          headers: {
            "User-Agent": "Mozilla/5.0",
            device: "pc",
          },
          params: {
            expand: "url",
            "per-page": 50,
            page: 1,
            category_id: 2044,
            city_id: 103184,
            params: "19057",
          },
        }
      );
  
      const apartments = response.data.items;
      for (const item of apartments) {
        if (!sentApartmentIds.has(item.id)) {
          console.log(`🔔 Найдена новая квартира: ${item.id}`);
          pendingQueue.push(item.id); // добавляем в очередь
        }
      }
    } catch (error) {
      console.error("Ошибка при получении списка квартир:", error.message);
    }
  }
  

// Получить детали квартиры и отправить
async function fetchApartmentDetailsAndSend(adId) {
  try {
    const response = await axios.get(
      `https://lalafo.kg/api/search/v3/feed/details/${adId}?expand=url`,
      {
        headers: {
          "User-Agent": "Mozilla/5.0",
          device: "pc",
        },
      }
    );

    const item = response.data;
    console.log(item, 'item');
    const title = item.title?.replace('Long term rental apartments', 'Сдается квартира') || 'Без названия';
    const link = `https://lalafo.kg${item.url}`;
    const district =
      item.params?.find((p) => p.name === "District")?.value || "Не указан";
    const postedAt = new Date(item.created_time * 1000).toLocaleString("ru-RU");
    const phone = item.mobile || "Не указан";

    // Вытаскиваем важные параметры
    const importantParams = extractImportantParams(item.params || []);
    const floor =
      importantParams.floorNumber && importantParams.numberOfFloors
        ? `${importantParams.floorNumber} из ${importantParams.numberOfFloors}`
        : "Не указано";
    const whoOwner =
      importantParams.owner?.toLowerCase() === "owner"
        ? "Собственник"
        : "Агентство";
    const deposit = importantParams.deposit || "Не указан";

    const price = item.price
      ? `${item.price} ${item.currency}`
      : "Цена договорная";

    const photoUrl = item.images?.[0]?.original_url || item.images?.[0]?.thumbnail_url;

    // 📋 Формируем красивый текст
    const caption = `
<a href="${link}"><b>${title}</b></a>

📍 Район: <b>#${district.replace(/\s/g, "")}</b>
💵 Цена: <b>${price}</b>
📞 Телефон: <b>${phone}</b>

🏢 Этаж: <b>${floor}</b>
👤 Владелец: <b>${whoOwner}</b>
💰 Депозит: <b>${deposit}</b>

🗓 Дата публикации: <b>${postedAt}</b>
`.trim();

    const options = {
      parse_mode: "HTML",
      reply_markup: {
        inline_keyboard: [[{ text: "➡️ К объявлению", url: link }]],
      },
    };

    if (photoUrl) {
      await bot.sendPhoto(CHANNEL_USERNAME, photoUrl, { caption, ...options });
    } else {
      await bot.sendMessage(CHANNEL_USERNAME, caption, options);
    }

    console.log(`✅ Отправлено объявление: ${adId}`);

    sentApartmentIds.add(adId);
    saveSentIds();
  } catch (error) {
    console.error(
      `❌ Ошибка отправки деталей объявления ${adId}:`,
      error.message
    );
  }
}

// Функция обработки очереди с интервалом 1 минута
async function processQueue() {
  if (pendingQueue.length === 0) {
    return;
  }

  const adId = pendingQueue.shift(); // берём первый элемент
  await fetchApartmentDetailsAndSend(adId);
}

// ======== Старт процесса ==========

// Загружаем ранее отправленные ID
loadSentIds();

// Сразу первый раз ищем квартиры
fetchAndSendApartments();

// Каждые 5 минут обновляем новые квартиры
setInterval(fetchAndSendApartments, 5 * 60 * 1000);

// Каждую 1 минуту отправляем 1 квартиру
setInterval(processQueue, 1 * 60 * 1000);

// Каждые 48 часов очищаем отправленные ID
setInterval(clearSentIds, 48 * 60 * 60 * 1000);

function extractImportantParams(params) {
  const importantFields = {
    "Floor Number": null,
    "Number of Floors": null,
    "KG - Seller Type": null, // Это "Owner"
    "Deposit, som": null,
  };

  for (const param of params) {
    if (importantFields.hasOwnProperty(param.name)) {
      importantFields[param.name] = param.value;
    }
  }

  return {
    floorNumber: importantFields["Floor Number"],
    numberOfFloors: importantFields["Number of Floors"],
    owner: importantFields["KG - Seller Type"],
    deposit: importantFields["Deposit, som"],
  };
}

function clearSentIds() {
  sentApartmentIds.clear(); // очищаем все отправленные ID
  saveSentIds(); // сохраняем пустой файл
  console.log("🧹 Очищен список отправленных квартир!");
}
