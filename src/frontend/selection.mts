/**
 * Functions and types related to selections, i.e., clicking on a task, event,
 * or object in the timeline and the right panel displaying additional info.
 */

import * as d3 from "d3";

import { EventId } from "../common/events.mjs";
import { Object, ObjectId } from "../common/objects.mjs";
import { Task, TaskId } from "../common/tasks.mjs";
import { addFilter, ctx, ctxData, updateTimelineLinks, vscode } from "./dom.mjs";
import { filterByObject } from "../common/filters.mjs";

export type ExtContextDOMSelection = {
    eventId: EventId | null,
    taskId: TaskId | null,
    objectId: ObjectId | null,
};
export function createContextDOMSelection(): ExtContextDOMSelection {
    return {
        eventId: null,
        taskId: null,
        objectId: null,
    };
}

function selectEventImpl(eventId: EventId | null, sendMessage: boolean, openTab: boolean) {
    ctx!.timeline.events!
        .classed("selected", false);
    ctx!.selection.eventId = eventId;
    if (sendMessage) {
        vscode.postMessage({ type: "eventClick", data: eventId });
    }
    if (eventId !== null) {
        const event = ctxData!.events[eventId];

        const taskId = event.taskId;
        ctx!.timeline.events!
            .filter(({minData, maxData}) => minData.taskId === taskId && minData.id <= eventId && eventId <= maxData.id)
            .classed("selected", true);

        // select tab
        if (openTab) (d3.select(".panel-sidebar vscode-panels").node()! as any).activeid = "sidebar-tab-1";

        // fill in sidebar
        const infoRoot = d3.select("#sidebar-view-1")
            .classed("show-event", true)
            .select(".event-info");
        let infoKind = event.kind;
        /*
        switch (event.kind) {
            case "SemaphoreCreated": infoKind = "SemaphoreCreated"; break;
            case "SemaphoreClosed": infoKind = "SemaphoreClosed"; break;
            case "SemaphoreAcquireFast": infoKind = "SemaphoreAcquireFast"; break;
            case "SemaphoreAcquireBlocked": infoKind = "SemaphoreAcquireBlocked"; break;
            case "SemaphoreAcquireUnlocked": infoKind = "SemaphoreAcquireUnlocked"; break;
            case "SemaphoreTryAcquire": infoKind = "SemaphoreTryAcquire"; break;
            case "SemaphoreRelease": infoKind = "SemaphoreRelease"; break;
            case "Schedule": infoKind = "Schedule"; break;
            default: infoKind = "(unknown)";
        }
        */
        infoRoot.select(".event-info-kind").text(infoKind);
        infoRoot
            .select(".event-info-time")
            .html(`<vscode-link>Step ${event.id}</vscode-link> (${event.filtered ? "filtered" : `${event.keptIdx} after filters`})`)
            .select("vscode-link")
            .on("click", () => selectEvent(event.id, true));
        infoRoot
            .select(".event-info-task")
            .html(`<vscode-link>Task ${event.taskId}</vscode-link>`)
            .select("vscode-link")
            .on("click", () => selectTask(event.taskId, true));
        let rows = infoRoot.select(".event-info-backtrace")
            .selectAll("vscode-data-grid-row[row-type=\"default\"]")
            .data(event.backtrace ? event.backtrace : [])
            .join("vscode-data-grid-row")
                .attr("row-type", "default");
        rows.selectAll("vscode-data-grid-cell.col1")
            .data(d => [d])
            .join("vscode-data-grid-cell")
                .classed("col1", true)
                .attr("grid-column", "1")
                .html(({functionName}) => `<code>${functionName}</code>`);
        rows.selectAll("vscode-data-grid-cell.col2")
            .data(d => [d])
            .join("vscode-data-grid-cell")
                .classed("col2", true)
                .attr("grid-column", "2")
                .html(({path, line, col}) => `<code>${path}:${line}:${col}</code>`)
                .on("click", (_ev, {btId}) => vscode.postMessage({ type: "backtraceClick", data: [eventId, btId] }));
        // TODO: hide when there is no backtrace

        // show links
        switch (event.kind) {
            case "TaskCreated":
                if (event.data.taskId !== 0) {
                    ctx!.links.current.push({
                        source: event,
                        target: ctxData!.tasks[event.data.taskId],
                    });
                }
                break;
            case "SemaphoreCreated":
            case "SemaphoreClosed":
            case "SemaphoreAcquireFast":
            case "SemaphoreAcquireBlocked":
            case "SemaphoreAcquireUnblocked":
            case "SemaphoreTryAcquire":
            case "SemaphoreRelease":
                ctx!.links.current.push({
                    source: event,
                    target: ctxData!.objects[event.data.objectId],
                });
                break;
        }
        updateTimelineLinks();
    } else {
        d3.select("#sidebar-view-1").classed("show-event", false);
    }
}

