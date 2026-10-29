import { describe, expect, expectTypeOf, it } from 'vitest';
import type {
  StageActionLaunch,
  TaskLaunchContext,
} from '@/services/tasks/types';

describe('task public API types', () => {
  it('uses an exact launch context contract', () => {
    expectTypeOf<StageActionLaunch['context']>().toEqualTypeOf<TaskLaunchContext>();
    expect(true).toBe(true);
  });
});
