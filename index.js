require('dotenv').config();

const fs = require('node:fs');
const path = require('node:path');
const { nextTicketNumber } = require('./ticket-counter');
const { registerVehicleImport, importVehicles } = require('./vehicle-import');
const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  Client,
  EmbedBuilder,
  Events,
  GatewayIntentBits,
  MessageFlags,
  OverwriteType,
  PermissionFlagsBits
} = require('discord.js');

const token = process.env.DISCORD_TOKEN;
const guildId = process.env.GUILD_ID || '1560762219946451035';
const panelChannelId = '1560763451129860147';
const botName = 'SKLEP | DreamLifeRP';
const panelFooter = 'DreamLifeRP © 2026';
const ticketPrefix = 'dreamlife-shop-ticket:';
const shopStaffId = '500912461504053259';
const openingTickets = new Set();

if (!token) {
  console.error('Missing DISCORD_TOKEN. Set it in Railway Variables.');
  process.exit(1);
}

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

async function getAllowedCategory() {
  const guild = await client.guilds.fetch(guildId);
  const panel = await guild.channels.fetch(panelChannelId);

  if (!panel || panel.type !== ChannelType.GuildText || !panel.parentId) {
    throw new Error('Panel channel is missing or has no category.');
  }

  const category = await guild.channels.fetch(panel.parentId);

  if (!category || category.type !== ChannelType.GuildCategory ||
      !category.name.toLowerCase().includes('zakupy')) {
    throw new Error('SAFETY: panel is not in the ZAKUPY category. No channels changed.');
  }

  return { guild, panel, category };
}

function panelMessage() {
  const embed = new EmbedBuilder()
    .setColor(0xF3BE36)
    .setTitle('🛒  Centrum zakupów • DreamLifeRP')
    .setDescription(
      '**Chcesz dokonać zakupu na serwerze?**\n\n' +
      'Kliknij przycisk **„Stwórz Ticketa”**.\n\n' +
      '**Jak to działa?**\n' +
      '① Kliknij przycisk poniżej.\n' +
      '② Opisz, co chcesz kupić.\n' +
      '③ Poczekaj na odpowiedź zarządu.'
    )
    .setThumbnail(client.user.displayAvatarURL())
    .setFooter({ text: panelFooter });

  const button = new ButtonBuilder()
    .setCustomId('dreamlife-shop:buy')
    .setLabel('Stwórz Ticketa')
    .setStyle(ButtonStyle.Secondary);

  return {
    embeds: [embed],
    components: [new ActionRowBuilder().addComponents(button)],
    allowedMentions: { parse: [] }
  };
}

async function ensurePanel() {
  const { panel, category } = await getAllowedCategory();
  const me = await panel.guild.members.fetchMe();
  const required = [
    PermissionFlagsBits.ViewChannel,
    PermissionFlagsBits.SendMessages,
    PermissionFlagsBits.EmbedLinks,
    PermissionFlagsBits.ReadMessageHistory
  ];
  const perms = panel.permissionsFor(me);
  if (!perms || required.some(flag => !perms.has(flag))) {
    throw new Error('Missing panel channel permissions: View Channel, Send Messages, Embed Links or Read Message History.');
  }

  const messages = await panel.messages.fetch({ limit: 100 });
  const previousPanels = messages.filter(message =>
    message.author.id === client.user.id &&
    message.components.some(row =>
      row.components.some(component => component.customId === 'dreamlife-shop:buy')
    )
  );

  const posted = await panel.send(panelMessage());
  for (const previous of previousPanels.values()) {
    try {
      await previous.delete();
    } catch (error) {
      console.error('Could not delete old shop panel ' + previous.id + ':', error.message);
    }
  }
  console.log('Shop panel resent without edits: ' + posted.id + ' in allowed category ' + category.id);
}

function isPurchaseTicket(channel, categoryId) {
  return channel && channel.type === ChannelType.GuildText &&
    channel.parentId === categoryId &&
    typeof channel.topic === 'string' &&
    /^dreamlife-shop-ticket:\d{17,22}$/.test(channel.topic);
}

