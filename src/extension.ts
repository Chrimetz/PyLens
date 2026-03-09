import { execFile } from "child_process";
import * as vscode from 'vscode';

export function activate(context: vscode.ExtensionContext) {
    // register command for showing references, used by CodeLens
    context.subscriptions.push(
        vscode.commands.registerCommand(
            "pymetrics.showReferences",
            async (uri: vscode.Uri, position: vscode.Position) => {
                const locations = await vscode.commands.executeCommand<vscode.Location[]>(
                    "vscode.executeReferenceProvider",
                    uri,
                    position
                );

                if (!locations) {
                    return;
                }

                vscode.commands.executeCommand(
                    "editor.action.showReferences",
                    uri,
                    position,
                    locations
                );
            }
        )
    );

    const provider: vscode.CodeLensProvider<vscode.CodeLens> = new MetricsCodeLensProvider();

    context.subscriptions.push(
        vscode.languages.registerCodeLensProvider({ language: "python" }, provider)
    );
}

import * as path from 'path';

function analyzeFile(file: string): Promise<any> {
    const analyzerScript = path.join(__dirname, '..', 'src', 'analyzer', 'analyzer.py');

    return new Promise((resolve, reject) => {
        execFile(
            "python",
            [analyzerScript, file],
            { cwd: path.dirname(analyzerScript) },
            (err, stdout, stderr) => {
                if (err) {
                    reject(err);
                    return;
                }

                // ignore stderr; radon script should not write to stdout

                try {
                    const idx = stdout.search(/[\[{]/);
                    const jsonText = idx >= 0 ? stdout.slice(idx) : stdout;
                    const parsed = JSON.parse(jsonText);
                    resolve(parsed);
                } catch (parseErr) {
                    reject(parseErr);
                }
            }
        );
    });
}

async function countReferences(document: vscode.TextDocument, position: vscode.Position): Promise<number> {
    const references = await vscode.commands.executeCommand<vscode.Location[]>(
        "vscode.executeReferenceProvider",
        document.uri,
        position
    );

    if (!references) {
        return 0;
    }

    if (references.length === 0) {
        return 0;
    }

    return references.length -1; // subtract 1 to exclude the declaration itself
}

class MetricsCodeLensProvider<T extends vscode.CodeLens = vscode.CodeLens> implements vscode.CodeLensProvider<T> {

    // updated signature with cancellation token
    async provideCodeLenses(
        document: vscode.TextDocument,
        token: vscode.CancellationToken
    ): Promise<T[]> {

        const lenses: T[] = [];

        let results: any[] = [];
        try {
            results = await analyzeFile(document.fileName);
        } catch (err) {
            console.error("analyzeFile failed", err);
            return lenses;
        }

        // use for..of so we can await inside the loop
        for (const result of results) {
            const line = result.line - 1; // adjust for 0-based index

            // attempt to find the column where the function name starts so the
            // reference provider is invoked at the correct position
            const textLine = document.lineAt(line).text;
            let nameColumn = 0;
            const m = /^\s*def\s+(\w+)/.exec(textLine);
            if (m && m.index !== undefined) {
                // m.index gives start of match (including indentation); add length of 'def ' to get to name
                nameColumn = m.index + m[0].indexOf(m[1]);
            }

            const range = new vscode.Range(line, 0, line, 0);
            const complexity = result.complexity;
            let interpretation: string;
            if (complexity <= 5) {
                interpretation = "simple ✓";
            } else if (complexity <= 10) {
                interpretation = "moderate ⚠";
            } else if (complexity <= 20) {
                interpretation = "complex ✗";
            } else {
                interpretation = "very complex ✗";
            }

            const position = new vscode.Position(line, nameColumn);
            const referenceCount = await countReferences(document, position);

            const title = `Complexity: ${complexity} (that is a ${interpretation} function); refs: ${referenceCount}`;
            lenses.push(
                new vscode.CodeLens(range, {
                    title,
                    command: "pymetrics.showReferences",
                    arguments: [document.uri, position]
                }) as T
            );
        }

        return lenses;
    }
}


