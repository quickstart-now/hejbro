import { existingTable, uuid } from "hejbro";

export const authUsers = existingTable("auth", "users", { id: uuid() });
