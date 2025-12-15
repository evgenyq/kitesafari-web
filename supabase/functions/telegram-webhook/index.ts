import { corsHeaders } from '../_shared/cors.ts'

const BOT_TOKEN = Deno.env.get('TELEGRAM_BOT_TOKEN')!
const MINI_APP_URL = Deno.env.get('MINI_APP_URL') || 'https://evgenyq.github.io/kitesafari-web/'

interface TelegramUpdate {
  update_id: number
  message?: {
    message_id: number
    from: {
      id: number
      is_bot: boolean
      first_name: string
      username?: string
    }
    chat: {
      id: number
      type: string
    }
    date: number
    text?: string
  }
}

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: corsHeaders(req.headers.get('origin')),
    })
  }

  try {
    const update: TelegramUpdate = await req.json()
    console.log('Received update:', JSON.stringify(update, null, 2))

    const message = update.message
    if (!message?.text) {
      return new Response(JSON.stringify({ ok: true }), {
        headers: { 'Content-Type': 'application/json' },
      })
    }

    // Handle /start command with optional parameter
    if (message.text === '/start' || message.text.startsWith('/start')) {
      // Extract access code from /start access_code
      const parts = message.text.split(' ')
      const accessCode = parts.length > 1 ? parts[1] : null

      await sendMiniAppButton(message.chat.id, accessCode)
      return new Response(JSON.stringify({ ok: true }), {
        headers: { 'Content-Type': 'application/json' },
      })
    }

    // Ignore other messages
    return new Response(JSON.stringify({ ok: true }), {
      headers: { 'Content-Type': 'application/json' },
    })
  } catch (error) {
    console.error('Error processing update:', error)
    return new Response(
      JSON.stringify({ ok: false, error: String(error) }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }
    )
  }
})

async function sendMiniAppButton(chatId: number, accessCode: string | null) {
  // If access code provided, add it as URL parameter
  const url = accessCode ? `${MINI_APP_URL}?trip=${accessCode}` : MINI_APP_URL
  const text = accessCode
    ? `🏄 Добро пожаловать в KiteSafari!\n\n🎫 У вас есть доступ к новому трипу!\nНажмите кнопку чтобы открыть приложение:`
    : '🏄 Добро пожаловать в KiteSafari!\n\nВыберите трип и забронируйте каюту:'

  await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      reply_markup: {
        inline_keyboard: [
          [
            {
              text: '🏄 Открыть KiteSafari',
              web_app: { url },
            },
          ],
        ],
      },
    }),
  })
}
