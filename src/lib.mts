import {
    createContextData,
    createContextHierarchy,
    createContextFilters,
    ExtContextData,
    ExtContextHierarchy,
    ExtContextFilters,
} from "./common/context.mts";
import { Event, EventId } from "./common/events.mts";
import { Object, ObjectId } from "./common/objects.mts";
import { Task, TaskId } from "./common/tasks.mts";
import {
    Schedule,
} from "./common/schedule.mts";

export class ShuttleContext {
    constructor(
        private _ctxData: ExtContextData,
        private _ctxHierarchy: ExtContextHierarchy,
        private _ctxFilters: ExtContextFilters,
    ) {

    }

    public getEvent(id: EventId): Event {
        return this._ctxData.events[id];
    }

    public getTask(id: TaskId): Task {
        return this._ctxData.tasks[id];
    }

    public getObject(id: ObjectId): Object {
        return this._ctxData.objects[id];
    }
}

export function loadAnnotatedSchedule(dataRaw: Uint8Array | string): ShuttleContext | null {
    const data: string = dataRaw instanceof Uint8Array
        ? new TextDecoder("utf-8").decode(dataRaw)
        : dataRaw;
    const schedule: Schedule = JSON.parse(data);
    const ctxData = createContextData(schedule);
    const ctxHierarchy = createContextHierarchy(ctxData);
    const ctxFilters = createContextFilters(ctxData);
    return new ShuttleContext(ctxData, ctxHierarchy, ctxFilters);
}
