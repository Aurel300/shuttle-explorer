import * as d3 from "d3";

import { ExtContextData, ExtContextFilters, ExtContextHierarchy } from "../common/context.mjs";
import { Filter, filterByCategory } from "../common/filters.mjs";
import { Event, eventCategories } from "../common/events.mjs";
import { Task } from "../common/tasks.mjs";
import { Object } from "../common/objects.mjs";
import { HierarchyEntry } from "../common/hierarchy.mjs";
import { createContextDOMSelection, deselect, ExtContextDOMSelection, reselect, selectEvent, selectObject, selectTask } from "./selection.mjs";
import { createContextDOMZoom, ExtContextDOMZoom, getZoomTrees, minEventWidth, updateClipHorizontal, updateZoomTrees, ZoomTree } from "./zoom.mjs";

// dimension constants
export const rowHeight = 17;
export const dimXTimeline = 100; // TODO: rename: leftPanelWidth?
export const marginTop = 20;

const minEventsOnScreen = 4;
const marginRight = 20;
const eventHeight = 13;
const depthOffset = 10;
const linkGen = d3.link(d3.curveBumpY);

export let vscode: any = null;
export let ctxData: ExtContextData | null = null;
export let ctxFilters: ExtContextFilters | null = null;
export let ctxHierarchy: ExtContextHierarchy | null = null;
export let ctx: ExtContextDOM | null = null;

export type ExtContextDOM = {
    width: number,
    height: number,
    root: d3.Selection<d3.BaseType, unknown, any, null>,
    timeline: {
        x: d3.ScaleLinear<number, number>,
        xScaled: d3.ScaleLinear<number, number>,
        xAxis: d3.Axis<d3.NumberValue>,
        xAxisEl: d3.Selection<SVGGElement, unknown, HTMLElement, null> | null,
        eventWidth: number,
        root: d3.Selection<d3.BaseType, unknown, any, null>,
        rows: d3.Selection<d3.BaseType, HierarchyEntry, d3.BaseType, null> | null,
        spans: d3.Selection<d3.BaseType, HierarchyEntry, d3.BaseType, HierarchyEntry> | null,
        events: d3.Selection<d3.BaseType, ZoomTree<Event>, d3.BaseType, HierarchyEntry> | null,
    },
    zoom: ExtContextDOMZoom,
    main: {
        root: d3.Selection<d3.BaseType, unknown, any, null>,
    },
    left: {
        root: d3.Selection<SVGSVGElement, unknown, HTMLElement, any>,
    },
    right: {
        scrollRoot: d3.Selection<HTMLDivElement, unknown, any, any>,
        root: d3.Selection<SVGSVGElement, unknown, HTMLElement, any>,
    },
    links: {
        current: {
            source: HierarchyEntry | Event,
            target: HierarchyEntry | Event,
        }[],
        root: d3.Selection<d3.BaseType, unknown, HTMLElement, any> | null,
        pathRoot: d3.Selection<SVGGElement, unknown, HTMLElement, null> | null,
        entryRoot: d3.Selection<SVGGElement, unknown, HTMLElement, null> | null,
    },
    selection: ExtContextDOMSelection,
};

