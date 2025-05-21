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
exports.deactivate = exports.activate = void 0;
const vscode = __importStar(require("vscode"));
const child_process_1 = require("child_process");
function activate(context) {
    context.subscriptions.push(vscode.window.registerWebviewViewProvider('espFlasherWebview', new EspFlasherViewProvider(context)));
}
exports.activate = activate;
function deactivate() { }
exports.deactivate = deactivate;
class EspFlasherViewProvider {
    constructor(context) {
        this.context = context;
    }
    resolveWebviewView(webviewView) {
        webviewView.webview.options = {
            enableScripts: true
        };
        webviewView.webview.html = this.getHtml();
        webviewView.webview.onDidReceiveMessage((message) => __awaiter(this, void 0, void 0, function* () {
            if (message.command === 'flash') {
                const { port, board } = message;
                const fileUri = yield vscode.window.showOpenDialog({
                    filters: { 'BIN files': ['bin'] },
                    canSelectMany: false
                });
                if (!port || !board || !fileUri) {
                    vscode.window.showErrorMessage('All inputs are required.');
                    return;
                }
                const firmwarePath = fileUri[0].fsPath;
                const pythonCmd = 'python'; // or 'python3'
                const cmd = `${pythonCmd} -u -m esptool --port ${port} --chip ${board} --baud 115200 write_flash --flash_mode keep --flash_size keep --erase-all 0x1000 "${firmwarePath}"`;
                vscode.window.withProgress({
                    location: vscode.ProgressLocation.Notification,
                    title: 'Flashing firmware...',
                    cancellable: false
                }, () => new Promise((resolve, reject) => {
                    (0, child_process_1.exec)(cmd, (error, stdout, stderr) => {
                        if (error) {
                            vscode.window.showErrorMessage(`Flashing failed: ${stderr || error.message}`);
                            reject(error);
                        }
                        else {
                            vscode.window.showInformationMessage('Firmware flashed successfully!');
                            resolve();
                        }
                    });
                }));
            }
        }));
    }
    getHtml() {
        return `
      <!DOCTYPE html>
      <html lang="en">
      <body>
        <h3>ESP MicroPython Flasher</h3>
        <form id="flashForm">
          <label>COM Port: <input type="text" id="port" required /></label><br/>
          <label>Board: 
            <select id="board">
              <option value="esp32">ESP32</option>
              <option value="esp8266">ESP8266</option>
            </select>
          </label><br/>
          <button type="submit">Select .bin file & Flash</button>
        </form>
        <script>
          const vscode = acquireVsCodeApi();
          document.getElementById('flashForm').addEventListener('submit', (e) => {
            e.preventDefault();
            const port = document.getElementById('port').value;
            const board = document.getElementById('board').value;
            vscode.postMessage({ command: 'flash', port, board });
          });
        </script>
      </body>
      </html>
    `;
    }
}
