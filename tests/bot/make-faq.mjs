// Regenerates supabase/functions/telegram-webhook/faq.ts from docs/FAQ.md (run from the repo root).
import fs from 'node:fs'
const md = fs.readFileSync('docs/FAQ.md', 'utf8').replace(/\n---\n\n## 📞 Контакты[\s\S]*$/, '\n').trim()
fs.writeFileSync('supabase/functions/telegram-webhook/faq.ts',
  '// Generated from docs/FAQ.md (edit there, then: node tests/bot/make-faq.mjs). The guest agent answers from it.\nexport const FAQ = ' + JSON.stringify(md) + '\n')
