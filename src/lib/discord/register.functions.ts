import { createServerFn } from "@tanstack/react-start";
import { registerDiscordCommands } from "./commands";

export const syncDiscordCommands = createServerFn({ method: "POST" }).handler(
  async () => {
    const result = await registerDiscordCommands();
    return { ok: true, commands: result };
  },
);
