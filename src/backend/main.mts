import * as vscode from 'vscode';

// const segmentColor = new vscode.Color(0, 1, 0, 100.); //0.5);
const decorationSegment = vscode.window.createTextEditorDecorationType({
    after: {
        backgroundColor: "#4d0",
        color: "#090",
        height: "1.1em",
        margin: "1px",
    },
    // backgroundColor: "#afa", // segmentColor, // TODO: base on theme somehow?
});

import {
    Schedule,
    ScheduleEvent,
    ProcessedSchedule,
} from "../common/schedule.mjs";

export function activate(context: vscode.ExtensionContext) {
    console.log("Shuttle Explorer activated");

    const explorer = new Explorer(context.extensionUri);

    vscode.window.onDidChangeActiveTextEditor((editor) => explorer.decorateEditor(editor));

    context.subscriptions.push(vscode.window.registerWebviewViewProvider(Explorer.viewType, explorer));

    /*
    context.subscriptions.push(vscode.commands.registerCommand('shuttle-explorer.replay', async () => {
        // ask for schedule
        // TODO: bad for big schedules, also allow picking file (different command?)
        const schedule = await vscode.window.showInputBox({
            prompt: "Enter the Shuttle schedule to replay",
        });
        if (!schedule) return;

        // ask for test name
        // TODO: this is not great, and assumes cargo tests are used for replay...
        // const testName = "deadlock_replay";
        const testName = await vscode.window.showInputBox({
            prompt: "Enter the name of the test to replay",
        });
        if (!testName) return;
    }));
    */

    // TODO: don't hardcode
    vscode.workspace.fs.readFile(vscode.Uri.file("/Users/aubily/workplace/shuttle-clients/annotated.json")).then((schedule_raw: Uint8Array) => {
        const schedule: Schedule = JSON.parse(new TextDecoder("utf-8").decode(schedule_raw));
        explorer.setAnnotatedSchedule(schedule);
        explorer.decorateEditor(vscode.window.activeTextEditor);
    });
}

export function deactivate() {}

class Explorer implements vscode.WebviewViewProvider {
    // matches the view ID in package.json
    public static readonly viewType = "shuttleExplorerPanel.views.home";

    private _view?: vscode.WebviewView;
    private _annotatedSchedule?: Schedule;
    private _previewEvent?: [number, ScheduleEvent] | null;
    private _selectedEvent?: [number, ScheduleEvent];
    private _processedSchedule?: ProcessedSchedule;

    constructor(
        private readonly _extensionUri: vscode.Uri,
    ) {}

    private _processSchedule(
        schedule: Schedule,
    ) {
        let tasksRunning: number[] = [];
        let lastEventByTask: Map<number, number> = new Map();
        let eventId = 0;
        let previousEvents: ScheduleEvent[][] = [];
        for (const [taskId, _info, kind] of schedule.events) {
            if (typeof kind === "string" || kind instanceof String) {
                if (kind === "TaskTerminated") {
                    tasksRunning.splice(tasksRunning.indexOf(taskId), 1);
                }
            } else {
                if ("TaskCreated" in kind) {
                    tasksRunning.push(kind["TaskCreated"][0]);
                }
            }
            lastEventByTask.set(taskId, eventId);
            const previous = tasksRunning.sort()
                .filter(otherId => taskId !== otherId)
                .filter(otherId => lastEventByTask.has(otherId))
                .map(otherId => schedule.events[lastEventByTask.get(otherId)!]);
            previousEvents.push(previous);
            eventId++;
        }
        this._processedSchedule = {
            previousEvents,
        };
    }

    public setAnnotatedSchedule(
        schedule: Schedule,
    ) {
        this._annotatedSchedule = schedule;
        this._previewEvent = null;
        this._selectedEvent = [0, schedule.events[0]];
        if (this._view) {
            this._view.webview.postMessage({
                type: "createTimeline",
                data: schedule,
            });
        }
        this._processSchedule(schedule);
    }

    private _activeEditor?: vscode.TextEditor;
    public decorateEditor(
        editor?: vscode.TextEditor,
    ) {
        this._activeEditor = editor;
        this._updateDecorations();
    }