function selectTaskImpl(taskId: TaskId | null, sendMessage: boolean, openTab: boolean) {
    ctx!.timeline.spans!
        .classed("selected", false);
    ctx!.selection.taskId = taskId;
    ctx!.timeline.spans!
        .filter(d => d.isTask && (d as Task).id === ctx!.selection.taskId)
        .classed("selected", true);
    if (sendMessage) {
        vscode.postMessage({ type: "taskClick", data: taskId });
    }
    if (taskId !== null) {
        // select tab
        if (openTab) (d3.select(".panel-sidebar vscode-panels").node()! as any).activeid = "sidebar-tab-1";

        // fill in sidebar
        const task = ctxData!.tasks[taskId];
        const infoRoot = d3.select("#sidebar-view-1")
            .classed("show-task", true)
            .select(".task-info");
        infoRoot.select(".task-info-id").text(taskId);
        infoRoot.select(".task-info-kind").text(task.isFuture ? "Future" : "Thread");
        infoRoot.select(".task-info-name").text(task.name !== null ? task.name : "-");
        if (task.id === 0) {
            infoRoot.select(".task-info-created").text("-");
        } else {
            const cell = infoRoot
                .select(".task-info-created")
                .html(`<vscode-link>Task ${task.createdBy}</vscode-link>, <vscode-link>Step ${task.createdAt}</vscode-link>`);
            cell.select("vscode-link:nth-of-type(1)")
                .on("click", () => selectTask(task.createdBy, true));
            cell.select("vscode-link:nth-of-type(2)")
                .on("click", () => selectEvent(task.createdAt, true));
        }
        infoRoot
            .select(".task-info-first")
            .html(`<vscode-link>Step ${task.firstStep}</vscode-link>`)
            .select("vscode-link")
            .on("click", () => selectEvent(task.firstStep, true));
        infoRoot
            .select(".task-info-last")
            .html(`<vscode-link>Step ${task.lastStep}</vscode-link>`)
            .select("vscode-link")
            .on("click", () => selectEvent(task.lastStep, true));

        // show links
        ctx!.links.current.push({
            source: task,
            target: task.createEvent!,
        });
        updateTimelineLinks();
    } else {
        d3.select("#sidebar-view-1").classed("show-task", false);
    }
}

function selectObjectImpl(objectId: ObjectId | null, sendMessage: boolean, openTab: boolean) {
    ctx!.timeline.spans!
        .classed("selected", false);
    ctx!.selection.objectId = objectId;
    ctx!.timeline.spans!
        .filter(d => !d.isTask && (d as Object).id === ctx!.selection.objectId)
        .classed("selected", true);
    if (sendMessage) {
        vscode.postMessage({ type: "objectClick", data: objectId });
    }
    if (objectId !== null) {
        // select tab
        if (openTab) (d3.select(".panel-sidebar vscode-panels").node()! as any).activeid = "sidebar-tab-1";

        // fill in sidebar
        const object = ctxData!.objects[objectId];
        const infoRoot = d3.select("#sidebar-view-1")
            .classed("show-object", true)
            .select(".object-info");
        infoRoot.select(".object-info-id").text(objectId);
        infoRoot.select(".object-info-kind").text(object.kind !== null ? object.kind : "Batch semaphore");
        infoRoot.select(".object-info-name").text(object.name !== null ? object.name : "-");
        const cell = infoRoot
            .select(".object-info-created")
            .html(`<vscode-link>Task ${object.createdBy}</vscode-link>, <vscode-link>Step ${object.firstStep}</vscode-link>`);
        cell.select("vscode-link:nth-of-type(1)")
            .on("click", () => selectTask(object.createdBy, true));
        cell.select("vscode-link:nth-of-type(2)")
            .on("click", () => selectEvent(object.firstStep, true)); // TODO: unnecessary?
        // TODO: object-info-seen
        infoRoot
            .select(".object-info-first")
            .html(`<vscode-link>Step ${object.firstStep}</vscode-link>`)
            .select("vscode-link")
            .on("click", () => selectEvent(object.firstStep, true));
        infoRoot
            .select(".object-info-last")
            .html(`<vscode-link>Step ${object.lastStep}</vscode-link>`)
            .select("vscode-link")
            .on("click", () => selectEvent(object.lastStep, true));

        // filter setup
        infoRoot.select(".object-create-filter")
            .on("click", () => {
                (d3.select(".panel-sidebar vscode-panels").node()! as any).activeid = "sidebar-tab-2";
                addFilter(filterByObject(ctxData!, objectId));
            });

        // show links
        ctx!.links.current.push({
            source: object,
            target: object.createEvent!,
        });
        updateTimelineLinks();
    } else {
        d3.select("#sidebar-view-1").classed("show-object", false);
    }
}

/**
 * Select the given event.
 * @param sendMessage Should the backend be notified?
 */
export function selectEvent(eventId: EventId, sendMessage: boolean) {
    deselect();
    selectEventImpl(eventId, sendMessage, true);
}

/**
 * Select the given task.
 * @param sendMessage Should the backend be notified?
 */
export function selectTask(taskId: TaskId, sendMessage: boolean) {
    deselect();
    selectTaskImpl(taskId, sendMessage, true);
}

/**
 * Select the given object.
 * @param sendMessage Should the backend be notified?
 */
export function selectObject(objectId: ObjectId, sendMessage: boolean) {
    deselect();
    selectObjectImpl(objectId, sendMessage, true);
}

/**
 * Make sure the same item is selected, e.g., after updating filters.
 */
export function reselect() {
    if (ctx!.selection.eventId !== null) selectEventImpl(ctx!.selection.eventId, false, false);
    if (ctx!.selection.taskId !== null) selectTaskImpl(ctx!.selection.taskId, false, false);
    if (ctx!.selection.objectId !== null) selectObjectImpl(ctx!.selection.objectId, false, false);
}

/**
 * Deselect the currently selected task, event, or object.
 */
export function deselect() {
    // remove links
    ctx!.links.current.length = 0;
    updateTimelineLinks();

    // deselect rects
    selectEventImpl(null, false, false);
    selectTaskImpl(null, false, false);
    selectObjectImpl(null, false, false);
}