/*
const LESS: Ordering = -1;
const EQUAL: Ordering = 0;
const GREATER: Ordering = 1;
type Ordering = -1 | 0 | 1;
function clockCmp(self: Event, other: Event): Ordering | null {
    function unify(a: Ordering, b: Ordering): Ordering | null {
        if (a === EQUAL && b === EQUAL) {
            return EQUAL;
        }
        if ((a === LESS && b === GREATER) || (a === GREATER && b === LESS)) {
            return null;
        }
        if (a === LESS || b === LESS) {
            return LESS;
        }
        if (a === GREATER || b === GREATER) {
            return GREATER;
        }
        // unreachable!
        return null;
    }
    const sclock = self.clock;
    const oclock = other.clock;
    if (sclock === null || oclock === null) {
        return null;
    }
    const sentries = sclock.length;
    const oentries = oclock.length;
    function cmp(a: number, b: number): Ordering {
        return a < b ? LESS : (a > b ? GREATER : EQUAL);
    }
    let ord: Ordering | null = cmp(sentries, oentries);
    for (let i = 0; i < Math.min(sentries, oentries); i++) {
        ord = unify(ord, cmp(sclock[i], oclock[i]));
        if (ord === null) return null;
    }
    return ord;
}
*/
function updateFilters() {
    // find position of events in causal graph (CDAG)
    // TODO: only do once

    // in the CDAG we want to organise events vertically into tasks (same as
    // for the timeline view), and horizontally according to causality, with
    // program order represented as the order of events in a lane, and causal
    // dependence shown as arrows

    // for each task, keep track of highest clock it has seen so far
    // at each step; there can be a bump to the clock for one of two reasons:
    // - the task itself has performed an observable step
    // - another task has performed an observable step, and the current task
    //   causally depends on that other task

    

    // for display purposes, the first one case is not relevant: the bump by
    // itself is only observable by the current task?

    // steps:
    // - for each event:
    //   . curr - current event
    //   . prev - previous event of this thread (if any)
    //   - 

    // re-number events based on filtered events
    let keptIdx = 0;
    let maxCdagIdx = 0;
    for (let event of ctxData!.events) {
        event.filtered = false;
        event.keptIdx = keptIdx;
        for (const filter of ctxFilters!.chain) {
            if (filter.enabled && !filter.check(filter.data, event)) {
                event.filtered = true;
                break;
            }
        }
        if (!event.filtered) {
            keptIdx++;
        }

        /*
        // figure out position in CDAG
        // TODO: extremely inefficient! only do once, and better
        event.cdagIdx = 0;
        for (let otherId = 0; otherId < event.id; otherId++) {
            const other = ctxData!.events[otherId];
            if (clockCmp(other, event) === LESS || other.taskId === event.taskId) {
                event.cdagIdx = Math.max(
                    event.cdagIdx,
                    other.cdagIdx + 1,
                );
            }
        }
        maxCdagIdx = Math.max(maxCdagIdx, event.cdagIdx);
        */
    }
    ctxFilters!.keptEvents = keptIdx;

    // update scale
    ctx!.timeline.x.domain([0, ctxFilters!.keptEvents]);
    //ctx!.timeline.x.domain([0, maxCdagIdx]);
    ctx!.timeline.eventWidth = ctx!.timeline.xScaled(1) - ctx!.timeline.xScaled(0);

    updateZoomTrees(ctxData!, ctxHierarchy!, ctxFilters!, ctx!);
}

function updateFilterList() {
    d3.select("#filters-user")
        .selectAll("vscode-checkbox")
        .data(ctxFilters!.chain.filter(({builtin}) => !builtin))
        .join("vscode-checkbox")
            .attr("checked", ({enabled}) => enabled)
            .html(({title, totalCount}) => `${title} <vscode-badge>${totalCount}</vscode-badge> <i class="codicon codicon-trash"></i>`)
            .on("change", (ev, filter) => {
                filter.enabled = ev.target.checked;
                updateFilters();
                reselect();
                const zoomToMinEvents = ctxFilters!.keptEvents / minEventsOnScreen;
                ctx!.zoom.zoom!.scaleExtent([1, Math.max(zoomToMinEvents, 1)]);
                updateZoom(null);
            })
            .select(".codicon-trash")
                .on("click", (_ev, filter) => {
                    const index = ctxFilters!.chain.indexOf(filter);
                    if (index !== -1) {
                        ctxFilters!.chain.splice(index, 1);
                        updateFilterList();
                        reselect();
                        const zoomToMinEvents = ctxFilters!.keptEvents / minEventsOnScreen;
                        ctx!.zoom.zoom!.scaleExtent([1, Math.max(zoomToMinEvents, 1)]);
                        updateZoom(null);
                    }
                });
    updateFilters();
}

