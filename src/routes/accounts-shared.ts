import type { AccountDTO, Role } from "../types.js";

export interface AccountRow {
  id: string;
  role: Role;
  name: string;
  phone: string;
  region: string;
  login: string;
  password_plain: string;
  password_hash: string;
  temp_pass_plain: string | null;
  temp_pass_hash: string | null;
  active: number;
  last_login: string;
}

export function rowToAccount(row: AccountRow) {
  return row;
}

/** То, что реально уходит на фронт — форма зеркалит Account из types.ts фронтенда.
 *  `password` здесь ВСЕГДА null — см. комментарий в types.ts про модель
 *  "показать один раз". Используется в GET/PATCH-ответах, где plaintext-
 *  пароль показывать не нужно (и не из чего — он больше не хранится). */
export function toAccountDTO(row: AccountRow): AccountDTO {
  return {
    id: row.id,
    role: row.role,
    name: row.name,
    phone: row.phone,
    region: row.region,
    login: row.login,
    password: null,
    active: !!row.active,
    lastLogin: row.last_login,
    tempPass: row.temp_pass_plain,
  };
}

/** Единственное место, где `password` реально заполнен — ответ на создание
 *  аккаунта (POST /admin/accounts). `plainPassword` передаётся явно из
 *  request-переменной (не из БД!), потому что password_plain в БД сразу
 *  после этого зануляется — см. adminAccountsRouter.post("/admin/accounts"). */
export function toAccountDTOWithSecret(row: AccountRow, plainPassword: string): AccountDTO {
  return { ...toAccountDTO(row), password: plainPassword };
}
