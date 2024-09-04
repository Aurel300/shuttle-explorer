declare const acquireVsCodeApi: any;

import {
    provideVSCodeDesignSystem,
    vsCodeButton,
    vsCodeCheckbox,
    vsCodeDataGrid,
    vsCodeDataGridCell,
    vsCodeDataGridRow,
    vsCodeDivider,
    vsCodeLink,
    vsCodePanels,
    vsCodePanelTab,
    vsCodePanelView,
} from "@vscode/webview-ui-toolkit";

import { Schedule } from "../common/schedule.mjs";
import {
    createContextData,
    createContextFilters,
    createContextHierarchy,
    ExtContextData,
    ExtContextFilters,
    ExtContextHierarchy,
} from "../common/context.mjs";
import { createContextDOM, ExtContextDOM } from "./dom.mjs";

type ExtContext = {
    data: ExtContextData,
    hierarchy: ExtContextHierarchy,
    filters: ExtContextFilters,
    dom: ExtContextDOM,
};

document.addEventListener("DOMContentLoaded", () => {
    const vscode = acquireVsCodeApi();

    provideVSCodeDesignSystem().register(
        vsCodeButton(),
        vsCodeCheckbox(),
        vsCodeDataGrid(),
        vsCodeDataGridCell(),
        vsCodeDataGridRow(),
        vsCodeDivider(),
        vsCodeLink(),
        vsCodePanels(),
        vsCodePanelTab(),
        vsCodePanelView(),
    );

    function createTimeline(schedule: Schedule) {
        let ctxPartial: {
            data?: ExtContextData,
            hierarchy?: ExtContextHierarchy,
            filters?: ExtContextFilters,
            dom?: ExtContextDOM,
        } = {};
        ctxPartial.data = createContextData(schedule);
        ctxPartial.hierarchy = createContextHierarchy(ctxPartial.data);
        ctxPartial.filters = createContextFilters(ctxPartial.data);
        ctxPartial.dom = createContextDOM(vscode, ctxPartial.data, ctxPartial.filters, ctxPartial.hierarchy);
        let _ctx: ExtContext = ctxPartial as ExtContext;
    }

    window.addEventListener("message", (event: MessageEvent<{
        type: "createTimeline",
        data: Schedule,
    }>) => {
        const {type, data} = event.data;
        switch (type) {
            case "createTimeline": createTimeline(data); break;
        }
    });
});
