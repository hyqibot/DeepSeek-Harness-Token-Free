/** Shared Host-side channel state, pairing, and Agent dispatch. */

import { randomBytes } from 'node:crypto'
import { Context, Service } from '@deepseek-ai/cordis'
import { cordisChannelAgentFactory, type ChannelAgentFactory } from './channel-agent.ts'
import { PairingLimiter, type PairingCode } from './channel-pairing.ts'
import {
  attachPairingCode,
  dispatchChannelMessage,
  type ChannelInbound,
} from './channel-router.ts'
import {
  channelStatePath,
  emptyChannelState,
  readChannelState,
  writeChannelState,
  type ChannelState,
  type WechatAuth,
} from './channel-store.ts'
import type {} from './profile-service.ts'
import type {} from './runtime.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Generation-scoped IM pairing store and Agent dispatcher. */
    desktopChannels: DesktopChannels
  }
}

/** Listener invoked after the durable channel document changes. */
export type ChannelStateListener = (state: ChannelState) => void

/**
 * Own the profile-private channel document for one Cordis generation.
 * @param ctx - Host context providing the active profile directory.
 */
export class DesktopChannels extends Service {
  private state: ChannelState = emptyChannelState()
  private readonly limiter = new PairingLimiter()
  private readonly queues = new Map<string, Promise<void>>()
  private readonly listeners = new Set<ChannelStateListener>()
  private disposed = false
  private tail: Promise<void> = Promise.resolve()
  private readonly path: string
  private readonly cwd: string

  constructor(ctx: Context) {
    super(ctx, 'desktopChannels')
    this.path = channelStatePath(ctx.desktopProfiles.current.dir)
    this.cwd = ctx.desktopProfiles.current.dir
    ctx.effect(() => () => {
      this.disposed = true
      this.listeners.clear()
    }, 'dsh-plugin-desktop: channel service teardown')
  }

  /** Current durable document. */
  snapshot(): ChannelState {
    return this.state
  }

  /** Whether this generation has been disposed. */
  isDisposed(): boolean {
    return this.disposed
  }

  /**
   * Subscribe to document writes. Returns an unsubscribe function.
   * @param listener - called after a successful persist.
   */
  watch(listener: ChannelStateListener): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  /** Load the profile file, starting empty when it is missing. */
  load(): Promise<ChannelState> {
    return this.serialize(async () => {
      try {
        this.state = await readChannelState(this.path)
      } catch (cause) {
        this.ctx.logger.error('dsh-plugin-desktop: channel state was unreadable; starting empty')
        this.ctx.logger.error(cause)
        this.state = emptyChannelState()
      }
      return this.state
    })
  }

  /**
   * Replace the durable document.
   * @param next - complete next document.
   */
  persist(next: ChannelState): Promise<void> {
    return this.serialize(async () => {
      this.state = next
      try {
        await writeChannelState(this.path, next)
      } catch (cause) {
        this.ctx.logger.error('dsh-plugin-desktop: failed to persist channel state')
        this.ctx.logger.error(cause)
      }
      for (const listener of this.listeners) listener(this.state)
    })
  }

  private serialize<T>(work: () => Promise<T>): Promise<T> {
    const next = this.tail.then(work, work)
    this.tail = next.then(() => undefined, () => undefined)
    return next
  }

  /**
   * Mint a one-shot pairing code and persist it.
   * @param notify - when true, also post the code to a native notification.
   */
  async generatePairing(notify = true): Promise<PairingCode> {
    const attached = attachPairingCode(this.state)
    await this.persist(attached.state)
    if (notify) {
      this.ctx.desktopRuntime.updates.notify({
        title: 'DSH Desktop pairing code',
        body: attached.pairing.code,
      })
    }
    return attached.pairing
  }

  /**
   * Ensure a LAN bearer exists for the mobile PWA.
   * @returns the current bearer token.
   */
  async ensureMobileBearer(): Promise<string> {
    if (this.state.mobileBearer !== null) return this.state.mobileBearer
    const mobileBearer = randomBytes(24).toString('hex')
    await this.persist({ ...this.state, mobileBearer })
    return mobileBearer
  }

  /**
   * Store WeChat iLink credentials after QR confirmation.
   * @param auth - bot token, account id, and API origin.
   */
  async setWechatAuth(auth: WechatAuth | null): Promise<void> {
    await this.persist({ ...this.state, wechatAuth: auth })
  }

  /**
   * Serialize work per remote identity and dispatch one Agent turn.
   * @param inbound - remote identity and text.
   * @param reply - platform send callback.
   */
  enqueue(inbound: ChannelInbound, reply: (text: string) => Promise<void>): void {
    const key = `${inbound.platform}:${inbound.userId}`
    const previous = this.queues.get(key) ?? Promise.resolve()
    const next = previous.then(async () => {
      if (this.disposed) return
      const factory = await this.factoryOf()
      const dispatched = await dispatchChannelMessage(
        this.state,
        this.limiter,
        inbound,
        factory,
        this.cwd,
      )
      await this.persist(dispatched.state)
      if (!this.disposed) await reply(dispatched.reply)
    }, async () => {
      if (this.disposed) return
      const factory = await this.factoryOf()
      const dispatched = await dispatchChannelMessage(
        this.state,
        this.limiter,
        inbound,
        factory,
        this.cwd,
      )
      await this.persist(dispatched.state)
      if (!this.disposed) await reply(dispatched.reply)
    })
    this.queues.set(key, next)
  }

  private async factoryOf(): Promise<ChannelAgentFactory | undefined> {
    await this.ctx.get('loader')?.await()
    if (this.disposed) return undefined
    return cordisChannelAgentFactory(this.ctx)
  }
}