async function openTicket(interaction) {
  if (interaction.channelId !== panelChannelId || interaction.customId !== 'dreamlife-shop:buy' || !interaction.isButton()) {
    await interaction.reply({ content: 'Ta opcja nie jest dostępna.', flags: MessageFlags.Ephemeral });
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const userId = interaction.user.id;

  if (openingTickets.has(userId)) {
    await interaction.editReply('Twój ticket jest już tworzony. Spróbuj ponownie za chwilę.');
    return;
  }

  openingTickets.add(userId);
  try {
    const { guild, category } = await getAllowedCategory();
    const allChannels = await guild.channels.fetch();
    const topic = ticketPrefix + userId;
    const previous = allChannels.find(channel =>
      channel && channel.parentId === category.id && channel.topic === topic
    );

    if (previous) {
      await interaction.editReply('Masz już otwarty ticket: <#' + previous.id + '>');
      return;
    }

    const everyoneId = guild.roles.everyone.id;
    const ticketNumber = nextTicketNumber();
    const channel = await guild.channels.create({
      name: 'ticket-' + ticketNumber,
      type: ChannelType.GuildText,
      parent: category.id,
      topic,
      permissionOverwrites: [
        {
          id: everyoneId,
          type: OverwriteType.Role,
          deny: [PermissionFlagsBits.ViewChannel]
        },
        {
          id: userId,
          type: OverwriteType.Member,
          allow: [
            PermissionFlagsBits.ViewChannel,
            PermissionFlagsBits.SendMessages,
            PermissionFlagsBits.ReadMessageHistory,
            PermissionFlagsBits.EmbedLinks,
            PermissionFlagsBits.AttachFiles
          ]
        },
        ...(shopStaffId === userId ? [] : [{
          id: shopStaffId,
          type: OverwriteType.Member,
          allow: [
            PermissionFlagsBits.ViewChannel,
            PermissionFlagsBits.SendMessages,
            PermissionFlagsBits.ReadMessageHistory,
            PermissionFlagsBits.EmbedLinks,
            PermissionFlagsBits.AttachFiles
          ]
        }]),
        {
          id: client.user.id,
          type: OverwriteType.Member,
          allow: [
            PermissionFlagsBits.ViewChannel,
            PermissionFlagsBits.SendMessages,
            PermissionFlagsBits.ReadMessageHistory,
            PermissionFlagsBits.EmbedLinks,
            PermissionFlagsBits.ManageChannels
          ]
        }
      ],
      reason: 'DreamLifeRP: ticket zakupowy dla ' + userId
    });

    const welcome = new EmbedBuilder()
      .setColor(0xF3BE36)
      .setTitle('🛍️  Ticket zakupowy #' + ticketNumber)
      .setDescription('Witaj <@' + userId + '>!')
      .setFooter({ text: 'DreamLifeRP © 2026 • Ticket zakupowy' });

    const closeButton = new ButtonBuilder()
      .setCustomId('dreamlife-shop:close')
      .setLabel('Zamknij ticket')
      .setEmoji('🔒')
      .setStyle(ButtonStyle.Secondary);

    await channel.send({
      content: '<@' + shopStaffId + '>',
      embeds: [welcome],
      components: [new ActionRowBuilder().addComponents(closeButton)],
      allowedMentions: { users: [shopStaffId] }
    });

    await interaction.editReply('✅ Twój prywatny ticket został utworzony: <#' + channel.id + '>');
    console.log('Ticket created in ZAKUPY: ' + channel.id);
  } catch (error) {
    console.error('Could not open shop ticket:', error);
    await interaction.editReply('Nie udało się utworzyć ticketu. Sprawdź uprawnienia bota w kategorii ZAKUPY.');
  } finally {
    openingTickets.delete(userId);
  }
}

async function handleClose(interaction, categoryId) {
  if (!isPurchaseTicket(interaction.channel, categoryId)) {
    await interaction.reply({
      content: 'Ten przycisk działa wyłącznie w ticketach zakupowych.',
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  const ticketOwner = interaction.channel.topic.slice(ticketPrefix.length);
  const canManage = interaction.memberPermissions &&
    interaction.memberPermissions.has(PermissionFlagsBits.ManageChannels);

  if (interaction.user.id !== ticketOwner && !canManage) {
    await interaction.reply({
      content: 'Tylko autor ticketu lub uprawniona obsługa może go zamknąć.',
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  if (interaction.customId === 'dreamlife-shop:close') {
    const yes = new ButtonBuilder()
      .setCustomId('dreamlife-shop:confirm')
      .setLabel('Tak, zamknij')
      .setStyle(ButtonStyle.Danger);
    const no = new ButtonBuilder()
      .setCustomId('dreamlife-shop:cancel')
      .setLabel('Nie, wróć')
      .setStyle(ButtonStyle.Secondary);
    await interaction.reply({
      content: 'Czy na pewno chcesz zamknąć ten ticket?',
      components: [new ActionRowBuilder().addComponents(yes, no)],
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  if (interaction.customId === 'dreamlife-shop:cancel') {
    await interaction.update({
      content: 'Zamykanie anulowane.',
      components: []
    });
    return;
  }

  if (interaction.customId === 'dreamlife-shop:confirm') {
    await interaction.update({
      content: 'Zamykam ticket.',
      components: []
    });
    await interaction.channel.delete('DreamLifeRP: zamknięcie ticketu zakupowego');
  }
}

// One-time correction of a mislabeled vehicle post. Idempotent across restarts.
async function correctLandCruiserBeastListing() {
  const wrongMessageId = '1571607258314440880';
  const destinationId = '1560763085994598553';
  const correctName = 'Land Cruiser Beast Editon | Itzahmad_2002';
  const guild = await client.guilds.fetch(guildId);
  const channels = await guild.channels.fetch();

  const catalogChannels = [...channels.values()]
    .filter(channel => channel && channel.type === ChannelType.GuildText &&
      /sedany|pojazdy-sportowe|coupe|off-road|musclecar|limuzyny|motocykle/i.test(channel.name))
    .sort((a, b) => Number(/sedany/i.test(b.name)) - Number(/sedany/i.test(a.name)));

  let removed = false;
  for (const channel of catalogChannels) {
    try {
      const message = await channel.messages.fetch(wrongMessageId);
      if (message.author.id !== client.user.id) {
        console.warn('Land Cruiser correction: matched message belongs to another author, leaving it intact.');
        break;
      }
      await message.delete();
      removed = true;
      console.log('Land Cruiser correction: removed erroneous post ' + wrongMessageId + ' from #' + channel.name);
      break;
    } catch (error) {
      if (error.code !== 10008) {
        console.warn('Land Cruiser correction: lookup/delete failed in #' + channel.name + ': ' + error.message);
      }
    }
  }
  if (!removed) console.warn('Land Cruiser correction: erroneous message not found or could not be removed.');

  const destination = channels.get(destinationId) || await guild.channels.fetch(destinationId);
  if (!destination || destination.guildId !== guildId || destination.type !== ChannelType.GuildText) {
    throw new Error('Land Cruiser correction: target channel is not a text channel in the expected guild.');
  }
  const recent = await destination.messages.fetch({limit: 100});
  const duplicate = recent.find(msg => msg.author.id === client.user.id &&
    msg.content.includes(correctName));
  if (duplicate) {
    console.log('Land Cruiser correction: correct listing already exists: ' + duplicate.id);
    return;
  }
  const photoPath = path.join(__dirname, 'assets', 'land-cruiser-beast.jpg');
  const message = await destination.send({
    content: '• **' + correctName + '**',
    files: [{ attachment: fs.readFileSync(photoPath), name: 'Land_Cruiser_Beast_Editon.jpg' }],
    allowedMentions: { parse: [] }
  });
  console.log('Land Cruiser correction: posted ' + correctName + ' in channel ' + destinationId +
    ' as message ' + message.id);
}


/** One-time, narrowly scoped shop listing correction requested 2026-11-15. */
async function relocateAndRenameRequestedVehicles() {
  const MOVE_SOURCE_ID = '1571607246796759204';
  const MOVE_TARGET_CHANNEL_ID = '1571602888923291838';
  const RENAME_MESSAGE_ID = '1571607262483714171';
  const RENAME_CONTENT = '• **Rolls Royce Wraith Prime Edition | Itzahmed_2002**';
  const label = '[Requested shop correction 2026-11-15]';
  const guild = await client.guilds.fetch(guildId);
  const channels = await guild.channels.fetch();
  const destination = channels.get(MOVE_TARGET_CHANNEL_ID) ||
    await guild.channels.fetch(MOVE_TARGET_CHANNEL_ID);

  if (!destination || destination.guildId !== guildId ||
      destination.type !== ChannelType.GuildText) {
    throw new Error(label + ' Destination is not a text channel within the expected guild.');
  }

  const candidates = [...channels.values()].filter(channel =>
    channel && channel.guildId === guildId &&
    channel.type === ChannelType.GuildText &&
    /sedany|pojazdy-sportowe|coupe|off-road|musclecar|limuzyny|motocykle/i.test(channel.name)
  );
  if (!candidates.some(ch => ch.id === destination.id)) candidates.push(destination);

  async function findById(id) {
    for (const ch of candidates) {
      try {
        const msg = await ch.messages.fetch(id);
        return {channel: ch, message: msg};
      } catch (error) {
        if (error.code !== 10008 && error.code !== 50001 && error.code !== 50013) {
          console.warn(label + ' Lookup ' + id + ' in #' + ch.name + ' failed: ' + error.message);
        }
      }
    }
    return null;
  }

  // Preserve author, text and photo: send new copy before deleting the old post.
  try {
    const source = await findById(MOVE_SOURCE_ID);
    if (!source) {
      console.warn(label + ' Move source ' + MOVE_SOURCE_ID + ' not found; cannot move.');
    } else if (source.message.author.id !== client.user.id) {
      console.warn(label + ' Move refused: source message is not owned by this bot.');
    } else if (source.channel.id === MOVE_TARGET_CHANNEL_ID) {
      console.log(label + ' Source is already in the destination channel.');
    } else {
      const destRecent = await destination.messages.fetch({ limit: 100 });
      let duplicate = destRecent.find(msg =>
        msg.author.id === client.user.id &&
        msg.content === source.message.content &&
        msg.attachments.size === source.message.attachments.size &&
        (msg.attachments.size === 0 || [...msg.attachments.values()].every((a,i) =>
          a.name === [...source.message.attachments.values()][i]?.name))
      );
      if (!duplicate) {
        const files = [];
        for (const [i, attachment] of [...source.message.attachments.values()].entries()) {
          if (attachment.size > 8 * 1024 * 1024) {
            throw new Error('Attachment exceeds 8 MB; old post left untouched.');
          }
          const response = await fetch(attachment.url, {
            signal: AbortSignal.timeout(20000)
          });
          if (!response.ok) throw new Error('Could not retrieve photo: HTTP ' + response.status);
          const bytes = Buffer.from(await response.arrayBuffer());
          if (bytes.length !== attachment.size) {
            throw new Error('Photo download size mismatch; leaving source untouched.');
          }
          files.push({
            attachment: bytes,
            name: attachment.name || 'auto-' + i + '.png'
          });
        }
        const embeds = source.message.embeds
          .filter(e => e.type === 'rich')
          .map(e => e.toJSON());
        duplicate = await destination.send({
          content: source.message.content || (embeds.length || files.length ? undefined : '•'),
          files,
          embeds,
          allowedMentions: {parse: []}
        });
        console.log(label + ' Copied source message ' + MOVE_SOURCE_ID +
          ' to channel ' + MOVE_TARGET_CHANNEL_ID + ' as ' + duplicate.id);
      } else {
        console.log(label + ' Equivalent copy already in destination: ' + duplicate.id);
      }
      await source.message.delete();
      console.log(label + ' Deleted original ' + MOVE_SOURCE_ID + ' in #' + source.channel.name);
    }
  } catch (error) {
    console.error(label + ' Move failed; source left intact whenever possible:', error);
  }

  // Change text only: Discord preserves the message's original image attachment.
  try {
    const located = await findById(RENAME_MESSAGE_ID);
    if (!located) {
      console.warn(label + ' Rename message ' + RENAME_MESSAGE_ID + ' not found.');
    } else if (located.message.author.id !== client.user.id) {
      console.warn(label + ' Rename refused: message is not owned by this bot.');
    } else if (located.message.content === RENAME_CONTENT) {
      console.log(label + ' Rename already correct at ' + RENAME_MESSAGE_ID);
    } else {
      const changed = await located.message.edit({
        content: RENAME_CONTENT,
        allowedMentions: {parse: []}
      });
      console.log(label + ' Edited ' + changed.id + ' in channel ' +
        located.channel.id + ' -> ' + RENAME_CONTENT);
    }
  } catch (error) {
    console.error(label + ' Rename failed:', error);
  }
}


async function correctRangeRoverOnyxListing() {
  const messageId = '1571607243726524507';
  const newContent = '• **Range Rover Onyx Edition | Nejc1**';
  const guild = await client.guilds.fetch(guildId);
  const channels = await guild.channels.fetch();
  const candidates = [...channels.values()].filter(channel =>
    channel && channel.type === ChannelType.GuildText &&
    channel.guildId === guildId &&
    /sedany|pojazdy-sportowe|coupe|off-road|musclecar|limuzyny|motocykle/i.test(channel.name)
  );
  for (const channel of candidates) {
    let message;
    try {
      message = await channel.messages.fetch(messageId);
    } catch (error) {
      if (error.code !== 10008 && error.code !== 50001 && error.code !== 50013) {
        console.warn('Range Rover rename lookup in ' + channel.id + ': ' + error.message);
      }
      continue;
    }
    if (message.author.id !== client.user.id) {
      console.warn('Range Rover rename refused, message is not bot-owned: ' + messageId);
      return;
    }
    if (message.content === newContent) {
      console.log('Range Rover rename already correct: ' + messageId + ' in channel ' + channel.id);
      return;
    }
    await message.edit({ content: newContent, allowedMentions: { parse: [] } });
    console.log('Range Rover rename completed: ' + messageId + ' in channel ' + channel.id + ' -> ' + newContent);
    return;
  }
  console.warn('Range Rover rename: message not found in catalog channels: ' + messageId);
}

client.once(Events.ClientReady, async () => {
  console.log('Discord bot connected: ' + client.user.id);

  try {
    if (client.user.username !== botName) {
      await client.user.setUsername(botName);
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
    await ensurePanel();
  } catch (error) {
    console.error('Shop panel setup failed:', error.message);
  }

  try {
    await registerVehicleImport(client, guildId);
  } catch (error) {
    console.error('Vehicle import command registration failed:', error);
  }

  try {
    await correctLandCruiserBeastListing();
  } catch (error) {
    console.error('Land Cruiser correction failed:', error);
  }

  try {
    await relocateAndRenameRequestedVehicles();
  } catch (error) {
    console.error('Requested vehicle corrections failed:', error);
  }

  try {
    await correctRangeRoverOnyxListing();
  } catch (error) {
    console.error('Range Rover rename failed:', error);
  }
});

client.on(Events.InteractionCreate, async interaction => {
  if (interaction.guildId !== guildId) return;

  if (interaction.isChatInputCommand() && interaction.commandName === 'import-pojazdy') {
    await importVehicles(interaction, guildId);
    return;
  }

  const isBuy = interaction.isButton() &&
    interaction.customId === 'dreamlife-shop:buy';
  const isClose = interaction.isButton() &&
    ['dreamlife-shop:close', 'dreamlife-shop:confirm', 'dreamlife-shop:cancel']
      .includes(interaction.customId);

  if (!isBuy && !isClose) return;

  try {
    const { category } = await getAllowedCategory();
    if (isBuy) {
      await openTicket(interaction);
    } else {
      await handleClose(interaction, category.id);
    }
  } catch (error) {
    console.error('Shop interaction failed:', error.message);
    if (!interaction.replied && !interaction.deferred) {
      await interaction.reply({
        content: 'Nie można teraz obsłużyć tej opcji. Spróbuj później.',
        flags: MessageFlags.Ephemeral
      }).catch(() => {});
    }
  }
});

client.on(Events.Error, error => console.error('Discord client error:', error.message));

client.login(token).catch(error => {
  console.error('Discord login error:', error.message);
  process.exit(1);
});
