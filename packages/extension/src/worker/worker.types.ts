import { type PartContext } from '../context/context.js';
import { type Schedule } from './scheduler.js';

// A worker's ctx: create(ctx) registers its jobs; the kit starts, overlaps and records them.
export interface WorkerContext extends PartContext {
  readonly schedule: Schedule;
}
