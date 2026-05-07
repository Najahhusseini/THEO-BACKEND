import { EventEmitter } from 'events'

class TenantEventBus {
  private emitters: Map<string, EventEmitter> = new Map()
  private globalEmitter = new EventEmitter()

  private getEmitter(tenantId: string): EventEmitter {
    if (tenantId === '*') return this.globalEmitter
    if (!this.emitters.has(tenantId)) {
      this.emitters.set(tenantId, new EventEmitter())
    }
    return this.emitters.get(tenantId)!
  }

  emit(tenantId: string, event: string, payload: any): void {
    // Emit to the specific tenant
    this.getEmitter(tenantId).emit(event, payload)
    // Also emit to all global listeners (audit, notification dispatchers)
    this.globalEmitter.emit(event, payload)
  }

  on(tenantId: string, event: string, listener: (payload: any) => void): () => void {
    const emitter = this.getEmitter(tenantId)
    emitter.on(event, listener)
    return () => emitter.off(event, listener)
  }
}

export const eventBus = new TenantEventBus()