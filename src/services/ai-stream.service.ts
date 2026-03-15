import { EventEmitter } from 'events';

export type AiStreamEventType =
    | 'status'
    | 'delta'
    | 'sources'
    | 'reasoning_summary'
    | 'thought_delta'
    | 'answer_delta'
    | 'tool_trace'
    | 'done'
    | 'error';

export type AiStreamEvent = {
    type: AiStreamEventType;
    payload: Record<string, unknown>;
    createdAt: string;
};

class AiStreamService {
    private readonly emitter = new EventEmitter();

    constructor() {
        this.emitter.setMaxListeners(0);
    }

    publish(jobId: string, type: AiStreamEventType, payload: Record<string, unknown>): AiStreamEvent {
        const event: AiStreamEvent = {
            type,
            payload,
            createdAt: new Date().toISOString()
        };
        this.emitter.emit(jobId, event);
        return event;
    }

    subscribe(jobId: string, handler: (event: AiStreamEvent) => void): () => void {
        this.emitter.on(jobId, handler);
        return () => this.emitter.off(jobId, handler);
    }
}

export const aiStreamService = new AiStreamService();
