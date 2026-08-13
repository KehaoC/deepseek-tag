/** Browser half: dedicated settings section and credential-safe form. */

import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import { SETTINGS_NAMESPACE, type DeepseekTagSettings } from '../contract.js'
import { TagSettingsSection, type TagSettingsInjected } from './SettingsSection.js'
import { TagSettingsController } from './controller.js'
import { en, LOCALE_NAMESPACE, zh } from './locales.js'
import { adoptStyles } from './styles.js'

/** Required browser services supplied by the Harness Web composition. */
export const inject = ['slots', 'locale', 'connection', 'remote', 'settingsScope']

/** Mount the live settings scope, safe credential status, and settings page. */
export function apply(ctx: ClientContext): void {
  const { api } = ctx.get('connection') as ConnectionHandle
  const scope = ctx.settingsScope.bind<DeepseekTagSettings>({ namespace: SETTINGS_NAMESPACE })
  const controller = new TagSettingsController(scope, api)
  const t = ctx.locale.bind(LOCALE_NAMESPACE)

  ctx.effect(() => ctx.locale.register(LOCALE_NAMESPACE, { zh, en }), 'deepseek-tag: dictionaries')
  ctx.effect(adoptStyles, 'deepseek-tag: settings styles')
  ctx.effect(() => {
    const offCredential = ctx.remote.$on('credentials/updated', (ref) => {
      if (ref === controller.credential.getSnapshot().ref) void controller.refreshCredential(ref)
    })
    const offReset = ctx.on('connection/reset', () => { void controller.refreshCredential() })
    return () => { offCredential(); offReset() }
  }, 'deepseek-tag: credential status')

  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'deepseek-tag',
    order: 35,
    label: () => t('nav'),
    locale: LOCALE_NAMESPACE,
    inject: (): TagSettingsInjected => ({
      hooks: { tagSettings: scope, credential: controller.credential },
      save: (form, secret) => controller.save(form, secret),
    }),
  }, TagSettingsSection))
}
