export interface CatalogSeedItem {
  id: string;
  name: string;
  price: number;
}

// Сгенерировано из фронтового `src/data/fish.ts` (FISH_DB_BASE) и
// `src/data/products.ts` — единственный источник правды по id/name/price
// на момент переноса каталога на бэкенд (см. README, "Каталог как источник
// истины на бэкенде"). Это базовые (без вариантов/оверрайдов) цены; полный
// перенос системы вариантов (`CatalogOverrides` во фронтовом `data/fish.ts`)
// — следующий шаг, см. комментарий в routes/catalog.ts.
//
// ⚠️ Если цены в каталоге фронтенда поменяются вручную (админкой,
// оверрайдами в localStorage) — не забудьте синхронизировать сюда, иначе
// POST /orders начнёт отклонять легитимные заказы как "подозрительно
// дешёвые/дорогие". Долгосрочно: каталог должен редактироваться только
// здесь, а фронт — читать его через GET /catalog.
export const CATALOG_SEED: CatalogSeedItem[] = [
  { id: "guppy", name: "Гуппи «Огненный хвост»", price: 25000 },
  { id: "neon", name: "Неон «Голубая искра»", price: 8000 },
  { id: "betta", name: "Петушок «Королевский бархат»", price: 45000 },
  { id: "ancistrus", name: "Анциструс «Чистильщик»", price: 20000 },
  { id: "molly", name: "Молли «Чёрный бархат»", price: 18000 },
  { id: "discus", name: "Дискус «Королевский»", price: 180000 },
  { id: "angelfish", name: "Скалярия «Серебряный парус»", price: 55000 },
  { id: "danio", name: "Данио «Зебра»", price: 7000 },
  { id: "goldfish", name: "Золотая рыбка «Комета»", price: 22000 },
  { id: "clownloach", name: "Боция «Клоун»", price: 38000 },
  { id: "parrotcichlid", name: "Цихлида «Попугай»", price: 65000 },
  { id: "swordtail_red", name: "Меченосец «Красный»", price: 18000 },
  { id: "swordtail_black", name: "Меченосец «Чёрный бархат»", price: 22000 },
  { id: "swordtail_indo_green", name: "Меченосец «Индонезийский зелёный»", price: 35000 },
  { id: "filter-internal", name: "Фильтр внутренний «Поток-100»", price: 65000 },
  { id: "filter-external", name: "Фильтр внешний «Поток-300 Pro»", price: 220000 },
  { id: "heater", name: "Обогреватель с термостатом", price: 65000 },
  { id: "compressor", name: "Компрессор воздушный «Бриз-2»", price: 35000 },
  { id: "lamp-led", name: "LED-светильник «Аквалюкс»", price: 95000 },
  { id: "substrate", name: "Грунт питательный «Чёрная земля»", price: 28000 },
  { id: "food-flakes", name: "Корм хлопья «Универсал»", price: 18000 },
  { id: "food-color", name: "Корм «Цветной бустер»", price: 24000 },
  { id: "food-pellets-bottom", name: "Корм донный «Сомик»", price: 16000 },
  { id: "food-live-frozen", name: "Мотыль замороженный", price: 12000 },
  { id: "plant-anubias", name: "Анубиас Нана", price: 22000 },
  { id: "plant-vallisneria", name: "Валлиснерия спиральная", price: 9000 },
  { id: "plant-cryptocoryne", name: "Криптокорина Вендта", price: 18000 },
  { id: "plant-moss", name: "Яванский мох (порция)", price: 14000 },
];
