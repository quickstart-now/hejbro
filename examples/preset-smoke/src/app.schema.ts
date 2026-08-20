import { integer, schema, table, uuid } from "@hejbro/core";
import { schemaNote, txidCurrent } from "./preset";

export const app = schema("app");

export const appNote = schemaNote(
	"app",
	"declared by preset-smoke, proving @hejbro/core's extension interface is generic.",
);

export const events = table(app, "events", {
	id: uuid().primaryKey().defaultRandom(),
	createdTxid: integer().notNull().default(txidCurrent()),
});