export function addFilter(filter: Filter<any>) {
    let exists = false;
    for (let i = 0; i < ctxFilters!.chain.length; i++) {
        if (!filter.builtin && ctxFilters!.chain[i].title === filter.title) {
            exists = true;
            break;
        }
    }
    if (!exists) {
        ctxFilters!.chain.push(filter);
        // TODO: this is duplicated a couple of times, move into a function:
        updateFilterList();
        reselect();
        const zoomToMinEvents = ctxFilters!.keptEvents / minEventsOnScreen;
        ctx!.zoom.zoom!.scaleExtent([1, Math.max(zoomToMinEvents, 1)]);
        updateZoom(null);
    }
}

function updateZoom(ev: {transform: d3.ZoomTransform} | null) {
    if (ev) {
        ctx!.zoom.lastZoomTransform = ev.transform;
    }
    if (ctx!.zoom.lastZoomTransform !== null) {
        ctx!.timeline.xScaled = ctx!.zoom.lastZoomTransform.rescaleX(ctx!.timeline.x);
    }
    const xAxisTicks = ctx!.timeline.xScaled.ticks().filter(Number.isInteger);
    ctx!.timeline.xAxis.tickValues(xAxisTicks);
    ctx!.timeline.eventWidth = ctx!.timeline.xScaled(1) - ctx!.timeline.xScaled(0);
    ctx!.timeline.xAxisEl!.call(ctx!.timeline.xAxis.scale(ctx!.timeline.xScaled));
    updateClipHorizontal(ctx!);
    updateTimeline();
}

function updateTimeline() {
    updateTimelineEvents();
    updateTimelineSpans();
    updateTimelineBlocked();
    updateTimelineLinks();
}

function updateTimelineRows() {
    ctx!.timeline.rows!
        .transition()
            .duration(200)
            .attr("transform", ({visibleIndex}) => `translate(0,${visibleIndex * rowHeight - 9})`)
            .attr("style", ({visible}) => `opacity: ${visible ? 1 : 0};`);
}

function updateTimelineSpans() {
    const leftX = d3.local<number>();
    const rightX = d3.local<number>();
    ctx!.timeline.spans!
        .classed("selected", d => d.isTask
            ? ctx!.selection.taskId === (d as Task).id
            : ctx!.selection.objectId === (d as Object).id)
        .each(function ({firstStep, lastStep}) {
            leftX.set(this as Element, Math.max(ctx!.timeline.xScaled(ctxData!.events[firstStep].keptIdx) - 2, -2));
            rightX.set(this as Element, Math.min(ctx!.timeline.xScaled(ctxData!.events[lastStep].keptIdx + (ctxData!.events[lastStep].filtered ? 0 : 1)) + 2, ctx!.width));
        })
        .attr("transform", function () { return `translate(${leftX.get(this as Element)},0)` })
        .attr("width", function () {
            if (rightX.get(this as Element)! <= leftX.get(this as Element)!) return "1px";
            return `${rightX.get(this as Element)! - leftX.get(this as Element)!}px`;
        });
}

function updateTimelineBlocked() {
    /*
    // TODO: disabled
    ctx!.timeline.rows!
        .selectAll("rect.blocked")
        .data(d => d.isTask ? (d as Task).blockedAt : [])
        .join("svg:rect")
            .classed("blocked", true)
            .attr("transform", (at) => `translate(${ctx!.timeline.xScaled(ctxData!.events[at].keptIdx) + 2},2)`)
            .attr("height", `${eventHeight}px`)
            .attr("width", "5px");
            */
}

