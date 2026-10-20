require('dotenv').config();
const { Client, GatewayIntentBits, Events } = require('discord.js');
const { GoogleGenAI } = require('@google/genai');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

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

Be helpful, friendly, and concise. If you cannot solve a problem, suggest escalating to staff.
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

async function callGemini(promptText, retries = 3) {
  for (let i = 0; i < retries; i++) {
    try {
      const response = await ai.models.generateContent({
        model: 'gemini-3.8-flash',
        contents: promptText,
      });
      return response.text.trim();
    } catch (error) {
      const is503 = error.status === 503 || (error.message && error.message.includes('503'));
      if (is503 && i < retries - 1) {
        await new Promise(resolve => setTimeout(resolve, 2000));
        continue;
      }
      throw error;
    }
  }
}

client.once(Events.ClientReady, () => {
  console.log(`🤖 Pixelix Ticket Bot active as ${client.user.tag}!`);
});

client.on('messageCreate', async (message) => {
  if (message.author.bot) return;

  // STRICTLY ONLY ALLOW TALKING IN TICKET CHANNELS
  if (!message.channel.name.startsWith('ticket-') && !message.channel.name.includes('bot-is-doing-it')) {
    return;
  }

  const channelId = message.channel.id;
  const authorId = message.author.id;
  const content = message.content.trim();

  // Introduce bot and send guide upon ticket creation (first message)
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

    await message.channel.send(introMessage);
  }

  addToMemory(channelId, 'user', `${message.author.username}: ${content}`);

  // Auto-rename channel
  if (!message.channel.name.includes('bot-is-doing-it')) {
    try {
      await message.channel.setName('🟢-bot-is-doing-it');
    } catch (err) {
      console.error('Failed to rename channel:', err.message);
    }
  }

  // Escalation detection
  const lowerMsg = content.toLowerCase();
  const isOwnerReq = lowerMsg.includes('i require an owner');
  const isManagerReq = lowerMsg.includes('i require a manager');
  const isStaffReq = lowerMsg.includes('require staff') || lowerMsg.includes('i require staff') || lowerMsg.includes('need staff');

  if (isOwnerReq || isManagerReq || isStaffReq) {
    await message.channel.sendTyping();

    const history = ticketMemories.get(channelId) || [];
    const conversationLog = history.map(h => h.text).join('\n');

    let summaryRecap = "No prior messages recorded.";
    try {
      summaryRecap = await callGemini(`Summarize the following ticket conversation into a short 2-3 sentence recap for staff members:\n\n${conversationLog}`);
    } catch (err) {
      console.error('Error generating summary:', err);
    }

    let pings = [];
    if (isOwnerReq) {
      pings.push('<@1456243008570654751>');
    }
    if (isManagerReq) {
      pings.push('<@683984183160471552>', '@bubbly4life');
    }
    if (isStaffReq) {
      pings.push('@everyone');
    }

    const escalationMessage = 
      `🚨 **Staff Escalation Requested!**\n` +
      `**Attention:** ${pings.join(' ')}\n\n` +
      `📋 **Ticket Summary / Recap:**\n> ${summaryRecap.replace(/\n/g, '\n> ')}` +
      SAFETY_DISCLAIMER;

    const sentMsg = await message.reply(escalationMessage);

    // Auto-delete escalation ping message after 10 seconds to keep ticket clean
    setTimeout(async () => {
      try {
        await sentMsg.delete();
      } catch (e) {}
    }, 10000);

    return;
  }

  // AI General Answer & Safety Moderation Check
  await message.channel.sendTyping();

  try {
    const history = ticketMemories.get(channelId) || [];
    const formattedHistory = history.map(h => `${h.role === 'user' ? 'User' : 'Assistant'}: ${h.text}`).join('\n');

    const safetyCheckPrompt = `
    Analyze the following user input: "${content}"
    Does this input contain hate speech, racism, severe toxicity, or violations of community rules? 
    Reply with ONLY ONE WORD: "YES" or "NO".
    `;

    const safetyCheckText = await callGemini(safetyCheckPrompt);
    const isViolating = safetyCheckText.toUpperCase().includes('YES');

    if (isViolating) {
      if (!warnedUsers.has(authorId)) {
        warnedUsers.add(authorId);
        const warningReply = `Sorry but I cannot answer those questions, if you continue asking me that I will call over a staff member to mute you.` + SAFETY_DISCLAIMER;
        addToMemory(channelId, 'model', warningReply);
        await message.reply(warningReply);
        return;
      } else {
        const historyLog = ticketMemories.get(channelId) || [];
        const logText = historyLog.map(h => h.text).join('\n');

        let summaryRecap = "User continued asking inappropriate/racist questions.";
        try {
          summaryRecap = await callGemini(`Summarize this inappropriate behavior briefly:\n\n${logText}`);
        } catch (e) {}

        const punishMessage = 
          `🚨 **Staff Escalation - Rule Violation Detected!**\n` +
          `**Attention:** @everyone\n\n` +
          `📋 **Reason:** User persisted in asking prohibited/racist questions after a warning.\n` +
          `**Ticket Recap:**\n> ${summaryRecap.replace(/\n/g, '\n> ')}` +
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

    // Normal General Knowledge AI Answer
    const prompt = `${SYSTEM_INSTRUCTION}\n\nPrevious Ticket Conversation:\n${formattedHistory}\n\nPlease respond to the user's latest request in a friendly, helpful way using your general knowledge.`;

    const replyText = await callGemini(prompt);
    addToMemory(channelId, 'model', replyText);

    const fullReply = `${replyText}${SAFETY_DISCLAIMER}`;

    if (fullReply.length > 2000) {
      await message.reply(fullReply.substring(0, 1995) + '...');
    } else {
      await message.reply(fullReply);
    }

  } catch (error) {
    console.error('Error generating response:', error);
    await message.reply(`⚠️ The AI model is currently experiencing heavy traffic. Please try sending your message again in a few seconds, or type \`I require staff\` to call a team member.${SAFETY_DISCLAIMER}`);
  }
});

client.login(process.env.DISCORD_TOKEN);
