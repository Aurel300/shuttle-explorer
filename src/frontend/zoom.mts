import * as d3 from "d3";

import { dimXTimeline, ExtContextDOM, marginTop, rowHeight } from "./dom.mts";
import { ExtContextData, ExtContextFilters, ExtContextHierarchy } from "../common/context.mts";
import { Event } from "../common/events.mts";

export type ZoomTree<T> = {
    // for each extreme, we store:
    // - border: is there a border on this side? i.e. if there is another tree,
    //   is its emptiness different from ours; if there is nothing, is our tree
    //   full?
    // - data: reference to the actual minimum/maximum entry
    // - dataId: the ID of the minimum/maximum entry
    // - id: bound of the tree (may extend beyond the minimum/maximum entry),
    //   inclusive on both sides
    minBorder: boolean,
    minData: T,
    minDataId: number,
    minId: number,
    maxBorder: boolean,
    maxData: T,
    maxDataId: number,
    maxId: number,
    // one (leftmost) element in this tree that was not filtered, for selection purposes
    keptData: T | null,
    // count of elements in this tree
    count: number,
    left: ZoomTree<T> | null,
    right: ZoomTree<T> | null,
};

export type HierarchyZoomTrees = ZoomTree<Event>[][] | null;

export type ExtContextDOMZoom = {
    zoom: d3.ZoomBehavior<SVGGElement, any> | null,
    lastZoomTransform: d3.ZoomTransform | null,
    // for each entry in the hierarchy, a list of zoom levels, each containing trees
    trees: HierarchyZoomTrees[],
    // for each zoom level, how wide would a (full) tree be at 1x scale?
    treeSize: number[],

    // current zoom level
    level: number,
    // horizontal clipping: smallest keptIdx shown
    minIdx: number,
    // horizontal clipping: largest keptIdx shown
    maxIdx: number,
    // vertical clipping: smallest visibleIndex shown
    minHierarchyIdx: number,
    // vertical clipping: largest visibleIndex shown
    maxHierarchyIdx: number,
};
export function createContextDOMZoom(): ExtContextDOMZoom {
    return {
        zoom: null,
        lastZoomTransform: null,
        trees: [],
        treeSize: [],
        level: 0,
        minIdx: 0,
        maxIdx: 0,
        minHierarchyIdx: 0,
        maxHierarchyIdx: 0,
    };
}

function nearestPowerOf2(n: number): number {
    return 1 << 31 - Math.clz32(n);
}

