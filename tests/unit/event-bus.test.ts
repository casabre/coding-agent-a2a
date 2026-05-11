import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AgentEvent } from '../../src/adapters/base.js';

// Import a fresh instance for each test by re-importing the module
// The singleton `eventBus` is module-scoped, so we import it once and test its methods.
import { eventBus, type JobEvent } from '../../src/event-bus.js';

beforeEach(() => {
  eventBus.removeAllListeners();
});

const sampleEvent: AgentEvent = { kind: 'thinking', text: 'Hello' };

describe('EventBus', () => {
  describe('emitJobEvent', () => {
    it('triggers job:{id} listener with the event', () => {
      const handler = vi.fn();
      eventBus.onJobEvent('job-1', handler);
      eventBus.emitJobEvent('job-1', sampleEvent);
      expect(handler).toHaveBeenCalledWith(sampleEvent);
    });

    it('triggers job:* listener with jobId and event', () => {
      const handler = vi.fn();
      eventBus.onAllJobEvents(handler);
      eventBus.emitJobEvent('job-1', sampleEvent);
      const received: JobEvent = handler.mock.calls[0][0] as JobEvent;
      expect(received.jobId).toBe('job-1');
      expect(received.event).toEqual(sampleEvent);
    });

    it('triggers both job:{id} and job:* listeners', () => {
      const specific = vi.fn();
      const all = vi.fn();
      eventBus.onJobEvent('job-x', specific);
      eventBus.onAllJobEvents(all);
      eventBus.emitJobEvent('job-x', sampleEvent);
      expect(specific).toHaveBeenCalledTimes(1);
      expect(all).toHaveBeenCalledTimes(1);
    });
  });

  describe('onJobEvent unsubscribe', () => {
    it('returned function removes the listener', () => {
      const handler = vi.fn();
      const unsubscribe = eventBus.onJobEvent('job-2', handler);
      unsubscribe();
      eventBus.emitJobEvent('job-2', sampleEvent);
      expect(handler).not.toHaveBeenCalled();
    });
  });

  describe('onAllJobEvents unsubscribe', () => {
    it('returned function removes the listener', () => {
      const handler = vi.fn();
      const unsubscribe = eventBus.onAllJobEvents(handler);
      unsubscribe();
      eventBus.emitJobEvent('job-3', sampleEvent);
      expect(handler).not.toHaveBeenCalled();
    });
  });

  describe('cross-contamination', () => {
    it('job:{id} listener does not fire for a different jobId', () => {
      const handler1 = vi.fn();
      const handler2 = vi.fn();
      eventBus.onJobEvent('job-a', handler1);
      eventBus.onJobEvent('job-b', handler2);
      eventBus.emitJobEvent('job-a', sampleEvent);
      expect(handler1).toHaveBeenCalledTimes(1);
      expect(handler2).not.toHaveBeenCalled();
    });

    it('multiple events for same job are received in order', () => {
      const received: AgentEvent[] = [];
      eventBus.onJobEvent('job-c', (e) => received.push(e));
      const e1: AgentEvent = { kind: 'init' };
      const e2: AgentEvent = { kind: 'thinking', text: 'step' };
      const e3: AgentEvent = { kind: 'done', summary: 'done' };
      eventBus.emitJobEvent('job-c', e1);
      eventBus.emitJobEvent('job-c', e2);
      eventBus.emitJobEvent('job-c', e3);
      expect(received).toEqual([e1, e2, e3]);
    });
  });
});
