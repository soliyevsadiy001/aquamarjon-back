import { defineConfig } from "vitest/config";

// Каждый тестовый файл сам выставляет себе уникальный DATABASE_PATH во
// временном файле (см. tests/helpers/testApp.ts) до импорта src/app.ts —
// поэтому изоляция тестовых файлов друг от друга (отдельный модульный
// реестр на файл) обязательна, а не просто приятный бонус.
export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    include: ["tests/**/*.test.ts"],
    isolate: true,
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      // Как и на фронте — сначала покрываем самую ценную и дешёвую в
      // поддержке зону: бизнес-логику роутов, а не middleware/инфраструктуру.
      include: ["src/routes/**"],
    },
  },
});
