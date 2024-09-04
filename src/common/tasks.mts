import { ExtContextData } from "./context.mts";
import { HierarchyEntry } from "./hierarchy.mts";

export type TaskId = number;

export type Task = HierarchyEntry & {
    id: TaskId,
    isTask: true,
    // source: schedule.tasks[taskId],
    isFuture: boolean,
    blockedAt: number[], // TODO: blockedRanges: [], ?
};

/**
 * Reads the given task from the annotated schedule.
 */
export function readTask(ctx: ExtContextData, taskId: number): Task {
    const {created_by, first_step, name} = ctx.source.tasks[taskId];
    const task: Task = {
        id: taskId,
        // source: schedule.tasks[taskId],
        name,
        isTask: true,
        isFuture: false,
        createEvent: null,
        createdBy: created_by,
        createdAt: first_step,
        firstStep: first_step,
        lastStep: ctx.source.events.length - 1, // last_step,
        children: [],
        path: [0],
        flatIndex: 0,
        visibleIndex: 0,
        depth: 0,
        events: [],
        blockedAt: [], // TODO: blockedRanges: [], ?
        open: true,
        visible: true,
    };

    // `created_by === taskId` only for the initial/main thread. Otherwise,
    // this task was created by another.
    if (created_by !== taskId) {
        ctx.tasks[created_by].children.push(task);
        task.path = ctx.tasks[created_by].path.concat([taskId]);
    }

    return task;
}
