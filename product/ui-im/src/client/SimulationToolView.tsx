/** Simulation Tool calls keep their durable inputs and results inside an explicit isolated-channel card. */
import type { Context } from '@deepseek-ai/cordis'
import type { ToolCallBlock } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { ReactElement } from 'react'
import type { ImKey } from './locales.ts'
import { NS } from './locales.ts'
import css from './SimulationToolView.module.css'

/** Wire names installed by the IM simulation Tool consumer. */
export const SIMULATION_TOOL_NAMES = [
  'im_sim_create',
  'im_sim_send_as_member',
  'im_sim_send_as_managed_human',
  'im_sim_stop',
] as const

type SimulationToolName = typeof SIMULATION_TOOL_NAMES[number]

const TITLES = {
  im_sim_create: 'simulationToolCreate',
  im_sim_send_as_member: 'simulationToolSendMember',
  im_sim_send_as_managed_human: 'simulationToolSendManagedHuman',
  im_sim_stop: 'simulationToolStop',
} as const satisfies Record<SimulationToolName, ImKey>

const ISOLATION_COPY = {
  im_sim_create: 'simulationToolIsolationCreate',
  im_sim_send_as_member: 'simulationToolIsolationSend',
  im_sim_send_as_managed_human: 'simulationToolIsolationSend',
  im_sim_stop: 'simulationToolIsolationStop',
} as const satisfies Record<SimulationToolName, ImKey>

type Translate = (key: ImKey, fields?: Readonly<Record<string, string | number>>) => string

/** Props consumed from the public atomic Tool-view owner and this product's locale seat. */
export interface SimulationToolViewProps {
  readonly toolName: string
  readonly block: ToolCallBlock
  readonly t: Translate
}

interface OptionalToolSlotRegistry {
  inject(name: 'tool.call.toolview', callback: () => Iterable<() => void>): () => void
  register(
    options: { readonly name: 'tool.call.toolview'; readonly key: string; readonly locale: typeof NS },
    component: (props: SimulationToolViewProps) => ReactElement,
  ): () => void
}

function simulationToolName(name: string): SimulationToolName {
  if ((SIMULATION_TOOL_NAMES as readonly string[]).includes(name)) return name as SimulationToolName
  throw new Error(`unsupported IM simulation Tool view ${JSON.stringify(name)}`)
}

function argumentsRaw(block: ToolCallBlock): string {
  return 'kind' in block ? block.call?.argsRaw ?? '' : block.argsRaw
}

function formatArguments(raw: string): string {
  if (raw === '') return '{}'
  try {
    return JSON.stringify(JSON.parse(raw), null, 2)
  } catch {
    // A streaming call may expose incomplete JSON; the durable raw text is still the truthful input.
    return raw
  }
}

function formatResult(block: ToolCallBlock): string | undefined {
  if (!('kind' in block)) return undefined
  return block.content.map(item => item.type === 'text' ? item.text : JSON.stringify(item, null, 2)).join('\n')
}

/** @param props - frozen Tool call slice and localized copy. @returns isolated simulation Tool disclosure. */
export function SimulationToolView({ toolName, block, t }: SimulationToolViewProps): ReactElement {
  const name = simulationToolName(toolName)
  const result = formatResult(block)
  const failed = 'kind' in block && block.isError
  return <details className={css.root} data-im-simulation-tool={name}>
    <summary className={css.summary}>
      <span className={css.badge}>{t('simulationToolBadge')}</span>
      <span className={css.title}>{t(TITLES[name])}</span>
      <span className={failed ? css.failed : css.status}>{t(!('kind' in block) ? 'simulationToolRunning' : failed ? 'simulationToolFailed' : 'simulationToolComplete')}</span>
    </summary>
    <p className={css.isolation}>{t(ISOLATION_COPY[name])}</p>
    <div className={css.section}>
      <span className={css.label}>{t('simulationToolInput')}</span>
      <pre>{formatArguments(argumentsRaw(block))}</pre>
    </div>
    <div className={css.section}>
      <span className={css.label}>{t('simulationToolResult')}</span>
      <pre>{result === undefined || result === '' ? t(result === undefined ? 'simulationToolPending' : 'simulationToolEmptyResult') : result}</pre>
    </div>
  </details>
}

/** Register cards only while the public Tool-view slot is present in the composition. */
export function registerSimulationToolViews(ctx: Context): void {
  // The optional Tool package owns this public slot declaration. A narrow structural
  // adapter keeps ui-im loadable in compositions without that presentation package.
  const slots = ctx.slots as unknown as OptionalToolSlotRegistry
  slots.inject('tool.call.toolview', function* () {
    for (const key of SIMULATION_TOOL_NAMES) {
      yield slots.register({ name: 'tool.call.toolview', key, locale: NS }, SimulationToolView)
    }
  })
}
