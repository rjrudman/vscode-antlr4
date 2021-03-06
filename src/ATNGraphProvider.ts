/*
 * This file is released under the MIT license.
 * Copyright (c) 2017 Mike Lischke
 *
 * See LICENSE file for more info.
 */

'use strict';

import * as fs from "fs-extra";
import * as vscode from "vscode";

import { AntlrLanguageSupport, SymbolKind } from "antlr4-graps";
import { AntlrTextContentProvider } from "./TextContentProvider";
import { Utils } from "./Utils";
import { workspace } from "vscode";

// ATN graph state info for a single rule.
export class ATNStateEntry {
    scale: number;
    translation: { x: number, y: number };
    states: { id: number, fx: number, fy: number }[];
};

export class AntlrATNGraphProvider extends AntlrTextContentProvider {

    // Set by the update method if there's cached state data for the current rule.
    private cachedRuleStates: ATNStateEntry | undefined;

    public provideTextDocumentContent(uri: vscode.Uri): Thenable<string> {
        const sourceUri = vscode.Uri.parse(uri.query);
        const command = uri.fragment;

        return vscode.workspace.openTextDocument(sourceUri).then(document => {
            vscode.window.showTextDocument(document);

            if (!this.currentRule) {
                return `<html><body><span style="color: #808080; font-size: 16pt;">No rule selected</span></body><html>`;
            }

            let html = fs.readFileSync(this.context.asAbsolutePath("misc/atngraph-head.html"), { encoding: "utf-8" });
            let code = fs.readFileSync(this.context.asAbsolutePath("misc/atngraph-code.js"), { encoding: "utf-8" });

            const scripts = [
                Utils.getMiscPath('utils.js', this.context),
            ];

            html = html.replace("##header##", `
                ${this.getStyles(uri, "atn")}
                <base target="_blank" />
                <style>
                    .icon {
                        width: 1em;
                        height: 1em;
                        display: inline-block;
                        background-repeat: no-repeat;
                        background-position: center bottom;
                    }

                    .header {
                        position: fixed;
                        font-size: 14pt;
                        z-index: 9999;
                        top: 0;
                        left: 0;
                        right: 0;
                        background-color: var(--background-color);
                        height: 30px;
                    }

                    body.vscode-light .icon { filter: invert(100%); -webkit-filter: invert(100%); }
                    #container { margin-top: 30px; }
                    svg { display: block; }
                    body { padding-left: 20px; }
                    .icon-box { font: 10pt monospace; margin-left: 0px; }
                    .icon.save { background-image: url("${Utils.getMiscPath('save.svg', this.context)}"); }
                </style>
            </head>
            `.replace(/\$/g, "$$"));
            html = html.replace(/##objectName##/g, this.currentRule.replace(/\$/g, "$$"));

            let maxLabelCount = workspace.getConfiguration("antlr4.atn")["maxLabelCount"];
            html = html.replace("##maxLabelCount##", maxLabelCount > 1 ? maxLabelCount : 5);
            html += `var width = 1000, height = 1000\n\n`;

            let data = this.backend.getATNGraph(document.fileName, this.currentRule);
            if (data) {
                let scale = !this.cachedRuleStates || Number.isNaN(this.cachedRuleStates.scale)
                    ? "0.5 * Math.exp(-nodes.length / 50) + 0.1"
                    : this.cachedRuleStates.scale;

                let transX = !this.cachedRuleStates || !this.cachedRuleStates.translation.x || Number.isNaN(this.cachedRuleStates.translation.x)
                    ? "width * (1 - initialScale)"
                    : this.cachedRuleStates.translation.x.toString();

                let transY = !this.cachedRuleStates || !this.cachedRuleStates.translation.y || Number.isNaN(this.cachedRuleStates.translation.y)
                    ? "height * (1 - initialScale)"
                    : this.cachedRuleStates.translation.y.toString();

                if (this.cachedRuleStates) {
                    for (let node of data.nodes) {
                        let state = this.cachedRuleStates.states.find(function(element): boolean {
                            return element.id === node.id;
                        });

                        if (state) {
                            if (state.fx) {
                                node["fx"] = state.fx;
                            }
                            if (state.fy) {
                                node["fy"] = state.fy;
                            }
                        }
                    }

                }

                html += "  var nodes = " + JSON.stringify(data.nodes) + "\n";
                html += "  var links = " + JSON.stringify(data.links) + "\n\n";

                html += `  var initialScale = ${scale};\n`;
                html += `  var initialTranslateX = ${transX};\n`;
                html += `  var initialTranslateY = ${transY};\n`;

                const nonce = new Date().getTime() + '' + new Date().getMilliseconds();
                html += `${code}\n</script>\n${this.getScripts(nonce, scripts)}</div></body>`;

            } else {
                html += "  var nodes = []\n";
                html += "  var links = []\n\n";

                html += `  var initialScale = 1;\n`;
                html += `  var initialTranslateX = 0;\n`;
                html += `  var initialTranslateY = 0;\n`;

                html += `</script><span style="color: #808080; font-size: 16pt;">No ATN data found
                    (code generation must run at least once in internal or external mode)</span></div></body>`;
            }

            return html;
        });

    };

    public update(uri: vscode.Uri, forced: boolean = false, cachedStates?: Map<string, ATNStateEntry>) {
        let currentRule = this.findCurrentRule(uri);
        if (!this.lastUri || this.lastUri.fsPath !== uri.fsPath || this.currentRule !== currentRule || forced) {
            if (!cachedStates || !currentRule) {
                this.cachedRuleStates = undefined;
            } else {
                this.cachedRuleStates = cachedStates.get(currentRule);
            }

            // Update content only if this is the first invocation, editors were switched or
            // the currently selected rule changed.
            if (this.lastUri) {
                vscode.commands.executeCommand('_workbench.htmlPreview.postMessage',
                    this.lastUri, { action: "saveATNState", file: this.lastUri.fsPath, rule: this.currentRule }
                ).then((value) => {
                    this.lastUri = uri;
                    this.currentRule = currentRule;
                    super.update(uri);
                });
            } else {
                this.lastUri = uri;
                this.currentRule = currentRule;
                super.update(uri);
            }
        }
    }

};