export function updateZoomTrees(
    ctxData: ExtContextData,
    ctxHierarchy: ExtContextHierarchy,
    ctxFilters: ExtContextFilters,
    ctx: ExtContextDOM,
) {
    // update zoom trees
    let topSize = nearestPowerOf2(ctxFilters.keptEvents);
    if (topSize !== ctxFilters.keptEvents) {
        topSize *= 2;
    }

    ctx.zoom.trees.length = 0;
    let maxDepth = 0;
    for (let i = 0; i < ctxHierarchy.hierarchy.length; i++) {
        const entry = ctxHierarchy.hierarchy[i];
        if (!entry.isTask || entry.events.length === 0) {
            ctx.zoom.trees.push(null);
            continue;
        }
        let root: ZoomTree<Event> = {
            minBorder: true,
            minData: entry.events[0],
            minDataId: entry.events[0].keptIdx,
            minId: entry.events[0].keptIdx,
            maxBorder: true,
            maxData: entry.events[entry.events.length - 1],
            maxDataId: entry.events[entry.events.length - 1].keptIdx,
            maxId: entry.events[entry.events.length - 1].keptIdx,
            keptData: null, // TODO: (realistically doesn't matter, this zoom level is probably never visible)
            count: entry.events.length,
            left: null,
            right: null,
        };
        let levels: ZoomTree<Event>[][] = [];
        function walk(
            parent: ZoomTree<Event>,
            targetSize: number,
            minEntryIdx: number, // inclusive
            maxEntryIdx: number, // inclusive
            depth: number,
        ) {
            if (depth >= levels.length) {
                levels.push([]);
            }
            levels[depth].push(parent);

            // this is an empty or singleton tree, do nothing
            if (maxEntryIdx <= minEntryIdx || targetSize < 2) {
                return;
            }

            // figure out the bounds of the left and right subtrees
            // the total size is the span of the bounds
            const size = parent.maxId + 1 - parent.minId;
            // the left size is the nearest (smaller) power of two
            const halfSize = Math.floor(targetSize / 2);
            const leftSize = halfSize;
            // the right size is the remainder
            const rightSize = size - leftSize;

            // actual bounds
            const leftMax = parent.minId + leftSize - 1;
            const rightMin = leftMax + 1;

            // binary search for the split point in the entry's event array
            // (entry's event array is a sequence of events which may not be
            //  consecutive, and may contain only events belonging to the left
            //  subtree, or only events belonging to the right subtree)
            let splitMin = minEntryIdx;
            let splitMax = maxEntryIdx;
            let splitIdx = Math.floor((splitMax + splitMin) / 2);
            while (
                // did we not yet reach the left/right-most split?
                0 <= splitIdx && splitIdx < entry.events.length - 1
                && splitMin < splitMax
                // did we not yet find the split?
                && !(entry.events[splitIdx].keptIdx <= leftMax && entry.events[splitIdx + 1].keptIdx >= rightMin)
            ) {
                console.assert(entry.events[splitIdx].keptIdx > leftMax || entry.events[splitIdx + 1].keptIdx < rightMin);
                if (entry.events[splitIdx].keptIdx > leftMax) {
                    // split is farther to the left, so move right bound down
                    splitMax = splitIdx - 1;
                } else {
                    // split is farther to the right, so move left bound up
                    splitMin = splitIdx + 1;
                }
                splitIdx = Math.floor((splitMax + splitMin) / 2);
            }
            console.assert(-1 <= splitIdx && splitIdx <= entry.events.length);

            // how many events are actually in the subtrees?
            let leftCount = 0;
            let rightCount = 0;
            let leftKept = null;
            let rightKept = null;
            for (let idx = minEntryIdx; idx <= maxEntryIdx; idx++) {
                if (entry.events[idx].filtered) continue;
                if (idx <= splitIdx) {
                    leftKept = entry.events[idx];
                    leftCount++;
                } else if (idx >= splitIdx + 1) {
                    rightKept = entry.events[idx];
                    rightCount++;
                }
            }
            const interBorder = (leftCount > 0) !== (rightCount > 0);

            if (leftCount > 0) {
                parent.left = {
                    minBorder: parent.minBorder,
                    minData: parent.minData,
                    minDataId: parent.minDataId,
                    minId: parent.minId,
                    maxBorder: interBorder,
                    maxData: entry.events[splitIdx],
                    maxDataId: entry.events[splitIdx].keptIdx,
                    maxId: leftMax,
                    keptData: leftKept,
                    count: leftCount,
                    left: null,
                    right: null,
                };
                walk(parent.left, halfSize, minEntryIdx, splitIdx, depth + 1);
            }
            if (rightCount > 0) {
                parent.right = {
                    minBorder: interBorder,
                    minData: entry.events[splitIdx + 1],
                    minDataId: entry.events[splitIdx + 1].keptIdx,
                    minId: rightMin,
                    maxBorder: parent.maxBorder,
                    maxData: parent.maxData,
                    maxDataId: parent.maxDataId,
                    maxId: parent.maxId,
                    keptData: rightKept,
                    count: rightCount,
                    left: null,
                    right: null,
                };
                walk(parent.right, halfSize, splitIdx + 1, maxEntryIdx, depth + 1);
            }
        }
        walk(root, topSize, 0, entry.events.length - 1, 0);
        ctx.zoom.trees.push(levels);
        maxDepth = Math.max(maxDepth, levels.length);
    }

    // update zoomtree sizes
    ctx.zoom.treeSize.length = 0;
    let treeSize = topSize;
    for (let depth = 0; depth < maxDepth; depth++) {
        ctx.zoom.treeSize.push(treeSize);
        treeSize = Math.floor(treeSize / 2);
    }
}

export const minEventWidth = 5;

export function updateClipHorizontal(ctx: ExtContextDOM) {
    // which zoom tree to use?
    let zoomLevel = 0;
    while (
        zoomLevel + 1 < ctx.zoom.treeSize.length
        && ctx.timeline.xScaled(ctx.zoom.treeSize[zoomLevel + 1]) - ctx.timeline.xScaled(0) > minEventWidth
    ) {
        zoomLevel++;
    }
    ctx.zoom.level = zoomLevel;

    // horizontal clipping
    ctx.zoom.minIdx = ctx.timeline.xScaled.invert(0);
    ctx.zoom.maxIdx = ctx.timeline.xScaled.invert(ctx.width + dimXTimeline);
}

/*
export function updateClipVertical(ctx: ExtContextDOM) {
    const scrollHeight = (ctx.main.root.node()! as Element).clientHeight;
    const scrollTop = (ctx.main.root.node()! as Element).scrollTop;
    ctx.zoom.minHierarchyIdx = Math.floor((scrollTop - marginTop) / rowHeight);
    ctx.zoom.maxHierarchyIdx = ctx.zoom.minHierarchyIdx + Math.ceil((scrollHeight + 2 * marginTop) / rowHeight);
}
*/
// TODO: implement vertical clipping

export function getZoomTrees<T>(ctx: ExtContextDOM, root: ZoomTree<T>): ZoomTree<T>[] {
    let output: ZoomTree<T>[] = [];
    function walk(tree: ZoomTree<T>, depth: number) {
        // is this tree visible?
        let isVisible = tree.maxDataId + 1 >= ctx.zoom.minIdx && tree.minDataId <= ctx.zoom.maxIdx;
        if (!isVisible) {
            return;
        }

        // can we split this tree?
        let canSplit = tree.left !== null || tree.right !== null;
        // should we?
        let shouldSplit = depth < ctx.zoom.level;

        if (canSplit && shouldSplit) {
            if (tree.left) walk(tree.left, depth + 1);
            if (tree.right) walk(tree.right, depth + 1);
        } else if (tree.count > 0 && tree.keptData !== null) {
            output.push(tree);
        }
    }
    walk(root, 0);
    return output;
}
