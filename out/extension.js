"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.activate = void 0;
const child_process_1 = require("child_process");
const vscode = __importStar(require("vscode"));
const path = __importStar(require("path"));
function activate(context) {
    // register command for showing references, used by CodeLens
    context.subscriptions.push(vscode.commands.registerCommand("pymetrics.showReferences", (uri, position) => __awaiter(this, void 0, void 0, function* () {
        const locations = yield vscode.commands.executeCommand("vscode.executeReferenceProvider", uri, position);
        if (!locations) {
            return;
        }
        vscode.commands.executeCommand("editor.action.showReferences", uri, position, locations);
    })));
    const provider = new MetricsCodeLensProvider();
    context.subscriptions.push(vscode.languages.registerCodeLensProvider({ language: "python" }, provider));
}
exports.activate = activate;
function analyzeFile(file) {
    const analyzerScript = path.join(__dirname, '..', 'src', 'analyzer', 'analyzer.py');
    return new Promise((resolve, reject) => {
        (0, child_process_1.execFile)("python", [analyzerScript, file], { cwd: path.dirname(analyzerScript) }, (err, stdout, stderr) => {
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
            }
            catch (parseErr) {
                reject(parseErr);
            }
        });
    });
}
function countReferences(document, position) {
    return __awaiter(this, void 0, void 0, function* () {
        const references = yield vscode.commands.executeCommand("vscode.executeReferenceProvider", document.uri, position);
        if (!references) {
            return 0;
        }
        if (references.length === 0) {
            return 0;
        }
        return references.length - 1; // subtract 1 to exclude the declaration itself
    });
}
// returns number of commits that touched the specified function
// Git's -L option walks the history of a range or function by name.
function getFunctionChangeFrequency(repoPath, filePath, funcName) {
    // relative path from repo root, forward-slashes required for git
    const rel = path.relative(repoPath, filePath).replace(/\\/g, '/');
    // if the file isn't yet tracked or the function doesn't exist we fallback to 0
    try {
        const cmd = `git -C "${repoPath}" log -L :${funcName}:${rel} --pretty=format:%H`;
        const output = (0, child_process_1.execSync)(cmd, { encoding: 'utf-8' }).toString().trim();
        if (!output) {
            return 0;
        }
        const hashes = new Set(output.split('\n'));
        return hashes.size;
    }
    catch (e) {
        // git returns non-zero if the file is missing or the function name can't be resolved
        return 0;
    }
}
function riskScore(complexity, changes, maxChanges) {
    const C = Math.min(complexity / 15, 1);
    const F = Math.log(changes + 1) / Math.log(maxChanges + 1);
    const a = 3;
    const b = 2;
    const c = 3;
    const score = 1 / (1 + Math.exp(-(a * C + b * F - c)));
    return score;
}
function riskLevel(score) {
    if (score < 0.3) {
        return "low";
    }
    else if (score < 0.7) {
        return "medium";
    }
    else {
        return "high";
    }
}
class MetricsCodeLensProvider {
    // updated signature with cancellation token
    provideCodeLenses(document, token) {
        var _a;
        return __awaiter(this, void 0, void 0, function* () {
            const lenses = [];
            let results = [];
            try {
                results = yield analyzeFile(document.fileName);
            }
            catch (err) {
                console.error("analyzeFile failed", err);
                return lenses;
            }
            const repoPath = (_a = vscode.workspace.getWorkspaceFolder(document.uri)) === null || _a === void 0 ? void 0 : _a.uri.fsPath;
            // build a map of change counts per function; also track the max so we can
            // normalise the risk score later.
            const functionChanges = new Map();
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
                let interpretation;
                if (complexity <= 5) {
                    interpretation = "simple ✓";
                }
                else if (complexity <= 10) {
                    interpretation = "moderate ⚠";
                }
                else if (complexity <= 20) {
                    interpretation = "complex ✗";
                }
                else {
                    interpretation = "very complex ✗";
                }
                const position = new vscode.Position(line, nameColumn);
                const referenceCount = yield countReferences(document, position);
                // convert to forward slashes so it matches how git outputs paths
                const rel = path.relative(repoPath || '', document.fileName).replace(/\\/g, '/');
                const changes = functionChanges.get(result.name) || 0;
                const risk = riskScore(complexity, changes, maxChanges);
                const riskLevelStr = riskLevel(risk);
                const title = `Complexity: ${complexity} (that is a ${interpretation} function) | refs: ${referenceCount} | changes: ${changes} | risk: ${risk.toFixed(2)} ${riskLevelStr}`;
                lenses.push(new vscode.CodeLens(range, {
                    title,
                    command: "pymetrics.showReferences",
                    arguments: [document.uri, position]
                }));
            }
            return lenses;
        });
    }
}
//# sourceMappingURL=extension.js.map