import bcrypt from "bcryptjs";
import { userColumns } from "../db/columns.ts";
import { one, type Db } from "../db/pool.ts";
import type { User } from "../shared/types/index.ts";

/** Costo de bcrypt: 12 desde el 2026-11-15 (antes 10). Unos 200 ms por inicio de sesión. */
const BCRYPT_ROUNDS = 12;

export function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, BCRYPT_ROUNDS);
}

export function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

/** Un hash hecho con un costo menor que el actual: se rehace al iniciar sesión con la contraseña correcta. */
export function needsRehash(hash: string): boolean {
  try {
    return bcrypt.getRounds(hash) < BCRYPT_ROUNDS;
  } catch {
    return false;
  }
}

export async function isEmailRegistered(db: Db, email: string): Promise<boolean> {
  return Boolean(await one(db, "select 1 from users where email = $1", [email]));
}

export async function findUserById(db: Db, userId: string): Promise<User | null> {
  return one<User>(db, `select ${userColumns()} from users where id = $1`, [userId]);
}

/** Crea el usuario con la contraseña que eligió el super admin (se le envía por email). */
export async function createUserAccount(
  db: Db,
  person: { firstName: string; lastName: string; email: string; password: string },
): Promise<User> {
  return (await one<User>(
    db,
    `insert into users (first_name, last_name, email, password_hash)
     values ($1, $2, $3, $4)
     returning ${userColumns()}`,
    [person.firstName, person.lastName, person.email, await hashPassword(person.password)],
  ))!;
}
