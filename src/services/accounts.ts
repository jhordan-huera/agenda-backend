import { randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import { userColumns } from "../db/columns.ts";
import { one, type Db } from "../db/pool.ts";
import type { User } from "../shared/types/index.ts";

const BCRYPT_ROUNDS = 10;

export function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, BCRYPT_ROUNDS);
}

export function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

export async function isEmailRegistered(db: Db, email: string): Promise<boolean> {
  return Boolean(await one(db, "select 1 from users where email = $1", [email]));
}

export async function findUserById(db: Db, userId: string): Promise<User | null> {
  return one<User>(db, `select ${userColumns()} from users where id = $1`, [userId]);
}

/**
 * Contraseña que nadie conoce (aleatoria): la cuenta no puede entrar hasta que su dueño defina la
 * suya con el enlace de un solo uso (ver password-links.ts).
 */
export function unusablePasswordHash(): Promise<string> {
  return hashPassword(randomBytes(32).toString("base64url"));
}

/** Crea el usuario sin contraseña conocida: se le envía un enlace para que la defina él. */
export async function createUserAccount(db: Db, person: { firstName: string; lastName: string; email: string }): Promise<User> {
  return (await one<User>(
    db,
    `insert into users (first_name, last_name, email, password_hash)
     values ($1, $2, $3, $4)
     returning ${userColumns()}`,
    [person.firstName, person.lastName, person.email, await unusablePasswordHash()],
  ))!;
}
