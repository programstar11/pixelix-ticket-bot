require('dotenv').config();
const { Client, GatewayIntentBits } = require('discord.js');
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
You have general knowledge about Minecraft, technical troubleshooting, and general Discord server support.

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

const SAFETY_DISCLAIMER = "🤖 *I’m an automatic discord bot made by ProgramStar I’m not a real human.*";

const ticketMemories = new Map();
const greetedChannels = new Set();

function addToMemory(channelId, role, text) {
  if (!ticketMemories.has(channelId)) {
    ticketMemories.set(channelId, []);
  }
  ticketMemories.get(channelId).push({ role, text });
}

client.once('ready', () => {
  console.log(`🤖 Pixelix Ticket Bot active as ${client.user.tag}!`);
});

client.on('messageCreate', async (message) => {
  if (message.author.bot) return;

  if (!message.channel.name.startsWith('ticket-') && !message.channel.name.includes('bot-is-doing-it')) {
    return;
  }

  const channelId = message.channel.id;
  const content = message.content.trim();

  // Send Welcome Guide on first message in a ticket
  if (!greetedChannels.has(channelId)) {
    greetedChannels.add(channelId);
    
    const guideMessage = 
      `${SAFETY_DISCLAIMER}\n\n` +
      `👋 **Welcome to Pixelix Support!**\n` +
      `I am here to answer your questions automatically.\n\n` +
      `📌 **Need human staff assistance? Type any of these exact phrases:**\n` +
      `• \`I require an owner\` — Pings the Server Owner\n` +
      `• \`I require a manager\` — Pings Managers (<@683984183160471552> & @bubbly4life)\n` +
      `• \`I require staff\` — Pings all staff members (@everyone)\n\n` +
      `*When you ping staff, I will automatically send them a short recap of our conversation!*`;

    await message.channel.send(guideMessage);
  }

  addToMemory(channelId, 'user', `${message.author.username}: ${content}`);

  // Rename channel
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
      const summaryResponse = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: `Summarize the following ticket conversation into a short 2-3 sentence recap for staff members:\n\n${conversationLog}`,
      });
      summaryRecap = summaryResponse.text.trim();
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
      `${SAFETY_DISCLAIMER}\n\n` +
      `🚨 **Staff Escalation Requested!**\n` +
      `**Attention:** ${pings.join(' ')}\n\n` +
      `📋 **Ticket Summary / Recap:**\n> ${summaryRecap.replace(/\n/g, '\n> ')}`;

    await message.reply(escalationMessage);
    return;
  }

  // AI Response
  await message.channel.sendTyping();

  try {
    const history = ticketMemories.get(channelId) || [];
    const formattedHistory = history.map(h => `${h.role === 'user' ? 'User' : 'Assistant'}: ${h.text}`).join('\n');

    const prompt = `${SYSTEM_INSTRUCTION}\n\nPrevious Ticket Conversation:\n${formattedHistory}\n\nPlease respond to the user's latest request in a friendly, helpful way.`;

    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: prompt,
    });

    const replyText = response.text.trim();
    addToMemory(channelId, 'model', replyText);

    const fullReply = `${SAFETY_DISCLAIMER}\n\n${replyText}`;

    if (fullReply.length > 2000) {
      await message.reply(fullReply.substring(0, 1995) + '...');
    } else {
      await message.reply(fullReply);
    }

  } catch (error) {
    console.error('Error generating response:', error);
    await message.reply(`${SAFETY_DISCLAIMER}\n\nAn error occurred while processing your request. Type \`I require staff\` to call a team member.`);
  }
});

client.login(process.env.DISCORD_TOKEN);