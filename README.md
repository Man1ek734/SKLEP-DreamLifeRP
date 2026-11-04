# SKLEP | DreamLifeRP

Discord bot for guild `1560762219946451035`.

This version connects to Discord and sets its display name and supplied avatar on first startup. It does not send messages, respond to commands or interact with channels.

## Railway

The service is `SKLEP-DreamLifeRP` in project `merry-reflection`.

Add these environment variables in the service's **Variables** tab:

```env
DISCORD_TOKEN=your_discord_bot_token
GUILD_ID=1560762219946451035
```

Never commit a real token to this repository or share it in chat. The `.env` file is gitignored.

Railway builds the Node.js package and starts with `npm start`. A missing token causes a startup error.

Discord developer portal application: https://discord.com/developers/applications/1567637302010708038/bot

Bot invite for the correct server:
https://discord.com/oauth2/authorize?client_id=1567637302010708038&scope=bot&permissions=0&guild_id=1560762219946451035&disable_guild_select=true
