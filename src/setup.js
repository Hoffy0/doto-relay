import { select, input } from '@inquirer/prompts'
import { spawn } from 'child_process'
import { writeConfig, CONFIG_FILE } from './config.js'

export async function runSetup({ reexecIfCloud = false } = {}) {
  console.log('\n  doto — setup\n')

  const currentMode = process.env.DOTO_DB_URL ? 'cloud' : 'local'

  const mode = await select({
    message: 'Database mode?',
    default: currentMode,
    choices: [
      { name: 'Local — SQLite per project', value: 'local' },
      { name: 'Cloud — Supabase or any Postgres', value: 'cloud' },
    ]
  })

  if (mode === 'local') {
    writeConfig({})
    if (process.env.DOTO_DB_URL) {
      console.log('\nWarning: DOTO_DB_URL is exported in shell and will take precedence.')
    }
    console.log(`\nConfig saved to ${CONFIG_FILE}`)
    console.log('Mode: Local SQLite (one doto.db per project)\n')
    return
  }

  const url = await input({
    message: 'Connection string (postgresql://...):',
    default: process.env.DOTO_DB_URL ?? '',
    validate: (v) => {
      if (!v.startsWith('postgresql://') && !v.startsWith('postgres://')) {
        return 'Must start with postgresql:// or postgres://'
      }
      return true
    }
  })

  writeConfig({ DOTO_DB_URL: url })
  process.env.DOTO_DB_URL = url

  const masked = url.replace(/:([^:@]+)@/, ':***@')
  console.log(`\nConfig saved to ${CONFIG_FILE}`)
  console.log(`Mode: Postgres — ${masked}\n`)

  if (reexecIfCloud) {
    console.log('Restarting with new configuration...\n')
    // Re-exec so that db.js re-evaluates isPostgres with DOTO_DB_URL already set
    await new Promise(() => {
      const child = spawn(process.execPath, process.argv.slice(1), {
        stdio: 'inherit',
        env: process.env
      })
      child.on('exit', (code) => process.exit(code ?? 0))
    })
  }
}
