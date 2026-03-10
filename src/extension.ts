import { execSync, execFile } from "child_process";
import * as vscode from 'vscode';
import * as path from 'path';

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

// returns number of commits that touched the specified function
// Git's -L option walks the history of a range or function by name.
function getFunctionChangeFrequency(repoPath: string, filePath: string, funcName: string): number {
    // relative path from repo root, forward-slashes required for git
    const rel = path.relative(repoPath, filePath).replace(/\\/g, '/');
    // if the file isn't yet tracked or the function doesn't exist we fallback to 0
    try {
        const cmd = `git -C "${repoPath}" log -L :${funcName}:${rel} --pretty=format:%H`;
        const output = execSync(cmd, { encoding: 'utf-8' }).toString().trim();
        if (!output) {
            return 0;
        }
        const hashes = new Set(output.split('\n'));
        return hashes.size;
    } catch (e) {
        // git returns non-zero if the file is missing or the function name can't be resolved
        return 0;
    }
}

function riskScore(complexity: number, changes: number, maxChanges: number): number {

    const C = Math.min(complexity / 15, 1);
    const F = Math.log(changes + 1) / Math.log(maxChanges + 1);

    const a = 3;
    const b = 2;
    const c = 3;

    const score = 1 / (1 + Math.exp(-(a*C + b*F - c)));

    return score;
}

function riskLevel(score: number): string {
    if (score < 0.3) {
        return "low";
    } else if (score < 0.7) {
        return "medium";    
    } else {
        return "high";
    }
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

        const repoPath = vscode.workspace.getWorkspaceFolder(document.uri)?.uri.fsPath;

        // build a map of change counts per function; also track the max so we can
        // normalise the risk score later.
        const functionChanges = new Map<string, number>();
        let maxChanges = 1;
        if (repoPath) {
            for (const r of results) {
                const count = getFunctionChangeFrequency(repoPath, document.fileName, r.name);
                functionChanges.set(r.name, count);
                if (count > maxChanges) {
                    maxChanges = count;
                }
            }
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
            // convert to forward slashes so it matches how git outputs paths
            const rel = path.relative(repoPath || '', document.fileName).replace(/\\/g, '/');
            const changes = functionChanges.get(result.name) || 0;
            const risk = riskScore(complexity, changes, maxChanges);
            const riskLevelStr = riskLevel(risk);

            const title = `Complexity: ${complexity} (that is a ${interpretation} function) | refs: ${referenceCount} | changes: ${changes} | risk: ${risk.toFixed(2)} ${riskLevelStr}`;

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


