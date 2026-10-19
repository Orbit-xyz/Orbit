const EventEmitter = require('events');

/**
 * Real-time event bus supporting Redis Pub/Sub with automatic in-memory fallback.
 * Broadcasts backend lifecycle events:
 * - subscriptionCreated(merchantId)
 * - paymentSettled(merchantId)
 * - vaultCancelled(merchantId)
 */
class EventBus {
    constructor({ redisUrl, pubClient, subClient, logger = console } = {}) {
        this.logger = logger;
        this.emitter = new EventEmitter();
        this.emitter.setMaxListeners(200);
        this.redisUrl = redisUrl || process.env.REDIS_URL || null;
        this.pub = pubClient || null;
        this.sub = subClient || null;
        this.subscribedChannels = new Set();
        this.isClosed = false;
        this._initRedis();
    }

    _initRedis() {
        if (!this.redisUrl && !this.pub && !this.sub) {
            return;
        }

        try {
            const Redis = require('ioredis');
            if (!this.pub && this.redisUrl) {
                this.pub = new Redis(this.redisUrl, {
                    enableOfflineQueue: false,
                    maxRetriesPerRequest: 1,
                    lazyConnect: false,
                });
                this.pub.on('error', (err) => {
                    this.logger.error?.(`Redis Pub error: ${err.message}`);
                });
                this.pub.unref?.();
            }

            if (!this.sub && this.redisUrl) {
                this.sub = new Redis(this.redisUrl, {
                    enableOfflineQueue: false,
                    maxRetriesPerRequest: 1,
                    lazyConnect: false,
                });
                this.sub.on('error', (err) => {
                    this.logger.error?.(`Redis Sub error: ${err.message}`);
                });
                this.sub.unref?.();
            }

            if (this.sub) {
                this.sub.on('message', (channel, message) => {
                    try {
                        const parsed = JSON.parse(message);
                        this.emitter.emit(channel, parsed);
                        this.emitter.emit('message', { channel, data: parsed });
                    } catch (err) {
                        this.logger.error?.('Failed to parse Redis Pub/Sub message:', err);
                    }
                });
            }
        } catch (err) {
            this.logger.error?.('Failed to initialize Redis Pub/Sub clients:', err.message);
        }
    }

    async publish(channel, data) {
        if (this.isClosed) return;
        // Broadcast locally first for zero-latency in-process dispatch
        this.emitter.emit(channel, data);
        this.emitter.emit('message', { channel, data });

        if (this.pub) {
            try {
                await this.pub.publish(channel, JSON.stringify(data));
            } catch (err) {
                this.logger.error?.(`Redis publish failed for channel ${channel}: ${err.message}`);
            }
        }
    }

    async subscribe(channel, callback) {
        if (this.isClosed) return () => {};
        this.emitter.on(channel, callback);

        if (this.sub && !this.subscribedChannels.has(channel)) {
            this.subscribedChannels.add(channel);
            try {
                await this.sub.subscribe(channel);
            } catch (err) {
                this.logger.error?.(`Redis subscribe failed for channel ${channel}: ${err.message}`);
            }
        }

        return async () => {
            this.emitter.off(channel, callback);
            if (this.sub && this.emitter.listenerCount(channel) === 0) {
                this.subscribedChannels.delete(channel);
                try {
                    await this.sub.unsubscribe(channel);
                } catch (err) {
                    this.logger.error?.(`Redis unsubscribe failed for channel ${channel}: ${err.message}`);
                }
            }
        };
    }

    /**
     * Publishes a subscriptionCreated event
     */
    async publishSubscriptionCreated(merchantId, payload = {}) {
        const event = {
            eventType: 'subscriptionCreated',
            merchantId,
            timestamp: new Date().toISOString(),
            ...payload,
        };
        await this.publish(`orbit:merchant:${merchantId}`, event);
        await this.publish(`orbit:events:subscriptionCreated`, event);
        await this.publish(`orbit:events:all`, event);
        return event;
    }

    /**
     * Publishes a paymentSettled event
     */
    async publishPaymentSettled(merchantId, payload = {}) {
        const event = {
            eventType: 'paymentSettled',
            merchantId,
            timestamp: new Date().toISOString(),
            ...payload,
        };
        await this.publish(`orbit:merchant:${merchantId}`, event);
        await this.publish(`orbit:events:paymentSettled`, event);
        await this.publish(`orbit:events:all`, event);
        return event;
    }

    /**
     * Publishes a vaultCancelled event
     */
    async publishVaultCancelled(merchantId, payload = {}) {
        const event = {
            eventType: 'vaultCancelled',
            merchantId,
            timestamp: new Date().toISOString(),
            ...payload,
        };
        await this.publish(`orbit:merchant:${merchantId}`, event);
        await this.publish(`orbit:events:vaultCancelled`, event);
        await this.publish(`orbit:events:all`, event);
        return event;
    }

    /**
     * Creates an AsyncIterator conforming to GraphQL subscription execution
     */
    createAsyncIterator(channels, { filter = null } = {}) {
        const queue = [];
        let listening = true;
        let notify = null;

        const handler = (data) => {
            if (!listening) return;
            if (filter && !filter(data)) return;
            queue.push(data);
            if (notify) {
                const fn = notify;
                notify = null;
                fn();
            }
        };

        const channelList = Array.isArray(channels) ? channels : [channels];
        const unsubs = [];
        for (const ch of channelList) {
            unsubs.push(this.subscribe(ch, handler));
        }

        return {
            [Symbol.asyncIterator]() {
                return this;
            },
            async next() {
                while (listening) {
                    if (queue.length > 0) {
                        return { value: queue.shift(), done: false };
                    }
                    await new Promise((resolve) => {
                        notify = resolve;
                    });
                }
                return { value: undefined, done: true };
            },
            async return() {
                listening = false;
                for (const unsub of unsubs) {
                    if (typeof unsub === 'function') unsub();
                    else if (unsub && typeof unsub.then === 'function') unsub.then((f) => typeof f === 'function' && f());
                }
                if (notify) {
                    const fn = notify;
                    notify = null;
                    fn();
                }
                return { value: undefined, done: true };
            },
            async throw(err) {
                listening = false;
                for (const unsub of unsubs) {
                    if (typeof unsub === 'function') unsub();
                    else if (unsub && typeof unsub.then === 'function') unsub.then((f) => typeof f === 'function' && f());
                }
                if (notify) {
                    const fn = notify;
                    notify = null;
                    fn();
                }
                throw err;
            },
        };
    }

    async close() {
        this.isClosed = true;
        if (this.pub && typeof this.pub.quit === 'function') {
            await this.pub.quit().catch(() => {});
        }
        if (this.sub && typeof this.sub.quit === 'function') {
            await this.sub.quit().catch(() => {});
        }
        this.emitter.removeAllListeners();
    }
}

const createEventBus = (options = {}) => new EventBus(options);

module.exports = {
    EventBus,
    createEventBus,
};
