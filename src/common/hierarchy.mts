import { Event } from "./events.mts";
import { TaskId } from "./tasks.mts";

/**
 * An entry in the hierarchy display (left panel).
 */
export interface HierarchyEntry {
    /**
     * Display name, shown in the details panel, and in the hierarchy.
     */
    name: string | null,

    /**
     * Is this a task (`true`), or an object (`false`)?
     */
    isTask: boolean,

    /**
     * Is this entry currently visible? An entry may be hidden if its parent
     * is collapsed.
     */
    visible: boolean,

    /**
     * Index of this entry in the flattened hierarchy (obtained by a
     * depth-first flattening of the tree).
     */
    flatIndex: number,

    /**
     * Index of this entry among the currently visible entries. Collapsed
     * entries have the same visible index as the last visible entry.
     */
    visibleIndex: number,

    /**
     * How deep in the hierarchy is this entry? `0` for the root task.
     */
    depth: number,

    /**
     * Is the entry open (`true`) or collapsed (`false`)?
     */
    open: boolean,

    /**
     * Other entries that are shown as child nodes of this one.
     */
    children: HierarchyEntry[],

    /**
     * Sequence of task IDs, leading from the root to this entry.
     */
    path: number[],

    /**
     * First step that involves this entry.
     */
    firstStep: number,

    /**
     * Last step that involves this entry.
     */
    lastStep: number,

    /**
     * Events involing this entry.
     */
    events: Event[],

    /**
     * Which event created this entry? `null` for the root task.
     */
    createEvent: Event | null,

    /**
     * Which task created this entry?
     */
    createdBy: TaskId,

    /**
     * At what time was this entry created?
     */
    createdAt: number,
};
