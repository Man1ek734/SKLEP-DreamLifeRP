require('dotenv').config();

const fs = require('node:fs');
const path = require('node:path');
const { nextTicketNumber } = require('./ticket-counter');
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
  PermissionFlagsBits,
  StringSelectMenuBuilder
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
      'Wybierz opcję **„Dokonaj zakupu”**.\n\n' +
      '**Jak to działa?**\n' +
      '① Wybierz opcję zakupową.\n' +
      '② Opisz, co chcesz kupić.\n' +
      '③ Poczekaj na odpowiedź zarządu.'
    )
    .setThumbnail(client.user.displayAvatarURL())
    .setFooter({ text: panelFooter });

  const select = new StringSelectMenuBuilder()
    .setCustomId('dreamlife-shop:buy')
    .setPlaceholder('🛍️ Wybierz opcję zakupową')
    .addOptions({
      label: 'Dokonaj zakupu',
      description: 'Otwórz prywatny ticket zakupowy',
      value: 'purchase',
      emoji: '🛒'
    });

  return {
    embeds: [embed],
    components: [new ActionRowBuilder().addComponents(select)],
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
  if (interaction.channelId !== panelChannelId || interaction.values[0] !== 'purchase') {
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
          deny: [PermissionFlagsBits.ViewChannel]
        },
        {
          id: userId,
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
    console.error('Could not open shop ticket:', error.message);
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
});

client.on(Events.InteractionCreate, async interaction => {
  if (interaction.guildId !== guildId) return;

  const isBuy = interaction.isStringSelectMenu() &&
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
