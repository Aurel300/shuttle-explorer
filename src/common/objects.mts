import { ExtContextData } from "./context.mts";
import { HierarchyEntry } from "./hierarchy.mts";

export type ObjectId = number;

export type Object = HierarchyEntry & {
    id: ObjectId,
    isTask: false,
    // source: schedule.objects[objectId],
    seenBy: Map<number, boolean>,
    kind: string | null,
};

/**
 * Reads the given object from the annotated schedule.
 */
export function readObject(ctx: ExtContextData, objectId: number): Object {
    const {created_by, created_at, name, kind} = ctx.source.objects[objectId];
    const object: Object = {
        id: objectId,
        isTask: false,
        // source: ctx.source.objects[objectId],
        name,
        kind,
        createEvent: null,
        createdBy: created_by,
        firstStep: created_at,
        createdAt: created_at,
        lastStep: ctx.source.events.length - 1,
        seenBy: new Map(),
        children: [],
        path: [],
        flatIndex: 0,
        visibleIndex: 0,
        depth: 0,
        events: [],
        open: true,
        visible: true,
    };
    return object;
}
