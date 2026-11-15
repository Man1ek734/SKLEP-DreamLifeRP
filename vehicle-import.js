// Import catalog photos sent through the /import-pojazdy command.
// Only adds missing car posts; does not edit or delete existing messages/channels.
const fs = require('node:fs');
const path = require('node:path');
const AdmZip = require('adm-zip');
const { AttachmentBuilder, ChannelType, MessageFlags, PermissionFlagsBits, SlashCommandBuilder } = require('discord.js');

const VALID_CATEGORIES = new Set(['pojazdy-sportowe', 'coupe', 'sedany', 'off-road', 'musclecar', 'limuzyny']);
const FILE_MAX_BYTES = 20 * 1024 * 1024;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_TOTAL_UNCOMPRESSED = 80 * 1024 * 1024;
const MAX_CARS = 50;
const STATE_FILE = path.join(fs.existsSync('/data') ? '/data' : __dirname, 'dreamlife-vehicle-import-state.json');
const normalize = value => String(value || '').normalize('NFKD').toLowerCase()
  .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

async function registerVehicleImport(client, guildId) {
  const guild = await client.guilds.fetch(guildId);
  const cmd = new SlashCommandBuilder()
    .setName('import-pojazdy')
    .setDescription('Dodaje zdjęcia samochodów do odpowiednich kanałów sklepu')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addAttachmentOption(option => option
      .setName('plik')
      .setDescription('Plik ZIP DreamLifeRP z manifest.json i zdjęciami')
      .setRequired(true));
  await guild.commands.create(cmd.toJSON());
  console.log('Registered admin-only /import-pojazdy command');
}

function loadState() {
  try {
    const data = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    return data && typeof data === 'object' ? data : {};
  } catch (_) { return {}; }
}
function persistState(state) {
  const tempFile = STATE_FILE + '.tmp';
  fs.writeFileSync(tempFile, JSON.stringify(state, null, 2), 'utf8');
  fs.renameSync(tempFile, STATE_FILE);
}

function findChannel(channels, category) {
  const candidates = [...channels.values()].filter(channel => channel &&
    channel.type === ChannelType.GuildText && normalize(channel.name).endsWith(category));
  return candidates.find(channel => {
    const parent = channels.get(channel.parentId);
    return parent && normalize(parent.name).includes('oferta');
  }) || null;
}

