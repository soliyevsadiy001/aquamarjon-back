export type Role = "seller" | "courier" | "admin";

/** Форма, в которой аккаунт уходит на фронт — зеркалит Account из src/types.ts
 *  фронтенда (см. AdminAccountsTab.tsx).
 *
 *  Модель паролей (обновлено): раньше `password` всегда содержал plaintext-
 *  пароль (для отображения по требованию UX — владелец диктует пароль
 *  продавцу по телефону). Теперь это "показать один раз": `password`
 *  заполнен ТОЛЬКО в ответе на создание аккаунта (POST /admin/accounts) —
 *  во всех остальных ответах (GET /admin/accounts, PATCH .../:id) это поле
 *  всегда `null`, т.к. бэкенд больше не хранит постоянный plaintext-пароль
 *  в БД (см. accounts-shared.ts, adminAccounts.ts). Смена пароля админом
 *  теперь возможна только через сброс (POST /admin/accounts/:id/reset-password),
 *  который выдаёт временный пароль (`tempPass`) один раз — до тех пор, пока
 *  пользователь не сменит его сам через /auth/change-password. */
export interface AccountDTO {
  id: string;
  role: Role;
  name: string;
  phone: string;
  region: string;
  login: string;
  password: string | null;
  active: boolean;
  lastLogin: string;
  tempPass: string | null;
}

export interface AuthedRequestUser {
  id: string;
  role: Role;
}
