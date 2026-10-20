require('dotenv').config();
const { Client, GatewayIntentBits, Events } = require('discord.js');
const Groq = require('groq-sdk');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

const SYSTEM_INSTRUCTION = `
You are an automatic Discord support bot for the Pixelix Minecraft community server.
You have general knowledge about everything (Minecraft, technical issues, general facts, etc.).

Here are the official Pixelix Community Rules you must enforce and reference when relevant:
- Respect everyone: No toxicity, hate, racism, or harassment.
- No spam or advertising: No spam, links, or self-promo without permission.
- Use correct channels: Post in the appropriate channels only.
- No scams or impersonation: Scams, fake giveaways, or pretending to be staff.
- No NSFW or illegal content: No explicit, illegal, or harmful material.
- Language: Use English only in public or voice channels.
- No fake proof: No fake screenshots, false reports, or misleading info.
- Follow Discord TOS & Guidelines.
- Support channel: <#1456406493061447794>

Be helpful, friendly, and concise. 
IMPORTANT MODERATION RULE:
If the user's message contains severe toxicity, racism, hate speech, or explicit rule violations, respond ONLY with:
"[SAFETY_VIOLATION]"
`;

const SAFETY_DISCLAIMER = "\n\n🤖 *I’m an automatic discord bot made by ProgramStar I’m not a real human.*";

const ticketMemories = new Map();
const greetedChannels = new Set();
const warnedUsers = new Set();

function addToMemory(channelId, role, text) {
  if (!ticketMemories.has(channelId)) {
    ticketMemories.set(channelId, []);
  }
  ticketMemories.get(channelId).push({ role, text });
}

async function callAI(messages) {
  try {
    const chatCompletion = await groq.chat.completions.create({
      messages: messages,
      model: "llama-3.3-70b-versatile",
      temperature: 0.7,
      max_tokens: 1024,
    });
    return chatCompletion.choices[0]?.message?.content?.trim() || "";
  } catch (error) {
    console.error('Groq API Error:', error.message);
    return "";
  }
}

client.once(Events.ClientReady, () => {
  console.log(`🤖 Pixelix Ticket Bot active as ${client.user.tag}!`);
});

client.on('messageCreate', async (message) => {
  if (message.author.bot) return;

  if (!message.channel.name.startsWith('ticket-') && !message.channel.name.includes('bot-is-doing-it') && !message.channel.name.includes('needed')) {
    return;
  }

  const channelId = message.channel.id;
  const authorId = message.author.id;
  const content = message.content.trim();

  if (!greetedChannels.has(channelId)) {
    greetedChannels.add(channelId);
    
    const introMessage = 
      `👋 **Hello! I am Pixelix Support, your automated ticket assistant.**\n` +
      `I'm here to answer your questions instantly and help keep everything running smoothly.\n\n` +
      `📌 **Need human staff assistance? Type any of these exact phrases:**\n` +
      `• \`I require an owner\` — Pings the Server Owner\n` +
      `• \`I require a manager\` — Pings Managers (<@683984183160471552> & @bubbly4life)\n` +
      `• \`I require staff\` — Pings all staff members (@everyone)\n\n` +
      `*When you ping staff, I will automatically send them a short recap of our conversation!*` +
      SAFETY_DISCLAIMER;

    try {
      await message.channel.send(introMessage);
    } catch (err) {}
  }

  addToMemory(channelId, 'user', `${message.author.username}: ${content}`);

  if (!message.channel.name.includes('bot-is-doing-it') && !message.channel.name.includes('🟢') && !message.channel.name.includes('needed')) {
    try {
      await message.channel.setName('🟢-bot-is-doing-it');
    } catch (err) {}
  }

  const lowerMsg = content.toLowerCase();
  const isOwnerReq = lowerMsg.includes('i require an owner');
  const isManagerReq = lowerMsg.includes('i require a manager');
  const isStaffReq = lowerMsg.includes('require staff') || lowerMsg.includes('i require staff') || lowerMsg.includes('need staff');

  if (isOwnerReq || isManagerReq || isStaffReq) {
    try {
      await message.channel.sendTyping();

      const history = ticketMemories.get(channelId) || [];
      const conversationLog = history.map(h => h.text).join('\n');

      let summaryRecap = "No prior messages recorded.";
      try {
        summaryRecap = await callAI([
          { role: "user", content: `Summarize the following ticket conversation into a short 2-3 sentence recap for staff members:\n\n${conversationLog}` }
        ]);
      } catch (err) {}

      let pings = [];
      let newChannelName = '';

      if (isOwnerReq) {
        pings.push('<@1456243008570654751>');
        newChannelName = '🔴-owner-needed';
      } else if (isManagerReq) {
        pings.push('<@683984183160471552>', '@bubbly4life');
        newChannelName = '🔴-management-needed';
      } else if (isStaffReq) {
        pings.push('@everyone');
        newChannelName = '🟠-staff-needed';
      }

      if (newChannelName) {
        try {
          await message.channel.setName(newChannelName);
        } catch (err) {}
      }

      const escalationMessage = 
        `🚨 **Staff Escalation Requested!**\n` +
        `**Attention:** ${pings.join(' ')}\n\n` +
        `📋 **Ticket Summary / Recap:**\n> ${summaryRecap.replace(/\n/g, '\n> ')}` +
        SAFETY_DISCLAIMER;

      const sentMsg = await message.reply(escalationMessage);

      setTimeout(async () => {
        try {
          await sentMsg.delete();
        } catch (e) {}
      }, 10000);

    } catch (e) {}
    return;
  }

  try {
    await message.channel.sendTyping();

    const history = ticketMemories.get(channelId) || [];
    const formattedHistory = history.map(h => `${h.role === 'user' ? 'User' : 'Assistant'}: ${h.text}`).join('\n');

    const messages = [
      { role: "system", content: SYSTEM_INSTRUCTION },
      { role: "user", content: `Previous Ticket Conversation:\n${formattedHistory}\n\nPlease respond to the user's latest request.` }
    ];

    const replyText = await callAI(messages);
    if (!replyText) return;

    if (replyText.includes('[SAFETY_VIOLATION]')) {
      if (!warnedUsers.has(authorId)) {
        warnedUsers.add(authorId);
        const warningReply = `Sorry but I cannot answer those questions, if you continue asking me that I will call over a staff member to mute you.` + SAFETY_DISCLAIMER;
        addToMemory(channelId, 'model', warningReply);
        await message.reply(warningReply);
        return;
      } else {
        try {
          await message.channel.setName('🟠-staff-needed');
        } catch (e) {}

        const punishMessage = 
          `🚨 **Staff Escalation - Rule Violation Detected!**\n` +
          `**Attention:** @everyone\n\n` +
          `📋 **Reason:** User persisted in asking prohibited/racist questions after a warning.` +
          SAFETY_DISCLAIMER;

        const sentPunishMsg = await message.reply(punishMessage);

        setTimeout(async () => {
          try {
            await sentPunishMsg.delete();
          } catch (e) {}
        }, 15000);

        return;
      }
    }

    addToMemory(channelId, 'model', replyText);

    const fullReply = `${replyText}${SAFETY_DISCLAIMER}`;

    if (fullReply.length > 2000) {
      await message.reply(fullReply.substring(0, 1995) + '...');
    } else {
      await message.reply(fullReply);
    }

  } catch (error) {}
});

client.login(process.env.DISCORD_TOKEN);