export function updateTimelineLinks() {
    ctx!.links.root!
        .selectAll("path.link")
        .data(ctx!.links.current)
        .join("path")
            .classed("link", true)
            .attr("d", ({source, target}) => {
                if (!source || !target) return "";
                let sourceEvent = "isTask" in source ? ctxData!.events[source.firstStep] : source;
                let targetEvent = "isTask" in target ? ctxData!.events[target.firstStep] : target;
                let sourceTask = "isTask" in source ? source : ctxData!.tasks[sourceEvent.taskId];
                let targetTask = "isTask" in target ? target : ctxData!.tasks[targetEvent.taskId];
                return linkGen({
                    source: [ctx!.timeline.xScaled(sourceEvent.keptIdx) + Math.min(ctx!.timeline.eventWidth, 4), sourceTask.visibleIndex * rowHeight],
                    target: [ctx!.timeline.xScaled(targetEvent.keptIdx) + Math.min(ctx!.timeline.eventWidth, 4), targetTask.visibleIndex * rowHeight],
                });
            });
}

function updateHeight() {
    let visibleNodes = 1;
    if (ctxHierarchy!.hierarchy.length > 0) {
        visibleNodes = ctxHierarchy!.hierarchy[ctxHierarchy!.hierarchy.length - 1].visibleIndex + 1;
    }
    ctx!.height = (visibleNodes + 1) * rowHeight;
    // TODO: changing viewbox messes with the animations: only change it after the transition
    ctx!.left.root
        .attr("viewBox", [0, 0, dimXTimeline, ctx!.height + marginTop - 10]);
    ctx!.right.root
        .attr("viewBox", [0/*dimXTimeline*/, 0, ctx!.width - marginRight - dimXTimeline, ctx!.height + marginTop - 10]);
}

function updateTimelineEvents() {
    ctx!.timeline.events = ctx!.timeline.rows!
        .selectAll(".event")
        .data(({flatIndex, visible}) => visible && ctx!.zoom.trees[flatIndex] !== null ? getZoomTrees(ctx!, ctx!.zoom.trees[flatIndex][0][0]) : [])
        .join("svg:rect")
            .attr("transform", ({minData}) => `translate(${ctx!.timeline.xScaled(minData.keptIdx)},2)`)
            .attr("height", `${eventHeight}px`)
            // TODO: don't apply max if the event is the right-most in its task to avoid visually overflowing the task row
            .attr("width", ({minData, maxData}) => `${Math.max(minEventWidth, ctx!.timeline.xScaled(maxData.keptIdx + 1) - ctx!.timeline.xScaled(minData.keptIdx))}px`)
            .classed("event", true)
            .classed("summary", ({count}) => count > 1)
            .classed("selected", ({minData, maxData}) => ctx!.selection!.eventId !== null
                && minData.taskId === ctxData!.events[ctx!.selection!.eventId].taskId
                && minData.id <= ctx!.selection!.eventId
                && ctx!.selection!.eventId <= maxData.id)
            .on("click", (_ev, {keptData}) => { if (keptData !== null) selectEvent(keptData.id, true); });
            /*
            .on("mouseover", (_ev, {id}) => vscode.postMessage({ type: "eventHover", data: id }))
            .on("mouseout", (_ev, {id}) => vscode.postMessage({ type: "eventHoverOff", data: id }))
            */;
    /*
    ctx!.timeline.events = ctx!.timeline.rows!
        .selectAll(".event")
        .data(({events}) => events.filter(({filtered}) => !filtered))
        .join("svg:rect")
            .attr("transform", ({keptIdx}) => `translate(${ctx!.timeline.xScaled(keptIdx)},2)`)
            //.attr("transform", ({cdagIdx}) => `translate(${ctx!.timeline.xScaled(cdagIdx)},2)`)
            .attr("height", `${eventHeight}px`)
            .attr("width", `${ctx!.timeline.eventWidth}px`)
            .classed("event", true)
            .classed("selected", ({id}) => ctx!.selection.eventId === id)
            .on("mouseover", (_ev, {id}) => vscode.postMessage({ type: "eventHover", data: id }))
            .on("mouseout", (_ev, {id}) => vscode.postMessage({ type: "eventHoverOff", data: id }))
            .on("click", (_ev, {id}) => selectEvent(id, true));
            */
}

