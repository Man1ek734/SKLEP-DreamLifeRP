require('dotenv').config();
const fs = require('node:fs');
const path = require('node:path');
const { Client, Events, GatewayIntentBits } = require('discord.js');

const token = process.env.DISCORD_TOKEN;
const guildId = process.env.GUILD_ID || '1560762219946451035';
const name = 'SKLEP | DreamLifeRP';

if (!token) {
  console.error('Missing DISCORD_TOKEN. Add it in Railway Variables.');
  process.exit(1);
}

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.once(Events.ClientReady, async () => {
  console.log('Discord bot connected: ' + client.user.id);

  try {
    if (client.user.username !== name) {
      await client.user.setUsername(name);
    }
  } catch (error) {
    console.error('Could not change bot username:', error.message);
  }

  const avatarPath = path.join(__dirname, 'avatar.jpg');
  if (!client.user.avatar && fs.existsSync(avatarPath)) {
    try {
      await client.user.setAvatar(fs.readFileSync(avatarPath));
      console.log('Avatar configured.');
    } catch (error) {
      console.error('Could not set avatar:', error.message);
    }
  }

  try {
    const guild = await client.guilds.fetch(guildId);
    console.log('Connected to guild: ' + guild.id);
  } catch (error) {
    console.error('Bot is not yet in the target guild:', error.message);
  }
});

client.on(Events.Error, (error) => console.error('Discord client error:', error.message));

client.login(token).catch((error) => {
  console.error('Discord login error:', error.message);
  process.exit(1);
});
