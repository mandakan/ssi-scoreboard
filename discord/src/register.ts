// One-time script to register slash commands with Discord.
// Run: cd discord && pnpm register
//
// Required env vars:
//   DISCORD_BOT_TOKEN  — Bot token
//   DISCORD_APP_ID     — Application ID
//   GUILD_ID           — (optional) Register per-guild for instant availability;
//                        omit for global registration (takes up to 1 hour)

import { COMMANDS } from "./commands/definitions";

const TOKEN = process.env.DISCORD_BOT_TOKEN;
const APP_ID = process.env.DISCORD_APP_ID;
const GUILD_ID = process.env.GUILD_ID;

if (!TOKEN || !APP_ID) {
  console.error("Missing DISCORD_BOT_TOKEN or DISCORD_APP_ID environment variables.");
  process.exit(1);
}

const url = GUILD_ID
  ? `https://discord.com/api/v10/applications/${APP_ID}/guilds/${GUILD_ID}/commands`
  : `https://discord.com/api/v10/applications/${APP_ID}/commands`;

const scope = GUILD_ID ? `guild ${GUILD_ID}` : "global";

async function main() {
  console.log(`Registering ${COMMANDS.length} commands (${scope})...`);

  const response = await fetch(url, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bot ${TOKEN}`,
    },
    body: JSON.stringify(COMMANDS),
  });

  if (!response.ok) {
    const body = await response.text();
    console.error(`Failed to register commands: ${response.status}\n${body}`);
    process.exit(1);
  }

  const registered = await response.json();
  console.log(`Successfully registered ${(registered as unknown[]).length} commands:`);
  for (const cmd of registered as Array<{ name: string; id: string }>) {
    console.log(`  /${cmd.name} (${cmd.id})`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
