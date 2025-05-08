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
let pendingQueue = [];

// ======= Функции ==========
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function loadSentIds() {
  if (fs.existsSync(FILE_PATH)) {
    const savedData = JSON.parse(fs.readFileSync(FILE_PATH));
    sentApartmentIds = new Set(savedData);
  }
}

function saveSentIds() {
  fs.writeFileSync(FILE_PATH, JSON.stringify([...sentApartmentIds]));
}

function isWithinWorkingHours() {
  const now = new Date();
  const hour = now.toLocaleString("ru-RU", { timeZone: "Asia/Bishkek", hour: '2-digit', hour12: false });
  return parseInt(hour, 10) >= 9 && parseInt(hour, 10) < 24;
}

async function fetchAndSendApartments() {
  if (pendingQueue.length > 0) {
    console.log("⏳ Очередь ещё не пустая, пропускаем поиск новых квартир...");
    return;
  }

  try {
    const response = await axios.get(
      "https://lalafo.kg/api/search/v3/feed/search",
      {
        headers: { "User-Agent": "Mozilla/5.0", device: "pc" },
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
        pendingQueue.push(item.id);
      }
    }
  } catch (error) {
    console.error("Ошибка при получении списка квартир:", error.message);
  }
}

async function fetchApartmentDetailsAndSend(adId) {
  try {
    const response = await axios.get(
      `https://lalafo.kg/api/search/v3/feed/details/${adId}?expand=url`,
      {
        headers: { "User-Agent": "Mozilla/5.0", device: "pc" },
      }
    );

    const item = response.data;
    const title = item.title?.replace('Long term rental apartments', 'Сдается квартира') || 'Без названия';
    const district = item.params?.find((p) => p.name === "District")?.value || "Не указан";
    const postedAt = new Date(item.created_time * 1000).toLocaleString("ru-RU");
    const phone = item.mobile || "Не указан";
    const importantParams = extractImportantParams(item.params || []);

    const floor = importantParams.floorNumber && importantParams.numberOfFloors
      ? `${importantParams.floorNumber} из ${importantParams.numberOfFloors}`
      : "Не указано";
    const whoOwner = importantParams.owner?.toLowerCase() === "owner" ? "Собственник" : "Агентство";
    const deposit = importantParams.deposit || "Не указан";
    const price = item.price ? `${item.price} ${item.currency}` : "Цена договорная";

    const caption = `
<b>${title}</b>

📍 Район: <b>#${district.replace(/\s/g, "")}</b>
💵 Цена: <b>${price}</b>
📞 Телефон: <b>${phone}</b>

🏢 Этаж: <b>${floor}</b>
🔑 Квартира от: <b>${whoOwner}</b>
💰 Депозит: <b>${deposit}</b>

🗓 Дата публикации: <b>${postedAt}</b>
`.trim();

    const media = item.images?.slice(0, 10).map((img, index) => ({
      type: "photo",
      media: img.original_url || img.thumbnail_url,
      caption: index === 0 ? caption : undefined,
      parse_mode: index === 0 ? "HTML" : undefined,
    }));

    if (media?.length > 0) {
      await bot.sendMediaGroup(CHANNEL_USERNAME, media);
    } else {
      await bot.sendMessage(CHANNEL_USERNAME, caption, { parse_mode: "HTML" });
    }

    console.log(`✅ Отправлено объявление: ${adId}`);
    sentApartmentIds.add(adId);
    saveSentIds();
  } catch (error) {
    console.error(`❌ Ошибка отправки деталей объявления ${adId}:`, error.message);
  }
}

async function processQueue() {
  if (!isWithinWorkingHours()) {
    console.log("🕒 Вне рабочего времени, пропускаем отправку.");
    return;
  }

  if (pendingQueue.length === 0) return;

  const adId = pendingQueue.shift();
  await fetchApartmentDetailsAndSend(adId);
}

function extractImportantParams(params) {
  const importantFields = {
    "Floor Number": null,
    "Number of Floors": null,
    "KG - Seller Type": null,
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
  sentApartmentIds.clear();
  saveSentIds();
  console.log("🧹 Очищен список отправленных квартир!");
}

// ======== Старт ==========
loadSentIds();
fetchAndSendApartments();

setInterval(fetchAndSendApartments, 5 * 60 * 1000); // каждые 5 минут новые
setInterval(processQueue, 15 * 60 * 1000); // каждые 15 минут отправка
setInterval(clearSentIds, 48 * 60 * 60 * 1000); // раз в 2 дня очистка
