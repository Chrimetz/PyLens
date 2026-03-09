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
function activate(context) {
    const provider = new MetricsCodeLensProvider();
    context.subscriptions.push(vscode.languages.registerCodeLensProvider({ language: "python" }, provider));
}
exports.activate = activate;
const path = __importStar(require("path"));
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
class MetricsCodeLensProvider {
    // updated signature with cancellation token
    provideCodeLenses(document, token) {
        return __awaiter(this, void 0, void 0, function* () {
            const lenses = [];
            const results = yield analyzeFile(document.fileName);
            results.forEach((result) => {
                const line = result.line - 1; // adjust for 0-based index
                const range = new vscode.Range(line, 0, line, 0);
                const complexity = result.complexity;
                let interpretation;
                if (complexity <= 5) {
                    interpretation = "simple";
                }
                else if (complexity <= 10) {
                    interpretation = "moderate";
                }
                else if (complexity <= 20) {
                    interpretation = "complex";
                }
                else {
                    interpretation = "very complex";
                }
                lenses.push(new vscode.CodeLens(range, {
                    title: `Complexity: ${complexity} (that is a ${interpretation} function)`,
                    command: ""
                }));
            });
            return lenses;
        });
    }
}
//# sourceMappingURL=extension.js.map