async function importVehicles(interaction, guildId) {
  if (interaction.guildId !== guildId || !interaction.isChatInputCommand() ||
      interaction.commandName !== 'import-pojazdy') return false;

  if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
    await interaction.reply({ content: 'Ta komenda jest tylko dla osób zarządzających serwerem.', flags: MessageFlags.Ephemeral });
    return true;
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  try {
    const attachment = interaction.options.getAttachment('plik', true);
    if (!attachment.name.toLowerCase().endsWith('.zip') || attachment.size > FILE_MAX_BYTES) {
      throw new Error('Wymagany plik ZIP do 20 MB.');
    }

    const response = await fetch(attachment.url, { signal: AbortSignal.timeout(30000) });
    if (!response.ok) throw new Error('Nie udało się pobrać załącznika Discord.');
    const compressed = Buffer.from(await response.arrayBuffer());
    if (compressed.length > FILE_MAX_BYTES) throw new Error('Plik przekracza limit 20 MB.');
    const archive = new AdmZip(compressed);
    const entries = archive.getEntries();
    if (entries.length > 100 || entries.reduce((sum, e) => sum + (e.header.size || 0), 0) > MAX_TOTAL_UNCOMPRESSED) {
      throw new Error('Archiwum jest zbyt duże.');
    }
    const manifestEntry = archive.getEntry('manifest.json');
    if (!manifestEntry || manifestEntry.header.size > 100000) throw new Error('Brak manifest.json.');
    const manifest = JSON.parse(archive.readAsText(manifestEntry));
    if (manifest.version !== 1 || manifest.guildId !== guildId ||
        typeof manifest.batchId !== 'string' || !Array.isArray(manifest.items) ||
        manifest.items.length === 0 || manifest.items.length > MAX_CARS) {
      throw new Error('Niepoprawny format manifestu albo identyfikator serwera.');
    }

    const guild = await interaction.client.guilds.fetch(guildId);
    const channels = await guild.channels.fetch();
    const channelByCategory = new Map();
    for (const category of new Set(manifest.items.map(item => item.category))) {
      if (!VALID_CATEGORIES.has(category)) throw new Error('Nieznana kategoria: ' + category);
      const channel = findChannel(channels, category);
      if (!channel) throw new Error('Nie znalazłem kanału w kategorii OFERTA: ' + category);
      channelByCategory.set(category, channel);
    }

    const state = loadState();
    let sent = 0, skipped = 0, failed = 0;
    const errors = [];
    const items = [...manifest.items].sort((a, b) => a.category.localeCompare(b.category));
    const existingTitles = new Map();

    for (const item of items) {
      if (typeof item.id !== 'string' || !/^dreamlife-[a-zA-Z0-9-]{4,100}$/.test(item.id) ||
          typeof item.name !== 'string' || !item.name.trim() || item.name.length > 160 ||
          typeof item.image !== 'string' || !/^images\/[0-9]{2}\.jpg$/.test(item.image)) {
        failed++; errors.push('Niepoprawna pozycja w pliku ZIP'); continue;
      }
      const channel = channelByCategory.get(item.category);
      if (!channel) { failed++; continue; }
      if (state[item.id]) { skipped++; continue; }
      try {
        if (!existingTitles.has(channel.id)) {
          const messages = await channel.messages.fetch({ limit: 100 });
          const names = new Set();
          for (const msg of messages.values()) {
            if (msg.author.id !== interaction.client.user.id) continue;
            if (msg.content) names.add(normalize(msg.content.replace(/[*•]/g, '').trim()));
            for (const embed of msg.embeds) if (embed.title) names.add(normalize(embed.title));
          }
          existingTitles.set(channel.id, names);
        }
        const titles = existingTitles.get(channel.id);
        if (titles.has(normalize(item.name))) {
          state[item.id] = { channelId: channel.id, existing: true };
          persistState(state); skipped++; continue;
        }

        const entry = archive.getEntry(item.image);
        if (!entry || entry.isDirectory || entry.header.size > MAX_IMAGE_BYTES) {
          throw new Error('Brak zdjęcia lub za duży plik: ' + item.image);
        }
        const bytes = entry.getData();
        if (bytes.length > MAX_IMAGE_BYTES || bytes[0] !== 0xff || bytes[1] !== 0xd8) {
          throw new Error('Niepoprawny obraz JPEG: ' + item.image);
        }

        const message = await channel.send({
          content: '• **' + item.name.replace(/[@*_`~|]/g, c => '\\' + c) + '**',
          files: [new AttachmentBuilder(bytes, { name: item.id + '.jpg' })],
          allowedMentions: { parse: [] }
        });
        titles.add(normalize(item.name));
        state[item.id] = { channelId: channel.id, messageId: message.id };
        persistState(state);
        sent++;
      } catch (error) {
        failed++; errors.push(item.name + ': ' + error.message);
        console.error('Vehicle import failed for ' + item.id + ':', error);
      }
    }
    let reply = 'Import zakończony. Dodano: ' + sent + ', pominięto istniejące: ' + skipped + ', błędy: ' + failed + '.';
    if (errors.length) reply += '\n' + errors.slice(0, 4).join('\n');
    await interaction.editReply(reply.slice(0, 1950));
  } catch (error) {
    console.error('Vehicle ZIP import error:', error);
    await interaction.editReply('Nie udało się zaimportować pojazdów: ' + error.message);
  }
  return true;
}
module.exports = { registerVehicleImport, importVehicles };