    public resolveWebviewView(
        webviewView: vscode.WebviewView,
        _context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken,
    ) {
        this._view = webviewView;
        webviewView.webview.options = {
            // allow scripts in the webview
            enableScripts: true,
            localResourceRoots: [
                this._extensionUri,
            ],
        };
        webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);
        webviewView.webview.onDidReceiveMessage(({type, data}) => { switch (type) {
            case "eventHover": this._onEventHover(data); break;
            case "eventHoverOff": this._onEventHoverOff(data); break;
            case "eventClick": this._onEventClick(data); break;
            case "backtraceClick": this._onBacktraceClick(data[0], data[1]); break;
        } });
    }

    private _onEventHover(
        event_id: number,
    ) {
        if (!this._annotatedSchedule
            || !this._annotatedSchedule.events[event_id]
            || !this._selectedEvent) return;
        if (this._selectedEvent[0] === event_id) {
            this._previewEvent = null;
            return;
        }
        this._previewEvent = [event_id, this._annotatedSchedule.events[event_id]];
        this._updateDecorations();
    }

    private _onEventHoverOff(
        eventId: number,
    ) {
        if (!this._annotatedSchedule
            || !this._annotatedSchedule.events[eventId]
            || !this._previewEvent) return;
        if (this._previewEvent[0] === eventId) {
            this._previewEvent = null;
            this._updateDecorations();
        }
    }

    private _onEventClick(
        eventId: number,
    ) {
        if (!this._annotatedSchedule
            || !this._annotatedSchedule.events[eventId]) return;
        this._selectedEvent = [eventId, this._annotatedSchedule.events[eventId]];
        if (this._previewEvent && this._selectedEvent[0] === this._previewEvent[0]) {
            this._previewEvent = null;
        }
        this._updateDecorations();
    }

    private _onBacktraceClick(
        eventId: number,
        btId: number,
    ) {
        if (!this._activeEditor
            || !this._annotatedSchedule
            || !this._annotatedSchedule.events[eventId]
            || !this._annotatedSchedule.events[eventId][1]) return;
        const [pathId, _functionId, line, col] = this._annotatedSchedule.events[eventId][1][btId];
        const path = vscode.Uri.joinPath(
            vscode.workspace.workspaceFolders![0].uri,
            this._annotatedSchedule.files[pathId].path,
        );
        vscode.window.showTextDocument(path, {
            preview: true,
            selection: new vscode.Selection(
                line - 1, col - 1,
                line - 1, col - 1,
            ),
        });
    }

    private _updateDecorations() {
        // TODO: detect which file we are in ...
        // TODO: delete any previous decorations?
        if (!this._activeEditor
            || !this._annotatedSchedule) return;

        let decorations: vscode.DecorationOptions[] = [];
        function addEvent([task_id, info, kind]: ScheduleEvent) {
            if (info === null) return;
            const [path_idx, function_idx, line, col] = info[0];
            decorations.push({
                range: new vscode.Range(line - 1, col - 1, line - 1, col - 1),
                renderOptions: {
                    after: {
                        contentText: "#" + task_id,
                    },
                },
            });
        }
        //addEvent(this._selectedEvent![1]);
        let eventId = this._selectedEvent![0];
        let eventsToShow = [this._selectedEvent![1]].concat(this._processedSchedule!.previousEvents[eventId]);
        eventsToShow.forEach(addEvent);
        // if (this._previewEvent) addEvent(this._previewEvent[1]);

        this._activeEditor.setDecorations(decorationSegment, decorations);
    }

    private _getHtmlForWebview(webview: vscode.Webview) {
        // prepare URIs for local stylesheets
        const styleResetUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, "media", "reset.css"));
        const styleVSCodeUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, "media", "vscode.css"));
        const styleMainUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, "media", "main.css"));

        // package-sourced
        const styleCodiconsUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, "node_modules", "@vscode/codicons", "dist", "codicon.css"));
        const toolkitUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, "node_modules", "@vscode/webview-ui-toolkit", "dist", "toolkit.min.js"));
        const d3Uri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, "node_modules", "d3", "dist", "d3.min.js"));

        // frontend Javascript
        const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, "dist", "frontend", "main.js"));

        const nonce = getNonce();
        // TODO: move to separate file
        return /*html*/`<!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
                <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; font-src ${webview.cspSource}; script-src 'nonce-${nonce}';">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <link href="${styleResetUri}" rel="stylesheet">
                <link href="${styleVSCodeUri}" rel="stylesheet">
                <link href="${styleCodiconsUri}" rel="stylesheet">
                <link href="${styleMainUri}" rel="stylesheet">
                <title>Shuttle Explorer</title>
                <script nonce="${nonce}" type="text/javascript" src="${d3Uri}"></script>
                <script nonce="${nonce}" type="module" src="${toolkitUri}"></script>
                <script nonce="${nonce}" type="module" src="${scriptUri}"></script>
            </head>
            <body>
                <main>
                    <svg class="panel-top"></svg>
                    <div class="panel-sidebar">
                        <vscode-panels activeid="sidebar-tab-1">
                            <vscode-panel-tab id="sidebar-tab-1">SELECTION</vscode-panel-tab>
                            <vscode-panel-tab id="sidebar-tab-2">FILTERS</vscode-panel-tab>
                            <vscode-panel-view id="sidebar-view-1">
                                <p class="placeholder">Select an event, task, or object.</p>
                                <div class="event-info">
                                    <vscode-data-grid grid-template-columns="2fr 3fr">
                                        <vscode-data-grid-row>
                                            <vscode-data-grid-cell grid-column="1">Kind</vscode-data-grid-cell>
                                            <vscode-data-grid-cell grid-column="2" class="event-info-kind">-</vscode-data-grid-cell>
                                        </vscode-data-grid-row>
                                        <vscode-data-grid-row>
                                            <vscode-data-grid-cell grid-column="1">Time</vscode-data-grid-cell>
                                            <vscode-data-grid-cell grid-column="2" class="event-info-time">-</vscode-data-grid-cell>
                                        </vscode-data-grid-row>
                                        <vscode-data-grid-row>
                                            <vscode-data-grid-cell grid-column="1">Task</vscode-data-grid-cell>
                                            <vscode-data-grid-cell grid-column="2" class="event-info-task">-</vscode-data-grid-cell>
                                        </vscode-data-grid-row>
                                    </vscode-data-grid>
                                    <vscode-divider></vscode-divider>
                                    <vscode-data-grid class="event-info-backtrace" grid-template-columns="2fr 3fr">
                                        <vscode-data-grid-row row-type="header">
                                            <vscode-data-grid-cell grid-column="1" cell-type="columnheader">Function</vscode-data-grid-cell>
                                            <vscode-data-grid-cell grid-column="2" cell-type="columnheader">Path</vscode-data-grid-cell>
                                        </vscode-data-grid-row>
                                    </vscode-data-grid>
                                </div>
                                <div class="task-info">
                                    <vscode-data-grid grid-template-columns="2fr 3fr">
                                        <vscode-data-grid-row>
                                            <vscode-data-grid-cell grid-column="1">Kind</vscode-data-grid-cell>
                                            <vscode-data-grid-cell grid-column="2" class="task-info-kind">-</vscode-data-grid-cell>
                                        </vscode-data-grid-row>
                                        <vscode-data-grid-row>
                                            <vscode-data-grid-cell grid-column="1">Name</vscode-data-grid-cell>
                                            <vscode-data-grid-cell grid-column="2" class="task-info-name">-</vscode-data-grid-cell>
                                        </vscode-data-grid-row>
                                        <vscode-data-grid-row>
                                            <vscode-data-grid-cell grid-column="1">ID</vscode-data-grid-cell>
                                            <vscode-data-grid-cell grid-column="2" class="task-info-id">-</vscode-data-grid-cell>
                                        </vscode-data-grid-row>
                                        <vscode-data-grid-row>
                                            <vscode-data-grid-cell grid-column="1">Created by</vscode-data-grid-cell>
                                            <vscode-data-grid-cell grid-column="2" class="task-info-created">-</vscode-data-grid-cell>
                                        </vscode-data-grid-row>
                                        <vscode-data-grid-row>
                                            <vscode-data-grid-cell grid-column="1">First step</vscode-data-grid-cell>
                                            <vscode-data-grid-cell grid-column="2" class="task-info-first">-</vscode-data-grid-cell>
                                        </vscode-data-grid-row>
                                        <vscode-data-grid-row>
                                            <vscode-data-grid-cell grid-column="1">Last step</vscode-data-grid-cell>
                                            <vscode-data-grid-cell grid-column="2" class="task-info-last">-</vscode-data-grid-cell>
                                        </vscode-data-grid-row>
                                    </vscode-data-grid>
                                </div>
                                <div class="object-info">
                                    <vscode-data-grid grid-template-columns="2fr 3fr">
                                        <vscode-data-grid-row>
                                            <vscode-data-grid-cell grid-column="1">Kind</vscode-data-grid-cell>
                                            <vscode-data-grid-cell grid-column="2" class="object-info-kind">-</vscode-data-grid-cell>
                                        </vscode-data-grid-row>
                                        <vscode-data-grid-row>
                                            <vscode-data-grid-cell grid-column="1">Name</vscode-data-grid-cell>
                                            <vscode-data-grid-cell grid-column="2" class="object-info-name">-</vscode-data-grid-cell>
                                        </vscode-data-grid-row>
                                        <vscode-data-grid-row>
                                            <vscode-data-grid-cell grid-column="1">ID</vscode-data-grid-cell>
                                            <vscode-data-grid-cell grid-column="2" class="object-info-id">-</vscode-data-grid-cell>
                                        </vscode-data-grid-row>
                                        <vscode-data-grid-row>
                                            <vscode-data-grid-cell grid-column="1">Created by</vscode-data-grid-cell>
                                            <vscode-data-grid-cell grid-column="2" class="object-info-created">-</vscode-data-grid-cell>
                                        </vscode-data-grid-row>
                                        <vscode-data-grid-row>
                                            <vscode-data-grid-cell grid-column="1">Seen by</vscode-data-grid-cell>
                                            <vscode-data-grid-cell grid-column="2" class="object-info-seen">-</vscode-data-grid-cell>
                                        </vscode-data-grid-row>
                                        <vscode-data-grid-row>
                                            <vscode-data-grid-cell grid-column="1">First step</vscode-data-grid-cell>
                                            <vscode-data-grid-cell grid-column="2" class="object-info-first">-</vscode-data-grid-cell>
                                        </vscode-data-grid-row>
                                        <vscode-data-grid-row>
                                            <vscode-data-grid-cell grid-column="1">Last step</vscode-data-grid-cell>
                                            <vscode-data-grid-cell grid-column="2" class="object-info-last">-</vscode-data-grid-cell>
                                        </vscode-data-grid-row>
                                    </vscode-data-grid>
                                    <vscode-button class="object-create-filter">Create filter</vscode-button>
                                </div>
                            </vscode-panel-view>
                            <vscode-panel-view id="sidebar-view-2">
                                <vscode-checkbox id="filters-schedule">Schedule events <vscode-badge>0</vscode-badge></vscode-checkbox>
                                <vscode-checkbox id="filters-tick">Tick events <vscode-badge>0</vscode-badge></vscode-checkbox>
                                <vscode-checkbox id="filters-semaphore" checked>Semaphore events <vscode-badge>0</vscode-badge></vscode-checkbox>
                                <vscode-checkbox id="filters-task" checked>Task events <vscode-badge>0</vscode-badge></vscode-checkbox>
                                <vscode-checkbox id="filters-random" checked>Random events <vscode-badge>0</vscode-badge></vscode-checkbox>
                                <vscode-divider></vscode-divider>
                                <div id="filters-user"></div>
                            </vscode-panel-view>
                        </vscode-panels>
                    </div>
                    <div class="panel-main"></div>
                </main>
            </body>
            </html>`;
    }
}

function getNonce() {
    let text = "";
    const possible = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
    for (let i = 0; i < 32; i++) {
        text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
}