function updateLeftPanel() {
    const durationToggleEntry = 200;

    // links joining entries
    ctx!.links.pathRoot!
        .selectAll("path")
        .data(ctxHierarchy!.hierarchy)
        .join("path")
            .transition()
                .duration(durationToggleEntry)
                .attr("d", ({createdBy, visibleIndex}) => visibleIndex === 0 ? "" :
                    `M${ctxData!.tasks[createdBy].depth * depthOffset},${marginTop + ctxData!.tasks[createdBy].visibleIndex * rowHeight}`
                    + ` V${marginTop + visibleIndex * rowHeight}`
                    + ` h${depthOffset}`)
                .attr("style", ({visible}) => `opacity: ${visible ? 1 : 0};`);

    // the entries themselves
    const hierarchyEntries = ctx!.links.entryRoot!
        .selectAll("g")
        .data(ctxHierarchy!.hierarchy)
        .join("g");
    hierarchyEntries
        .transition()
            .duration(durationToggleEntry)
            .attr("transform", ({visibleIndex}) => `translate(0,${marginTop + visibleIndex * rowHeight})`)
            .attr("style", ({visible}) => visible ? "opacity: 1;" : "opacity: 0;")
            .on("start", () => { hierarchyEntries.filter(({visible}) => visible).attr("style", "display: block;"); })
            .on("end", () => { hierarchyEntries.filter(({visible}) => !visible).attr("style", "display: none;"); });
    const entryCircle = hierarchyEntries
        .selectAll("circle")
        .data(d => [d])
        .join("circle")
            .attr("cx", ({depth}) => depth * depthOffset)
            .attr("r", 4.5)
            .attr("fill", ({children}) => children.length ? null : "#999");
    const entryPM = hierarchyEntries
        .selectAll("text.pm")
        .data(d => d.children.length ? [d] : [])
        .join("text")
            .classed("pm", true)
            .attr("stroke", "#fff")
            .attr("transform", ({depth}) => `translate(${-3 + depth * depthOffset},2.5)`)
            .text(({open}) => open ? "–" : "+");
    entryCircle
        .on("click", (_ev, entry) => {
            entry.open = !entry.open;
            updateVisible();
        });
    entryPM // TODO: avoid this duplicate listener
        .on("click", (_ev, entry) => {
            entry.open = !entry.open;
            updateVisible();
        });
    hierarchyEntries
        .selectAll("text.entry")
        .data(d => [d])
        .join("text")
            .classed("entry", true)
            .attr("dy", "0.32em")
            .attr("x", ({depth}) => depth * depthOffset + 8)
            .text(d => d.name != null ? d.name : (d.isTask ? `task ${(d as Task).id}` : `object ${(d as Object).id}`))
            .on("click", (_ev, d) => d.isTask ? selectTask((d as Task).id, true) : selectObject((d as Object).id, true));
}

function updateVisible() {
    let visibleIndex = -1;
    function walk(entry: HierarchyEntry, visible: boolean) {
        entry.visible = visible;
        entry.visibleIndex = visible ? ++visibleIndex : visibleIndex;
        entry.children.forEach((child) => walk(child, visible && entry.open));
    }
    walk(ctxData!.tasks[0], true);
    updateHeight();
    updateTimelineRows();
    updateTimelineLinks();
    updateLeftPanel();
}

export function createContextDOM(
    argVscode: any,
    argCtxData: ExtContextData,
    argCtxFilters: ExtContextFilters,
    argCtxHierarchy: ExtContextHierarchy,
): ExtContextDOM {
    vscode = argVscode;
    ctxData = argCtxData;
    ctxFilters = argCtxFilters;
    ctxHierarchy = argCtxHierarchy;

    const width = (d3.select("main div.panel-main").node()! as HTMLDivElement).clientWidth;
    const x = d3.scaleLinear([0, ctxFilters!.keptEvents], [0, width - marginRight - dimXTimeline]);

    // create/get DOM roots
    const root = d3.select("main");

    // root: top panel (X axis)
    const rootTop = d3.select<SVGSVGElement, unknown>("svg.panel-top")
        .attr("transform", `translate(${dimXTimeline},0)`)
        .attr("width", width - marginRight - dimXTimeline)
        .attr("height", marginTop)
        .attr("viewBox", [0, 0, width - marginRight - dimXTimeline, marginTop])
        .attr("style", "max-width: 100%; height: auto; font: 10px sans-serif; overflow: visible;");

    // root: main panel (hierarchy and timeline)
    const rootMain = root.select("div.panel-main");
    const scrollHorizontal = rootMain.append("div")
        .classed("panel-main-right", true);
    const rootRight = scrollHorizontal.append("svg")
        .attr("width", width - marginRight - dimXTimeline)
        .attr("style", "height: auto; font: 10px sans-serif; overflow: hidden;");

    ctx = {
        width,
        height: 1,
        root,
        timeline: {
            x,
            xScaled: x,
            xAxis: d3.axisTop(x)
                .tickFormat(d3.format("d")),
            xAxisEl: null,
            eventWidth: x(1) - x(0),
            root: rootRight.append("svg:g")
                .attr("transform", `translate(0,${marginTop})`),
            rows: null,
            spans: null,
            events: null,
        },
        zoom: createContextDOMZoom(),
        main: {
            root: rootMain,
        },
        left: {
            root: rootMain.append("svg")
                .attr("width", dimXTimeline)
                .attr("style", "height: auto; font: 10px sans-serif; overflow: hidden;")
                .classed("panel-main-left", true),
        },
        right: {
            scrollRoot: scrollHorizontal,
            root: rootRight,
        },
        links: {
            current: [],
            root: null,
            pathRoot: null,
            entryRoot: null,
        },
        selection: createContextDOMSelection(),
    };

    updateHeight();
    updateFilters();

    // create arrow tip
    ctx!.right.root.append("svg:defs").append("svg:marker")
        .attr("id", "arrow")
        .attr("viewBox", [0, 0, 10, 10])
        .attr("refX", 5)
        .attr("refY", 5)
        .attr("markerWidth", 6)
        .attr("markerHeight", 6)
        .attr("orient", "auto-start-reverse")
        .append("svg:path")
            .attr("d", "M 0 0 L 10 5 L 0 10 z");

    // create X axis for time (in samples)
    ctx!.timeline.xAxisEl = rootTop.append("g")
        .attr("transform", `translate(0,${marginTop})`)
        .call(ctx!.timeline.xAxis);

    // create event timeline
    let timelineMain = ctx!.right.root.append("g")
        .attr("transform", `translate(0,${marginTop})`);

    // background to catch zoom and drag events
    timelineMain.append("svg:rect")
        .attr("transform", `translate(0,-${marginTop})`)
        .attr("width", "2000")
        .attr("height", "2000")
        .attr("fill", "transparent")
        .on("click", deselect);

    // timeline rows
    ctx!.timeline.rows = timelineMain
        .selectAll("g.tl-row")
        .data(ctxHierarchy!.hierarchy)
        .join("svg:g")
            .classed("tl-row", true);
    updateTimelineRows();

    // setup zoom
    const zoomToMinEvents = ctxFilters!.keptEvents / minEventsOnScreen;
    ctx!.zoom.zoom = d3.zoom<SVGGElement, any>()
        .scaleExtent([1, Math.max(zoomToMinEvents, 1)])
        .translateExtent([[0, 0], [width - marginRight - dimXTimeline, 0]])
        // prevent scrolling then apply the default filter
        .filter((event: MouseEvent): boolean => {
            event.preventDefault();
            return (!event.ctrlKey || event.type === 'wheel') && !event.button;
        })
        .on("zoom", updateZoom);
    timelineMain.call(ctx!.zoom.zoom!);
    updateClipHorizontal(ctx!);

    // show task/object spans
    ctx!.timeline.spans = ctx!.timeline.rows
        .selectAll("rect.to-span")
        .data(d => [d])
        .join("svg:rect")
            .attr("height", `${eventHeight + 4}px`)
            .classed("to-span", true)
            .classed("task", ({isTask}) => isTask)
            .classed("object", ({isTask}) => !isTask)
            .on("click", (_ev, d) => d.isTask
                ? selectTask((d as Task).id, true)
                : selectObject((d as Object).id, true));
    updateTimelineSpans();

    // show task blocked times
    updateTimelineBlocked();

    // populate timeline with individual events
    updateTimelineEvents();

    // links joining events, objects, tasks...
    ctx!.links.root = timelineMain.append("svg:g")
        .classed("tl-links", true);
    updateTimelineLinks();

    // select event zero
    selectEvent(0, false);

    // left panel: hierarchy of tasks and objects
    ctx!.links.pathRoot = ctx!.left.root.append("g")
        .attr("fill", "none")
        .attr("stroke", "#999")
        .attr("transform", `translate(15,0)`);
    ctx!.links.entryRoot = ctx!.left.root.append("g")
        .attr("transform", `translate(15,0)`);
    updateLeftPanel();

    // setup fit-to-width
    window.addEventListener("resize", () => {
        // TODO: throttle (only set one?)
        requestAnimationFrame(() => {
            ctx!.width = (ctx!.main.root.node()! as HTMLDivElement).clientWidth;
            x.range([0, ctx!.width - marginRight - dimXTimeline]);
            ctx!.zoom.zoom!.translateExtent([[0, 0], [ctx!.width - marginRight - dimXTimeline, 0]]);
            rootTop
                .attr("width", ctx!.width - marginRight - dimXTimeline)
                .attr("viewBox", [0, 0, ctx!.width - marginRight - dimXTimeline, marginTop]);
            ctx!.right.root
                .attr("width", ctx!.width - marginRight - dimXTimeline);
            updateZoom(null);
            updateHeight();
        });
    });

    // setup keyboard navigation
    window.addEventListener("keydown", (ev) => {
        switch (ev.code) {
            case "ArrowLeft":
            case "ArrowRight":
                const left = ev.code === "ArrowLeft";
                if (ctxFilters!.keptEvents > 0) {
                    // select leftmost/rightmost visible event
                    let [startScan, endScan, deltaScan] = left ? [ctxData!.events.length - 1, -1, -1] : [0, ctxData!.events.length, 1];
                    if (ctx!.selection.eventId !== null) {
                        // select next visible event to the left/right
                        startScan = ctx!.selection.eventId + deltaScan;
                    }
                    for (let eventId = startScan; eventId != endScan; eventId += deltaScan) {
                        if (!ctxData!.events[eventId].filtered) {
                            selectEvent(eventId, true);
                            break;
                        }
                    }
                }
                break;
            default:
                return;
        }
        ev.preventDefault();
    });

    // filter checkboxes, badges
    for (let category of eventCategories) {
        d3.select(`#filters-${category}`)
            .on("change", (ev) => {
                filterByCategory.data.enabledCategories[category] = ev.target.checked;
                updateFilters();
                reselect();
                const zoomToMinEvents = ctxFilters!.keptEvents / minEventsOnScreen;
                ctx!.zoom.zoom!.scaleExtent([1, Math.max(zoomToMinEvents, 1)]);
                updateZoom(null);
            });
        d3.select(`#filters-${category} vscode-badge`).text(filterByCategory.data.categoryCounts[category]!);
    }

    return ctx;
}
